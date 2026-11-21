/**
 * tests/smoke/graph-api.test.mjs — 图谱新端点契约域（cycle-47 阶段 8 迁移）
 *
 * 从 smoke.test.mjs「v1.8.0 新端点契约」段迁移（L1022-1082）：
 * graph 兼容字段 + analytics 六项 + layout；neighborhood/path/impact 三子端点
 * （含未知节点降级）；lifecycle 状态机；telemetry histogram/topSlow/alerts +
 * p95≥p50 单调；capabilities reconciliation/lifecycle；遥测路径口径与 manifest 一致
 * + __unmatched__ 聚合不吞已声明端点（v1.8 白盒假阳性事故固化面）。
 * server 运行时段走 setupDomain（阶段 5 样板）；判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/graph-api.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_GRAPH' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('graph 保留既有字段（兼容）+ nodeMeta/edgeMeta + analytics 六项 + layout', async () => {
  const graph = await h.J('/api/graph?ws=PROJ_VTEST_GRAPH')
  expect(Array.isArray(graph.nodes)).toBe(true)
  expect(Array.isArray(graph.edges)).toBe(true)
  expect(!!graph.metrics).toBe(true)
  expect(Array.isArray(graph.rank)).toBe(true)
  expect(!!graph.health).toBe(true)
  expect(!!(graph.nodeMeta && graph.edgeMeta)).toBe(true)
  expect(graph.analytics && graph.analytics.degree && graph.analytics.communities &&
    graph.analytics.clustering && graph.analytics.betweenness && graph.analytics.layers && graph.analytics.degreeStats).toBeTruthy()
  expect(graph.layout && typeof graph.layout.id === 'object').toBeTruthy()
})

test('graph/neighborhood：返回 nodes/edges/stats + 未知节点降级为 error（HTTP 200）', async () => {
  const nd = await h.J(`/api/graph/neighborhood?node=${encodeURIComponent('plugin:kaogong')}&depth=2&ws=PROJ_VTEST_GRAPH`)
  expect(Array.isArray(nd.nodes) && Array.isArray(nd.edges) && nd.stats && nd.stats.nodes === nd.nodes.length).toBe(true)
  const ndBad = await h.J(`/api/graph/neighborhood?node=__nope__&ws=PROJ_VTEST_GRAPH`)
  expect(!!(ndBad.error && Array.isArray(ndBad.nodes))).toBe(true)
})

test('graph/path：found/path/length + 未知节点降级', async () => {
  const pth = await h.J(`/api/graph/path?from=${encodeURIComponent('view:dashboard')}&to=${encodeURIComponent('endpoint:/api/stats')}&ws=PROJ_VTEST_GRAPH`)
  expect(pth.found === true && pth.path.length >= 2 && pth.length === pth.path.length - 1).toBe(true)
  const pthBad = await h.J(`/api/graph/path?from=__x__&to=__y__&ws=PROJ_VTEST_GRAPH`)
  expect(pthBad.found === false && !!pthBad.error).toBe(true)
})

test('graph/impact：dependents/count + dependents 全部存在于图中', async () => {
  const graph = await h.J('/api/graph?ws=PROJ_VTEST_GRAPH')
  const imp = await h.J(`/api/graph/impact?node=${encodeURIComponent('endpoint:/api/questions')}&ws=PROJ_VTEST_GRAPH`)
  expect(Array.isArray(imp.dependents) && imp.count === imp.dependents.length).toBe(true)
  const ids = new Set(graph.nodes.map(n => n.id))
  expect(imp.dependents.every(d => ids.has(d))).toBe(true)
})

test('lifecycle：stages/events/current + 三态合法 + 恰一个 current', async () => {
  const life = await h.J('/api/lifecycle')
  expect(Array.isArray(life.stages) && life.stages.length >= 6 && Array.isArray(life.events)).toBe(true)
  expect(life.stages.every(s => ['done', 'current', 'pending'].includes(s.state))).toBe(true)
  expect(life.stages.filter(s => s.state === 'current').length).toBe(1)
})

test('telemetry：兼容字段 + histogram 三项 + topSlow/alerts + 分级合法 + p95>=p50', async () => {
  const tel = await h.J('/api/telemetry?ws=PROJ_VTEST_GRAPH')
  expect(typeof tel.uptimeSec === 'number' && typeof tel.totalRequests === 'number' && !!tel.endpoints && typeof tel.coverage === 'number').toBe(true)
  expect(tel.histogram && typeof tel.histogram.p50 === 'number' && typeof tel.histogram.p95 === 'number' && typeof tel.histogram.max === 'number').toBe(true)
  expect(Array.isArray(tel.topSlow) && Array.isArray(tel.alerts)).toBe(true)
  expect(tel.alerts.every(a => ['info', 'warn', 'error'].includes(a.level))).toBe(true)
  expect(Object.values(tel.endpoints).every(e => (e.p95 || 0) >= (e.p50 || 0))).toBe(true)
})

test('capabilities：兼容字段 + reconciliation + lifecycle 状态机', async () => {
  const caps = await h.J('/api/capabilities')
  expect(Array.isArray(caps.endpoints) && Array.isArray(caps.views) && Array.isArray(caps.tools)).toBe(true)
  expect(!!(caps.reconciliation && Array.isArray(caps.reconciliation.orphanEndpoints) && Array.isArray(caps.reconciliation.unconsumedEndpoints))).toBe(true)
  expect(!!(caps.lifecycle && Array.isArray(caps.lifecycle.stages) && caps.lifecycle.stages.length >= 6)).toBe(true)
})

test('运行态端点路径口径与 manifest 一致（v1.8 白盒假阳性事故固化）+ __unmatched__ 不吞已声明端点', async () => {
  const caps = await h.J('/api/capabilities')
  const tel = await h.J('/api/telemetry?ws=PROJ_VTEST_GRAPH')
  const declaredPaths = new Set(caps.endpoints.map(e => e.path))
  const runtimeForeign = Object.keys(tel.endpoints).filter(p => !declaredPaths.has(p) && p.startsWith('/api/'))
  expect(runtimeForeign, '未匹配口径').toEqual([])
  expect(Object.keys(tel.endpoints).some(k => k === '/api/status' || k === '/api/capabilities' || k === '/api/telemetry')).toBe(true)
  expect(Object.keys(tel.endpoints).some(k => /__unmatched__/.test(k)), '聚合桶泄漏进对账表').toBe(false)
})
