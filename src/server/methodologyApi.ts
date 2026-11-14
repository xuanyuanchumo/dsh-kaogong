/**
 * server/methodologyApi.js — 花生十三体系方法论域（cycle-18 / v1.13.0）
 *
 * 六个端点（路径口径 = **相对挂载点的逻辑路径**，与 CAPABILITIES.endpoints 逐字一致）：
 *   GET /api/huasheng13/catalog    目录树（完全由 HUASHENG13_META 驱动 + 每篇语料统计）
 *   GET /api/huasheng13/doc        ?file=<id> 单篇全文（markdown + 章节树 + 信息密度权重）
 *   GET /api/huasheng13/search     ?q=&limit= BM25 全文检索（D1 引擎）
 *   GET /api/huasheng13/coverage   六模块 × 体系覆盖矩阵 + 缺口清单
 *   GET /api/huasheng13/practice   ?file=&n= 配套练习抽取（「## 练习 N」分块）
 *   GET /api/huasheng13/trace      本域消费链路白盒追踪（真实计数，环形缓冲）
 *
 * ⚠ v1.8「白盒假阳性」事故根因：遥测若记 mountPath+rel（/kaogong/api/...），
 *   与 manifest 声明口径（/api/...）永不相等 → 全部端点被判「未声明」。本域所有键
 *   一律用下面的常量（同一组字面量既是路由表、又是 trace 的 endpoints 键），禁止拼接前缀。
 *   trace 里另附 declaration 对账（路由表 ↔ CAPABILITIES.endpoints），把该事故固化成可测事实。
 *
 * 崩溃安全：本域**全同步**（handle 返回对象 / undefined），任何内部异常都在 handle 的
 * try/catch 内收敛为 { error } 且 HTTP 200（与 srsApi / paperApi 风格一致），绝不冒泡成
 * uncaughtException 击杀宿主（cycle-0 血泪教训）。
 *
 * 跨工作区隔离（cycle-17 ㉙ R20 事故推论）：trace 计数器按 ws 分槽（Map<wsKey, counter>），
 * wsKey 由 ws.ts 的 store.wsKey(raw) 归一（slug-hash8）——A/B 两个工作区的命中数互不污染。
 *
 * 语料缺失语义：语料由「📦 题库管理」安装到**数据根**（25 个 .md），所以「语料缺失」才是
 * degraded；「题库一个都没装」不是 degraded —— 这是本域与 /api/method（依赖外部
 * kaogong-skill 仓库）的本质区别。题库为空时本域必须照常返回全部语料。
 */
import { existsSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPABILITIES, HUASHENG13_META } from '../shared/manifest.js'
import {
  buildIndex, search as hs13Search, coverageMatrix, parsePractice, parseDoc,
  candidateDirs, tokenize, HUASHENG13_CORPUS_COUNT,
} from '../adapters/huasheng13.js'

// ── 端点路径常量（路由表 + trace 键 + 声明对账，三者共用同一组字面量）──
const EP_CATALOG = '/api/huasheng13/catalog'
const EP_DOC = '/api/huasheng13/doc'
const EP_SEARCH = '/api/huasheng13/search'
const EP_COVERAGE = '/api/huasheng13/coverage'
const EP_PRACTICE = '/api/huasheng13/practice'
const EP_TRACE = '/api/huasheng13/trace'
/** 导出给测试/文档做静态守卫（不含任何前缀拼接，口径即 manifest 声明口径） */
export const HS13_ENDPOINTS: string[] = [EP_CATALOG, EP_DOC, EP_SEARCH, EP_COVERAGE, EP_PRACTICE, EP_TRACE]

const META: any = HUASHENG13_META
const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PKG_ROOT = resolve(HERE, '..', '..')   // dist/server → <pkg>

// ── trace 环形缓冲参数 ──
const RECENT_RING = 200      // recent 事件环形容量（只保留最近 200 条，防内存无界增长）
const TRACE_RECENT = 20      // trace 响应实际返回条数
const LAT_RING = 100         // 每端点延迟样本环形（与 http.ts telemetry 同规格）
const WS_SLOT_LIMIT = 24     // ws 分槽上限（LRU 淘汰最久未访问的工作区）

// ══════════════════════════════════════════════════════════════
// 通用小工具（全部纯函数，零依赖）
// ══════════════════════════════════════════════════════════════

/** 数值归一：任何非法输入收敛为 0（避免 NaN 污染 JSON 响应） */
function num(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 覆盖率归一：强制落到 [0,1] */
function clamp01(v: any): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function round2(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function round4(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0
}

/** 有序样本百分位（p∈[0,100]，最近秩法；与 http.ts percentile 同口径） */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/** 整数参数解析 + 夹紧：[非法 → 默认值]，超界 → 边界（未知参数不抛错，一律 200） */
function clampInt(raw: any, dft: number, lo: number, hi: number): number {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return dft
  const n = parseInt(s, 10)
  if (!Number.isFinite(n)) return dft
  return Math.max(lo, Math.min(hi, n))
}

/** 安全取 query 参数：URLSearchParams / 普通对象 / 空值 三种形态都不抛 */
function qget(params: any, name: string): string {
  try {
    if (!params) return ''
    if (typeof params.get === 'function') {
      const v = params.get(name)
      return v == null ? '' : String(v)
    }
    if (typeof params === 'object') {
      const v = params[name]
      return v == null ? '' : String(v)
    }
  } catch { /* 畸形参数表：当作缺省，绝不抛 */ }
  return ''
}

/** 文件 id 归一：去目录、去 .md、trim。取 basename 天然阻断路径穿越 */
function normalizeFileId(raw: any): string {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return ''
  const base = s.split(/[\\/]/).pop() || s
  return base.replace(/\.md$/i, '').trim()
}

/** 索引文档数组（D1 契约字段是 docs） */
function docsOf(idx: any): any[] {
  if (!idx || typeof idx !== 'object') return []
  return Array.isArray(idx.docs) ? idx.docs : []
}

// ══════════════════════════════════════════════════════════════
// 语料文件登记表（HUASHENG13_META 派生，禁止再写字面量）
// ══════════════════════════════════════════════════════════════
interface FileMeta {
  file: string                 // 逻辑 id（= ?file= 的取值）
  dir: 'references' | 'examples'
  kind: 'doc' | 'example' | 'strategy'
  title: string
  desc: string
  moduleId: string             // 'strategy' / 'examples' 表示跨模块层
}

/** 由 META 构建 25 个文件的登记表：file id → 声明位置/标题/归属模块 */
function buildFileRegistry(): Map<string, FileMeta> {
  const map = new Map<string, FileMeta>()
  const put = (rawFile: any, dir: 'references' | 'examples', kind: 'doc' | 'example' | 'strategy',
    title: string, desc: string, moduleId: string) => {
    const file = normalizeFileId(rawFile)
    if (!file || map.has(file)) return
    map.set(file, { file, dir, kind, title: title || file, desc: desc || '', moduleId })
  }
  for (const m of (META.modules || [])) {
    for (const d of (m.docs || [])) put(d.file, 'references', 'doc', d.title, d.desc, m.id)
    for (const e of (m.examples || [])) put(e.file, 'examples', 'example', e.title, '', m.id)
  }
  for (const s of (META.strategy || [])) put(s.file, 'references', 'strategy', s.title, s.desc, 'strategy')
  for (const e of (META.examples || [])) put(e.file, 'references', 'strategy', e.title, '', 'examples')
  return map
}

// ══════════════════════════════════════════════════════════════
// 白盒计数器（模块级：换数据根重建域实例时不清零，链路证据不丢）
// ══════════════════════════════════════════════════════════════
interface EpLocus { hits: number; lat: number[]; lastAt: number }
interface WsCounter {
  endpoints: Record<string, EpLocus>
  searches: { total: number; hit: number; miss: number; empty: number }
  docs: Record<string, number>
  recent: Array<{ at: number; kind: string; detail: string; ms: number }>
}

function newCounter(): WsCounter {
  const endpoints: Record<string, EpLocus> = {}
  for (const p of HS13_ENDPOINTS) endpoints[p] = { hits: 0, lat: [], lastAt: 0 }
  return { endpoints, searches: { total: 0, hit: 0, miss: 0, empty: 0 }, docs: {}, recent: [] }
}

/** ws 分槽表：LRU（Map 插入序 = 访问序，命中即重插到尾部） */
const wsSlots = new Map<string, WsCounter>()

function getCounter(wsKey: string): WsCounter {
  let c = wsSlots.get(wsKey)
  if (c) {
    wsSlots.delete(wsKey)
    wsSlots.set(wsKey, c)   // 触碰 → 移到队尾（最热）
    return c
  }
  c = newCounter()
  wsSlots.set(wsKey, c)
  if (wsSlots.size > WS_SLOT_LIMIT) {
    const oldest = wsSlots.keys().next()
    if (!oldest.done) wsSlots.delete(oldest.value as string)
  }
  return c
}

/** 记一条链路事件（环形 200；detail 强制字符串化，防非字符串污染 JSON） */
function note(c: WsCounter, kind: string, detail: any, ms: number): void {
  c.recent.push({
    at: Date.now(),
    kind,
    detail: typeof detail === 'string' ? detail : String(detail == null ? '' : detail),
    ms: round2(ms),
  })
  if (c.recent.length > RECENT_RING) c.recent.splice(0, c.recent.length - RECENT_RING)
}

// ══════════════════════════════════════════════════════════════
// 域工厂
// ══════════════════════════════════════════════════════════════
interface DocStat { chars: number; tables: number; formulas: number; sections: number; present: boolean }

/**
 * 构造方法论域。
 * @param options.pkgRoot    包根（默认由 dist/server 反推），语料根 = pkgRoot + HUASHENG13_META.root
 * @param options.dataDir    D1 索引快照目录（默认 <pkg>/data）
 * @param options.corpusDir  语料根覆盖（测试/沙箱指向临时目录，模拟语料缺失）
 * @param options.store      ws.ts 的 store（wsKey 归一，用于 trace 分槽）
 */
export function makeMethodologyApi(options: any = {}) {
  const pkgRoot = resolve(String(options.pkgRoot || DEFAULT_PKG_ROOT))
  const dataDir = resolve(String(options.dataDir || join(pkgRoot, 'data')))
  // cycle-18：语料与其它题库同等对待——位于**数据根**下（repoRoot/huasheng13），
  // 由「📦 题库管理」统一下载配置。这里必须吃 repoRoot（随数据根热切换重建），
  // 绝不能退回包根（包内不再携带任何语料）。
  const repoRoot = options.repoRoot ? resolve(String(options.repoRoot)) : null
  const corpusDir = options.corpusDir
    ? resolve(String(options.corpusDir))
    : join(repoRoot || pkgRoot, String(META.root || 'huasheng13'))
  const store = options.store

  /** 25 个语料文件的登记表（META 单一事实源派生） */
  const FILES = buildFileRegistry()
  const DECLARED_IDS: string[] = [...FILES.keys()]

  // ── 索引（D1 自带"内存缓存 + 磁盘快照"两层，这里再套一层极薄的降级重试壳）──
  // 为什么要这层壳：D1 的 buildIndex 在语料目录整体缺失时仍会返回 degraded 索引，
  // 但每调一次都要扫 25 次 stat。这里把结果缓存下来，并对降级态做短间隔重试
  // （语料后补/挂载完成后能自愈，不必重启进程）。
  interface IndexSlot { idx: any; at: number; degraded: boolean; error: string }
  const IDX_TTL_MS = 30_000
  const IDX_DEGRADED_RETRY_MS = 3_000
  let idxSlot: IndexSlot = null

  function loadIndex(force = false): IndexSlot {
    const at = Date.now()
    if (!existsSync(corpusDir)) {
      return {
        idx: null, at, degraded: true,
        error: `方法论语料未安装：${corpusDir} —— 打开「📦 题库管理」安装必选包 huasheng13（约 336KB）`,
      }
    }
    try {
      const idx = buildIndex(corpusDir, { dataDir, force })
      const docs = docsOf(idx)
      if (!idx || !docs.length) {
        return { idx, at, degraded: true, error: '语料索引为空：数据根/huasheng13 下未解析到任何 .md 文件（请重装 huasheng13）' }
      }
      // D1 的 degraded 判据 = META 声明文件中读不到的个数 > 0（诚实降级，不伪造完整）
      const degraded = !!idx.degraded
      const error = degraded
        ? `语料缺失 ${(idx.missing || []).length} 篇：${(idx.missing || []).slice(0, 5).join(', ')}`
        : ''
      return { idx, at, degraded, error }
    } catch (e: any) {
      // 绝不抛：IO/解析异常一律降级（服务活着比数据完整更重要）
      return {
        idx: null, at, degraded: true,
        error: `语料索引构建失败：${e && e.message ? e.message : String(e)}`,
      }
    }
  }

  function ensureIndex(force = false): IndexSlot {
    const now = Date.now()
    if (idxSlot && !force) {
      const ttl = idxSlot.degraded ? IDX_DEGRADED_RETRY_MS : IDX_TTL_MS
      if (now - idxSlot.at < ttl) return idxSlot
    }
    idxSlot = loadIndex(force)
    return idxSlot
  }

  /** 文档 id → 索引文档（实测路径/统计的唯一来源） */
  function docMapOf(slot: IndexSlot): Map<string, any> {
    const map = new Map<string, any>()
    for (const d of docsOf(slot.idx)) {
      const id = normalizeFileId(d.file ?? d.id)
      if (id) map.set(id, d)
    }
    return map
  }

  /** 取单篇统计：索引命中即真实值；未命中（语料缺失）→ present:false + 全 0 */
  function statOf(indexMap: Map<string, any>, file: string): DocStat {
    const d = indexMap.get(file)
    if (d) {
      return {
        chars: num(d.chars), tables: num(d.tables), formulas: num(d.formulas),
        sections: num(d.sectionCount) || (Array.isArray(d.sections) ? d.sections.length : 0),
        present: true,
      }
    }
    return { chars: 0, tables: 0, formulas: 0, sections: 0, present: false }
  }

  /** 声明目录优先、另一目录兜底的磁盘路径解析（与 D1 的 candidateDirs 同口径） */
  function resolveCorpusPath(fm: FileMeta): string | null {
    for (const dir of candidateDirs(fm.dir)) {
      const p = join(corpusDir, dir, fm.file + '.md')
      if (existsSync(p)) return p
    }
    return null
  }

  /** 章节瘦身：只回标题树（全文在 markdown / index 里，避免响应体翻倍） */
  function slimSections(raw: any): any[] {
    if (!Array.isArray(raw)) return []
    return raw.map((s: any) => ({
      level: num(s && s.level),
      heading: String((s && s.heading) || ''),
      startLine: num(s && s.startLine),
      endLine: num(s && s.endLine),
      chars: String((s && s.body) || '').length,
    }))
  }

  // ══ catalog：目录树（META 驱动 + 每篇实测统计）══
  let catalogCache: { key: string; value: any } = null

  function buildCatalog(force: boolean, c: WsCounter): any {
    const slot = ensureIndex(force)
    const indexMap = docMapOf(slot)
    const key = `${slot.idx ? slot.idx.builtAt : 0}|${slot.degraded ? 1 : 0}|${indexMap.size}`
    // cache 命中也必须记链路事件：note 描述的是「本次调用」，不是「本次构建」
    if (catalogCache && catalogCache.key === key) {
      const hit = catalogCache.value
      note(c, 'catalog', `${hit.modules.length} 模块 / ${hit.meta.available}/${hit.meta.docCount} 篇可用（缓存）`, 0)
      return hit
    }

    const docNode = (d: any) => {
      const file = normalizeFileId(d.file)
      const fm = FILES.get(file) || { file, dir: 'references', kind: 'doc', title: file, desc: '', moduleId: '' }
      const st = statOf(indexMap, file)
      return {
        file,
        title: d.title || fm.title,
        desc: d.desc || '',
        chars: st.chars, tables: st.tables, formulas: st.formulas, sections: st.sections,
        present: st.present,
      }
    }

    const modules = (META.modules || []).map((m: any) => ({
      id: m.id, label: m.label, icon: m.icon, color: m.color,
      weight: num(m.weight), targetMinutes: num(m.targetMinutes), targetQuestions: num(m.targetQuestions),
      docs: (m.docs || []).map(docNode),
      examples: (m.examples || []).map(docNode),
    }))
    const strategy = (META.strategy || []).map(docNode)
    const examples = (META.examples || []).map(docNode)

    const presentCount = DECLARED_IDS.filter(id => indexMap.has(id)).length
    const missing = DECLARED_IDS.filter(id => !indexMap.has(id))

    const value = {
      meta: {
        id: META.id,
        label: META.label,
        version: CAPABILITIES.plugin.version,
        upstream: META.upstream,
        attestation: META.attestation,
        // docCount = META 声明篇数（契约硬要求 25）；磁盘可用性看 available/missing
        docCount: DECLARED_IDS.length,
        declaredByAdapter: HUASHENG13_CORPUS_COUNT,
        available: presentCount,
        missingCount: missing.length,
        missing,
        builtAt: slot.idx ? num(slot.idx.builtAt) : 0,
        indexedAt: slot.at,
        indexSource: slot.idx ? String(slot.idx.source || '') : 'none',
        buildMs: slot.idx ? num(slot.idx.buildMs) : 0,
        fixtureHash: slot.idx ? String(slot.idx.fixtureHash || '') : '',
        degraded: slot.degraded,
        error: slot.error || '',
        root: String(META.root || 'huasheng13'),
        // 白盒：声明目录与磁盘实际目录不一致的条目（zhenti-shili 落在 references 的已知偏差）
        dirMismatch: slot.idx && Array.isArray(slot.idx.dirMismatch) ? slot.idx.dirMismatch : [],
        orphans: slot.idx && Array.isArray(slot.idx.orphans) ? slot.idx.orphans : [],
      },
      modules,
      strategy,
      examples,
    }
    note(c, 'catalog', `${modules.length} 模块 / ${value.meta.available}/${value.meta.docCount} 篇可用`, 0)
    catalogCache = { key, value }
    return value
  }

  // ══ doc：单篇全文 ══
  function apiDoc(params: any, c: WsCounter): any {
    const raw = qget(params, 'file')
    if (!raw) {
      return {
        error: '缺少 file 参数', file: '',
        hint: '示例：/api/huasheng13/doc?file=ziliao-fenxi',
        known: DECLARED_IDS,
      }
    }
    const id = normalizeFileId(raw)
    const fm = FILES.get(id)
    if (!fm) return { error: `未知语料文件: ${raw}`, file: id, known: DECLARED_IDS }

    // 优先用索引里的解析产物（含 text/sections/weight），避免重复读盘
    const slot = ensureIndex()
    const idxDoc = docMapOf(slot).get(id)
    let parsed: any = idxDoc || null
    let absPath = idxDoc && idxDoc.path ? String(idxDoc.path) : ''

    if (!parsed) {
      // 索引降级/未收录 → 走磁盘兜底解析（目录偏差由 candidateDirs 处理）
      const p = resolveCorpusPath(fm)
      if (!p) {
        note(c, 'doc', `${fm.file} (语料缺失)`, 0)
        return {
          error: `语料文件缺失：${fm.dir}/${fm.file}.md（请到「📦 题库管理」重装 huasheng13）`,
          file: fm.file, title: fm.title, moduleId: fm.moduleId, degraded: true,
        }
      }
      absPath = p
      try {
        parsed = parseDoc(p)
      } catch (e: any) {
        note(c, 'doc', `${fm.file} (解析失败)`, 0)
        return { error: `语料解析失败：${e && e.message ? e.message : String(e)}`, file: fm.file, degraded: true }
      }
      if (!parsed) {
        note(c, 'doc', `${fm.file} (解析为空)`, 0)
        return { error: `语料解析为空：${fm.dir}/${fm.file}.md`, file: fm.file, degraded: true }
      }
    }

    c.docs[fm.file] = (c.docs[fm.file] || 0) + 1
    note(c, 'doc', fm.file, 0)
    const markdown = String(parsed.text || '')
    const sections = Array.isArray(parsed.sections) ? parsed.sections : []
    return {
      file: fm.file,
      title: parsed.title || fm.title,
      moduleId: fm.moduleId,
      kind: parsed.kind || fm.kind,
      desc: fm.desc,
      // html 字段留空由 client 用零依赖轻量渲染（不服务端注入 HTML，避免 XSS 面）
      markdown,
      chars: num(parsed.chars) || markdown.length,
      tables: num(parsed.tables),
      formulas: num(parsed.formulas),
      sections: slimSections(sections),
      sectionCount: num(parsed.sectionCount) || sections.length,
      weight: round2(num(parsed.weight) || 1),
      path: parsed.rel ? String(parsed.rel) : (absPath ? fm.dir + '/' + fm.file + '.md' : ''),
      degraded: false,
    }
  }

  // ══ search：BM25 全文检索 ══
  /**
   * 检索结果的收尾过滤（**只做尾部裁剪，绝不改 BM25 排序、不淘汰命中的首条**）。
   *
   * 为什么需要这一道（实测数据驱动，见下方常量注释）：
   *   中文 bigram 的固有特性是「任何汉字串都会产出 bigram」，虚词（的/如果/所以）会撞上
   *   高频 bigram 拿到 2~5 分，于是「查了个不存在的词也返回 10 条」在白盒面板上观感很差。
   *   但**原始分数不能当判据**——实测真实短查询反而更低：
   *     「数量」top=1.68、「判断」top=2.11（真实模块名）vs「不存在的词」top=4.79（噪声）
   *   所以只用相对阈值（相对 top 的 15%）裁掉长尾，并给每条结果标注相关性置信度，
   *   把「这条到底像不像真命中」的判断权交给 UI/调用方，而不是在服务端硬杀结果。
   *
   * 判据（两层，互不干扰）：
   *   1. 尾部裁剪：score < max(ABS_FLOOR, topScore × REL_CUT) 的尾部丢弃
   *      —— 实测对 18 个真实查询（单字/双字/整句/英文缩写）**top-1 全部不变**，
   *         仅削掉明显离群的长尾（如「隔板法」10 条 → 2 条）。
   *   2. 置信度：bestCoverage = 单篇文档覆盖查询 token 的最大比例。
   *      全 token 覆盖 = 查询词确实整体出现在某篇语料里 → high；否则 low（UI 可加提示）。
   */
  const SEARCH_ABS_FLOOR = 1.0     // 绝对下限：低于此分基本是单字/虚词噪声
  const SEARCH_REL_CUT = 0.15      // 相对下限：低于 top 的 15% 视为长尾

  /** 去空白归一表（每代索引只算一次）：判定「查询整串是否真的出现在某篇语料里」 */
  let normTextCache: { key: string; map: Map<string, string> } = null
  function normTexts(slot: IndexSlot): Map<string, string> {
    const docs = docsOf(slot.idx)
    const key = `${slot.idx ? slot.idx.builtAt : 0}|${docs.length}`
    if (normTextCache && normTextCache.key === key) return normTextCache.map
    const map = new Map<string, string>()
    for (const d of docs) {
      const id = normalizeFileId(d.file ?? d.id)
      if (id) map.set(id, String(d.text || '').replace(/[\s\u3000]+/g, ''))
    }
    normTextCache = { key, map }
    return map
  }

  /** 单篇文档覆盖查询 token 的最大比例（0~1）。O(候选词 × 25 篇)，量级极小 */
  function bestTokenCoverage(idx: any, q: string): number {
    try {
      const terms = Array.from(new Set(tokenize(q)))
      if (!terms.length) return 0
      let best = 0
      for (const d of docsOf(idx)) {
        const tf = d && d.tf
        if (!tf || typeof tf !== 'object') continue
        let hit = 0
        for (const t of terms) if (tf[t] > 0) hit++
        const cov = hit / terms.length
        if (cov > best) best = cov
        if (best === 1) break          // 已满分，无需继续扫
      }
      return round4(best)
    } catch {
      return 0
    }
  }

  /**
   * 相关性置信度三档（**提示性信号，绝不用于丢弃结果**）：
   *   high   —— 查询整串（去空白）真的出现在某篇语料里：这就是精确命中，哪怕查询词是
   *             「如果」这类虚词，文档里确实有它，返回它是对的（不该被当成假阳性）。
   *   medium —— 查询全部 token 在同一篇里共现，但整串不相邻：模糊但指向明确。
   *   low    —— 只有部分 token 命中：中文 bigram 的固有噪声（如「不存在的词」被拆成
   *             「不存/存在/在的/的词」命中）。UI 可据此提示「无精确匹配」。
   */
  function relevanceOf(slot: IndexSlot, q: string, coverage: number, topScore: number): { level: string; phraseHit: boolean } {
    let phraseHit = false
    try {
      const hay = q.replace(/[\s\u3000]+/g, '')
      if (hay && slot.idx) {
        for (const text of normTexts(slot).values()) {
          if (text.includes(hay)) { phraseHit = true; break }
        }
      }
    } catch { phraseHit = false }
    const scoreOk = topScore >= SEARCH_ABS_FLOOR
    let level = 'low'
    if (phraseHit && scoreOk) level = 'high'
    else if (coverage >= 1 && scoreOk) level = 'medium'
    return { level, phraseHit }
  }

  function apiSearch(params: any, c: WsCounter): any {
    const q = qget(params, 'q').trim()
    const limit = clampInt(qget(params, 'limit'), 10, 1, 30)
    // 空查询不是「未命中」，不进搜索命中率分母（仍记链路事件，白盒能看到空查行为）
    if (!q) {
      c.searches.empty++
      note(c, 'search', '(空查询：未检索任何语料)', 0)
      return { query: '', took: 0, limit, total: 0, results: [] }
    }
    const slot = ensureIndex()
    if (slot.degraded && !slot.idx) {
      c.searches.total++
      c.searches.miss++
      note(c, 'search', `${q} (语料缺失，降级)`, 0)
      return { query: q, took: 0, limit, total: 0, results: [], degraded: true, error: slot.error }
    }
    const t0 = process.hrtime.bigint()
    let results: any[] = []
    let err = ''
    try {
      // 先取比 limit 更多的候选（尾部裁剪后仍能填满 limit）
      const r = hs13Search(slot.idx, q, { limit: Math.min(limit * 3, 100) })
      results = Array.isArray(r) ? r : []
    } catch (e: any) {
      err = e && e.message ? e.message : String(e)
    }
    const took = round2(Number(process.hrtime.bigint() - t0) / 1e6)

    // 尾部裁剪：保住首条，只削相对离群的长尾（真实查询 top-1 恒定不受影响）
    const rawCount = results.length
    if (results.length > 1) {
      const top = num(results[0].score)
      const floor = Math.max(SEARCH_ABS_FLOOR, top * SEARCH_REL_CUT)
      results = results.filter((r, i) => i === 0 || num(r.score) >= floor)
    }
    const coverage = slot.idx ? bestTokenCoverage(slot.idx, q) : 0
    const topScore = results.length ? num(results[0].score) : 0
    // 相关性置信度：整串命中 > 全 token 共现 > 仅部分 token（详见 relevanceOf 注释）
    const rel = slot.idx
      ? relevanceOf(slot, q, coverage, topScore)
      : { level: 'low', phraseHit: false }
    results = results.slice(0, limit)

    c.searches.total++
    if (results.length) c.searches.hit++
    else c.searches.miss++
    note(c, 'search', `${q} → ${results.length}/${rawCount} 条 (${rel.level})`, took)

    const out: any = {
      query: q,
      took,
      limit,
      total: results.length,
      // 白盒：裁剪前候选数 + 相关性置信度（UI 可据此提示「未找到精确匹配」）
      rawTotal: rawCount,
      filtered: rawCount - results.length,
      confidence: rel.level,
      coverage,
      // 查询整串是否真的落在某篇语料里（high 的充分条件，也是「不是假阳性」的直接证据）
      phraseHit: rel.phraseHit,
      results: results.map(r => ({
        file: r.file,
        title: r.title,
        score: round4(r.score),
        highlight: String(r.highlight || ''),
        snippets: Array.isArray(r.snippets) ? r.snippets : [],
        terms: Array.isArray(r.terms) ? r.terms : [],
        moduleId: r.moduleId || (FILES.get(normalizeFileId(r.file)) || ({} as any)).moduleId || '',
        kind: r.kind || '',
        weight: round2(num(r.weight) || 1),
      })),
    }
    if (err) {
      out.error = `检索失败：${err}`
      out.degraded = true
    } else if (slot.degraded) {
      out.degraded = true
      out.error = slot.error
    } else if (!results.length) {
      out.note = '未找到匹配语料（中文 bigram 检索对纯虚词/生造词召回不稳定，建议改用具体考点术语）'
    } else if (rel.level === 'low') {
      out.note = '仅有部分查询词命中：中文 bigram 会把生造词拆成常见双字，结果可能不相关'
    }
    return out
  }

  // ══ coverage：六模块覆盖矩阵 + 缺口 ══
  function apiCoverage(force: boolean, c: WsCounter): any {
    const slot = ensureIndex(force)
    let raw: any = null
    let err = slot.error
    if (slot.idx) {
      try {
        raw = coverageMatrix(slot.idx)
      } catch (e: any) {
        err = `覆盖矩阵计算失败：${e && e.message ? e.message : String(e)}`
      }
    }
    const provided: any[] = Array.isArray(raw && raw.modules) ? raw.modules : []
    const byId = new Map<string, any>()
    for (const m of provided) if (m && m.id) byId.set(String(m.id), m)

    // 以 META 六模块为骨架：D1 漏算的模块补零而不是消失（六模块全覆盖是契约）
    const modules = (META.modules || []).map((m: any) => {
      const s = byId.get(m.id) || {}
      return {
        id: m.id,
        label: m.label,
        icon: m.icon,
        color: m.color,
        weight: num(m.weight),
        targetMinutes: num(m.targetMinutes),
        targetQuestions: num(m.targetQuestions),
        docCount: num(s.docCount) || (m.docs || []).length,
        presentDocs: num(s.presentDocs),
        examples: num(s.examples),
        tables: num(s.tables),
        formulas: num(s.formulas),
        chars: num(s.chars),
        coverage: round4(clamp01(s.coverage)),
        // 维度口径透传（D1 的 dims 决定分母是否计入某维度：常识/申论不考公式）
        dims: s.dims && typeof s.dims === 'object'
          ? { formula: !!s.dims.formula, table: !!s.dims.table, example: !!s.dims.example }
          : { formula: true, table: true, example: true },
        expectedDims: num(s.expectedDims),
        presentDims: num(s.presentDims),
        missing: Array.isArray(s.missing) ? s.missing.map((x: any) => String(x)) : [],
        files: Array.isArray(s.files) ? s.files : (m.docs || []).map((d: any) => normalizeFileId(d.file)),
      }
    })

    const mean = modules.length ? modules.reduce((a: number, x: any) => a + x.coverage, 0) / modules.length : 0
    const overall = round4(clamp01(raw && raw.overall != null ? raw.overall : mean))

    // 缺口：结构化 + 中文可读（D1 的 module.missing 已是「文件 缺什么」粒度，直接抬升成 gaps[]）
    const gaps: any[] = []
    for (const m of modules) {
      const src = byId.get(m.id)
      const miss: string[] = src && Array.isArray(src.missing) ? src.missing.map((x: any) => String(x)) : []
      for (const detail of miss) gaps.push({ module: m.id, label: m.label, kind: 'dimension', detail })
      if (!m.presentDocs) {
        gaps.push({ module: m.id, label: m.label, kind: 'no-corpus', detail: '该模块语料全部缺失（磁盘未命中任何一篇）' })
      }
      if (!m.examples) {
        gaps.push({ module: m.id, label: m.label, kind: 'no-example', detail: '缺配套练习文件（覆盖维度 −1）' })
      }
    }

    note(c, 'coverage', `overall=${overall} gaps=${gaps.length}`, 0)
    const out: any = {
      modules,
      overall,
      gaps,
      // 白盒核对字段：期望维度 vs 实际维度（口径 = docCount × 3）
      expectedDims: num(raw && raw.expectedDims),
      presentDims: num(raw && raw.presentDims),
      adapterGaps: Array.isArray(raw && raw.gaps) ? raw.gaps : [],
      degraded: slot.degraded,
    }
    if (err) out.error = err
    return out
  }

  /** 练习条目：保留 D1 的 options [{key,text}] 形状（client 判分需要 key） */
  function slimPractice(it: any, i: number): any {
    if (!it || typeof it !== 'object') {
      return {
        index: i + 1, title: '', heading: '', level: 2, category: '', stem: '',
        options: [], analysis: '', answer: '', answerIsLetter: false, pitfalls: '',
        startLine: 0, endLine: 0,
      }
    }
    const options = Array.isArray(it.options)
      ? it.options.map((o: any) => (o && typeof o === 'object'
        ? { key: String(o.key || ''), text: String(o.text || '') }
        : { key: '', text: String(o) }))
      : []
    return {
      index: num(it.index) || i + 1,
      title: String(it.title || ''),
      heading: String(it.heading || ''),
      level: num(it.level) || 2,
      category: String(it.category || ''),
      stem: String(it.stem || ''),
      options,
      analysis: String(it.analysis || ''),
      answer: String(it.answer || ''),
      // 自动判分可行性：仅 A-D 字母形态答案才可本地比对（否则只能看解析）
      answerIsLetter: typeof it.answerIsLetter === 'boolean' ? it.answerIsLetter : /^[A-D]$/i.test(String(it.answer || '').trim()),
      pitfalls: String(it.pitfalls || ''),
      startLine: num(it.startLine),
      endLine: num(it.endLine),
    }
  }

  // ══ practice：配套练习抽取 ══
  function apiPractice(params: any, c: WsCounter): any {
    const raw = qget(params, 'file')
    if (!raw) {
      return {
        error: '缺少 file 参数', file: '',
        hint: '示例：/api/huasheng13/practice?file=ziliao-lianxi',
        known: DECLARED_IDS,
      }
    }
    const id = normalizeFileId(raw)
    const fm = FILES.get(id)
    if (!fm) return { error: `未知语料文件: ${raw}`, file: id, known: DECLARED_IDS }

    const n = clampInt(qget(params, 'n'), 5, 1, 50)
    const abs = resolveCorpusPath(fm)
    if (!abs) {
      note(c, 'practice', `${fm.file} (语料缺失)`, 0)
      return {
        error: `语料文件缺失：${fm.dir}/${fm.file}.md`, file: fm.file,
        title: fm.title, total: 0, n, returned: 0, hasMore: false, items: [], degraded: true,
      }
    }
    let all: any[] = []
    let err = ''
    try {
      const r = parsePractice(abs)
      all = Array.isArray(r) ? r : []
    } catch (e: any) {
      err = e && e.message ? e.message : String(e)
    }
    // 确定性截取（不随机）：同输入必得同输出，测试与复盘都可复现
    const items = all.slice(0, n).map(slimPractice)
    note(c, 'practice', `${fm.file} → ${items.length}/${all.length} 题`, 0)
    const out: any = {
      file: fm.file, title: fm.title, moduleId: fm.moduleId,
      total: all.length,
      // n 是「本次抽取上限」（默认 5），不是「文件里共几题」——total 才是题库总量。
      // 显式给 hasMore/returned，消费方不必自己拿 total 和 n 比（避免误读为「返回不全」）。
      n,
      returned: items.length,
      hasMore: all.length > items.length,
      items,
      degraded: false,
    }
    if (err) {
      out.error = `练习题解析失败：${err}`
      out.degraded = true
    } else if (!all.length) {
      // panduan-lianxi / yanyu-lianxi 用「## 一、图形推理」这类分类标题，按契约不构成练习题
      out.note = '该语料未包含「## 练习 N」形式的练习块（分类标题不计为单题）'
    }
    return out
  }

  // ══ trace：本域白盒链路（真实计数，禁止伪造）══
  function apiTrace(c: WsCounter, wsKey: string): any {
    const endpoints: Record<string, any> = {}
    for (const p of HS13_ENDPOINTS) {
      const e = c.endpoints[p] || { hits: 0, lat: [], lastAt: 0 }
      const sorted = e.lat.slice().sort((a, b) => a - b)
      endpoints[p] = {
        hits: e.hits,
        p50: round2(percentile(sorted, 50)),
        p95: round2(percentile(sorted, 95)),
        lastAt: e.lastAt || 0,
        samples: e.lat.length,
      }
    }
    const s = c.searches
    // 声明对账：路由表 ↔ CAPABILITIES.endpoints（v1.8 假阳性事故的固化守卫）
    const declaredSet = new Set((CAPABILITIES.endpoints || []).map((x: any) => x.path))
    const declaration = HS13_ENDPOINTS.map(p => ({ path: p, declared: declaredSet.has(p) }))

    return {
      ws: wsKey,
      endpoints,
      searches: {
        total: s.total,
        hit: s.hit,
        miss: s.miss,
        empty: s.empty,
        hitRate: s.total ? round4(s.hit / s.total) : 0,
      },
      docs: { reads: { ...c.docs }, distinct: Object.keys(c.docs).length },
      recent: c.recent.slice(-TRACE_RECENT),
      ring: {
        recentCap: RECENT_RING, recentLen: c.recent.length,
        latCap: LAT_RING, slotsCap: WS_SLOT_LIMIT, slots: wsSlots.size,
      },
      declaration: {
        endpoints: declaration,
        allDeclared: declaration.every(d => d.declared),
        declaredTotal: declaredSet.size,
      },
      corpus: {
        root: corpusDir,
        rootRel: String(META.root || 'huasheng13'),
        dirPresent: existsSync(corpusDir),
        snapshot: join(dataDir, '.huasheng13-index.json'),
        snapshotPresent: existsSync(join(dataDir, '.huasheng13-index.json')),
        indexed: !!idxSlot,
        degraded: idxSlot ? idxSlot.degraded : null,
        builtAt: idxSlot && idxSlot.idx ? num(idxSlot.idx.builtAt) : 0,
        source: idxSlot && idxSlot.idx ? String(idxSlot.idx.source || '') : 'none',
        buildMs: idxSlot && idxSlot.idx ? num(idxSlot.idx.buildMs) : 0,
        error: idxSlot ? idxSlot.error : '',
        // cycle-30（T-031 清偿）：语料更新提示——磁盘目录 mtime 探测（题库管理 pull 后
        // 语料文件 mtime 会刷新）+ 上游 repo 信息，方法论视图据此显示「语料版本/更新时间」
        // 与「去题库管理更新」入口链接（不重复造安装器，T-031 硬门槛）。
        diskMtime: (() => { try { return statSync(corpusDir).mtimeMs } catch { return 0 } })(),
        upstream: String(META.upstream || ''),
        updateHint: (() => {
          try {
            const st = statSync(corpusDir)
            const ageDays = Math.floor((Date.now() - st.mtimeMs) / 86400000)
            return {
              lastChangedDaysAgo: ageDays,
              lastChangedAt: new Date(st.mtimeMs).toISOString().slice(0, 10),
              stale: ageDays > 30,
            }
          } catch { return null }
        })(),
      },
      at: Date.now(),
    }
  }

  // ── 路由（只在本域命中的路径上被调用）──
  function route(path: string, params: any, c: WsCounter, wsKey: string): any {
    const refresh = qget(params, 'refresh') === '1'
    if (path === EP_CATALOG) return buildCatalog(refresh, c)
    if (path === EP_DOC) return apiDoc(params, c)
    if (path === EP_SEARCH) return apiSearch(params, c)
    if (path === EP_COVERAGE) return apiCoverage(refresh, c)
    if (path === EP_PRACTICE) return apiPractice(params, c)
    return apiTrace(c, wsKey)
  }

  /** ws 归一：优先用 ws.ts 的 store.wsKey（slug-hash8），缺失时退化为原串 */
  function wsKeyOf(raw: any): string {
    try {
      if (store && typeof store.wsKey === 'function') return String(store.wsKey(raw))
    } catch { /* store 异常不影响端点可用性 */ }
    const s = String(raw == null ? '' : raw).trim()
    return s || 'default'
  }

  /**
   * 域入口（同步）：返回业务对象即接管；返回 undefined 表示非本域，交给下游域。
   * 任何内部异常都收敛为 { error }（HTTP 200），绝不冒泡。
   */
  function handle(path: any, params: any, post: any, method: any, wsRaw?: any): any {
    const p = typeof path === 'string' ? path : ''
    if (p !== EP_CATALOG && p !== EP_DOC && p !== EP_SEARCH && p !== EP_COVERAGE && p !== EP_PRACTICE && p !== EP_TRACE) {
      return undefined
    }
    const wsKey = wsKeyOf(wsRaw)
    const c = getCounter(wsKey)
    const t0 = process.hrtime.bigint()       // 高精度：亚毫秒端点不应被记成 0ms
    const startedAt = Date.now()
    const ep = (c.endpoints[p] = c.endpoints[p] || { hits: 0, lat: [], lastAt: 0 })
    ep.hits++                                 // 先自增：trace 自身也要体现「本次调用已计入」
    ep.lastAt = startedAt

    let out: any
    try {
      const m = String(method || 'GET').toUpperCase()
      if (m !== 'GET') {
        out = { error: `方法论端点仅支持 GET（收到 ${m}）`, path: p }
      } else {
        out = route(p, params, c, wsKey)
      }
    } catch (e: any) {
      // 兜底收敛：任何未预期异常都不许冒泡（cycle-0 uncaughtException 教训）
      const msg = e && e.message ? e.message : String(e)
      out = { error: `方法论域内部错误：${msg}`, path: p, degraded: true }
      note(c, 'error', `${p} ${msg}`, 0)
    }

    const ms = round2(Number(process.hrtime.bigint() - t0) / 1e6)
    ep.lat.push(ms)
    if (ep.lat.length > LAT_RING) ep.lat.splice(0, ep.lat.length - LAT_RING)
    return out
  }

  return { handle, endpoints: HS13_ENDPOINTS, corpusDir }
}
