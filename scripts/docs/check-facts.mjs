#!/usr/bin/env node
/**
 * check-facts.mjs —— 文档数字同源校验（BL-DOC-01 / BL-TEST-02）
 *
 * 为什么需要（已发生的真实缺陷）：
 *   同一事实（测试断言数）曾在四处不一致：
 *     README badge 437/66 · README 正文 350/59 · ROADMAP 404 · CLAUDE.md 262
 *   这是本项目 R25「陈旧文案是用户可见缺陷」教训的复发。
 *   靠写作约定无法防止，必须机器门禁。
 *
 * 机制：
 *   1. docs/facts.json 是**唯一事实源**（由 scripts/docs/gen-facts.mjs 从源码/实测派生）
 *   2. 本脚本扫描文档中的数字模式，与 facts.json 比对
 *   3. 不一致 → exit 1
 *
 * 用法：
 *   node scripts/docs/check-facts.mjs            # 校验
 *   node scripts/docs/check-facts.mjs --list     # 只列出 facts
 *
 * 逃生门：SKIP_FACTS_CHECK=1
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const FACTS_PATH = path.join(ROOT, 'docs', 'facts.json')

if (process.env.SKIP_FACTS_CHECK === '1') {
  console.log('[check-facts] 已跳过（SKIP_FACTS_CHECK=1）')
  process.exit(0)
}

if (!fs.existsSync(FACTS_PATH)) {
  console.error('[check-facts] ❌ 缺少事实源 docs/facts.json')
  console.error('  生成：node scripts/docs/gen-facts.mjs')
  process.exit(1)
}

const facts = JSON.parse(fs.readFileSync(FACTS_PATH, 'utf-8'))

if (process.argv.includes('--list')) {
  console.log('[check-facts] 事实源：')
  console.log(JSON.stringify(facts, null, 2))
  process.exit(0)
}

const errors = []
const warnings = []

/**
 * 校验规则表：每条规则描述「在哪些文件里，什么模式必须等于事实源的哪个字段」
 *
 * 关键区分（本项目血泪）：
 *   「声明型」数字 = 当前事实的断言（必须等于事实源）：
 *        smoke 437  ·  smoke 437 / render 66  ·  smoke **437**
 *   「历史型」数字 = 事故记录里的前后对比（**不得改写**）：
 *        smoke 132/144  ·  smoke 332/350  ·  smoke 262 → 376
 *
 * 区分判据：斜杠后紧跟的若是**同一指标的数值**（无 render 等标签）= 前后对比；
 *           斜杠后跟 `render` 等指标名 = 并列声明。
 * 因此负向前瞻用 `(?!\s*[/／]\s*\d)` —— 只排除「斜杠+数字」，不排除「斜杠+render」。
 */
import { DOC_FILES } from './doc-files.mjs'
// 统一提取器：匹配 <指标>[.test.mjs] <标点> <数字>，识别真实形态：
//   smoke 437 / smoke **437** / node render.test.mjs（**66 断言** / render.test.mjs # 66 断言
const ASSERT_RE = (metric) => new RegExp(
  // 关键：数字后必须紧跟「断言」——历史记录写「（321 全绿）」而非「（321 断言）」，自动豁免。
  metric + '(?:\\.test\\.mjs)?[\\s`**（(]*\\*{0,2}(\\d{2,4})\\b\\*{0,2}\\s*断言',
  'gi'
)
const COUNT_RE = (unit) => new RegExp(
  '(?:\\*\\*)?(\\d{2,3})(?:\\*\\*)?\\s*个?\\s*(?:HTTP\\s*)?' + unit, 'g'
)

const RULES = [
  { name: 'smoke 断言数（声明型）', files: DOC_FILES.smoke, pattern: ASSERT_RE('smoke'), fact: 'assertions.smoke' },
  { name: 'render 断言数（声明型）', files: DOC_FILES.render, pattern: ASSERT_RE('render'), fact: 'assertions.render' },
  { name: '端点计数（声明型）', files: DOC_FILES.endpoints, pattern: COUNT_RE('端点'), fact: 'capabilities.endpoints' },
  { name: '工具计数（声明型）', files: DOC_FILES.tools, pattern: COUNT_RE('工具'), fact: 'capabilities.tools' },
]

function getFact(dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), facts)
}

for (const rule of RULES) {
  const expected = getFact(rule.fact)
  if (expected == null) {
    warnings.push(`事实源缺少字段 ${rule.fact}，跳过规则「${rule.name}」`)
    continue
  }
  for (const relFile of rule.files) {
    const file = path.join(ROOT, relFile)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf-8')
    rule.pattern.lastIndex = 0
    let m
    while ((m = rule.pattern.exec(text)) !== null) {
      const found = Number(m[1])
      // 允许的上下文：排除明显不是断言数的数字（如 "render 66%覆盖率"）
      if (found !== expected) {
        const line = text.slice(0, m.index).split('\n').length
        errors.push(
          `${relFile}:${line} 「${rule.name}」= ${found}，但事实源 ${rule.fact} = ${expected}\n` +
          `      上下文: …${text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\n/g, ' ')}…`
        )
      }
    }
  }
}

if (warnings.length) {
  for (const w of warnings) console.warn(`[check-facts] ⚠️  ${w}`)
}

if (errors.length) {
  console.error(`\n[check-facts] ❌ ${errors.length} 处数字与事实源不一致：\n`)
  for (const e of errors) console.error(`  · ${e}\n`)
  console.error('修法二选一：')
  console.error('  1) 若代码事实已变 → 重新生成事实源：node scripts/docs/gen-facts.mjs')
  console.error('  2) 若文档写错 → 改文档，使其与 docs/facts.json 一致')
  process.exit(1)
}

console.log(`[check-facts] ✅ 通过（${RULES.length} 条规则；事实源 docs/facts.json）`)
