#!/usr/bin/env node
/**
 * pre-push 检查 —— 推送前自检（BL-PROC-02 / BL-PROC-04）
 *
 * 设计克制：只做机器能判定的部分，不重复跑全量测试（CI 负责）。
 * 参考 NearSlot pre-push-check.sh 的四项检查，按本项目适配。
 *
 * 检查项：
 *   1. 分支名符合 <type>/<scope>-<desc> 或长驻分支白名单
 *   2. backlog 关联（委托 check-backlog-entry.mjs）
 *   3. 工作区干净（防"我以为提交了"）
 *   4. 未把本地调试 overlay / 凭据推上去
 *   5. 不在 main 上直接推功能提交（发布线保护）
 *
 * 逃生门：SKIP_PREPUSH_CHECK=1
 */
import { execFileSync } from 'node:child_process'

const LONG_LIVED = ['main', 'develop', 'master', 'dev-history']
/**
 * 分支名规范：`<type>/<scope>-<desc>`。
 *
 * ⚠️ cycle-68 修复：原类型表漏了 `release` 与 `hotfix`——而 CONTRIBUTING §一
 * 的 gitflow 模型明确写了 `release/*`（main 接收其合并）与 `hotfix/*`（线上急修）。
 * 结果是**按规范建的分支被钩子拒推**，逼人用逃生门绕过检查（那等于让守卫失效）。
 * 钩子与规范必须同源：规范里出现的分支类型，这里必须都认。
 */
const BRANCH_RE = /^(feat|fix|docs|refactor|perf|test|chore|ci|release|hotfix)\/[a-z0-9]+([-./][a-z0-9]+)*$/

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

if (process.env.SKIP_PREPUSH_CHECK === '1') {
  console.log('[pre-push] 已跳过（SKIP_PREPUSH_CHECK=1）——请在 PR 描述说明理由')
  process.exit(0)
}

let fail = 0
const warn = []

// ── 1. 分支名 ──────────────────────────────────────────────
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (LONG_LIVED.includes(branch)) {
  console.log(`[1/5] 分支名：${branch}（长驻分支）OK`)
} else if (BRANCH_RE.test(branch)) {
  console.log(`[1/5] 分支名：${branch} OK`)
} else {
  console.error(`[1/5] ❌ 分支名不合规：${branch}`)
  console.error('      应为 <type>/<scope>-<desc>，如 feat/pool-unified-source')
  console.error(`      或长驻分支：${LONG_LIVED.join(' / ')}`)
  fail = 1
}

// ── 2. backlog 关联 ─────────────────────────────────────────
try {
  execFileSync(process.execPath, ['scripts/git-hooks/check-backlog-entry.mjs'], { stdio: 'pipe' })
  console.log('[2/5] backlog 关联 OK')
} catch {
  console.error('[2/5] ❌ 未关联 backlog 编号（详见 scripts/git-hooks/check-backlog-entry.mjs）')
  fail = 1
}

// ── 3. 工作区干净 ───────────────────────────────────────────
const dirty = git(['status', '--porcelain=v1'])
if (!dirty) {
  console.log('[3/5] 工作区干净')
} else {
  const n = dirty.split('\n').length
  warn.push(`工作区有 ${n} 项未提交改动（未阻断——推送已提交内容时属正常，但请确认不是漏提交）`)
  console.log(`[3/5] ⚠️  工作区有 ${n} 项未提交改动`)
}

// ── 4. 不推本地调试 overlay / 凭据 ───────────────────────────
const tracked = git(['ls-files'])
const FORBIDDEN = [
  'cordis.local.yml',      // 含本机绝对路径，入包/入库会污染他人环境
  '.env',
  'data/progress.json',    // 运行时产物
  'data/runtime.json',
  'data/lifecycle.jsonl',
]
const leaked = FORBIDDEN.filter(f => tracked.split('\n').includes(f))
if (leaked.length) {
  console.error(`[4/5] ❌ 以下本机/运行时文件被 git 跟踪，禁止推送：${leaked.join(', ')}`)
  console.error('     修法：git rm --cached <file> 并确认 .gitignore 覆盖')
  fail = 1
} else {
  console.log('[4/5] 无本地调试 overlay / 运行时产物被跟踪')
}

// ── 5. main 直推保护 ────────────────────────────────────────
if (branch === 'main') {
  // 允许 release 合并与纯文档提交；功能提交应走 develop
  const last = git(['log', '-1', '--pretty=%s'])
  const isRelease = /^(release|Merge|Revert)/.test(last) || /\bv\d+\.\d+\.\d+\b/.test(last)
  if (isRelease) {
    console.log(`[5/5] main 上为发布/合并提交 OK：${last}`)
  } else {
    warn.push(`正在向 main 推送非发布提交（"${last}"）——按 gitflow 功能应从 develop 走 release PR`)
    console.log('[5/5] ⚠️  main 直推非发布提交')
  }
} else {
  console.log(`[5/5] 非 main 分支（${branch}），无直推顾虑`)
}

if (warn.length) {
  console.log('')
  for (const w of warn) console.warn(`⚠️  ${w}`)
}

if (fail) {
  console.error('')
  console.error('自检未通过。修复后重试；确需跳过：SKIP_PREPUSH_CHECK=1 git push')
  process.exit(1)
}

console.log('')
console.log('✅ 自检通过。可推送并按 .github/PULL_REQUEST_TEMPLATE.md 开 PR。')
