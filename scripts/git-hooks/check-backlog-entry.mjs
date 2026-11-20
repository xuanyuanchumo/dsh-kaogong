#!/usr/bin/env node
/**
 * check-backlog-entry.mjs —— backlog 关联校验（BL-PROC-01 / BL-PROC-02）
 *
 * 为什么需要：
 *   本项目原 .cycles/tech-debt/backlog.md 已随 305c13c 取消跟踪，债务清单实际失联。
 *   "做了但没人知道是哪条"是流程散架的起点（NearSlot 在同一问题上栽过）。
 *
 * 通过条件（任一）：
 *   1. 分支名或最近提交信息含 BL-<域>-<序号>；
 *   2. 本次待推送变更包含 docs/agents/BACKLOG.md（说明同步更新了清单）；
 *   3. 提交信息含 Closes/Refs #N（关联 issue 亦可追溯）；
 *   4. 显式 SKIP_BACKLOG_CHECK=1。
 *
 * 逃生门是设计的一部分：没有逃生门的门禁最终会被整体绕过。
 */
import { execFileSync } from 'node:child_process'

const BL_RE = /BL-[A-Z]+-\d+/
const ISSUE_RE = /\b(Closes|Refs?|Fixes)\s+#\d+/i

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

if (process.env.SKIP_BACKLOG_CHECK === '1') {
  console.log('[backlog] 已跳过（SKIP_BACKLOG_CHECK=1）——请在 PR 描述说明理由')
  process.exit(0)
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
const lastMsg = git(['log', '-1', '--pretty=%s%n%b'])

// 待推送变更（兼容本地未提交 + 已暂存）
const changed = [
  git(['diff', '--name-only', 'HEAD']),
  git(['diff', '--cached', '--name-only']),
  // 已提交但未推送的变更（pre-push 场景）
  git(['diff', '--name-only', `origin/${branch}..HEAD`]),
].join('\n')

const target = `${branch}\n${lastMsg}`

if (BL_RE.test(target)) {
  console.log(`[backlog] ✅ 分支/提交信息已关联 ${target.match(BL_RE)[0]}`)
  process.exit(0)
}
if (ISSUE_RE.test(target)) {
  console.log(`[backlog] ✅ 提交信息已关联 issue（${target.match(ISSUE_RE)[0]}）`)
  process.exit(0)
}
if (changed.includes('docs/agents/BACKLOG.md')) {
  console.log('[backlog] ✅ 本次变更同步更新了 docs/agents/BACKLOG.md')
  process.exit(0)
}

console.error('[backlog] ❌ 未关联 backlog 编号')
console.error('')
console.error('  三选一：')
console.error('   1) 分支名或提交信息写明编号，如  feat(pool): 统一抽题池 (BL-POOL-01)')
console.error('   2) 提交信息关联 issue，如          Refs #5')
console.error('   3) 同步更新 docs/agents/BACKLOG.md（新增或改状态）')
console.error('')
console.error('  确认与待办无关时：SKIP_BACKLOG_CHECK=1 git push')
process.exit(1)
