/**
 * tests/unit/cache.test.mjs — 统一缓存层门面单测（cycle-60）
 *
 * 覆盖：键维度（domain|ws|root|params）/ TTL / 按域 LRU / 失效三形态 /
 * 防跨租户污染（同 root 不同 ws 必须隔离——cycle-17 R20 事故机器化）。
 */
import { test, expect } from 'vitest'
import { createCache, buildCacheKey } from '../../dist/server/cache.js'

test('CACHE-01 键派生：domain|ws|root|params 四维度且参数键排序稳定', () => {
  expect(buildCacheKey({ domain: 'graph', ws: 'wsA', root: '/r1' })).toBe('graph|wsA|/r1|')
  expect(buildCacheKey({ domain: 'graph', ws: 'wsA', root: '/r1', params: { b: 2, a: 1 } }))
    .toBe(buildCacheKey({ domain: 'graph', ws: 'wsA', root: '/r1', params: { a: 1, b: 2 } }))
  expect(buildCacheKey({ domain: 'graph', ws: 'wsA', root: '/r1', params: { x: 1 } }))
    .not.toBe(buildCacheKey({ domain: 'graph', ws: 'wsB', root: '/r1', params: { x: 1 } }))
})

test('CACHE-02 跨租户隔离：同域同根不同 ws 互不污染（R20 事故回归）', () => {
  const c = createCache()
  const a = { domain: 'graph', ws: 'wsA', root: '/r' }
  const b = { domain: 'graph', ws: 'wsB', root: '/r' }
  c.set(a, { progress: { day: 7 } })
  c.set(b, { progress: { day: 1 } })
  expect(c.get(a).progress.day).toBe(7)
  expect(c.get(b).progress.day).toBe(1)
})

test('CACHE-03 换根隔离：同域同 ws 不同 root 互不污染（cycle-16 ⑬ 回归）', () => {
  const c = createCache()
  c.set({ domain: 'paperIndex', ws: '-', root: '/old' }, { n: 1 })
  expect(c.get({ domain: 'paperIndex', ws: '-', root: '/new' })).toBeUndefined()
  expect(c.get({ domain: 'paperIndex', ws: '-', root: '/old' }).n).toBe(1)
})

test('CACHE-04 compute 读-算-写糖：同键只算一次', () => {
  const c = createCache()
  let calls = 0
  const d = { domain: 'stats', ws: '-', root: '/r', params: { key: 'poolHealth' } }
  const f = () => { calls++; return { n: calls } }
  expect(c.compute(d, f).n).toBe(1)
  expect(c.compute(d, f).n).toBe(1)
  expect(calls).toBe(1)
})

test('CACHE-05 失效三形态：精确键 / 整域 / 全部', () => {
  const c = createCache()
  const a = { domain: 'graph', ws: 'A', root: '/r' }
  const b = { domain: 'graph', ws: 'B', root: '/r' }
  const s = { domain: 'stats', ws: '-', root: '/r' }
  c.set(a, 1); c.set(b, 2); c.set(s, 3)
  c.invalidate(a)
  expect(c.get(a)).toBeUndefined()
  expect(c.get(b)).toBe(2)
  c.invalidate({ domain: 'graph' })
  expect(c.get(b)).toBeUndefined()
  expect(c.get(s)).toBe(3)
  c.invalidate()
  expect(c.get(s)).toBeUndefined()
})

test('CACHE-06 按域 LRU 上限：graph 域 24 槽', () => {
  const c = createCache()
  for (let i = 0; i < 30; i++) c.set({ domain: 'graph', ws: 'w' + i, root: '/r' }, i)
  expect(c.size()).toBeLessThanOrEqual(24)
  expect(c.get({ domain: 'graph', ws: 'w29', root: '/r' })).toBe(29)
})

/* ══ cycle-61 v9：快照 / 失效图 / 命中率白盒 ══ */

test('CACHE-07 快照：同 key 只构建一次（昂贵计算物化），key 变则重建', () => {
  const c = createCache()
  let builds = 0
  const build = () => { builds++; return { rows: builds } }
  const a = c.snapshot('stats', 'fp-1', build)
  expect(a.cached).toBe(false)
  expect(a.data.rows).toBe(1)
  const b = c.snapshot('stats', 'fp-1', build)
  expect(b.cached).toBe(true)
  expect(builds).toBe(1)            // 关键：没重复扫表
  const d = c.snapshot('stats', 'fp-2', build)
  expect(d.cached).toBe(false)
  expect(builds).toBe(2)            // 指纹变了必须重建
})

test('CACHE-08 失效级联：清 question 域会连带清掉依赖它的 graph/stats/search/tuxing', () => {
  const c = createCache()
  const g = { domain: 'graph', ws: 'A', root: '/r' }
  const s = { domain: 'stats', ws: '-', root: '/r' }
  const q = { domain: 'search', ws: '-', root: '/r' }
  const t = { domain: 'tuxing', ws: '-', root: '/r' }
  const p = { domain: 'paperIndex', ws: '-', root: '/r' }
  c.set(g, 1); c.set(s, 2); c.set(q, 3); c.set(t, 4); c.set(p, 5)
  c.snapshot('stats', 'fp', () => ({ ok: 1 }))
  // question 是这些派生物的源域（tuxing 的题也在 question 表里 —— source_id='gk-tuxing'）
  const removed = c.invalidateDomain('question')
  expect(removed).toBeGreaterThan(0)
  expect(c.get(g)).toBeUndefined()
  expect(c.get(s)).toBeUndefined()
  expect(c.get(q)).toBeUndefined()
  expect(c.get(t)).toBeUndefined()
  // paperIndex 由 paper 域驱动（卷级元数据），不因题表变化而失效
  expect(c.get(p)).toBe(5)
  // 快照随域失效（否则改了题还读到旧的材料组索引）
  expect(c.snapshot('stats', 'fp', () => ({ ok: 2 })).cached).toBe(false)
  // paper 域级联覆盖 paperIndex
  expect(c.invalidateDomain('paper')).toBeGreaterThan(0)
  expect(c.get(p)).toBeUndefined()
})

test('CACHE-09 白盒统计：命中率可观测，未访问域不臆造 0%', () => {
  const c = createCache()
  const d = { domain: 'graph', ws: 'A', root: '/r' }
  c.set(d, 1)
  c.get(d); c.get(d)                 // 2 hits
  c.get({ domain: 'graph', ws: 'B', root: '/r' })   // 1 miss
  const st = c.stats()
  const g = st.domains.find(x => x.domain === 'graph')
  expect(g.hits).toBe(2)
  expect(g.misses).toBe(1)
  expect(g.hitRate).toBe(67)         // round(2/3*100)
  // 失效图与策略都在白盒里（架构事实可观测）
  expect(st.invalidationGraph.question).toContain('graph')
  expect(st.policy.graph.ttlMs).toBe(5000)
  // 从未访问过的域不出现在 domains 里（不臆造 0%）
  expect(st.domains.some(x => x.domain === 'paperIndex')).toBe(false)
})

test('CACHE-10 新增域策略登记（search/domains）——未登记域走默认而非崩溃', () => {
  const c = createCache()
  const d = { domain: 'search', ws: '-', root: '/r', params: { q: '图形推理' } }
  c.set(d, { results: [] })
  expect(c.get(d).results).toEqual([])
  // 未登记域：maxEntries 默认 24、ttl 默认 0（永不过期）——不抛错
  const u = { domain: 'unregistered', ws: '-', root: '/r' }
  c.set(u, 1)
  expect(c.get(u)).toBe(1)
})
