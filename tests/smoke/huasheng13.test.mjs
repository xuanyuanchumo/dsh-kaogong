/**
 * tests/smoke/huasheng13.test.mjs — 方法论域静态守卫（cycle-47 阶段 4 迁移）
 *
 * 从 smoke.test.mjs 迁移的段：
 *   · HS13-02 端点口径静态判据（manifest 恰 6 条 /api/huasheng13/* + 无 /kaogong 前缀）
 *   · HS13-10 语料位于数据根（非包内）+ 包内不携带语料 + META↔磁盘双向零漂移 +
 *     练习目录归属 + 端点口径源码级守卫
 *
 * 特征：零 server 依赖（文件系统/源码扫描；META↔磁盘对账走数据根实文件）。
 * 运行时断言（catalog/trace/六端点可达）留在旧文件待 server 域迁移。
 * 判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/huasheng13.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')

/** 语料根解析（与 poolSourceKnowledge/huasheng13 摄入同口径：repoRoot/huasheng13——
 *  语料与题库仓库同级在数据根下；KG_REPOS_DIR 感知。开发态 repoRoot = 插件根的上级，
 *  与 CLAUDE.md「REPO_ROOT=上级目录」的四级解析一致） */
function corpusRoot() {
  if (process.env.KG_REPOS_DIR) return path.join(process.env.KG_REPOS_DIR, 'huasheng13')
  // 开发态：REPO_ROOT 的上级是数据根（kaogong/），语料在数据根/huasheng13
  return path.resolve(fileURLToPath(new URL('../..', import.meta.url)), '..', 'huasheng13')
}

const mfSrc = readSrc('src/shared/manifest.ts')

test('HS13-02 CAPABILITIES 恰声明 6 个 /api/huasheng13/* 端点（无缺无多）', () => {
  // manifest 源码级判据（与旧文件 L538 等价：端点口径从事实源派生）
  const epDecls = [...mfSrc.matchAll(/path: '(\/api\/huasheng13\/[^']+)'/g)].map(m => m[1])
  expect(epDecls.length).toBe(6)
})

test('HS13-02 端点路径为相对挂载点的逻辑路径（无 /kaogong 前缀）', () => {
  const epDecls = [...mfSrc.matchAll(/path: '(\/api\/huasheng13\/[^']+)'/g)].map(m => m[1])
  expect(epDecls.every(p => !p.startsWith('/kaogong'))).toBe(true)
})

test('HS13-02 端点口径源码级守卫（manifest 声明齐备——与旧 L889 等价）', () => {
  expect(mfSrc.includes("/api/huasheng13/catalog")).toBe(true)
  expect(mfSrc.includes("/api/huasheng13/doc")).toBe(true)
  expect(mfSrc.includes("/api/huasheng13/search")).toBe(true)
  expect(mfSrc.includes("/api/huasheng13/coverage")).toBe(true)
  expect(mfSrc.includes("/api/huasheng13/practice")).toBe(true)
  expect(mfSrc.includes("/api/huasheng13/trace")).toBe(true)
})

test('HS13-10 语料位于数据根（非包内）：root/huasheng13 存在', () => {
  const dir = corpusRoot()
  expect(fs.existsSync(dir), '数据根语料目录 ' + dir).toBe(true)
})

test('HS13-10 包内不得再携带方法论语料（统一走题库管理——㉔ 纪律）', () => {
  const REPO = fileURLToPath(new URL('../..', import.meta.url))
  const assetsDir = path.join(REPO, 'assets')
  if (!fs.existsSync(assetsDir)) return expect(true).toBe(true)
  const leaked = []
  for (const name of fs.readdirSync(assetsDir)) {
    if (/huasheng13/i.test(name)) leaked.push(name)
  }
  expect(leaked, '包内语料残留').toEqual([])
})

test('HS13-10 META 声明的 25 篇逐条可解析到实体文件（零断链）', async () => {
  const { HUASHENG13_META } = await import('../../dist/shared/manifest.js')
  const root = corpusRoot()
  const declared = []
  for (const m of (HUASHENG13_META.modules || [])) {
    for (const d of (m.docs || [])) declared.push(['references', d.file])
    for (const e of (m.examples || [])) declared.push(['examples', e.file])
  }
  for (const st of (HUASHENG13_META.strategy || [])) declared.push(['references', st.file])
  for (const e of (HUASHENG13_META.examples || [])) declared.push(['references', e.file])
  const missing = declared.filter(x => !fs.existsSync(path.join(root, x[0], x[1] + '.md')))
  expect(declared.length).toBe(25)
  expect(missing, 'META 声明但磁盘缺失').toEqual([])
})

test('HS13-10 磁盘 .md 全部被 META 声明（无孤立死语料）', async () => {
  const { HUASHENG13_META } = await import('../../dist/shared/manifest.js')
  const root = corpusRoot()
  const declared = []
  for (const m of (HUASHENG13_META.modules || [])) {
    for (const d of (m.docs || [])) declared.push(['references', d.file])
    for (const e of (m.examples || [])) declared.push(['examples', e.file])
  }
  for (const st of (HUASHENG13_META.strategy || [])) declared.push(['references', st.file])
  for (const e of (HUASHENG13_META.examples || [])) declared.push(['references', e.file])
  const declaredKey = new Set(declared.map(x => x[0] + '/' + x[1]))
  const onDisk = []
  for (const dir of ['references', 'examples']) {
    const p = path.join(root, dir)
    if (!fs.existsSync(p)) continue
    for (const f of fs.readdirSync(p)) if (/\.md$/.test(f)) onDisk.push([dir, f.replace(/\.md$/, '')])
  }
  const orphans = onDisk.filter(x => !declaredKey.has(x[0] + '/' + x[1]))
  expect(onDisk.length).toBe(25)
  expect(orphans, '孤立死语料').toEqual([])
})
