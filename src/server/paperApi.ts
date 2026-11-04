/**
 * server/paperApi.js — 真题卷 / 专题 / 申论评改 域（v1.6）
 *
 * 端点：
 *   GET  /api/papers?subject=&exam=&year=&province=&q=  试卷列表（含聚合维度；
 *              cycle-13 新增 province 过滤：省考卷=省级目录名、国考卷=「全国」；
 *              响应含 provinces facet：[{ name, total, minYear, maxYear, subjects }]）
 *   GET  /api/paper?id=<paperId>               单卷详情（材料+题目+参考答案）
 *   GET  /api/topics                           专题（科目级 + 申论题型）
 *   POST /api/essay/grade  {questionId|question, answer}  申论离线评分
 *   GET  /api/essay/list?type=                 申论题目列表（跨卷聚合，供专题练习）
 */
import { buildPaperIndex, loadPaper, buildTopics, listPapers, gradeEssay, gradeEssayArticle } from '../adapters/paperData.js'
import { buildTopicTree } from './topicTree.js'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, resolve, extname, dirname, sep } from 'node:path'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

const PAPER_REPO = 'gwy-zhenti'
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

/**
 * 图片服务：把试卷内相对引用 assets-xxx/hash.png 映射到磁盘真实文件。
 * 关键：paperId 形如「国考/2008/行测-统考」= 目录路径 + 文件名（无 .md），
 * 图片与 md 同级，故基准目录是 dirname(paperId)，不是 paperId 自身。
 * 安全：resolve 后必须仍在 gwy-zhenti 内（防路径穿越）；只服务白名单扩展名。
 */
function servePaperImage(repoRoot, paperId, relPath, res) {
  const root = resolve(repoRoot, PAPER_REPO)
  const paperDir = resolve(root, dirname(paperId))
  const target = resolve(paperDir, relPath)
  const rootPrefix = root + sep
  if (!(target === root || target.startsWith(rootPrefix))) {
    res.writeHead(403); res.end('forbidden'); return
  }
  const ext = extname(target).toLowerCase()
  if (!MIME[ext]) { res.writeHead(415); res.end('unsupported'); return }
  let stat
  try {
    stat = existsSync(target) ? statSync(target) : null
  } catch { stat = null }
  if (!stat || !stat.isFile()) { res.writeHead(404); res.end('not found'); return }
  // 头一旦发出，后续任何异常都不能再 writeHead（会二次写头破坏响应）
  try {
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' })
  } catch {
    try { res.destroy() } catch {}
    return
  }
  const stream = createReadStream(target)
  stream.on('error', () => { try { res.destroy() } catch {} })
  stream.pipe(res)
}

/**
 * 把题目/材料里的 markdown 图片引用改写成可访问 URL。
 * `![](assets-229/x.png)` → `![](<mount>/api/paper-img?id=<paperId>&p=assets-229/x.png)`
 */
function rewriteImages(text, paperId, mountPath) {
  if (!text) return text
  return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, src) => {
    if (/^https?:\/\//i.test(src)) return full
    const encoded = encodeURIComponent(src)
    return `![${alt}](${mountPath}/api/paper-img?id=${encodeURIComponent(paperId)}&p=${encoded})`
  })
}

export function makePaperApi({ repoRoot, store, mountPath = '/kaogong' }) {
  const { loadProgress, saveProgress } = store

  /** 图片端点（二进制，由 HTTP 层在 JSON 链路之前分流调用） */
  function serveImage(params, res) {
    // URLSearchParams 对已编码的 %2F 不二次解码，这里显式解码一次（try 保护幂等）
    const dec = (v) => { try { return decodeURIComponent(v || '') } catch { return v || '' } }
    const id = dec(params.get('id'))
    const p = dec(params.get('p'))
    if (!id || !p) { try { res.writeHead(400); res.end('bad request') } catch {} ; return }
    servePaperImage(repoRoot, id, p, res)
  }

  function handlePaperApi(path, params, post, method, wsRaw) {
    // 试卷列表（cycle-13：新增 province 省份过滤；响应透出 provinces facet 与 subjects 并列）
    if (path === '/api/papers' && method === 'GET') {
      const list = listPapers(repoRoot, {
        subject: params.get('subject') || undefined,
        exam: params.get('exam') || undefined,
        year: params.get('year') || undefined,
        province: params.get('province') || undefined,
        q: params.get('q') || undefined,
      })
      const idx = buildPaperIndex(repoRoot)
      // provinces facet 由索引 v2（schemaVersion: 2）内置；旧快照重建期间兜底空数组
      return { ...list, subjects: idx.subjects, provinces: idx.provinces || [], builtAt: idx.builtAt }
    }

    // 单卷详情
    if (path === '/api/paper' && method === 'GET') {
      const id = params.get('id') || ''
      if (!id) return { error: '缺少 id 参数' }
      const paper = loadPaper(repoRoot, id)
      if (!paper.error) {
        // 图片引用改写为可直接访问的 URL（T-018）
        for (const m of paper.materials || []) m.text = rewriteImages(m.text, id, mountPath)
        for (const q of paper.questions || []) {
          q.stem = rewriteImages(q.stem, id, mountPath)
          q.reference = rewriteImages(q.reference, id, mountPath)
        }
      }
      return paper
    }

    // 专题（v1.7.1：行测/申论分频道 + 每专题带练习入口）
    if (path === '/api/topics' && method === 'GET') {
      const tree = buildTopicTree(repoRoot)
      return { ...tree, ...buildTopics(repoRoot) }  // 兼容旧字段 topics/subjects
    }

    // 申论题目聚合列表（按题型筛选，供专题练习）
    if (path === '/api/essay/list' && method === 'GET') {
      const wantType = params.get('type') || ''
      const limit = Math.min(60, parseInt(params.get('limit') || '20'))
      const idx = buildPaperIndex(repoRoot)
      const essays = idx.papers.filter(p => p.subject === '申论').sort((a, b) => (b.year || 0) - (a.year || 0))
      const typeKw = {
        '概括': /概括|概述|归纳|梳理/,
        '分析': /分析|评析|谈谈|理解|解释/,
        '对策': /对策|建议|措施|怎么办|提出/,
        '应用文': /公开信|倡议书|讲话稿|汇报|短评|建议书|宣传/,
        '大作文': /文章|议论文|自拟标题|联系实际/,
      }
      const out: any[] = []
      for (const paper of essays) {
        if (out.length >= limit) break
        const detail = loadPaper(repoRoot, paper.id)
        if (detail.error) continue
        for (const q of detail.questions || []) {
          if (out.length >= limit) break
          if (wantType && typeKw[wantType] && !typeKw[wantType].test(q.stem + q.requirement)) continue
          out.push({
            paperId: paper.id, exam: paper.exam, year: paper.year, paperType: paper.paperType,
            no: q.no, stem: q.stem, score: q.score, requirement: q.requirement,
            relatedMaterials: q.relatedMaterials, hasReference: !!q.reference,
          })
        }
      }
      return { total: out.length, questions: out, type: wantType || 'all' }
    }

    // 申论离线评分
    if (path === '/api/essay/grade' && method === 'POST') {
      let question = post.question
      // 也支持只传 paperId + no 由服务端取题（防客户端伪造参考答案）
      if (!question && post.paperId) {
        const paper = loadPaper(repoRoot, post.paperId)
        if (paper.error) return paper
        question = (paper.questions || []).find(q => q.no === +post.no)
      }
      if (!question) return { error: '缺少题目（question 或 paperId+no）' }
      const answer = String(post.answer || '')
      if (!answer.trim()) return { error: '作答内容为空' }
      const result = gradeEssay(question, answer)

      // 落进度：essayRecords（供趋势与历史）
      const progress = loadProgress(wsRaw)
      progress.essayRecords = progress.essayRecords || []
      progress.essayRecords.push({
        ts: Date.now(),
        paperId: post.paperId || null,
        no: post.no || null,
        chars: result.chars,
        score: result.score,
        max: result.max,
        ratio: result.max ? +(result.score / result.max).toFixed(3) : 0,
      })
      if (progress.essayRecords.length > 200) progress.essayRecords = progress.essayRecords.slice(-200)
      saveProgress(wsRaw, progress)
      return { ...result, progress: { essays: progress.essayRecords.length } }
    }

    // 申论历史
    if (path === '/api/essay/history' && method === 'GET') {
      const p = loadProgress(wsRaw)
      const recs = (p.essayRecords || []).slice(-50).reverse()
      const avg = recs.length ? +(recs.reduce((s, r) => s + (r.ratio || 0), 0) / recs.length * 100).toFixed(1) : 0
      return { total: (p.essayRecords || []).length, recent: recs, avgRatio: avg }
    }

    // T-017 大作文专项评估（字数分档 + 结构 + 论证）
    if (path === '/api/essay/article' && method === 'POST') {
      let question = post.question
      if (!question && post.paperId) {
        const paper = loadPaper(repoRoot, post.paperId)
        if (paper.error) return paper
        question = (paper.questions || []).find(q => q.no === +post.no)
      }
      const answer = String(post.answer || '')
      if (!answer.trim()) return { error: '作答内容为空' }
      const result = gradeEssayArticle(answer, (question && question.requirement) || post.requirement || '')
      const progress = loadProgress(wsRaw)
      progress.essayRecords = progress.essayRecords || []
      progress.essayRecords.push({
        ts: Date.now(), paperId: post.paperId || null, no: post.no || null,
        chars: result.chars, score: result.score, max: result.max,
        ratio: result.max ? +(result.score / result.max).toFixed(3) : 0, mode: 'article',
      })
      if (progress.essayRecords.length > 200) progress.essayRecords = progress.essayRecords.slice(-200)
      saveProgress(wsRaw, progress)
      return { ...result, progress: { essays: progress.essayRecords.length } }
    }

    // ── T-016 整卷模考 ──
    // 开始模考：返回整卷题目（剥离参考答案，防作弊）+ 计时预算
    if (path === '/api/paper/exam/start' && method === 'GET') {
      const id = params.get('id') || ''
      const paper = loadPaper(repoRoot, id)
      if (paper.error) return paper
      const qs = (paper.questions || []).map(q => ({
        no: q.no, stem: rewriteImages(q.stem, id, mountPath), score: q.score,
        options: q.options || {},
        // 答案与解析绝不下发（防作弊）：交卷时服务端自行比对后回传
      }))
      const totalScore = qs.reduce((s, q) => s + (q.score || 0), 0) || qs.length
      return {
        id, exam: paper.exam, year: paper.year, subject: paper.subject, paperType: paper.paperType,
        questionCount: qs.length, totalScore,
        // 行测默认 120 分钟；申论 150 分钟（真实考场时长）
        durationSec: paper.subject === '申论' ? 9000 : 7200,
        questions: qs,
        startedAt: new Date().toISOString(),
      }
    }

    // 交卷：按模块统计得分（行测按题型，申论按题目）
    if (path === '/api/paper/exam/submit' && method === 'POST') {
      const id = post.id || ''
      const answers = post.answers || {}    // { no: 'A' }
      const elapsedSec = Math.max(0, parseInt(post.elapsedSec || '0'))
      const paper = loadPaper(repoRoot, id)
      if (paper.error) return paper

      const byType: any = {}
      let correct = 0, answered = 0, scored = 0, totalScore = 0
      const detail: any[] = []
      for (const q of paper.questions || []) {
        const mine = String(answers[q.no] || '').toUpperCase().trim()
        const right = String(q.correctAnswer || '').toUpperCase().trim()
        const isCorrect = !!right && mine === right
        const type = q.type || (paper.subject === '申论' ? '申论' : '未分类')
        totalScore += q.score || 0
        if (mine) answered++
        if (isCorrect) { correct++; scored += q.score || 0 }
        const bt = (byType[type] = byType[type] || { total: 0, correct: 0, answered: 0, score: 0 })
        bt.total++; bt.answered++
        if (isCorrect) { bt.correct++; bt.score += q.score || 0 }
        detail.push({ no: q.no, type, mine: mine || null, right: right || null, isCorrect, score: q.score || 0 })
      }
      const acc = answered ? Math.round(correct / answered * 100) : 0
      const modules = entries(byType).map(([t, v]) => ({
        type: t, total: v.total, answered: v.answered, correct: v.correct,
        rate: v.answered ? Math.round(v.correct / v.answered * 100) : 0, score: v.score,
      })).sort((a, b) => a.rate - b.rate)

      // 落进度：模考记录（供趋势）
      const progress = loadProgress(wsRaw)
      progress.examRecords = progress.examRecords || []
      progress.examRecords.push({
        ts: Date.now(), paperId: id, subject: paper.subject, year: paper.year,
        answered, correct, rate: acc, scored, totalScore, elapsedSec,
      })
      if (progress.examRecords.length > 100) progress.examRecords = progress.examRecords.slice(-100)
      saveProgress(wsRaw, progress)

      return {
        id, subject: paper.subject, year: paper.year,
        answered, correct, rate: acc, scored, totalScore,
        elapsedSec, durationSec: paper.subject === '申论' ? 9000 : 7200,
        modules, detail,
      }
    }

    // 模考历史
    if (path === '/api/paper/exam/history' && method === 'GET') {
      const p = loadProgress(wsRaw)
      const recs = (p.examRecords || []).slice(-20).reverse()
      const avg = recs.length ? Math.round(recs.reduce((s, r) => s + (r.rate || 0), 0) / recs.length) : 0
      return { total: (p.examRecords || []).length, recent: recs, avgRate: avg }
    }

    return undefined
  }

  return { handle: handlePaperApi, serveImage }
}
