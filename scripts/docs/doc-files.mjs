/**
 * 文档门禁的「受检文件清单」——单一事实源（BL-DOC-01）
 *
 * check-facts.mjs 定义「校验哪些文件的哪些事实」，pre-commit 决定「哪些文件变更要触发」。
 * 两者 import 同一常量，杜绝「check-facts 声明校验、pre-commit 却跳过」的假门禁。
 *
 * ★ 2026-11-20 反模式清理：断言数（smoke/render 通过数）已从受检事实中移除。
 *   它是自我声明、可被随手改数字绕过，且不等于测试质量。测试质量只由 test:all 退出码保证。
 */
export const DOC_FILES = {
  endpoints: ['README.md', 'docs/agents/README.md', 'docs/agents/ROADMAP.md', 'docs/agents/ARCHITECTURE.md'],
  tools: ['README.md', 'docs/agents/README.md'],
}

/** 所有受检文档的扁平集合（pre-commit 用） */
export const WATCHED_DOCS = new Set(Object.values(DOC_FILES).flat())
