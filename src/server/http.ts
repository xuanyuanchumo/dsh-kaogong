/**
 * server/http.js — HTTP 调度核心 · v1.3（域拆分后）
 *
 * 分层纪律（复杂度预算驱动拆分，cycle-2/Q7）：
 *   ws.js      工作区隔离命名空间（slug+sha1 分文件）
 *   srs.js     错题本五箱调度 + 统计域
 *   dataApi.js 只读数据查询域（banks/modules/plan/search/method）
 *   本文件     生命周期日志 · 遥测 · 图谱 · 信标启动 · HTTP 路由分发（?? 域链）
 *
 * 崩溃安全（cycle-0 事故复盘）：startServer async，listen 错误 Promise 受控回传；
 * 信标发现 app 自证身份，同应用实例 adopt 复用，非本应用占用自动换端口。
 */

import { createServer } from 'node:http'
import { writeFileSync, appendFileSync, mkdirSync, createReadStream, statSync } from 'node:fs'
import { join, resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeImagePath, resolveNaokuImage } from '../adapters/naokuImage.js'
import {
  CAPABILITIES, NODE_META, EDGE_META, buildGraph, graphMetrics, healthScore,
  degreeAnalysis, labelPropagation, clusteringCoefficient, brandesBetweenness,
  topoLayers, layeredLayout,
} from '../shared/manifest.js'
import { REPOS, XINGCE_MODULES, safeReadFile, exists, safeReadDir, getRandomQuestions, repoStats } from '../adapters/repoData.js'
import { prewarmPaperIndex, resetPaperIndex } from '../adapters/paperData.js'
import { makeWsStore } from './ws.js'
import { makeSrsApi, srsHooks } from './srs.js'
import { makeDataApi, makeStudyPlan } from './dataApi.js'
import { makePaperApi } from './paperApi.js'
import { makeNaokuApi, initNaoku, resetNaoku } from './naokuApi.js'
import { makeTuxingApi } from './tuxingApi.js'
import { makeMethodologyApi } from './methodologyApi.js'
import { resolveReposRoot, USER_DATA_ROOT, PROGRESS_DIR_USER, migratePkgData, dataLocationReport } from './dataRoot.js'
import { makeRepoManager } from './repoManager.js'
import { makeHistoryApi } from './historyApi.js'
import { makePoolApi } from './poolApi.js'
import { createTelemetry, isDeclaredEndpoint, recordRequest, telemetrySnapshot, UNMATCHED_BUCKET } from './telemetry.js'
import { initPoolDb, resetPoolDb, putStudyEvent, poolDb } from '../adapters/poolDb.js'
import { schedulePlan } from './planSchedule.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..', '..')          // <pkg>
/** 开发态兼容常量（smoke 直接引用）；运行期真实根走 getRepoRoot() 动态解析 */
export const REPO_ROOT = resolve(PKG_ROOT, '..')
// ── cycle-21（issue #2）：用户数据全部外置到用户数据根（~/.dsh/kaogong/）——
// 市场升级 = pnpm 整目录替换包，包内数据必然丢失。DATA_DIR 仅保留为兼容别名（不再写入）。
const DATA_DIR = USER_DATA_ROOT
const PROGRESS_DIR = PROGRESS_DIR_USER
const RUNTIME_FILE = join(DATA_DIR, 'runtime.json')
const LIFECYCLE_FILE = join(DATA_DIR, 'lifecycle.jsonl')
const PLAN_FILE = join(DATA_DIR, 'study-plan.md')
const APP_NAME = 'dsh-kaogong'
const BOOT_TS = Date.now()
/** 进程级迁移报告（启动时执行一次；/api/data-location 透出） */
const MIGRATION = migratePkgData()

// ══ cycle-16 数据根动态化：域装配工厂（一键式安装的架构基座）══
// npm/GitHub 安装态下题库数据不在包内；数据根 = env KG_REPOS_DIR > data/repos-config.json
// > 开发态上级目录（含任一登记仓库）> 托管默认 data/repos/。
// 数据根变更（换根/安装/删除）→ rebuildDomains()：域工厂重建 + 缓存失效，各域文件零改动。
let domains: any = null
function buildDomains(root: string) {
  const store = makeWsStore(PROGRESS_DIR)
  // cycle-34 阶段 1：统一题目池域（`.kaogong.db` 存储层）
  // ⚠️ 装配顺序：**必须先于 srsApi**——SRS 抽题走存储层优先（I5/KERNEL-05），
  // 需要引用 poolApi.sampleQuestions（换根时随域一起重建，cycle-16 教训⑬）。
  const poolApi = makePoolApi({ repoRoot: root, dataDir: DATA_DIR, store })
  const d = {
    root,
    store,
    srsApi: makeSrsApi({ repoRoot: root, store, pool: poolApi }),
    dataApi: makeDataApi({ repoRoot: root, planFile: PLAN_FILE }),
    paperApi: makePaperApi({ repoRoot: root, store }),
    naokuApi: makeNaokuApi({ repoRoot: root, dataDir: DATA_DIR, store }),
    tuxingApi: makeTuxingApi({ repoRoot: root }),
    // cycle-18 花生十三体系方法论域：语料走数据根（与其它题库统一由「题库管理」配置），
    // 因此这里必须注入 repoRoot —— 数据根热切换时由 rebuildDomains 重建本域。
    // store 用于 trace 计数器按 wsKey 分槽隔离（cycle-17 ㉙ 跨项目污染教训）。
    methodologyApi: makeMethodologyApi({ pkgRoot: PKG_ROOT, repoRoot: root, dataDir: DATA_DIR, store }),
    // cycle-21 纸质补录域（issue #3）：搜索/补录/撤销，指纹与错题本同源
    historyApi: makeHistoryApi({ store, repoRoot: root }),
    poolApi,
    studyPlan: makeStudyPlan(PLAN_FILE),
  }
  initNaoku(root, DATA_DIR).catch(() => {})
  // cycle-34 阶段 1：统一库惰性打开（失败只降级——域内诚实报「未就绪」，绝不崩宿主）
  initPoolDb(DATA_DIR).catch(() => {})
  return d
}
export function getRepoRoot(): string {
  if (!domains) domains = buildDomains(resolveReposRoot(Object.keys(REPOS)).root)
  return domains.root
}
/** 数据根变更后重建（repoManager 回调；graphCache 一并作废） */
function rebuildDomains() {
  const next = resolveReposRoot(Object.keys(REPOS)).root
  const changed = !domains || domains.root !== next
  domains = buildDomains(next)
  if (changed) {
    resetPaperIndex()
    resetNaoku()
    resetPoolDb()
    graphCache.clear()
  }
  return { root: next, changed }
}
const repoManager = makeRepoManager({ getRoot: getRepoRoot, onRootChanged: rebuildDomains })
getRepoRoot()   // 模块加载即解析一次（后续只读复用）

// ══ 生命周期事件日志（环形 300 行）══
function logLifecycle(event: any, data = {}) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    appendFileSync(LIFECYCLE_FILE, JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n')
    const all = safeReadFile(LIFECYCLE_FILE, 900000)?.split('\n').filter(Boolean) || []
    if (all.length > 300) writeFileSync(LIFECYCLE_FILE, all.slice(-300).join('\n') + '\n')
  } catch { /* 日志失败不影响业务 */ }
}

// ══ cycle-21（issue #1）：xingcezhenti 题库配图服务 ══
// 练习链路（/api/questions）的题干图片在 parseQuestions 时被剥成中立占位 `kgimg://相对路径`，
// 前端 RichText 把占位改写为 `${MOUNT_PATH}/api/kg-img?p=` 请求本端点。
// 安全模型与 naokuImage.safeImagePath 同族：resolve 归一后必须仍在 xingcezhenti 内 + 扩展名白名单。
const KG_IMG_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }
function serveKgImage(params: any, res: any) {
  const dec = (v: any) => { try { return decodeURIComponent(v || '') } catch { return v || '' } }
  const rel = dec(params.get('p'))
  if (!rel) { try { res.writeHead(400); res.end('bad request') } catch {} ; return }
  // 占位协议：kgimg://<相对 xingcezhenti 的路径>；防御 http(s)/越级引用/绝对路径
  if (/^https?:/i.test(rel) || rel.includes('..') || resolve(rel) === rel) { try { res.writeHead(403); res.end('forbidden') } catch {} ; return }
  // cycle-22：深度题库（naoku）内联图占位引用的扩展名与磁盘不符（DB 记 .webp，磁盘 39051 个全是 .png）
  // → 先原样探测（练习链路占位路径与磁盘一致），未命中再按 basename 换扩展名兜底（与 naoku-img 端点同族语义）。
  let target = safeImagePath(getRepoRoot(), rel)
  if (!target) {
    const alt = resolveNaokuImage(getRepoRoot(), '/' + rel.replace(/^\/+/, ''))
    if (alt) target = safeImagePath(getRepoRoot(), alt)
  }
  if (!target) { try { res.writeHead(404); res.end('not found') } catch {} ; return }
  const mime = KG_IMG_MIME[extname(target).toLowerCase()]
  if (!mime) { try { res.writeHead(415); res.end('unsupported') } catch {} ; return }
  let size = 0
  try { size = statSync(target).size } catch { try { res.writeHead(500); res.end('stat error') } catch {} ; return }
  try { res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Cache-Control': 'public, max-age=86400' }) }
  catch { try { res.destroy() } catch {} ; return }
  const st = createReadStream(target)
  st.on('error', () => { try { res.destroy() } catch {} })
  st.pipe(res)
}

/**
 * 遥测（cycle-34 外提：见 server/telemetry.ts）
 *
 * 状态与快照逻辑已外提为独立模块（cycle-13 教训① 的固定拆法：只读纯函数外提 +
 * 闭包值同名参数穿线）——本文件只保留调用点，**函数体逐语义等价**（无行为改动）。
 *
 * 口径纪律：
 *  · 未声明端点只进 `__unmatched__` 聚合桶，不进端点对账表（cycle-18 ㉗）；
 *  · UI 壳路径（'/' 与 '/index.html'）不进对账（cycle-19 ㉞）；
 *  · 端点路径口径必须是**相对挂载点的逻辑路径**（`/api/graph`），否则能力对账 100% 失配（v1.8 白盒假阳性）。
 */
const telemetry = createTelemetry()
/** 已声明端点集合（由 CAPABILITIES 单一事实源派生，供遥测判「是否影子端点」） */
const DECLARED_ENDPOINT_SET = new Set(CAPABILITIES.endpoints.map((e: any) => e.path))

// ══ v1.8 生命周期状态机（data/lifecycle.jsonl 最近事件 + CAPABILITIES.lifecycle 合成）══
/**
 * 读取生命周期环形日志（最多 limit 条，按文件顺序 = 时间升序）。
 * 单行损坏（半行写入/进程被杀）只丢该行，绝不影响端点可用性。
 */
function readLifecycleEvents(limit = 50) {
  try {
    const raw = safeReadFile(LIFECYCLE_FILE, 900000) || ''
    const list: any[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { list.push(JSON.parse(line)) } catch { /* 单行损坏：跳过 */ }
    }
    return list.slice(-limit)
  } catch { return [] }
}

/** 阶段 → 可判定其完成的生命周期事件名（一个阶段允许多种事件来源） */
const STAGE_EVENTS: Record<string, string[]> = {
  load: ['load', 'plugin-load'],
  apply: ['apply', 'plugin-apply'],
  'server-start': ['server-listen', 'server-listen-probe', 'server-adopt'],
  'tools-register': ['tools-register', 'tool-register'],
  'runtime-publish': ['runtime-publish', 'server-listen'],
  serve: ['serve', 'server-adopt'],
  cleanup: ['cleanup', 'plugin-cleanup'],
}

/**
 * 合成生命周期视图：{stages, events, current}。
 * - stage 状态：最近一个已发生的阶段为 current，其前 done、其后 pending；
 * - at 取该阶段**最近一次**事件时间戳；
 * - events 最近 50 条，按时间**倒序**（最新在前，面板时间线直接渲染）。
 */
function lifecycleSnapshot() {
  const events = readLifecycleEvents(50)
  const at: Record<string, string> = {}
  for (const ev of events) {
    const name = ev && ev.event
    if (!name || !ev.ts) continue
    for (const [stage, names] of entries(STAGE_EVENTS) as Array<[string, string[]]>) {
      if (names.indexOf(name) >= 0) at[stage] = ev.ts // 文件升序 → 最后写入者即最近一次
    }
  }
  const stages: any[] = CAPABILITIES.lifecycle.map((s: any) => {
    const item: any = { stage: s.stage, desc: s.desc, state: 'pending' }
    if (at[s.stage]) item.at = at[s.stage]
    return item
  })
  let currentIdx = -1
  stages.forEach((s, i) => { if (at[s.stage]) currentIdx = i })
  if (currentIdx < 0) {
    // 无任何日志（首次启动前）：以加载阶段为当前态，避免出现「全是 pending」
    if (stages.length) stages[0].state = 'current'
    return { stages, events: events.slice().reverse(), current: stages.length ? stages[0].stage : null }
  }
  stages.forEach((s, i) => {
    s.state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'pending'
  })
  // cycle-19 R-OBS-1 生命周期量化：给每阶段补「从启动到该阶段最近一次事件的耗时」。
  // 口径说明：lifecycle.jsonl 只记事件时间戳，无显式 duration——这里用
  // 「阶段 at − 进程首事件 ts」得到自启动起的累计耗时（cumMs），白盒时间线把它渲染为
  // 「启动后 X ms 到达此阶段」的量化徽章。字段可选：无时间戳 → 不带 cumMs，UI 降级。
  const firstTs = events.length && events[0] && events[0].ts
    ? Date.parse(events[0].ts) : NaN
  for (const s of stages) {
    if (s.at && !isNaN(firstTs)) {
      const t = Date.parse(s.at)
      if (!isNaN(t) && t >= firstTs) s.cumMs = Math.max(0, t - firstTs)
    }
  }
  // 最近一次重启（最新 server-listen/server-adopt 事件）距首事件的启动耗时，供面板头部展示
  let bootMs: number | null = null
  const firstTsOk = typeof firstTs === 'number' && isFinite(firstTs)
  if (firstTsOk) {
    const bootEv = events.filter((e: any) => e && (e.event === 'server-listen' || e.event === 'server-adopt' || e.event === 'server-listen-probe'))
    if (bootEv.length) {
      const last = bootEv[bootEv.length - 1]
      const t0 = firstTs as number, t1 = Date.parse(String(last.ts))
      if (!isNaN(t1) && t1 >= t0) bootMs = Math.max(0, t1 - t0)
    }
  }
  return { stages, events: events.slice().reverse(), current: stages[currentIdx].stage, bootMs }
}

// ══ 图谱快照（5s TTL 缓存；节点/边/指标/健康度）══
// cycle-17 隔离修复：快照内嵌 progress（ws 相关字段），缓存必须按 wsKey 分槽——
// 否则工作区 A 先访问后，B 在 TTL 内命中同一份缓存，读到 A 的进度（跨项目污染）。
const graphCache = new Map<string, any>()
function graphSnapshot(wsRaw: any) {
  const ck = domains.store.wsKey(wsRaw)
  const hit = graphCache.get(ck)
  const now = Date.now()
  if (hit && hit.data && now - hit.ts < 5000) return hit.data
  const banks = {
    banks: Object.fromEntries(entries(REPOS).map(([k, v]) => [k, { desc: v, exists: exists(join(domains.root, k)) }])),
    ...repoStats(domains.root),
  }
  const modules = { modules: Object.fromEntries(entries(XINGCE_MODULES).map(([name, dir]) => {
    const p = join(domains.root, 'xingcezhenti', dir)
    return [name, { dir, fileCount: exists(p) ? safeReadDir(p).filter(f => f.endsWith('.md')).length : 0 }]
  })) }
  const plan = domains.studyPlan('all')
  delete plan.raw
  const ge = buildGraph({ banks, modules, plan })
  const metrics = graphMetrics(ge.nodes, ge.edges)
  const tel = telemetrySnapshot(telemetry, CAPABILITIES.endpoints.length, BOOT_TS)
  const p = domains.store.loadProgress(wsRaw || undefined)
  // ── v1.8 追加：分析层（纯函数、确定性；每次缓存未命中重算，5s TTL）──
  const deg = degreeAnalysis(ge.nodes, ge.edges)
  const analytics = {
    degree: deg.degree,
    degreeStats: deg.stats,
    communities: labelPropagation(ge.nodes, ge.edges),
    clustering: clusteringCoefficient(ge.nodes, ge.edges),
    betweenness: brandesBetweenness(ge.nodes, ge.edges),
    layers: topoLayers(ge.nodes, ge.edges),
  }
  const data = {
    generatedAt: new Date().toISOString(),
    nodes: ge.nodes, edges: ge.edges,
    metrics: { V: metrics.V, E: metrics.E, density: metrics.density, orphans: metrics.orphans, components: metrics.components },
    rank: entries(metrics.rank).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, v]) => ({ id, pr: +v.toFixed(4) })),
    health: healthScore({ metrics, telemetry: tel, banks }),
    progress: { day: p.day, answered: p.answered, byModule: Object.keys(p.byModule || {}).length },
    banks: { ready: banks.ready, total: banks.total },
    // v1.8 追加字段（既有字段一个不动，仅追加，旧 UI 不受影响）
    nodeMeta: NODE_META,
    edgeMeta: EDGE_META,
    analytics,
    layout: layeredLayout(ge.nodes, ge.edges),
  }
  graphCache.set(ck, { ts: now, data })
  if (graphCache.size > 24) { // 防无界增长：按时间戳清最旧槽（LRU 近似）
    const oldest = [...graphCache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, graphCache.size - 24)
    for (const [k] of oldest) graphCache.delete(k)
  }
  return data
}

// ══ v1.8 图查询端点（邻域/最短路/影响面）══
/**
 * 复用 /api/graph 的 5s 缓存（不重复 buildGraph），在快照上做纯函数查询。
 * 崩溃安全：未知/缺失节点返回 {error} 且 HTTP 200；任何异常都收敛为 {error}，
 * 绝不向路由层冒泡（路由层 catch 会退化成 500）。
 * cycle-29：函数体已外提到 server/graphQuery.ts（复杂度预算治理，graphSnapshot 参数注入）。
 */
import { graphQuery as graphQueryImpl } from './graphQuery.js'
function graphQuery(path: any, params: any, wsRaw: any) {
  return graphQueryImpl(path, params, wsRaw, graphSnapshot)
}

// ══ UI 装配（index.html + app.css 服务端内联，保持单响应零依赖）══
let uiCache: any = { ts: 0, html: null }
function renderUI() {
  const now = Date.now()
  if (uiCache.html && now - uiCache.ts < 3000) return uiCache.html
  const html = safeReadFile(join(PKG_ROOT, 'src', 'ui', 'index.html'), 900000)
  const css = safeReadFile(join(PKG_ROOT, 'src', 'ui', 'app.css'), 900000)
  if (!html) return null
  const out = html.replace('/*__APP_CSS__*/', css || '')
  uiCache = { ts: now, html: out }
  return out
}

// ══ 核心路由（域链分发：repoManager(异步) ?? srs ?? paper ?? data ?? core）══
async function handleApi(path: any, params: any, post: any, method: any, wsRaw: any, port: any) {
  // cycle-16 题库管理域（异步：git 作业控制面）——前置于同步域链，仅接管 /api/repos*
  if (path.startsWith('/api/repos')) {
    const r = await repoManager.handle(path, params, post, method)
    if (r !== undefined) return r
  }
  return domains.methodologyApi.handle(path, params, post, method, wsRaw)
    ?? domains.srsApi(path, params, post, method, wsRaw)
    ?? domains.historyApi.handle(path, params, post, method, wsRaw)
    // cycle-34 阶段 1：统一题目池域——插在 historyApi 之后、tuxingApi 之前
    // （研究 15 §2.3：`/api/pool/*` 前缀独立无冲突，但语义上「统一池」先于各专项域命中）
    // ⚠️ 异步域：handle 返回 Promise → 必须 await（cycle-16 教训⑯：异步路由改造要同步改全部调用点）
    ?? await domains.poolApi.handle(path, params, post, method, wsRaw)
    ?? domains.tuxingApi.handle(path, params)
    ?? domains.naokuApi.handle(path, params, post, method, wsRaw)
    ?? domains.paperApi.handle(path, params, post, method, wsRaw)
    ?? domains.dataApi(path, params, post, method)
    ?? coreApi(path, params, post, method, wsRaw, port)
}

function coreApi(path: any, params: any, post: any, method: any, wsRaw: any, port: any) {
  if (path === '/api/status') {
    const rs = repoStats(domains.root)
    const p = domains.store.loadProgress(wsRaw || undefined)
    return {
      app: APP_NAME, port, pid: process.pid, uptimeSec: Math.round((Date.now() - BOOT_TS) / 1000),
      repos: rs,
      repoRoot: domains.root,
      db: exists(join(domains.root, 'GongkaoNaoku', 'kaogong.db')),
      ws: domains.store.wsKey(wsRaw),
      progress: { day: p.day, answered: p.answered, correct: p.correct, wrong: p.wrong, rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 },
    }
  }
  if (path === '/api/questions' && method === 'GET') {
    // cycle-34 阶段 1（I5/KERNEL-05）：存储层优先供数——统一池就绪时不再直读第三方 md；
    // 池未就绪时回落目录解析（受控降级，唯一可用数据源）。
    // ⚠️ 兼容硬约束：响应形状零变化（options/correctAnswer/stem 的 kgimg:// 占位全保留）。
    return getRandomQuestions(
      domains.root,
      params.get('module') || '判断推理',
      parseInt(params.get('count') || params.get('limit') || '1'),
      domains.poolApi,
    )
  }
  if (path === '/api/check' && method === 'POST') {
    const q = post.question
    if (!q || !q.correctAnswer) return { error: '缺少题目对象（需含 correctAnswer）' }
    const answer = (post.answer || '').toUpperCase().trim()
    const isCorrect = answer === q.correctAnswer
    const progress = domains.store.loadProgress(wsRaw || undefined)
    if (post.label && !progress.label) progress.label = post.label
    progress.answered++
    if (isCorrect) progress.correct++; else progress.wrong++
    progress.byModule = progress.byModule || {}
    const mb = (progress.byModule[q.module] = progress.byModule[q.module] || { answered: 0, correct: 0 })
    mb.answered++
    if (isCorrect) mb.correct++
    progress.history = progress.history || []
    progress.history.push({ date: new Date().toISOString().slice(0, 10), module: q.module, type: q.type, userAnswer: answer, correctAnswer: q.correctAnswer, isCorrect })
    if (progress.history.length > 500) progress.history = progress.history.slice(-500)
    // 错题本闭环钩子（srs 域）：答错收集降箱；回炉答对升箱判掌握
    let wrongEvent: any = null
    if (!isCorrect) wrongEvent = { type: 'collected', sig: srsHooks.upsertWrong(progress, q) }
    else if (q.fromWrongBook) {
      const item = srsHooks.resolveRetry(progress, q)
      if (item) wrongEvent = { type: item.mastered ? 'mastered' : 'promoted', sig: item.sig, box: item.box, consecutive: item.consecutive }
    }
    domains.store.saveProgress(wsRaw, progress)
    // cycle-38 阶段 2（研究 15 C7）：学习事件**双写**——progress json 仍是统计/错题本
    // 的权威事实源（读路径零改动），study_event 只沉淀事件流水（阶段 3 按 kadian
    // 诊断的原料）。写失败静默（流水丢失不影响判分主链路）。
    try {
      putStudyEvent(poolDb(), {
        ws: domains.store.wsKey(wsRaw),
        qid: String((q as any).qid || ''),
        canonicalId: String((q as any).id || '').startsWith('q:') ? String((q as any).id) : '',
        module: String(q.module || ''),
        kadian: String((q as any).dims && (q as any).dims.kadian || ''),
        action: isCorrect ? (wrongEvent && wrongEvent.type === 'mastered' ? 'mastered' : wrongEvent && wrongEvent.type === 'promoted' ? 'promoted' : 'answer') : (wrongEvent ? 'collected' : 'wrong'),
        userAnswer: answer,
        correctAnswer: String(q.correctAnswer || ''),
        isCorrect,
        box: wrongEvent && wrongEvent.box != null ? Number(wrongEvent.box) : null,
        consecutive: wrongEvent && wrongEvent.consecutive != null ? Number(wrongEvent.consecutive) : null,
      })
    } catch { /* 流水写失败不影响判分返回 */ }
    return { isCorrect, correctAnswer: q.correctAnswer, analysis: q.analysis, wrongEvent, progress: { answered: progress.answered, correct: progress.correct, wrong: progress.wrong, rate: Math.round(progress.correct / progress.answered * 100) } }
  }
  if (path === '/api/progress' && method === 'GET') {
    const p = domains.store.loadProgress(wsRaw || undefined)
    return { ...p, ws: domains.store.wsKey(wsRaw), rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 }
  }
  if (path === '/api/progress' && method === 'POST') {
    const p = domains.store.loadProgress(wsRaw || undefined)
    if (post.day) p.day = Math.max(1, Math.min(30, post.day))
    if (post.label) p.label = post.label
    if (post.reset) { p.answered = 0; p.correct = 0; p.wrong = 0; p.history = []; p.byModule = {}; p.wrongBook = [] }
    domains.store.saveProgress(wsRaw, p)
    return { ...p, ws: domains.store.wsKey(wsRaw), rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 }
  }
  if (path === '/api/graph') return graphSnapshot(wsRaw)
  // cycle-30（T-027 清偿）：学习计划智能排程——计划结构 + 作答画像 + 错题积压 →
  // 每日侧重标注 + 题量分配（纯函数；错误收敛 {error} 200，不冒泡）
  if (path === '/api/plan/schedule') {
    const plan = domains.studyPlan('all')
    const p = domains.store.loadProgress(wsRaw || undefined)
    return schedulePlan(plan, p.byModule, p.wrongBook)
  }
  // v1.8 图查询三端点（未知节点 → {error} 且 200，不让异常冒泡）
  if (path === '/api/graph/neighborhood' || path === '/api/graph/path' || path === '/api/graph/impact') {
    return graphQuery(path, params, wsRaw)
  }
  if (path === '/api/lifecycle') return lifecycleSnapshot()
  if (path === '/api/telemetry') return telemetrySnapshot(telemetry, CAPABILITIES.endpoints.length, BOOT_TS)
  if (path === '/api/capabilities') {
    const tel = telemetrySnapshot(telemetry, CAPABILITIES.endpoints.length, BOOT_TS)
    // cycle-19 旅程修正：对账消费集排除 UI 壳路径与聚合桶——「/」「/index.html」是页面壳
    // 而非能力端点，混进对账会成假漂移（missingProducers 误报「/」，沙箱实证）。
    const consumed = new Set(Object.keys(tel.endpoints).filter(p => p !== '/' && p !== '/index.html' && p !== UNMATCHED_BUCKET))
    const declared = new Set(CAPABILITIES.endpoints.map(e => e.path))
    // 静态对账：以「不含运行时数据的纯声明图」求入度，孤儿=声明了却无人指向
    const staticGraph = buildGraph({})
    const sm = graphMetrics(staticGraph.nodes, staticGraph.edges)
    const reconciliation = {
      orphanEndpoints: sm.orphans.filter((id: string) => id.startsWith('endpoint:')).map((id: string) => id.slice(9)),
      orphanViews: sm.orphans.filter((id: string) => id.startsWith('view:')).map((id: string) => id.slice(5)),
      // 运行态对账：声明了但从未被触达 / 被触达但未声明（能力矩阵漂移信号）
      unconsumedEndpoints: CAPABILITIES.endpoints.filter(e => !consumed.has(e.path)).map(e => e.path),
      missingProducers: [...consumed].filter(p => !declared.has(p)).sort(),
    }
    return {
      ...CAPABILITIES,
      runtime: { consumedEndpoints: [...consumed], coverage: tel.coverage, uptimeSec: tel.uptimeSec },
      orphans: CAPABILITIES.endpoints.filter(e => !consumed.has(e.path)).map(e => e.path),
      reconciliation,
      lifecycle: lifecycleSnapshot(),
    }
  }
  if (path === '/api/workspaces') return { workspaces: domains.store.listWorkspaces() }
  // cycle-21（issue #2）：数据位置白盒——位置/来源/迁移状态/包内残留一次透出
  if (path === '/api/data-location') return { ...dataLocationReport(), migration: MIGRATION }
  return { error: `Unknown API: ${path}` }
}

// ══ 崩溃安全启动（信标发现 + adopt + 降级）══
function probePort(port: any) {
  return fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(700) })
    .then(r => r.json())
    .then(j => (j && j.app === APP_NAME ? j : null))
    .catch(() => null)
}
function tryListen(server: any, port: any) {
  return new Promise((res, rej) => {
    const onError = (e: any) => { server.removeListener('listening', onOk); rej(e) }
    const onOk = () => { server.removeListener('error', onError); res(port) }
    server.once('error', onError)
    server.once('listening', onOk)
    server.listen(port, '127.0.0.1') // 仅回环，绝不暴露局域网
  })
}
function writeRuntime(info: any) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(RUNTIME_FILE, JSON.stringify({ app: APP_NAME, ...info, startedAt: new Date(BOOT_TS).toISOString(), version: CAPABILITIES.plugin.version }, null, 2))
  } catch {}
}

/**
 * 启动服务：候选区间自 preferred 派生 5 端口；先探测同应用实例（adopt），
 * 否则逐端口受控绑定。返回 {server, port, adopted}；失败走 Promise reject。
 */
export async function startServer(preferredPort = 8400, options: any = {}) {
  const publishRuntime = options.publishRuntime !== false
  const prewarm = options.prewarm !== false
  const ports = Array.from({ length: 5 }, (_, i) => preferredPort + i)
  for (const port of ports) {
    const beacon = await probePort(port)
    if (beacon) { logLifecycle('server-adopt', { port, pid: beacon.pid }); return { server: null, port, adopted: true } }
    const server = buildHttpServer(port)
    try {
      await tryListen(server, port)
      if (publishRuntime) writeRuntime({ port, pid: process.pid })
      logLifecycle(publishRuntime ? 'server-listen' : 'server-listen-probe', { port })
      // cycle-14 性能：启动后后台分块预热真题卷索引（快照命中即毫秒级；无快照分块构建不阻塞事件循环）。
      // smoke 传 prewarm:false 关闭——避免预热与 R-P-03 快照实验互踩（预热会把缓存热好，耗时断言失真）。
      if (prewarm) prewarmPaperIndex(getRepoRoot())
      return { server, port, adopted: false }
    } catch (e) {
      if (e.code === 'EADDRINUSE') continue
      throw e
    }
  }
  throw Object.assign(new Error('端口区间不可用'), { code: 'NO_PORT' })
}

// ══ 宿主同源路由适配器（ctx.webServer，v1.4 cycle-3）══
/**
 * 把同一套路由挂进 DSH 宿主 Web 服务器（如 /kaogong/*），UI 与 API 走宿主同源：
 * 无 CORS、无独立端口依赖、天然继承宿主认证。独立端口 server 降级为兜底通道。
 * @param webServer - ctx.webServer（register 返回 disposer）
 * @param mountPath - 挂载前缀，绝对 pathname 无尾斜杠
 */
export function attachWebRoute(webServer: any, mountPath = '/kaogong') {
  const handler = (req: any, res: any) => {
    const t0 = Date.now()
    const url = new URL(req.url, 'http://host-root')
    const rel = url.pathname.slice(mountPath.length) || '/'
    const params = url.searchParams
    const wsRaw = params.get('ws') || undefined
    const finish = (status: any, type: any, body: any) => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(body)
      // 遥测路径口径（v1.8.0 修复）：统一记「相对挂载点的逻辑路径」（/api/graph），
      // 与 CAPABILITIES.endpoints 声明口径一致。此前记 mountPath+rel（/kaogong/api/graph）
      // → 能力对账永远匹配不上 → 全部端点被判「未声明」，白盒面板失去意义（假阳性）。
      recordRequest(telemetry, rel, Date.now() - t0, status >= 400, isDeclaredEndpoint(rel, DECLARED_ENDPOINT_SET))
    }
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    if (rel === '/' || rel === '/index.html') {
      const ui = renderUI()
      return ui ? finish(200, 'text/html; charset=utf-8', ui) : finish(404, 'text/plain; charset=utf-8', 'UI not found')
    }
    if (rel.startsWith('/api/')) {
      // 图片端点走二进制流（T-018），不进 JSON 链路
      if (rel === '/api/paper-img') { domains.paperApi.serveImage(params, res); return }
      if (rel === '/api/naoku-img') { domains.naokuApi.serveImage(params, res); return }
      if (rel === '/api/tuxing-img') { domains.tuxingApi.serveImage(params, res); return }
      // cycle-21（issue #1）：xingcezhenti 题库图（题目图/公式图）——中立占位 kgimg:// 的服务端
      if (rel === '/api/kg-img') { serveKgImage(params, res); return }
      let body = ''
      req.on('data', (c: any) => body += c)
      req.on('end', async () => {
        try {
          const post = body ? JSON.parse(body) : {}
          finish(200, 'application/json; charset=utf-8', JSON.stringify(await handleApi(rel, params, post, req.method, wsRaw, 0)))
        } catch (e) {
          finish(500, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }))
        }
      })
      return
    }
    finish(404, 'text/plain; charset=utf-8', 'Not found')
  }
  return webServer.register({ kind: 'prefix', path: mountPath, handler })
}

function buildHttpServer(port: any) {
  const server = createServer((req, res) => {
    // 兼容性防线（R8）：畸形请求（非法 % 转义撞 URL/decodeURIComponent 等）必须
    // 在本回调内消化为 400 —— 独立端口没有宿主 webServer 的兜底，
    // 未捕获异常会直接击杀宿主进程（cycle-0 同族）。
    try {
      const t0 = Date.now()
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
      // 独立端口也接受带挂载前缀（/kaogong/...）的路径：同源改写的图片 URL 在两种通道下通用
      const rawPath = url.pathname
      const path = rawPath.startsWith('/kaogong/') ? rawPath.slice('/kaogong'.length) : rawPath
      const params = url.searchParams
      const wsRaw = params.get('ws') || undefined

      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Cache-Control', 'no-store')
      const finish = (status: any, type: any, body: any) => {
        res.writeHead(status, { 'Content-Type': type })
        res.end(body)
        recordRequest(telemetry, path, Date.now() - t0, status >= 400, isDeclaredEndpoint(path, DECLARED_ENDPOINT_SET))
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); recordRequest(telemetry, path, Date.now() - t0, false); return }
      if (path === '/' || path === '/index.html') {
        const ui = renderUI()
        return ui ? finish(200, 'text/html; charset=utf-8', ui) : finish(404, 'text/plain; charset=utf-8', 'UI not found')
      }
      if (path.startsWith('/api/')) {
        // 图片端点走二进制流（T-018），不进 JSON 链路
        if (path === '/api/paper-img') { domains.paperApi.serveImage(params, res); return }
        if (path === '/api/naoku-img') { domains.naokuApi.serveImage(params, res); return }
        if (path === '/api/tuxing-img') { domains.tuxingApi.serveImage(params, res); return }
        if (path === '/api/kg-img') { serveKgImage(params, res); return }
        let body = ''
        req.on('data', c => body += c)
        req.on('end', async () => {
          try {
            const post = body ? JSON.parse(body) : {}
            finish(200, 'application/json; charset=utf-8', JSON.stringify(await handleApi(path, params, post, req.method, wsRaw, port)))
          } catch (e) {
            finish(500, 'application/json; charset=utf-8', JSON.stringify({ error: e.message }))
          }
        })
        return
      }
      finish(404, 'text/plain; charset=utf-8', 'Not found')
    } catch {
      try { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Bad request') } catch { /* 头已发出则放弃 */ }
    }
  })
  // socket 级错误兜底（客户端中途断开等）：绝不冒泡为 uncaughtException
  server.on('clientError', (err, socket) => { try { socket.destroy() } catch {} })
  return server
}
