/**
 * tests/unit/review-store.test.mjs — 统一错题与补录层单测（cycle-61 v9）
 *
 * 覆盖：库优先读 + JSON 降级（tier 可观测）/ 单条 upsert 幂等与字段保留 /
 * 移除语义 / 诊断分桶 / 撤销软删。
 *
 * 为什么需要单测而不是只靠 smoke：这些函数是「库为权威、JSON 为镜像」反转后的
 * 唯一写入口，逻辑错误会让错题本与补录台账静默不一致（smoke 只测 HTTP 表面）。
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let dir = null
let poolDbMod = null
let store = null

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-review-'))
  poolDbMod = await import('../../dist/adapters/poolDb.js')
  store = await import('../../dist/server/reviewStore.js')
  // 隔离数据根：绝不碰生产 ~/.dsh/kaogong
  await poolDbMod.openPoolDb(dir)
})

afterAll(() => {
  try { poolDbMod.resetPoolDb() } catch {}
  try { dir && fs.rmSync(dir, { recursive: true, force: true }) } catch {}
})

const WS = 'unit-ws-1'

test('REV-01 库优先读：库有行 → tier=db 且字段形态与 progress.wrongBook 一致', () => {
  store.upsertWrongEntry(WS, {
    sig: 's1', module: '判断推理', stem: '题干1', options: { A: '1' }, correctAnswer: 'B',
    wrongCount: 2, box: 1, consecutive: 0, mastered: false, lastAt: 1000,
    canonicalId: 'q:1', kadian: '图形推理 / 位置规律', lastResult: 'wrong', lapses: 2,
  })
  const read = store.readWrongBook(WS, [{ sig: 'json-only', module: 'x', stem: 'y' }])
  expect(read.tier).toBe('db')
  expect(read.dbRows).toBe(1)
  const w = read.list[0]
  expect(w.sig).toBe('s1')
  expect(w.options).toEqual({ A: '1' })       // JSON 字符串 → 对象（消费方零改动）
  expect(w.correctAnswer).toBe('B')
  expect(w.canonicalId).toBe('q:1')           // v9 增强字段
  expect(w.kadian).toBe('图形推理 / 位置规律')
  expect(w.lapses).toBe(2)
})

test('REV-02 库空 → JSON 降级（老数据不丢），tier=json 可观测', () => {
  const read = store.readWrongBook('never-mirrored-ws', [{ sig: 'old', module: 'm', stem: 's', lastAt: 5 }])
  expect(read.tier).toBe('json')
  expect(read.dbRows).toBe(0)
  expect(read.list[0].sig).toBe('old')
})

test('REV-03 库空且无 JSON → tier=none 空列表（不臆造数据）', () => {
  const read = store.readWrongBook('empty-ws', [])
  expect(read.list).toEqual([])
  expect(read.tier).toBe('db')     // 库可用且该 ws 无行 → db（不是 json/none 的歧义）
})

test('REV-04 单条 upsert 幂等 + 字段保留：两次写同 sig 不产生两行，origin_batch 不被洗掉', () => {
  const ws = 'unit-ws-2'
  store.upsertWrongEntry(ws, { sig: 'a', module: 'm1', stem: 's1', lastAt: 1, fromImport: 'imp-1', historical: true })
  store.upsertWrongEntry(ws, { sig: 'a', module: 'm1', stem: 's1', lastAt: 2, wrongCount: 3 })
  const read = store.readWrongBook(ws, [])
  expect(read.list.length).toBe(1)                 // 幂等：仍是一行
  expect(read.list[0].wrongCount).toBe(3)          // 后写值生效
  expect(read.list[0].fromImport).toBe('imp-1')    // 补录标记不被无批次写入洗掉
  expect(read.list[0].historical).toBe(true)
})

test('REV-05 移除语义：移除后读不到（库侧同步删除）', () => {
  const ws = 'unit-ws-3'
  store.upsertWrongEntry(ws, { sig: 'x', module: 'm', stem: 's', lastAt: 1 })
  expect(store.readWrongBook(ws, []).list.length).toBe(1)
  expect(store.removeWrongEntry(ws, 'x')).toBe(true)
  expect(store.readWrongBook(ws, []).list.length).toBe(0)
})

test('REV-06 隔离：不同 ws 互不可见（R20 跨租户防线）', () => {
  const a = 'unit-ws-a', b = 'unit-ws-b'
  store.upsertWrongEntry(a, { sig: 'sa', module: 'm', stem: 'A 的题', lastAt: 1 })
  store.upsertWrongEntry(b, { sig: 'sb', module: 'm', stem: 'B 的题', lastAt: 1 })
  const ra = store.readWrongBook(a, []), rb = store.readWrongBook(b, [])
  expect(ra.list.map(w => w.sig)).toEqual(['sa'])
  expect(rb.list.map(w => w.sig)).toEqual(['sb'])
})

test('REV-07 诊断分桶：按模块聚合 + 掌握率（无数据不臆造 0%）', () => {
  const ws = 'unit-ws-4'
  store.upsertWrongEntry(ws, { sig: 'd1', module: '资料分析', stem: 's', kadian: '增长率', mastered: false, lastAt: 1 })
  store.upsertWrongEntry(ws, { sig: 'd2', module: '资料分析', stem: 's', kadian: '比重', mastered: true, lastAt: 2 })
  store.upsertWrongEntry(ws, { sig: 'd3', module: '数量关系', stem: 's', kadian: '排列组合', mastered: false, lastAt: 3 })
  const d = store.wrongDiagnostics(ws)
  expect(d).not.toBeNull()
  const zl = d.byModule.find(m => m.module === '资料分析')
  expect(zl.total).toBe(2)
  expect(zl.mastered).toBe(1)
  expect(zl.open).toBe(1)
  expect(zl.masteryRate).toBe(50)
  expect(d.byKadian.some(k => k.kadian === '增长率')).toBe(true)
})

test('REV-08 补录批次：写 → 读 tier=db；撤销软删后仍可查（审计痕迹）', () => {
  const ws = 'unit-ws-5'
  const batch = { batchId: 'imp-u1', at: 100, source: '书', total: 1, accepted: 1, status: 'active' }
  expect(store.writeImportBatch(ws, batch, [{ sig: 'i1', module: 'm', stem: 's', result: 'wrong' }])).toBe(true)
  let read = store.readImportBatches(ws, {})
  expect(read.tier).toBe('db')
  expect(read.list.some(b => b.batchId === 'imp-u1')).toBe(true)
  expect(store.undoImportBatch(ws, 'imp-u1')).toBe(true)
  read = store.readImportBatches(ws, {})
  const after = read.list.find(b => b.batchId === 'imp-u1')
  expect(after, '撤销后批次行应保留（审计痕迹）').toBeTruthy()
  expect(after.status).toBe('undone')
})

test('REV-09 已补录指纹：库优先；库空时用 JSON 台账（幂等判据不失效）', () => {
  const ws = 'unit-ws-6'
  store.writeImportBatch(ws, { batchId: 'imp-u2', at: 1, accepted: 1 }, [{ sig: 'sig-db', module: 'm', stem: 's', result: 'right' }])
  expect([...store.readImportedSigs(ws, {})]).toContain('sig-db')
  // 库空 → JSON 台账兜底（迁移期老数据）
  const jsonSigs = store.readImportedSigs('never-mirrored-2', { 'sig-json': 'imp-old' })
  expect([...jsonSigs]).toContain('sig-json')
})
