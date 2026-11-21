/**
 * tests/smoke/huasheng13-runtime2.test.mjs — 方法论域运行时·批二（cycle-47 阶段 13 迁移）
 *
 * 从 smoke.test.mjs HS13-04..09 段迁移（L600-845）：
 * HS13-04 检索边界（假设分配/隔板法命中 + 空查询 + bigram 噪声不丢弃）+
 * HS13-05 单篇全文/未知 file/缺参受控 + HS13-06 覆盖矩阵（overall 真实值 +
 * 维度口径透传 + 缺口如实）+ HS13-07 配套练习四元组 + HS13-08 trace + HS13-09 分槽隔离。
 * server 运行时段走 setupDomain；判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/huasheng13-runtime2.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null
const HU = (p) => `/api/huasheng13${p}${p.includes('?') ? '&' : '?'}ws=PROJ_VTEST_HS13B`
const HS = 'PROJ_VTEST_HS13B'

beforeAll(async () => {
  h = await setupDomain({ ws: HS })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('HS13-04 检索「假设分配」命中 ziliao-susuan 且置信度 high', async () => {
  const s2 = await h.J(HU('/search?q=' + encodeURIComponent('假设分配')))
  const t2 = (s2.results || [])[0]
  expect(Array.isArray(s2.results) && s2.results.length > 0 && t2.file === 'ziliao-susuan' && s2.confidence === 'high').toBe(true)
})

test('HS13-04 检索「隔板法」命中 shuliang-guanxi 且置信度 high', async () => {
  const s3 = await h.J(HU('/search?q=' + encodeURIComponent('隔板法')))
  const t3 = (s3.results || [])[0]
  expect(Array.isArray(s3.results) && s3.results.length > 0 && t3.file === 'shuliang-guanxi' && s3.confidence === 'high').toBe(true)
})

test('HS13-04 空查询返回 results=[] 且不报错（不当成 miss）', async () => {
  const s0 = await h.J(HU('/search?q='))
  expect(Array.isArray(s0.results) && s0.results.length === 0 && !s0.error && s0.total === 0).toBe(true)
})

test('HS13-04 bigram 噪声：生造词 confidence=low + phraseHit=false + 仍返回结果与 note', async () => {
  const sn = await h.J(HU('/search?q=' + encodeURIComponent('不存在的词')))
  expect(sn.confidence).toBe('low')
  expect(sn.phraseHit).toBe(false)
  expect(Array.isArray(sn.results) && sn.results.length > 0 && typeof sn.note === 'string' && sn.note.indexOf('部分') >= 0).toBe(true)
})

test('HS13-05 doc?file=ziliao-fenxi 返回 markdown 含「ABRX」+ 元信息完整', async () => {
  const d = await h.J(HU('/doc?file=ziliao-fenxi'))
  expect(typeof d.markdown).toBe('string')
  expect(d.markdown.length).toBeGreaterThan(1000)
  expect(d.markdown.indexOf('ABRX')).toBeGreaterThanOrEqual(0)
  expect(d.file === 'ziliao-fenxi' && d.moduleId === 'ziliao' && d.chars > 0 && d.formulas > 0 && typeof d.weight === 'number' && d.weight > 1).toBe(true)
})

test('HS13-05 未知 file 受控（200 + {error} + known 25 清单）+ 缺 file 受控降级', async () => {
  const r = await fetch(h.base + HU('/doc?file=__not_exist__'))
  const bad = await r.json()
  expect(r.status).toBe(200)
  expect(typeof bad.error === 'string' && bad.error.length > 0 && Array.isArray(bad.known) && bad.known.length === 25 && bad.known.indexOf('ziliao-fenxi') >= 0).toBe(true)
  const r2 = await fetch(h.base + HU('/doc'))
  const d2 = await r2.json()
  expect(r2.status).toBe(200)
  expect(typeof d2.error === 'string' && typeof d2.hint === 'string').toBe(true)
})

test('HS13-06 覆盖矩阵：六模块齐备 + overall=0.9756 真实值（不凑绿）+ 口径可复算', async () => {
  const c = await h.J(HU('/coverage'))
  const IDS = ['ziliao', 'shuliang', 'yanyu', 'panduan', 'changshi', 'shenlun']
  expect(Array.isArray(c.modules) && c.modules.length === 6 && IDS.every(id => c.modules.some(m => m.id === id))).toBe(true)
  expect(typeof c.overall === 'number' && c.overall >= 0 && c.overall <= 1 && Math.abs(c.overall - 0.9756) < 1e-9).toBe(true)
  expect(c.modules.every(m => typeof m.coverage === 'number' && m.coverage >= 0 && m.coverage <= 1)).toBe(true)
  expect(c.expectedDims > 0 && c.presentDims > 0 && Math.abs(c.overall - c.presentDims / c.expectedDims) < 1e-3).toBe(true)
})

test('HS13-06 维度口径透传（常识/申论 dims.formula=false）+ 缺口清单如实暴露 yanyu', async () => {
  const c = await h.J(HU('/coverage'))
  const cs = c.modules.find(m => m.id === 'changshi') || {}
  const sl = c.modules.find(m => m.id === 'shenlun') || {}
  expect(!!cs.dims && cs.dims.formula === false && !!sl.dims && sl.dims.formula === false).toBe(true)
  expect(Array.isArray(c.gaps) && c.gaps.some(g => g.module === 'yanyu' && /缺公式/.test(String(g.detail)))).toBe(true)
})

test('HS13-07 配套练习：total/n/returned/hasMore 四元组 + 题目形状 + answerIsLetter 口径', async () => {
  const d5 = await h.J(HU('/practice?file=ziliao-lianxi'))
  expect(d5.total === 10 && d5.n === 5 && d5.returned === 5 && Array.isArray(d5.items) && d5.items.length === 5 && d5.hasMore === true).toBe(true)
  const d10 = await h.J(HU('/practice?file=ziliao-lianxi&n=10'))
  expect(d10.returned === 10 && d10.hasMore === false && d10.total === 10).toBe(true)
  // 题目形状（旧判据逐字等价）：index 连续 + stem 非空；options 是数组且每项 key:string + 有项时 text:string；analysis:string
  const items = d10.items
  expect(items.every((it, i) => it.index === i + 1 && typeof it.stem === 'string' && it.stem.length > 0)).toBe(true)
  expect(items.every(it => Array.isArray(it.options) && it.options.every(o => typeof o.key === 'string'))).toBe(true)
  expect(items.filter(it => it.options.length > 0).every(it => it.options.every(o => typeof o.text === 'string'))).toBe(true)
  expect(items.every(it => typeof it.analysis === 'string')).toBe(true)
  // answerIsLetter 口径自洽（true ⇒ A-D；false ⇒ 文字作答）
  const letters = items.filter(it => it.answerIsLetter === true)
  const words = items.filter(it => it.answerIsLetter === false)
  expect(letters.length > 0 && words.length > 0 &&
    letters.every(it => /^[A-D]$/i.test(String(it.answer || '').trim())) &&
    words.every(it => !/^[A-D]$/i.test(String(it.answer || '').trim()))).toBe(true)
  const sl = await h.J(HU('/practice?file=shuliang-lianxi&n=18'))
  expect(sl.returned).toBe(18)
  expect(sl.items.every(q => q.answerIsLetter === false), '数量关系全为文字作答').toBe(true)
  const bad = await h.J(HU('/practice?file=__not_exist__'))
  expect(!!bad.error && Array.isArray(bad.known) && bad.known.length === 25).toBe(true)
})

test('HS13-08 trace 六端点槽位（对象槽）+ searches 四元组 + docs 读取统计 + recent 字段', async () => {
  const tr = await h.J(HU('/trace'))
  const covers = ['/api/huasheng13/catalog', '/api/huasheng13/doc', '/api/huasheng13/search', '/api/huasheng13/coverage', '/api/huasheng13/practice', '/api/huasheng13/trace']
  expect(!!tr.endpoints && Object.keys(tr.endpoints).length === 6 &&
    covers.every(p => tr.endpoints[p] && typeof tr.endpoints[p].hits === 'number' &&
      typeof tr.endpoints[p].p50 === 'number' && typeof tr.endpoints[p].p95 === 'number' &&
      typeof tr.endpoints[p].lastAt === 'number' && typeof tr.endpoints[p].samples === 'number')).toBe(true)
  expect(!!tr.searches && typeof tr.searches.total === 'number' && typeof tr.searches.hit === 'number' &&
    typeof tr.searches.miss === 'number' && typeof tr.searches.empty === 'number' && typeof tr.searches.hitRate === 'number' &&
    (tr.searches.total === 0 ? tr.searches.hitRate === 0
      : Math.abs(tr.searches.hitRate - tr.searches.hit / tr.searches.total) < 1e-3)).toBe(true)
  expect(!!tr.docs && typeof tr.docs.distinct === 'number' && !!tr.docs.reads && typeof tr.docs.reads === 'object').toBe(true)
  expect(Array.isArray(tr.recent) && tr.recent.length > 0 &&
    tr.recent.every(x => typeof x.at === 'number' && typeof x.kind === 'string' &&
      typeof x.detail === 'string' && typeof x.ms === 'number')).toBe(true)
})

test('HS13-08 命中计数单调递增 + 全文读取按 file 分键 + 环形缓冲容量', async () => {
  const before = await h.J(HU('/trace'))
  const hitsOf = (t, p) => (t.endpoints && t.endpoints[p] && t.endpoints[p].hits) || 0
  const searchBefore = hitsOf(before, '/api/huasheng13/search')
  const docBefore = hitsOf(before, '/api/huasheng13/doc')
  await h.J(HU('/search?q=ABRX'))
  await h.J(HU('/doc?file=ziliao-fenxi'))
  await h.J(HU('/doc?file=ziliao-fenxi'))
  const t1 = await h.J(HU('/trace'))
  expect(hitsOf(t1, '/api/huasheng13/search') === searchBefore + 1 &&
    hitsOf(t1, '/api/huasheng13/doc') === docBefore + 2,
    `search ${searchBefore}→${hitsOf(t1, '/api/huasheng13/search')} doc ${docBefore}→${hitsOf(t1, '/api/huasheng13/doc')}`).toBe(true)
  expect(!!t1.docs && !!t1.docs.reads && typeof t1.docs.reads['ziliao-fenxi'] === 'number' &&
    t1.docs.reads['ziliao-fenxi'] >= 2).toBe(true)
  expect(!!t1.ring && (t1.ring.recentCap === 200 || typeof t1.ring.recentCap === 'number') &&
    (t1.recent || []).length <= (t1.ring.recentCap || 200)).toBe(true)
})

test('HS13-09 跨工作区计数隔离（A 有真实调用、B 全零）+ 分槽独立', async () => {
  const trA = await h.J(HU('/trace'))
  const trB = await h.J(`/api/huasheng13/trace?ws=PROJ_VTEST_HS13B2`)
  expect(trA.searches && trA.searches.total > 0, 'A 有真实调用').toBe(true)
  expect(trB.searches && trB.searches.total === 0, 'B 全零（隔离）').toBe(true)
  const trDefault = await h.J('/api/huasheng13/trace')
  expect(trDefault.searches && typeof trDefault.searches.total === 'number', 'default 独立槽').toBe(true)
})
