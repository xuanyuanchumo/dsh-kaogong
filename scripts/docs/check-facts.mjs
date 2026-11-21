#!/usr/bin/env node
/**
 * check-facts.mjs —— 文档事实同源校验（BL-DOC-01）
 *
 * 只校验**能从 manifest 运行时真值机器派生**的计数：
 *   - 端点数（CAPABILITIES.endpoints.length = 78）
 *   - 工具数（CAPABILITIES.tools.length = 6）
 *
 * ★ 2026-11-20 反模式清理（用户决策）：
 *   不再校验「测试断言数」。旧实现把 smoke/render/loader 通过数塞进事实源并做「只增不减」门禁，
 *   但 CI 比对的是提交进仓库的 json，不是测试真实跑出的数——删断言不改 json 照样绿，
 *   是典型的自我声明式假门禁。测试质量只由 `npm run test:all` 的退出码保证。
 *
 * 覆盖误判防护：
 *   - 只匹配明确带单位「N 端点」「N 工具」的当前事实，历史写法「N 个」等不误伤
 *   - 声明型 vs 历史型：端点行如「78 端点（+9 /api/pool/*）」的 +9 是增量，不参与
 *
 * 用法：node scripts/docs/check-facts.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { DOC_FILES } from './doc-files.mjs'

const ROOT = process.cwd()
const FACTS_PATH = path.join(ROOT, 'docs', 'facts.json')

if (!fs.existsSync(FACTS_PATH)) {
  console.error('[check-facts] ❌ 缺少事实源 docs/facts.json')
  console.error('  生成：node scripts/docs/gen-facts.mjs')
  process.exit(1)
}
const facts = JSON.parse(fs.readFileSync(FACTS_PATH, 'utf-8'))

const RULES = [
  {
    name: '端点计数',
    files: DOC_FILES.endpoints,
    pattern: /\*{0,2}(\d{2,3})\*{0,2}\s*个?\s*(?:HTTP\s*)?端点/g,
    fact: 'capabilities.endpoints',
  },
  {
    name: '工具计数',
    files: DOC_FILES.tools,
    pattern: /\*{0,2}(\d{1,2})\*{0,2}\s*个?\s*(?:宿主\s*)?(?:AI\s*)?工具/g,
    fact: 'capabilities.tools',
  },
]

function getFact(dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), facts)
}

const errors = []
for (const rule of RULES) {
  const expected = getFact(rule.fact)
  if (expected == null) continue
  for (const relFile of rule.files) {
    const file = path.join(ROOT, relFile)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf-8')
    rule.pattern.lastIndex = 0
    let m
    while ((m = rule.pattern.exec(text)) !== null) {
      const found = Number(m[1])
      if (found !== expected) {
        const line = text.slice(0, m.index).split('\n').length
        errors.push(
          `${relFile}:${line} 「${rule.name}」= ${found}，事实源 = ${expected}\n` +
          `      上下文: …${text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\n/g, ' ')}…`
        )
      }
    }
  }
}

if (errors.length) {
  console.error(`\n[check-facts] ❌ ${errors.length} 处数字与事实源不一致：\n`)
  for (const e of errors) console.error(`  · ${e}\n`)
  console.error('修法：事实变了 → node scripts/docs/gen-facts.mjs；文档写错 → 改文档')
  process.exit(1)
}

console.log(`[check-facts] ✅ 通过（${RULES.length} 类可派生事实；测试质量由 test:all 保证）`)
