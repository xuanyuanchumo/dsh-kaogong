/**
 * tests/unit/graph-analytics.test.mjs — 图分析算法族纯函数不变量（cycle-47 阶段 8 迁移）
 *
 * 从 smoke.test.mjs「v1.8.0 图分析算法族不变量」段迁移（L940-1022）：
 * NODE_META/EDGE_META 单一事实源 + 度分析 + 标签传播 + 集聚系数 + 介数中心性 +
 * 拓扑分层 + 最短路 + k 跳邻域 + 反向可达 + 分层布局 + 确定性（两次同输出深相等）。
 * **纯函数直测 dist（vitest unit 车道首件）——零 server 依赖**。判定逐字等价。
 *
 * 运行：npx vitest run tests/unit/graph-analytics.test.mjs
 */
import { test, expect, beforeAll } from 'vitest'

let G = null

beforeAll(async () => {
  G = await import('../../dist/shared/manifest.js')
})

test('KERNEL-SHARE 服务端/内核 pageRank 同图深相等（真共享，无镜像漂移）', async () => {
  const K = await import('../../dist/shared/kernel.js')
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }, { source: 'd', target: 'a' }]
  const fromKernel = K.pageRank(nodes, edges)
  const fromServer = G.pageRank(nodes, edges)
  expect(fromServer).toEqual(fromKernel)
  // 客户端 graphLocalPageRank 现真调用 kernel.pageRank（combo 内），其算法体即此函数——
  // 组合产物形态由 bundle-client 终检 + render 旅程共同守卫。
  expect(K.KG_PAGERANK_ITER).toBe(40)
})

test('NODE_META/EDGE_META 单一事实源覆盖全部节点/边类型', async () => {
  const g = G.buildGraph({})
  const missingNodes = [...new Set(g.nodes.map(n => n.type))].filter(t => !(G.NODE_META[t] && G.NODE_META[t].color))
  expect(missingNodes, '缺色节点类型').toEqual([])
  const missingEdges = [...new Set(g.edges.map(e => e.rel))].filter(r => !G.EDGE_META[r])
  expect(missingEdges, '缺元数据边类型').toEqual([])
})

test('度分析守恒：入度和/出度和 == 边数，直方图计数和 == |V|', async () => {
  const g = G.buildGraph({})
  const deg = G.degreeAnalysis(g.nodes, g.edges)
  const sumIn = Object.values(deg.degree).reduce((s, d) => s + d.in, 0)
  const sumOut = Object.values(deg.degree).reduce((s, d) => s + d.out, 0)
  expect(sumIn).toBe(g.edges.length)
  expect(sumOut).toBe(g.edges.length)
  expect(deg.stats.histogram.reduce((s, h) => s + h.count, 0)).toBe(g.nodes.length)
})

test('标签传播：成员并集 == 全部节点、无重复、社区按规模降序', async () => {
  const g = G.buildGraph({})
  const comms = G.labelPropagation(g.nodes, g.edges)
  const members = comms.flatMap(c => c.members)
  expect(members.length).toBe(g.nodes.length)
  expect(new Set(members).size).toBe(g.nodes.length)
  expect(comms.every((c, i) => i === 0 || comms[i - 1].size >= c.size)).toBe(true)
})

test('集聚系数 ∈ [0,1]；介数中心性非负且降序', async () => {
  const g = G.buildGraph({})
  const cl = G.clusteringCoefficient(g.nodes, g.edges)
  expect(cl.avg).toBeGreaterThanOrEqual(0)
  expect(cl.avg).toBeLessThanOrEqual(1)
  const bc = G.brandesBetweenness(g.nodes, g.edges)
  expect(bc.every(b => b.score >= 0)).toBe(true)
  expect(bc.every((b, i) => i === 0 || bc[i - 1].score >= b.score)).toBe(true)
})

test('拓扑分层：覆盖全部节点、层号非负', async () => {
  const g = G.buildGraph({})
  const tl = G.topoLayers(g.nodes, g.edges)
  expect(Object.keys(tl.layer).length).toBe(g.nodes.length)
  expect(Object.values(tl.layer).every(v => v >= 0)).toBe(true)
})

test('最短路：found/未找到两态正确', async () => {
  const g = G.buildGraph({})
  const found = G.shortestPath(g.nodes, g.edges, 'lifecycle:load', 'lifecycle:serve')
  expect(found.found).toBe(true)
  expect(Array.isArray(found.path) && found.path.length >= 2).toBe(true)
  expect(found.path[0]).toBe('lifecycle:load')
  expect(found.path[found.path.length - 1]).toBe('lifecycle:serve')
  const miss = G.shortestPath(g.nodes, g.edges, 'plugin:kaogong', 'no-such-node')
  expect(miss.found).toBe(false)
  expect(miss.path.length).toBe(0)
})

test('k 跳邻域与反向可达、分层布局', async () => {
  const g = G.buildGraph({})
  const n1 = G.neighborhood(g.nodes, g.edges, 'plugin:kaogong', 1)
  const n2 = G.neighborhood(g.nodes, g.edges, 'plugin:kaogong', 2)
  // 2 跳 ⊇ 1 跳
  const s1 = new Set((n1.nodes || []).map(n => n.id))
  for (const id of s1) expect((n2.nodes || []).some(n => n.id === id)).toBe(true)
  expect((n2.nodes || []).length).toBeGreaterThanOrEqual(s1.size)
  // 反向可达：含自身（自反性）+ count == dependents.length（旧文件判据等价）
  const rr = G.reverseReach(g.nodes, g.edges, 'endpoint:/api/questions')
  expect(rr.dependents.includes('endpoint:/api/questions')).toBe(true)
  expect(rr.count).toBe(rr.dependents.length)
  // 分层布局：全部节点有坐标（lay.id 覆盖 == V）+ 坐标归一化 0..1（含容差）
  const lay = G.layeredLayout(g.nodes, g.edges)
  expect(Object.keys(lay.id).length).toBe(g.nodes.length)
  const inRange = Object.values(lay.id).every(p => p.x >= -0.001 && p.x <= 1.001 && p.y >= -0.001 && p.y <= 1.001)
  expect(inRange, '分层布局坐标归一化 0..1').toBe(true)
})

test('确定性：分层布局与标签传播两次输出深相等', async () => {
  const g = G.buildGraph({})
  expect(JSON.stringify(G.layeredLayout(g.nodes, g.edges))).toBe(JSON.stringify(G.layeredLayout(g.nodes, g.edges)))
  expect(JSON.stringify(G.labelPropagation(g.nodes, g.edges))).toBe(JSON.stringify(G.labelPropagation(g.nodes, g.edges)))
})
