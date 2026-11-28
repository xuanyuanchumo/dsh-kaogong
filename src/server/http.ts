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
// 图片 MIME 白名单统一走 shared/media（四个出图端点同口径，杜绝 415 判据漂移）
import { imageMime } from '../shared/media.js'
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
import { makeNaokuApi } from './naokuApi.js'
import { makeTuxingApi } from './tuxingApi.js'
import { resetTuxing } from '../adapters/tuxing.js'
// cycle-60 R2 换源：深度题库统一读层 + 整库质量门（白盒提示用）
// cycle-62：makePoolNaokuReader 不再在 http 层实例化（naoku 域 handler 已退役；
// kadian 语义下沉到 poolApi，读层由 poolApi 内部实例化）。poolFresh 仍在用。
import { poolFresh } from './poolNaoku.js'
// cycle-60 T-038 图形推理无损换源：统一池读层
import { makePoolTuxingReader } from './poolTuxing.js'
// cycle-61 v9：统一数据门（按域就绪判定 + 按需摄入 single-flight）+ 域注册表
import { allDomainStatus, resetGateState, ensureDomain } from './dataGate.js'
import { auditDomains } from '../shared/domains.js'
import { makeMethodologyApi, resetMethodologyIndex } from './methodologyApi.js'
import { resolveReposRoot, USER_DATA_ROOT, PROGRESS_DIR_USER, migratePkgData, dataLocationReport } from './dataRoot.js'
import { makeRepoManager } from './repoManager.js'
import { makeHistoryApi } from './historyApi.js'
import { makePoolApi } from './poolApi.js'
import { createTelemetry, isDeclaredEndpoint, recordRequest, telemetrySnapshot, UNMATCHED_BUCKET } from './telemetry.js'
import { initPoolDb, resetPoolDb, putStudyEvent, poolDb, invalidateStatsCache, putSearchEvent, searchEventStats, enqueueUserWrite } from '../adapters/poolDb.js'
import { schedulePlan } from './planSchedule.js'
// cycle-60 统一缓存层：域|wsKey|rootFp|参数 四维度单一事实源（消除散落 TTL/LRU 与跨租户污染）
import { createCache } from './cache.js'
// cycle-61 v9：数据写入事件总线（缓存失效的唯一触发点）
import { bindCache, emitDataChanged, subscribeDataEvents, dataEventSubscribers } from './dataEvents.js'
// v9：统一错题/补录层（库侧单条 upsert——判分后错题本立即可见，不依赖整本镜像）
import { upsertWrongEntry } from './reviewStore.js'
// cycle-60 统一检索层：SearchProvider 运行时注册表（provider id/label 从 manifest 端点声明派生）
import { createSearchRegistry } from './searchRegistry.js'
// 阶段 4（issue #4 图片搜题）：图片识别域（AI 能力经 options.aiBridge 注入，零宿主包依赖）
import { makeImageSearchApi } from './imageSearchApi.js'

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
/**
 * 阶段 4（issue #4）：宿主 AI 能力桥。由 startServer/attachWebRoute 的 options 注入，
 * 本模块闭包持有（本代 fiber 一致）；server 层不 import 任何宿主包（依赖反转）。
 */
let aiBridge: any = null
// 允许 bridge=null：热重载新代无 AI 能力时必须清空，否则残留旧代闭包（R7 同族）
function setAiBridge(bridge: any) { aiBridge = bridge || null }
/** 统一缓存实例（进程内；换根时按域失效，不跨 fiber 共享可变状态——R7） */
const kgCache = createCache()
function buildDomains(root: string) {
  const store = makeWsStore(PROGRESS_DIR)
  // cycle-34 阶段 1：统一题目池域（`.kaogong.db` 存储层）
  // ⚠️ 装配顺序：**必须先于 srsApi**——SRS 抽题走存储层优先（I5/KERNEL-05），
  // 需要引用 poolApi.sampleQuestions（换根时随域一起重建，cycle-16 教训⑬）。
  const poolApi = makePoolApi({
    repoRoot: root, dataDir: DATA_DIR, store,
    // v9：重建/校验写入 → 统一变更广播（级联清派生缓存；适配层不 import server，经钩子反转依赖）
    onDataChanged: (entity: string, reason: string) => { emitDataChanged(entity as any, reason) },
  })
  /**
   * cycle-61 v9：统一数据门上下文（repoRoot + dataDir）。
   * 各域用它做「未就绪 → 按域摄入 → 重读」——**唯一**允许触及源文件的入口（摄入期）。
   */
  const dataCtx = { repoRoot: root, dataDir: DATA_DIR }
  const d = {
    root,
    store,
    dataCtx,
    srsApi: makeSrsApi({ repoRoot: root, store, pool: poolApi }),
    // cycle-60 R9：方法论参考走 knowledge 表（v9 起无 md 回落——域未就绪时按需摄入）
    dataApi: makeDataApi({ repoRoot: root, planFile: PLAN_FILE, dataCtx }),
    // v9：真题卷唯一读路径 = 统一池（paper/paper_material/question 卷级列）
    paperApi: makePaperApi({ repoRoot: root, store, dataCtx }),
    // cycle-62 收敛：/api/naoku/* 六端点已退役（语义下沉为 /api/pool/kadians、
    // /api/pool/by-kadian、/api/pool/papers-by-kadian）。此处只保留 naokuApi 的
    // **图片服务**（/api/naoku-img）——图片是媒体引用，不属于「题目事实直读」。
    naokuApi: makeNaokuApi({ repoRoot: root }),
    // v9：图推唯一读路径 = 统一池（source_extras 无损保留上游字段）
    tuxingApi: makeTuxingApi({ repoRoot: root, poolTuxing: makePoolTuxingReader(), dataCtx }),
    // cycle-18 花生十三体系方法论域：语料走数据根（与其它题库统一由「题库管理」配置），
    // 因此这里必须注入 repoRoot —— 数据根热切换时由 rebuildDomains 重建本域。
    // store 用于 trace 计数器按 wsKey 分槽隔离（cycle-17 ㉙ 跨项目污染教训）。
    methodologyApi: makeMethodologyApi({ pkgRoot: PKG_ROOT, repoRoot: root, dataDir: DATA_DIR, store, dataCtx }),
    // cycle-21 纸质补录域（issue #3）：搜索/补录/撤销，指纹与错题本同源
    // v9：搜索通道收敛为「池检索」唯一通道（naoku 直读与真题卷目录扫描已删除）
    historyApi: makeHistoryApi({ store, repoRoot: root, dataCtx }),
    poolApi,
    studyPlan: makeStudyPlan(PLAN_FILE),
  }
  // cycle-60 统一检索层：注册表随域工厂重建（换根无跨代状态残留——R7）；
  // provider id/label 从 manifest 端点声明派生（单一事实源），五 provider 全委托既有域函数零算法复制。
  const searchRegistry = createSearchRegistry(CAPABILITIES.endpoints as any, d as any)
  searchRegistry.registerBuiltins()
  ;(d as any).searchRegistry = searchRegistry
  // cycle-61 v9：**不再预先打开 .naoku.db**（运行期零外源直读）。
  // 它只在 ingestNaokuSource（适配层）内部按需以只读方式打开。
  // 统一库惰性打开（失败只降级——域内诚实报「未就绪」，绝不崩宿主）
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
    resetPoolDb()
    // cycle-61 v9：数据门状态（单飞/冷却）随换根清空——否则旧根的「源不可用」冷却会阻塞新根摄入
    resetGateState()    // cycle-60 统一缓存失效：graph 走 kgCache 域；tuxing 旧全局缓存纳入失效链（补 cycle-16 ⑬ 缺口）
    // v9：换根 = 全部内容型缓存的前提都变了（root 进键，但快照/派生域仍需显式清）
    kgCache.invalidate({ domain: 'graph' })
    kgCache.invalidate({ domain: 'tuxing' })
    kgCache.invalidate({ domain: 'stats' })
    kgCache.invalidate({ domain: 'search' })
    kgCache.invalidate({ domain: 'domains' })
    kgCache.invalidate({ domain: 'paperIndex' })
    resetTuxing()
  }
  return { root: next, changed }
}
const repoManager = makeRepoManager({ getRoot: getRepoRoot, onRootChanged: rebuildDomains })
getRepoRoot()   // 模块加载即解析一次（后续只读复用）

/**
 * v9：缓存门面绑定 + 本地快照清理器注册（模块装配期一次）。
 *
 * 为什么订阅者是「本地快照」而不是缓存门面自己：
 *   有些快照藏在模块内部（methodologyApi 的 idxSlot / dataApi 的模块分布 / poolDb 的
 *   statsCache），它们不是门面持有时序的对象，只能由宿主模块自己清。
 *   统一事件总线让「谁缓存谁负责清」成为契约，而不是靠人记住每个写入点补一行。
 */
bindCache(kgCache)
/**
 * v9-b：本地快照清理器**必须按实体过滤**。
 *
 * 事故（重建压测实测）：`methodology.idxSlot` 的 clear 不看实体——重建广播 'question'
 * 时也把方法论索引（25 篇正文解析，秒级成本）清空 → 重建后的首次检索要现场重建索引，
 * 统一检索因此稳定出现一档 ~5s 尖峰。
 * 正解：订阅者声明「我关心哪些实体」，只在这些实体变化时清自己。
 * 这也是「谁缓存谁负责清」契约的完整形态（漏了实体维度就等于过度失效）。
 */
subscribeDataEvents({
  name: 'poolDb.statsCache',
  // 任何实体变化都会影响统计聚合（题/卷/知识/关系/源/用户态）
  clear: () => { invalidateStatsCache('data-event') },
})
subscribeDataEvents({
  name: 'methodology.idxSlot',
  // 只有知识层变化才需要重建方法论索引（question/paper/user 变化与它无关）
  clear: (entity: any) => { if (entity === 'knowledge') resetMethodologyIndex() },
})
subscribeDataEvents({
  name: 'dataApi.moduleCounts',
  // 模块分布来自 question 表
  clear: (entity: any) => { if (entity === 'question') kgCache.invalidate({ domain: 'stats' }) },
})

// ══ 生命周期事件日志（环形 300 行）══
/**
 * 生命周期事件记录（cycle-61 v9-b：改为**内存环形 + 延迟刷盘**）。
 *
 * ── 旧实现的两处同步 I/O（重建压测实测）──
 *   每个事件都做 `appendFileSync` + `readFileSync(整文件)` + 可能的 `writeFileSync(重写)`。
 *   在重建期（WAL checkpoint 繁忙 + 磁盘 IO 饱和）这些同步调用会把主线程卡住数百毫秒
 *   （实测 `/api/status` 峰值 2316ms → 就是它）。
 *
 * ── 新语义 ──
 *   · 事件先进**内存环形**（有界，最多 300 + 缓冲），对外读取（`/api/lifecycle`、
 *     白盒面板）先读内存——**读路径不再碰文件**；
 *   · 刷盘节流：最多每 2 秒追加一次（一次性 append 本批事件）；
 *   · 裁剪按「每 100 次追加」执行，且只读一次文件；
 *   · 进程退出/热重载前 flush（`flushLifecycle`），保证审计链不丢。
 *   语义等价性：内存环形 == 文件尾部 300 条（字段与顺序不变）。
 */
const LIFECYCLE_RING_MAX = 300
const lifecycleMem: any[] = []
let lifecycleDirty = 0
let lifecycleLastFlush = 0
const LIFECYCLE_FLUSH_MS = 2000
let lifecycleAppendsSinceTrim = 0

function flushLifecycle(force = false): void {
  try {
    const now = Date.now()
    if (!lifecycleDirty) return
    if (!force && now - lifecycleLastFlush < LIFECYCLE_FLUSH_MS) return
    mkdirSync(DATA_DIR, { recursive: true })
    const batch = lifecycleMem.slice(-Math.min(lifecycleDirty, lifecycleMem.length))
    appendFileSync(LIFECYCLE_FILE, batch.map(e => JSON.stringify(e)).join('\n') + '\n')
    lifecycleDirty = 0
    lifecycleLastFlush = now
    lifecycleAppendsSinceTrim++
    // 裁剪节流：每 100 次追加做一次（读文件也只在这里发生）
    if (lifecycleAppendsSinceTrim >= 100) {
      lifecycleAppendsSinceTrim = 0
      const all = safeReadFile(LIFECYCLE_FILE, 900000)?.split('\n').filter(Boolean) || []
      if (all.length > LIFECYCLE_RING_MAX) writeFileSync(LIFECYCLE_FILE, all.slice(-LIFECYCLE_RING_MAX).join('\n') + '\n')
    }
  } catch { /* 日志失败不影响业务 */ }
}

function logLifecycle(event: any, data = {}) {
  try {
    lifecycleMem.push({ ts: new Date().toISOString(), event, ...data })
    if (lifecycleMem.length > LIFECYCLE_RING_MAX * 2) lifecycleMem.splice(0, lifecycleMem.length - LIFECYCLE_RING_MAX * 2)
    lifecycleDirty++
    flushLifecycle(false)
  } catch { /* 日志失败不影响业务 */ }
}



// ══ cycle-21（issue #1）：xingcezhenti 题库配图服务 ══
// 练习链路（/api/questions）的题干图片在 parseQuestions 时被剥成中立占位 `kgimg://相对路径`，
// 前端 RichText 把占位改写为 `${MOUNT_PATH}/api/kg-img?p=` 请求本端点。
// 安全模型与 naokuImage.safeImagePath 同族：resolve 归一后必须仍在 xingcezhenti 内 + 扩展名白名单。
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
  const mime = imageMime(extname(target))
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
    // v9-b：内存优先（读路径零文件 IO）；内存为空（冷启动首读）才回落文件
    if (lifecycleMem.length) return lifecycleMem.slice(-limit)
    const raw = safeReadFile(LIFECYCLE_FILE, 900000) || ''
    const list: any[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { list.push(JSON.parse(line)) } catch { /* 单行损坏：跳过 */ }
    }
    // 回读时把文件内容灌入内存环形，后续读就不再碰文件
    if (list.length) {
      lifecycleMem.push(...list.slice(-LIFECYCLE_RING_MAX))
      if (lifecycleMem.length > LIFECYCLE_RING_MAX) lifecycleMem.splice(0, lifecycleMem.length - LIFECYCLE_RING_MAX)
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
// cycle-60 统一缓存层：graphCache → kgCache（domain=graph，键含 ws|root，TTL/LRU 由门面统一持有）。
function graphSnapshot(wsRaw: any) {
  const cacheDims = { domain: 'graph', ws: domains.store.wsKey(wsRaw), root: domains.root }
  const hit = kgCache.get<any>(cacheDims)
  if (hit) return hit
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
  kgCache.set(cacheDims, data)
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

// ══ 核心路由（域链：显式顺序 + 逐域 await）══
/**
 * 域链分发。
 *
 * ⚠️ v9 重构要点：旧实现是 `a() ?? b() ?? c()` 的短路表达式（同步语义）。
 * v9 起多个域需要「未就绪 → 按需摄入 → 重读」的**异步**能力，而 `??` 无法 await
 * （对 Promise 对象只判断 truthy，会直接返回未解析的 Promise）。曾用 `?? await x()`
 * 补丁，但那只对单个域有效、且与同步域混排时求值顺序不可读。
 * 正解 = 显式循环：**顺序即优先级**，每个域独立 await，`undefined` 表示「不归我管」。
 *
 * 顺序纪律：
 *   repoManager（git 作业控制面）→ methodology（/api/huasheng13/*）
 *   → srs → history → pool（统一池）→ tuxing → naoku → paper → data → core
 */
const API_DOMAINS: Array<{ name: string, handle: (p: any, q: any, b: any, m: any, ws: any) => any }> = []
function registerApiDomains() {
  API_DOMAINS.length = 0
  API_DOMAINS.push(
    { name: 'methodology', handle: (p, q, b, m, ws) => domains.methodologyApi.handleAsync(p, q, b, m, ws) },
    { name: 'srs', handle: (p, q, b, m, ws) => domains.srsApi(p, q, b, m, ws) },
    { name: 'history', handle: (p, q, b, m, ws) => domains.historyApi.handle(p, q, b, m, ws) },
    // 统一池域插在 history 之后、tuxing 之前（研究 15 §2.3：`/api/pool/*` 前缀独立无冲突，
    // 但语义上「统一池」先于各专项域命中）
    { name: 'pool', handle: (p, q, b, m, ws) => domains.poolApi.handle(p, q, b, m, ws) },
    { name: 'tuxing', handle: (p, q) => domains.tuxingApi.handle(p, q) },
    // cycle-62：naoku 域 handler 已移除（6 端点退役，语义下沉到 pool 域）
    { name: 'paper', handle: (p, q, b, m, ws) => domains.paperApi.handle(p, q, b, m, ws) },
    { name: 'data', handle: (p, q, b, m) => domains.dataApi(p, q, b, m) },
    // 阶段 4（issue #4）：图片搜题域——AI 能力经 aiBridge 注入；检索复用统一检索层
    {
      name: 'imgsearch',
      handle: (p, q, b, m, ws) => makeImageSearchApi(aiBridge, {
        search: (query, opts) => domains.searchRegistry.searchMany(
          opts.provider ? [opts.provider] : [], query,
          { limit: opts.limit, ws: opts.ws || ws },
        ),
      }).handle(p, q, b, m, ws),
    },
  )
}

async function handleApi(path: any, params: any, post: any, method: any, wsRaw: any, port: any) {
  // cycle-16 题库管理域（异步：git 作业控制面）——前置于域链，仅接管 /api/repos*
  if (path.startsWith('/api/repos')) {
    const r = await repoManager.handle(path, params, post, method)
    if (r !== undefined) return r
  }
  if (!API_DOMAINS.length) registerApiDomains()
  for (const d of API_DOMAINS) {
    // 逐域 await：异步域（dataGate 按需摄入）必须被解析后再判 undefined
    const r = await d.handle(path, params, post, method, wsRaw)
    if (r !== undefined) return r
  }
  return await coreApi(path, params, post, method, wsRaw, port)
}

/**
 * 核心端点（信标 / 抽题 / 判分 / 进度 / 图 / 能力 / 白盒）。
 *
 * v9：改为 async —— 抽题（/api/questions）与能力对账需要在池未就绪时
 * **按需摄入一次**（dataGate）。路由层统一 await，域链语义不受影响
 * （判断 undefined 前已解析，见 handleApi）。
 */
async function coreApi(path: any, params: any, post: any, method: any, wsRaw: any, port: any) {
  if (path === '/api/status') {
    const rs = repoStats(domains.root)
    const p = domains.store.loadProgress(wsRaw || undefined)
    /**
     * v9 修正：`version` 必须透出（`StatusResponse` 类型声明它是必填，而实现此前没返回
     * → 类型与实现漂移，外部探针读到 undefined 只能当成「版本未知」）。
     * 版本号从 `CAPABILITIES.plugin.version` 取（版本三锚点守卫只认这一处事实源）。
     * `port`：同源路由下请求不带端口语义 → 传 0 表示「本次不是独立端口通道」，
     * 由独立端口的调用点传入真实端口（客户端只用 `app` 做通道识别，不依赖 port 判真伪）。
     */
    return {
      app: APP_NAME,
      version: CAPABILITIES.plugin.version,
      port: Number(port) || 0,
      pid: process.pid,
      uptimeSec: Math.round((Date.now() - BOOT_TS) / 1000),
      repos: rs,
      repoRoot: domains.root,
      db: exists(join(domains.root, 'GongkaoNaoku', 'kaogong.db')),
      ws: domains.store.wsKey(wsRaw),
      progress: { day: p.day, answered: p.answered, correct: p.correct, wrong: p.wrong, rate: p.answered ? Math.round(p.correct / p.answered * 100) : 0 },
    }
  }
  if (path === '/api/questions' && method === 'GET') {
    // v9：唯一取题入口（统一池）。池未就绪时**按需摄入一次**再重试——
    // 这是「装上题库即可用」的关键：用户不需要先手动点「重建」。
    // ⚠️ 兼容硬约束：响应形状零变化（options/correctAnswer/stem 的 kgimg:// 占位全保留）。
    const mod = params.get('module') || '判断推理'
    const cnt = parseInt(params.get('count') || params.get('limit') || '1')
    let out = getRandomQuestions(domains.root, mod, cnt, domains.poolApi)
    if (out && out.error) {
      const g = await ensureDomain('question', domains.dataCtx)
      if (g.ready) out = getRandomQuestions(domains.root, mod, cnt, domains.poolApi)
      if (out && out.error) return { ...out, questions: [], ingesting: !!g.ingesting, hint: g.hint || out.error }
    }
    return out
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
    /**
     * v9：错题本**库侧同步写**（单条 upsert）。
     *
     * 为什么必须在这里写：v9 起 `/api/wrong` 读路径**库优先**——若判分只改 JSON，
     * 用户答错后进错题本会看到「刚才那道错题不见了」（库里有旧行/无此行），
     * 这是比「读慢」严重得多的一致性问题。单条 upsert 而非整本替换，
     * 避免并发判分互相覆盖（SRS 真相是每题一行）。
     */
    try {
      const wsKey = domains.store.wsKey(wsRaw)
      if (wrongEvent && (wrongEvent.type === 'collected' || wrongEvent.type === 'promoted' || wrongEvent.type === 'mastered')) {
        const entry = (progress.wrongBook || []).find((w: any) => w.sig === wrongEvent.sig)
        if (entry) {
          /**
           * v9-b：改为**入队异步写**（不阻塞请求栈）。
           * 理由：重建时 worker 持写锁，同步 upsert 会让判分请求在 busy_timeout 里排队
           * （实测整条链被拖到秒级）。错题 upsert 是可重放的镜像写入，放后台安全。
           * ⚠️ 顺序保证：紧随其后的 saveProgress 镜像也在**同一队列**里，
           * 因此不会出现「进度镜像先跑、错题 upsert 后跑」导致的行覆盖颠倒。
           */
          enqueueUserWrite(() => {
            try {
              upsertWrongEntry(wsKey, {
                ...entry,
                canonicalId: String((q as any).id || '').startsWith('q:') ? String((q as any).id) : (entry.canonicalId || ''),
                kadian: (q as any).dims && (q as any).dims.kadian,
                dims: (q as any).dims,
                lastResult: isCorrect ? 'right' : 'wrong',
                srsDueAt: Number(entry.lastAt || Date.now()),
                firstAt: entry.firstAt || Number(entry.lastAt || Date.now()),
                lapses: isCorrect ? entry.lapses || 0 : Number(entry.lapses || 0) + 1,
              })
            } catch { /* 单次镜像失败静默 */ }
          })
        }
      }
    } catch { /* 库写失败不影响判分返回（JSON 仍是兼容写回） */ }
    // cycle-38 阶段 2（研究 15 C7）：学习事件**双写**——progress json 仍是统计/错题本
    // 的权威事实源（读路径零改动），study_event 只沉淀事件流水（阶段 3 按 kadian
    // 诊断的原料）。写失败静默（流水丢失不影响判分主链路）。
    try {
      const ev = {
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
      }
      // v9-b：流水走写队列（判分是核心路径，不该为一条统计 INSERT 在写锁上排队）
      enqueueUserWrite(() => { try { putStudyEvent(poolDb(), ev) } catch { /* 单条静默 */ } })
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
  // cycle-60 统一检索层：单一入口 + 统一信封；provider 从 manifest 声明派生，旧五端点零删改
  // v9：① 支持 providers=a,b,c 聚合检索（交替合并，保留各组原序，不跨源比分数）；
  //     ② 走统一缓存层（domain=search，键含 ws/root/query/provider/limit）；
  //     ③ 每次调用记检索流水（search_event 表）——「哪个 provider 常空/慢」是可观测事实。
  if (path === '/api/search/unified' && method === 'GET') {
    const rawIds = params.get('providers') || params.get('provider') || 'pool'
    const ids = String(rawIds).split(',').map(s => s.trim()).filter(Boolean)
    const q = params.get('q') || ''
    const limit = parseInt(params.get('limit') || '20', 10)
    const wsKey = domains.store.wsKey(wsRaw)
    const cacheDims = { domain: 'search', ws: wsKey, root: domains.root, params: { ids: ids.join(','), q, limit, repo: params.get('repo') || '', module: params.get('module') || '' } }
    const hit = kgCache.get<any>(cacheDims)
    if (hit) return { ...hit, cached: true }
    const t0 = Date.now()
    const out = ids.length > 1
      ? await domains.searchRegistry.searchMany(ids, q, { limit, ws: wsKey, repo: params.get('repo') || undefined, module: params.get('module') || undefined })
      : await domains.searchRegistry.search(ids[0] || 'pool', q, { limit, ws: wsKey, repo: params.get('repo') || undefined, module: params.get('module') || undefined })
    const tookMs = Date.now() - t0
    // 检索流水：按 provider 逐一记（聚合检索时每组都记一条，白盒才能按 provider 归因）
    try {
      for (const id of ids) {
        const grp = (out as any).groups && (out as any).groups.find((g: any) => g.provider === id)
        const rec = { ws: wsKey, provider: id, query: q, total: grp ? grp.total : (out as any).total, tookMs: grp && grp.took != null ? grp.took : tookMs }
        // v9-b：流水走写队列（检索是高频读路径，不应为一条统计 INSERT 阻塞）
        enqueueUserWrite(() => { try { putSearchEvent(poolDb(), rec) } catch { /* 单条静默 */ } })
      }
    } catch { /* 流水写失败不影响检索返回 */ }
    /**
     * ⚠️ v9 纪律：**空结果不缓存**。
     * 空结果有两种成因：① 确实没有命中；② 该域数据尚未入库（首次访问，正在按需摄入）。
     * 若把 ② 也缓存，用户装好题库后 30s 内仍然搜不到东西——「缓存了一个错误的前提」。
     * 正解：只缓存非空信封；空信封每次都实查（成本低：FTS 空表查询 <1ms）。
     */
    if ((out as any).total > 0) kgCache.set(cacheDims, out)
    return out
  }
  // cycle-60 检索注册表白盒：ids 必须与 manifest 声明检索端点同源（对账口径）
  // v9：+ 域归属 + 依赖池标记（前端选择器与「先装哪个题库」引导用）
  //     + 检索流水聚合（provider 维度调用数/空命中率/平均耗时）
  if (path === '/api/search/providers' && method === 'GET') {
    return {
      providers: domains.searchRegistry.ids(),
      list: domains.searchRegistry.list(),
      stats: (() => { try { return searchEventStats(poolDb()) } catch { return [] } })(),
    }
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
  /**
   * cycle-61 v9：统一缓存白盒——「缓存到底有没有用」的机器证据。
   * 透出每域命中率（未访问域为 null，不臆造 0%）、快照清单（含构建时刻）、
   * 失效级联图（改什么会连带清什么，架构事实可观测）与策略（TTL/槽位上限）。
   */
  if (path === '/api/cache') {
    // 订阅者清单也透出（「哪些模块有自己的本地快照」是架构事实，便于排查陈旧数据）
    const st = kgCache.stats()
    return { ...st, subscribers: dataEventSubscribers() }
  }
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
  /**
   * cycle-61 v9：统一数据层白盒——**域就绪矩阵**是「数据在哪、哪个域没入库」的唯一事实源。
   * 每个域透出：就绪谓词实测值（表/条件/行数）+ 缺哪个源 + 归属视图 + 可操作提示。
   * 纪律：只读、不触发摄入（白盒查询不得有副作用——否则打开面板会偷偷重建库）。
   */
  if (path === '/api/data-domains') {
    const list = allDomainStatus()
    const problems = auditDomains()
    // 整库质量门（与域就绪分工不同：前者判「数据质量达基线」，后者判「数据在不在」）
    const quality = (() => { try { return poolFresh() } catch { return false } })()
    const pending = list.filter(d => !d.ready)
    return {
      domains: list,
      contracts: { problems, consistent: problems.length === 0 },
      quality: { fresh: quality, hint: quality ? null : '统一池数据为旧版本（cf 污染/低 schema/图推覆盖不足）——建议在「🗄️ 统一题库」重建' },
      // 未就绪域的可操作汇总：分「正在入库」与「缺源待装」两类（前端据此决定轮询还是引导）
      pending: pending.filter(d => !d.ingesting).map(d => ({ id: d.id, label: d.label, sources: d.sources })),
      ingesting: pending.filter(d => d.ingesting).map(d => ({ id: d.id, label: d.label, sources: d.sources })),
      ready: list.filter(d => d.ready).length,
      total: list.length,
    }
  }
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
  setAiBridge(options.aiBridge)
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
      if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') continue
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
export function attachWebRoute(webServer: any, mountPath = '/kaogong', options: any = {}) {
  setAiBridge(options.aiBridge)
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
          finish(500, 'application/json; charset=utf-8', JSON.stringify({ error: (e as Error).message }))
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

      /**
       * ── CORS 加固（cycle-68 · 市场评审指出的真实安全缺陷）──
       *
       * 原实现无条件 `Access-Control-Allow-Origin: *`，配合「只绑 127.0.0.1」看似安全，
       * 实际**本机任何网页**（用户浏览的任意站点）都能用 `fetch('http://127.0.0.1:8400/api/…')`
       * 读到本地库数据、甚至 POST /api/check 写进度 —— 上游 awesome-dsh-plugin 的条目里
       * 维护者就明确写了这一点（"Its HTTP routes have no DSH access check, so a web page
       * open in your browser could call them."）。
       *
       * 正解 = **回环来源才放行**（与「只绑 127.0.0.1」口径一致）：
       *   · 同源请求（浏览器导航/同源 fetch）不带 Origin 或带本机回环 Origin → 放行
       *   · 跨站 web 页面（Origin 是 https://evil.com）→ 不返回 CORS 头 → 浏览器读不到响应
       * 注意：CORS 只防「读响应」，防不住「写副作用」（POST 仍会到达服务端）。
       * 故同时对**变更类方法**做 Origin 校验：非法来源直接 403，不执行任何写操作。
       */
      const origin = String(req.headers.origin || '')
      const originOk = !origin || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)
      if (originOk) {
        // 回显具体来源而非 `*`：`*` 会让任何站点都能读；回显回环来源则只对同源生效
        res.setHeader('Access-Control-Allow-Origin', origin || 'null')
        res.setHeader('Vary', 'Origin')
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Cache-Control', 'no-store')
      // 变更类请求的跨站拦截（CORS 管不住写副作用，必须服务端拒绝）
      if (!originOk && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '拒绝跨站写请求（来源不被信任）', origin }))
        return
      }
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
            finish(500, 'application/json; charset=utf-8', JSON.stringify({ error: (e as Error).message }))
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
