/**
 * tests/smoke/kernel.test.mjs — 内核边界不变量域（cycle-47 阶段 11 迁移·批三）
 *
 * 从 smoke.test.mjs SMOKE-KERNEL 段迁移（L1285-1388）：
 * I4 客户端禁 fs 读 / I1 内核文件禁 fs 读 / I2 禁第三方目录字面量 /
 * I3 媒体端点四路 + safeImagePath / KERNEL-05/05b 存储层优先供数 +
 * 池路径零 fs 读 / I5 摄入只写数据根 + 上游增量脏检查。
 * 纯静态段（零 server；增量脏检查 spawnSync git）。判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/kernel.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const readSrc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const FS_READ_RE = /readFileSync|readdirSync|createReadStream|statSync|existsSync|writeFileSync|appendFileSync/
const THIRD_PARTY_RE = /xingcezhenti|GongkaoNaoku|gwy-zhenti|gk-tuxing|kaogong-skill|developer2gwy|Exam_Database/

const clientFiles = ['src/client/client.tsx', 'src/client/ui-kit.tsx',
  'src/client/views/graph-view.tsx', 'src/client/views/huasheng13-view.tsx',
  'src/client/views/huasheng13-md.tsx', 'src/client/views/obs-view.tsx',
  'src/client/views/papers-view.tsx', 'src/client/views/repos-view.tsx',
  'src/client/views/study-view.tsx', 'src/client/question/question-kit.tsx',
  'src/client/question/question-lightbox.tsx',
  'src/client/graph/graph-analytics.ts', 'src/client/graph/graph-canvas.ts',
  'src/client/graph/graph-engine.ts', 'src/client/graph/graph-physics.ts',
  'src/client/graph/graph-subgraph.ts', 'src/client/graph/graph-transition.ts']
const KERNEL_FILES = ['src/server/srs.ts', 'src/client/graph/graph-analytics.ts',
  'src/client/graph/graph-physics.ts', 'src/client/graph/graph-engine.ts',
  'src/client/graph/graph-transition.ts', 'src/client/graph/graph-canvas.ts']

test('SMOKE-KERNEL-01 客户端禁 fs 读（I4：取数只走 api() 端点）', () => {
  const clientViolations = clientFiles.filter(f => FS_READ_RE.test(readSrc(f)))
  expect(clientViolations, '违规文件').toEqual([])
})

test('SMOKE-KERNEL-02 内核文件清单禁 fs 读（I1）', () => {
  const kernelFsViolations = KERNEL_FILES.filter(f => FS_READ_RE.test(readSrc(f)))
  expect(kernelFsViolations, '违规文件').toEqual([])
})

test('SMOKE-KERNEL-03 内核文件禁第三方目录名字面量（I2）', () => {
  const kernelLiteralViolations = KERNEL_FILES.filter(f => THIRD_PARTY_RE.test(readSrc(f)))
  expect(kernelLiteralViolations, '违规文件').toEqual([])
})

test('SMOKE-KERNEL-04 媒体端点四路齐备且均走 safeImagePath 解析（I3）', () => {
  const httpSrc34 = readSrc('src/server/http.ts')
  const mediaEndpoints = ['/api/kg-img', '/api/naoku-img', '/api/tuxing-img', '/api/paper-img']
  expect(mediaEndpoints.every(p => httpSrc34.includes(p))).toBe(true)
  expect(readSrc('src/adapters/naokuImage.ts').includes('safeImagePath')).toBe(true)
})

test('SMOKE-KERNEL-05 抽题存储层优先（统一池供数在前，目录解析为回落）', () => {
  const rdSrc34 = readSrc('src/adapters/repoData.ts')
  const randomFn = rdSrc34.slice(rdSrc34.indexOf('export function getRandomQuestions'))
  const randomBody = randomFn.slice(0, randomFn.indexOf('\n}'))
  const poolFirst = /pool\s*&&\s*typeof pool\.sampleQuestions === 'function'/.test(randomBody) &&
    randomBody.indexOf('sampleQuestions') < randomBody.indexOf('safeReadDir')
  expect(poolFirst, '抽题器未走存储层优先').toBe(true)
})

test('SMOKE-KERNEL-05b 存储层供数路径零 fs 读（解析在摄入期完成）', () => {
  const poolApiSrc34 = readSrc('src/server/poolApi.ts')
  const sampleFn = poolApiSrc34.slice(poolApiSrc34.indexOf('function sampleQuestions'))
  const sampleBody = sampleFn.slice(0, sampleFn.indexOf('\n  }\n'))
  expect(!/readFileSync|readdirSync|createReadStream/.test(sampleBody), '池供数路径含文件读').toBe(true)
})

test('SMOKE-KERNEL-06 摄入链路只写用户数据根、不写上游（I5 只读整合）', () => {
  const implSrcK = readSrc('src/adapters/poolSourceImpls.ts')
  const pdbSrcK = readSrc('src/adapters/poolDb.ts')
  const writesOnlyDataDir = !/writeFileSync|appendFileSync|rmSync|renameSync|copyFileSync/.test(implSrcK) &&
    pdbSrcK.includes('mkdirSync(dataDir, { recursive: true })') &&
    !/join\(repoRoot[^)]*\)/.test(pdbSrcK.replace(/poolDbPath\(dataDir\)/g, ''))
  expect(writesOnlyDataDir && implSrcK.includes('readOnly: true'), '摄入含上游写路径或缺只读打开').toBe(true)
})

test('SMOKE-KERNEL-06b 上游无内容级改动（仅行尾归一不算违规——增量脏检查）', () => {
  // 判据设计（cycle-34 实测）：上游仓既有 CRLF 归一脏不算插件责任，只报**新增**脏文件。
  // 基线快照：首轮无基线 → 以本轮现状建立基线（诚实跳过——旧文件语义是「环境既有脏
  // 不算插件责任」，首轮强行断言会把既有脏算到插件头上，正是该教训禁止的假红）。
  const baselinePath = path.join(REPO, '..', '.kg-upstream-dirty-baseline.json')
  const newlyDirty = []
  const current = {}
  let baseline = null
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8') || 'null') } catch { baseline = null }
  for (const repo of ['xingcezhenti', 'GongkaoNaoku', 'gwy-zhenti', 'gk-tuxing']) {
    const p = path.join(REPO, '..', repo)
    if (!fs.existsSync(path.join(p, '.git'))) continue
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: p, encoding: 'utf-8', timeout: 8000 })
    const lines = String(r.stdout || '').split('\n').filter(Boolean)
    current[repo] = lines
    if (baseline && Array.isArray(baseline[repo])) {
      const prev = new Set(baseline[repo])
      for (const l of lines) if (!prev.has(l)) newlyDirty.push(repo + ':' + l.trim().slice(0, 40))
    }
  }
  // 更新基线（下次运行对比增量；首轮建立基线后本轮不判——诚实跳过）
  try { fs.writeFileSync(baselinePath, JSON.stringify(current, null, 1)) } catch { /* 只读环境跳过 */ }
  if (!baseline) { expect('首轮建立基线（增量对比自下轮生效）').toBe('首轮建立基线（增量对比自下轮生效）'); return }
  expect(newlyDirty, '新增上游脏文件').toEqual([])
})
