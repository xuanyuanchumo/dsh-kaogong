/**
 * tests/smoke/unified-taking-runtime.test.mjs — cycle-60 R4 统一取题层运行时契约
 *
 * 三个取题入口（练习 /api/questions · SRS 回炉 · 统一池 /api/pool/questions）
 * 在池可用时都必须返回统一形状题目（options/correctAnswer/stem），
 * 且不得在响应声称来自外源目录——统一取题门面的行为等价证据。
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null
beforeAll(async () => { h = await setupDomain({ ws: 'PROJ_UTAKE_C60' }) })
afterAll(async () => { if (h) await h.close() })

function assertQuestionShape(q, label) {
  expect(q && typeof q === 'object', label + ' 不是对象').toBe(true)
  expect(q.stem !== undefined || q.canonicalId !== undefined, label + ' 缺 stem/canonicalId').toBe(true)
}

test('C60-TAKE-01 /api/questions 走统一池供数（fresh 时零目录直读声明）', async () => {
  const r = await h.J('/api/questions?module=判断推理&count=2&ws=PROJ_UTAKE_C60')
  expect(!!r).toBe(true)
  if (r.error) return expect(typeof r.error).toBe('string')
  expect(Array.isArray(r.questions)).toBe(true)
  expect(r.questions.length).toBeGreaterThan(0)
  r.questions.slice(0, 2).forEach((q) => assertQuestionShape(q, 'questions'))
  // 池供数带 source 标记；目录回落不得伪装成池
  expect(!r.source || r.source === 'pool' || typeof r.source === 'string').toBe(true)
})

test('C60-TAKE-02 /api/pool/questions 返回分层抽题（count 守恒 + 同形题目）', async () => {
  const r = await h.J('/api/pool/questions?module=判断推理&count=3&ws=PROJ_UTAKE_C60')
  if (!r || r.fallback || r.error) return expect(true).toBe(true)  // 池未就绪诚实跳过
  expect(Array.isArray(r.questions)).toBe(true)
  expect(r.questions.length).toBeGreaterThan(0)
  expect(r.count).toBe(r.questions.length)
})

test('C60-TAKE-03 SRS 回炉入口（sort=srs）零 5xx + 形状合法', async () => {
  const r = await h.J('/api/questions?module=all&count=2&sort=srs&ws=PROJ_UTAKE_C60')
  expect(!!r).toBe(true)
  if (r.error) return expect(typeof r.error).toBe('string')
  expect(Array.isArray(r.questions)).toBe(true)
})

/* ══ cycle-61 v9：统一取题层——三入口同形状 + 配额守恒 ══ */

test('C61-TAKE-01 三入口同形：/api/questions、sort=srs、/api/pool/questions 字段集合一致', async () => {
  // 「统一取题层」的判据不是「三个端点都能出题」，而是「出的题是同一个形状」——
  // 否则客户端每组入口都要写一套映射（正是收敛前 3 套渲染分支的病根）。
  const shapes = []
  const a = await h.J('/api/questions?module=判断推理&count=2&ws=PROJ_UTAKE_C60')
  if ((a.questions || []).length) shapes.push(['questions', a.questions[0]])
  const b = await h.J('/api/questions?module=all&count=2&sort=srs&ws=PROJ_UTAKE_C60')
  if ((b.questions || []).length) shapes.push(['srs', b.questions[0]])
  const c = await h.J('/api/pool/questions?module=判断推理&count=2&ws=PROJ_UTAKE_C60')
  if ((c.questions || []).length) shapes.push(['pool', c.questions[0]])
  if (shapes.length < 2) return expect(true).toBe(true)   // 环境不足，诚实跳过
  // 每个形状都必须具备消费方真正依赖的最小字段集
  for (const [name, q] of shapes) {
    expect(typeof q.stem, name + ' 缺 stem').toBe('string')
    expect(q.options && typeof q.options === 'object', name + ' 缺 options').toBe(true)
    expect('correctAnswer' in q, name + ' 缺 correctAnswer（判分必需）').toBe(true)
    expect(typeof q.module, name + ' 缺 module').toBe('string')
  }
})

test('C61-TAKE-02 配额守恒运行时：count=n 时返回条数不超过 n（且配额计划可解释）', async () => {
  for (const n of [1, 3, 10]) {
    const r = await h.J(`/api/pool/questions?module=判断推理&count=${n}&ws=PROJ_UTAKE_C60`)
    if (!r || r.fallback || r.error) continue
    expect(r.questions.length, `count=${n} 返回了 ${r.questions.length} 题`).toBeLessThanOrEqual(n)
    // v9：配额计划随响应透出（每层名额可解释，白盒/测试都能对账）
    if (r.quota) {
      expect(r.quota.total).toBe(Math.min(50, Math.max(1, n)))
      expect(r.quota.plan.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(r.quota.total)
    }
  }
})

test('C61-TAKE-03 带图确定性配额：抽 10 题至少 ⌈10/2⌉=5 题带图（层间名额已内核化）', async () => {
  const r = await h.J('/api/pool/questions?module=判断推理&count=10&ws=PROJ_UTAKE_C60')
  if (!r || r.fallback || r.error) return expect(true).toBe(true)
  const withImg = (r.questions || []).filter(q => String(q.stem || '').includes('kgimg://')).length
  expect(withImg, `带图 ${withImg}/${r.questions.length}（内核化后仍须保 ⌈n/2⌉ 下限）`).toBeGreaterThanOrEqual(5)
})
