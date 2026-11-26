/**
 * tests/smoke/paper-index.test.mjs — 纸卷索引快照门域（cycle-47 阶段 15 迁移）
 *
 * 从 smoke.test.mjs R-P-03/R-P-01 运行时段迁移（L2058-2085）：
 * 快照 v2 版本门（伪快照弃用 + 现场重建）+ 索引确定性（重建 ≡ 快照深相等）+
 * provinces facet 内容（≥35 项/含山东全国/码点升序）。
 *
 * ⚠️ 顺序纪律（教训⑤）：快照门重建同步阻塞事件循环 ~10s，超过 http keepAliveTimeout 5s
 * ——本文件把重建放在全部 fetch 断言之后（本文件无 fetch），且测前备份/finally 还原
 * data/.paper-index.json（绝不污染后续手工使用）。
 *
 * 运行：npx vitest run tests/smoke/paper-index.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const IDX = path.join(REPO, 'data', '.paper-index.json')
const BAK = path.join(REPO, 'data', '.paper-index.json.w3-bak')
// 题库根：优先 KG_REPOS_DIR（CI/高级用户）→ 开发态上级目录。
// 纪律（与 huasheng13.test.mjs 的 corpusRoot() 一致）：题库位置是**运行期事实**，
// 由数据根解析决定，不该硬编码「仓库上级目录」——CI 上真题卷在 KG_REPOS_DIR。
const REPO_ROOT = process.env.KG_REPOS_DIR
  ? path.resolve(process.env.KG_REPOS_DIR)
  : path.resolve(REPO, '..')

let idx1 = null, idx2 = null, dt1 = -1, dt2 = -1, err1 = null
const had = fs.existsSync(IDX)

test('R-P-03 快照 v2 门 + R-P-01 索引确定性（备份→伪快照→重建→还原 全链）', async () => {
  if (had) fs.copyFileSync(IDX, BAK)
  try {
    // 写入 schemaVersion=1 伪快照 → 必须弃用并现场重建
    //（新鲜模块实例经 URL query 击穿：?v1 与 ?v2 是独立模块，进程内缓存互不可见）
    fs.writeFileSync(IDX, JSON.stringify({ schemaVersion: 1, total: 1, papers: [], note: 'W3 测试伪快照' }))
    let err = null
    try {
      const m1 = await import('../../dist/adapters/paperData.js?v1')
      const t0 = Date.now()
      idx1 = m1.buildPaperIndex(REPO_ROOT)
      dt1 = Date.now() - t0
      const m2 = await import('../../dist/adapters/paperData.js?v2')
      const t1 = Date.now()
      idx2 = m2.buildPaperIndex(REPO_ROOT)
      dt2 = Date.now() - t1
    } catch (e) { err = e; err1 = e }
    // R-P-03：伪快照被弃用并触发现场重建（provinces facet 到位）
    expect(!!idx1 && Array.isArray(idx1.provinces) && idx1.provinces.length >= 35,
      err ? String(err).slice(0, 80) : `provinces=${idx1 && idx1.provinces && idx1.provinces.length} rebuild=${dt1}ms`).toBe(true)
    // R-P-03：二次构建走 v2 快照且耗时显著下降（不硬断言毫秒）
    expect(!!idx2 && dt2 < dt1, `rebuild=${dt1}ms snapshot=${dt2}ms`).toBe(true)
    // R-P-01：provinces facet 内容 + 码点升序（无 localeCompare）
    const names = (idx1.provinces || []).map(p => p.name)
    expect(names.length, String(names.length)).toBeGreaterThanOrEqual(35)
    expect(names.includes('山东') && names.includes('全国')).toBe(true)
    const ascNames = names.every((n, i) => i === 0 || names[i - 1] < n)
    expect(ascNames, names.slice(0, 6).join('/')).toBe(true)
    // R-P-01：两次构建深相等（重建结果 ≡ 快照结果，确定性）
    const sameFacet = !!idx1 && !!idx2 &&
      JSON.stringify(idx1.provinces) === JSON.stringify(idx2.provinces) &&
      JSON.stringify(idx1.papers) === JSON.stringify(idx2.papers)
    expect(sameFacet).toBe(true)
  } finally {
    // 测后还原现场（避免污染后续手工使用）
    if (had && fs.existsSync(BAK)) { fs.copyFileSync(BAK, IDX); fs.rmSync(BAK) }
    else if (!had && fs.existsSync(IDX)) fs.rmSync(IDX)
  }
})
