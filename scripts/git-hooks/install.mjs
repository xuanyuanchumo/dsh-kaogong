#!/usr/bin/env node
/**
 * install-hooks.mjs —— 安装 git 钩子（BL-PROC-02）
 *
 * 为什么不用 husky：
 *   本项目品牌特征是「零 npm 运行时依赖」+ CI registry-free。
 *   husky/commitlint 会引入 npm registry 依赖，破坏该特征。
 *   改用 git 原生 core.hooksPath 指向仓库内的 scripts/git-hooks。
 *
 * 用法：
 *   node scripts/git-hooks/install.mjs          # 安装
 *   node scripts/git-hooks/install.mjs --check  # 只检查是否已安装
 *   node scripts/git-hooks/install.mjs --remove # 卸载
 *
 * 注意：core.hooksPath 是**本地仓库配置**（不入库），因此每个 clone 需跑一次。
 *       package.json 的 prepare 脚本会自动调用本脚本（npm install 后自动生效）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REL_HOOKS = path.relative(process.cwd(), HOOKS_DIR).replace(/\\/g, '/') || 'scripts/git-hooks'
const HOOKS = ['commit-msg', 'pre-commit', 'pre-push']
const CHECK_ONLY = process.argv.includes('--check')
const REMOVE = process.argv.includes('--remove')

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

function currentHooksPath() {
  try {
    return git(['config', '--local', '--get', 'core.hooksPath'])
  } catch {
    return ''
  }
}

if (REMOVE) {
  try {
    git(['config', '--local', '--unset', 'core.hooksPath'])
    console.log('[install-hooks] ✅ 已卸载（core.hooksPath 已清除）')
  } catch {
    console.log('[install-hooks] 未配置 core.hooksPath，无需卸载')
  }
  process.exit(0)
}

const cur = currentHooksPath()

if (CHECK_ONLY) {
  if (cur === REL_HOOKS) {
    console.log(`[install-hooks] ✅ 已安装（core.hooksPath = ${cur}）`)
    process.exit(0)
  }
  console.error(`[install-hooks] ❌ 未安装（core.hooksPath = ${cur || '(未设置)'}，期望 ${REL_HOOKS}）`)
  console.error('  安装：node scripts/git-hooks/install.mjs')
  process.exit(1)
}

// ── 校验钩子文件存在 ──────────────────────────────────────
const missing = HOOKS.filter(h => !fs.existsSync(path.join(HOOKS_DIR, h)))
if (missing.length) {
  console.error(`[install-hooks] ❌ 缺少钩子文件：${missing.join(', ')}`)
  process.exit(1)
}

// ── 确保 git 存在 ─────────────────────────────────────────
try {
  git(['rev-parse', '--git-dir'])
} catch {
  console.error('[install-hooks] ❌ 当前目录不是 git 仓库')
  process.exit(1)
}

// ── 设置 core.hooksPath ───────────────────────────────────
git(['config', '--local', 'core.hooksPath', REL_HOOKS])

// ── POSIX 权限（Windows 上无意义但无害）─────────────────────
if (process.platform !== 'win32') {
  for (const h of HOOKS) {
    try { fs.chmodSync(path.join(HOOKS_DIR, h), 0o755) } catch { /* 忽略 */ }
  }
}

console.log(`[install-hooks] ✅ 已安装 git 钩子：core.hooksPath = ${REL_HOOKS}`)
console.log(`   钩子：${HOOKS.join(' / ')}`)
console.log('')
console.log('   验证：')
console.log('     node scripts/git-hooks/install.mjs --check')
console.log('     git commit --allow-empty -m "bad message"    # 期望被拒绝')
console.log('')
console.log('   逃生门：SKIP_COMMIT_CHECK=1 / SKIP_DOCS_CHECK=1 / SKIP_BACKLOG_CHECK=1 / SKIP_PREPUSH_CHECK=1')
