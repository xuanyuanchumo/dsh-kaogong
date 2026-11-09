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
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAPABILITIES, NODE_META, EDGE_META, buildGraph, graphMetrics, healthScore,
  degreeAnalysis, labelPropagation, clusteringCoefficient, brandesBetweenness,
  topoLayers, shortestPath, neighborhood, reverseReach, layeredLayout,
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
import { resolveReposRoot } from './dataRoot.js'
import { makeRepoManager } from './repoManager.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..', '..')          // <pkg>
/** 开发态兼容常量（smoke 直接引用）；运行期真实根走 getRepoRoot() 动态解析 */
export const REPO_ROOT = resolve(PKG_ROOT, '..')
const DATA_DIR = join(PKG_ROOT, 'data')
const PROGRESS_DIR = join(DATA_DIR, 'progress')
const RUNTIME_FILE = join(DATA_DIR, 'runtime.json')
const LIFECYCLE_FILE = join(DATA_DIR, 'lifecycle.jsonl')
const PLAN_FILE = join(DATA_DIR, 'study-plan.md')
const APP_NAME = 'dsh-kaogong'
const BOOT_TS = Date.now()

// ══ cycle-16 数据根动态化：域装配工厂（一键式安装的架构基座）══
// npm/GitHub 安装态下题库数据不在包内；数据根 = env KG_REPOS_DIR > data/repos-config.json
// > 开发态上级目录（含任一登记仓库）> 托管默认 data/repos/。
// 数据根变更（换根/安装/删除）→ rebuildDomains()：域工厂重建 + 缓存失效，各域文件零改动。
let domains: any = null
function buildDomains(root: string) {
  const store = makeWsStore(PROGRESS_DIR)
  const d = {
    root,
    store,
    srsApi: makeSrsApi({ repoRoot: root, store }),
    dataApi: makeDataApi({ repoRoot: root, planFile: PLAN_FILE }),
    paperApi: makePaperApi({ repoRoot: root, store }),
    naokuApi: makeNaokuApi({ repoRoot: root, dataDir: DATA_DIR, store }),
    tuxingApi: makeTuxingApi({ repoRoot: root }),
    // cycle-18 花生十三体系方法论域：语料走数据根（与其它题库统一由「题库管理」配置），
    // 因此这里必须注入 repoRoot —— 数据根热切换时由 rebuildDomains 重建本域。
    // store 用于 trace 计数器按 wsKey 分槽隔离（cycle-17 ㉙ 跨项目污染教训）。
    methodologyApi: makeMethodologyApi({ pkgRoot: PKG_ROOT, repoRoot: root, dataDir: DATA_DIR, store }),
    studyPlan: makeStudyPlan(PLAN_FILE),
  }
  initNaoku(root, DATA_DIR).catch(() => {})
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
    graphCache.clear()
  }
  return { root: next, changed }
}
const repoManager = makeRepoManager({ getRoot: getRepoRoot, onRootChanged: rebuildDomains })
getRepoRoot()   // 模块加载即解析一次（后续只读复用）

// ══ 生命周期事件日志（环形 300 行）══
function logLifecycle(event, data = {}) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    appendFileSync(LIFECYCLE_FILE, JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n')
    const all = safeReadFile(LIFECYCLE_FILE, 900000)?.split('\n').filter(Boolean) || []
    if (all.length > 300) writeFileSync(LIFECYCLE_FILE, all.slice(-300).join('\n') + '\n')
  } catch { /* 日志失败不影响业务 */ }
}

// ══ 遥测：滑窗 QPS + 每端点环形延迟样本（p50/p95 有序统计）══
interface EpStat { count: number; errors: number; lat: number[]; lastTs?: number }
const telemetry: { endpoints: Record<string, EpStat>; requests: number[]; window: number } = { endpoints: {}, requests: [], window: 60_000 }
const LAT_RING = 100

/** cycle-18：未声明端点（404/Unknown API）的遥测只记聚合桶，不污染端点对账表。
 *  为什么必须这样：`/api/capabilities` 的端点对账以 telemetry.endpoints 的键为
 *  「运行态声明」，一旦某个从未声明过的路径（拼错、探针、扫描器）被记进来，
 *  就会永久驻留成「影子端点」，让白盒面板与 smoke 口径守卫误判（v1.8 假阳性同族）。
 *  端点维度只认**已声明**路径；未命中的请求计数进 `telemetry.unmatched`（仍可观测，但不参与对账）。 */
const UNMATCHED_BUCKET = '__unmatched__'

/** 已声明端点集合（由 CAPABILITIES 单一事实源派生，供遥测判「是否影子端点」） */
const DECLARED_ENDPOINT_SET = new Set(CAPABILITIES.endpoints.map((e: any) => e.path))
/** 是否为已声明端点；非 /api/* 路径（UI/静态）不参与端点对账，一律视为 matched */
function isDeclaredEndpoint(path: any): boolean {
  const p = String(path || '')
  if (!p.startsWith('/api/')) return true
  return DECLARED_ENDPOINT_SET.has(p)
}

function recordRequest(path: any, ms: any, isError: any, declared?: boolean): void {
  const key = declared === false ? UNMATCHED_BUCKET : path
  const t = (telemetry.endpoints[key] = telemetry.endpoints[key] || { count: 0, errors: 0, lat: [] })
  t.count++
  if (isError) t.errors++
  t.lat.push(Math.round(ms))
  if (t.lat.length > LAT_RING) t.lat.shift()
  t.lastTs = Date.now()
  telemetry.requests.push(t.lastTs)
  if (telemetry.requests.length > 1000) telemetry.requests.shift()
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function telemetrySnapshot() {
  const now = Date.now()
  const inWindow = telemetry.requests.filter(ts => now - ts < telemetry.window).length
  const eps: any = {}
  let unmatchedCount = 0, unmatchedErrors = 0
  for (const [path, t] of entries(telemetry.endpoints)) {
    // cycle-18：未声明端点的请求只进聚合桶，不混入端点对账表（否则会成为永久「影子端点」）
    if (path === UNMATCHED_BUCKET) { unmatchedCount = t.count; unmatchedErrors = t.errors; continue }
    const sorted = [...t.lat].sort((a, b) => a - b)
    eps[path] = {
      count: t.count, errors: t.errors,
      errRate: t.count ? +(t.errors / t.count).toFixed(3) : 0,
      p50: percentile(sorted, 50), p95: percentile(sorted, 95),
      lastActive: t.lastTs ? Math.round((now - t.lastTs) / 1000) : null,
      series: t.lat,
    }
  }
  const totalReq: number = (Object.values(eps) as any[]).reduce((s: number, e: any) => s + e.count, 0)
  const totalErr: number = (Object.values(eps) as any[]).reduce((s: number, e: any) => s + e.errors, 0)

  // ── v1.8 追加：全局延迟直方图（各端点最新环形样本合并，有序统计）──
  const allLat: number[] = []
  for (const t of Object.values(telemetry.endpoints) as EpStat[]) allLat.push(...t.lat)
  allLat.sort((a, b) => a - b)
  const histogram = {
    p50: percentile(allLat, 50), p90: percentile(allLat, 90),
    p95: percentile(allLat, 95), p99: percentile(allLat, 99),
    max: allLat.length ? allLat[allLat.length - 1] : 0,
  }

  // ── v1.8 追加：慢端点排行（p95 降序 → count 降序 → path 字典序，稳定可复现）──
  const topSlow = entries(eps)
    .filter(([path]) => !path.includes('-img')) // 二进制流不计入慢端点排名
    .map(([path, e]: [string, any]) => ({ path, p95: e.p95, count: e.count }))
    .sort((a, b) => b.p95 - a.p95 || b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, 10)

  // ── v1.8 追加：告警（契约阈值 p95>200 warn / >500 error / errRate>1% warn）──
  const alerts: any[] = []
  for (const [path, e] of entries(eps) as Array<[string, any]>) {
    if (e.p95 > 500) alerts.push({ level: 'error', msg: `${path} p95 ${e.p95}ms 超过 500ms` })
    else if (e.p95 > 200) alerts.push({ level: 'warn', msg: `${path} p95 ${e.p95}ms 超过 200ms` })
    if (e.count > 0 && e.errors / e.count > 0.01) {
      alerts.push({ level: 'warn', msg: `${path} 错误率 ${(e.errors / e.count * 100).toFixed(1)}% 超过 1%` })
    }
  }
  if (totalReq > 0 && totalErr / totalReq > 0.01) {
    alerts.push({ level: 'warn', msg: `全局错误率 ${(totalErr / totalReq * 100).toFixed(1)}% 超过 1%` })
  }
  // cycle-18：命中未声明端点的请求（拼错/扫描器/旧客户端）——有量就提示，但不进端点表
  if (unmatchedCount > 0) {
    alerts.push({ level: 'info', msg: `有 ${unmatchedCount} 次请求命中未声明端点（已聚合，未计入端点对账）` })
  }
  // 稳定排序：error 在前，同级按消息字典序（避免 telemetry 插入序导致抖动）
  alerts.sort((a, b) => (a.level === b.level
    ? (a.msg < b.msg ? -1 : a.msg > b.msg ? 1 : 0)
    : (a.level === 'error' ? -1 : 1)))

  return {
    uptimeSec: Math.round((now - BOOT_TS) / 1000),
    qpsWindow: +(inWindow / (telemetry.window / 1000)).toFixed(3),
    totalRequests: totalReq,
    endpoints: eps,
    activeEndpoints: Object.keys(eps).length,
    declaredEndpoints: CAPABILITIES.endpoints.length,
    coverage: +(Object.keys(eps).length / CAPABILITIES.endpoints.length).toFixed(3),
    histogram,
    topSlow,
    alerts,
    // cycle-18：未声明端点请求的可观测余量（不含具体路径，避免影子端点回流；
    // 有计数就说明「有人在打不存在的 API」——这个信号本身必须保留）
    unmatched: { count: unmatchedCount, errors: unmatchedErrors },
  }
}

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
  return { stages, events: events.slice().reverse(), current: stages[currentIdx].stage }
}

// ══ 图谱快照（5s TTL 缓存；节点/边/指标/健康度）══
// cycle-17 隔离修复：快照内嵌 progress（ws 相关字段），缓存必须按 wsKey 分槽——
// 否则工作区 A 先访问后，B 在 TTL 内命中同一份缓存，读到 A 的进度（跨项目污染）。
const graphCache = new Map<string, any>()
function graphSnapshot(wsRaw) {
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
  const tel = telemetrySnapshot()
  const p = domains.store.loadProgress(wsRaw)
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
 */
function graphQuery(path, params, wsRaw) {
  try {
    const g = graphSnapshot(wsRaw)
    const nodes = g.nodes || []
    const edges = g.edges || []
    const known = new Set(nodes.map((n: any) => n.id))

    if (path === '/api/graph/neighborhood') {
      const node = params.get('node') || ''
      const depth = Math.max(1, Math.min(3, parseInt(params.get('depth') || '1', 10) || 1))
      if (!node || !known.has(node)) {
        return { error: `未知节点: ${node || '(空)'}`, center: node, depth, nodes: [], edges: [], stats: { nodes: 0, edges: 0 } }
      }
      const r: any = neighborhood(nodes, edges, node, depth)
      return { ...r, stats: { nodes: r.nodes.length, edges: r.edges.length } }
    }

    if (path === '/api/graph/path') {
      const from = params.get('from') || ''
      const to = params.get('to') || ''
      if (!from || !to) return { error: '缺少 from/to 参数', found: false, path: [], length: 0 }
      if (!known.has(from) || !known.has(to)) {
        const bad = !known.has(from) ? from : to
        return { error: `未知节点: ${bad}`, found: false, path: [], length: 0 }
      }
      return shortestPath(nodes, edges, from, to)
    }

    // /api/graph/impact
    const node = params.get('node') || ''
    if (!node || !known.has(node)) {
      return { error: `未知节点: ${node || '(空)'}`, node, dependents: [], count: 0 }
    }
    return reverseReach(nodes, edges, node)
  } catch (e: any) {
    return { error: `图查询失败: ${e && e.message ? e.message : String(e)}` }
  }
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
async function handleApi(path, params, post, method, wsRaw, port) {
  // cycle-16 题库管理域（异步：git 作业控制面）——前置于同步域链，仅接管 /api/repos*
  if (path.startsWith('/api/repos')) {
    const r = await repoManager.handle(path, params, post, method)
    if (r !== undefined) return r
  }
  return domains.methodologyApi.handle(path, params, post, method, wsRaw)
    ?? domains.srsApi(path, params, post, method, wsRaw)
    ?? domains.tuxingApi.handle(path, params)
    ?? domains.naokuApi.handle(path, params, post, method, wsRaw)
    ?? domains.paperApi.handle(path, params, post, method, wsRaw)
    ?? domains.dataApi(path, params, post, method)
    ?? coreApi(path, params, post, method, wsRaw, port)
}

function coreApi(path, params, post, method, wsRaw, port) {
  if (path === '/api/status') {
    const rs = repoStats(domains.root)
    const p = domains.store.loadProgress(wsRaw)
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
    return getRandomQuestions(domains.root, params.get('module') || '判断推理', parseInt(params.get('count') || params.get('limit') || '1'))
  }
  if (path === '/api/check' && method === 'POST') {
    const q = post.question
    if (!q || !q.correctAnswer) return { error: '缺少题目对象（需含 correctAnswer）' }
    const answer = (post.answer || '').toUpperCase().trim()
    const isCorrect = answer === q.correctAnswer
    const progress = domains.store.loadProgress(wsRaw)
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
    let wrongEvent = null
    if (!isCorrect) wrongEvent = { type: 'collected', sig: srsHooks.upsertWrong(progress, q) }
    else if (q.fromWrongBook) {
      const item = srsHooks.resolveRetry(progress, q)
      if (item) wrongEvent = { type: item.mastered ? 'mastered' : 'promoted', sig: item.sig, box: item.box, consecutive: item.consecutive }
    }
    domains.store.saveProgress(wsRaw, progress)
    return { isCorrect, correctAnswer: q.correctAnswer, analysis: q.analysis, wrongEvent, progress: { answered: progress.answered, correct: progress.correct, wrong: progress.wrong, rate: Math.round(progress.correct / progress.answered * 100) } }
  }
  if (path === '/api/progress' && method === 'GET') {
    const p = domains.store.loadProgress(wsRaw)
    return { ...p, ws: domains.store.wsKey(wsRaw), rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 }
  }
  if (path === '/api/progress' && method === 'POST') {
    const p = domains.store.loadProgress(wsRaw)
    if (post.day) p.day = Math.max(1, Math.min(30, post.day))
    if (post.label) p.label = post.label
    if (post.reset) { p.answered = 0; p.correct = 0; p.wrong = 0; p.history = []; p.byModule = {}; p.wrongBook = [] }
    domains.store.saveProgress(wsRaw, p)
    return { ...p, ws: domains.store.wsKey(wsRaw), rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 }
  }
  if (path === '/api/graph') return graphSnapshot(wsRaw)
  // v1.8 图查询三端点（未知节点 → {error} 且 200，不让异常冒泡）
  if (path === '/api/graph/neighborhood' || path === '/api/graph/path' || path === '/api/graph/impact') {
    return graphQuery(path, params, wsRaw)
  }
  if (path === '/api/lifecycle') return lifecycleSnapshot()
  if (path === '/api/telemetry') return telemetrySnapshot()
  if (path === '/api/capabilities') {
    const tel = telemetrySnapshot()
    const consumed = new Set(Object.keys(tel.endpoints))
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
  return { error: `Unknown API: ${path}` }
}

// ══ 崩溃安全启动（信标发现 + adopt + 降级）══
function probePort(port) {
  return fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(700) })
    .then(r => r.json())
    .then(j => (j && j.app === APP_NAME ? j : null))
    .catch(() => null)
}
function tryListen(server, port) {
  return new Promise((res, rej) => {
    const onError = (e) => { server.removeListener('listening', onOk); rej(e) }
    const onOk = () => { server.removeListener('error', onError); res(port) }
    server.once('error', onError)
    server.once('listening', onOk)
    server.listen(port, '127.0.0.1') // 仅回环，绝不暴露局域网
  })
}
function writeRuntime(info) {
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
export function attachWebRoute(webServer, mountPath = '/kaogong') {
  const handler = (req, res) => {
    const t0 = Date.now()
    const url = new URL(req.url, 'http://host-root')
    const rel = url.pathname.slice(mountPath.length) || '/'
    const params = url.searchParams
    const wsRaw = params.get('ws') || undefined
    const finish = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(body)
      // 遥测路径口径（v1.8.0 修复）：统一记「相对挂载点的逻辑路径」（/api/graph），
      // 与 CAPABILITIES.endpoints 声明口径一致。此前记 mountPath+rel（/kaogong/api/graph）
      // → 能力对账永远匹配不上 → 全部端点被判「未声明」，白盒面板失去意义（假阳性）。
      recordRequest(rel, Date.now() - t0, status >= 400, isDeclaredEndpoint(rel))
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
      let body = ''
      req.on('data', c => body += c)
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

function buildHttpServer(port) {
  const server = createServer((req, res) => {
    // 兼容性防线（R8）：畸形请求（非法 % 转义撞 URL/decodeURIComponent 等）必须
    // 在本回调内消化为 400 —— 独立端口没有宿主 webServer 的兜底，
    // 未捕获异常会直接击杀宿主进程（cycle-0 同族）。
    try {
      const t0 = Date.now()
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      // 独立端口也接受带挂载前缀（/kaogong/...）的路径：同源改写的图片 URL 在两种通道下通用
      const rawPath = url.pathname
      const path = rawPath.startsWith('/kaogong/') ? rawPath.slice('/kaogong'.length) : rawPath
      const params = url.searchParams
      const wsRaw = params.get('ws') || undefined

      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Cache-Control', 'no-store')
      const finish = (status, type, body) => {
        res.writeHead(status, { 'Content-Type': type })
        res.end(body)
        recordRequest(path, Date.now() - t0, status >= 400, isDeclaredEndpoint(path))
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); recordRequest(path, Date.now() - t0, false); return }
      if (path === '/' || path === '/index.html') {
        const ui = renderUI()
        return ui ? finish(200, 'text/html; charset=utf-8', ui) : finish(404, 'text/plain; charset=utf-8', 'UI not found')
      }
      if (path.startsWith('/api/')) {
        // 图片端点走二进制流（T-018），不进 JSON 链路
        if (path === '/api/paper-img') { domains.paperApi.serveImage(params, res); return }
        if (path === '/api/naoku-img') { domains.naokuApi.serveImage(params, res); return }
        if (path === '/api/tuxing-img') { domains.tuxingApi.serveImage(params, res); return }
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
