/**
 * server/poolNaoku.ts — 深度题库统一读层（cycle-60 R2 起 · cycle-61 v9 收口为唯一读路径）
 *
 * ── 定位 ──
 *   `/api/naoku/*` 六端点的**唯一数据源**。v9 起不再有「回落 `.naoku.db`」分支：
 *   `.naoku.db` 只作为适配层的摄入输入（poolSourceImpls.ingestNaokuSource），
 *   运行期一律经本层读 `.kaogong.db`（I-DB-1）。
 *
 * ── 口径纪律 ──
 *   所有查询强制 source_id='naoku' 过滤，保持「深度题库」既有口径（池 86534 题 /
 *   naoku 主行 26525），换源后 UI 不会突然显示全池数量。
 *   字段映射与 poolRowToQuestion 同源（options 归一 / answer→correctAnswer / dims / images）。
 */
import { poolDb } from '../adapters/poolDb.js'
import { computeFreshness } from './poolObservability.js'

/**
 * 整库数据质量门（仍有独立用途：白盒提示「旧库建议重建」）。
 * ⚠️ 与 dataGate.domainReady 分工不同——本函数判「数据质量是否达基线」，
 * domainReady 判「该域数据在不在库里」。**运行期读路径不再使用本函数做门控**
 * （v9 起读路径只有「库内有数据」这一个条件）。
 */
export function poolFresh(): boolean {
  try {
    return !!computeFreshness(poolDb()).ready
  } catch { return false }
}

/** 安全标量查询 */
function q1(db: any, sql: string, ...args: any[]): any {
  try { return db.prepare(sql).get(...args) } catch { return null }
}
function q(db: any, sql: string, ...args: any[]): any[] {
  try { return db.prepare(sql).all(...args) as any[] } catch { return [] }
}

/** 题行 → 深度题库同形题目（与 naokuQuestions 输出对齐，供 /api/naoku/questions|practice 消费） */
export function poolRowToNaoku(r: any): any {
  let options: any = r.options
  try { if (typeof options === 'string') options = JSON.parse(options) } catch { options = {} }
  let images: any[] = []
  try { if (typeof r.images === 'string' && r.images) images = JSON.parse(r.images) } catch { images = [] }
  return {
    id: 'naoku-' + String(r.id || ''),
    qid: r.qid || '',
    /**
     * 题号 + 材料（cycle-62 七段修复）：原映射缺 `no`/`number`/`groupMaterial`，
     * 而渲染层读 `q.no`（题号）与 `q.groupMaterial`（材料）——
     * 深度题库/按考点刷题的题目因此题号显示 `?`、材料整段丢失。
     * `no` 与 `number` 同取卷内序号（`seq`），无则 0（渲染层按位置号兜底，不臆造）。
     */
    no: Number(r.seq || 0) || 0,
    number: Number(r.seq || 0) || 0,
    module: r.module || '',
    category: r.category || '',
    kadian: r.kadian || '',
    region: r.region || '',
    year: r.year || '',
    paper: r.paper || '',
    stem: r.stem || '',
    options: options || {},
    answer: r.answer || '',
    correctAnswer: r.answer || '',
    analysis: r.analysis || '',
    reasoning: r.reasoning || '',
    fastest: r.fastest || '',
    pitfalls: r.pitfalls || '',
    mother: r.mother || '',
    material: r.group_material || '',
    groupMaterial: r.group_material || '',
    groupMaterialNo: Number(r.group_material_no || 0),
    materialRef: r.material_ref || '',
    has_image: r.has_image || 0,
    imgRefs: images,
    qtype: r.qtype || '',
    source: 'naoku',
  }
}

/** 统一池深度题库查询（naokuApi 的唯一数据源——v9 起无回落分支） */
export function makePoolNaokuReader() {
  /** 池内是否已有深度题库数据（供 naokuApi 判定「读到了但为空」） */
  function ready(): boolean {
    const db = poolDb()
    if (!db) return false
    const r = q1(db, "SELECT COUNT(*) c FROM question WHERE source_id='naoku'")
    return Number((r && r.c) || 0) > 0
  }

  function status(): any {
    const db = poolDb()
    if (!db) return null
    const st = q1(db, `SELECT COUNT(*) total,
      SUM(CASE WHEN LENGTH(kadian)>0 THEN 1 ELSE 0 END) kadian,
      SUM(CASE WHEN LENGTH(reasoning)>0 THEN 1 ELSE 0 END) reasoning,
      SUM(CASE WHEN LENGTH(fastest)>0 THEN 1 ELSE 0 END) fastest,
      SUM(CASE WHEN LENGTH(pitfalls)>0 THEN 1 ELSE 0 END) pitfalls,
      SUM(CASE WHEN has_image=1 THEN 1 ELSE 0 END) images
      FROM question WHERE source_id='naoku'`)
    if (!st) return null
    const mods = q(db, "SELECT module m, COUNT(*) c FROM question WHERE source_id='naoku' AND LENGTH(module)>0 GROUP BY module ORDER BY c DESC")
    return {
      total: Number(st.total || 0),
      kadian: Number(st.kadian || 0),
      reasoning: Number(st.reasoning || 0),
      fastest: Number(st.fastest || 0),
      pitfalls: Number(st.pitfalls || 0),
      images: Number(st.images || 0),
      modules: mods.map((r: any) => ({ module: r.m, count: Number(r.c) })),
      sourceTier: 'pool',
    }
  }

  function questions(opts: { module?: string, category?: string, kadian?: string, count?: number, random?: boolean }): any[] {
    const db = poolDb()
    if (!db) return []
    const where = ["source_id='naoku'"]
    const args: any[] = []
    if (opts.module) { where.push('module = ?'); args.push(opts.module) }
    if (opts.category) { where.push('category = ?'); args.push(opts.category) }
    if (opts.kadian) { where.push('(kadian = ? OR kadian LIKE ?)'); args.push(opts.kadian, '%' + opts.kadian + '%') }
    const order = opts.random === false ? 'id' : 'RANDOM()'
    const rows = q(db, `SELECT * FROM question WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, ...args, Math.min(100, Math.max(1, opts.count || 1)))
    return rows.map(poolRowToNaoku)
  }

  function kadian(query: string, limit = 20): any[] {
    const db = poolDb()
    if (!db || !query) return []
    return q(db,
      `SELECT kadian, category, module, COUNT(*) c FROM question
       WHERE source_id='naoku' AND kadian LIKE ? GROUP BY kadian, category, module
       ORDER BY c DESC LIMIT ?`, '%' + query + '%', Math.min(100, Math.max(1, limit)),
    ).map(r => ({ kadian: r.kadian, category: r.category, module: r.module, count: Number(r.c) }))
  }

  function papers(category: string, limit = 40): any[] {
    const db = poolDb()
    if (!db || !category) return []
    return q(db,
      `SELECT paper, region, year, COUNT(*) c FROM question
       WHERE source_id='naoku' AND category = ? AND LENGTH(paper) > 0
       GROUP BY paper, region, year ORDER BY c DESC LIMIT ?`, category, Math.min(100, Math.max(1, limit)),
    ).map(r => ({ paper: r.paper, region: r.region, year: r.year, count: Number(r.c) }))
  }

  function categories(limit = 40): any[] {
    const db = poolDb()
    if (!db) return []
    return q(db,
      `SELECT category k, COUNT(*) c FROM question
       WHERE source_id='naoku' AND LENGTH(category) > 0
       GROUP BY category ORDER BY c DESC LIMIT ?`, Math.min(100, Math.max(1, limit)),
    ).map(r => ({ k: r.k, count: Number(r.c) }))
  }

  return { ready, status, questions, kadian, papers, categories }
}

export type PoolNaokuReader = ReturnType<typeof makePoolNaokuReader>
