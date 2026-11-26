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
// cycle-50 内核收敛：弱点权重公式走 shared/kernel 单一事实源
import { moduleWeakness, weightedPickIndex } from '../shared/kernel.js'
// v9：统一错题/补录层（库为权威读源，JSON 为兼容镜像）
import { readWrongBook, wrongSummary, wrongDiagnostics, removeWrongEntry } from './reviewStore.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

function questionSig(q: any) {
  return createHash('sha1').update((q.module || '') + '|' + (q.stem || '').slice(0, 120)).digest('hex').slice(0, 12)
}
function upsertWrong(progress: any, q: any) {
  progress.wrongBook = progress.wrongBook || []
  const sig = questionSig(q)
  let item = progress.wrongBook.find((w: any) => w.sig === sig)
  if (!item) {
    // cycle-21 出处标注：错题入库时快照题库出处（回炉时随题透出，UI 显示来源）
    // cycle-43（材料保真）：快照补 groupMaterial/groupMaterialNo——资料分析题没有材料
    // 不可复现作答语境（回炉重做时「根据材料作答」无从谈起）；字段可选，旧快照缺失降级不报错
    item = { sig, module: q.module || '未知', type: q.type || '', stem: q.stem, options: q.options, correctAnswer: q.correctAnswer, analysis: q.analysis, wrongCount: 0, box: 1, consecutive: 0, mastered: false, lastAt: Date.now(),
      source: q.source || null, exam: q.exam || null, year: q.year || null, paperFile: q.paperFile || null,
      groupMaterial: q.groupMaterial || '', groupMaterialNo: q.groupMaterialNo || 0 }
    progress.wrongBook.push(item)
  }
  item.wrongCount++
  item.box = Math.max(1, item.box - 1)   // 答错降箱：复习间隔缩短
  item.consecutive = 0
  item.mastered = false
  item.lastAt = Date.now()
  if (progress.wrongBook.length > 300) { // 容量环形：先淘汰已掌握，再淘汰最旧
    const i = progress.wrongBook.findIndex((w: any) => w.mastered)
    progress.wrongBook.splice(i >= 0 ? i : 0, 1)
  }
  return sig
}
function resolveRetry(progress: any, q: any) {
  const sig = questionSig(q)
  const item = (progress.wrongBook || []).find((w: any) => w.sig === sig)
  if (!item) return null
  item.consecutive++
  item.box = Math.min(5, item.box + 1)   // 答对升箱：间隔拉长
  if (item.box >= 3 && item.consecutive >= 2) item.mastered = true  // 掌握判定
  item.lastAt = Date.now()
  return item
}

/** 路由：/api/memory(专项刷题记忆,cycle-15) /api/questions(sort=srs) /api/wrong /api/wrong/remove /api/stats；未命中返回 undefined */
export function makeSrsApi({ repoRoot, store, pool, dataCtx }: any) {
  const { loadProgress, saveProgress } = store
  /** v9：数据门上下文（抽题前确保该域已入库） */
  const ctx = (): { repoRoot: string, dataDir: string } => dataCtx || { repoRoot, dataDir: '' }
  /** v9：租户键（错题/补录的库侧主键第一维；与 progress 文件命名同源） */
  const wsKeyOf = (raw: any): string => {
    try { return String(store.wsKey(raw)) } catch { return String(raw || 'default') }
  }

  /* ── cycle-15 专项刷题记忆（progress.memory 域）──
     数据模型：progress.memory[kind] = { …业务字段, at: 时间戳 }
       kind ∈ practice(行测刷题) / tuxing(图形推理) / deep(深度题库) …；
     硬约束：kind 必须匹配 ^[a-z][a-z0-9-]{0,31}$（防键污染/原型链）；
       data 必须是普通对象且 JSON 序列化 ≤ 8KB（题目对象量级，防 progress 文件膨胀）；
       最多 12 个 kind，超出按 at 最旧淘汰（LRU 环形，防历史残留堆积）。
     隔离：走 loadProgress/saveProgress，天然按 ?ws= 命名空间分文件（PROJ_A/B 互不污染）。 */
  function memoryApi(post: any, method: string, wsRaw: any) {
    if (method === 'GET') {
      const p = loadProgress(wsRaw)
      return { memory: p.memory && typeof p.memory === 'object' ? p.memory : {} }
    }
    // POST：kind 校验 + data 形状/体积校验，任何违规都返回 {error} 且 HTTP 200（与图查询端点同口径）
    const kind = String((post && post.kind) || '')
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(kind)) return { error: 'kind 需匹配 ^[a-z][a-z0-9-]{0,31}$' }
    const data = (post && post.data && typeof post.data === 'object' && !Array.isArray(post.data)) ? post.data : null
    if (!data) return { error: '缺少 data 对象' }
    let size = 0
    try { size = JSON.stringify(data).length } catch { return { error: 'data 不可序列化' } }
    if (size > 8192) return { error: 'data 超过 8KB 上限（当前 ' + size + 'B）' }
    const p = loadProgress(wsRaw)
    p.memory = (p.memory && typeof p.memory === 'object') ? p.memory : {}
    p.memory[kind] = { ...data, at: Date.now() }
    const keys = Object.keys(p.memory)
    if (keys.length > 12) {
      keys.sort((a, b) => ((p.memory[a] && p.memory[a].at) || 0) - ((p.memory[b] && p.memory[b].at) || 0))
      for (const k of keys.slice(0, keys.length - 12)) delete p.memory[k]
    }
    saveProgress(wsRaw, p)
    return { ok: true, kind, memory: p.memory[kind] }
  }

  function srsQuestions(wsRaw: any, moduleName: any, count: any) {
    const p = loadProgress(wsRaw)
    const due = (p.wrongBook || []).filter((w: any) => !w.mastered && (!moduleName || moduleName === 'all' || w.module === moduleName))
      .sort((a: any, b: any) => a.lastAt - b.lastAt).slice(0, count)
    if (due.length) {
      return { file: '(错题回炉)', count: due.length, srs: true, mode: 'retry',
        questions: due.map((w: any) => ({ id: 'wrong-' + w.sig, number: 0, type: w.type, module: w.module, stem: w.stem, options: w.options, correctAnswer: w.correctAnswer, analysis: w.analysis, fromWrongBook: true, sig: w.sig, box: w.box, wrongCount: w.wrongCount,
          // cycle-21 出处标注：错题回炉继承入库时的题库出处（旧数据无 source 时按 module 推断显示）
          source: w.source || null, exam: w.exam || null, year: w.year || null, paperFile: w.paperFile || null,
          // cycle-43 材料保真：回炉透出快照材料（旧快照无此字段 → 空串，QwQuestionCard 有则渲染跳段）
          groupMaterial: w.groupMaterial || '', groupMaterialNo: w.groupMaterialNo || 0 })) }
    }
    let mod = moduleName
    if (!mod || mod === 'all') {
      const mods = Object.keys(XINGCE_MODULES)
      /**
       * v9：弱点加权抽样走内核（`moduleWeakness` + `weightedPickIndex`）。
       * 收敛前这里是手写的「累减随机转盘」，与池抽题的加权选层各写一份——
       * 同一种数学结构（按权重无放回抽样）两处实现，改权重口径必漏一处。
       * 现在只声明业务先验（错题回炉用 0.5 中性，不偏爱新模块），算法在内核。
       */
      const weights = moduleWeakness(mods, p.byModule || {}, 0.5)
      const [idx] = weightedPickIndex(weights, 1)
      mod = idx >= 0 ? mods[idx] : mods[0]
    }
    // cycle-34 阶段 1（I5/KERNEL-05）：存储层优先供数（统一池就绪时不直读第三方 md）
    const picked: any = getRandomQuestions(repoRoot, mod, count, pool)
    if (picked.questions) { picked.srs = true; picked.mode = 'weighted'; picked.weightedModule = mod }
    return picked
  }

  function statsSnapshot(wsRaw: any) {
    const p = loadProgress(wsRaw)
    // cycle-21（issue #3）统计隔离：补录条目（source==='import'）是**历史**练习——
    // 不进「今日新刷/打卡/趋势」（否则整批历史算成今天新刷），只体现在错题本与累计量。
    const online = (h: any) => h && h.source !== 'import'
    const onlineHistory = (p.history || []).filter(online)
    const byDay: any = {}
    for (const h of onlineHistory) {
      const d = (byDay[h.date] = byDay[h.date] || { answered: 0, correct: 0 })
      d.answered++
      if (h.isCorrect) d.correct++
    }
    const days = entries(byDay).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14)
      .map(([date, v]) => ({ date, ...v, rate: v.answered ? Math.round(v.correct / v.answered * 100) : 0 }))
    const localDay = (dt: any) => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
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
    const importedTotal = (p.history || []).length - onlineHistory.length
    return { days, streak, mastery, wrong: { open: wb.filter((w: any) => !w.mastered).length, mastered: wb.filter((w: any) => w.mastered).length, total: wb.length }, day: p.day, answered: p.answered, correct: p.correct, rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0, importedTotal }
  }

  return function handleSrsApi(path: any, params: any, post: any, method: any, wsRaw: any) {
    if (path === '/api/memory' && (method === 'GET' || method === 'POST')) {
      return memoryApi(post, method, wsRaw)
    }
    if (path === '/api/questions' && method === 'GET' && params.get('sort') === 'srs') {
      // v9：SRS 回炉优先（零外源）；无错题时按弱点加权抽题——抽题仍走统一池
      const r = srsQuestions(wsRaw, params.get('module') || 'all', parseInt(params.get('count') || params.get('limit') || '1'))
      // 池为空且无错题回炉 → 返回结构化未就绪（调用方可经 dataGate 摄入，见 handleSrsApiAsync）
      return r
    }
    if (path === '/api/wrong' && method === 'GET') {
      const p = loadProgress(wsRaw)
      /**
       * v9：错题本读路径**库优先**（库是权威，JSON 是兼容镜像）。
       * 收敛前只读 progress.wrongBook → 白盒看到的库行数可能滞后于真实错题本，
       * 「谁是真相」不可判定。现在：库有行 → 用库（带 canonicalId/kadian/lapses 等增强字段）；
       * 库空（从未镜像/新用户）→ 退回 JSON（老数据不丢），并用 tier 标记来源。
       */
      const read = readWrongBook(wsKeyOf(wsRaw), p.wrongBook)
      const mod = params.get('module')
      const filtered = (mod && mod !== 'all' ? read.list.filter((w: any) => w.module === mod) : read.list)
        .slice().sort((a: any, b: any) => (Number(!!a.mastered) - Number(!!b.mastered)) || (a.lastAt - b.lastAt))
      return {
        wrong: filtered,
        summary: wrongSummary(read.list),
        // 来源与诊断可观测（前端/白盒能看出数据来自库还是 JSON 降级）
        tier: read.tier, dbRows: read.dbRows,
        diagnostics: wrongDiagnostics(wsKeyOf(wsRaw)),
      }
    }
    if (path === '/api/wrong/remove' && method === 'POST') {
      const p = loadProgress(wsRaw)
      const before = (p.wrongBook || []).length
      p.wrongBook = (p.wrongBook || []).filter((w: any) => w.sig !== post.sig)
      saveProgress(wsRaw, p)
      // v9：库侧同步删除（否则读路径库优先会「删了又回来」——经典双写不一致）
      const removedDb = removeWrongEntry(wsKeyOf(wsRaw), String(post && post.sig || ''))
      return { removed: before - p.wrongBook.length, remaining: p.wrongBook.length, dbSynced: removedDb }
    }
    if (path === '/api/stats') return statsSnapshot(wsRaw)
    return undefined
  }
  // 判分链路的错题收集/回炉钩子（http.js check 路由消费）
  //
  // v9 说明：`/api/questions?sort=srs` 的「无错题 → 弱点加权抽题」分支在池为空时
  // 会返回 {error, ready:false}。路由层不在此处做摄入（ingest 是异步且可能耗时数十秒，
  // 塞进判分/抽题同步域会阻塞事件循环）；**按需摄入由 http.ts 的 /api/questions
  // 与 /api/pool/* 入口统一负责**（它们本就 async）。
  void ctx
}

/** 判分钩子：答错收集 / 错题回炉升箱（http.js 与 srs 域的唯一耦合点） */
export const srsHooks = { upsertWrong, resolveRetry, questionSig }
