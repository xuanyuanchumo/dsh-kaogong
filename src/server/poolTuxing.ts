/**
 * server/poolTuxing.ts — 图形推理统一读层（cycle-60 T-038 无损换源）
 *
 * ── 为什么需要这层 ──
 *   `/api/tuxing/*` 长期直读 gk-tuxing/assets/data.js（window.QDATA），违反「只维护
 *   .kaogong.db」纪律。cycle-60 T-038 把每题的**完整上游对象**写入 question.source_extras
 *   （通用 JSON 列），本层从池重建与 adapters/tuxing.ts **逐字段同形**的 TuxingQuestion，
 *   供 tuxingApi 在新鲜度门通过时切源；旧库/未 rebuild 时回落 data.js。
 *
 * ── 无损纪律 ──
 *   上游每题字段 {id, g, n, img, src, cat, fmt, ans, exp, acc, trap}：
 *     · cat 代码 / fmt / acc / trap / g / n 在 source_extras 里**原样保留**；
 *     · rule_type 是中文分类名（见 CAT_NAMES）——旧库无 extras 时反查回代码；
 *     · images/paper/answer/analysis 作为无 extras 时的兜底来源（诚实降级，不臆造）。
 *   图片二进制端点维持直读磁盘（有正当理由：图片不入池，内容寻址引用——L3 不做）。
 */
import { poolDb } from '../adapters/poolDb.js'
import { CAT_NAMES } from '../adapters/tuxing.js'

/** 中文分类名 → cat 代码（rule_type 的反向索引；extras 优先，此表仅旧库兜底） */
const CAT_CODES: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [code, name] of Object.entries(CAT_NAMES)) m[name] = code
  return m
})()

/** 安全 JSON 解析（畸形/缺失 → 空对象，不抛） */
function parseObj(s: any): any {
  try {
    const v = typeof s === 'string' && s ? JSON.parse(s) : s
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}

/** 安全 JSON 数组解析（images 等数组字段；畸形/缺失 → 空数组，不抛） */
function parseArr(s: any): any[] {
  try {
    const v = typeof s === 'string' && s ? JSON.parse(s) : s
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

/**
 * 池题行 → 图形推理同形题（与 tuxing.ts loadAll 的 TuxingQuestion 逐字段对齐）。
 * 纯函数、零 DB 依赖：单测可直接喂 mock 行验证无损字段映射。
 */
export function poolRowToTuxing(r: any): any {
  const ex = parseObj(r?.source_extras)
  const imgList: any[] = parseArr(r?.images)
  const img = String(ex.img ?? (imgList[0] && (imgList[0].relPath || imgList[0].path)) ?? '').trim()
  const ruleType = String(r?.rule_type ?? '').trim()
  // cat 代码：extras 原样 > rule_type 本身是代码 > 中文名反查
  const cat = String(ex.cat ?? '').trim()
    || (CAT_NAMES[ruleType] ? ruleType : (CAT_CODES[ruleType] || ''))
  // catName 显示名：rule_type（中文或旧码）> cat 代码查表 > 其他（与 tuxing.ts 同口径）
  const catName = CAT_NAMES[ruleType] || ruleType || CAT_NAMES[cat] || '其他'
  return {
    id: String(ex.id ?? r?.qid ?? ''),
    group: String(ex.g ?? ''),
    no: Number(ex.n ?? 0) || 0,
    img,
    src: String(ex.src ?? r?.paper ?? ''),
    cat,
    catName,
    fmt: String(ex.fmt ?? ''),
    ans: String(ex.ans ?? r?.answer ?? '').toUpperCase(),
    exp: String(ex.exp ?? r?.analysis ?? ''),
    acc: String(ex.acc ?? ''),
    trap: String(ex.trap ?? ''),
  }
}

/** 图片 URL（与 tuxing.ts 完全一致；二进制仍由 serveImage 直读磁盘） */
function imgUrlOf(q: any): string {
  return '/kaogong/api/tuxing-img?p=' + encodeURIComponent(q.img)
}

/** 增补派生字段（source + imgUrl）→ 与 tuxingQuestions/tuxingQuestion 的输出同形 */
function decorate(q: any): any {
  return { ...q, source: 'gk-tuxing', imgUrl: imgUrlOf(q) }
}

/** 安全查询（失败 → 空数组，绝不抛） */
function rows(db: any): any[] {
  if (!db) return []
  try { return db.prepare("SELECT * FROM question WHERE source_id='gk-tuxing'").all() as any[] } catch { return [] }
}

/**
 * 全部题（确定性顺序）：按上游组(g) → 序号(n) → id 排，与 data.js 原始顺序一致。
 * 354 题规模，每次请求重建即可（无跨请求可变状态——R7 纪律）。
 */
function all(db: any): any[] {
  const list = rows(db).map(poolRowToTuxing)
  list.sort((a, b) => {
    const ga = String(a.group || ''), gb = String(b.group || '')
    if (ga !== gb) return ga < gb ? -1 : 1
    if (Number(a.no) !== Number(b.no)) return Number(a.no) - Number(b.no)
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
  })
  return list
}

/**
 * 图形推理统一池读层。
 * @param dbOverride 可选 mock DB（单测注入）；缺省用模块级 poolDb()（运行期）。
 */
export function makePoolTuxingReader(dbOverride?: any) {
  const database = () => dbOverride || poolDb()
  function ready(): boolean { return rows(database()).length > 0 }
  function cats(): any[] {
    const map = new Map<string, number>()
    for (const q of all(database())) {
      const c = String(q.cat || '')
      if (c) map.set(c, (map.get(c) || 0) + 1)
    }
    return [...map.entries()]
      .map(([cat, count]) => ({ cat, name: CAT_NAMES[cat] || '其他', count }))
      .sort((a, b) => b.count - a.count || (a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : 0))
  }
  function questions(opts: { cat?: string, limit?: number, offset?: number } = {}): any {
    const src = opts.cat ? all(database()).filter(q => q.cat === opts.cat) : all(database())
    const offset = Math.max(0, opts.offset || 0)
    const limit = Math.min(50, opts.limit || 10)
    const slice = src.slice(offset, offset + limit)
    return { total: src.length, offset, count: slice.length, questions: slice.map(decorate) }
  }
  function question(id: string): any {
    const q = all(database()).find(x => x.id === id)
    if (!q) return { error: '题目不存在: ' + id }
    return decorate(q)
  }
  return { ready, cats, questions, question }
}

export type PoolTuxingReader = ReturnType<typeof makePoolTuxingReader>
