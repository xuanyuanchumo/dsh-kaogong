/**
 * 文档门禁的「受检文件清单」——单一事实源（BL-DOC-01 假门禁修复）
 *
 * 为什么独立成文件：
 *   check-facts.mjs 定义「校验哪些文件」，pre-commit 决定「哪些文件变更要触发校验」。
 *   两者若各写一份清单，就会出现「check-facts 声明校验 CLAUDE.md、pre-commit 却跳过」的假门禁
 *   （reviewer-code 实测：CLAUDE.md 是唯一被 pre-commit 绕过的文件）。
 *   抽出来后两边 import 同一常量，配置漂移在物理上不可能。
 */
export const DOC_FILES = {
  smoke: ['README.md', 'CLAUDE.md', 'docs/agents/ROADMAP.md', 'docs/agents/README.md', 'docs/agents/TESTING.md'],
  render: ['README.md', 'CLAUDE.md', 'docs/agents/README.md', 'docs/agents/TESTING.md'],
  endpoints: ['README.md', 'docs/agents/README.md', 'docs/agents/ROADMAP.md', 'docs/agents/ARCHITECTURE.md'],
  tools: ['README.md', 'docs/agents/README.md'],
}

/** 所有受检文档的扁平集合（pre-commit 用） */
export const WATCHED_DOCS = new Set(Object.values(DOC_FILES).flat())
