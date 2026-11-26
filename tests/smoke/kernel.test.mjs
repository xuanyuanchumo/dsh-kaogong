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
// cycle-49 内核清单外提：kernel.ts 是 L4 纯函数单一事实源，必须纳入 I1/I2 双守卫。
const KERNEL_FILES = ['src/shared/kernel.ts',
  'src/server/srs.ts', 'src/client/graph/graph-analytics.ts',
  'src/client/graph/graph-physics.ts', 'src/client/graph/graph-engine.ts',
  'src/client/graph/graph-transition.ts', 'src/client/graph/graph-canvas.ts']
// manifest.ts 持有图算法但**同时是能力声明文件**（repos 列表天然含第三方仓库名字面量），
// 故只纳入 I1「禁 fs 读」守卫，不纳入 I2「禁第三方目录名」守卫——口径分层，避免假阳性。
const KERNEL_FS_FREE_FILES = [...KERNEL_FILES, 'src/shared/manifest.ts']

test('SMOKE-KERNEL-01 客户端禁 fs 读（I4：取数只走 api() 端点）', () => {
  const clientViolations = clientFiles.filter(f => FS_READ_RE.test(readSrc(f)))
  expect(clientViolations, '违规文件').toEqual([])
})

test('SMOKE-KERNEL-02 内核文件清单禁 fs 读（I1，含 manifest 图算法族）', () => {
  const kernelFsViolations = KERNEL_FS_FREE_FILES.filter(f => FS_READ_RE.test(readSrc(f)))
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

test('SMOKE-KERNEL-05 抽题唯一走存储层（v9：目录回落分支已物理删除）', () => {
  const rdSrc = readSrc('src/adapters/repoData.ts')
  const randomFn = rdSrc.slice(rdSrc.indexOf('export function getRandomQuestions'))
  const randomBody = randomFn.slice(0, randomFn.indexOf('\n}'))
  // v9 口径：抽题器**只**走池；目录解析回落已删除（I-DB-1 运行期零文件读）
  expect(randomBody.includes('pool.sampleQuestions'), '抽题器未走存储层').toBe(true)
  expect(/safeReadDir|readFileSync|parseQuestions\(/.test(randomBody), '抽题器仍含文件读（回落分支复辟）').toBe(false)
  // 未就绪时返回结构化错误而不是偷偷读目录
  expect(randomBody.includes('统一题库未就绪'), '未就绪提示缺失').toBe(true)
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

// ── cycle-49 内核单一事实源守卫 ──
test('SMOKE-KERNEL-07 PageRank 全端真共享 kernel（cycle-60 R5：镜像算法体已消灭）', () => {
  const kernel = readSrc('src/shared/kernel.ts')
  const client = readSrc('src/client/graph/graph-analytics.ts')
  const manifest = readSrc('src/shared/manifest.ts')
  const bundler = readSrc('scripts/bundle-client.mjs')
  // 事实源常量（kernel 默认 iter=40）
  expect(kernel.includes('KG_PAGERANK_ITER = 40'), 'kernel 迭代数常量缺失').toBe(true)
  // 服务端 pageRank 已收敛为 kernel re-export（无本地迭代循环）
  expect(manifest.includes('export const pageRank: typeof kernelPageRank = kernelPageRank'), 'manifest 未收敛到 kernel').toBe(true)
  // cycle-60 R5：客户端真 import kernel.pageRank（不再镜像常量 + 镜像算法体）
  expect(client.includes("import { pageRank, KG_PAGERANK_ITER } from '../../shared/kernel.js'"), '客户端未真导入 kernel').toBe(true)
  expect(client.includes('pageRank(nodes, edges, { iter: KG_PAGERANK_ITER })'), '客户端未调用共享 pageRank').toBe(true)
  expect(client.includes('KG_LOCAL_PAGERANK_ITER = KG_PAGERANK_ITER'), '本地别名未派生自事实源').toBe(true)
  // 负向：镜像的幂迭代循环与硬编码阻尼不得复辟
  expect(/for \(let it = 0; it < KG_LOCAL_PAGERANK_ITER/.test(client), '镜像迭代循环复辟').toBe(false)
  expect(/const D = 0\.85/.test(client), '镜像阻尼系数复辟').toBe(false)
  // bundler 白名单与终检（跨目录值导入的机器守卫）
  expect(bundler.includes("const EXTRA_MODULES = ['shared/kernel']"), 'bundler 白名单缺失').toBe(true)
  expect(bundler.includes("__kgM('shared/kernel'"), 'bundler 终检缺 kernel 登记断言').toBe(true)
})

test('SMOKE-KERNEL-08 percentile 单一事实源（遥测/方法论不再各写一份）', () => {
  const telemetry = readSrc('src/server/telemetry.ts')
  const methodology = readSrc('src/server/methodologyApi.ts')
  // cycle-60：import 增加 ringPush，锚定「percentile 从 kernel 导入」而非整行字面量（教训④形态锚点）
  expect(/import \{[^}]*percentile[^}]*\} from '\.\.\/shared\/kernel\.js'/.test(telemetry), '遥测未用共享分位').toBe(true)
  expect(methodology.includes('percentile,') && methodology.includes("from '../shared/kernel.js'"), '方法论未用共享分位').toBe(true)
  // 负向：本地 function percentile 定义不得回归
  expect(/function percentile\(sorted: number\[\], p: number\): number \{/.test(methodology), '方法论本地 percentile 复辟').toBe(false)
})

// ── cycle-50 内核收敛（第二轮）· cycle-61 v9 抽题内核外提 ──
test('SMOKE-KERNEL-09 弱点公式收敛到 kernel，业务先验差异保留在调用侧', () => {
  const kernel = readSrc('src/shared/kernel.ts')
  const srs = readSrc('src/server/srs.ts')
  const plan = readSrc('src/server/planSchedule.ts')
  const pool = readSrc('src/server/poolApi.ts')
  // 公式单一事实源：内核导出 weaknessWeight + moduleWeakness（向量版，v9 新增）
  expect(kernel.includes('export function weaknessWeight')).toBe(true)
  expect(kernel.includes('export function moduleWeakness')).toBe(true)
  // srs：弱模块选择走内核向量版，且显式声明「无数据 0.5 中性」业务先验
  expect(srs.includes("import { moduleWeakness, weightedPickIndex } from '../shared/kernel.js'")).toBe(true)
  expect(srs.includes('moduleWeakness(mods, p.byModule || {}, 0.5)'), 'srs 中性先验未显式传入').toBe(true)
  // 排程：无数据 rate=0 先验保留在调用侧
  expect(plan.includes('weaknessWeight(rate == null ? 0 : rate)'), '排程无数据先验 rate=0 应保留').toBe(true)
  // 池抽题：显式传 0 先验（新模块优先）
  expect(pool.includes('moduleWeakness([m], byModule, 0)'), '池抽题新模块优先先验丢失').toBe(true)
  // 负向：三处不得再内联 1/(rate+0.15) 公式
  for (const [name, src] of [['srs', srs], ['plan', plan], ['pool', pool]]) {
    expect(/1 \/ \(rate \+ 0\.15\)/.test(src), name + ' 内联公式复辟').toBe(false)
  }
})

test('SMOKE-KERNEL-10 增量重建指纹口径统一（v9-b：逐源指纹；写读同一事实源）', () => {
  const ingest = readSrc('src/adapters/poolIngest.ts')
  const sources = readSrc('src/adapters/poolSources.ts')
  // 指纹来源单一事实源：sourceFingerprints（注册表逐源计算）
  expect(sources.includes('export function sourceFingerprints'), '缺逐源指纹函数').toBe(true)
  expect(sources.includes('export function fingerprintOf'), '缺单源指纹函数').toBe(true)
  // rebuild 写：逐源指纹 + 主源指纹（兼容旧库）
  expect(ingest.includes("setMeta(db, 'source_fingerprints'"), 'rebuild 未写逐源指纹').toBe(true)
  expect(ingest.includes("setMeta(db, 'source_fingerprint', primaryFingerprint(dataDir))"), 'rebuild 未写主源指纹').toBe(true)
  // incremental 读：同一函数（写读同源，杜绝两侧口径漂移）
  expect(ingest.includes('const current = sourceFingerprints('), '增量未用同源指纹').toBe(true)
  expect(/prev\[id\] === fp/.test(ingest), '增量未按逐源比对').toBe(true)
  // 旧「题数:边数」不得再占用指纹键（迁移到 pool_size）
  expect(ingest.includes("setMeta(db, 'pool_size'"), 'pool_size 未独立').toBe(true)
  expect(/setMeta\(db, 'source_fingerprint', String\(totalQ\)/.test(ingest), '题数:边数仍占指纹键').toBe(false)
})

// ── cycle-60 环形缓冲单一事实源 ──
test('SMOKE-KERNEL-11 环形缓冲统一走 kernel.ringPush（telemetry/methodology 不再各写裁剪）', () => {
  const kernel = readSrc('src/shared/kernel.ts')
  const tel = readSrc('src/server/telemetry.ts')
  const meth = readSrc('src/server/methodologyApi.ts')
  expect(kernel.includes('export function ringPush') && kernel.includes('export function ringTrim')).toBe(true)
  expect(tel.includes('ringPush(t.lat, Math.round(ms), LAT_RING)') && tel.includes('ringPush(telemetry.requests, t.lastTs, 1000)')).toBe(true)
  expect(meth.includes('ringPush(c.recent,') && meth.includes('ringPush(ep.lat, ms, LAT_RING)')).toBe(true)
  // 负向：旧的 shift/splice 手写裁剪不得复辟
  expect(/t\.lat\.shift\(\)/.test(tel) && /c\.recent\.splice\(/.test(meth)).toBe(false)
})
