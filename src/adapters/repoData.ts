/**
 * adapters/repoData.js — 外部数据源适配层（文件系统隔离）
 *
 * 架构约束：宿主/服务端只消费本适配器的导出，不直接触碰 REPO_ROOT 路径细节。
 * 全部只读；15 个开源仓库 = 唯一外部数据源。零依赖。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

export const REPOS = {
  huasheng13:             '花生十三体系方法论 25 篇（六模块技巧库，方法论视图主数据源）',
  xingcezhenti:           '515套卷58890题行测真题库（按模块分目录，配图本地化）',
  kaogongzhentizhengliu:  '22375篇考点重组深度标注笔记（推理链/最快解法/易错点）',
  GongkaoNaoku:           'SM-2间隔重复刷题引擎（27506题去重，Python零依赖）',
  AdministrativeAptitudeTest: '近二十年国考省考选调生试卷PDF（可打印模考）',
  NovaForge:              '通用笔记模板（LaTeX/Typst/Markdown，含考公模式）',
  'kaogong-skill':        '考公AI技能包（出题/讲解/批改/复盘规则化）',
  sakib:                  '公考知识文档库（公基/判断/数量/申论/言语/资料）',
  developer2gwy:          '程序员上岸公考实践指南（策略/复盘/选岗）',
  'gwy-zhenti':           '国考省考行测申论图文真题库（Markdown可读）',
  Exam_Database:          '多渠道考公素材行测申论真题题库',
  'qiuzhao-epi-bank':     '秋招行测/银行EPI刷题网站（697题PWA离线）',
  'xingce-app':           '离线行测刷题App（22298题Android）',
  'gk-tuxing':            '图形推理真题库354道（逐题解析+技巧点拨）',
  'civil-exam-agent':     '公考督导智能体系统（AI私教+督学平台）',
  yunduanqiqu:            '公考资料免费分享（申论范文/面试真题/素材）',
}

export const XINGCE_MODULES = {
  '政治理论': '01-政治理论',
  '常识判断': '02-常识判断',
  '言语理解与表达': '03-言语理解与表达',
  '数量关系': '04-数量关系',
  '判断推理': '05-判断推理',
  '资料分析': '06-资料分析',
}

export const METHOD_MAP = { '行测': 'xingce.md', '申论': 'shenlun.md', '职测': 'zhice.md', '综应': 'zongying.md', '公基': 'gongji.md', '公文': 'gongwen.md', '面试': 'mianshi.md', '时政': 'shizheng.md', '报考': 'baokao.md', '复盘': 'review.md' }

export function safeReadFile(f, max = 8000) {
  try { const c = readFileSync(f, 'utf-8'); return c.length > max ? c.slice(0, max) + '\n... (已截断)' : c }
  catch { return null }
}
export function exists(p) { try { return existsSync(p) } catch { return false } }
export function safeReadDir(d) { try { return readdirSync(d) } catch { return [] } }

/** 题块解析（CRLF 归一 + 中文 frontmatter + h2/h3 双级题号，历史踩坑固化） */
export function parseQuestions(filePath, maxQ = 20) {
  const raw = safeReadFile(filePath, 200000)
  if (!raw) return []
  const content = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  const meta: any = {}
  if (fmMatch) for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^([^:]+):\s*"?(.*?)"?\s*$/)
    if (m) meta[m[1].trim()] = m[2]
  }
  // cycle-21（issue #1 用户旅程实证）：资料分析等题「根据上图」的图在**材料块**里
  // （`## 材料 N` 段，全库 1479 个含图材料块），不在题块内。材料图归属用
  // matImgTable（offset → 图片列表）在题块循环里按「最近前置材料段」附给题干。
  const blocks = content.split(/\n#{2,3}\s*第\s*(\d+)\s*题/)
  // cycle-21：每个题块前的原文偏移 → 用于「该题前面最近的有图材料段」归属
  // split 带捕获组时 blocks[i] 与 blocks[i+1] 配对；偏移需在 split 前算好（这里用逐块 index 推算）
  const qOffsets: number[] = []
  {
    const re = /\n#{2,3}\s*第\s*(\d+)\s*题/g
    let om: RegExpExecArray | null
    while ((om = re.exec(content)) !== null) qOffsets.push(om.index)
  }
  // 有图材料段的位置表（offset → 图片占位数组）
  const matImgTable: Array<{ at: number, imgs: string[] }> = []
  const questions: any[] = []
  // cycle-21（issue #1）：图片占位化。xingcezhenti 卷内图片以 <img src="../90-图片/…"> 引用，
  // 旧实现 `<[^>]+>→''` 直接剥掉 = 判断推理/资料分析题干图与公式图全部丢失（不可作答）。
  // 修复：先把 img 标签转成**中立占位** `kgimg://<相对 xingcezhenti 的路径>`
  // （落盘/存储与端口、挂载点无关；前端 RichText 渲染时才改写为 /api/kg-img?p= 绝对 URL），
  // 再剥其余 HTML 标签。占位文本形态 `【题图】` 由前端渲染层处理，落盘数据保持可读。
  const IMG_PLACEHOLDER_RE = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*\/?>/gi
  const neutralizeImages = (s) => String(s || '')
    .replace(IMG_PLACEHOLDER_RE, (_full, src) => {
      const rel = String(src || '').replace(/\\/g, '/')
      if (!rel || /^https?:/i.test(rel)) return _full                       // 外链原样保留
      // ../90-图片/题目图/x.png → 90-图片/题目图/x.png（相对 xingcezhenti 的规范路径）
      const norm = rel.replace(/^(\.\.\/)+/, '')
      return `【图:kgimg://${norm}】`
    })
  const stripHtmlKeepImg = (s) => neutralizeImages(s).replace(/<[^>]+>/g, '').trim()
  // cycle-26 D-1b：材料段正文表（offset → { no, text }）——专题刷题链路的资料分析题组
  // 与真题卷同源（xingcezhenti 卷内 `## 材料 N` 夹在题目流中），材料正文此前从不进题目对象
  const matTextTable: Array<{ at: number, no: number, text: string }> = []
  {
    const mr = /\n##\s*材料([^\n]*)\n([\s\S]*?)(?=\n#{2,3}\s*第\s*\d+\s*题|\n##\s*材料|\n##\s*题目|$)/g
    let em: RegExpExecArray | null
    while ((em = mr.exec(content)) !== null) {
      const head = String(em[1] || '').trim()
      const noM = head.match(/(\d+)/)
      const text = neutralizeImages(em[2]).replace(/<[^>]+>/g, '').trim().slice(0, 20000)
      if (text) matTextTable.push({ at: em.index, no: noM ? +noM[1] : matTextTable.length + 1, text })
      const segImgs: string[] = []
      const ir2 = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*\/?>/gi
      let im2: RegExpExecArray | null
      while ((im2 = ir2.exec(em[1])) !== null) {
        const rel = String(im2[1] || '').replace(/\\/g, '/').replace(/^(\.\.\/)+/, '')
        if (rel && !/^https?:/i.test(rel)) segImgs.push(rel)
      }
      if (segImgs.length) matImgTable.push({ at: em.index, imgs: segImgs })
    }
  }
  for (let i = 1; i < blocks.length && questions.length < maxQ; i += 2) {
    const qNum = parseInt(blocks[i])
    const block = blocks[i + 1] || ''
    const typeMatch = block.match(/<sub>qid\s*\d+\s*[·・]\s*(.+?)<\/sub>/)
    const qType = typeMatch ? typeMatch[1].trim() : '未知'
    // cycle-21：材料图归属——该题块偏移之前「最近的有图材料段」的图，附在题干尾部
    // （语义：资料分析题读图作答；题块自身已有图时材料图放在其后不重复附）
    // cycle-26 D-1b：at 提为循环体作用域（组材料正文归属同用）
    const at = qOffsets[(i - 1) / 2] != null ? qOffsets[(i - 1) / 2] : -1
    let matImgs: string[] = []
    {
      for (const t of matImgTable) { if (t.at < at) matImgs = t.imgs; else break }
    }
    const subEnd = block.indexOf('</sub>')
    const optionsStart = block.search(/\n-\s*\*\*A\*\*/)
    let stem = ''
    if (subEnd >= 0 && optionsStart >= 0) {
      stem = block.slice(subEnd + 6, optionsStart).trim().replace(/<p>/g, '\n').replace(/<\/p>/g, '')
      stem = stripHtmlKeepImg(stem)
    } else if (subEnd < 0 && optionsStart >= 0) {
      stem = stripHtmlKeepImg(block.slice(0, optionsStart))
    }
    const options: any = {}
    const optPattern = /-\s*\*\*([A-D])\*\*\.\s*(.+?)(?:\s*✅)?(?:\n|$)/g
    let m2
    while ((m2 = optPattern.exec(block)) !== null) options[m2[1]] = stripHtmlKeepImg(m2[2])
    let correctAnswer = null
    const am = block.match(/\*\*答案\*\*[：:]\s*([A-D])/)
    if (am) correctAnswer = am[1]
    let analysis = ''
    const anm = block.match(/\*\*官方解析\*\*\n([\s\S]*?)(?:\n---|\n## |\n### |$)/)
    if (anm) analysis = stripHtmlKeepImg(anm[1])
    // cycle-21：题块自身无图且存在前置材料图 → 材料图占位附题干尾（「根据上图」可作答）
    const finalStem = (matImgs.length && !String(stem).includes('kgimg://'))
      ? String(stem) + '\n' + matImgs.map(rel => '【图:kgimg://' + rel + '】').join('\n')
      : stem
    // cycle-26 D-1b：题组材料正文——该题块之前「最近的材料段」文本（资料分析多题共享一段材料；
    // 无前置材料段的题此字段为空串，QwQuestionCard 有则渲染跳段）
    let groupMaterial = ''
    for (const t of matTextTable) { if (t.at < at) groupMaterial = t.text; else break }
    if (finalStem && Object.keys(options).length > 0) {
      // cycle-21：题库出处标注（用户要求「每道题标明出处」）——
      // source=数据库名（xingcezhenti），exam/year/region 已由 frontmatter 提供；
      // paperFile 记卷文件名（去 .md），供 UI「查看原卷」与补录指纹稳定锚定。
      const paperFile = (filePath.split(/[\\/]/).pop() || '').replace(/\.md$/, '')
      questions.push({
        id: `${meta.模块 || '未知'}-${qNum}-${Math.random().toString(36).slice(2, 6)}`,
        number: qNum, type: qType, module: meta.模块 || '未知',
        exam: meta.试卷 || '', region: meta.地区 || '', year: meta.年份 || '',
        source: 'xingcezhenti', paperFile,
        stem: finalStem, options, correctAnswer, analysis,
        groupMaterial,
      })
    }
  }
  return questions
}

/** 抽题：随机文件 + 无放回下标采样（Set 去重，O(count)） */
export function getRandomQuestions(repoRoot, moduleName, count = 1) {
  const dirName = XINGCE_MODULES[moduleName]
  if (!dirName) return { error: `未知模块。可用: ${Object.keys(XINGCE_MODULES).join(', ')}` }
  const modulePath = join(repoRoot, 'xingcezhenti', dirName)
  const files = safeReadDir(modulePath).filter(f => f.endsWith('.md'))
  if (files.length === 0) return { error: `模块 ${moduleName} 无题文件` }
  const randomFile = files[Math.floor(Math.random() * files.length)]
  const questions = parseQuestions(join(modulePath, randomFile), 30)
  if (questions.length === 0) return { error: `文件中未解析到题目: ${randomFile}` }
  const selected: any[] = []
  const used = new Set()
  for (let i = 0; i < count && i < questions.length; i++) {
    let idx
    do { idx = Math.floor(Math.random() * questions.length) } while (used.has(idx) && used.size < questions.length)
    used.add(idx)
    selected.push(questions[idx])
  }
  return { file: randomFile, count: selected.length, questions: selected }
}

/** 全文检索：DFS 限深(3) + 命中上限(15) 早停 */
export function searchKnowledge(repoRoot, query, repoKey) {
  const searchRepos = repoKey ? [repoKey] : ['sakib', 'kaogong-skill', 'developer2gwy']
  const results: any[] = []
  const qLower = (query || '').toLowerCase()
  if (!qLower) return results
  for (const key of searchRepos) {
    if (!exists(join(repoRoot, key))) continue
    function walk(dir, depth) {
      if (depth > 3 || results.length >= 15) return
      for (const item of safeReadDir(dir)) {
        if (item.startsWith('.git') || item === 'node_modules') continue
        const full = join(dir, item)
        try {
          const st = statSync(full)
          if (st.isDirectory()) { walk(full, depth + 1); continue }
          if (!item.endsWith('.md') && !item.endsWith('.txt')) continue
          const c = safeReadFile(full, 5000)
          if (c && c.toLowerCase().includes(qLower)) {
            const lines = c.split('\n')
            const snippets: any[] = []
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(qLower)) snippets.push(lines.slice(Math.max(0, i - 1), i + 2).join('\n'))
            }
            results.push({ file: full.replace(repoRoot + '\\', '').replace(repoRoot + '/', ''), snippet: snippets.slice(0, 2).join('\n---\n') })
            if (results.length >= 15) return
          }
        } catch {}
      }
    }
    walk(join(repoRoot, key), 0)
  }
  return results
}

export function getMethodRef(repoRoot, topic) {
  const fileName = METHOD_MAP[topic] || METHOD_MAP[(topic || '').slice(0, 2)]
  if (!fileName) return { error: `未知主题。可用: ${Object.keys(METHOD_MAP).join(', ')}` }
  const content = safeReadFile(join(repoRoot, 'kaogong-skill', 'skills', 'kaogong', 'references', fileName), 20000)
  return { topic, file: fileName, content: content || '参考文件未找到' }
}

/** 学习计划结构化：4阶段/30天/每日任务（正则状态机单遍 O(n)） */
export function parsePlanStructure(content) {
  const lines = content.split('\n')
  const phases: any[] = []
  const days: any[] = []
  let currentPhase = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const phM = line.match(/^##\s*(第[一二三四五]阶段[:：]\s*[^（(]+)[（(]第(\d+)-(\d+)天[）)]/)
    if (phM) {
      currentPhase = { name: phM[1].trim(), startDay: +phM[2], endDay: +phM[3] }
      phases.push(currentPhase)
      continue
    }
    const dayM = line.match(/^###\s*第(\d+)天\s*[—\-–]\s*(.+)/)
    if (dayM) {
      const tasks: any[] = []
      for (let j = i + 1; j < lines.length && tasks.length < 6; j++) {
        if (/^#{2,3}\s/.test(lines[j])) break
        const t = lines[j].match(/^[-*]\s*(.+)/)
        if (t) tasks.push(t[1].slice(0, 80))
      }
      days.push({ day: +dayM[1], title: dayM[2].trim(), phase: currentPhase?.name || '', tasks })
    }
  }
  return { phases, days }
}

export function repoStats(repoRoot) {
  let ready = 0
  for (const key of Object.keys(REPOS)) if (exists(join(repoRoot, key))) ready++
  return { ready, total: Object.keys(REPOS).length }
}
