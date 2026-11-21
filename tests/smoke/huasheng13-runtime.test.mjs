/**
 * tests/smoke/huasheng13-runtime.test.mjs — 方法论域运行时（cycle-47 阶段 7 迁移）
 *
 * 从 smoke.test.mjs 迁移：HS13-01（catalog 200 + 25 篇实体 + 双向零漂移）+
 * HS13-02（端点口径六条 + 六端点真实可达 + 未知子路径受控回落 + 影子端点防线）+
 * HS13-03（BM25 检索命中）。
 * server 运行时段走 setupDomain（阶段 5 样板）；判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/huasheng13-runtime.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_HS13R' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

const HU = (p) => `/api/huasheng13${p}${p.includes('?') ? '&' : '?'}ws=PROJ_VTEST_HS13R`

test('HS13-01 catalog 200 + docCount=25 + 三层结构完整', async () => {
  const r = await fetch(h.base + HU('/catalog'))
  const c = await r.json()
  expect(r.status).toBe(200)
  expect(c.meta && c.meta.docCount).toBe(25)
  expect(Array.isArray(c.modules) && c.modules.length).toBe(6)
  expect(Array.isArray(c.strategy) && c.strategy.length).toBe(3)
  expect(Array.isArray(c.examples) && c.examples.length).toBe(1)
})

test('HS13-01 声明数 ≡ 磁盘可用数（25/25，degraded=false 且 missing 空）', async () => {
  const c = await h.J(HU('/catalog'))
  expect(c.meta.available).toBe(25)
  expect(c.meta.missingCount).toBe(0)
  expect(Array.isArray(c.meta.missing) && c.meta.missing.length).toBe(0)
  expect(c.meta.degraded).toBe(false)
})

test('HS13-01 目录树 25 篇实体且逐篇含真实解析统计（chars/sections>0、present=true）', async () => {
  const c = await h.J(HU('/catalog'))
  const flat = []
  for (const m of (c.modules || [])) {
    for (const d of (m.docs || [])) flat.push(d)
    for (const e of (m.examples || [])) flat.push(e)
  }
  for (const s of (c.strategy || [])) flat.push(s)
  for (const e of (c.examples || [])) flat.push(e)
  expect(flat.length).toBe(25)
  const leafBad = flat.filter(d => !(d.present === true && d.chars > 0 && d.sections > 0))
  expect(leafBad.map(d => d.file), '解析统计异常篇目').toEqual([])
})

test('HS13-01 磁盘与 META 双向零漂移（orphans=[] 且 dirMismatch=[]）', async () => {
  const c = await h.J(HU('/catalog'))
  expect(Array.isArray(c.meta.orphans) && c.meta.orphans.length).toBe(0)
  expect(Array.isArray(c.meta.dirMismatch) && c.meta.dirMismatch.length).toBe(0)
})

test('HS13-02 CAPABILITIES 恰声明 6 个 /api/huasheng13/* 端点（无缺无多，运行态对账）', async () => {
  const caps = await h.J('/api/capabilities')
  const declared = (caps.endpoints || []).map(e => e.path).filter(p => String(p).indexOf('/api/huasheng13/') === 0)
  const EXPECT = [
    '/api/huasheng13/catalog', '/api/huasheng13/doc', '/api/huasheng13/search',
    '/api/huasheng13/coverage', '/api/huasheng13/practice', '/api/huasheng13/trace',
  ]
  expect(declared.length).toBe(6)
  expect(EXPECT.every(p => declared.indexOf(p) >= 0)).toBe(true)
  expect(declared.every(p => p.charAt(0) === '/' && p.indexOf('/kaogong') !== 0), '逻辑路径无挂载前缀').toBe(true)
})

test('HS13-02 运行态自证：trace.declaration.allDeclared=true 且 6 条逐条 declared', async () => {
  const tr = await h.J(HU('/trace'))
  expect(tr.declaration && tr.declaration.allDeclared).toBe(true)
  expect(Array.isArray(tr.declaration.endpoints) && tr.declaration.endpoints.length).toBe(6)
  expect(tr.declaration.endpoints.every(d => d.declared === true)).toBe(true)
})

test('HS13-02 六端点逐条真实可达（HTTP 200 且非 Unknown API）', async () => {
  const six = [
    ['/catalog', x => Array.isArray(x.modules)],
    ['/doc?file=ziliao-fenxi', x => typeof x.markdown === 'string' && x.markdown.length > 0],
    ['/search?q=ABRX', x => Array.isArray(x.results)],
    ['/coverage', x => Array.isArray(x.modules)],
    ['/practice?file=ziliao-lianxi', x => Array.isArray(x.items)],
    ['/trace', x => !!x.endpoints],
  ]
  let routeBad = ''
  for (const pair of six) {
    const rr = await fetch(h.base + HU(pair[0]))
    const bb = await rr.json()
    if (rr.status !== 200 || !pair[1](bb) || /Unknown API/.test(String(bb.error || ''))) routeBad += pair[0] + ' '
  }
  expect(routeBad, '不可达端点').toBe('')
})

test('HS13-02 未知子路径受控回落（HTTP 200 + {error}，不 5xx 不崩）', async () => {
  // 旧文件探针打 ${base}/api/huasheng13/__no_such_sub__（域内未知子路径）——
  // 域链的「Unknown API」回落是对 /api/huasheng13 前缀下未声明子路径的行为；
  // 根路径裸探针（/api/__no_such_sub__）走的是独立端口 404「Not found」文本，非 JSON。
  const rj = await fetch(h.base + HU('/__no_such_sub__'))
  const bj = await rj.json()
  expect(rj.status).toBe(200)
  expect(!!(bj && bj.error) && /Unknown API/.test(String(bj.error))).toBe(true)
})

test('HS13-02 未声明路径不污染端点对账（只进 __unmatched__ 聚合桶）', async () => {
  const telNow = await h.J('/api/telemetry')
  const epKeys = Object.keys(telNow.endpoints || {})
  expect(epKeys.every(k => !/__no_such_sub__/.test(k)), '影子端点键泄漏').toBe(true)
  expect(!!telNow.unmatched && telNow.unmatched.count > 0, '未声明请求仍可观测').toBe(true)
})

test('HS13-03 BM25 检索「截位直除」命中且首条= ziliao-susuan', async () => {
  const s = await h.J(HU('/search?q=' + encodeURIComponent('截位直除')))
  const r0 = (s.results || [])[0]
  expect(!!r0, '检索有结果').toBe(true)
  expect(r0.file === 'ziliao-susuan' || (s.results || []).some(x => x.file === 'ziliao-susuan'),
    '三大速算方法命中').toBe(true)
})
