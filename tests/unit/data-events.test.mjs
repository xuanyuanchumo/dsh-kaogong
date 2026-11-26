/**
 * tests/unit/data-events.test.mjs — 数据变更事件总线单测（cycle-61 v9）
 *
 * 覆盖：广播 → 缓存级联失效 / 订阅者通知 / 订阅幂等 / 订阅者异常隔离 /
 * 失效图覆盖（所有域都在图里或有显式豁免）。
 *
 * 这些是「缓存失效纪律」的机器证据：写入路径不允许各自手写失效，
 * 只能经 emitDataChanged 广播——漏配对会让面板显示陈旧数据（cycle-36 教训）。
 */
import { test, expect } from 'vitest'
import {
  bindCache, emitDataChanged, subscribeDataEvents, dataEventSubscribers, resetDataEvents,
} from '../../dist/server/dataEvents.js'
import { createCache, INVALIDATION_GRAPH, CACHE_DOMAINS } from '../../dist/server/cache.js'

test('EVENT-01 广播 → 缓存沿失效图级联清理（写一次清一族）', () => {
  resetDataEvents()
  const c = createCache()
  bindCache(c)
  c.set({ domain: 'graph', ws: 'A', root: '/r' }, 1)
  c.set({ domain: 'search', ws: '-', root: '/r', params: { q: 'x' } }, 2)
  const r = emitDataChanged('question', 'test')
  expect(r.clearedKeys).toBeGreaterThanOrEqual(2)
  expect(c.get({ domain: 'graph', ws: 'A', root: '/r' })).toBeUndefined()
  expect(c.get({ domain: 'search', ws: '-', root: '/r', params: { q: 'x' } })).toBeUndefined()
})

test('EVENT-02 订阅者被通知且只登记一次（热重载重复装配不累积）', () => {
  resetDataEvents()
  bindCache(createCache())
  const calls = []
  const sub = { name: 'unit.sub', clear: (e, why) => calls.push([e, why]) }
  subscribeDataEvents(sub)
  subscribeDataEvents(sub)             // 重复登记
  expect(dataEventSubscribers().filter(n => n === 'unit.sub').length).toBe(1)
  emitDataChanged('paper', 'rebuild')
  expect(calls).toEqual([['paper', 'rebuild']])
})

test('EVENT-03 单个订阅者抛错不影响其它订阅者与广播返回', () => {
  resetDataEvents()
  bindCache(createCache())
  const ok = []
  subscribeDataEvents({ name: 'bad', clear: () => { throw new Error('boom') } })
  subscribeDataEvents({ name: 'good', clear: (e) => ok.push(e) })
  const r = emitDataChanged('knowledge', 'x')
  expect(r.notified).toBe(1)           // bad 抛错不计入成功
  expect(ok).toEqual(['knowledge'])
})

test('EVENT-04 未绑定缓存时广播不崩（独立构造/单测场景）', () => {
  resetDataEvents()
  const r = emitDataChanged('question', 'no-cache')
  expect(r.clearedKeys).toBe(0)
})

test('EVENT-05 失效图契约：每个有 TTL 的派生域都必须能被某个源域清到', () => {
  // 源域 = 图里的 key（question/paper/knowledge/relation/source/user）
  const sources = Object.keys(INVALIDATION_GRAPH)
  const covered = new Set()
  for (const s of sources) for (const d of INVALIDATION_GRAPH[s]) covered.add(d)
  // 所有登记在 CACHE_DOMAINS 的域，除「源域同名」外，都必须出现在某个源域的级联列表里
  for (const domain of Object.keys(CACHE_DOMAINS)) {
    const isSource = sources.includes(domain)
    const reachable = covered.has(domain)
    expect(isSource || reachable, `域 ${domain} 不在失效图里（改数据后它不会失效）`).toBe(true)
  }
  // 反向：失效图里出现的域必须真的登记了策略（否则清的是不存在的域＝空操作）
  for (const s of sources) {
    for (const d of INVALIDATION_GRAPH[s]) {
      expect(Object.keys(CACHE_DOMAINS), `失效图引用了未登记策略的域 ${d}`).toContain(d)
    }
  }
})
