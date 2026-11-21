#!/usr/bin/env node
/**
 * commit-msg 钩子 —— 提交信息格式门禁（BL-PROC-02）
 *
 * 为什么不引入 husky + commitlint：
 *   本项目品牌特征是「零 npm 运行时依赖」+ CI registry-free。
 *   引入 husky/commitlint 会带进 npm registry 依赖，破坏该特征。
 *   规则表照抄 NearSlot 的 commitlint.config.js，实现用纯 Node 零依赖。
 *
 * 规则（CONTRIBUTING.md §二）：
 *   <type>(<scope>): <subject>
 *   - type 枚举（含本项目特有的 cycle/release）
 *   - scope 建议值（不强制，未知 scope 仅警告）
 *   - subject ≤72 字符
 *   - header ≤100 字符
 *
 * 逃生门：SKIP_COMMIT_CHECK=1（必须在此次 PR 描述里写明理由）
 */
import fs from 'node:fs'

const TYPES = ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'chore', 'cycle', 'ci', 'release', 'revert']
const SCOPES = [
  'host', 'server', 'client', 'ui', 'adapters', 'shared', 'manifest',
  'pool', 'graph', 'srs', 'plan', 'papers', 'naoku', 'tuxing', 'huasheng13', 'repos',
  'smoke', 'render', 'docs', 'release', 'market', 'tools', 'sandbox', 'scripts', 'backlog', 'hooks', 'test',
]
const SUBJECT_MAX = 72
const HEADER_MAX = 100

const msgFile = process.argv[2]
if (!msgFile) {
  console.error('[commit-msg] 用法: commit-msg <commit-msg-file>')
  process.exit(1)
}

if (process.env.SKIP_COMMIT_CHECK === '1') {
  console.log('[commit-msg] 已跳过（SKIP_COMMIT_CHECK=1）——请在 PR 描述说明理由')
  process.exit(0)
}

const raw = fs.readFileSync(msgFile, 'utf-8')
// 忽略注释行与空行；取第一条非空非注释行作为 header
const lines = raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
if (!lines.length) {
  console.error('[commit-msg] ❌ 提交信息为空')
  process.exit(1)
}
const header = lines[0].trim()

const errors = []
const warnings = []

if (header.length > HEADER_MAX) {
  errors.push(`header 长度 ${header.length} > ${HEADER_MAX}`)
}

// 允许的 header 形态：
//   1. <type>(<scope>): <subject>   2. <type>: <subject>   3. Merge/Revert 原生
const CONV = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/
if (/^(Merge|Revert)\b/.test(header)) {
  // 合并/回滚提交放行（Git 自动生成）
} else {
  const m = header.match(CONV)
  if (!m) {
    errors.push('不符合 `<type>(<scope>): <subject>` 或 `<type>: <subject>`')
    errors.push(`  实际: ${header}`)
    errors.push(`  示例: fix(server): isInside 改用 path.relative 根治 Windows 安装越界`)
  } else {
    const [, type, scope, subject] = m
    if (!TYPES.includes(type)) {
      errors.push(`type \`${type}\` 不在白名单：[${TYPES.join(', ')}]`)
    }
    if (scope && !SCOPES.includes(scope)) {
      warnings.push(`scope \`${scope}\` 不在建议列表（不阻断，如确属新域请更新 CONTRIBUTING.md §二）`)
    }
    if (!subject.trim()) {
      errors.push('subject 为空')
    } else if (subject.length > SUBJECT_MAX) {
      errors.push(`subject 长度 ${subject.length} > ${SUBJECT_MAX}`)
    }
    if (/[。.]$/.test(subject)) {
      warnings.push('subject 末尾不应加句号')
    }
  }
}

for (const w of warnings) console.warn(`[commit-msg] ⚠️  ${w}`)

if (errors.length) {
  console.error('[commit-msg] ❌ 提交信息不合规：')
  for (const e of errors) console.error(`  - ${e}`)
  console.error('\n规范见 CONTRIBUTING.md §二；确需跳过：SKIP_COMMIT_CHECK=1 git commit ...')
  process.exit(1)
}

console.log('[commit-msg] ✅ 提交信息合规')
