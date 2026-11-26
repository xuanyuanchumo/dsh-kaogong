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

// ── cycle-55 数据完整性：content_fp 参数顺序 + 家族富字段回填 ──
test('SMOKE-KGDB-10 updated_at/content_fp 参数顺序正确（xingcezhenti 时间戳错位根治）', () => {
  // QUESTION_COLS 末两列是 updated_at, content_fp——两处直接 insQ.run 必须时间戳在前、cfp 在后
  expect(implSrc.includes('Number(q.number || 0), 0, new Date().toISOString(), cfp,'), 'xingcezhenti 末两列错位（时间戳写进 content_fp）').toBe(true)
  expect(implSrc.includes('Number(r.n_paper || 0), new Date().toISOString(), cfOwn,'), 'naoku 末两列错位').toBe(true)
  // 负向：旧错位形态不得回归
  expect(implSrc.includes(', cfp, new Date().toISOString()'), 'cfp/时间戳错位回归').toBe(false)
})

test('SMOKE-KGDB-11 content_fp 家族富字段回填接入 rebuild 且幂等计数', () => {
  const upsert = readSrc('src/adapters/poolUpsert.ts')
  expect(upsert.includes('export function backfillContentFpFamilies'), '家族回填 helper 缺失').toBe(true)
  // 幂等计数：只在确有空位时才 UPDATE（否则 changes 数不幂等）
  expect(upsert.includes('if (!need) continue'), '幂等计数守卫缺失').toBe(true)
  // 接入 rebuild 且在 FTS 重建之前（回填改 kadian → FTS 需基于最终文本）
  expect(pingSrc.includes('backfillContentFpFamilies(db)')).toBe(true)
  const callAt = pingSrc.indexOf('backfillContentFpFamilies(db)')
  const ftsAt = pingSrc.indexOf('rebuildFts(db)')
  expect(callAt > 0 && ftsAt > callAt, '回填须在 FTS 重建之前').toBe(true)
})

// ── cycle-57 cf 过度合并根治：图推 img 区分因子 ──
test('SMOKE-KGDB-12 contentFingerprint 保留 img 区分因子（不同图不误并、同图跨源仍合）', () => {
  const pdb = readSrc('src/adapters/poolDb.ts')
  expect(pdb.includes('const imgRefs'), 'img 区分因子提取缺失').toBe(true)
  expect(pdb.includes("<img\\b[^>]*\\bsrc"), 'img src 正则缺失').toBe(true)
  expect(pdb.includes("'|img:' + imgRefs(stem)"), 'img 因子未附入指纹').toBe(true)
  // 去扩展名（规避 DB .webp / 磁盘 .png 差异破坏跨源合并）
  expect(pdb.includes("replace(/\\.[a-z0-9]+$/i, '')"), '未去扩展名').toBe(true)
  // 负向：不得退回「剥 img 整标签」的旧 norm 形态
  expect(pdb.includes('.replace(/【图:kgimg:\\/\\/[^】]*】/g'), '旧剥图占位形态复辟').toBe(false)
})

test('SMOKE-KGDB-13 cf 修复实测数字留档（1895 零丢失 + merge 981→9）', () => {
  const baseline = fs.readFileSync(new URL('../../docs/agents/ARCH-CONVERGENCE-BASELINE.md', import.meta.url), 'utf8')
  expect(baseline.includes('1895') && baseline.includes('925') && baseline.includes('merge（误并次数） | 981 | **9**'), '实测数字留档缺失').toBe(true)
  expect(baseline.includes('cf 过度合并'), '根因表述缺失').toBe(true)
})

// ── cycle-59 学习事件统计口径：NULL 判定不得拉低正确率 ──
test('SMOKE-KGDB-14 studyEventStats 正确率分母只算有判定行（NULL 口径修正）', () => {
  const pdb = readSrc('src/adapters/poolDb.ts')
  // 分母 COUNT(is_correct) 与分子 SUM(is_correct) 口径一致（旧 COUNT(*) 含 NULL 行 → 低估）
  expect(pdb.includes('COUNT(is_correct) judged, COUNT(*) c, SUM(is_correct) ok'), '判定口径未修正').toBe(true)
  expect(pdb.includes('rate: Number(r.judged) ? Math.round(Number(r.ok || 0) / Number(r.judged) * 100) : null'), '正确率分母仍用总数').toBe(true)
  // 白盒降级字段齐备 + count 兼容别名
  expect(pdb.includes('skipped: Math.max(0, Number(r.c) - Number(r.judged || 0))'), 'skipped 观测缺失').toBe(true)
  expect(pdb.includes('count: Number(r.c),   // 兼容别名'), 'count 兼容别名缺失').toBe(true)
  // 负向：旧口径不得回归
  expect(pdb.includes('rate: Number(r.c) ? Math.round(Number(r.ok || 0) / Number(r.c) * 100)'), '旧低估口径复辟').toBe(false)
})
