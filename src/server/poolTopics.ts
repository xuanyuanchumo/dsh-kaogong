/**
 * server/poolTopics.ts — 专题树与申论题目聚合的统一池读层（cycle-60 R11）
 *
 * ── 为什么需要 ──
 *   `/api/topics` 直读 buildPaperIndex + naokuStats(.naoku.db)（topicTree.ts:65-67）；
 *   `/api/essay/list` 直读 buildPaperIndex（paperApi.ts:141）——都是 fresh 后仍残留的外源直读。
 *   本节流从 paper / question 表派生同形对象，由 paperApi 的 usePool() 统一 Gate 切换。
 */
import { poolDb } from '../adapters/poolDb.js'

const MODULES = ['判断推理', '言语理解与表达', '数量关系', '资料分析', '常识判断', '政治理论']
const CATS = ['图形推理', '逻辑判断', '定义判断', '类比推理', '逻辑填空', '片段阅读', '语句表达', '数学运算', '资料分析', '人文常识', '科技常识', '法律常识', '政治常识']
const ESSAY_TYPES = [
  { key: '概括', desc: '概括归纳：提炼要点、分条作答（采分点制）', kw: /概括|概述|归纳|梳理/ },
  { key: '分析', desc: '综合分析：解释含义、分析原因影响', kw: /分析|评析|谈谈|理解|解释/ },
  { key: '对策', desc: '提出对策：提出可执行方案', kw: /对策|建议|措施|怎么办|提出/ },
  { key: '应用文', desc: '应用文写作：格式规范 + 内容完整双评分', kw: /公开信|倡议书|讲话稿|汇报|短评|建议书|宣传/ },
  { key: '大作文', desc: '大作文：标题+总分总结构+论证', kw: /文章|议论文|自拟标题|联系实际/ },
]

/** /api/topics 同形：{channels,topics,stats} */
export function poolBuildTopicTree(): any {
  const db = poolDb()
  if (!db) return { channels: [], topics: [], stats: {} }
  const q1 = (sql: string, ...a: any[]) => { try { return db.prepare(sql).get(...a) } catch { return null } }
  const q = (sql: string, ...a: any[]) => { try { return db.prepare(sql).all(...a) as any[] } catch { return [] as any[] } }
  const paperTotal = Number((q1('SELECT COUNT(*) c FROM paper') || {}).c || 0)
  const essayPapers = Number((q1("SELECT COUNT(*) c FROM paper WHERE subject='申论'") || {}).c || 0)
  const xingcePapers = Number((q1("SELECT COUNT(*) c FROM paper WHERE subject='行测'") || {}).c || 0)
  const naokuTotal = Number((q1("SELECT COUNT(*) c FROM question WHERE source_id='naoku'") || {}).c || 0)
  const kadianCoverage = naokuTotal ? Number((q1("SELECT COUNT(*) c FROM question WHERE source_id='naoku' AND LENGTH(kadian)>0") || {}).c || 0) / naokuTotal : 0
  const modCounts = new Map(q('SELECT module m, COUNT(*) c FROM question WHERE source_id=? AND LENGTH(module)>0 GROUP BY module', 'naoku').map(r => [String(r.m), Number(r.c)]))
  /**
   * 题型题量口径（cycle-65 修复）：**`category` ∪ `qtype`**。
   *
   * 数据事实（实测 87,434 题）：题型信息分散两列——
   * `category`（27,497 有值 / 59,937 空）与 `qtype`（single/综合/数学运算/片段阅读…）。
   * 旧实现只数 `source_id='naoku'` 的 category → ① 只覆盖深度题库一源
   * ② 漏掉 qtype 里的题型 → 频道显示题量远小于真实题量，用户以为库缺失。
   */
  const catCounts = new Map(
    q(`SELECT k, COUNT(*) c FROM (
         SELECT category k FROM question WHERE LENGTH(category)>0
         UNION ALL SELECT qtype k FROM question WHERE LENGTH(qtype)>0
       ) GROUP BY k`).map(r => [String(r.k), Number(r.c)]),
  )
  const xcTopics = MODULES.map(m => ({
    id: 'xc:module:' + m, channel: '行测', kind: 'module', title: m,
    // cycle-65：文案去「深度题库」口径（该视图已退役，数据都在统一池；沿用旧文案
    // 会让用户按图索骥找不到入口 —— ㉘「陈旧文案是用户可见缺陷」同族）
    desc: modCounts.has(m) ? `统一池 ${modCounts.get(m)} 题（跨源去重 · 五维标注）` : '考纲六大模块之一',
    questionCount: modCounts.has(m) ? modCounts.get(m)! : null,
    papers: xingcePapers || null,
    entry: { view: 'practice', params: { module: m } },
  }))
  for (const c of CATS) {
    if (!catCounts.has(c)) continue
    xcTopics.push({
      id: 'xc:cat:' + c, channel: '行测', kind: 'category', title: c,
      // cycle-65：desc 从「深度标注」改为「统一池」口径（深度题库视图已退役，
      // 这些题型数据现在都在统一池里，文案不能还提已删的能力）
      desc: `统一池 ${catCounts.get(c)} 题（跨源去重 · 五维标注 · 可反查出处）`, questionCount: catCounts.get(c),
      /**
       * cycle-67 修复（用户报「点细分题型没有跳转到刷题页面」）：
       * 上一版落点是 `pool`（统一题库的**检索/查看**页）——那不是刷题页，
       * 用户点「片段阅读」期望的是**刷片段阅读的题**，结果被丢进一个数据浏览器。
       * 正解 = 落到 `practice`（刷题页）并带 `category`，挂载即开一张该题型的卷。
       * 图形推理仍走 tuxing 专项（它有专门的图形渲染器，比通用刷题页更贴合）。
       */
      entry: c === '图形推理' ? { view: 'tuxing', params: {} } : { view: 'practice', params: { category: c } },
    } as any)
  }
  const slTopics = ESSAY_TYPES.map(t => ({
    id: 'sl:' + t.key, channel: '申论', kind: 'essay-type', title: '申论 · ' + t.key,
    desc: t.desc, entry: { view: 'essay', params: { type: t.key } },
  }))
  // 科目级专题（v9 修正）：旧 buildTopics 把「科目」也放进 topics（kind='subject'），
  // 消费方（真题卷列表页/客户端专题卡）按 kind 分流渲染。换源时漏了这一类会让
  // 「按科目浏览」的入口消失——这正是「字段在适配器读到了 ≠ 进了响应」的同族缺陷，
  // 故 topics 必须同时含三类：subject / module+category / essay-type。
  const subjTopics = buildTopicsFromPool().map((s: any) => ({ ...s, channel: s.title }))
  return {
    channels: [
      { id: 'xingce', name: '行测', icon: '📐',
        desc: naokuTotal ? `深度题库 ${naokuTotal} 题 + 真题卷 ${xingcePapers} 套` : `真题卷 ${xingcePapers} 套`,
        topics: xcTopics,
        entries: [
          { label: '刷题（SRS）', view: 'practice', params: {} },
          // cycle-65：原「深度题库」入口已随视图退役 → 改指统一题库（数据层本就同源）
          { label: '统一题库（按考点/来源检索）', view: 'pool', params: {} },
          { label: '图形推理专项', view: 'tuxing', params: {} },
          { label: '整卷模考', view: 'exam', params: {} },
          { label: '真题卷库', view: 'papers', params: { subject: '行测' } },
        ] },
      { id: 'shenlun', name: '申论', icon: '✍️',
        desc: `真题卷 ${essayPapers} 套 · 离线评改（小题采分点制 / 大作文分档）`,
        topics: slTopics,
        entries: [
          { label: '申论练习', view: 'essay', params: {} }, { label: '真题卷库', view: 'papers', params: { subject: '申论' } },
        ] },
    ],
    // topics 口径：科目级在前（后端消费方按 kind 分流；顺序确定性以 facet 排序为准）
    topics: [...subjTopics, ...xcTopics, ...slTopics],
    stats: { paperTotal, essayPapers, xingcePapers, naokuTotal, kadianCoverage },
    sourceTier: 'pool',
  }
}

/** /api/topics 的兼容字段 subjects（科目级专题，来自 paper 表 facet） */
export function buildTopicsFromPool(): any[] {
  const db = poolDb()
  if (!db) return []
  try {
    const rows = db.prepare(
      `SELECT subject, COUNT(*) cnt, SUM(COALESCE(question_count,0)) qt,
        GROUP_CONCAT(DISTINCT CAST(year AS TEXT)) yrs, GROUP_CONCAT(DISTINCT exam) exs
       FROM paper WHERE LENGTH(subject)>0 GROUP BY subject ORDER BY cnt DESC`,
    ).all() as any[]
    return rows.map((r: any) => ({
      id: 'subject:' + r.subject, kind: 'subject', title: r.subject,
      papers: Number(r.cnt || 0), questions: Number(r.qt || 0),
      years: String(r.yrs || '').split(',').filter(Boolean).map(Number).sort((a, b) => b - a).slice(0, 12),
      exams: String(r.exs || '').split(',').filter(Boolean).slice(0, 8),
      desc: `${r.cnt} 套真题 · 累计 ${r.qt} 题`,
    }))
  } catch { return [] }
}

/** /api/essay/list 同形：{total,questions,type}（题型关键词从 stem+requirement 匹配） */
export function poolEssayList(wantType: string, limit: number): any {
  const db = poolDb()
  if (!db) return { total: 0, questions: [], type: wantType || 'all' }
  const t = ESSAY_TYPES.find(x => x.key === wantType)
  let rows: any[] = []
  try {
    rows = db.prepare(
      `SELECT p.paper_id, p.exam, p.year, p.paper_type paperType, q.q_no no, q.stem, q.score,
        q.requirement, q.related_materials relatedMaterials, q.reference
       FROM question q JOIN paper p ON p.paper_id = q.paper_id
       WHERE p.subject = '申论' ORDER BY p.year DESC, q.q_no LIMIT ?`,
    ).all(limit * 8) as any[]
  } catch { rows = [] }
  const out: any[] = []
  for (const r of rows) {
    if (out.length >= limit) break
    if (t && !t.kw.test(String(r.stem || '') + String(r.requirement || ''))) continue
    out.push({
      paperId: r.paper_id, exam: r.exam, year: r.year, paperType: r.paperType, no: Number(r.no || 0),
      stem: String(r.stem || ''), score: r.score == null ? null : Number(r.score),
      requirement: String(r.requirement || ''), relatedMaterials: String(r.relatedMaterials || ''),
      hasReference: !!String(r.reference || ''),
    })
  }
  return { total: out.length, questions: out, type: wantType || 'all', sourceTier: 'pool' }
}
