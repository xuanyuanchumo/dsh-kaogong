/**
 * adapters/huasheng13-text.ts — 方法论语料的纯文本工具（cycle-18 复杂度拆分）
 *
 * 拆分动因：huasheng13.ts 单文件复杂度 211 > 预算 180（.cycles/config.yml complexity_budget）。
 * 拆法＝**只读纯函数外提**（本项目既定模式，见 CLAUDE.md cycle-13 教训①）：
 * 这些函数不接触任何模块级可变状态、不读盘、不做 IO，逐字节搬移即可行为等价。
 *
 * 内容：分词（中文 bigram + 单字双粒度）、块计数、子串计数、片段截取、数值夹取。
 * 零 npm 依赖；全中文注释。
 */

/**
 * 统计「连续块」数量：连续满足 test 的行视为一个块（1 张表 / 1 段代码）。
 * 复杂度：O(L)，L = 行数。
 * 为什么按块而不是按行：`tables` 语义是「几张表」，一行一个计数会把一张 5 行表算成 5。
 */
export function countBlocks(lines: string[], test: (s: string) => boolean): number {
  let n = 0
  let inBlock = false
  for (const ln of lines) {
    const hit = test(ln)
    if (hit && !inBlock) { n++; inBlock = true }
    else if (!hit) inBlock = false
  }
  return n
}

/**
 * 把一行文本切成检索 token。
 *
 * 中文没有空格边界，零依赖下采用「bigram + 单字」双粒度：
 *   - 单字（unigram）：保召回（生僻搭配、单字术语如「率」「比」）
 *   - 相邻双字（bigram）：保精度（「截位」「位直」「直除」），这是中文检索的经典无词典方案
 *   例：「截位直除」→ 截 位 直 除 + 截位 位直 直除
 * 英文/数字按词，统一小写（ABRX → abrx），保证大小写不敏感。
 *
 * 复杂度：O(n)，n = 文本长度；每个汉字最多产出 2 个 token，内存 ≈ 2n。
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  const s = String(text == null ? '' : text)
  // 交替匹配「连续汉字块」与「连续英文/数字块」，其余字符（标点、空白、符号）作分隔符丢弃
  const re = /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+)|([A-Za-z0-9]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m[1]) {
      const run = m[1]
      for (let i = 0; i < run.length; i++) {
        out.push(run[i])                                   // 单字
        if (i + 1 < run.length) out.push(run[i] + run[i + 1]) // 双字 bigram
      }
    } else if (m[2]) {
      out.push(m[2].toLowerCase())                          // 英文/数字整词
    }
    if (m.index === re.lastIndex) re.lastIndex++            // 零宽兜底，防死循环
  }
  return out
}

/** 单个 token 的类型判定（决定查询侧权重）：汉字单字=unigram，汉字多字=bigram，其余=latin */
export function termKind(term: string): 'unigram' | 'bigram' | 'latin' {
  if (/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]$/.test(term)) return 'unigram'
  if (/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2,}$/.test(term)) return 'bigram'
  return 'latin'
}

/** 子串出现次数（检索用；haystack 通常 < 20KB，needle 为 1~4 字，复杂度 O(n·m)） */
export function countOccurrences(hay: string, needle: string): number {
  if (!hay || !needle) return 0
  let n = 0
  let i = 0
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length }
  return n
}

/** 取一个以首个命中为中心的上下文片段（去换行、加省略号），用于 highlight */
export function pickExcerpt(text: string, terms: string[], maxLen = 180): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  let at = -1
  for (const t of terms) {
    const i = s.indexOf(t)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
  const start = Math.max(0, at - 40)
  let out = s.slice(start, start + maxLen).trim()
  if (start > 0) out = '…' + out
  if (start + maxLen < s.length) out += '…'
  return out
}

export function clampInt(v: any, dflt: number, lo: number, hi: number): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}
export function numOr(v: any, dflt: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}
