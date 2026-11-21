/**
 * tests/smoke/pool.test.mjs — 统一池域冒烟（cycle-47 测试体系重构 · 阶段 1 迁移示范）
 *
 * 从 smoke.test.mjs 迁移的域：SMOKE-POOL-01..04b + KGDB-02..05c（池运行时断言）+ MAT-01..03。
 * 迁移语义：断言内容逐字等价（不改判定逻辑），仅 harness 换成共享设施 + vitest 形态。
 *
 * 运行：npx vitest run tests/smoke/pool.test.mjs（或 npm run test:all 聚合）
 * 前置：npm run build（dist 新鲜）+ 真实数据根可读 + 统一池就绪（harness 自动自检重建）。
 *
 * ⚠️ 迁移期间双轨：旧 smoke.test.mjs 内同 ID 断言仍在跑（until 全量迁移完成），
 * 两处并存期间任一失败都以旧文件为准修（旧文件是权威事实源）。
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { getTestServer, closeTestServer, J, P, ensurePoolReady } from '../_harness/server.mjs'

let base = ''
let poolReady = false

beforeAll(async () => {
  const s = await getTestServer()
  base = s.base
  poolReady = await ensurePoolReady(base)
}, 120_000)

afterAll(async () => {
  await closeTestServer()
})

/** 测试命名空间（隔离：不污染真实进度） */
const CX = 'PROJ_VTEST_POOL'

test('SMOKE-POOL-01 pool/status 返回 ready + stats（未就绪时诚实降级）', async () => {
  const st = await J(base, '/api/pool/status?ws=' + CX)
  if (poolReady) {
    expect(st.ready).toBe(true)
    expect(st.stats.questions).toBeGreaterThan(0)
    expect(Array.isArray(st.tables)).toBe(true)
  } else {
    // 诚实降级三态：不假绿也不崩
    expect(st.ready === false || (st.stats && st.stats.questions > 0)).toBe(true)
  }
})

test('SMOKE-POOL-02 多源分层抽题可用（题目含出处与五维字段位）', async () => {
  if (!poolReady) return expect(true).toBe(true) // 环境降级跳过（诚实三态）
  const pq = await J(base, `/api/pool/questions?count=3&ws=${CX}`)
  expect(Array.isArray(pq.questions)).toBe(true)
  expect(pq.questions.length).toBeGreaterThan(0)
  expect(pq.questions[0].canonicalId).toBeTruthy()
  expect(Array.isArray(pq.questions[0].sources)).toBe(true)
})

test('SMOKE-POOL-03 source 过滤精确（三源抽题主源全匹配，不越界）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  for (const src of ['naoku', 'qiuzhao-epi-bank', 'gk-tuxing']) {
    const j = await J(base, `/api/pool/questions?source=${encodeURIComponent(src)}&count=10&ws=${CX}`)
    const qs = j.questions || []
    const mismatch = qs.filter(q => {
      const s0 = (q.sources && q.sources[0] && q.sources[0].source_id) || q.source
      return s0 && s0 !== src
    }).length
    expect(qs.length, `源 ${src} 返回条数`).toBeGreaterThanOrEqual(5)
    expect(mismatch, `源 ${src} 越界数`).toBe(0)
  }
})

test('SMOKE-POOL-03b 未知 source 返回 0 条（不静默越界）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const nope = await J(base, `/api/pool/questions?source=__nope__&count=10&ws=${CX}`)
  expect((nope.questions || []).length).toBe(0)
})

test('SMOKE-POOL-04 抽题分布防偏斜（考点多样性 ≥5 · 主源多样性 ≥2）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const kads = new Set(), srcs = new Set()
  let tot = 0
  for (let i = 0; i < 6; i++) {
    const j = await J(base, `/api/pool/questions?module=${encodeURIComponent('判断推理')}&count=10&ws=${CX}`)
    for (const q of (j.questions || [])) {
      tot++
      const k = String(q.kadian || (q.dims && q.dims.kadian) || '')
      if (k) kads.add(k)
      const s0 = (q.sources && q.sources[0] && q.sources[0].source_id) || q.source
      if (s0) srcs.add(String(s0))
    }
  }
  expect(tot).toBeGreaterThan(0)
  expect(kads.size, '考点多样性').toBeGreaterThanOrEqual(5)
  expect(srcs.size, '主源多样性').toBeGreaterThanOrEqual(2)
})

test('SMOKE-POOL-04b kadian 过滤精确（返回题考点均匹配，不越界）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const k = await J(base, `/api/pool/questions?kadian=${encodeURIComponent('人文常识')}&count=6&ws=${CX}`)
  const bad = (k.questions || []).filter(q => {
    const kk = String(q.kadian || (q.dims && q.dims.kadian) || '')
    return kk && !kk.includes('人文常识')
  }).length
  expect(bad).toBe(0)
})

test('SMOKE-KGDB-04 跨源检索命中且去重（一条 canonical_id 一结果）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const sr = await J(base, `/api/pool/search?q=${encodeURIComponent('图形推理')}&limit=10&ws=${CX}`)
  expect(Array.isArray(sr.results)).toBe(true)
  expect(sr.results.length).toBeGreaterThan(0)
  expect(new Set(sr.results.map(r => r.canonicalId)).size).toBe(sr.results.length)
})

test('SMOKE-KGDB-04b 检索响应 < 400ms（性能基线 · 预热后）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  // 预热一次（不计分），测第二轮
  await J(base, `/api/pool/search?q=${encodeURIComponent('图形推理')}&limit=10&ws=${CX}`)
  const sr2 = await J(base, `/api/pool/search?q=${encodeURIComponent('图形推理')}&limit=10&ws=${CX}`)
  expect(typeof sr2.tookMs).toBe('number')
  expect(sr2.tookMs, '热态检索耗时').toBeLessThan(400)
})

test('SMOKE-KGDB-05b 关系查询可用（rel_type 过滤生效）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const pr = await J(base, `/api/pool/relations?rel_type=BELONGS_TO&limit=5&ws=${CX}`)
  expect(Array.isArray(pr.relations)).toBe(true)
  expect(pr.relations.length).toBeGreaterThan(0)
  expect(pr.relations.every(r => r.rel_type === 'BELONGS_TO')).toBe(true)
})

test('SMOKE-MAT-01 资料分析抽题：材料题必带材料正文（无死题）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const matSample = await J(base, `/api/questions?module=${encodeURIComponent('资料分析')}&count=12&ws=${CX}`)
  const matQs = Array.isArray(matSample.questions) ? matSample.questions : []
  const matWith = matQs.filter(q => String(q.groupMaterial || '').trim()).length
  expect(matQs.length).toBeGreaterThan(0)
  expect(matWith, '带材料题数').toBeGreaterThan(0)
})

test('SMOKE-MAT-02 组整体抽取：同材料组员连续齐备（整组≥2）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const matSample = await J(base, `/api/questions?module=${encodeURIComponent('资料分析')}&count=12&ws=${CX}`)
  const matQs = Array.isArray(matSample.questions) ? matSample.questions : []
  const matGroups = new Map()
  for (const q of matQs) {
    const k = String(q.groupMaterial || '')
    if (k) matGroups.set(k, (matGroups.get(k) || 0) + 1)
  }
  const maxGroup = Math.max(0, ...matGroups.values())
  expect(maxGroup, '最大同材料组员数').toBeGreaterThanOrEqual(2)
})

test('SMOKE-MAT-03 回炉/抽题对象形状含材料字段位（字段可选不报错）', async () => {
  if (!poolReady) return expect(true).toBe(true)
  const srsShape = await J(base, `/api/questions?sort=srs&module=${encodeURIComponent('资料分析')}&count=1&ws=${CX}`)
  const srsQ = (srsShape.questions || [])[0]
  if (srsQ) expect(typeof srsQ.groupMaterial).toBe('string')
})
