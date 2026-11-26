/**
 * server/dataGate.ts — 统一数据门（cycle-61 v9 · 消除外源直读的机制内核）
 *
 * ── 问题（v8 及以前的结构性缺陷）──
 *   六个域各自决定「读池还是读外源」，于是同一份上游在请求路径被反复读取：
 *     naokuApi → .naoku.db 直查 · paperApi → gwy-zhenti md 逐卷扫 · tuxingApi → data.js 解析
 *     dataApi → 三仓 md DFS · historyApi → 真题卷目录扫描 · methodologyApi → 语料目录
 *   更糟的是：这些回落分支让「池未就绪」变成**静默的正常路径**——数据层是否真的在供数，
 *   只有看响应里的 sourceTier 才知道。用户报「装了题库但功能不全」正是这个结构的必然结果。
 *
 * ── v9 的正解：把「读外源」这个分支**从运行期删除** ──
 *   请求路径只允许两种结果：
 *     ① 域就绪 → 读 `.kaogong.db`；
 *     ② 域未就绪 → **触发该域的摄入**（只摄该域的源，不重跑全库）→ 再读库；
 *        若摄入后仍未就绪（源未安装/上游缺失）→ 返回**结构化未就绪**（含可操作提示）。
 *   外源文件从此只出现在**适配层（摄入期）**，运行期零直读——这就是 I-DB-1 不变量。
 *
 * ── 并发纪律（关键）──
 *   同一域的按需摄入必须**单飞（single-flight）**：10 个并发请求同时命中「paper 域未就绪」
 *   不能起 10 次摄入（会把事件循环打满、把库锁死在 SQLITE_BUSY）。故用 inflight Map
 *   做 Promise 去重；结合 TTL 冷却（刚摄过就不再摄）避免频繁重试。
 *
 * ── 与 freshness 的分工（勿混用）──
 *   `poolObservability.computeFreshness`：整库数据质量是否达到基线（全局、严格）；
 *   `ensureDomain`：这个域的数据在不在库里（按域、结构、驱动按需摄入）。
 *   两者由不同守卫锚定，不可互相替代（见 shared/domains.ts 注释）。
 */
import { poolDb, invalidateStatsCache } from '../adapters/poolDb.js'
import { ingestAll } from '../adapters/poolSources.js'
import { rebuildFts } from '../adapters/poolDb.js'
import { findDomain, DOMAINS, type DomainId } from '../shared/domains.js'
import { emitDataChanged, type DataEntity } from './dataEvents.js'

/**
 * 域 → 变更实体（失效图的源域）。
 * 判据：这个域摄入后，**哪些已有缓存的前提变了**。
 * 例：paper 域摄入 → paper 表与 question 卷级列都变了 → 用 'paper' 源域（级联清 stats/search/domains）。
 */
const ENTITY_OF_DOMAIN: Record<string, DataEntity> = {
  question: 'question', pool: 'question', tuxing: 'question',
  paper: 'paper', method: 'knowledge', knowledge: 'knowledge',
}

/** 就绪探测（纯读；不抛错） */
interface ReadyState {
  ready: boolean
  /** 各判据的实测值（白盒可解释：为什么判未就绪） */
  details: Array<{ table: string, where: string, min: number, rows: number, ok: boolean }>
}

const EMPTY_READY: ReadyState = { ready: false, details: [] }

/**
 * 域就绪判定（纯查询，无副作用）。
 * 判据来自 shared/domains.ts 的 ready 声明——单一事实源，本函数不写第二套口径。
 */
export function domainReady(id: DomainId | string, db: any = poolDb()): ReadyState {
  const spec = findDomain(String(id))
  if (!spec) return EMPTY_READY
  if (!db) return { ready: false, details: spec.ready.map(r => ({ table: r.table, where: r.where || '', min: r.min || 1, rows: 0, ok: false })) }
  const details = spec.ready.map(r => {
    const min = r.min == null ? 1 : Number(r.min)
    let rows = 0
    try {
      const sql = `SELECT COUNT(*) c FROM ${r.table}` + (r.where ? ` WHERE ${r.where}` : '')
      const got = db.prepare(sql).get() as any
      rows = got && got.c != null ? Number(got.c) : 0
    } catch { rows = 0 }
    return { table: r.table, where: r.where || '', min, rows, ok: rows >= min }
  })
  return { ready: details.every(d => d.ok), details }
}

/** 全部域的就绪快照（白盒面板「数据域」区块的数据源） */
export function allDomainStatus(db: any = poolDb()): any[] {
  return DOMAINS.map(d => {
    const st = domainReady(d.id, db)
    return {
      id: d.id, label: d.label, desc: d.desc, views: d.views, sources: d.sources,
      ready: st.ready, details: st.details,
      /** 该域是否正在后台摄入（前端据此显示「入库中…」并轮询） */
      ingesting: isIngesting(d.id),
      ingestMode: d.ingestMode,
      // 不可探测（库未就绪）用 null 而非 false 的语义化区分：ready=false 但 available=false 表示「不知道」
      available: !!db,
    }
  })
}

/* ══ 按需摄入（single-flight + 冷却） ══ */

/** 单飞表：域 id → 进行中的 Promise */
const inflight = new Map<string, Promise<any>>()
/** 冷却表：域 id → 上次摄入完成时刻（防止「源不可用」时每个请求都重试摄入） */
const lastAttempt = new Map<string, number>()
/** 冷却时长：源不可用时 60s 内不再重试（用户装好题库后最多等 1 分钟，或点「立即重建」绕过） */
const COOLDOWN_MS = 60_000

export interface EnsureResult {
  /** 域是否已就绪（可读库） */
  ready: boolean
  /** 本次是否真的执行了（或启动了）摄入 */
  ingested: boolean
  /** 摄入结果（未摄入为 null；后台模式为 { state:'running' }） */
  ingest?: any
  /** 未就绪时的可操作提示（结构化，面板直接渲染） */
  hint?: string
  /** 域 id */
  domain: string
  /** 后台摄入是否正在进行（前端据此轮询 /api/data-domains） */
  ingesting?: boolean
}

/**
 * 确保某域数据在库内（就绪 → 直接返回；未就绪 → 按需摄入一次）。
 *
 * ── 等待策略由域声明决定（勿一刀切）──
 *   · `ingestMode:'sync'`       → await 摄入（毫秒~秒级，用户无感）；
 *   · `ingestMode:'background'` → **不等**，立即返回 ready:false + ingesting:true，
 *     摄入在后台跑完（前端轮询 /api/data-domains 看就绪翻转）。
 *   理由（实测）：gwy-zhenti 首次摄入 149s、naoku 数十秒——把这种量级挂在
 *   HTTP 请求上必然超时（浏览器默认 30~60s），用户只会看到「请求失败」，
 *   而完全不知道后台其实正在装。返回「正在入库」比返回「请求超时」诚实得多，
 *   也给了 UI 一个可以画进度条的确定状态。
 *
 * @param id        域 id
 * @param ctx       { repoRoot, dataDir } 摄入上下文（由 buildDomains 注入）
 * @param opts.force 跳过冷却（用户显式点「重建」时）；opts.wait 强制等待（测试/脚本用）
 */
export async function ensureDomain(
  id: DomainId | string,
  ctx: { repoRoot: string, dataDir: string },
  opts: { force?: boolean, wait?: boolean } = {},
): Promise<EnsureResult> {
  const key = String(id)
  const spec = findDomain(key)
  if (!spec) return { ready: false, ingested: false, domain: key, hint: `未知数据域：${key}` }

  const before = domainReady(key)
  if (before.ready) return { ready: true, ingested: false, domain: key }

  // 单飞：同域并发请求共享同一次摄入
  const running = inflight.get(key)
  if (running) {
    const background = spec.ingestMode === 'background' && !opts.wait
    if (background) {
      return { ready: false, ingested: true, domain: key, ingesting: true, ingest: { state: 'running' }, hint: hintOf(spec.label, spec.sources, true) }
    }
    const ingest = await running
    const after = domainReady(key)
    return { ready: after.ready, ingested: true, ingest, domain: key, hint: after.ready ? undefined : hintOf(spec.label, spec.sources) }
  }

  // 冷却：刚失败过就不要每个请求都撞一次（保护事件循环；force 可绕过）
  const last = lastAttempt.get(key) || 0
  if (!opts.force && Date.now() - last < COOLDOWN_MS) {
    return { ready: false, ingested: false, domain: key, hint: hintOf(spec.label, spec.sources) }
  }

  const task = (async () => {
    try {
      const db = poolDb()
      if (!db) return { ok: false, error: '统一库未就绪（node:sqlite 不可用）' }
      // 只摄该域的源（不重跑全库——这是「按域供数」与「全量重建」的关键区别）
      const out = await ingestAll({ repoRoot: ctx.repoRoot, dataDir: ctx.dataDir, db, opts: {} }, spec.sources)
      // 知识域与题域都要刷新对应 FTS（外部内容表必须显式 rebuild 才与内容一致）
      try { rebuildFts(db) } catch { /* FTS 重建失败不阻塞供数（检索降级为 LIKE） */ }
      // v9：**单一失效触发点**——按域摄入后广播「这些实体变了」，缓存门面沿失效图级联清理，
      // 各模块本地快照（统计/方法论索引/模块分布）经订阅者一并清空。
      // 纪律：写入路径不允许各自手写失效（漏一处 = 面板撒谎），只允许调本函数。
      const ent = ENTITY_OF_DOMAIN[key] || 'question'
      try { emitDataChanged(ent, 'domain-ingest:' + key) } catch { /* 失效失败降级为重算 */ }
      invalidateStatsCache('domain-ingest:' + key)
      return { ok: true, sources: out }
    } catch (e: any) {
      return { ok: false, error: (e && e.message) || String(e) }
    } finally {
      inflight.delete(key)
      lastAttempt.set(key, Date.now())
    }
  })()
  inflight.set(key, task)

  // 后台模式：不等待（但保留 single-flight，前端轮询期间不会重复启动）
  if (spec.ingestMode === 'background' && !opts.wait) {
    return { ready: false, ingested: true, domain: key, ingesting: true, ingest: { state: 'running' }, hint: hintOf(spec.label, spec.sources, true) }
  }
  const ingest = await task
  const after = domainReady(key)
  return {
    ready: after.ready, ingested: true, ingest, domain: key,
    hint: after.ready ? undefined : hintOf(spec.label, spec.sources),
  }
}

/** 未就绪提示（可操作：告诉用户缺哪个源、去哪里装——不制造死路，教训「降级≠死路」） */
function hintOf(label: string, sources: string[], ingesting = false): string {
  if (ingesting) {
    return `${label}数据正在入库（源：${sources.join(' / ') || '无'}）——该域数据量较大，` +
      '通常 1~3 分钟完成，本页会自动刷新；也可到「🗄️ 统一题库」查看进度。'
  }
  return `${label}数据尚未入库（缺源：${sources.join(' / ') || '无'}）。` +
    '请到「📦 题库管理」安装对应题库，或在「🗄️ 统一题库」点「重建」后重试。'
}

/** 某域是否正在后台摄入（白盒/前端轮询用） */
export function isIngesting(id: DomainId | string): boolean {
  return inflight.has(String(id))
}

/** 清空冷却与单飞状态（换根/测试隔离用；不触碰库数据） */
export function resetGateState(): void {
  inflight.clear()
  lastAttempt.clear()
}
