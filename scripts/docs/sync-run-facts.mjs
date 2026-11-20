#!/usr/bin/env node
/**
 * sync-run-facts.mjs —— 从测试实际输出采集运行态断言数（BL-TEST-02）
 *
 * 为什么需要（本项目实测教训）：
 *   静态统计 smoke.test.mjs 的 `check(` 调用点得到 454，但实际运行只通过 437 条
 *   ——因为部分断言在数据未就绪时走条件分支不执行。
 *   **文档对外声明必须用运行态通过数**，否则读者对不上测试输出。
 *
 * 做法：跑 `npm run test:all`，从输出解析 `═══ 结果: N/N 通过 ═══` 与
 *       `═══ 渲染回归: M 通过 / 0 失败 ═══`，写入 docs/facts.run.json。
 *
 * 用法：
 *   node scripts/docs/sync-run-facts.mjs            # 跑测试并采集
 *   node scripts/docs/sync-run-facts.mjs --from <file>  # 从已有输出文件解析（CI 用）
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'docs', 'facts.run.json')

const args = process.argv.slice(2)
const fromIdx = args.indexOf('--from')
let output

if (fromIdx >= 0) {
  const file = args[fromIdx + 1]
  if (!file || !fs.existsSync(file)) {
    console.error(`[sync-run-facts] ❌ 找不到输出文件：${file}`)
    process.exit(1)
  }
  output = fs.readFileSync(file, 'utf-8')
  console.log(`[sync-run-facts] 从 ${file} 解析`)
} else {
  console.log('[sync-run-facts] 运行 npm run test:all（约 1 分钟）……')
  try {
    // test:all 失败也会输出结果行，用 stdio pipe 捕获
    output = execFileSync('npm', ['run', 'test:all'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (e) {
    output = `${e.stdout || ''}\n${e.stderr || ''}`
    console.warn('[sync-run-facts] ⚠️  测试未全绿，仍解析已有输出（请先修红）')
  }
}

// ── 解析 ──────────────────────────────────────────────────
// smoke: ═══ 结果: 437/437 通过 ═══
const smokeM = output.match(/结果:\s*(\d+)\/(\d+)\s*通过/)
// render: ═══ 渲染回归: 66 通过 / 0 失败 ═══
const renderM = output.match(/渲染回归:\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/)
// loader: ═══ Loader 入口: 17/17 通过 ═══
const loaderM = output.match(/Loader 入口:\s*(\d+)\/(\d+)\s*通过/)

if (!smokeM && !renderM && !loaderM) {
  console.error('[sync-run-facts] ❌ 未能从输出解析出断言数')
  console.error('  期望形如: ═══ 结果: 437/437 通过 ═══ / ═══ 渲染回归: 66 通过 / 0 失败 ═══ / ═══ Loader 入口: 17/17 通过 ═══')
  process.exit(1)
}

const facts = {
  _comment: '运行态断言数（从测试实际输出采集）。生成：node scripts/docs/sync-run-facts.mjs',
  _generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
}

if (smokeM) {
  facts.smoke = Number(smokeM[1])
  facts.smokeTotal = Number(smokeM[2])
  if (smokeM[1] !== smokeM[2]) {
    facts.smokeFailed = Number(smokeM[2]) - Number(smokeM[1])
  }
}
if (renderM) {
  facts.render = Number(renderM[1])
  facts.renderFailed = Number(renderM[2])
}
if (loaderM) {
  facts.loader = Number(loaderM[1])
  facts.loaderTotal = Number(loaderM[2])
  if (loaderM[1] !== loaderM[2]) facts.loaderFailed = Number(loaderM[2]) - Number(loaderM[1])
}

fs.writeFileSync(OUT, JSON.stringify(facts, null, 2) + '\n', 'utf-8')

console.log('[sync-run-facts] ✅ 已写入 docs/facts.run.json')
if (facts.smoke != null) console.log(`   smoke  : ${facts.smoke}/${facts.smokeTotal ?? '?'} 通过`)
if (facts.render != null) console.log(`   render : ${facts.render} 通过 / ${facts.renderFailed} 失败`)
if (facts.loader != null) console.log(`   loader : ${facts.loader}/${facts.loaderTotal ?? '?'} 通过`)
console.log('')
console.log('   下一步：node scripts/docs/gen-facts.mjs   （把运行态数同步进 facts.json）')
