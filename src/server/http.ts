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
import { CAPABILITIES, buildGraph, graphMetrics, healthScore } from '../shared/manifest.js'
import { REPOS, XINGCE_MODULES, safeReadFile, exists, safeReadDir, getRandomQuestions, repoStats } from '../adapters/repoData.js'
import { makeWsStore } from './ws.js'
import { makeSrsApi, srsHooks } from './srs.js'
import { makeDataApi, makeStudyPlan } from './dataApi.js'
import { makePaperApi } from './paperApi.js'
import { makeNaokuApi, initNaoku } from './naokuApi.js'
import { makeTuxingApi } from './tuxingApi.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..', '..')          // <pkg>
export const REPO_ROOT = resolve(PKG_ROOT, '..')    // 15 仓库所在根
const DATA_DIR = join(PKG_ROOT, 'data')
const PROGRESS_DIR = join(DATA_DIR, 'progress')
const RUNTIME_FILE = join(DATA_DIR, 'runtime.json')
const LIFECYCLE_FILE = join(DATA_DIR, 'lifecycle.jsonl')
const PLAN_FILE = join(DATA_DIR, 'study-plan.md')
const APP_NAME = 'dsh-kaogong'
const BOOT_TS = Date.now()

// 域装配（依赖注入，无全局单例耦合）
const store = makeWsStore(PROGRESS_DIR)
const { loadProgress, saveProgress, wsKey, listWorkspaces } = store
const srsApi = makeSrsApi({ repoRoot: REPO_ROOT, store })
const dataApi = makeDataApi({ repoRoot: REPO_ROOT, planFile: PLAN_FILE })
const paperApi = makePaperApi({ repoRoot: REPO_ROOT, store })
const naokuApi = makeNaokuApi({ repoRoot: REPO_ROOT, dataDir: DATA_DIR, store })
const tuxingApi = makeTuxingApi({ repoRoot: REPO_ROOT })
// Naoku 深度题库惰性初始化（node:sqlite 动态 import；失败则优雅降级）
initNaoku(REPO_ROOT, DATA_DIR).catch(() => {})
const studyPlan = makeStudyPlan(PLAN_FILE)

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

function recordRequest(path: any, ms: any, isError: any): void {
  const t = (telemetry.endpoints[path] = telemetry.endpoints[path] || { count: 0, errors: 0, lat: [] })
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
  for (const [path, t] of entries(telemetry.endpoints)) {
    const sorted = [...t.lat].sort((a, b) => a - b)
    eps[path] = {
      count: t.count, errors: t.errors,
      errRate: t.count ? +(t.errors / t.count).toFixed(3) : 0,
      p50: percentile(sorted, 50), p95: percentile(sorted, 95),
      lastActive: t.lastTs ? Math.round((now - t.lastTs) / 1000) : null,
      series: t.lat,
    }
  }
  const totalReq = Object.values(eps).reduce((s: number, e: any) => s + e.count, 0)
  return {
    uptimeSec: Math.round((now - BOOT_TS) / 1000),
    qpsWindow: +(inWindow / (telemetry.window / 1000)).toFixed(3),
    totalRequests: totalReq,
    endpoints: eps,
    activeEndpoints: Object.keys(eps).length,
    declaredEndpoints: CAPABILITIES.endpoints.length,
    coverage: +(Object.keys(eps).length / CAPABILITIES.endpoints.length).toFixed(3),
  }
}

// ══ 图谱快照（5s TTL 缓存；节点/边/指标/健康度）══
let graphCache: any = { ts: 0, data: null }
function graphSnapshot(wsRaw) {
  const now = Date.now()
  if (graphCache.data && now - graphCache.ts < 5000) return graphCache.data
  const banks = {
    banks: Object.fromEntries(entries(REPOS).map(([k, v]) => [k, { desc: v, exists: exists(join(REPO_ROOT, k)) }])),
    ...repoStats(REPO_ROOT),
  }
  const modules = { modules: Object.fromEntries(entries(XINGCE_MODULES).map(([name, dir]) => {
    const p = join(REPO_ROOT, 'xingcezhenti', dir)
    return [name, { dir, fileCount: exists(p) ? safeReadDir(p).filter(f => f.endsWith('.md')).length : 0 }]
  })) }
  const plan = studyPlan('all')
  delete plan.raw
  const ge = buildGraph({ banks, modules, plan })
  const metrics = graphMetrics(ge.nodes, ge.edges)
  const tel = telemetrySnapshot()
  const p = loadProgress(wsRaw)
  const data = {
    generatedAt: new Date().toISOString(),
    nodes: ge.nodes, edges: ge.edges,
    metrics: { V: metrics.V, E: metrics.E, density: metrics.density, orphans: metrics.orphans, components: metrics.components },
    rank: entries(metrics.rank).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, v]) => ({ id, pr: +v.toFixed(4) })),
    health: healthScore({ metrics, telemetry: tel, banks }),
    progress: { day: p.day, answered: p.answered, byModule: Object.keys(p.byModule || {}).length },
    banks: { ready: banks.ready, total: banks.total },
  }
  graphCache = { ts: now, data }
  return data
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

// ══ 核心路由（域链分发：srs ?? paper ?? data ?? core）══
function handleApi(path, params, post, method, wsRaw, port) {
  return srsApi(path, params, post, method, wsRaw)
    ?? tuxingApi.handle(path, params)
    ?? naokuApi.handle(path, params, post, method, wsRaw)
    ?? paperApi.handle(path, params, post, method, wsRaw)
    ?? dataApi(path, params, post, method)
    ?? coreApi(path, params, post, method, wsRaw, port)
}

function coreApi(path, params, post, method, wsRaw, port) {
  if (path === '/api/status') {
    const rs = repoStats(REPO_ROOT)
    const p = loadProgress(wsRaw)
    return {
      app: APP_NAME, port, pid: process.pid, uptimeSec: Math.round((Date.now() - BOOT_TS) / 1000),
      repos: rs,
      db: exists(join(REPO_ROOT, 'GongkaoNaoku', 'kaogong.db')),
      ws: wsKey(wsRaw),
      progress: { day: p.day, answered: p.answered, correct: p.correct, wrong: p.wrong, rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 },
    }
  }
  if (path === '/api/questions' && method === 'GET') {
    return getRandomQuestions(REPO_ROOT, params.get('module') || '判断推理', parseInt(params.get('count') || params.get('limit') || '1'))
  }
  if (path === '/api/check' && method === 'POST') {
    const q = post.question
    if (!q || !q.correctAnswer) return { error: '缺少题目对象（需含 correctAnswer）' }
    const answer = (post.answer || '').toUpperCase().trim()
    const isCorrect = answer === q.correctAnswer
    const progress = loadProgress(wsRaw)
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
    saveProgress(wsRaw, progress)
    return { isCorrect, correctAnswer: q.correctAnswer, analysis: q.analysis, wrongEvent, progress: { answered: progress.answered, correct: progress.correct, wrong: progress.wrong, rate: Math.round(progress.correct / progress.answered * 100) } }
  }
  if (path === '/api/progress' && method === 'GET') {
    const p = loadProgress(wsRaw)
    return { ...p, ws: wsKey(wsRaw), rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 }
  }
  if (path === '/api/progress' && method === 'POST') {
    const p = loadProgress(wsRaw)
    if (post.day) p.day = Math.max(1, Math.min(30, post.day))
    if (post.label) p.label = post.label
    if (post.reset) { p.answered = 0; p.correct = 0; p.wrong = 0; p.history = []; p.byModule = {}; p.wrongBook = [] }
    saveProgress(wsRaw, p)
    return { ...p, ws: wsKey(wsRaw), rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 }
  }
  if (path === '/api/graph') return graphSnapshot(wsRaw)
  if (path === '/api/telemetry') return telemetrySnapshot()
  if (path === '/api/capabilities') {
    const tel = telemetrySnapshot()
    const consumed = new Set(Object.keys(tel.endpoints))
    return { ...CAPABILITIES, runtime: { consumedEndpoints: [...consumed], coverage: tel.coverage, uptimeSec: tel.uptimeSec }, orphans: CAPABILITIES.endpoints.filter(e => !consumed.has(e.path)).map(e => e.path) }
  }
  if (path === '/api/workspaces') return { workspaces: listWorkspaces() }
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
  const ports = Array.from({ length: 5 }, (_, i) => preferredPort + i)
  for (const port of ports) {
    const beacon = await probePort(port)
    if (beacon) { logLifecycle('server-adopt', { port, pid: beacon.pid }); return { server: null, port, adopted: true } }
    const server = buildHttpServer(port)
    try {
      await tryListen(server, port)
      if (publishRuntime) writeRuntime({ port, pid: process.pid })
      logLifecycle(publishRuntime ? 'server-listen' : 'server-listen-probe', { port })
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
      recordRequest(mountPath + rel, Date.now() - t0, status >= 400)
    }
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    if (rel === '/' || rel === '/index.html') {
      const ui = renderUI()
      return ui ? finish(200, 'text/html; charset=utf-8', ui) : finish(404, 'text/plain; charset=utf-8', 'UI not found')
    }
    if (rel.startsWith('/api/')) {
      // 图片端点走二进制流（T-018），不进 JSON 链路
      if (rel === '/api/paper-img') { paperApi.serveImage(params, res); return }
      if (rel === '/api/naoku-img') { naokuApi.serveImage(params, res); return }
      if (rel === '/api/tuxing-img') { tuxingApi.serveImage(params, res); return }
      let body = ''
      req.on('data', c => body += c)
      req.on('end', () => {
        try {
          const post = body ? JSON.parse(body) : {}
          finish(200, 'application/json; charset=utf-8', JSON.stringify(handleApi(rel, params, post, req.method, wsRaw, 0)))
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
        recordRequest(path, Date.now() - t0, status >= 400)
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); recordRequest(path, Date.now() - t0, false); return }
      if (path === '/' || path === '/index.html') {
        const ui = renderUI()
        return ui ? finish(200, 'text/html; charset=utf-8', ui) : finish(404, 'text/plain; charset=utf-8', 'UI not found')
      }
      if (path.startsWith('/api/')) {
        // 图片端点走二进制流（T-018），不进 JSON 链路
        if (path === '/api/paper-img') { paperApi.serveImage(params, res); return }
        if (path === '/api/naoku-img') { naokuApi.serveImage(params, res); return }
        if (path === '/api/tuxing-img') { tuxingApi.serveImage(params, res); return }
        let body = ''
        req.on('data', c => body += c)
        req.on('end', () => {
          try {
            const post = body ? JSON.parse(body) : {}
            finish(200, 'application/json; charset=utf-8', JSON.stringify(handleApi(path, params, post, req.method, wsRaw, port)))
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
