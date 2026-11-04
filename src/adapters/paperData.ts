/**
 * adapters/paperData.js — 真题卷 / 申论 / 专题 数据适配层（v1.6）
 *
 * 数据源：gwy-zhenti 仓库（971 套申论 + 753 套行测整套卷，粉笔题库整理版）。
 * 目录结构：gwy-zhenti/<考试>/<年份>/<科目>-<卷型>.md
 * 文档结构（实测）：
 *   --- YAML frontmatter: 考试/地区/年份/科目/卷型/真题性质/来源 ---
 *   # 标题
 *   <!-- gwy:overview:start --> 摘要（N 题 · 图片 M 处）<!-- gwy:overview:end -->
 *   > 候选说明
 *   ## 给定材料 → ### 材料 N → 正文
 *   ## 题目 → ### 第 N 题 → 【题干加粗】+ 关联材料 + 作答要求 + <details>参考答案</details>
 *
 * 只读；磁盘索引惰性构建并缓存（进程内 TTL 60s），避免每次请求全盘扫描。
 *
 * cycle-13 索引 v2（schemaVersion: 2）：
 *  - 每条 paper 新增 province 维度：省考/<省份>/<年份>/… → parts[1]；国考/<年份>/… → 「全国」；
 *    其余顶层目录（公安招警 / 公检法 等特殊名）直接作为省份口径。region 字段保留原语义（零删除）。
 *  - 新增 provinces facet：[{ name, total, minYear, maxYear, subjects }]，按 name 码点升序（确定性）。
 *  - 快照根写入 schemaVersion: 2；读取时 schemaVersion !== 2 一律视为旧版失效 → 现场重建
 *    （旧快照无此字段自动重建，首次约 16s，属预期）。
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, relative, dirname } from 'node:path'
import { parseFrontmatter, parseOverview, parsePaperText, guessXingceType } from './paperParse.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

const PAPER_REPO = 'gwy-zhenti'
const INDEX_TTL = 60_000

let paperIndex: any = { ts: 0, data: null }

/** cycle-16 数据根热变更：作废内存索引缓存并作废在途预热（磁盘快照是 root 无关的相对 id，保留复用） */
export function resetPaperIndex() {
  prewarmRun++
  paperIndex = { ts: 0, data: null }
}

function safeRead(p, max = 400000) {
  try { const c = readFileSync(p, 'utf-8'); return c.length > max ? c.slice(0, max) : c } catch { return null }
}
function safeReaddir(p) { try { return readdirSync(p) } catch { return [] } }
function isDir(p) { try { return statSync(p).isDirectory() } catch { return false } }

/** 构建真题卷索引：递归遍历 gwy-zhenti；磁盘快照缓存（1683 卷约 30s→首建一次，之后 ~10ms） */
const INDEX_FILE = () => join(process.cwd(), 'data', '.paper-index.json')

/* ── cycle-14 性能改造：把「扫盘 → 逐文件解析 → 聚合」拆成三段可复用助手 ──
 * 动机（教训⑤根修）：同步 buildPaperIndex 首建会阻塞事件循环 ~10-16s，
 * keep-alive 连接被 Node http 掐断（ECONNRESET）、UI 首开真题卷卡死。
 * 方案：prewarmPaperIndex 在服务启动后**分块**预热（每批 setImmediate 让路事件循环），
 * 请求到达时几乎总命中热缓存；若请求抢先到达，同步路径仍在（行为回退不变）。 */

/** 第一段：只收集候选 .md 路径（readdir 级别，毫秒级）；排序保证确定性（跨机器同序） */
function collectPaperFiles(root) {
  const files: any[] = []
  function walk(dir, depth) {
    if (depth > 5) return
    for (const entry of safeReaddir(dir)) {
      if (entry.startsWith('.') || entry.startsWith('_') || entry === 'node_modules') continue
      const full = join(dir, entry)
      if (isDir(full)) { walk(full, depth + 1); continue }
      if (!entry.endsWith('.md')) continue
      const stem = basename(entry, '.md')
      if (!/^(申论|行测)-/.test(stem)) continue
      files.push(full)
    }
  }
  walk(root, 0)
  // 码点排序：walk 原序依赖 OS readdir（不保证跨机一致）；排序后 sync/分块两路径同序（确定性纪律）
  files.sort()
  return files
}

/** 第二段：单文件 → 索引记录（只读头部 2500 字 + frontmatter/overview 解析，纯函数） */
function buildPaperRecord(root, full) {
  const head = safeRead(full, 2500)
  if (!head) return null
  const meta = parseFrontmatter(head)
  const ov = parseOverview(head)
  const stem = basename(full, '.md')
  const dash = stem.indexOf('-')
  const subject = meta.科目 || stem.slice(0, dash)
  const paperType = meta.卷型 || stem.slice(dash + 1)
  const rel = relative(root, full).replace(/\\/g, '/')
  const parts = rel.split('/')
  // cycle-13 省份维度：省考/<省份>/<年份>/<科目>-<卷型>.md → parts[1]；
  // 国考/<年份>/… → 「全国」；其余顶层目录（公安招警/公检法等特殊名）直接作省份。
  const province = parts[0] === '省考' ? (parts[1] || '') : (parts[0] === '国考' ? '全国' : (parts[0] || ''))
  return {
    id: rel.replace(/\.md$/, ''),
    exam: meta.考试 || parts[0] || '',
    region: meta.地区 || parts[0] || '',
    province,
    year: +(meta.年份 || parts[1]) || null,
    subject,
    paperType: paperType || (parts.length > 3 ? parts[2] : ''),
    questionCount: ov.questionCount,
    imageCount: ov.imageCount,
    verified: (meta.校验状态 || '').includes('正式入库'),
    source: meta.来源 || '',
    relPath: rel,
  }
}

/** 第三段：聚合维度（按科目/省份）+ 快照落盘 + 写进程缓存。sync/分块两路径共用同一实现。 */
function aggregateIndex(now, papers) {
  const bySubject: any = {}
  for (const p of papers) (bySubject[p.subject] = bySubject[p.subject] || []).push(p)
  const subjects = entries(bySubject).map(([subject, list]) => ({
    subject,
    count: list.length,
    questionTotal: list.reduce((s: number, x: any) => s + (x.questionCount || 0), 0),
    years: [...new Set(list.map((x: any) => x.year).filter(Boolean))].sort((a: any, b: any) => b - a),
    exams: [...new Set(list.map((x: any) => x.exam))],
  })).sort((a, b) => b.count - a.count)

  // cycle-13 省份维度聚合：按省份统计卷数 / 年份跨度 / 科目分布。
  // 排序用码点比较（< / >），不用 localeCompare —— 确定性纪律：同输入两次构建深相等。
  const byProvince: any = {}
  for (const p of papers) {
    const key = p.province || '未知'
    ;(byProvince[key] = byProvince[key] || []).push(p)
  }
  const provinces = entries(byProvince).map(([name, list]: any) => {
    const ys = list.map((x: any) => x.year).filter(Boolean)
    const subjCnt: any = {}
    for (const x of list) subjCnt[x.subject] = (subjCnt[x.subject] || 0) + 1
    return {
      name,
      total: list.length,
      minYear: ys.length ? Math.min.apply(null, ys) : null,
      maxYear: ys.length ? Math.max.apply(null, ys) : null,
      subjects: subjCnt,
    }
  }).sort((a: any, b: any) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const data = { schemaVersion: 2, papers, subjects, provinces, total: papers.length, builtAt: new Date().toISOString() }
  // 落盘快照（失败不影响业务：下次现场重建）
  try {
    const f = INDEX_FILE()
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify(data))
  } catch { /* ignore */ }
  paperIndex = { ts: now, data }
  return data
}

export function buildPaperIndex(repoRoot, force = false) {
  const now = Date.now()
  // 代际令牌：同步重建一经启动即作废进行中的分块预热（否则两路并发扫盘互相争抢，首查反而变慢——cycle-14 实测 31.5s 教训）
  prewarmRun++
  if (!force && paperIndex.data && now - paperIndex.ts < INDEX_TTL) return paperIndex.data
  // 磁盘快照：优先复用（避免每次进程重启都扫 1683 个文件）
  if (!force) {
    try {
      const snap = JSON.parse(readFileSync(INDEX_FILE(), 'utf-8'))
      // cycle-13：schemaVersion !== 2 一律视为旧版快照（无省份维度）→ 丢弃重建
      if (snap && snap.schemaVersion === 2 && snap.total > 0 && Array.isArray(snap.papers)) {
        paperIndex = { ts: now, data: snap }
        return snap
      }
    } catch { /* 无快照则现场构建 */ }
  }

  const root = join(repoRoot, PAPER_REPO)
  // 同步路径（行为保底）：与分块预热共用 collect/build/aggregate 三助手，输出逐字段一致
  const papers = collectPaperFiles(root)
    .map(full => buildPaperRecord(root, full))
    .filter(Boolean)
  return aggregateIndex(now, papers)
}

/* ── 分块预热（cycle-14）：服务启动后后台把索引热进内存，消除首请求 ~10-16s 冻结 ── */
let prewarmStarted = false
let prewarmRun = 0   // 代际令牌：同步 buildPaperIndex 启动时自增 → 在途预热批次检测到换代即退出
export function prewarmPaperIndex(repoRoot) {
  if (prewarmStarted) return
  prewarmStarted = true
  const chunkMs = 600   // 启动后让路：先让 listen/attach/UI 首屏就绪
  const BATCH = 40      // 每批解析 40 个文件头（~250ms 内），批间 setImmediate 让路事件循环
  setTimeout(() => {
    const myRun = ++prewarmRun
    try {
      const now = Date.now()
      // ① 进程缓存仍新鲜 → 无事可做
      if (paperIndex.data && now - paperIndex.ts < INDEX_TTL) return
      // ② 快照可复用 → 一次 readFileSync（~ms）即热
      try {
        const snap = JSON.parse(readFileSync(INDEX_FILE(), 'utf-8'))
        if (snap && snap.schemaVersion === 2 && snap.total > 0 && Array.isArray(snap.papers)) {
          paperIndex = { ts: now, data: snap }
          return
        }
      } catch { /* 无快照 → 走分块构建 */ }
      // ③ 分块构建：收集（毫秒级）→ 每批 BATCH 个 setImmediate 让路 → 聚合落盘
      const root = join(repoRoot, PAPER_REPO)
      const files = collectPaperFiles(root)
      let i = 0
      const papers: any[] = []
      const step = () => {
        if (myRun !== prewarmRun) return   // 同步重建已接管（请求抢先到达）→ 本预热作废，不与其争抢
        try {
          const end = Math.min(i + BATCH, files.length)
          for (; i < end; i++) {
            const rec = buildPaperRecord(root, files[i])
            if (rec) papers.push(rec)
          }
        } catch (e) { return } // 单批异常：放弃本次预热（请求时同步路径兜底）
        if (i < files.length) { setImmediate(step); return }
        try { aggregateIndex(Date.now(), papers) } catch { /* 聚合失败不影响请求路径 */ }
      }
      setImmediate(step)
    } catch { /* 预热是尽力而为：任何异常静默放弃，请求时同步路径兜底 */ }
  }, chunkMs)
}

/** 取单套卷详情：材料 + 题目（含参考答案） */
export function loadPaper(repoRoot, paperId) {
  const root = join(repoRoot, PAPER_REPO)
  const filePath = join(root, paperId + '.md')
  // 防路径穿越：解析后必须仍在 root 内
  if (!filePath.startsWith(root)) return { error: '非法路径' }
  const raw = safeRead(filePath, 600000)
  if (!raw) return { error: `试卷不存在: ${paperId}` }
  const content = raw.replace(/\r\n/g, '\n')
  const meta = parseFrontmatter(content)
  const ov = parseOverview(content)

  const parsed = parsePaperText(content, meta)
  const materials = parsed.materials
  const questions = parsed.questions

  return {
    id: paperId,
    exam: meta.考试 || '', region: meta.地区 || '', year: +(meta.年份 || 0) || null,
    subject: meta.科目 || '', paperType: meta.卷型 || '',
    nature: meta.真题性质 || '', source: meta.来源 || '',
    verified: (meta.校验状态 || '').includes('正式入库'),
    questionCount: questions.length || ov.questionCount,
    imageCount: ov.imageCount,
    materials, questions,
  }
}

/** 专题：按科目/年份/卷型聚合的可练习单元（行测按模块、申论按题型） */
export function buildTopics(repoRoot) {
  const idx = buildPaperIndex(repoRoot)
  const topics: any[] = []
  // 科目级专题
  for (const s of idx.subjects) {
    topics.push({
      id: `subject:${s.subject}`, kind: 'subject', title: s.subject,
      papers: s.count, questions: s.questionTotal,
      years: s.years.slice(0, 12), exams: s.exams.slice(0, 8),
      desc: `${s.count} 套真题 · 累计 ${s.questionTotal} 题`,
    })
  }
  // 申论题型专题（从题目作答要求归纳：概括/分析/对策/应用文/大作文）
  const essayTypes = [
    { key: '概括', kw: /概括|概述|归纳|梳理/, desc: '概括归纳题：提炼要点，分条作答' },
    { key: '分析', kw: /分析|评析|谈谈|理解|解释/, desc: '综合分析题：解释含义、分析原因影响' },
    { key: '对策', kw: /对策|建议|措施|怎么办|提出/, desc: '提出对策题：针对问题给方案' },
    { key: '应用文', kw: /公开信|倡议书|讲话稿|汇报|短评|建议书|宣传/, desc: '应用文写作：格式+内容双评分' },
    { key: '大作文', kw: /文章|议论文|自拟标题|联系实际/, desc: '大作文：论点论据结构语言' },
  ]
  for (const t of essayTypes) {
    topics.push({ id: `essay:${t.key}`, kind: 'essay-type', title: `申论·${t.key}`, desc: t.desc, papers: null, questions: null, years: [], exams: [] })
  }
  return { topics, subjects: idx.subjects, total: idx.total }
}

/** 按条件筛选试卷列表（供真题卷列表页）；cycle-13 新增 province 过滤（与 subject/exam/year/q 并列） */
export function listPapers(repoRoot: string, { subject, exam, year, province, q }: any = {}) {
  const idx = buildPaperIndex(repoRoot)
  let list = idx.papers
  if (subject) list = list.filter(p => p.subject === subject)
  if (exam) list = list.filter(p => p.exam === exam)
  if (province) list = list.filter(p => p.province === province)
  if (year) list = list.filter(p => p.year === +year)
  if (q) {
    const k = q.toLowerCase()
    list = list.filter(p => (p.id + p.exam + p.paperType).toLowerCase().includes(k))
  }
  // 年份新→旧，同年按卷型（码点比较，不依赖环境 locale —— 确定性纪律）
  list = [...list].sort((a, b) => (b.year || 0) - (a.year || 0)
    || (String(a.paperType) < String(b.paperType) ? -1 : String(a.paperType) > String(b.paperType) ? 1 : 0))
  return { total: list.length, papers: list.slice(0, 200) }
}

/** 申论评分：按要点覆盖率 + 结构 + 字数 打分（离线规则引擎，非模型） */
export function gradeEssay(question, answer) {
  const text = String(answer || '').trim()
  const chars = text.replace(/\s/g, '').length
  const ref = String(question?.reference || '')
  const requirement = String(question?.requirement || '')
  const scoreMax = question?.score || (chars > 800 ? 40 : 20)

  // 1) 字数：从作答要求抽「不超过N字」/「N字左右」
  const limitM = requirement.match(/(?:不超过|不少于|左右)?\s*(\d{2,4})\s*字/)
  const limit = limitM ? +limitM[1] : null
  let lengthScore = 1
  if (limit) {
    const ratio = chars / limit
    lengthScore = ratio > 1.15 ? 0.6 : ratio < 0.5 ? 0.5 : ratio < 0.8 ? 0.85 : 1
  } else if (chars < 80) lengthScore = 0.5

  // 2) 要点覆盖：从参考要点抽「采分点短语」，统计命中率
  //    采分点特征：分条/编号行首、或以「；。」分隔的短句；抽取 4-14 字的规范短语，
  //    过长（>18字，多为论述句）与过碎（2字泛词）都丢弃——避免漏点表变成噪音。
  const keyTerms = new Set()
  const refLines = ref.split(/\n+/).map(l => l.replace(/^[\s\d.、)）(（一二三四五六七八九十]+/, '').trim()).filter(Boolean)
  const candidates: any[] = []
  for (const line of refLines) {
    if (line.length < 6) continue
    // 行内按分句切
    for (const seg of line.split(/[；;。]/)) {
      const t = seg.trim().replace(/^[\s\d.、)）(（]+/, '')
      if (t.length >= 6 && t.length <= 18) candidates.push(t)
      else if (t.length > 18) {
        // 长句：抽取其中的动宾短语片段（4-10 字）
        for (const m of t.matchAll(/[\u4e00-\u9fa5]{4,10}/g)) {
          if (m[0].length >= 4) candidates.push(m[0])
          break // 每长句只取首个短语，防噪音
        }
      }
    }
  }
  for (const c of candidates) {
    if (keyTerms.size > 60) break
    keyTerms.add(c)
  }
  const terms = [...keyTerms]
  // 命中判定：作答包含该短语，或包含其 70% 以上的连续子串（容许语序微调）
  const hitOf = (t) => {
    if (text.includes(t)) return true
    const need = Math.ceil(t.length * 0.7)
    for (let i = 0; i + need <= t.length; i++) {
      if (text.includes(t.slice(i, i + need))) return true
    }
    return false
  }
  const hitList = terms.filter(hitOf)
  const hit = hitList.length
  const coverage = terms.length ? hit / terms.length : 0
  const coverageScore = Math.min(1, coverage / 0.55)   // 覆盖 55% 视为满分要点

  // 3) 结构分：分条/分点标记（支持 1. / 一、 / （一） / - • 及行内紧跟序号）
  const bullets = (text.match(/(?:^|\n|。|；)\s*(?:\d+[.、)]|[一二三四五六七八九十]+[、.]|[（(][一二三四五六七八九十\d]+[）)]|[-•*])/g) || []).length
  const hasStructure = bullets >= 4 ? 1 : bullets >= 2 ? 0.85 : bullets >= 1 ? 0.7 : 0.45
  const paragraphs = text.split(/\n{2,}/).filter(Boolean).length
  const structScore = Math.min(1, hasStructure * 0.7 + Math.min(1, paragraphs / 3) * 0.3)

  // 4) 语言分：口语词/空话惩罚
  const badWords = ['我觉得', '我觉得吧', '反正', '大概吧', '不知道', '随便']
  const badHits = badWords.filter(w => text.includes(w)).length
  const langScore = Math.max(0.4, 1 - badHits * 0.15)

  const W = { coverage: 0.5, structure: 0.2, length: 0.15, language: 0.15 }
  const total = (W.coverage * coverageScore + W.structure * structScore + W.length * lengthScore + W.language * langScore)
  const score = Math.round(total * scoreMax * 10) / 10

  const missingTerms = terms.filter(t => !hitOf(t)).slice(0, 10)
  const feedback: any[] = []
  if (chars < 80) feedback.push('字数过少，申论作答需成段论述')
  else if (limit && chars > limit * 1.15) feedback.push(`超出字数限制（${chars}/${limit}），考场上会被扣分`)
  else if (limit && chars < limit * 0.5) feedback.push(`字数偏少（${chars}/${limit}），要点覆盖不足`)
  if (coverage < 0.35) feedback.push('要点覆盖偏低，建议对照参考答案补齐遗漏采分点')
  else if (coverage < 0.55) feedback.push('要点覆盖中等，可再补充 2-3 个关键点')
  if (structScore < 0.7) feedback.push('结构松散，建议用「一、二、三」或「1. 2. 3.」分条作答')
  if (badHits) feedback.push('存在口语化表达，申论需用规范书面语')
  if (!feedback.length) feedback.push('整体达标：要点较全、结构清晰、字数合规')

  return {
    score, max: scoreMax, chars, limit,
    dims: {
      coverage: +(coverageScore * 100).toFixed(0),
      structure: +(structScore * 100).toFixed(0),
      length: +(lengthScore * 100).toFixed(0),
      language: +(langScore * 100).toFixed(0),
    },
    hitTerms: hitList.slice(0, 12),
    missingTerms, feedback,
    referenceAvailable: !!ref,
  }
}

/**
 * 申论大作文专项评估（T-017）：字数分档 + 结构要素 + 论点识别。
 * 与 gradeEssay 的要点覆盖互补——大作文无标准采分点，重结构与论证。
 * @param text 作答全文
 * @param requirement 作答要求（用于抽字数限制）
 */
export function gradeEssayArticle(text, requirement) {
  const t = String(text || '')
  const chars = t.replace(/\s/g, '').length
  const limitM = String(requirement || '').match(/(\d{3,4})\s*字/)
  const limit = limitM ? +limitM[1] : 1000

  // 字数分档（真实考场：不足扣 3-5 分，超标扣 1-2 分）
  const ratio = chars / limit
  let lengthBand = '合格'
  let lengthPenalty = 0
  if (ratio < 0.6) { lengthBand = '严重不足'; lengthPenalty = 5 }
  else if (ratio < 0.85) { lengthBand = '偏少'; lengthPenalty = 3 }
  else if (ratio <= 1.05) { lengthBand = '合格'; lengthPenalty = 0 }
  else if (ratio <= 1.2) { lengthBand = '略超'; lengthPenalty = 1 }
  else { lengthBand = '明显超标'; lengthPenalty = 2 }

  // 结构要素：总-分-总
  const paras = t.split(/\n+/).filter(x => x.trim().length > 10)
  const firstPara = (paras[0] || '').trim()
  const hasOpening = /^(当前|近年来|随着|我国|在|从)/.test(firstPara) || firstPara.length > 60
  const subPoints = (t.match(/(?:^|\n|。)\s*(?:[一二三四五六七八九十]+[、.]|\d+[.、]|首先|其次|再次|最后|一方面|另一方面)/g) || []).length
  const hasEnding = /(总之|综上|因此|归根结底|唯有|让我们)/.test(t.slice(-400))
  const structScore = (hasOpening ? 0.3 : 0) + (Math.min(1, subPoints / 3) * 0.45) + (hasEnding ? 0.25 : 0)

  // 论点识别
  const argMarkers = (t.match(/(因为|由于|因此|所以|例如|比如|可见|说明|表明|意味着|关键在于)/g) || []).length
  const argScore = Math.min(1, argMarkers / 8)

  // 语言
  const badWords = ['我觉得', '反正', '大概吧', '不知道', '随便', '挺好的', '啥']
  const badHits = badWords.filter(w => t.includes(w)).length
  const longSentences = (t.match(/[^。！？]{40,}[。！？]/g) || []).length
  const langScore = Math.max(0.35, 1 - badHits * 0.18) * (longSentences >= 3 ? 1 : 0.8)

  const W = { structure: 0.4, argument: 0.3, language: 0.3 }
  const base = W.structure * structScore + W.argument * argScore + W.language * langScore
  const max = 40
  const score = Math.max(0, Math.round(base * max * 10) / 10)

  const feedback: any[] = []
  if (lengthBand !== '合格') feedback.push('字数' + lengthBand + '（' + chars + '/' + limit + '），考场按档约扣 ' + lengthPenalty + ' 分')
  if (!hasOpening) feedback.push('开头缺少背景引入或观点亮明')
  if (subPoints < 3) feedback.push('分论点仅 ' + subPoints + ' 个，建议 3 个支撑主论点')
  if (!hasEnding) feedback.push('结尾缺少总结升华')
  if (argScore < 0.5) feedback.push('论证偏弱，多用「因为/例如/可见」展开理由与事例')
  if (badHits) feedback.push('存在口语化表达，需改书面语')
  if (!feedback.length) feedback.push('结构完整、论证充分、语言规范')

  return {
    score, max, chars, limit, lengthBand, lengthPenalty,
    dims: { structure: Math.round(structScore * 100), argument: Math.round(argScore * 100), language: Math.round(langScore * 100) },
    elements: { hasOpening, subPoints, hasEnding, argMarkers, longSentences },
    feedback,
  }
}
