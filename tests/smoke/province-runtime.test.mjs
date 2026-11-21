/**
 * tests/smoke/province-runtime.test.mjs — 省份维度运行时 + 方法论分区活体（cycle-47 阶段 15 迁移）
 *
 * 从 smoke.test.mjs cycle-13 省份维度运行时段迁移（L1149-1178）：
 * R-P-02（?province=山东 过滤语义 + 无参全量 + provinces facet）+
 * R-N-01（/api/methods 活体 + /api/naoku/questions 结构化降级语义）。
 * server 运行时段走 setupDomain；判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/province-runtime.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_PROV' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('R-P-02 ?province=山东 全部命中且 total>0', async () => {
  const psd = await h.J(`/api/papers?province=${encodeURIComponent('山东')}&ws=PROJ_VTEST_PROV`)
  expect(psd.total).toBeGreaterThan(0)
  expect((psd.papers || []).length).toBeGreaterThan(0)
  expect(psd.papers.every(p => p.province === '山东')).toBe(true)
})

test('R-P-02 无参返回全量 + provinces facet（服务端透出）', async () => {
  const allP = await h.J('/api/papers')
  expect(allP.total).toBeGreaterThan(1000)
  expect(Array.isArray(allP.provinces) && allP.provinces.length >= 35).toBe(true)
})

test('R-N-01 /api/methods 活体（HTTP 200 + 10 主题目录）', async () => {
  const methodsR = await fetch(`${h.base}/api/methods`)
  const meW3 = await methodsR.json()
  expect(methodsR.status).toBe(200)
  expect(Array.isArray(meW3.topics) && meW3.topics.length).toBe(10)
})

test('R-N-01 /api/naoku/questions 结构化（就绪=题目数组 / 未就绪=空数组+fallback，非 5xx）', async () => {
  const nkR = await fetch(`${h.base}/api/naoku/questions?count=20&random=0&ws=PROJ_VTEST_PROV`)
  const nkW3 = await nkR.json()
  expect(nkR.status).toBe(200)
  expect(nkW3 && typeof nkW3 === 'object' &&
    (nkW3.fallback === true ? Array.isArray(nkW3.questions) && nkW3.questions.length === 0
                            : Array.isArray(nkW3.questions))).toBe(true)
})
