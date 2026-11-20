#!/usr/bin/env node
/**
 * gen-facts.mjs —— 从**构建产物**派生文档事实源 docs/facts.json（BL-DOC-01 / BL-TEST-02）
 *
 * 设计原则（本项目教训 R22/R25 的机器化）：
 *   **数字必须从事实源派生，禁止手写。** 手写数字必然随架构变更漂移。
 *
 * 为什么读 dist 而不是读源码文本：
 *   本脚本最初用正则静态解析 src/shared/manifest.ts，实测得到「79 端点 / 10 仓库」，
 *   而运行时真实值是「78 端点 / 16 仓库」——静态解析会因嵌套结构、展开运算符、
 *   条件构造而错判。**声明 vs 运行态必须同源可核**（v1.8 遥测假阳性同一条纪律），
 *   因此唯一正确做法是从构建产物 `dist/shared/manifest.js` import 真实值。
 *
 * 前置：必须先 `npm run build`（dist 存在）。
 *
 * 派生来源：
 *   - CAPABILITIES.{endpoints,tools,views} 长度 → 运行时真实计数
 *   - REPOS_META 的 key 数 → 数据源仓库数
 *   - smoke.test.mjs / render.test.mjs 的静态断言调用点数（check/ok）
 *   - package.json 的 version
 *
 * 用法：
 *   node scripts/docs/gen-facts.mjs          # 生成/更新 docs/facts.json
 *   node scripts/docs/gen-facts.mjs --check  # 只对比不写（CI 用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'docs', 'facts.json')
const CHECK_ONLY = process.argv.includes('--check')

function read(rel) {
  const p = path.join(ROOT, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null
}

function countMatches(text, re) {
  if (!text) return null
  const m = text.match(re)
  return m ? m.length : 0
}

// ── 1. 版本 ────────────────────────────────────────────────
let version = null
try {
  version = JSON.parse(read('package.json')).version
} catch { /* 忽略 */ }

// ── 2. 能力计数（从构建产物 import，运行时真实值）──────────────
const manifestPath = path.join(ROOT, 'dist', 'shared', 'manifest.js')
if (!fs.existsSync(manifestPath)) {
  console.error('[gen-facts] ❌ 缺少构建产物 dist/shared/manifest.js')
  console.error('  先运行：npm run build')
  process.exit(1)
}

let CAPABILITIES, REPOS_META
try {
  const mod = await import(pathToFileURL(manifestPath).href)
  CAPABILITIES = mod.CAPABILITIES
  REPOS_META = mod.REPOS_META
} catch (e) {
  console.error('[gen-facts] ❌ 加载 dist/shared/manifest.js 失败：', e.message)
  process.exit(1)
}

if (!CAPABILITIES) {
  console.error('[gen-facts] ❌ 产物中未导出 CAPABILITIES')
  process.exit(1)
}

const endpoints = Array.isArray(CAPABILITIES.endpoints) ? CAPABILITIES.endpoints.length : null
const tools = Array.isArray(CAPABILITIES.tools) ? CAPABILITIES.tools.length : null
const views = Array.isArray(CAPABILITIES.views) ? CAPABILITIES.views.length : null
const repos = REPOS_META ? Object.keys(REPOS_META).length : null

// ── 3. 断言数 ─────────────────────────────────────────────
// 两种口径必须区分（本项目实测教训）：
//   · 静态调用点数：源码里 check(/ok( 出现了多少次 —— 含数据依赖的条件分支
//   · 运行态通过数：实际跑了多少条（README 徽章与文档声明应使用**这个**）
// 文档里公开的数字必须是**运行态通过数**，否则读者对不上测试输出。
// 静态数只作为「基线只增不减」的上界参考。
const smokeSrc = read('smoke.test.mjs')
const renderSrc = read('render.test.mjs')
const loaderSrc = read('loader.test.mjs')

const smokeStatic = countMatches(smokeSrc, /^\s*check\(/gm)
const renderStatic = countMatches(renderSrc, /^\s*ok\(/gm)
// loader.test.mjs 的断言函数名是 ok(）
const loaderStatic = countMatches(loaderSrc, /^\s*ok\(/gm)

// 运行态基线从 docs/facts.run.json 读取（由 scripts/docs/sync-run-facts.mjs 从测试输出解析）
let smokeRun = null
let renderRun = null
let loaderRun = null
const RUN_PATH = path.join(ROOT, 'docs', 'facts.run.json')
if (fs.existsSync(RUN_PATH)) {
  try {
    const run = JSON.parse(fs.readFileSync(RUN_PATH, 'utf-8'))
    smokeRun = run.smoke ?? null
    renderRun = run.render ?? null
    loaderRun = run.loader ?? null
  } catch { /* 忽略 */ }
}

// ── 4. 组装 ────────────────────────────────────────────────
const facts = {
  _comment: '文档事实源（自动生成，勿手改）。生成：node scripts/docs/gen-facts.mjs',
  _source: 'dist/shared/manifest.js（运行时真实值）+ docs/facts.run.json（测试运行态通过数）',
  _generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  version,
  capabilities: { endpoints, tools, views, repos },
  assertions: {
    // 文档对外声明用「运行态通过数」——读者要对得上测试输出
    smoke: smokeRun ?? smokeStatic,
    render: renderRun ?? renderStatic,
    loader: loaderRun ?? loaderStatic,
    _static: { smoke: smokeStatic, render: renderStatic, loader: loaderStatic },
    _note: 'smoke/render/loader 为运行态通过数（取自 facts.run.json）；_static 为源码静态调用点数（含条件分支）。',
  },
}

const json = JSON.stringify(facts, null, 2) + '\n'

if (CHECK_ONLY) {
  if (!fs.existsSync(OUT)) {
    console.error('[gen-facts] ❌ 缺少 docs/facts.json，请先运行 gen-facts.mjs（无 --check）')
    process.exit(1)
  }
  const old = JSON.parse(fs.readFileSync(OUT, 'utf-8'))
  const flat = (o, p = '') => {
    const out = {}
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_')) continue
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flat(v, p + k + '.'))
      else out[p + k] = v
    }
    return out
  }
  const a = flat(old), b = flat(facts)
  const diff = []
  for (const k of Object.keys(b)) {
    if (k.endsWith('._note')) continue
    if (a[k] !== b[k]) diff.push(`${k}: ${a[k]} → ${b[k]}`)
  }
  if (diff.length) {
    console.error('[gen-facts] ❌ 事实源已过期：')
    for (const d of diff) console.error(`  · ${d}`)
    console.error('\n  重新生成：node scripts/docs/gen-facts.mjs')
    process.exit(1)
  }
  console.log('[gen-facts] ✅ 事实源与源码一致')
  process.exit(0)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, json, 'utf-8')

console.log('[gen-facts] ✅ 已生成 docs/facts.json（来源：运行时产物）')
console.log(`   version     : ${facts.version}`)
console.log(`   endpoints   : ${facts.capabilities.endpoints}`)
console.log(`   tools       : ${facts.capabilities.tools}`)
console.log(`   views       : ${facts.capabilities.views}`)
console.log(`   repos       : ${facts.capabilities.repos}`)
console.log(`   smoke 断言  : ${facts.assertions.smoke}`)
console.log(`   render 断言 : ${facts.assertions.render}`)
