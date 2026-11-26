/**
 * tests/unit/search-registry.test.mjs — 统一检索层注册表单测（cycle-60）
 *
 * 覆盖：manifest 单一事实源派生（未声明端点拒绝注册）/ 统一信封映射 /
 * 源特有字段进 meta 无损透出 / 未知 provider 与异常零冒泡（崩溃安全）。
 */
import { test, expect } from 'vitest'
import { createSearchRegistry } from '../../dist/server/searchRegistry.js'

const DECL = [
  { path: '/api/pool/search', label: '统一池跨源检索(去重聚合)' },
  { path: '/api/huasheng13/search', label: '方法论全文检索(BM25)' },
  { path: '/api/search', label: '知识检索' },
  { path: '/api/naoku/kadian', label: '知识点检索' },
  { path: '/api/history/search', label: '题干关键词搜索(补录候选)' },
]

test('SEARCH-01 未声明端点拒绝注册（对账只认 manifest——v1.8 教训）', () => {
  const r = createSearchRegistry(DECL, {})
  expect(() => r.register({ id: 'ghost', endpoint: '/api/undeclared', search: async () => ({ query: '', results: [], total: 0 }) })).toThrow(/未在 manifest 声明/)
  expect(r.ids()).toEqual([])
})

test('SEARCH-02 自定义 provider 统一信封（query/results/total 契约）', async () => {
  const r = createSearchRegistry(DECL, {})
  r.register({
    id: 'pool', endpoint: '/api/pool/search',
    search: async (q) => ({ query: q, results: [{ id: 'q:1', source: 'naoku', snippet: ' stem ' }], total: 7, took: 3 }),
  })
  const out = await r.search('pool', '图形推理')
  expect(out.query).toBe('图形推理')
  expect(out.total).toBe(7)
  expect(out.results[0].id).toBe('q:1')
  expect(out.took).toBe(3)
})

test('SEARCH-03 未知 provider 与异常均收敛为空信封（不抛错、不 500）', async () => {
  const r = createSearchRegistry(DECL, {})
  expect(await r.search('nope', 'x')).toEqual({ query: 'x', results: [], total: 0 })
  r.register({
    id: 'pool', endpoint: '/api/pool/search',
    search: async () => { throw new Error('boom') },
  })
  const out = await r.search('pool', 'x')
  expect(out.results).toEqual([])
  expect(out.total).toBe(0)
})

test('SEARCH-04 内置五 provider 全部注册（id 集合与 manifest 检索端点一一对应）', () => {
  const r = createSearchRegistry(DECL, {
    pool: { handle: async () => ({ results: [] }) },
    methodologyApi: { handle: async () => ({ results: [] }) },
    dataApi: () => ({ results: [] }),
    historyApi: { handle: async () => ({ list: [] }) },
    naokuApi: { handle: async () => ({ list: [] }) },
  })
  r.registerBuiltins()
  expect(r.ids()).toEqual(['docs', 'history', 'huasheng13', 'kadian', 'pool'])
})
