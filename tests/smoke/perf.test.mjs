/**
 * tests/smoke/perf.test.mjs — 性能守卫静态域（cycle-47 阶段 4 迁移）
 *
 * 从 smoke.test.mjs 迁移的段：SMOKE-PERF 静态子集
 *   PERF-01（快照缓存）/ 02（srcCount 缓存）/ 02b（rowid 采样）/ 02c（单列索引）
 *   / 03（自环存在性探测）/ 05（合成 stem 降权）/ 06/06c（重建作业化 + manifest 登记）
 *
 * 特征：零 server 依赖、纯源码扫描。运行时延迟断言（PERF-04/05b/06b）留在旧文件
 * 待 server harness 域迁移时一并处理——本文件只迁静态判据。判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/perf.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')

const pdbSrcP = readSrc('src/adapters/poolDb.ts')
const poolApiSrcP = readSrc('src/server/poolApi.ts')
const obsSrcP = readSrc('src/server/poolObservability.ts')

test('SMOKE-PERF-01 统计快照缓存落地（getCachedStats + invalidateStatsCache + 双失效钩子）', () => {
  expect(pdbSrcP.includes('getCachedStats') && pdbSrcP.includes('invalidateStatsCache')).toBe(true)
  expect(poolApiSrcP.includes("getCachedStats('poolStats'")).toBe(true)
  expect(poolApiSrcP.includes("getCachedStats('poolHealth'")).toBe(true)
  expect(poolApiSrcP.includes('invalidateStatsCache(')).toBe(true)
})

test('SMOKE-PERF-02 srcCount 预聚合走缓存（多出处权重不再 87ms/请求）', () => {
  expect(poolApiSrcP.includes("getCachedStats('srcCount'")).toBe(true)
})

test('SMOKE-PERF-02b 无过滤候选随机 rowid 采样（全表 RANDOM 退化路径已替换）', () => {
  expect(poolApiSrcP.includes('WHERE id >= ? LIMIT 1') && /where\.length === 0/.test(poolApiSrcP)).toBe(true)
})

test('SMOKE-PERF-02c 关系邻域单列索引（ix_rel_src_id / ix_rel_dst_id）', () => {
  expect(pdbSrcP.includes('ix_rel_src_id ON relation(src_id)') && pdbSrcP.includes('ix_rel_dst_id ON relation(dst_id)')).toBe(true)
})

test('SMOKE-PERF-03 自环改存在性探测（LIMIT 1；写入侧 putRelation 已禁自环）', () => {
  expect(obsSrcP.includes('LIMIT 1') && /src_kind = dst_kind AND src_id = dst_id LIMIT 1/.test(obsSrcP)).toBe(true)
})

test('SMOKE-PERF-05 检索合成 stem 降权（CASE WHEN stem LIKE 置后，非过滤——低置信不丢弃）', () => {
  expect(poolApiSrcP.includes("ORDER BY CASE WHEN q.stem LIKE '【%' THEN 1 ELSE 0 END, bm25(question_fts)")).toBe(true)
})

test('SMOKE-PERF-06 重建作业化（jobId 立即返回 + status 轮询 + 归档环形 + async:false 兼容）', () => {
  expect(poolApiSrcP.includes('rebuildJobs') && poolApiSrcP.includes("rebuildJobs.set('running'")).toBe(true)
  expect(poolApiSrcP.includes('rebuildHistory') && poolApiSrcP.includes('async')).toBe(true)
})

test('SMOKE-PERF-06c 重建端点已声明（manifest + 新 status 端点登记）', () => {
  const mfSrc = readSrc('src/shared/manifest.ts')
  expect(mfSrc.includes("path: '/api/pool/rebuild/status'") && poolApiSrcP.includes('/api/pool/rebuild/status')).toBe(true)
})
