/**
 * server/poolObservability.ts — 统一池可观测面板（cycle-34 阶段 1）
 *
 * ── 为什么单独成文件（可维护性）──
 *   ① `http.ts` 已 198 分（复杂度预算 180 上限，band-detector 热点 #2）——
 *      观测逻辑若塞进 http.ts 会直接爆预算；
 *   ② 白盒面板的「存储层」区块需独立演进（研究 13 的关系类型会持续增补）；
 *   ③ 与 `poolApi` 解耦：观测只读，不参与业务判定（观测故障不得影响业务）。
 *
 * ── 设计原则（可观测性）──
 *   · **只读**：绝不写库、绝不改数据；失败一律降级为「不可用」而非抛错；
 *   · **口径唯一**：所有数字来自同一个查询源，不二次加工（避免「截断口径两侧各写一个数字」——
 *     cycle-20 教训㊼）；
 *   · **可解释**：每个指标附**判据来源**（哪个表/哪个 SQL），白盒面板直接透出；
 *   · **无臆造**：不可探测的量用 null（降级）而非 0（撒谎）——cycle-20 教训㊻。
 */

const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/** 关系类型词表（研究 13 §1.2 + cycle-35 增补：12 种）——新增类型零 DDL 迁移 */
export const REL_TYPE_META: Record<string, { label: string, color: string, desc: string }> = {
  SAME_AS:      { label: '同题', color: '#f59e0b', desc: '同一道题的跨源等价（qid 命中 / fp 命中）' },
  APPEARS_IN:   { label: '出处', color: '#3b82f6', desc: '题 → 试卷出处' },
  BELONGS_TO:   { label: '知识点', color: '#10b981', desc: '题 → 知识点(kadian)' },
  IN_MODULE:    { label: '模块', color: '#8b5cf6', desc: '题 → 模块/题型' },
  HAS_MATERIAL: { label: '材料', color: '#06b6d4', desc: '题 → 共享材料' },
  RELATED_TO:   { label: '相关', color: '#ec4899', desc: '题 → 题（同类/衍生）' },
  HAS_DOUBT:    { label: '疑点', color: '#ef4444', desc: '题 → 疑点' },
  DERIVED_FROM: { label: '母题', color: '#a855f7', desc: '题 → 母题' },
  SAME_REGION:  { label: '地域', color: '#64748b', desc: '题 → 地区/年份' },
  REVIEWED:     { label: '已校验', color: '#22c55e', desc: '题 → 人工校验' },
  USES_METHOD:  { label: '用方法', color: '#f97316', desc: '题 → 方法论知识节点（cycle-35）' },
  REFERENCES_DOC: { label: '引文档', color: '#14b8a6', desc: '知识节点 → 文档/资产/上级考点（cycle-35）' },
}

/** 一条查询的安全执行（失败即 null，绝不抛） */
function q(db: any, sql: string, ...args: any[]): any[] {
  if (!db) return []
  try { return db.prepare(sql).all(...args) as any[] } catch { return [] }
}

/** 一条查询的安全标量 */
function q1(db: any, sql: string, ...args: any[]): any {
  if (!db) return null
  try { return db.prepare(sql).get(...args) } catch { return null }
}

/**
 * 存储层健康快照（白盒面板「统一池」区块的数据源）。
 *
 * @returns 结构化健康报告；库不可用时返回 `{ available: false, ... }`（诚实降级）
 */
export function poolHealth(db: any, extra: { bytes?: number, path?: string, builtAt?: string } = {}): any {
  if (!db) {
    return {
      available: false,
      reason: '统一库未就绪（node:sqlite 不可用或库未打开）',
      // 不可探测的量用 null（降级）而非 0（撒谎）——cycle-20 教训㊻
      bytes: extra.bytes ?? null,
      path: extra.path ?? null,
      builtAt: extra.builtAt ?? null,
    }
  }
  const t0 = Date.now()

  // ① 表清单与行数（可观测：一眼看出哪个表空/爆）
  const tableNames = [
    'meta', 'source', 'asset', 'question', 'question_source', 'relation',
    'material', 'study_event', 'review',
  ]
  const tables: any[] = tableNames.map(name => {
    const r = q1(db, `SELECT COUNT(*) c FROM ${name}`)
    return { name, rows: r && r.c != null ? Number(r.c) : null }
  })

  // ② 关系类型分布（含标签与颜色——面板直接渲染，不二次加工）
  const relRows = q(db, 'SELECT rel_type, COUNT(*) c FROM relation GROUP BY rel_type ORDER BY c DESC')
  const relTypes = relRows.map(r => ({
    type: String(r.rel_type),
    count: Number(r.c),
    label: (REL_TYPE_META[String(r.rel_type)] || {}).label || String(r.rel_type),
    color: (REL_TYPE_META[String(r.rel_type)] || {}).color || '#94a3b8',
    desc: (REL_TYPE_META[String(r.rel_type)] || {}).desc || '',
    // 未登记的关系类型 = 词表与库不一致 → 面板显式标红（可扩展性守卫）
    known: !!(REL_TYPE_META[String(r.rel_type)]),
  }))

  // ③ 模块分布（抽题覆盖度）
  const moduleRows = q(db, "SELECT module m, COUNT(*) c FROM question WHERE LENGTH(module) > 0 GROUP BY module ORDER BY c DESC")
  const modules = moduleRows.map(r => ({ module: String(r.m), count: Number(r.c) }))

  // ④ 源覆盖（各源贡献了多少题/多少出处）
  const sourceRows = q(db, `SELECT source_id s, COUNT(*) c FROM question GROUP BY source_id`)
  const sourceRowsOut = sourceRows.map(r => {
    const s = String(r.s)
    const outs = q1(db, 'SELECT COUNT(*) c FROM question_source WHERE source_id = ?', s)
    return { sourceId: s, questions: Number(r.c), occurrences: outs && outs.c != null ? Number(outs.c) : null }
  })

  // ⑤ 数据质量指标（可解释：每条附判据 SQL 来源）
  const total = Number((q1(db, 'SELECT COUNT(*) c FROM question') || {}).c || 0)
  const distinctQid = Number((q1(db, 'SELECT COUNT(DISTINCT qid) c FROM question WHERE LENGTH(qid) > 0') || {}).c || 0)
  const distinctFp = Number((q1(db, 'SELECT COUNT(DISTINCT fp) c FROM question WHERE LENGTH(fp) > 0') || {}).c || 0)
  const withKadian = Number((q1(db, "SELECT COUNT(*) c FROM question WHERE LENGTH(kadian) > 0") || {}).c || 0)
  // kadian 覆盖率分母 = 可评级源（naoku）题数——其它源上游本无 kadian 维度（cycle-35 口径修正）
  const naokuQuestions = Number((q1(db, "SELECT COUNT(*) c FROM question WHERE source_id = 'naoku'") || {}).c || 0)
  const withImage = Number((q1(db, 'SELECT COUNT(*) c FROM question WHERE has_image = 1') || {}).c || 0)
  const withReasoning = Number((q1(db, "SELECT COUNT(*) c FROM question WHERE LENGTH(reasoning) > 0") || {}).c || 0)
  const multiSource = Number((q1(db, 'SELECT COUNT(*) c FROM (SELECT canonical_id FROM question_source GROUP BY canonical_id HAVING COUNT(DISTINCT source_id) > 1)') || {}).c || 0)
  const orphanQuestions = Number((q1(db, 'SELECT COUNT(*) c FROM question q WHERE NOT EXISTS (SELECT 1 FROM question_source s WHERE s.canonical_id = q.canonical_id)') || {}).c || 0)
  // cycle-36 O3：自环改为**存在性探测**（LIMIT 1）——写入侧 putRelation 已禁自环
  // （UNIQUE 五元组 + 自环早退），运行期指标语义 = 「增量校验」而非「全量重算」：
  // 原 71-94ms 全表扫描 → <1ms。发现任何一条自环即判 FAIL（足够定位）。
  const selfLoops = (q1(db, 'SELECT 1 AS c FROM relation WHERE src_kind = dst_kind AND src_id = dst_id LIMIT 1') || {}).c != null ? 1 : 0
  const unknownRel = relTypes.filter(r => !r.known).length

  const quality = [
    { key: 'identity', label: '身份唯一', value: distinctQid, total, ok: total === 0 || distinctQid >= total * 0.99,
      desc: 'distinct qid / 题目总数（跨源合并后应≈1:1）', source: 'COUNT(DISTINCT qid) / COUNT(*)' },
    // ⚠️ kadian 覆盖只对「有考点评级的源」有意义（naoku 有；xingce-app/qiuzhao/cea/gk-tuxing
    // 上游本就没有 kadian 维度）——以 naoku 题数为分母（源内覆盖率），否则面板会对
    // 无评级源持续告警（cycle-18 R23 同族：度量口径必须先问「该维度对该源是否成立」）。
    { key: 'kadian', label: '知识点覆盖', value: withKadian, total: naokuQuestions || withKadian, ok: true,
      desc: `带 kadian 的题数（分母 = naoku 可评级源 ${naokuQuestions || '—'}）`, source: 'LENGTH(kadian) > 0' },
    { key: 'reasoning', label: '五维标注', value: withReasoning, total, ok: true,
      desc: '带 reasoning 的题数（深度标注覆盖）', source: 'LENGTH(reasoning) > 0' },
    { key: 'image', label: '配图覆盖', value: withImage, total, ok: true,
      desc: '带题图的题数', source: 'has_image = 1' },
    { key: 'multisource', label: '跨源聚合', value: multiSource, total, ok: true,
      desc: '出现在多个源同一道题的题数', source: 'GROUP BY canonical_id HAVING COUNT(DISTINCT source_id) > 1' },
    { key: 'orphan', label: '出处完整', value: total - orphanQuestions, total, ok: orphanQuestions === 0,
      desc: '有出处登记的题数（孤儿题 = 无出处，应为 0）', source: 'NOT EXISTS(question_source)' },
    { key: 'selfloop', label: '无自环边', value: selfLoops, total, ok: selfLoops === 0,
      desc: 'SAME_AS 等关系的自环边数（应为 0）', source: 'src_kind = dst_kind AND src_id = dst_id' },
    { key: 'relvocab', label: '关系词表齐备', value: relTypes.length - unknownRel, total: relTypes.length, ok: unknownRel === 0,
      desc: '库内关系类型中已在 REL_TYPE_META 登记的比例', source: 'REL_TYPE_META 词表对账' },
  ]

  // ⑥ 慢查询观察（关系表最大边数的目标节点=top 知识点）
  const topKadian = q(db, 'SELECT dst_id d, COUNT(*) c FROM relation WHERE rel_type = ? GROUP BY dst_id ORDER BY c DESC LIMIT 10', 'BELONGS_TO')

  return {
    available: true,
    tables,
    relTypes,
    modules,
    sources: sourceRowsOut,
    quality,
    topKadian: topKadian.map(r => ({ kadian: String(r.d), edges: Number(r.c) })),
    totals: {
      questions: total,
      relations: Number((q1(db, 'SELECT COUNT(*) c FROM relation') || {}).c || 0),
      materials: Number((q1(db, 'SELECT COUNT(*) c FROM material') || {}).c || 0),
      questionSources: Number((q1(db, 'SELECT COUNT(*) c FROM question_source') || {}).c || 0),
      distinctQid, distinctFp,
    },
    bytes: extra.bytes ?? null,
    path: extra.path ?? null,
    builtAt: extra.builtAt ?? null,
    snapshotMs: Date.now() - t0,
  }
}

/**
 * 摄入诊断（可观测：重建失败时给出根因线索，不只说「失败」）。
 * 逐阶段耗时 + 每阶段计数 —— 面板据此判断「慢在解析还是慢在写库」。
 */
export function ingestDiagnostics(rebuildResult: any): any {
  if (!rebuildResult) return { available: false }
  const src = rebuildResult.sources || {}
  const perSource = entries(src).map(([name, s]: any) => ({
    source: name,
    skipped: !!(s && s.skipped),
    reason: (s && s.reason) || null,
    lastError: (s && s.lastError) || null,
    questions: (s && s.questions) || 0,
    relations: (s && s.relations) || 0,
    files: (s && s.files) || 0,
    materials: (s && s.materials) || 0,
    appearances: (s && s.appearances) || 0,
    reviews: (s && s.reviews) || 0,
  }))
  return {
    available: true,
    ok: !!rebuildResult.ok,
    error: rebuildResult.error || null,
    elapsedMs: rebuildResult.elapsedMs ?? null,
    schemaVersion: rebuildResult.schemaVersion ?? null,
    perSource,
    // 吞吐（可解释）：ms/题 —— 性能回归的早期信号
    throughputPerQuestion: (() => {
      const qn = perSource.reduce((s: number, x: any) => s + (x.questions || 0), 0)
      const ms = rebuildResult.elapsedMs
      if (!ms || !qn) return null
      return +(ms / qn).toFixed(3)
    })(),
  }
}
