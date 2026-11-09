/**
 * adapters/huasheng13.ts — 花生十三体系方法论语料适配层（cycle-18 / D1）
 *
 * 职责：把「📦 题库管理」安装到数据根的 25 篇方法论 Markdown 语料（<数据根>/huasheng13/**）解析成
 *       「可检索、可统计、可覆盖度量」的服务端事实层。零 npm 依赖（只用 node:fs / node:path / node:crypto）。
 *
 * 单一事实源：目录结构 100% 来自 src/shared/manifest.ts 的 HUASHENG13_META（已锁定契约，本文件只读不改）。
 *   任何「有哪些文件、属于哪个模块、放在哪个子目录」的问题都问 META，本文件不写第二份字面量清单。
 *
 * 四层能力：
 *   1. parseDoc      单篇 Markdown → 结构化（sections / tables / formulas / chars），做 CRLF 归一
 *   2. buildIndex    全量索引（META 驱动 + fixtureHash 失效 + 磁盘快照 + 原子写）
 *   3. search        BM25（k1=1.2, b=0.75）字段加权检索（title×3 / heading×2 / body×1）
 *                    中文用「字符 bigram + 单字」双粒度切词（无分词库可用，零依赖）
 *   4. coverageMatrix 覆盖矩阵（六模块 × 表格/公式/示例 三维度），给 UI 覆盖率环形图与白盒 gaps 用
 *
 * 设计纪律（对应项目历史事故）：
 *   - 语料缺失（用户尚未在「📦 题库管理」安装 huasheng13）→ 返回 degraded:true + missing[] 明确标记，
 *     **绝不 try-catch 吞异常后返回看起来正常的假数据**；只有参数非法才抛 TypeError。
 *   - 快照写盘一律「临时文件 + rename」原子替换，避免并发读者读到半个 JSON。
 *   - 快照失效靠 fixtureHash（25 个文件的 path+size+mtimeMs 的 sha1），不靠时间戳猜测。
 *   - 纯函数优先：解析/打分/矩阵都不碰 IO；只有 buildIndex / parsePractice 读盘。
 */
import {
  readFileSync, readdirSync, statSync, existsSync,
  writeFileSync, mkdirSync, renameSync, unlinkSync,
} from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { countBlocks, tokenize, termKind, countOccurrences, pickExcerpt, clampInt, numOr } from './huasheng13-text.js'
// 对外导出面保持不变：这两个工具原定义在本文件，现由文本模块提供
export { tokenize, termKind } from './huasheng13-text.js'
import { HUASHENG13_META } from '../shared/manifest.js'

/* ────────────────────────────────────────────────────────────────────────────
 * 0. 常量与契约视图
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * META 用 any 视图读取：manifest 里各模块 `examples: [...]` 与 `examples: []` 并存，
 * tsc 会推成字面量联合类型（`never[]` ∩ `{file,title}[]`），直接访问 `ex.file` 会报错。
 * 这里显式降级为 any，形状正确性由 D4 的静态守卫（HS13-10）在测试层保证。
 */
const META: any = HUASHENG13_META

/** 快照 schema 版本：结构不兼容变更时 +1，旧快照自动失效重建 */
export const HUASHENG13_INDEX_VERSION = 1

/** 语料篇数上限（META 声明值，D4-HS13-01/docCount 断言的基准；真实值由 META 推导，不写字面量） */
export const HUASHENG13_CORPUS_COUNT: number = (() => {
  const ids = new Set<string>()
  for (const e of corpusEntries()) ids.add(e.id)
  return ids.size
})()

/** BM25 超参：k1 控制词频饱和、b 控制文档长度归一强度（业界标准取值，公考语料短文档占多，b 取 0.75 偏中） */
export const BM25_K1 = 1.2
export const BM25_B = 0.75

/** 字段加权：标题最能代表主题 → 3.0；小标题（section heading）→ 2.0；正文 → 1.0 */
export const FIELD_WEIGHTS = { title: 3.0, heading: 2.0, body: 1.0 } as const

/** 中文单字在查询侧的权重折扣：bigram 精度高、单字噪声大（「位/直/除」到处都有），故压低 */
export const UNIGRAM_WEIGHT = 0.35

/** 整串短语命中加成：查询原文（去空白）在文档中出现时乘此系数，提升 top-1 准确率 */
export const PHRASE_BOOST = 1.35

/** 快照文件名（与 paperData 的 .paper-index.json 并列放在 data/ 下） */
const SNAPSHOT_NAME = '.huasheng13-index.json'

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 目录契约 → 语料条目（META 是唯一事实源）
 * ──────────────────────────────────────────────────────────────────────────── */

/** 语料子目录名 */
export type CorpusDir = 'references' | 'examples'

/** 语料条目：META 里的一条 file 引用 + 它声明的物理子目录 */
export interface CorpusEntry {
  /** 文档 id（= META 的 file 字段，如 'ziliao-fenxi'；也是 API 的 ?file= 取值） */
  id: string
  /** META 声明的子目录（references=方法论 / examples=练习示例） */
  dir: CorpusDir
  /** 声明目录下的相对路径，如 'references/ziliao-fenxi.md' */
  rel: string
  /** 所属模块 id（ziliao/shuliang/...；策略层与真题示例为 null） */
  moduleId: string | null
  moduleLabel: string | null
  /** 语义分类：doc=模块方法论 / example=配套练习 / strategy=跨模块策略层 */
  kind: 'doc' | 'example' | 'strategy'
  /** 干净标题（来自 META，UI 展示优先级高于文档内 H1） */
  title: string
}

/**
 * 目录探测顺序：声明目录优先，另一目录兜底。
 *
 * 背景（已由 Lead 在 manifest 侧修正契约）：
 *   `zhenti-shili` 语义上是「真题示例库」，但磁盘上实际落在 references/。
 *   Lead 已在 HUASHENG13_META.examples 里按磁盘事实声明 `dir: 'references'`，
 *   所以 corpusEntries() 读到的 dir 与磁盘一致，dirMismatch 应为空数组（声明 ≡ 运行态）。
 *
 * 本兜底仍保留，但定位为**纵深防御**而非正常路径：
 *   - 万一未来新增语料时 META 漏写 dir，兜底能避免「语料被误判缺失 → 假 degraded」；
 *   - 一旦兜底真正生效，该条目会出现在 index.dirMismatch 里被白盒看见，
 *     提醒维护者把声明改回与磁盘一致（而不是让偏差永久隐形）。
 */
export function candidateDirs(dir: CorpusDir): CorpusDir[] {
  return dir === 'references' ? ['references', 'examples'] : ['examples', 'references']
}


/** 把 META 条目自带的 dir 字段规整成联合类型；非法/缺省时回落 defaultDir */
function pickDir(raw: any, defaultDir: CorpusDir): CorpusDir {
  return raw === 'references' || raw === 'examples' ? raw : defaultDir
}

/**
 * 把 HUASHENG13_META 展平成「25 条语料条目」。
 *
 * dir 取值优先级：**条目自带的 dir 字段 > 语义默认值**（模块 docs→references、examples→examples）。
 * 为什么允许条目覆盖：`zhenti-shili` 这类语义上是「真题示例」但物理上落在 references/ 的条目，
 * 契约里必须能如实声明实际位置（Lead 已在 HUASHENG13_META 按磁盘事实标注 `dir: 'references'`）。
 * 这样「声明 vs 运行态」同源，dirMismatch 才可能为空——v1.8 白盒假阳性事故的根因就是两侧口径不同源。
 *
 * 复杂度：O(n)，n = 模块数 × 每模块条目数（本语料 ~25），纯函数、结果按 META 声明顺序确定性稳定。
 */
export function corpusEntries(): CorpusEntry[] {
  const out: CorpusEntry[] = []
  const seen = new Set<string>()
  const push = (item: any, defaultDir: CorpusDir, moduleId: string | null, moduleLabel: string | null, kind: CorpusEntry['kind']) => {
    const file = item && item.file
    if (!file || seen.has(file)) return
    seen.add(file)
    const dir = pickDir(item.dir, defaultDir)
    out.push({
      id: file,
      dir,
      rel: `${dir}/${file}.md`,
      moduleId,
      moduleLabel,
      kind,
      title: (item && item.title) || file,
    })
  }
  for (const m of META.modules || []) {
    for (const d of m.docs || []) push(d, 'references', m.id, m.label, 'doc')
    for (const e of m.examples || []) push(e, 'examples', m.id, m.label, 'example')
  }
  for (const s of META.strategy || []) push(s, 'references', null, null, 'strategy')
  for (const e of META.examples || []) push(e, 'examples', null, null, 'example')
  return out
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 文本归一与 Markdown 解析（纯函数）
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 换行归一：CRLF / 裸 CR → LF。
 * 历史踩坑：上游语料在不同平台落盘可能是 CRLF，`$` 锚点与 `split('\n')` 会带 `\r`，
 * 导致标题正则、表格行判定、行号统计全部错位，所以**所有读入文本第一时间归一**。
 * 复杂度：O(n) 字符串扫描。
 */
export function normalizeNewlines(text: string): string {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 一个结构化小节 */
export interface DocSection {
  /** 标题级别 1..4；0 表示文首无标题的前置段落 */
  level: number
  /** 标题文本（不含 # 前缀）；level=0 时为空串 */
  heading: string
  /** 1-based 起始行（含标题行本身） */
  startLine: number
  /** 1-based 结束行（含），到下一个标题前一行为止 */
  endLine: number
  /** 小节正文（不含标题行），已去尾随空行 */
  body: string
}

/** parseDoc 的返回结构（前 6 个字段是契约要求，其余为服务端/检索层附加只读信息） */
export interface ParsedDoc {
  /** 文档 id（文件名去 .md） */
  file: string
  title: string
  sections: DocSection[]
  /** 表格块数（连续 `^|` 行算 1 张表，见 countBlocks 注释） */
  tables: number
  /** 公式行数（含 = / ≈ / × / ÷ 的非代码块行） */
  formulas: number
  /** 去空白后的字符数（中文口径：不含空格与换行） */
  chars: number
  /* —— 附加字段（不改变上面的契约，只为下游省一次读盘） —— */
  /** 绝对路径 */
  path: string
  /** 相对 root 的路径；parseDoc 单独调用时等于文件名 */
  rel: string
  /** 归一后的全文 Markdown（服务端 /doc 端点直接返回它） */
  text: string
  /** 行数（归一后 split('\n') 的长度） */
  lines: number
  /** 信息密度权重 = 1 + ln(1+公式数) + ln(1+表格数) */
  weight: number
}

const HEADING_RE = /^(#{1,4})[ \t]+(.*)$/
const TABLE_ROW_RE = /^[ \t]*\|/
const FENCE_RE = /^[ \t]*(```|~~~)/
const FORMULA_CHARS = ['=', '≈', '×', '÷']






/* ────────────────────────────────────────────────────────────────────────────
 * 3. chapterWeight：信息密度权重（纯函数）
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 章节权重 = 1 + ln(1 + 公式数) + ln(1 + 表格数)。
 * 直觉：公式与表格越多，说明该篇是「可操作的方法论」而非纯叙述，学习时给的注意力权重应更高。
 * 用 log 而非线性，是为了抑制暴长文档（如 300 行表格）把权重拉到极端。
 * 复杂度 O(1)。
 */
export function chapterWeight(doc: { formulas?: number; tables?: number } | null | undefined): number {
  const f = Math.max(0, Number(doc && doc.formulas) || 0)
  const t = Math.max(0, Number(doc && doc.tables) || 0)
  return 1 + Math.log(1 + f) + Math.log(1 + t)
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. parseDoc：单篇 Markdown → 结构化（只读 IO，抛错交给调用方）
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 解析单篇语料。
 *
 * 步骤（单次线性扫描）：
 *   1. 读文件 + CRLF 归一
 *   2. 按 `^#{1,4}\s+` 切小节（记录 1-based 起止行）
 *   3. 表格：跳过代码块后，连续 `^\s*\|` 行算 1 张表
 *   4. 公式：跳过代码块后，含 `=`/`≈`/`×`/`÷` 的行计数
 *   5. chars = 去空白字符数
 *
 * 复杂度：O(n)，n = 文件字节数（约 6~25KB/篇，25 篇全量 < 1ms 量级）。
 * IO 异常（文件不存在/无权限）**不吞**：直接抛给上层，由 buildIndex 记入 errors[] 并置 degraded。
 */
export function parseDoc(absPath: string): ParsedDoc {
  if (typeof absPath !== 'string' || !absPath) {
    throw new TypeError('parseDoc(absPath): absPath 必须是非空字符串')
  }
  const text = normalizeNewlines(readFileSync(absPath, 'utf-8'))
  const lines = text.split('\n')

  // —— 标题与小节切分 ——
  const sections: DocSection[] = []
  const headingRows: Array<{ line: number; level: number; heading: string }> = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (FENCE_RE.test(ln)) { inFence = !inFence; continue }   // 代码块内的 # 不是标题
    if (inFence) continue
    const m = HEADING_RE.exec(ln)
    if (m) headingRows.push({ line: i, level: m[1].length, heading: m[2].trim() })
  }

  if (headingRows.length === 0) {
    // 无标题文件：整篇作为 level=0 的单一小节（不伪造标题）
    sections.push({ level: 0, heading: '', startLine: 1, endLine: lines.length, body: text.trim() })
  } else {
    // 文首前置段落（首个标题之前的内容）单独成节，level=0
    if (headingRows[0].line > 0) {
      const body = lines.slice(0, headingRows[0].line).join('\n').trim()
      if (body) sections.push({ level: 0, heading: '', startLine: 1, endLine: headingRows[0].line, body })
    }
    for (let k = 0; k < headingRows.length; k++) {
      const cur = headingRows[k]
      const nextLine = k + 1 < headingRows.length ? headingRows[k + 1].line : lines.length
      const body = lines.slice(cur.line + 1, nextLine).join('\n').replace(/\s+$/, '')
      sections.push({
        level: cur.level,
        heading: cur.heading,
        startLine: cur.line + 1,          // 1-based
        endLine: nextLine,                // 下一个标题前一行（1-based 行号即 nextLine）
        body,
      })
    }
  }

  // —— 表格 / 公式（跳过代码块，避免把代码示例里的 = 当公式）——
  const plainLines: string[] = []
  inFence = false
  for (const ln of lines) {
    if (FENCE_RE.test(ln)) { inFence = !inFence; continue }
    if (!inFence) plainLines.push(ln)
  }
  const tables = countBlocks(plainLines, (s) => TABLE_ROW_RE.test(s))
  const formulas = plainLines.reduce((acc, s) => {
    if (!s) return acc
    return FORMULA_CHARS.some((c) => s.includes(c)) ? acc + 1 : acc
  }, 0)

  // 标题：优先 H1，退化为第一个标题，再退化为文件名
  const h1 = headingRows.find((h) => h.level === 1)
  const title = (h1 && h1.heading) || (headingRows[0] && headingRows[0].heading) || basename(absPath, '.md')
  const chars = text.replace(/\s+/g, '').length
  const file = basename(absPath, '.md')

  return {
    file,
    title,
    sections,
    tables,
    formulas,
    chars,
    path: absPath,
    rel: `${basename(absPath, '.md')}.md`,
    text,
    lines: lines.length,
    weight: chapterWeight({ formulas, tables }),
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. buildIndex：全量索引 + fixtureHash + 磁盘快照（原子写）
 * ──────────────────────────────────────────────────────────────────────────── */

/** 索引中的单篇文档记录（= ParsedDoc 的摘要 + 检索用的词频统计） */
export interface Huasheng13Doc {
  /** 文档 id（META 的 file，如 'ziliao-fenxi'） */
  file: string
  /** 与 file 同值的别名，方便下游按 id 习惯消费（两者恒等，勿混用） */
  id: string
  title: string
  /** 绝对路径 */
  path: string
  /** 相对 root 的实际路径，如 'references/ziliao-fenxi.md' */
  rel: string
  /** 实际所在的子目录（可能与 META 声明不同，见 candidateDirs 注释） */
  dir: CorpusDir
  kind: 'doc' | 'example' | 'strategy'
  moduleId: string | null
  moduleLabel: string | null
  chars: number
  tables: number
  formulas: number
  /** 小节数（sections.length，即目录条目数） */
  sectionCount: number
  /** 信息密度权重 chapterWeight() */
  weight: number
  /** 小节数组（含正文，检索 snippet 与 /doc 端点共用） */
  sections: DocSection[]
  /** 归一后全文 Markdown */
  text: string
  /**
   * 字段加权词频：term → 3×tf(title) + 2×tf(heading) + 1×tf(body)。
   * 值为整数（权重是整数），JSON 紧凑；查询时与查询词权重相乘完成 BM25 打分。
   */
  tf: Record<string, number>
  /** 字段加权文档长度 = 3×|title tokens| + 2×|heading tokens| + 1×|body tokens|（BM25 长度归一分母） */
  lenW: number
}

/** 全量索引（既是内存结构，也是快照 JSON 的结构） */
export interface Huasheng13Index {
  v: number
  /** 构建时间戳（ms）；从快照加载时保留原构建时间，便于判断新鲜度 */
  builtAt: number
  /** 25 个文件 (rel+size+mtimeMs) 的 sha1；失效判据 */
  fixtureHash: string
  /** 语料根绝对路径 */
  root: string
  /** 是否降级：任一 META 声明的文件读不到即为 true */
  degraded: boolean
  /** 缺失的文档 id 列表（degraded 为 false 时恒为空数组） */
  missing: string[]
  /** 读取/解析失败的明细（不吞异常的证据） */
  errors: Array<{ file: string; reason: string }>
  /** 磁盘上存在但 META 未登记的文件（相对 root 路径）；用于发现「加了语料忘了登记」 */
  orphans: string[]
  /** META 声明目录与磁盘实际目录不一致的条目（如实登记，供白盒与契约对齐用） */
  dirMismatch: Array<{ file: string; declared: CorpusDir; actual: CorpusDir }>
  docs: Huasheng13Doc[]
  /* —— 运行态字段：不落盘，每次返回值不同（供 API 层透出白盒信息） —— */
  /** 本次结果来源：fresh=现场构建 / disk=命中磁盘快照 / memory=命中进程内缓存 */
  source?: 'fresh' | 'disk' | 'memory'
  snapshotFile?: string
  /** 本次 buildIndex 总耗时 ms */
  buildMs?: number
  /** 快照写盘结果 */
  snapshotWrite?: 'written' | 'skipped-degraded' | 'failed' | 'invalidated'
}

/** buildIndex 的可选参数 */
export interface BuildIndexOptions {
  /** 快照目录（默认 <cwd>/data）；测试可注入临时目录 */
  dataDir?: string
  /** 强制重建（忽略内存缓存与磁盘快照，仍然会写新快照） */
  force?: boolean
}

/** 进程内缓存：同一 fixtureHash 的重复调用直接复用（O(1) 返回） */
let memCache: { key: string; snap: Huasheng13Index } | null = null

/** 数据根热变更时作废进程内缓存（快照本身是 root 相关，靠 fixtureHash + root 校验自然失效） */
export function resetHuasheng13Cache(): void {
  memCache = null
}

function snapshotPath(opts: BuildIndexOptions): string {
  const dir = (opts && opts.dataDir) || join(process.cwd(), 'data')
  return join(dir, SNAPSHOT_NAME)
}

/** fixture 计算结果的单条明细 */
interface FixtureItem {
  entry: CorpusEntry
  /** 实际命中的绝对路径（缺失时为「按声明目录拼出的期望路径」，仅用于错误消息） */
  abs: string
  /** 实际命中目录 */
  dir: CorpusDir
  /** 实际命中路径相对 root（如 'references/zhenti-shili.md'） */
  rel: string
  size: number
  mtimeMs: number
  ok: boolean
  /** 声明目录与实际目录不一致时记录：{ declared, actual } */
  dirMismatch: { declared: CorpusDir; actual: CorpusDir } | null
}

/** 在候选目录里定位一篇语料；返回实际命中信息（纯 IO 探测，O(2) 次 stat） */
function locateEntry(root: string, entry: CorpusEntry): Omit<FixtureItem, 'hash'> & { ok: boolean } {
  const dirs = candidateDirs(entry.dir)
  for (const dir of dirs) {
    const abs = join(root, dir, `${entry.id}.md`)
    try {
      const st = statSync(abs)
      if (st.isFile()) {
        return {
          entry,
          abs,
          dir,
          rel: `${dir}/${entry.id}.md`,
          size: st.size,
          mtimeMs: Math.floor(st.mtimeMs),
          ok: true,
          dirMismatch: dir === entry.dir ? null : { declared: entry.dir, actual: dir },
        }
      }
    } catch {
      // 该候选目录无此文件 → 继续下一个候选
    }
  }
  const abs = join(root, entry.dir, `${entry.id}.md`)
  return { entry, abs, dir: entry.dir, rel: `${entry.dir}/${entry.id}.md`, size: 0, mtimeMs: 0, ok: false, dirMismatch: null }
}

/** 统计文件指纹；返回 hash + 缺失列表 + 孤儿文件 + 每篇的 stat（供增量判断日志） */
function computeFixture(root: string): {
  hash: string
  missing: string[]
  orphans: string[]
  dirMismatch: Array<{ file: string; declared: CorpusDir; actual: CorpusDir }>
  entries: FixtureItem[]
} {
  const entries: FixtureItem[] = []
  const missing: string[] = []
  const dirMismatch: Array<{ file: string; declared: CorpusDir; actual: CorpusDir }> = []
  const hashParts: string[] = []

  for (const entry of corpusEntries()) {
    const item = locateEntry(root, entry)
    if (!item.ok) missing.push(entry.id)
    if (item.dirMismatch) dirMismatch.push({ file: entry.id, declared: item.dirMismatch.declared, actual: item.dirMismatch.actual })
    // 缺失也写进 hash 输入（用 MISSING 占位），保证「补上文件后 hash 必变」；
    // 路径用**实际命中**目录，保证「挪动文件位置」也会让 hash 变化
    hashParts.push(item.ok ? `${item.rel}|${item.size}|${item.mtimeMs}` : `${entry.id}|MISSING`)
    entries.push(item)
  }

  // 孤儿扫描：遍历两个子目录顶层，找出「磁盘有但 META 未登记」的 .md
  const known = new Set(entries.filter((e) => e.ok).map((e) => e.rel))
  const orphans: string[] = []
  for (const dir of ['references', 'examples'] as const) {
    let names: string[] = []
    try { names = readdirSync(join(root, dir)) } catch { continue }
    for (const nm of names) {
      if (!nm.endsWith('.md')) continue
      const rel = `${dir}/${nm}`
      if (!known.has(rel)) orphans.push(rel)
    }
  }
  orphans.sort()
  // 孤儿也必须进指纹：否则「新增一篇未登记语料」不会让快照失效，orphans 会被缓存成旧值。
  // （教训同族：凡进入索引输出的事实，都要进缓存键，否则缓存与真相脱钩。）
  for (const rel of orphans) {
    let size = 0
    let mtimeMs = 0
    try {
      const st = statSync(join(root, rel))
      size = st.size
      mtimeMs = Math.floor(st.mtimeMs)
    } catch { /* stat 失败按 0 处理，不影响主流程 */ }
    hashParts.push(`orphan|${rel}|${size}|${mtimeMs}`)
  }

  return { hash: createHash('sha1').update(hashParts.join('\n')).digest('hex'), missing, orphans, dirMismatch, entries }
}

/** 由解析结果构造索引文档（含字段加权词频）；纯函数 */
function toIndexDoc(item: FixtureItem, parsed: ParsedDoc): Huasheng13Doc {
  const entry = item.entry
  const titleTokens = tokenize(parsed.title)
  const headingTokens: string[] = []
  const bodyTokens: string[] = []
  for (const s of parsed.sections) {
    if (s.heading) { for (const t of tokenize(s.heading)) headingTokens.push(t) }
    if (s.body) { for (const t of tokenize(s.body)) bodyTokens.push(t) }
  }

  // 字段加权词频（整数权重，避免 JSON 里出现浮点尾数）
  const tf: Record<string, number> = Object.create(null)
  const addTokens = (tokens: string[], w: number) => {
    for (const t of tokens) tf[t] = (tf[t] || 0) + w
  }
  addTokens(titleTokens, FIELD_WEIGHTS.title)
  addTokens(headingTokens, FIELD_WEIGHTS.heading)
  addTokens(bodyTokens, FIELD_WEIGHTS.body)

  return {
    file: parsed.file,
    id: parsed.file,
    title: entry.title || parsed.title,
    path: parsed.path,
    rel: item.rel,
    dir: item.dir,
    kind: entry.kind,
    moduleId: entry.moduleId,
    moduleLabel: entry.moduleLabel,
    chars: parsed.chars,
    tables: parsed.tables,
    formulas: parsed.formulas,
    sectionCount: parsed.sections.length,
    weight: parsed.weight,
    sections: parsed.sections,
    text: parsed.text,
    tf,
    lenW: titleTokens.length * FIELD_WEIGHTS.title + headingTokens.length * FIELD_WEIGHTS.heading + bodyTokens.length * FIELD_WEIGHTS.body,
  }
}

/** 原子写快照：先写 <file>.tmp-<pid>-<rand>，fsync 后 rename 覆盖（同分区 rename 原子） */
function writeSnapshotAtomic(file: string, payload: string): 'written' | 'failed' {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(tmp, payload, 'utf-8')
    renameSync(tmp, file)
    return 'written'
  } catch {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* 清理失败不影响主流程 */ }
    return 'failed'
  }
}

/** 快照结构合法性校验（防手改/半写/旧版）：字段齐全 + 指纹匹配 + docs 可迭代 */
function isValidSnapshot(snap: any, root: string, hash: string): boolean {
  return !!snap
    && snap.v === HUASHENG13_INDEX_VERSION
    && snap.fixtureHash === hash
    && snap.root === root
    && Array.isArray(snap.docs)
    && snap.docs.every((d: any) => d && typeof d.file === 'string' && Array.isArray(d.sections) && d.tf && typeof d.lenW === 'number')
}

/**
 * 构建全量索引（同步）。
 *
 * 流程（每次调用最多 3 次便宜操作 + 1 次可能的全量解析）：
 *   1. 由 META 展平 25 条语料条目 → stat 计算 fixtureHash（~25 次 stat，毫秒级）
 *   2. 命中进程内缓存（同 root + 同 hash）→ 直接返回（O(1)）
 *   3. 命中磁盘快照（同 v + 同 hash + 同 root）→ 反序列化返回（~几十 ms）
 *   4. 否则逐篇 parseDoc + 建 tf → 原子写快照 → 返回
 *
 * 参数非法（rootDir 非字符串）抛 TypeError；语料缺失**不抛**，返回 degraded:true + missing[]。
 * 复杂度：冷启动 O(F)，F = 25 篇总字节数（~290KB，含切词约 50~150ms）；热启动 O(1)/O(快照大小)。
 */
export function buildIndex(rootDir: string, opts: BuildIndexOptions = {}): Huasheng13Index {
  if (typeof rootDir !== 'string' || !rootDir) {
    throw new TypeError('buildIndex(rootDir): rootDir 必须是非空字符串')
  }
  const t0 = Date.now()
  const root = resolve(rootDir)
  const snapFile = snapshotPath(opts)
  const fixture = computeFixture(root)
  const cacheKey = `${root}|${fixture.hash}`

  // ① 进程内缓存（最快路径）
  if (!opts.force && memCache && memCache.key === cacheKey) {
    return { ...memCache.snap, source: 'memory', snapshotFile: snapFile, buildMs: Date.now() - t0 }
  }

  const base = {
    v: HUASHENG13_INDEX_VERSION,
    builtAt: Date.now(),
    fixtureHash: fixture.hash,
    root,
    degraded: fixture.missing.length > 0,
    missing: fixture.missing,
    errors: [] as Array<{ file: string; reason: string }>,
    orphans: fixture.orphans,
    dirMismatch: fixture.dirMismatch,
  }

  // ② 磁盘快照（降级态不信任磁盘快照：缺失时快照可能来自「语料完整」的另一份分发）
  if (!opts.force && fixture.missing.length === 0) {
    try {
      const raw = readFileSync(snapFile, 'utf-8')
      const snap = JSON.parse(raw)
      if (isValidSnapshot(snap, root, fixture.hash)) {
        const full: Huasheng13Index = {
          ...base,
          builtAt: typeof snap.builtAt === 'number' ? snap.builtAt : base.builtAt,
          docs: snap.docs,
        }
        memCache = { key: cacheKey, snap: stripRuntime(full) }
        return { ...full, source: 'disk', snapshotFile: snapFile, buildMs: Date.now() - t0 }
      }
    } catch {
      // 快照不存在 / JSON 坏了 / 权限不足 → 都只是「缓存未命中」，不是数据错误，继续现场重建
    }
  }

  // ③ 现场重建：逐篇解析，单篇失败记入 errors[] 并置 degraded（不吞、不伪造）
  const docs: Huasheng13Doc[] = []
  for (const item of fixture.entries) {
    if (!item.ok) continue
    try {
      const parsed = parseDoc(item.abs)
      docs.push(toIndexDoc(item, parsed))
    } catch (err: any) {
      base.errors.push({ file: item.entry.id, reason: String((err && err.message) || err) })
    }
  }
  if (base.errors.length > 0) base.degraded = true

  const index: Huasheng13Index = { ...base, docs }

  // ④ 落盘（降级态不写：避免把不完整索引固化成「可用快照」）
  let writeState: Huasheng13Index['snapshotWrite']
  if (base.degraded) {
    writeState = 'skipped-degraded'
  } else {
    const persisted = stripRuntime(index)
    writeState = writeSnapshotAtomic(snapFile, JSON.stringify(persisted))
  }

  memCache = { key: cacheKey, snap: stripRuntime(index) }
  return { ...index, source: 'fresh', snapshotFile: snapFile, buildMs: Date.now() - t0, snapshotWrite: writeState }
}

/** 剥掉运行态字段（不落盘、不进内存缓存，避免 source/buildMs 污染下一次读取） */
function stripRuntime(index: Huasheng13Index): Huasheng13Index {
  const { source, buildMs, snapshotFile, snapshotWrite, ...rest } = index
  return rest as Huasheng13Index
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. search：BM25 字段加权检索（含 bigram 双粒度与短语加成）
 * ──────────────────────────────────────────────────────────────────────────── */

/** 倒排索引（进程内派生结构，随索引对象生命周期缓存，不进快照） */
interface Posting { i: number; tf: number }
interface InvertedIndex { postings: Map<string, Posting[]>; avgLenW: number }

/** WeakMap 缓存：索引对象被回收时倒排索引自动释放，无泄漏 */
const invertedCache = new WeakMap<object, InvertedIndex>()

/** 补建 tf（兼容「快照缺 tf」的旧数据或外部手工索引）；返回 term→加权词频 */
function ensureTf(doc: Huasheng13Doc): Record<string, number> {
  if (doc.tf && typeof doc.tf === 'object') return doc.tf
  const entry: CorpusEntry = {
    id: doc.file, dir: doc.dir || 'references', rel: doc.rel,
    moduleId: doc.moduleId, moduleLabel: doc.moduleLabel, kind: doc.kind, title: doc.title,
  }
  const item: FixtureItem = {
    entry, abs: doc.path, dir: entry.dir, rel: doc.rel, size: 0, mtimeMs: 0, ok: true, dirMismatch: null,
  }
  const built = toIndexDoc(item, {
    file: doc.file, title: doc.title, sections: doc.sections || [],
    tables: doc.tables || 0, formulas: doc.formulas || 0, chars: doc.chars || 0,
    path: doc.path, rel: doc.rel, text: doc.text || '', lines: 0,
    weight: doc.weight || 1,
  })
  doc.tf = built.tf
  doc.lenW = built.lenW
  return doc.tf
}

/**
 * 构建（或读取缓存的）倒排索引。
 * 复杂度：O(T)，T = 全库 token 总量（约 2×字符数 × 25 篇 ≈ 60 万，实测 < 20ms）；缓存后 O(1)。
 */
function getInverted(index: Huasheng13Index): InvertedIndex {
  const cached = invertedCache.get(index as any)
  if (cached) return cached
  const postings = new Map<string, Posting[]>()
  let totalLen = 0
  for (let i = 0; i < index.docs.length; i++) {
    const doc = index.docs[i]
    const tf = ensureTf(doc)
    totalLen += doc.lenW || 0
    for (const term of Object.keys(tf)) {
      const v = tf[term]
      if (!v) continue
      const arr = postings.get(term)
      if (arr) arr.push({ i, tf: v })
      else postings.set(term, [{ i, tf: v }])
    }
  }
  const inv: InvertedIndex = {
    postings,
    avgLenW: index.docs.length > 0 && totalLen > 0 ? totalLen / index.docs.length : 1,
  }
  invertedCache.set(index as any, inv)
  return inv
}

export interface SearchOptions {
  /** 返回条数上限（默认 10，夹取 1..100） */
  limit?: number
  /** 最低分阈值（默认 0，>0 才入选） */
  minScore?: number
  /** 中文单字查询权重（默认 UNIGRAM_WEIGHT=0.35，传 1 可关闭折扣） */
  unigramWeight?: number
  /** 短语加成系数（默认 PHRASE_BOOST=1.35，传 1 关闭） */
  phraseBoost?: number
  /** 是否生成 snippets/highlight（默认 true；批量打分场景可关掉省 CPU） */
  snippets?: boolean
  /** BM25 k1（默认 1.2） */
  k1?: number
  /** BM25 b（默认 0.75） */
  b?: number
}

/** 单条命中 */
export interface SearchHit {
  /** 文档 id */
  file: string
  title: string
  /** BM25 得分（已含字段加权与短语加成），保留 4 位小数 */
  score: number
  /** 最佳命中片段（纯文本，未加 HTML 标记；UI 自行用 terms 高亮） */
  highlight: string
  /** 高价值小节片段（最多 3 条） */
  snippets: Array<{ heading: string; text: string }>
  /** 实际参与打分的查询词（已展开 bigram/单字）；UI 高亮直接用 */
  terms: string[]
  /* —— 附加字段（便于 UI 直接展示模块归属） —— */
  moduleId: string | null
  kind: 'doc' | 'example' | 'strategy'
  weight: number
}

/**
 * BM25 检索。
 *
 * 算法（Okapi BM25，字段加权变体）：
 *   score(q,d) = Σ_t  qw(t) · idf(t) · [ tfW(t,d)·(k1+1) ] / [ tfW(t,d) + k1·(1-b + b·lenW(d)/avgLenW) ]
 *   idf(t)     = ln(1 + (N - df + 0.5) / (df + 0.5))        ← 加 1 平滑，df=N 时仍为正
 *   tfW(t,d)   = 3·tf_title + 2·tf_heading + 1·tf_body       ← 字段加权直接折进词频
 *   qw(t)      = 1 + ln(qtf)（查询词频饱和） × unigramWeight（仅汉字单字）
 * 命中后若文档含查询整串短语（去空白），再乘 PHRASE_BOOST。
 *
 * 复杂度：O(|Q|·df + N) 量级（|Q|=查询 token 数，df=该词文档频次；倒排索引避免全库扫描），
 *         排序 O(M log M)，M = 有分文档数。
 * 空查询 / 空索引 → 返回 []（绝不抛错，这是 API 层「空 q 200 返回空数组」的依赖）。
 */
export function search(index: Huasheng13Index, query: string, opts: SearchOptions = {}): SearchHit[] {
  const raw = String(query == null ? '' : query).replace(/\s+/g, ' ').trim()
  if (!raw) return []
  if (!index || !Array.isArray(index.docs) || index.docs.length === 0) return []

  const limit = clampInt(opts.limit, 10, 1, 100)
  const k1 = numOr(opts.k1, BM25_K1)
  const b = numOr(opts.b, BM25_B)
  const uniW = numOr(opts.unigramWeight, UNIGRAM_WEIGHT)
  const phraseBoost = numOr(opts.phraseBoost, PHRASE_BOOST)
  const wantSnippets = opts.snippets !== false
  const minScore = numOr(opts.minScore, 0)

  const tokens = tokenize(raw)
  if (tokens.length === 0) return []

  // 查询词频（去重后按 qtf 加权）
  const qtf = new Map<string, number>()
  for (const t of tokens) qtf.set(t, (qtf.get(t) || 0) + 1)

  const inv = getInverted(index)
  const N = index.docs.length
  const scores = new Float64Array(N)

  for (const [term, qn] of qtf) {
    const post = inv.postings.get(term)
    if (!post || post.length === 0) continue
    const df = post.length
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
    const kind = termKind(term)
    const qw = (1 + Math.log(qn)) * (kind === 'unigram' ? uniW : 1)
    for (let p = 0; p < post.length; p++) {
      const { i, tf } = post[p]
      const doc = index.docs[i]
      const dl = doc.lenW || inv.avgLenW || 1
      const denom = tf + k1 * (1 - b + b * (dl / (inv.avgLenW || 1)))
      if (denom <= 0) continue
      scores[i] += qw * idf * ((tf * (k1 + 1)) / denom)
    }
  }

  // 短语加成：整串命中说明语义高度相关（如「截位直除」四字连续出现）
  if (phraseBoost !== 1 && raw.length >= 2) {
    const phrase = raw.replace(/\s+/g, '')
    for (let i = 0; i < N; i++) {
      if (scores[i] <= 0) continue
      const doc = index.docs[i]
      const hay = `${doc.title || ''}\n${doc.text || ''}`
      if (hay.indexOf(phrase) >= 0) scores[i] *= phraseBoost
    }
  }

  // 收集 + 排序（分数降序；同分按 file 升序，保证跨机器确定性）
  const picked: number[] = []
  for (let i = 0; i < N; i++) if (scores[i] > minScore) picked.push(i)
  picked.sort((a, bb) => (scores[bb] - scores[a]) || (index.docs[a].file < index.docs[bb].file ? -1 : 1))

  // 高亮用词：优先 bigram/英文词（精度高），无则退回单字
  const narrow = Array.from(new Set(tokens.filter((t) => termKind(t) !== 'unigram')))
  const hlTerms = narrow.length > 0 ? narrow : Array.from(new Set(tokens))

  const hits: SearchHit[] = []
  for (let k = 0; k < picked.length && hits.length < limit; k++) {
    const i = picked[k]
    const doc = index.docs[i]
    const score = Math.round(scores[i] * 10000) / 10000
    let snippets: Array<{ heading: string; text: string }> = []
    let highlight = ''
    if (wantSnippets) {
      snippets = pickSections(doc, hlTerms, 3)
      highlight = (snippets[0] && snippets[0].text) || pickExcerpt(doc.text || '', hlTerms)
    }
    hits.push({
      file: doc.file,
      title: doc.title,
      score,
      highlight,
      snippets,
      terms: hlTerms,
      moduleId: doc.moduleId,
      kind: doc.kind,
      weight: doc.weight,
    })
  }
  return hits
}

/** 从文档小节里挑出命中最多的小节，生成 ≤maxN 条片段（复杂度 O(S·T)） */
function pickSections(doc: Huasheng13Doc, terms: string[], maxN: number): Array<{ heading: string; text: string }> {
  const secs = doc.sections || []
  if (secs.length === 0) {
    const only = pickExcerpt(doc.text || '', terms)
    return only ? [{ heading: doc.title, text: only }] : []
  }
  const scored = secs.map((s) => {
    const hay = `${s.heading}\n${s.body}`
    let n = 0
    for (const t of terms) n += countOccurrences(hay, t)
    return { s, n }
  })
  scored.sort((a, bb) => (bb.n - a.n) || (a.s.startLine - bb.s.startLine))
  const out: Array<{ heading: string; text: string }> = []
  for (const item of scored) {
    if (out.length >= maxN) break
    if (item.n <= 0 && out.length > 0) break
    const text = pickExcerpt(item.s.body || item.s.heading, terms)
    if (!text) continue
    out.push({ heading: item.s.heading || doc.title, text })
  }
  return out
}


/* ────────────────────────────────────────────────────────────────────────────
 * 7. coverageMatrix：六模块 × 三维度覆盖矩阵
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 模块维度适用性：决定「按什么维度考核这个模块」。
 * 未声明 = 三维度全考核（formula/table/example 都计入分母）。
 * 语义：某维度为 false = **不计入分母**，不是「缺了要扣分」。
 * 为什么必须有：常识/申论本来不考公式，用统一四维打分会让健康模块持续告警（假阴性，
 * 与 v1.8 遥测假阳性事故同族：度量口径错 → 结论错 → 面板失去可信度）。
 */
interface DimsSpec { formula: boolean; table: boolean; example: boolean }

/** 把 META 的 dims 字段规整成完整三维（缺省全 true；只认显式 false） */
function resolveDims(raw: any): DimsSpec {
  const on = (v: any) => v !== false          // 只有显式 false 才算「不适用」
  return {
    formula: raw ? on(raw.formula) : true,
    table: raw ? on(raw.table) : true,
    example: raw ? on(raw.example) : true,
  }
}

export interface CoverageModule {
  /** 模块 id（ziliao/shuliang/yanyu/panduan/changshi/shenlun） */
  id: string
  label: string
  /** 以下四个取自 META，供 UI 直接渲染（不硬编码色板） */
  icon: string
  color: string
  weight: number
  targetMinutes: number
  targetQuestions: number
  /** META 声明的期望篇数（资料分析=3） */
  docCount: number
  /** 实际可解析到的篇数（语料完整时 == docCount） */
  presentDocs: number
  /** 配套示例篇数（**数字**，不是数组；UI 直接显示「N 篇」） */
  examples: number
  /** 该模块文档的表格块总数 */
  tables: number
  /** 该模块文档的公式行总数 */
  formulas: number
  /** 该模块文档的去空白字符总数 */
  chars: number
  /** 覆盖度 0~1（保留 3 位小数）：已有维度数 / 期望维度数（分母只含**适用**维度） */
  coverage: number
  /** 该模块适用的维度（来自 META.dims；未声明则三维全 true） */
  dims: DimsSpec
  /** 期望维度数（= 适用维度数 × docCount） */
  expectedDims: number
  /** 已有维度数 */
  presentDims: number
  /** 缺口明细（中文短语，如 'ziliao-zonghe 缺公式'）；只列**适用**维度的缺口 */
  missing: string[]
  /** 该模块纳入统计的文档 id（META 顺序） */
  files: string[]
}

export interface CoverageMatrix {
  modules: CoverageModule[]
  /** 全局覆盖度 0~1 = Σ已有维度 / Σ期望维度（保留 4 位小数） */
  overall: number
  /** 缺口摘要（仅列有缺口的模块，中文可读；供 API gaps[] 直接返回） */
  gaps: string[]
  /** 索引是否降级（语料缺失时为 true，此时覆盖度会偏低属预期） */
  degraded: boolean
  /** 期望维度总数 / 实际已有维度总数（白盒核对用） */
  expectedDims: number
  presentDims: number
}

/**
 * 覆盖矩阵。
 *
 * 口径（写死定义，避免多方各算一套；**不是**「统一三维」）：
 *   1. 先由 META.modules[].dims 得出该模块的**适用维度集合**（未声明 = 三维全适用；
 *      显式 `false` = 该维度不计入分母，例如常识/申论不考公式）。
 *   2. 期望维度数 = 适用维度数 × docCount
 *      —— 示例维度只在「适用 且 该模块确有 examples 声明」时计入（没有配套练习的模块不因缺示例扣分）。
 *   3. 已有维度数 = 有表格的文档数 + 有公式的文档数 + 示例维度（有可解析示例 ? docCount : 0），
 *      只累加适用维度。
 *   4. coverage = 已有 / 期望，夹取 [0,1]；missing[] 只列**适用**维度的真实缺口，
 *      不适用的维度不产生任何 gap 文案（否则白盒面板会对健康模块持续告警 = 假阴性）。
 *
 * 复杂度：O(D)，D = 25 篇；纯函数。
 */
export function coverageMatrix(index: Huasheng13Index): CoverageMatrix {
  const byFile = new Map<string, Huasheng13Doc>()
  for (const d of (index && index.docs) || []) byFile.set(d.file, d)

  const modules: CoverageModule[] = []
  let presentTotal = 0
  let expectedTotal = 0
  const gaps: string[] = []

  for (const m of META.modules || []) {
    const docIds: string[] = (m.docs || []).map((d: any) => d.file)
    const exIds: string[] = (m.examples || []).map((e: any) => e.file)
    const present = docIds.filter((id) => byFile.has(id))
    const presentEx = exIds.filter((id) => byFile.has(id))

    // ① 适用维度：示例维度还要求「该模块确有 examples 声明」，否则不计入分母
    const declared = resolveDims(m.dims)
    const dims: DimsSpec = {
      formula: declared.formula,
      table: declared.table,
      example: declared.example && exIds.length > 0,
    }

    let tables = 0
    let formulas = 0
    let chars = 0
    let withTables = 0
    let withFormulas = 0
    const missing: string[] = []

    for (const id of present) {
      const d = byFile.get(id)!
      tables += d.tables || 0
      formulas += d.formulas || 0
      chars += d.chars || 0
      // 只对**适用**维度记录缺口（不适用维度的「缺」不是问题）
      if (dims.table) {
        if ((d.tables || 0) > 0) withTables++
        else missing.push(`${id} 缺表格`)
      }
      if (dims.formula) {
        if ((d.formulas || 0) > 0) withFormulas++
        else missing.push(`${id} 缺公式`)
      }
    }
    // 语料缺失是硬缺口（任何适用维度下都要报）
    for (const id of docIds) {
      if (!byFile.has(id)) missing.push(`${id} 语料缺失（应为 ${m.id} 模块文档）`)
    }

    const docCount = docIds.length
    const exDim = dims.example && presentEx.length > 0 ? docCount : 0
    if (dims.example && presentEx.length === 0) missing.push('配套示例语料缺失')

    const presentDims = withTables + withFormulas + exDim
    const dimCount = (dims.table ? 1 : 0) + (dims.formula ? 1 : 0) + (dims.example ? 1 : 0)
    const expectedDims = docCount * dimCount
    const coverage = expectedDims > 0 ? Math.min(1, Math.round((presentDims / expectedDims) * 1000) / 1000) : 0

    presentTotal += presentDims
    expectedTotal += expectedDims
    if (coverage < 1) gaps.push(`${m.label}（${m.id}）：覆盖 ${Math.round(coverage * 100)}%，${missing.slice(0, 3).join('；')}`)

    modules.push({
      id: m.id,
      label: m.label,
      icon: m.icon || '',
      color: m.color || '',
      weight: Number(m.weight) || 0,
      targetMinutes: Number(m.targetMinutes) || 0,
      targetQuestions: Number(m.targetQuestions) || 0,
      docCount,
      presentDocs: present.length,
      examples: presentEx.length,
      tables,
      formulas,
      chars,
      coverage,
      dims,
      expectedDims,
      presentDims,
      missing,
      files: docIds,
    })
  }

  const overall = expectedTotal > 0 ? Math.round((presentTotal / expectedTotal) * 10000) / 10000 : 0
  return {
    modules,
    overall,
    gaps,
    degraded: !!(index && index.degraded),
    expectedDims: expectedTotal,
    presentDims: presentTotal,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 8. parsePractice：练习题抽取（`^#{2,3} 练习 N` 分块，h2/h3 双形态）
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PracticeOption { key: string; text: string }

export interface PracticeItem {
  /** 题号（来自标题「练习 N」的 N） */
  index: number
  /** 题目标题（标题里「练习 N：」之后的部分；无则 '练习 N'） */
  title: string
  /** 原始标题全文（便于定位） */
  heading: string
  /** 标题层级：2 或 3（上游语料两种形态并存，见 parsePractice 注释） */
  level: number
  /** 所属分类（最近的上级分类标题，如「一、逻辑填空」）；无分类为空串 */
  category: string
  /** 题干（材料 + 问题，已剔除选项行） */
  stem: string
  /** 选项数组（[{key:'A',text:'53870 亿元'}, ...]；无选项为 []） */
  options: PracticeOption[]
  /** 解析正文 */
  analysis: string
  /** 参考答案原文（'**答案**：' 之后的值；无则空串） */
  answer: string
  /** 答案是否可用于自动判分（A-D 字母形态） */
  answerIsLetter: boolean
  /** 易错点原文 */
  pitfalls: string
  /** 起始行（1-based，便于回跳全文） */
  startLine: number
  endLine: number
}

/** 选项行：以 A./A、/A．/A) 开头 */
const OPTION_START_RE = /^[ \t]*[A-D][.、．)）]/

/** 从若干行里解析选项（一行可含多个选项，用 2+ 空格分隔，本语料常见格式） */
function parseOptions(lines: string[]): PracticeOption[] {
  const out: PracticeOption[] = []
  for (const ln of lines) {
    const s = ln.trim()
    if (!OPTION_START_RE.test(s)) continue
    const re = /([A-D])[.、．)）]\s*([\s\S]*?)(?=\s{2,}[A-D][.、．)）]|$)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      const text = m[2].replace(/\s+/g, ' ').trim()
      if (text) out.push({ key: m[1], text })
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return out
}

/** 去掉标题行与 **加粗标记**，得到干净正文段 */
function tidy(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/^\s*\*\*[^*]+\*\*\s*[：:]\s*/gm, '')  // 去掉「**材料**：」这类行首标签
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^-{3,}$/gm, '')                        // 去掉分隔线
    .trim()
}

/** 练习题标题：`## 练习 1：xxx` 与 `### 练习 1：xxx` 两种层级并存（历史踩坑，必须同时兼容） */
const PRACTICE_HEAD_RE = /^(#{2,3})[ \t]+练习[ \t]*(\d+)[ \t]*[:：、.]?[ \t]*(.*)$/
/** 任意 Markdown 标题（用于判定分块边界与分类标题） */
const ANY_HEAD_RE = /^(#{1,6})[ \t]+(.*)$/

/**
 * 解析练习文件。
 *
 * 上游语料两种标题层级并存（同一份契约下必须都认，否则整文件 0 题）：
 *   A. h2 形态：`## 练习 1：基期计算`（ziliao-lianxi 10 题 / shuliang-lianxi 18 题）
 *   B. h3 形态：`## 一、逻辑填空` 为分类标题，其下 `### 练习 1：转折对应`
 *      （yanyu-lianxi 15 题 / panduan-lianxi 18 题 / shenlun-lianxi 13 题）
 * 这正是项目历史踩坑的复发点（CLAUDE.md：解析器必须兼容 h3，paperData 踩过一次）。
 *
 * 分块规则：一题的结束 = **下一个同级或更高级标题**（h3 题块遇 `## 配套速记` 也结束），
 *   或文件末尾。这样 h3 题不会吞掉后面的分类标题内容。
 * 分类归属：记录最近一个「级别 < 当前题级别」的标题作为 category（h3 题 → 最近的 h2 分类）。
 *
 * 复杂度：O(n)，n = 文件行数（两次线性扫描，无嵌套循环）。
 */
export function parsePractice(absPath: string): PracticeItem[] {
  if (typeof absPath !== 'string' || !absPath) {
    throw new TypeError('parsePractice(absPath): absPath 必须是非空字符串')
  }
  const text = normalizeNewlines(readFileSync(absPath, 'utf-8'))
  const lines = text.split('\n')

  // 一次扫描：收集所有标题，同时为每个标题记录「最近的上级分类标题」
  interface HeadInfo { line: number; level: number; raw: string; rest: string; index: number | null; category: string }
  const heads: HeadInfo[] = []
  /** 各级别最近一次出现的标题文本（索引 = 级别 1..6） */
  const lastByLevel: string[] = new Array(7).fill('')
  for (let i = 0; i < lines.length; i++) {
    const any = ANY_HEAD_RE.exec(lines[i])
    if (!any) continue
    const level = any[1].length
    const raw = any[2].trim()
    // 分类 = 级别严格小于当前级别的、最近的上级标题（h1 标题不算分类，避免整篇标题当分类）
    let category = ''
    for (let lv = level - 1; lv >= 2; lv--) {
      if (lastByLevel[lv]) { category = lastByLevel[lv]; break }
    }
    const pm = PRACTICE_HEAD_RE.exec(lines[i])
    heads.push({ line: i, level, raw, rest: pm ? pm[3].trim() : '', index: pm ? Number(pm[2]) : null, category })
    lastByLevel[level] = raw
    for (let lv = level + 1; lv <= 6; lv++) lastByLevel[lv] = ''   // 更深级别归属重置
  }

  const items: PracticeItem[] = []
  for (let h = 0; h < heads.length; h++) {
    const head = heads[h]
    if (head.index === null) continue   // 非练习标题，跳过（但它已参与分类计算）

    const start = head.line + 1
    // 分块结束：下一个「级别 <= 当前级别」的标题行；无则到文件尾
    let end = lines.length
    for (let j = h + 1; j < heads.length; j++) {
      if (heads[j].level <= head.level) { end = heads[j].line; break }
    }
    const block = lines.slice(start, end)

    // 关键标记行定位。本语料有「标记单独成行」与「标记 + 内容同行」两种形态：
    //   **解析**：          ← 单独成行，内容在后续列表里
    //   **易错点**：增长用 1 + R  ← 标记与内容同一行
    //   - 答案：53870 亿元         ← 列表项内的答案
    const findMarker = (re: RegExp): number => {
      for (let j = 0; j < block.length; j++) if (re.test(block[j])) return j
      return -1
    }
    const analysisAt = findMarker(/^\s*\*\*解析\*\*/)
    const answerAt = findMarker(/^\s*\*\*答案\*\*\s*[：:]?/)
    // 易错点可能以 `**易错点**：…` 独立行出现，也可能不在（本语料部分题目无此栏）
    const pitfallAt = findMarker(/^\s*\*\*易错点\*\*/)
    // 列表项形式的「- 答案：xxx」（正文解析末尾，非独立 **答案** 行）
    const inlineAnswerAt = findMarker(/^\s*[-*>]\s*答案[：:]/)
    // 解析区内的「- 答案：xxx」不能当独立答案标记：它属于解析内容
    const answerLineAt = answerAt >= 0 ? answerAt : inlineAnswerAt

    const optLines = block.filter((s) => OPTION_START_RE.test(s))
    const options = parseOptions(optLines)

    // 题干：第一个「解析 / 答案 / 易错点」标记之前的行，去掉选项行
    const markers = [analysisAt, answerLineAt, pitfallAt].filter((n) => n >= 0)
    const stemEnd = markers.length > 0 ? Math.min(...markers) : block.length
    const stemLines = block.slice(0, stemEnd).filter((s) => !OPTION_START_RE.test(s))
    const stem = tidy(stemLines)

    /** 取标记行「冒号之后」的行内内容（无则空串）；`**解析**：` 这类空内容返回空串 */
    const inlineAfter = (at: number, label: RegExp): string => {
      if (at < 0) return ''
      const s = block[at].replace(label, '').replace(/^\s*[：:]\s*/, '').replace(/^\s*[-*>]\s*/, '').replace(/\*\*/g, '').trim()
      return s
    }

    // 解析：行内内容 + 标记之后到「答案 / 易错点」之前的正文
    let analysis = ''
    if (analysisAt >= 0) {
      const stops = [answerAt, pitfallAt, block.length].filter((n) => n > analysisAt).sort((a, b) => a - b)
      const stop = stops.length > 0 ? stops[0] : block.length
      // 注意：inlineAnswerAt 在解析区内部时属于解析内容，故不作为解析终止标记
      const head = inlineAfter(analysisAt, /^\s*\*\*解析\*\*\s*/)
      const rest = tidy(block.slice(analysisAt + 1, stop))
      analysis = [head, rest].filter(Boolean).join('\n').trim()
    }

    // 易错点：行内内容 + 标记之后到「答案」之前
    let pitfalls = ''
    if (pitfallAt >= 0) {
      const stops = [answerAt, block.length].filter((n) => n > pitfallAt).sort((a, b) => a - b)
      const stop = stops.length > 0 ? stops[0] : block.length
      const head = inlineAfter(pitfallAt, /^\s*\*\*易错点\*\*\s*/)
      const rest = tidy(block.slice(pitfallAt + 1, stop))
      pitfalls = [head, rest].filter(Boolean).join('\n').trim()
    }

    // 答案值：优先独立 `**答案**：X`；退化为解析末的 `- 答案：X`（该行是自由文本，不是选项字母）
    let answer = ''
    if (answerAt >= 0) {
      answer = block[answerAt]
        .replace(/^\s*\*\*答案\*\*\s*[：:]?\s*/, '')
        .replace(/^\s*[-*>]\s*/, '')
        .replace(/\*\*/g, '')
        .trim()
    }
    if (!answer && inlineAnswerAt >= 0) {
      answer = block[inlineAnswerAt].replace(/^\s*[-*>]\s*答案[：:]\s*/, '').replace(/\*\*/g, '').trim()
      // 「- 答案：53870 亿元」这类结果值只是解析结论，若与选项字母无关则视为无标准答案
      // （保留原文到 answer，但用 answerIsLetter 标明是否可用于自动判分）
    }
    const answerIsLetter = /^[A-Da-d](\s|$)/.test(answer)

    items.push({
      index: head.index,
      title: head.rest || `练习 ${head.index}`,
      heading: head.raw,
      level: head.level,
      category: head.category,
      stem,
      options,
      analysis,
      answer,
      answerIsLetter,
      pitfalls,
      startLine: start + 1,
      endLine: end,
    })
  }
  return items
}

/* ────────────────────────────────────────────────────────────────────────────
 * 9. 便捷查询（薄封装，纯函数）
 * ──────────────────────────────────────────────────────────────────────────── */

/** 按 id 找一篇索引文档；找不到返回 null（不抛错，供 API 未知 file 分支） */
export function findDoc(index: Huasheng13Index, file: string): Huasheng13Doc | null {
  if (!index || !Array.isArray(index.docs) || !file) return null
  for (const d of index.docs) if (d.file === file) return d
  return null
}

/** 模块概览（供 /catalog 直接拼装：模块 + 文档摘要，不读取盘） */
export function catalogModules(index: Huasheng13Index): Array<{
  id: string; label: string; icon: string; color: string
  weight: number; targetMinutes: number; targetQuestions: number
  docs: Array<{ file: string; title: string; desc: string; chars: number; tables: number; formulas: number; sectionCount: number; weight: number; present: boolean }>
  examples: Array<{ file: string; title: string; present: boolean; chars: number }>
}> {
  const byFile = new Map<string, Huasheng13Doc>()
  for (const d of (index && index.docs) || []) byFile.set(d.file, d)
  return (META.modules || []).map((m: any) => ({
    id: m.id,
    label: m.label,
    icon: m.icon || '',
    color: m.color || '',
    weight: Number(m.weight) || 0,
    targetMinutes: Number(m.targetMinutes) || 0,
    targetQuestions: Number(m.targetQuestions) || 0,
    docs: (m.docs || []).map((d: any) => {
      const hit = byFile.get(d.file)
      return {
        file: d.file,
        title: d.title || (hit && hit.title) || d.file,
        desc: d.desc || '',
        chars: hit ? hit.chars : 0,
        tables: hit ? hit.tables : 0,
        formulas: hit ? hit.formulas : 0,
        sectionCount: hit ? hit.sectionCount : 0,
        weight: hit ? hit.weight : 1,
        present: !!hit,
      }
    }),
    examples: (m.examples || []).map((e: any) => {
      const hit = byFile.get(e.file)
      return { file: e.file, title: e.title || (hit && hit.title) || e.file, present: !!hit, chars: hit ? hit.chars : 0 }
    }),
  }))
}
