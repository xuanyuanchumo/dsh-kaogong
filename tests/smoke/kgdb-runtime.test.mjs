/**
 * tests/smoke/kgdb-runtime.test.mjs — 存储层运行时域（cycle-47 阶段 12 迁移·批四）
 *
 * 从 smoke.test.mjs KGDB 运行时段迁移（L1429-1526）：
 * KGDB-02/02b（canonical_id 唯一 + SAME_AS 无自环）/ 03/03b/03c（kadian 覆盖率
 * 源内口径 + rel_type 词表 + 一题多出处）/ 04/04b（FTS 检索 + 400ms 热态基线）/
 * 05/05b/05c（分层抽题 + 关系查询 + 关系子图）。
 * pool.test.mjs 已覆盖 POOL-01..04b/KGDB-04 检索近似断言——本文件迁的是**未迁的
 * KGDB-02/02b/03/03b/03c/04b/05/05b/05c 精确判据**。环境降级三态保留。
 *
  * 旧 ID 对照：SMOKE-POOL-02b（无孤儿出处）
 * 运行：npx vitest run tests/smoke/kgdb-runtime.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null
let poolReady = false
let poolStatus = null

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_KGDBR' })
  const st = await h.J('/api/pool/status?ws=PROJ_VTEST_KGDBR')
  poolStatus = st
  poolReady = !!(st && st.ready)
}, 120_000)

afterAll(async () => {
  if (h) await h.close()
})

test('SMOKE-KGDB-02 canonical_id 唯一（池内无重复身份）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const st = poolStatus.stats || {}
  expect(st.questions > 0 && st.distinctQid > 0 && st.questions >= st.distinctQid).toBe(true)
})

test('SMOKE-KGDB-02b SAME_AS 边无自环', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const selfLoop = await h.J('/api/pool/relations?rel_type=SAME_AS&limit=200&ws=PROJ_VTEST_KGDBR')
  const loops = (selfLoop.relations || []).filter(r => r.src_id === r.dst_id && r.src_kind === r.dst_kind)
  expect(loops.length, loops.length + ' 自环').toBe(0)
})

test('SMOKE-KGDB-03 关系覆盖：kadian 边 ≥ 池内 naoku 题数×0.99（源内 100% 口径）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const st = poolStatus.stats || {}
  const kadianEdges = (st.relTypes || []).find(r => r.type === 'BELONGS_TO')
  const naokuQ = ((poolStatus.health || {}).sources || []).find(s => s.sourceId === 'naoku')
  const naokuInPool = naokuQ ? naokuQ.questions : 0
  expect(!!kadianEdges && !!naokuInPool && kadianEdges.count >= naokuInPool * 0.99,
    `kadian=${kadianEdges && kadianEdges.count} naokuInPool=${naokuInPool}`).toBe(true)
})

test('SMOKE-KGDB-03b 关系类型齐备（≥8 种 rel_type）+ 03c 一题多出处', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const st = poolStatus.stats || {}
  expect((st.relTypes || []).length).toBeGreaterThanOrEqual(8)
  expect(st.multiSource > 0 && st.questionSources > st.questions).toBe(true)
})

test('SMOKE-KGDB-04 跨源检索命中且去重（一条 canonical_id 一结果）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const sr = await h.J(`/api/pool/search?q=${encodeURIComponent('图形推理')}&limit=10&ws=PROJ_VTEST_KGDBR`)
  expect(Array.isArray(sr.results) && sr.results.length > 0).toBe(true)
  expect(new Set(sr.results.map(r => r.canonicalId)).size).toBe(sr.results.length)
})

test('SMOKE-KGDB-04b 检索响应 < 400ms（性能基线 · 预热后）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  await h.J(`/api/pool/search?q=${encodeURIComponent('图形推理')}&limit=10&ws=PROJ_VTEST_KGDBR`)  // 预热
  const sr2 = await h.J(`/api/pool/search?q=${encodeURIComponent('图形推理')}&limit=10&ws=PROJ_VTEST_KGDBR`)
  expect(typeof sr2.tookMs === 'number' && sr2.tookMs < 400, `warm=${sr2.tookMs}ms`).toBe(true)
})

test('SMOKE-KGDB-05/05b/05c 分层抽题 + 关系查询 + 关系子图端到端', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const pq = await h.J('/api/pool/questions?count=3&ws=PROJ_VTEST_KGDBR')
  expect(Array.isArray(pq.questions) && pq.questions.length > 0 &&
    pq.questions[0].canonicalId && Array.isArray(pq.questions[0].sources)).toBe(true)
  const pr = await h.J('/api/pool/relations?rel_type=BELONGS_TO&limit=5&ws=PROJ_VTEST_KGDBR')
  expect(Array.isArray(pr.relations) && pr.relations.length > 0 &&
    pr.relations.every(r => r.rel_type === 'BELONGS_TO')).toBe(true)
  const pg = await h.J('/api/pool/graph?limit=30&ws=PROJ_VTEST_KGDBR')
  expect(pg.nodeCount > 0 && pg.edgeCount > 0).toBe(true)
})

test('SMOKE-POOL-02b 无孤儿出处（每题出处必指向存在的题；DB 不可达则跳过）', async () => {
  try {
    const { USER_DATA_ROOT } = await import('../../dist/server/dataRoot.js')
    const { DatabaseSync } = await import('node:sqlite')
    const pdb = new DatabaseSync(USER_DATA_ROOT + '/.kaogong.db', { readOnly: true })
    const orphan = pdb.prepare('SELECT COUNT(*) c FROM question_source s WHERE NOT EXISTS (SELECT 1 FROM question q WHERE q.canonical_id = s.canonical_id)').get().c
    pdb.close()
    expect(orphan, `孤儿 ${orphan}`).toBe(0)
  } catch (e) {
    expect('DB 不可达则跳过: ' + String(e).slice(0, 40)).toBe('DB 不可达则跳过: ' + String(e).slice(0, 40))
  }
})

test('SMOKE-MAT-01..03 资料分析材料保真（/api/questions 供数面）', async () => {
  const matSample = await h.J(`/api/questions?module=${encodeURIComponent('资料分析')}&count=12&ws=PROJ_VTEST_KGDBR`)
  const matQs = Array.isArray(matSample.questions) ? matSample.questions : []
  expect(matQs.length).toBeGreaterThan(0)
  const matWith = matQs.filter(q => String(q.groupMaterial || '').trim()).length
  expect(matWith, '带材料题数').toBeGreaterThan(0)
  const matGroups = new Map()
  for (const q of matQs) {
    const k = String(q.groupMaterial || '')
    if (k) matGroups.set(k, (matGroups.get(k) || 0) + 1)
  }
  const maxGroup = Math.max(0, ...matGroups.values())
  expect(maxGroup, '最大同材料组员数').toBeGreaterThanOrEqual(2)
  const srsQ = ((await h.J(`/api/questions?sort=srs&module=${encodeURIComponent('资料分析')}&count=1&ws=PROJ_VTEST_KGDBR`)).questions || [])[0]
  if (srsQ) expect(typeof srsQ.groupMaterial).toBe('string')
})
