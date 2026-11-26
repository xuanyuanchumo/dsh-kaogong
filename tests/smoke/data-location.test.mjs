/**
 * tests/smoke/data-location.test.mjs — 数据外置域（cycle-47 阶段 11 迁移·批三）
 *
 * 从 smoke.test.mjs SMOKE-DX + SMOKE-ISSUE6 段迁移（L1180-1256）：
 * /api/data-location 三态 + 外置静态守卫 + isInside 边界矩阵（含 UNC）。
 * server 运行时段走 setupDomain；判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/data-location.test.mjs
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
  h = await setupDomain({ ws: 'PROJ_VTEST_DX' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('SMOKE-DX-01 /api/data-location 200 且透出 userDataRoot/source', async () => {
  const r = await fetch(`${h.base}/api/data-location?ws=PROJ_VTEST_DX`)
  const d = await r.json()
  expect(r.status).toBe(200)
  expect(typeof d.userDataRoot).toBe('string')
  expect(typeof d.source).toBe('string')
})

test('SMOKE-DX-02 userDataRoot 不在插件包内（含 kaogong 命名空间）', async () => {
  const d = await h.J('/api/data-location?ws=PROJ_VTEST_DX')
  expect(String(d.userDataRoot).includes('kaogong')).toBe(true)
  expect(String(d.userDataRoot).includes('node_modules')).toBe(false)
})

test('SMOKE-DX-03 迁移状态词表齐备（migration.status + reposRoot）', async () => {
  const d = await h.J('/api/data-location?ws=PROJ_VTEST_DX')
  expect(d.migration && ['not-needed', 'migrated', 'already-migrated', 'failed'].includes(d.migration.status)).toBe(true)
  expect(!!d.reposRoot).toBe(true)
})

test('SMOKE-DX-04 http.ts 数据目录派生自 USER_DATA_ROOT（外置）', () => {
  const httpSrc = readSrc('src/server/http.ts')
  expect(httpSrc.includes('const DATA_DIR = USER_DATA_ROOT') && httpSrc.includes('const PROGRESS_DIR = PROGRESS_DIR_USER')).toBe(true)
})

test('SMOKE-DX-05 迁移器幂等与失败保护（MIGRATED_MARK + 不删源数据 + tmp+rename）', () => {
  const drSrc = readSrc('src/server/dataRoot.ts')
  expect(drSrc.includes('.migrated') && drSrc.includes('moveEntry') && drSrc.includes('pkgResidual')).toBe(true)
})

test('SMOKE-DX-06 manifest 声明 /api/data-location 且消费者登记', () => {
  expect(readSrc('src/shared/manifest.ts').includes("path: '/api/data-location'")).toBe(true)
})

test('SMOKE-ISSUE6a isInside 源码为 relative 语义判定（非旧前缀比较）', () => {
  const drSrc = readSrc('src/server/dataRoot.ts')
  expect(/relative\(b,\s*c\)/.test(drSrc) && drSrc.includes("rel === ''")).toBe(true)
  expect(!drSrc.includes("startsWith(b + '/')") && !drSrc.includes("startsWith(b + '\\\\')")).toBe(true)
})

test('SMOKE-ISSUE6 isInside 边界矩阵（子路径/自身/穿越/裸../兄弟/跨盘/混合/大小写/UNC）', async () => {
  const { isInside } = await import('../../dist/server/dataRoot.js')
  const win = process.platform === 'win32'
  const base = win ? 'C:\\Users\\tester\\.dsh\\kaogong\\repos' : '/home/tester/.dsh/kaogong/repos'
  const S = win ? '\\' : '/'
  const cases = [
    ['子路径', base + S + 'huasheng13', true],
    ['自身', base, true],
    ['自身·末尾分隔符', base + S, true],
    ['自身·大小写不同', win ? 'c:\\users\\tester\\.dsh\\kaogong\\repos' : base, true],
    ['子路径·大小写不同', win ? 'c:\\users\\tester\\.dsh\\kaogong\\repos\\huasheng13' : base + S + 'huasheng13', true],
    ['.. 穿越', base + S + '..' + S + 'evil', false],
    ['裸 ..', base + S + '..', false],
    ['兄弟同前缀', base + 'x' + S + 'foo', false],
    ['跨盘/跨根', win ? 'D:\\other' : '/opt/other', false],
    ['混合分隔符', win ? base + '/huasheng13' : base + '\\huasheng13', win],
  ]
  const uncCases = win ? [
    ['UNC 子路径', '\\\\server\\share\\repos', '\\\\server\\share\\repos\\sub', true],
    ['UNC 兄弟 share', '\\\\server\\share\\repos', '\\\\server\\share2\\repos\\x', false],
    ['UNC 跨 server', '\\\\server\\share\\repos', '\\\\other\\share\\repos\\x', false],
  ] : []
  const failed = [
    ...cases.filter(([, cand, want]) => isInside(base, cand) !== want).map(([n]) => n),
    ...uncCases.filter(([, b2, cand, want]) => isInside(b2, cand) !== want).map(([n]) => n),
  ]
  expect(failed, 'isInside 边界用例').toEqual([])
})

test('SMOKE-SCHED-01..04 排程运行时：结构 + 确定性 + 侧重心构 + 题量守恒=30', async () => {
  const sched = await h.J('/api/plan/schedule')
  expect(Array.isArray(sched.schedule) && sched.schedule.length >= 30 && !!sched.profile).toBe(true)
  expect(JSON.stringify(sched) === JSON.stringify(await h.J('/api/plan/schedule')), '两次响应深相等').toBe(true)
  const focusValid = (sched.schedule || []).every(d => d.focus && d.focus.length && d.primary && typeof d.primaryRate === 'string')
  expect(focusValid).toBe(true)
  const sum30 = sched.schedule[0].focus.reduce((s, f) => s + f.suggested, 0)
  expect(sum30, 'sum=' + sum30).toBe(30)
})

test('SMOKE-SCHED-05..06 画像可解释 + 全 30 天守恒', async () => {
  const sched = await h.J('/api/plan/schedule')
  const allSum = (sched.schedule || []).map(d => (d.focus || []).reduce((s, f) => s + f.suggested, 0))
  expect(allSum.filter(x => x !== 30), '非 30 的天数').toEqual([])
  expect((sched.schedule || []).length).toBe(30)
})

test('DATA-LOC 随包模板迁移只复制不删源（cycle-60 R12：study-plan.md 曾被误删）', () => {
  const src = readSrc('src/server/dataRoot.ts')
  expect(/TEMPLATE_ENTRIES = new Set\(\[['"]study-plan\.md['"]\]\)/.test(src), '模板集合缺失').toBe(true)
  expect(src.includes('if (TEMPLATE_ENTRIES.has(name))'), '模板复制分支缺失').toBe(true)
  expect(src.includes('else if (TEMPLATE_ENTRIES.has(name)) { /* 模板：保留包内副本，绝不删源 */ }'), 'dst 已存在分支未豁免模板').toBe(true)
})
