/**
 * server/poolPaper.ts — 真题卷统一读层（cycle-60 R8 换源）
 *
 * ── 定位 ──
 *   `/api/papers|paper|topics|essay/*|paper/exam/*` 长期直读 gwy-zhenti md（buildPaperIndex/
 *   loadPaper）。cycle-60 R6/R7 已把 1683 卷的卷级元数据、材料、题卷级字段入池
 *   （paper / paper_material / question 新列）。本层从池重建同形对象，供 paperApi 在
 *   新鲜度门通过时切源；旧库仍回落 md（避免未 rebuild 的库读到空数据）。
 *
 * ── 口径纪律 ──
 *   · shape 与 listPapers/loadPaper **逐字段对齐**（paperApi 与客户端零改动）；
 *   · 卷级标量以 paper 表为准（索引口径，含 province/relPath），nature 已合并入库；
 *   · questionCount 用 parsed_question_count（详情口径），question_count 供 facet；
 *   · 申论答案在 reference（correctAnswer 恒 null），消费方双源兜底（CLAUDE C30）。
 */
import { poolDb } from '../adapters/poolDb.js'

/**
 * cycle-60 R9：方法论参考从 knowledge 表读（替代 getMethodRef 的 md 直读）。
 * 摄入时 skill 文档以 kn_id='skill:<filename>' 入 knowledge（body 上限 64KB，比 20KB 文件读更全）。
 * @param fileName METHOD_MAP 解析出的文件名（如 xingce.md）
 */
export function poolGetMethodRef(topic: string, fileName: string): any {
  const db = poolDb()
  if (!db || !fileName) return null
  try {
    const knId = 'skill:' + String(fileName).replace(/\.md$/, '')
    const row = db.prepare('SELECT body, title, path FROM knowledge WHERE kn_id = ?').get(knId) as any
    if (!row) return null
    return { topic, file: fileName, content: String(row.body || ''), title: row.title || '', path: row.path || '', sourceTier: 'pool' }
  } catch { return null }
}

/** 卷列表（与 listPapers 同 shape：{papers,total,...}） */
export function poolListPapers(filters: any = {}): any {
  const db = poolDb()
  if (!db) return { papers: [], total: 0, subjects: [], provinces: [] }
  const where: string[] = []
  const args: any[] = []
  if (filters.subject) { where.push('subject = ?'); args.push(filters.subject) }
  if (filters.exam) { where.push('exam = ?'); args.push(filters.exam) }
  if (filters.year) { where.push('year = ?'); args.push(Number(filters.year)) }
  if (filters.province) { where.push('province = ?'); args.push(filters.province) }
  if (filters.q) { where.push('(paper_id LIKE ? OR subject LIKE ?)'); args.push('%' + filters.q + '%', '%' + filters.q + '%') }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
  let papers: any[] = []
  try {
    papers = db.prepare(`SELECT paper_id id, exam, region, province, year, subject, paper_type paperType,
      question_count questionCount, parsed_question_count parsedQuestionCount, image_count imageCount,
      verified, source, nature, rel_path relPath
      FROM paper ${w} ORDER BY year DESC, paper_id LIMIT 2000`).all(...args) as any[]
  } catch { papers = [] }
  // facet 从 paper 表派生（与 aggregateIndex 同口径，码点排序确定性）
  const bySubject = new Map<string, any>()
  const byProvince = new Map<string, any>()
  for (const p of papers) {
    const s = bySubject.get(p.subject) || { subject: p.subject, count: 0, questionTotal: 0, years: new Set<number>(), exams: new Set<string>() }
    s.count++; s.questionTotal += p.questionCount || 0
    if (p.year) s.years.add(Number(p.year)); if (p.exam) s.exams.add(p.exam)
    bySubject.set(p.subject, s)
    const pv = p.province || '未知'
    const pr = byProvince.get(pv) || { name: pv, total: 0, ys: [] as number[], subjCnt: {} as any }
    pr.total++; if (p.year) pr.ys.push(Number(p.year))
    pr.subjCnt[p.subject] = (pr.subjCnt[p.subject] || 0) + 1
    byProvince.set(pv, pr)
  }
  const subjects = [...bySubject.values()].map(s => ({
    subject: s.subject, count: s.count, questionTotal: s.questionTotal,
    years: [...s.years].sort((a, b) => b - a), exams: [...s.exams],
  })).sort((a, b) => b.count - a.count)
  const provinces = [...byProvince.values()].map(pr => ({
    name: pr.name, total: pr.total,
    minYear: pr.ys.length ? Math.min(...pr.ys) : null,
    maxYear: pr.ys.length ? Math.max(...pr.ys) : null,
    subjects: pr.subjCnt,
  })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  // verified 转布尔（loadPaper/listPapers 口径）；sourceTier 让白盒一眼看出数据来自池
  const out = papers.map(p => ({ ...p, verified: !!p.verified, sourceTier: 'pool' }))
  return { papers: out, total: out.length, subjects, provinces, sourceTier: 'pool' }
}

/** 单卷详情（与 loadPaper 同 shape：{id,exam,region,year,subject,...,materials,questions}） */
export function poolLoadPaper(paperId: string): any {
  const db = poolDb()
  if (!db) return { error: '统一池未就绪' }
  let meta: any
  try {
    meta = db.prepare(`SELECT paper_id id, exam, region, province, year, subject, paper_type paperType,
      question_count questionCount, parsed_question_count parsedQuestionCount, image_count imageCount,
      verified, source, nature, rel_path relPath
      FROM paper WHERE paper_id = ?`).get(paperId)
  } catch { meta = null }
  if (!meta) return { error: `试卷不存在: ${paperId}` }
  let materials: any[] = []
  try {
    materials = db.prepare(`SELECT no, title, body text FROM paper_material WHERE paper_id=? AND kind='s' ORDER BY no`).all(paperId) as any[]
  } catch { materials = [] }
  let rows: any[] = []
  try {
    rows = db.prepare(`SELECT q_no no, stem, options, answer correct_answer, analysis, score,
      requirement, reference, related_materials relatedMaterials, group_material groupMaterial,
      material_mid, qtype
      FROM question WHERE paper_id=? ORDER BY q_no`).all(paperId) as any[]
  } catch { rows = [] }
  const questions = rows.map(r => {
    let options: any = {}
    try { if (typeof r.options === 'string' && r.options) options = JSON.parse(r.options) } catch { options = {} }
    return {
      no: Number(r.no || 0), stem: String(r.stem || ''), type: String(r.qtype || ''), options,
      correctAnswer: String(r.correct_answer || ''),
      score: r.score == null ? null : Number(r.score),
      requirement: String(r.requirement || ''), relatedMaterials: String(r.relatedMaterials || ''),
      reference: String(r.reference || ''), analysis: String(r.analysis || ''),
      groupMaterial: String(r.groupMaterial || ''),
      groupMaterialNo: r.material_mid ? Number(String(r.material_mid).split(':').pop()) || 0 : 0,
    }
  })
  return {
    id: paperId, exam: String(meta.exam || ''), region: String(meta.region || ''),
    year: meta.year == null ? null : Number(meta.year), subject: String(meta.subject || ''),
    paperType: String(meta.paperType || ''), nature: String(meta.nature || ''), source: String(meta.source || ''),
    verified: !!meta.verified, questionCount: questions.length || Number(meta.questionCount || 0),
    imageCount: Number(meta.imageCount || 0), materials, questions,
    sourceTier: 'pool',
  }
}
