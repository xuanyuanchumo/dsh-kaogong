#!/usr/bin/env node
/**
 * pre-commit 钩子 —— 文档门禁（BL-DOC-02）
 *
 * 只做机器能判定的部分，不重复跑全量测试（CI 负责）。
 * 触发条件：仅当本次提交涉及 docs/ 或 README 时才跑，避免无关提交被拖慢。
 *
 * 六检（移植 NearSlot check_docs.py 的确定性规则）：
 *   C1 frontmatter 必填：title / status(draft|current|legacy) / updated
 *   C2 相对链接可达
 *   C3 current 文档可从最近目录 README 到达
 *   C4 事实源声明存在（本项目用「关联文件」字段，可选）
 *   C5 禁用 archive/ 目录（历史靠 Git）
 *   C6 legacy 必须有 superseded_by
 *
 * 逃生门：SKIP_DOCS_CHECK=1
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

if (process.env.SKIP_DOCS_CHECK === '1') {
  console.log('[pre-commit] 已跳过文档门禁（SKIP_DOCS_CHECK=1）——请在 PR 描述说明理由')
  process.exit(0)
}

// 只看暂存区
// ★ 假门禁修复：docTouched 必须与 check-facts 的 DOC_FILES 共用同一份常量，
//   否则出现「check-facts 声明校验 CLAUDE.md，pre-commit 却跳过它」的绕过（reviewer-code 实测）。
import { WATCHED_DOCS } from '../docs/doc-files.mjs'

const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
const watchedDocs = WATCHED_DOCS
// 再加门禁本身覆盖但 DOC_FILES 未列的文件（docs/ 下全部 + 根目录 changelog）
function isDoc(f) {
  return watchedDocs.has(f) || f.startsWith('docs/') || f === 'CHANGELOG.md'
}
const docTouched = staged.split('\n').filter(Boolean).some(isDoc)

if (!docTouched) {
  process.exit(0)   // 未涉及文档，直接放行
}

console.log('[pre-commit] 检测到文档变更，运行文档门禁……')

try {
  const out = execFileSync(process.execPath, ['scripts/docs/check-docs.mjs'], {
    encoding: 'utf-8',
    stdio: 'pipe',
  })
  process.stdout.write(out)
} catch (e) {
  if (e.stdout) process.stdout.write(e.stdout)
  if (e.stderr) process.stderr.write(e.stderr)
  console.error('[pre-commit] ❌ 文档门禁未通过（见上方详情）')
  console.error('  修复后重试；确需跳过：SKIP_DOCS_CHECK=1 git commit ...')
  process.exit(1)
}

// 数字同源（BL-DOC-01）：只在文档变更时校验
try {
  const out = execFileSync(process.execPath, ['scripts/docs/check-facts.mjs'], {
    encoding: 'utf-8',
    stdio: 'pipe',
  })
  process.stdout.write(out)
} catch (e) {
  if (e.stdout) process.stdout.write(e.stdout)
  if (e.stderr) process.stderr.write(e.stderr)
  console.error('[pre-commit] ❌ 文档数字与事实源不一致（见上方详情）')
  console.error('  事实源：docs/facts.json；确需跳过：SKIP_FACTS_CHECK=1 git commit ...')
  if (process.env.SKIP_FACTS_CHECK === '1') {
    console.warn('[pre-commit] ⚠️  已按 SKIP_FACTS_CHECK=1 放行数字校验')
    process.exit(0)
  }
  process.exit(1)
}

console.log('[pre-commit] ✅ 文档门禁通过')
