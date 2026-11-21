#!/usr/bin/env node
/**
 * gen-facts.mjs —— 从**构建产物**派生文档事实源 docs/facts.json（BL-DOC-01）
 *
 * 设计原则：facts.json 只放**可从代码机器派生、可复核**的事实：
 *   - version：package.json
 *   - capabilities.{endpoints,tools,views,repos}：dist/shared/manifest.js 的运行时真值
 *
 * ★ 2026-11-20 反模式清理（用户决策）：
 *   旧版本曾把「测试断言数」也塞进 facts.json，并用 facts.run.json / facts.baseline.json
 *   做「断言数只增不减」门禁——那是**自我声明式假门禁**：CI 比对的是提交进仓库的数字，
 *   不是测试真实跑出的数；删断言且不改数字照样绿，改数字也照样绿。
 *   断言数已从 facts 中移除。测试质量只由 `npm run test:all` 的退出码保证。
 *
 * 为什么读 dist 而不是解析源码文本：
 *   静态解析曾得到「79 端点 / 10 仓库」，运行时真值是「78 / 16」——嵌套结构、展开、
 *   条件构造会让正则错判。「声明 vs 运行态必须同源可核」，唯一正确来源是构建产物。
 *
 * 前置：必须先 `npm run build`。
 * 用法：node scripts/docs/gen-facts.mjs [--check]
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

// ── 1. 版本 ────────────────────────────────────────────────
let version = null
try {
  version = JSON.parse(read('package.json')).version
} catch { /* 忽略 */ }

// ── 2. 能力计数（从构建产物 import 运行时真值）──────────────
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

const facts = {
  _comment: '文档事实源（自动生成，勿手改）。生成：node scripts/docs/gen-facts.mjs',
  _source: 'dist/shared/manifest.js（运行时真值）+ package.json',
  _generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  version,
  capabilities: {
    endpoints: Array.isArray(CAPABILITIES.endpoints) ? CAPABILITIES.endpoints.length : null,
    tools: Array.isArray(CAPABILITIES.tools) ? CAPABILITIES.tools.length : null,
    views: Array.isArray(CAPABILITIES.views) ? CAPABILITIES.views.length : null,
    repos: REPOS_META ? Object.keys(REPOS_META).length : null,
  },
  _note: '测试质量不由本文件保证——唯一质量门是 npm run test:all 的退出码。',
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

console.log('[gen-facts] ✅ 已生成 docs/facts.json（仅机器可派生事实）')
console.log(`   version     : ${facts.version}`)
console.log(`   endpoints   : ${facts.capabilities.endpoints}`)
console.log(`   tools       : ${facts.capabilities.tools}`)
console.log(`   views       : ${facts.capabilities.views}`)
console.log(`   repos       : ${facts.capabilities.repos}`)
