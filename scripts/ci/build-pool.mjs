#!/usr/bin/env node
/**
 * scripts/ci/build-pool.mjs — CI 一次性建池（cycle-62 CI 修复）
 *
 * ── 为什么需要 ──
 * 有一批 smoke 断言**天然依赖真实题库数据**（统一池里的五维标注 / 关系边 / 带图题 /
 * 真题卷索引）。这些数据由用户「📦 题库管理」按需克隆——CI runner 上恒不存在 →
 * 断言必然红（CI 自 2026-11-21 起持续红，25 个文件 / 54 个断言）。
 *
 * 三种修法：
 *   A. 给每个断言加「环境降级」守卫 → **12 个测试文件被污染**，每处都要人工判断
 *      「这条断言需不需要数据」，漏一处 CI 就红，且本地覆盖被悄悄削弱；
 *   B. 断言改写为「有数据才断言」→ 覆盖降级（等于 A 的变体）；
 *   C. **CI 侧把数据装上** → 测试代码零改动，断言即真值。
 * 本脚本走 C：**CI 装全量题库 + 先建池**，测试代码保持原样。
 *
 * 为什么在 CI 里建池而不是让各测试自己建：
 *   · 各测试文件起独立 server、各自触发重建 → N 次重建、互相抢锁、口径不一致；
 *   · 一次性建好池 → 所有测试看到**同一份完整数据**，断言可比。
 *
 * 用法：node scripts/ci/build-pool.mjs [--data-dir <dir>] [--repo-root <dir>]
 * 退出码：0 = 池就绪（含「已有池且非空」）；1 = 失败（CI 必须红）。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}

// 数据根与题库根：默认走生产解析（dataRoot.ts 四级解析），可用参数覆盖
const repoRoot = resolve(argOf('--repo-root', process.cwd()))
const dataDir = resolve(argOf('--data-dir', process.env.KG_DATA_DIR || ''))

async function main() {
  if (!dataDir) {
    console.error('[ci-pool] 必须指定 --data-dir（或设 KG_DATA_DIR）')
    process.exit(1)
  }
  console.log(`[ci-pool] 题库根 repoRoot = ${repoRoot}`)
  console.log(`[ci-pool] 数据根 dataDir  = ${dataDir}`)

  // 已有非空池 → 直接复用（CI 缓存命中时省一次全量摄入）
  const poolPath = resolve(dataDir, '.kaogong.db')
  if (existsSync(poolPath)) {
    try {
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(poolPath, { readOnly: true })
      const q = Number(db.prepare('SELECT COUNT(*) c FROM question').get().c)
      const rel = Number(db.prepare('SELECT COUNT(*) c FROM relation').get().c)
      db.close()
      if (q > 0) {
        console.log(`[ci-pool] 已有池且非空（题 ${q} · 关系 ${rel}）→ 复用（缓存命中）`)
        console.log(`[ci-pool] ✅ 池就绪`)
        return
      }
      console.log('[ci-pool] 已有池但为空 → 重建')
    } catch (e) {
      console.log('[ci-pool] 已有池无法读取（' + String(e && e.message) + '）→ 重建')
    }
  }

  const { rebuildPool } = await import('../../dist/adapters/poolIngest.js')
  const t0 = Date.now()
  const r = await rebuildPool(repoRoot, dataDir, { rebuild: true })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  if (!r || r.ok !== true) {
    console.error('[ci-pool] ❌ 建池失败：' + String((r && r.error) || '未知错误'))
    process.exit(1)
  }
  const st = r.stats || {}
  console.log(`[ci-pool] ✅ 建池完成（${secs}s）`)
  console.log(`[ci-pool]    题 ${st.questions} · 关系 ${st.relations} · 出处 ${st.questionSources}` +
    ` · 五维 ${st.withKadian} · 带图 ${st.withImage}`)
  const failures = (r.failures || []).filter(f => f && f.kind === 'exception')
  if (failures.length) {
    console.error('[ci-pool] ❌ 有源异常（exception）：' + failures.map(f => f.source).join(', '))
    process.exit(1)
  }
  if (!st.questions) {
    console.error('[ci-pool] ❌ 池为空（题库未装或摄入未生效）')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('[ci-pool] ❌ 异常：' + String((e && e.stack) || e))
  process.exit(1)
})
