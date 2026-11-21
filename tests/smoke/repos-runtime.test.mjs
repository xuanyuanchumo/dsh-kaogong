/**
 * tests/smoke/repos-runtime.test.mjs — 题库管理运行时域·批二（cycle-47 阶段 13 迁移）
 *
 * 从 smoke.test.mjs SMOKE-RM 段迁移（L420-478）：
 * RM-01..11（previousRoot/diskFreeMB/health 词表/jobs/批次受控拒绝/config 校验/
 * browse 截断口径/失败清理/批处理队列/客户端消费/manifest 声明）。
 * server 运行时段走 setupDomain；判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/repos-runtime.test.mjs
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
  h = await setupDomain({ ws: 'PROJ_VTEST_RM' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('SMOKE-RM-01 /api/repos 增 previousRoot/diskFreeMB/recentJobs/health 汇总字段', async () => {
  const rs = await h.J('/api/repos')
  expect(rs && 'previousRoot' in rs && 'previousRootRepos' in rs && 'diskFreeMB' in rs && Array.isArray(rs.recentJobs) &&
    rs.summary && rs.summary.health && typeof rs.summary.health.ok === 'number').toBe(true)
})

test('SMOKE-RM-02 每仓库含 health/lastCommitAt（健康巡检字段，词表受控）', async () => {
  const rs = await h.J('/api/repos')
  const ok = rs.repos.every(r => typeof r.health === 'string' &&
    ['ok', 'empty', 'half-clone', 'no-git', 'absent'].includes(r.health) &&
    ('lastCommitAt' in r))
  expect(ok).toBe(true)
})

test('SMOKE-RM-03 /api/repos/jobs 返回 total+jobs 数组 + RM-04/04b 未知受控拒绝', async () => {
  const jobsR = await h.J('/api/repos/jobs?limit=5')
  expect(jobsR && typeof jobsR.total === 'number' && Array.isArray(jobsR.jobs)).toBe(true)
  const batchBad = await h.P('/api/repos/install-batch', { keys: ['no_such_repo'] })
  expect(!!(batchBad && batchBad.error)).toBe(true)
  const qBatch = await h.J('/api/repos/batch?id=no_such_batch')
  expect(!!(qBatch && qBatch.error)).toBe(true)
})

test('SMOKE-RM-05 config 拒绝相对路径 root 与非法 mirror（G5 校验）', async () => {
  const CFGF2 = path.join(REPO, 'data', 'repos-config.json')
  const hadCfg2 = fs.existsSync(CFGF2)
  const bak2 = hadCfg2 ? fs.readFileSync(CFGF2, 'utf-8') : null
  try {
    const badRoot = await h.P('/api/repos/config', { root: 'relative/path' })
    const badMirror = await h.P('/api/repos/config', { mirror: 'ftp://x' })
    expect(!!(badRoot && badRoot.error) && !!(badMirror && badMirror.error)).toBe(true)
  } finally {
    if (hadCfg2) fs.writeFileSync(CFGF2, bak2)
    else if (fs.existsSync(CFGF2)) fs.rmSync(CFGF2)
  }
})

test('SMOKE-RM-06 browse limit 生效且 total 为真实总数、truncated 由返回数派生', async () => {
  const rs = await h.J('/api/repos')
  const readyKey = (rs.repos.find(r => r.present && r.health === 'ok') || rs.repos.find(r => r.present) || {}).key
  if (!readyKey) return expect(true).toBe(true)
  const br = await h.J(`/api/repos/browse?key=${encodeURIComponent(readyKey)}&limit=2`)
  expect(typeof br.total === 'number' && Array.isArray(br.items)).toBe(true)
  expect(br.truncated === (br.total > br.items.length)).toBe(true)
})

test('SMOKE-RM-07..09 静态守卫：失败清理/批处理队列/config 校验链', () => {
  const rmSrc = readSrc('src/server/repoManager.ts')
  expect(rmSrc.includes('cleanupHalfClone') && rmSrc.includes('isHalfClone') && rmSrc.includes('createdDir')).toBe(true)
  expect(rmSrc.includes('startBatch') && rmSrc.includes('pumpBatch') && rmSrc.includes('onJobSettled')).toBe(true)
  expect(rmSrc.includes('previousRoot') && rmSrc.includes('diskFreeMB')).toBe(true)
})

test('SMOKE-RM-10 client 消费批次/作业/旧根/健康 + RM-11 manifest 新增端点声明', () => {
  const rvSrc = readSrc('src/client/views/repos-view.tsx')
  expect(rvSrc.includes('doInstallBatch') || rvSrc.includes('install-batch')).toBe(true)
  expect(rvSrc.includes('previousRoot') || rvSrc.includes('recentJobs') || rvSrc.includes('health')).toBe(true)
  const mf = readSrc('src/shared/manifest.ts')
  expect(['/api/repos/install-batch', '/api/repos/batch', '/api/repos/jobs'].every(p => mf.includes("path: '" + p + "'"))).toBe(true)
})
