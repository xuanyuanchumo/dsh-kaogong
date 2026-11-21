/**
 * tests/smoke/memory-layout.test.mjs — 记忆域 + 图谱布局/白盒三件套守卫域（cycle-47 阶段 13 迁移·批二）
 *
 * 从 smoke.test.mjs §9（MEM/GR15/OBS15 段 L314-350）迁移：
 * SMOKE-MEM-01..06（记忆 CRUD/隔离/校验/manifest）+ SMOKE-GR15-01/02（环形布局 +
 * 流动粒子）+ SMOKE-OBS15-01/02（白盒三件套）。
 * server 运行时段走 setupDomain；静态判据逐字等价。
 *
 * 运行：npx vitest run tests/smoke/memory-layout.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupDomain } from '../_harness/server.mjs'

let h = null
const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const readSrc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_MEM' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('SMOKE-MEM-01 记忆默认为空对象', async () => {
  const m0 = await h.JW('/api/memory')
  expect(m0 && typeof m0.memory === 'object' && Object.keys(m0.memory).length === 0).toBe(true)
})

test('SMOKE-MEM-02/03 记忆写入 ok+kind+at + 回读含原题对象', async () => {
  const m1 = await h.PW('/api/memory', { kind: 'practice', data: { module: '判断推理', question: { stem: '记忆恢复原题干', options: { A: 'a', B: 'b' }, correctAnswer: 'A', module: '判断推理' } } })
  expect(m1 && m1.ok === true && m1.kind === 'practice' && typeof (m1.memory && m1.memory.at) === 'number').toBe(true)
  const m2 = await h.JW('/api/memory')
  expect(m2?.memory?.practice?.question?.stem === '记忆恢复原题干' && m2?.memory?.practice?.module === '判断推理').toBe(true)
})

test('SMOKE-MEM-04 记忆按工作区隔离', async () => {
  const m3 = await h.J('/api/memory?ws=PROJ_VTEST_MEM_B')
  expect(m3 && m3.memory && !m3.memory.practice).toBe(true)
})

test('SMOKE-MEM-05 非法 kind/缺 data/超 8KB 均受控拒绝', async () => {
  const m4a = await h.PW('/api/memory', { kind: 'BAD_KIND', data: {} })
  const m4b = await h.PW('/api/memory', { kind: 'practice' })
  const m4c = await h.PW('/api/memory', { kind: 'practice', data: { blob: 'x'.repeat(9000) } })
  expect(!!(m4a && m4a.error) && !!(m4b && m4b.error) && !!(m4c && m4c.error)).toBe(true)
})

test('SMOKE-MEM-06 manifest 声明 /api/memory 且消费者=三专项视图', () => {
  const manifestSrc = readSrc('src/shared/manifest.ts')
  expect(manifestSrc.includes("path: '/api/memory'") && manifestSrc.includes("consumers: ['ui:practice', 'ui:tuxing', 'ui:deepbank']")).toBe(true)
})

test('SMOKE-GR15-01 环形布局（语义层序圆周 + 引擎分支 + 三态轮换序列）', () => {
  const transSrc = readSrc('src/client/graph/graph-transition.ts')
  const engineSrc = readSrc('src/client/graph/graph-engine.ts')
  const graphViewSrc = readSrc('src/client/views/graph-view.tsx')
  expect(/export function graphCircularLayout/.test(transSrc) && transSrc.includes('labelGap') && transSrc.includes('2 * Math.PI * i) / V')).toBe(true)
  expect(engineSrc.includes("mode === 'circular' ? 'circular'") && engineSrc.includes('graphCircularLayout(simNodes, nodeMeta, W, H)')).toBe(true)
  expect(graphViewSrc.includes("const KG_LAYOUTS = ['force', 'layered', 'circular']") && (graphViewSrc.match(/kgNextLayout/g) || []).length >= 2).toBe(true)
})

test('SMOKE-GR15-02 流动粒子语义边集 + 确定性相位 + opt-in 开关', () => {
  const physicsSrc = readSrc('src/client/graph/graph-physics.ts')
  const engineSrc = readSrc('src/client/graph/graph-engine.ts')
  const graphViewSrc = readSrc('src/client/views/graph-view.tsx')
  expect(physicsSrc.includes('const KG_FLOW_RELS') && physicsSrc.includes('graphHash(String(e.a)') && engineSrc.includes('flow: { on: flowOn, t: now / 1700 }')).toBe(true)
  expect(engineSrc.includes('|| flowOn) schedule()') && graphViewSrc.includes('flowParticles: flowOn')).toBe(true)
})

test('SMOKE-OBS15-01/02 白盒三件套（分位阶梯 + 完成度环 + 四象限）', () => {
  const obsSrc = readSrc('src/client/views/obs-view.tsx')
  expect(obsSrc.includes('function ObsQuantLadder') && obsSrc.includes("'SLO 200ms'") && obsSrc.includes("'500ms'")).toBe(true)
  expect(obsSrc.includes('function ObsLifeRing') && obsSrc.includes('strokeDasharray') && obsSrc.includes("state === 'done'")).toBe(true)
  expect(obsSrc.includes('function ObsScatter') && obsSrc.includes('Math.log10(1 +') && obsSrc.includes('中位吞吐')).toBe(true)
})
