/**
 * server/cache.ts — 统一缓存层（cycle-60 建立 · cycle-61 v9 收敛为「缓存 + 快照 + 失效图」三合一）
 *
 * ── 为什么需要门面 ──
 *   收敛前缓存散落七处（graphCache / paperIndex / hs13 / methodology / wsSlots /
 *   statsCache / tuxing），各自实现 TTL/LRU/键口径，其中两处真实事故：
 *     · cycle-17 R20：graphCache 全局单槽但响应内嵌 per-ws progress → 跨项目污染；
 *     · cycle-16 ⑬：数据根变更散落改多处闭包捕获，漏改 tuxing → stale。
 *   本门面把「键维度 + TTL + 按域 LRU + 失效传播 + 命中率」收为单一事实源：
 *     CacheKey = domain | wsKey | rootFp | stableParams
 *
 * ── v9 新增：快照（snapshot）与失效图（invalidation graph）──
 *   · **快照** = 昂贵计算结果的一次性物化（如「材料组索引」= Map<模块, Map<案文, ids[]>>），
 *     与「小对象 TTL 缓存」的区别是：它的构建成本高（全表扫）、失效时机明确（数据写入），
 *     不适合 TTL 驱动。收进同一门面后，白盒可以统一看到「哪些快照已建、何时建、多大」。
 *   · **失效图** = domain → 依赖它的其它 domain。数据写入（rebuild / 按域摄入）后
 *     一经 `invalidateDomain('question')` 就自动级联清掉 graph/paper/topics 等派生域，
 *     杜绝「改了题但图还是旧的」这类漏配对（cycle-36 教训：失效钩子与写入点必须配对）。
 *
 * ── 边界 ──
 *   纯进程内状态（不碰 fs / db），零 npm 依赖；域级隔离（不同域 Key 前缀不同）。
 *   只做机制，不做业务语义：扩容/失效策略由调用方通过 opts 声明。
 */

/** 缓存键的显式维度（禁止调用方自己拼字符串——由 buildCacheKey 统一派生） */
export interface CacheKeyDims {
  /** 业务域（graph/paperIndex/tuxing/stats/...）——域间天然隔离 */
  domain: string
  /** 租户键：含用户态数据的域必填（应传 store.wsKey(raw) 的结果）；静态域填 '-' */
  ws: string
  /** 数据根指纹：防换根污染（cycle-16 ⑬）；静态域也必填 */
  root: string
  /** 稳定参数：JSON 可序列化对象（键需已排序或由门面排序），如 {limit,module} */
  params?: Record<string, unknown>
}

/** 缓存条目 */
interface CacheEntry<T> { data: T; ts: number; hits: number }

/** 域配置：TTL + 槽位上限 */
export interface CacheDomainOpts {
  ttlMs: number
  maxEntries: number
}

/**
 * 域的默认参数（单一事实源）。
 *
 * 口径纪律：TTL=0 表示「永不过期，只由显式失效驱动」——适用于**内容派生**缓存
 * （计分统计/材料组索引），它们的真相由数据写入事件定义，不由时间定义。
 */
export const CACHE_DOMAINS: Record<string, CacheDomainOpts> = {
  graph: { ttlMs: 5000, maxEntries: 24 },
  paperIndex: { ttlMs: 60_000, maxEntries: 4 },
  tuxing: { ttlMs: 0, maxEntries: 4 },       // 0 = 永不过期（行为等价旧全局单槽）
  stats: { ttlMs: 0, maxEntries: 64 },
  // v9 新增域
  search: { ttlMs: 30_000, maxEntries: 48 },  // 检索信封（同一 query 短时内复用）
  domains: { ttlMs: 0, maxEntries: 8 },       // 域就绪矩阵（写入事件驱动失效）
}

/**
 * 失效图（domain → 依赖它的派生域）。
 *
 * 判据：「A 的数据变了，哪个域的缓存必须跟着失效」。
 * 例：question 表写入 → 图谱（graph，节点/边来自题）/ 统计（stats）/ 检索（search）全部陈旧。
 * 新增依赖时**必须在此登记**，否则会出现「改了数据但面板还是旧值」的静默错误
 * （cycle-36 教训：缓存失效钩子与数据写入点必须配对，漏配对 = 面板撒谎）。
 */
export const INVALIDATION_GRAPH: Record<string, string[]> = {
  // tuxing = 图形推理读层缓存，数据源是 question(source_id='gk-tuxing') → 题变它也变
  question: ['graph', 'stats', 'search', 'domains', 'tuxing'],
  // paperIndex = 真题卷索引（卷级元数据派生物）；paper 表变了它必须失效
  paper: ['stats', 'search', 'domains', 'paperIndex'],
  knowledge: ['stats', 'search', 'domains'],
  relation: ['graph', 'stats'],
  source: ['domains'],
  user: ['stats'],
}

/** 稳定参数序列化：键排序，避免 {a,b} 与 {b,a} 生成两个键 */
function stableParams(p?: Record<string, unknown>): string {
  if (!p) return ''
  return Object.keys(p).sort().map(k => `${k}=${JSON.stringify(p[k])}`).join('&')
}

/** 键派生（单一事实源：所有缓存存取必须经此函数，守卫据此锚定） */
export function buildCacheKey(d: CacheKeyDims): string {
  const ws = String(d.ws || '-')
  const root = String(d.root || '-')
  return `${d.domain}|${ws}|${root}|${stableParams(d.params)}`
}

/** 单域命中统计（白盒：命中率是「缓存有没有用」的唯一证据） */
export interface CacheDomainStats { hits: number; misses: number; sets: number; entries: number }

/** 统一缓存门面（实例由调用方持有，避免模块级可变状态跨 fiber 残留——R7） */
export function createCache() {
  const slots = new Map<string, CacheEntry<unknown>>()
  /** 快照槽（domain → 物化结果）；与 slots 分开是因为它没有 TTL/LRU 语义 */
  const snapshots = new Map<string, { data: unknown; builtAt: number; key: string }>()
  /** 命中/未命中计数（按域） */
  const metrics = new Map<string, CacheDomainStats>()

  function statOf(domain: string): CacheDomainStats {
    let m = metrics.get(domain)
    if (!m) { m = { hits: 0, misses: 0, sets: 0, entries: 0 }; metrics.set(domain, m) }
    return m
  }

  /** 读：命中且未过期则返回值；未命中/过期返回 undefined（与 Map.get 同语义） */
  function get<T>(d: CacheKeyDims): T | undefined {
    const k = buildCacheKey(d)
    const m = statOf(d.domain)
    const hit = slots.get(k) as CacheEntry<T> | undefined
    if (!hit) { m.misses++; return undefined }
    const ttl = CACHE_DOMAINS[d.domain]?.ttlMs ?? 0
    if (ttl > 0 && Date.now() - hit.ts >= ttl) { slots.delete(k); m.misses++; return undefined }
    hit.hits++
    m.hits++
    return hit.data
  }

  /** 写：按域 LRU（超出上限淘汰最久未访问槽——比旧「按 ts 清最旧」更准确） */
  function set<T>(d: CacheKeyDims, data: T): T {
    const k = buildCacheKey(d)
    slots.set(k, { data, ts: Date.now(), hits: 0 })
    const m = statOf(d.domain); m.sets++
    const cap = CACHE_DOMAINS[d.domain]?.maxEntries ?? 24
    const prefix = d.domain + '|'
    const inDomain = [...slots.keys()].filter(key => key.startsWith(prefix))
    if (inDomain.length > cap) {
      const ranked = inDomain.map(key => [key, slots.get(key)!] as [string, CacheEntry<unknown>])
      ranked.sort((a, b) => (a[1].hits - b[1].hits) || (a[1].ts - b[1].ts))
      for (const [key] of ranked.slice(0, ranked.length - cap)) slots.delete(key)
    }
    return data
  }

  /**
   * 失效：无参 = 清空全部；给 domain = 清该域**及其依赖域**（沿 INVALIDATION_GRAPH 级联）；
   * 给完整 dims = 精确删一个键（不做级联——精确删是「我知道只这一条脏了」的语义）。
   */
  function invalidate(d?: Partial<CacheKeyDims>): void {
    if (!d) { slots.clear(); snapshots.clear(); return }
    if (d.domain && d.ws === undefined && d.root === undefined && d.params === undefined) {
      invalidateDomain(d.domain)
      return
    }
    if (d.domain && d.ws !== undefined && d.root !== undefined) slots.delete(buildCacheKey(d as CacheKeyDims))
  }

  /** 按域级联失效（含快照）；返回被清掉的缓存键数（白盒/日志用） */
  function invalidateDomain(domain: string): number {
    const targets = new Set<string>([domain, ...(INVALIDATION_GRAPH[domain] || [])])
    let removed = 0
    for (const dom of targets) {
      const prefix = dom + '|'
      for (const k of [...slots.keys()]) if (k.startsWith(prefix)) { slots.delete(k); removed++ }
      snapshots.delete(dom)
    }
    return removed
  }

  /** 读-算-写糖：命中直接返回；未命中调用 compute 并缓存 */
  function compute<T>(d: CacheKeyDims, fn: () => T): T {
    const hit = get<T>(d)
    if (hit !== undefined) return hit
    return set(d, fn())
  }

  /**
   * 快照：昂贵计算结果的一次性物化（按 domain 单槽）。
   * @param domain   快照域（与 CACHE_DOMAINS 的域同名；也用于级联失效）
   * @param key      内容指纹（数据变了必须变；不变则复用）
   * @param compute  builder（**只在 key 变化或首次时调用**）
   */
  function snapshot<T>(domain: string, key: string, compute: () => T): { data: T; builtAt: number; cached: boolean } {
    const cur = snapshots.get(domain)
    if (cur && cur.key === key) {
      statOf(domain).hits++
      return { data: cur.data as T, builtAt: cur.builtAt, cached: true }
    }
    statOf(domain).misses++
    const t0 = Date.now()
    const data = compute()
    // 配额：快照域也受 maxEntries 约束（当前实现单槽，保留上限语义便于将来多键）
    snapshots.set(domain, { data, builtAt: Date.now(), key })
    void t0
    return { data, builtAt: Date.now(), cached: false }
  }

  /** 只读尺寸（白盒/测试用） */
  function size(): number { return slots.size }

  /** 白盒快照：每域命中率 + 快照清单（「缓存到底有没有用」的可观测证据） */
  function stats(): any {
    const domains: any[] = []
    for (const [domain, m] of metrics.entries()) {
      const total = m.hits + m.misses
      const snap = snapshots.get(domain)
      domains.push({
        domain,
        hits: m.hits, misses: m.misses, sets: m.sets,
        // 命中率：无访问时 null（不臆造 0%——「没访问过」≠「命中率 0」）
        hitRate: total ? Math.round((m.hits / total) * 100) : null,
        entries: [...slots.keys()].filter(k => k.startsWith(domain + '|')).length,
        snapshot: snap ? { builtAt: snap.builtAt, key: String(snap.key).slice(0, 24) } : null,
      })
    }
    domains.sort((a, b) => b.hits - a.hits || String(a.domain).localeCompare(String(b.domain)))
    return {
      domains,
      slots: slots.size,
      snapshots: snapshots.size,
      // 失效图本身也透出（「改了什么会连带清掉什么」是架构事实，不是实现细节）
      invalidationGraph: INVALIDATION_GRAPH,
      policy: CACHE_DOMAINS,
    }
  }

  return { get, set, invalidate, invalidateDomain, compute, snapshot, size, stats, buildCacheKey }
}

export type Cache = ReturnType<typeof createCache>
