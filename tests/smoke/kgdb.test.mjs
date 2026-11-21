/**
 * tests/smoke/kgdb.test.mjs — 存储层静态守卫域（cycle-47 阶段 3 迁移）
 *
 * 从 smoke.test.mjs 迁移的段：
 *   · SMOKE-KGDB-06c（重建幂等 UPSERT）/ 07（node:sqlite 动态 import）/ 07b（载体隔离）
 *     / 07c（事务纪律）/ 08/08b（源注册表可扩展）/ 09（复杂度预算 ≤180）
 *   · SMOKE-MAT-04/05 静态守卫（naoku 摄入材料保真 + 错题三路材料快照）
 *
 * 特征：零 server 依赖、纯源码扫描。断言判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/kgdb.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')

const implSrc = readSrc('src/adapters/poolSourceImpls.ts')
const regSrc = readSrc('src/adapters/poolSources.ts')
const pdbSrc = readSrc('src/adapters/poolDb.ts')
const pingSrc = readSrc('src/adapters/poolIngest.ts')

test('SMOKE-KGDB-06c 重建幂等：写入全走 UPSERT（canonical_id/mid/关系五元组唯一键）', () => {
  expect(implSrc.includes('ON CONFLICT(canonical_id) DO UPDATE')).toBe(true)
  expect(implSrc.includes('ON CONFLICT(mid) DO UPDATE')).toBe(true)
  expect(pdbSrc.includes('UNIQUE(rel_type, src_kind, src_id, dst_kind, dst_id)')).toBe(true)
})

test('SMOKE-KGDB-07 node:sqlite 动态 import 纪律（禁顶层 import——旧 Node 整插件加载失败）', () => {
  const sqliteModules = ['src/adapters/poolDb.ts', 'src/adapters/poolIngest.ts',
    'src/adapters/poolSources.ts', 'src/adapters/poolSourceImpls.ts']
  const topLevelSqlite = sqliteModules.filter(f => /^import\s+.*from\s+'node:sqlite'/m.test(readSrc(f)))
  // 「用到 sqlite」= 存在动态 import 调用或顶层 import 语句（字符串/注释不算）
  const usesSqlite = sqliteModules.filter(f => {
    const src = readSrc(f)
    const code = src.split('\n')
      .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .map(l => l.replace(/'[^']*'|"[^"]*"/g, "''"))
      .join('\n')
    return /node:sqlite/.test(code)
  })
  const missingDynamic = usesSqlite.filter(f => !readSrc(f).includes("await import('node:sqlite')"))
  expect(topLevelSqlite, '顶层 import 违规').toEqual([])
  expect(missingDynamic, '缺动态 import').toEqual([])
})

test('SMOKE-KGDB-07b 载体隔离：上游投影库只读打开 + 重建为原地清库', () => {
  expect(implSrc.includes('readOnly: true')).toBe(true)
  expect(pdbSrc.includes('DELETE FROM') && pdbSrc.includes('原地重建')).toBe(true)
})

test('SMOKE-KGDB-07c 事务纪律：单源一个事务（性能：无事务 421s → 事务内秒级）', () => {
  expect(pdbSrc.includes('withTx') && implSrc.includes('withTx(db')).toBe(true)
})

test('SMOKE-KGDB-08 源注册表可扩展（源清单在注册表，编排器零硬编码）', () => {
  expect(regSrc.includes('SOURCE_REGISTRY') && regSrc.includes('ingestAll')).toBe(true)
  expect(/for \(const spec of SOURCE_REGISTRY\)/.test(regSrc)).toBe(true)
  expect(/if \(.*=== 'naoku'\)|if \(.*=== 'xingcezhenti'\)/.test(pingSrc)).toBe(false)
})

test('SMOKE-KGDB-08b 源规格声明 id/tier/label/available/ingest（可扩展契约）', () => {
  expect(regSrc.includes('available(ctx') && regSrc.includes('ingest(ctx')).toBe(true)
  expect(regSrc.includes('tier:') && regSrc.includes('label:')).toBe(true)
})

test('SMOKE-MAT-04 naoku 摄入材料正文保真（主行 insQ + 归并回填均含 group_material）', () => {
  expect(implSrc.includes('matText, matNo, materialRef')).toBe(true)
  expect(implSrc.includes("group_material=CASE WHEN LENGTH(question.group_material) = 0 THEN ? ELSE question.group_material END")).toBe(true)
})

test('SMOKE-MAT-05 错题快照/回炉/补录三路材料保真', () => {
  const srsSrc43 = readSrc('src/server/srs.ts')
  const histSrc43 = readSrc('src/server/historyApi.ts')
  expect(srsSrc43.includes('groupMaterial: q.groupMaterial')).toBe(true)
  expect(srsSrc43.includes('groupMaterial: w.groupMaterial')).toBe(true)
  expect(histSrc43.includes('groupMaterial: q.groupMaterial')).toBe(true)
})

test('SMOKE-KGDB-09 复杂度预算：关键大文件分支+函数 ≤ 180（防「塞进大文件」反模式）', () => {
  const BUDGET = 180
  const approxComplexity = (rel) => {
    const src = readSrc(rel)
    const branches = (src.match(/\b(if|else if|for|while|case|catch)\b/g) || []).length
    const functions = (src.match(/\bfunction\b/g) || []).length
    return { branches, functions, score: branches + functions }
  }
  const bigFiles = ['src/server/http.ts', 'src/shared/manifest.ts', 'src/client/views/graph-view.tsx',
    'src/server/methodologyApi.ts', 'src/adapters/huasheng13.ts', 'src/server/repoManager.ts',
    'src/client/graph/graph-physics.ts', 'src/client/graph/graph-engine.ts']
  const overBudget = bigFiles.map(f => ({ f, ...approxComplexity(f) })).filter(x => x.score > BUDGET)
  expect(overBudget.map(x => `${x.f}(${x.branches}+${x.functions}=${x.score})`), '超预算文件').toEqual([])
})
