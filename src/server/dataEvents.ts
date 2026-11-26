/**
 * server/dataEvents.ts — 数据写入事件总线（cycle-61 v9 · 缓存失效的唯一触发点）
 *
 * ── 问题（漏配对的结构性来源）──
 *   失效钩子散落在三处：`poolDb.invalidateStatsCache`（统计快照）、
 *   `http.rebuildDomains`（换根）、`dataGate.ensureDomain`（按域摄入）。
 *   每加一个缓存域，就要记得在每一处补一行——**漏一处 = 面板显示陈旧数据**
 *   （cycle-36 教训：「失效钩子与数据写入点必须配对，漏配对 = 面板撒谎」）。
 *
 * ── v9 的正解：写入方只广播「哪个实体变了」，谁缓存谁自己退订 ──
 *   `emitDataChanged('question')` → 门面沿 INVALIDATION_GRAPH 级联清掉所有依赖域
 *   → 各模块的本地快照（statsCache / methodology idxSlot / dataApi 模块分布）也一并清空。
 *   新增缓存域时**只需登记依赖关系**（server/cache.ts 的 INVALIDATION_GRAPH），
 *   不需要改任何写入点——这就是「单一触发点」的价值。
 *
 * ── 边界 ──
 *   本模块是**纯进程内同步广播**（不排队、不重试）：缓存失效必须是「立即且确定」的，
 *   异步化会引入「事件还没处理完就被读到」的竞态。订阅者异常一律吞掉（失效失败
 *   只能降级为「多算一次」，绝不能让业务写入失败）。
 */
import type { Cache } from './cache.js'

/** 可订阅的实体（= 失效图的源域，见 cache.ts INVALIDATION_GRAPH） */
export type DataEntity = 'question' | 'paper' | 'knowledge' | 'relation' | 'source' | 'user'

interface Subscriber {
  name: string
  /** 收到「某实体变了」时清自己的本地缓存（同步、幂等、不许抛） */
  clear: (entity: DataEntity, reason: string) => void
}

const subscribers: Subscriber[] = []
let cacheRef: Cache | null = null

/** 绑定统一缓存门面（http.buildDomains 装配时调用一次；换根重绑不累积订阅者） */
export function bindCache(cache: Cache): void {
  cacheRef = cache
}

/** 注册本地缓存清理器（模块装配期调用一次） */
export function subscribeDataEvents(sub: Subscriber): void {
  if (!sub || typeof sub.clear !== 'function') return
  if (subscribers.some(s => s.name === sub.name)) return   // 幂等（热重载重复装配不累积）
  subscribers.push(sub)
}

/**
 * 广播数据变更（**所有写入路径的单一触发点**）。
 *
 * @param entity 变了什么（question / paper / knowledge / relation / source / user）
 * @param reason 人类可读原因（进日志与白盒；如 'rebuild' / 'domain-ingest:paper'）
 * @returns 受影响摘要（清掉的缓存键数 + 通知的订阅者数），供白盒与测试断言
 */
export function emitDataChanged(entity: DataEntity, reason = ''): { clearedKeys: number; notified: number } {
  let clearedKeys = 0
  try {
    if (cacheRef) clearedKeys = cacheRef.invalidateDomain(entity)
  } catch { /* 缓存失效失败降级为「下次重算」，不影响写入 */ }
  let notified = 0
  for (const s of subscribers) {
    try { s.clear(entity, reason); notified++ } catch { /* 单个订阅者异常不影响其它 */ }
  }
  return { clearedKeys, notified }
}

/** 订阅者清单（白盒：能看到「哪些模块在自己的本地缓存」） */
export function dataEventSubscribers(): string[] {
  return subscribers.map(s => s.name)
}

/** 测试隔离：清空订阅者与门面绑定（不触碰缓存内容） */
export function resetDataEvents(): void {
  subscribers.length = 0
  cacheRef = null
}
