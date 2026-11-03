/**
 * server/srs.js — 错题本 SRS 五箱调度域（v1.3 复杂度拆分自 http.js）
 *
 * 数据模型（per-ws progress.wrongBook[]）：
 *   sig=sha1(module|stem前120字) 去重 · box∈[1,5]（答错降箱/答对升箱）
 *   mastered = box≥3 且 consecutive≥2 · 容量 300 环形（先淘汰已掌握再淘汰最旧）
 * 出题策略：未掌握错题按 lastAt 升序（最久未复习）优先回炉；
 *           无错题时按模块弱点加权随机，权重 1/(rate+0.15)（越弱越密）。
 */
import { createHash } from 'node:crypto'
import { XINGCE_MODULES, getRandomQuestions } from '../adapters/repoData.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

function questionSig(q) {
  return createHash('sha1').update((q.module || '') + '|' + (q.stem || '').slice(0, 120)).digest('hex').slice(0, 12)
}
function upsertWrong(progress, q) {
  progress.wrongBook = progress.wrongBook || []
  const sig = questionSig(q)
  let item = progress.wrongBook.find(w => w.sig === sig)
  if (!item) {
    item = { sig, module: q.module || '未知', type: q.type || '', stem: q.stem, options: q.options, correctAnswer: q.correctAnswer, analysis: q.analysis, wrongCount: 0, box: 1, consecutive: 0, mastered: false, lastAt: Date.now() }
    progress.wrongBook.push(item)
  }
  item.wrongCount++
  item.box = Math.max(1, item.box - 1)   // 答错降箱：复习间隔缩短
  item.consecutive = 0
  item.mastered = false
  item.lastAt = Date.now()
  if (progress.wrongBook.length > 300) { // 容量环形：先淘汰已掌握，再淘汰最旧
    const i = progress.wrongBook.findIndex(w => w.mastered)
    progress.wrongBook.splice(i >= 0 ? i : 0, 1)
  }
  return sig
}
function resolveRetry(progress, q) {
  const sig = questionSig(q)
  const item = (progress.wrongBook || []).find(w => w.sig === sig)
  if (!item) return null
  item.consecutive++
  item.box = Math.min(5, item.box + 1)   // 答对升箱：间隔拉长
  if (item.box >= 3 && item.consecutive >= 2) item.mastered = true  // 掌握判定
  item.lastAt = Date.now()
  return item
}

/** 路由：/api/questions(sort=srs) /api/wrong /api/wrong/remove /api/stats；未命中返回 undefined */
export function makeSrsApi({ repoRoot, store }) {
  const { loadProgress, saveProgress } = store

  function srsQuestions(wsRaw, moduleName, count) {
    const p = loadProgress(wsRaw)
    const due = (p.wrongBook || []).filter(w => !w.mastered && (!moduleName || moduleName === 'all' || w.module === moduleName))
      .sort((a, b) => a.lastAt - b.lastAt).slice(0, count)
    if (due.length) {
      return { file: '(错题回炉)', count: due.length, srs: true, mode: 'retry',
        questions: due.map(w => ({ id: 'wrong-' + w.sig, number: 0, type: w.type, module: w.module, stem: w.stem, options: w.options, correctAnswer: w.correctAnswer, analysis: w.analysis, fromWrongBook: true, sig: w.sig, box: w.box, wrongCount: w.wrongCount })) }
    }
    let mod = moduleName
    if (!mod || mod === 'all') {
      const mods = Object.keys(XINGCE_MODULES)
      const weights = mods.map(m => {
        const s = (p.byModule || {})[m]
        const rate = s && s.answered ? s.correct / s.answered : 0.5
        return 1 / (rate + 0.15)
      })
      const total = weights.reduce((a, b) => a + b, 0)
      let r = Math.random() * total
      mod = mods[0]
      for (let i = 0; i < mods.length; i++) { r -= weights[i]; if (r <= 0) { mod = mods[i]; break } }
    }
    const picked: any = getRandomQuestions(repoRoot, mod, count)
    if (picked.questions) { picked.srs = true; picked.mode = 'weighted'; picked.weightedModule = mod }
    return picked
  }

  function statsSnapshot(wsRaw) {
    const p = loadProgress(wsRaw)
    const byDay: any = {}
    for (const h of p.history || []) {
      const d = (byDay[h.date] = byDay[h.date] || { answered: 0, correct: 0 })
      d.answered++
      if (h.isCorrect) d.correct++
    }
    const days = entries(byDay).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14)
      .map(([date, v]) => ({ date, ...v, rate: v.answered ? Math.round(v.correct / v.answered * 100) : 0 }))
    const localDay = (dt) => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    const set = new Set(Object.keys(byDay))
    let streak = 0
    const cur = new Date()
    if (!set.has(localDay(cur))) cur.setDate(cur.getDate() - 1) // 今天没学不打断昨天前的连击
    for (; streak < 60;) { if (!set.has(localDay(cur))) break; streak++; cur.setDate(cur.getDate() - 1) }
    const mastery: any = {}
    for (const [m, s] of entries(p.byModule || {})) {
      const rate = s.answered ? s.correct / s.answered : 0
      const confidence = Math.min(1, s.answered / 20)  // 20 题满置信（贝叶斯收缩简化）
      mastery[m] = { rate: Math.round(rate * 100), confidence: +confidence.toFixed(2), mastery: Math.round(rate * confidence * 100), answered: s.answered }
    }
    const wb = p.wrongBook || []
    return { days, streak, mastery, wrong: { open: wb.filter(w => !w.mastered).length, mastered: wb.filter(w => w.mastered).length, total: wb.length }, day: p.day, answered: p.answered, correct: p.correct, rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 }
  }

  return function handleSrsApi(path, params, post, method, wsRaw) {
    if (path === '/api/questions' && method === 'GET' && params.get('sort') === 'srs') {
      return srsQuestions(wsRaw, params.get('module') || 'all', parseInt(params.get('count') || params.get('limit') || '1'))
    }
    if (path === '/api/wrong' && method === 'GET') {
      const p = loadProgress(wsRaw)
      const wb = [...(p.wrongBook || [])].sort((a, b) => (a.mastered - b.mastered) || (a.lastAt - b.lastAt))
      const mod = params.get('module')
      return { wrong: (mod && mod !== 'all' ? wb.filter(w => w.module === mod) : wb), summary: { open: wb.filter(w => !w.mastered).length, mastered: wb.filter(w => w.mastered).length } }
    }
    if (path === '/api/wrong/remove' && method === 'POST') {
      const p = loadProgress(wsRaw)
      const before = (p.wrongBook || []).length
      p.wrongBook = (p.wrongBook || []).filter(w => w.sig !== post.sig)
      saveProgress(wsRaw, p)
      return { removed: before - p.wrongBook.length, remaining: p.wrongBook.length }
    }
    if (path === '/api/stats') return statsSnapshot(wsRaw)
    return undefined
  }
  // 判分链路的错题收集/回炉钩子（http.js check 路由消费）
}

/** 判分钩子：答错收集 / 错题回炉升箱（http.js 与 srs 域的唯一耦合点） */
export const srsHooks = { upsertWrong, resolveRetry, questionSig }
