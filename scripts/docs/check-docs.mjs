#!/usr/bin/env node
/**
 * check-docs.mjs —— 文档确定性检查（BL-DOC-02）
 *
 * 移植 NearSlot scripts/docs/check_docs.py 的六检规则（去掉其 Java 特有部分）：
 *   C1 frontmatter 必填：title / status(draft|current|legacy) / updated
 *   C2 相对链接可达（http/mailto/tel/锚点除外）
 *   C3 current 文档可从最近的目录 README.md 到达
 *   C4 legacy 必须有 superseded_by，且该路径存在
 *   C5 禁用 archive/ 目录（历史靠 Git，不建 archive）
 *   C6 正文不得残留 TODO/FIXME 占位而无 BL 编号（防止空谈型文档）
 *
 * 用法：node scripts/docs/check-docs.mjs [--root <dir>]
 * 退出码：0 通过；1 失败
 *
 * 逃生门：SKIP_DOCS_CHECK=1（由 pre-commit 统一处理）
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const rootArgIdx = args.indexOf('--root')
const DOCS_ROOT = rootArgIdx >= 0 ? path.resolve(ROOT, args[rootArgIdx + 1]) : path.join(ROOT, 'docs')

const ALLOWED_STATUS = new Set(['draft', 'current', 'legacy'])
const IGNORE_LINK_PREFIX = ['http://', 'https://', 'mailto:', 'tel:', 'data:']
const LINK_RE = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g

const errors = []
const warnings = []

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/')
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      // C5：禁用 archive/
      if (entry.name === 'archive') {
        errors.push(`C5 ${rel(full)}：禁止 archive/ 目录（历史靠 Git；废弃文档标 legacy + superseded_by）`)
        continue
      }
      walk(full, out)
    } else if (entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

/** 极简 frontmatter 解析（只支持本项目用到的形态） */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null
  // 结束标记与字段解析都必须兼容 CRLF（Windows 上 frontmatter 常是 '---\r\n'）：
  // ① 用 '\n---' 定位结束位会命中 '\r\n---' 中的 '\n---'，切片把最后一行（updated）
  //    留在 block 外 → 该行字段静默丢失 → 误报「已声明 frontmatter 但缺少必填字段」；
  // ② 行尾 '\r' 会让 '^(key):\s*(.*)$' 的 '$' 匹配失败 → 同类误报。
  // 统一按 /\r?\n/ 切行，消除 '\r' 后再解析。
  const lines = text.split(/\r?\n/)
  if (lines[0] !== '---') return null
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { endIdx = i; break }
  }
  if (endIdx < 0) return null
  const data = {}
  for (const line of lines.slice(1, endIdx)) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (m) data[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return data
}

const files = walk(DOCS_ROOT)
if (!files.length) {
  console.error(`[check-docs] 未找到任何 .md（docs 根：${rel(DOCS_ROOT)}）`)
  process.exit(1)
}

// ── C1 / C4：frontmatter ──────────────────────────────────
for (const file of files) {
  const text = fs.readFileSync(file, 'utf-8')
  const fm = parseFrontmatter(text)
  const r = rel(file)

  if (!fm) {
    // 存量文档（本项目历史文档多数无 frontmatter）→ 警告而非错误，避免一次性阻断整个仓库。
    // 但**根索引 README 豁免**（索引本身不需要 frontmatter）。
    // 新建文档应带 frontmatter（见 docs/README.md 治理规则 §1）。
    if (path.basename(file) !== 'README.md') {
      warnings.push(`C1 ${r}：缺少 frontmatter（建议补 title/status/updated，见 docs/README.md §文档治理规则）`)
    }
  } else {
    // 一旦声明了 frontmatter，就必须完整——这是「声明 vs 实体」的同源纪律
    for (const key of ['title', 'status', 'updated']) {
      if (!fm[key]) errors.push(`C1 ${r}：已声明 frontmatter 但缺少必填字段 \`${key}\``)
    }
    if (fm.status && !ALLOWED_STATUS.has(fm.status)) {
      errors.push(`C1 ${r}：status=\`${fm.status}\` 非法（只允许 draft|current|legacy）`)
    }
    if (fm.status === 'legacy' && !fm.superseded_by) {
      errors.push(`C4 ${r}：status=legacy 必须声明 superseded_by`)
    }
    if (fm.superseded_by) {
      const target = path.resolve(path.dirname(file), fm.superseded_by)
      if (!fs.existsSync(target)) {
        errors.push(`C4 ${r}：superseded_by 指向不存在的路径 ${fm.superseded_by}`)
      }
    }
  }

  // C6：TODO/FIXME 必须带 BL 编号
  // 排除：代码块内、行内代码（`TODO`）、以及作为「规则名」出现的词（如文档里描述本检查器自身的规则）
  const todoRe = /^\s*(?:[-*]\s*)?(?:TODO|FIXME|TBD)\b[^\n]*/gm
  for (const m of text.match(todoRe) || []) {
    const line = m.trim()
    // 行内代码包裹的提及 & 明确描述本检查器自身规则（C6/check-docs）才算豁免。
    // 不能用「规则」二字泛放——「TODO 规则引擎待实现」是真实占位，必须告警（reviewer-code 实测）。
    if (/`(TODO|FIXME|TBD)`/.test(line)) continue
    if (/\bC[1-6]\b|check-docs|本检查器/.test(line)) continue
    if (!/BL-[A-Z]+-\d+/.test(line)) {
      warnings.push(`C6 ${r}：占位文案未关联 BL 编号 → "${line.slice(0, 60)}"`)
    }
  }
}

// ── C2：相对链接可达 ──────────────────────────────────────
for (const file of files) {
  const text = fs.readFileSync(file, 'utf-8')
  const r = rel(file)
  let m
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(text)) !== null) {
    let link = m[1].trim()
    if (link.startsWith('<') && link.endsWith('>')) link = link.slice(1, -1)
    link = decodeURIComponent(link.split('#')[0].split('?')[0]).trim()
    if (!link) continue
    if (IGNORE_LINK_PREFIX.some(p => link.startsWith(p))) continue
    const target = path.resolve(path.dirname(file), link)
    if (!fs.existsSync(target)) {
      errors.push(`C2 ${r}：相对链接不可达 → ${m[1]}`)
    }
  }
}

// ── C3：current 文档可从最近目录 README 到达 ────────────────
for (const file of files) {
  const base = path.basename(file)
  if (base === 'README.md') continue
  const text = fs.readFileSync(file, 'utf-8')
  const fm = parseFrontmatter(text)
  const isCurrent = !fm || fm.status === 'current'
  if (!isCurrent) continue

  // 向上找最近的 README.md
  let dir = path.dirname(file)
  let readme = null
  while (dir.startsWith(DOCS_ROOT)) {
    const cand = path.join(dir, 'README.md')
    if (fs.existsSync(cand) && cand !== file) { readme = cand; break }
    if (dir === DOCS_ROOT) break
    dir = path.dirname(dir)
  }
  if (!readme) {
    // docs 根无 README —— 仅警告一次（由下面的汇总处理）
    warnings.push(`C3 ${rel(file)}：无可达的目录 README（建议在 docs/ 建 README.md 索引）`)
    continue
  }
  const readmeText = fs.readFileSync(readme, 'utf-8')
  const name = path.basename(file)
  if (!readmeText.includes(name)) {
    warnings.push(`C3 ${rel(file)}：未被 ${rel(readme)} 链接（current 文档应从索引可达）`)
  }
}

// ── 输出 ──────────────────────────────────────────────────
const uniqWarn = [...new Set(warnings)]
if (uniqWarn.length) {
  console.log(`\n[check-docs] ⚠️  ${uniqWarn.length} 条警告（不阻断）：`)
  for (const w of uniqWarn.slice(0, 20)) console.log(`  · ${w}`)
  if (uniqWarn.length > 20) console.log(`  · …… 其余 ${uniqWarn.length - 20} 条省略`)
}

if (errors.length) {
  console.error(`\n[check-docs] ❌ ${errors.length} 条错误：`)
  for (const e of errors) console.error(`  · ${e}`)
  console.error('')
  process.exit(1)
}

console.log(`\n[check-docs] ✅ 通过（${files.length} 篇文档，C1–C6 六检）`)
