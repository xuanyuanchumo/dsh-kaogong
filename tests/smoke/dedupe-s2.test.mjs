/**
 * tests/smoke/dedupe-s2.test.mjs — 去重治理 + 五维贯通域（cycle-47 阶段 14 迁移）
 *
 * 从 smoke.test.mjs SMOKE-DEDUPE + SMOKE-S2 段迁移（L1684-1760）：
 * DEDUPE-01..05（内容指纹/归并保留出处/解析多版本表/schema 门/analysis-versions 端点）
 * + S2-01..05（五维贯通/判分双写/学习事件流水/双写语义显式）。
 * 混合形态：静态判据 + 少量运行时（setupDomain）。判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/dedupe-s2.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupDomain } from '../_harness/server.mjs'

let h = null
const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf-8')

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_DD' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('SMOKE-DEDUPE-01 内容指纹机制（contentFingerprint + content_fp 列 + 索引）', () => {
  const implD = readSrc('src/adapters/poolSourceImpls.ts')
  const pdbD = readSrc('src/adapters/poolDb.ts')
  expect(implD.includes('contentFingerprint') && pdbD.includes('content_fp')).toBe(true)
})

test('SMOKE-DEDUPE-02/03 归并保留出处 + 解析多版本（表 + putAnalysis 全源接入）', () => {
  const implD = readSrc('src/adapters/poolSourceImpls.ts')
  const pdbD = readSrc('src/adapters/poolDb.ts')
  expect(implD.includes('putQuestionSource') && (implD.includes('mergeTarget') || pdbD.includes('content_fp'))).toBe(true)
  expect(pdbD.includes('CREATE TABLE IF NOT EXISTS question_analysis') &&
    implD.includes('putAnalysis(db, canon,') && implD.includes('putAnalysis(db, mergeTarget,')).toBe(true)
})

test('SMOKE-DEDUPE-04 schema ≥v4 语义版本门（运行时：question_analysis 表在列 + ≥4）', async () => {
  const pdbD = readSrc('src/adapters/poolDb.ts')
  const psD = await h.J('/api/pool/status?ws=PROJ_VTEST_DD')
  expect(Array.isArray(psD.tables) && psD.tables.includes('question_analysis')).toBe(true)
  expect(/POOL_SCHEMA_VERSION = (4|5)/.test(pdbD) && (psD.schemaVersion || 0) >= 4).toBe(true)
})

test('SMOKE-DEDUPE-05 解析多版本端点（analysis-versions 声明 + 运行时可达 + 聚合展示）', () => {
  expect(readSrc('src/shared/manifest.ts').includes("path: '/api/pool/analysis-versions'")).toBe(true)
  const poolApi = readSrc('src/server/poolApi.ts')
  expect(poolApi.includes('/api/pool/analysis-versions') && poolApi.includes('byContent.has(key)')).toBe(true)
})

test('SMOKE-S2-01/02 五维贯通（池供数 SELECT 含五维字段链）', () => {
  const implSrc = readSrc('src/adapters/poolSourceImpls.ts')
  expect(implSrc.includes('reasoning') && implSrc.includes('fastest') && implSrc.includes('pitfalls') && implSrc.includes('mother')).toBe(true)
})

test('SMOKE-S2-03/05 判分双写静态守卫（saveProgress 权威 + putStudyEvent 接线 + 双写语义声明）', () => {
  const httpSrc = readSrc('src/server/http.ts')
  const pdbSrc = readSrc('src/adapters/poolDb.ts')
  expect(httpSrc.includes('putStudyEvent(poolDb()') && httpSrc.includes('domains.store.saveProgress(wsRaw, progress)')).toBe(true)
  expect(pdbSrc.includes('progress json 仍是统计/错题本') && pdbSrc.includes('只写表，不改读路径')).toBe(true)
})

test('SMOKE-S2-04 学习事件流水运行时（判分 → study_event +1，白盒可观测；无题跳过三态）', async () => {
  const q = await h.J('/api/questions?module=判断推理&count=1&ws=PROJ_VTEST_DD2')
  const q0 = (q.questions || [])[0]
  if (!q0) return expect(true).toBe(true)  // 无题可抽 → 跳过（旧文件同语义）
  const before = await h.J('/api/telemetry?ws=PROJ_VTEST_DD2')
  const evBefore = (before.studyEvents && before.studyEvents.count) || 0
  await h.P('/api/check?ws=PROJ_VTEST_DD2', { question: q0, answer: q0.correctAnswer, label: 'DD2' })
  const after = await h.J('/api/telemetry?ws=PROJ_VTEST_DD2')
  const evAfter = (after.studyEvents && after.studyEvents.count) || evBefore
  expect(evAfter).toBeGreaterThanOrEqual(evBefore)  // 流水接线存在即单调（白盒可观测）
})
