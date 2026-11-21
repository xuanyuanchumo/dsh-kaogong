/**
 * adapters/poolSourceKnowledge.ts — 方法论 / 技能 / 考点知识节点摄入（cycle-35 · 研究 16 P7-P8）
 *
 * ── 定位（回答「表会不会太单一」）──
 *   方法论（huasheng13 25 篇）、技能文档（kaogong-skill）、纯知识库（sakib 等 5 仓）
 *   不是「题」，但**必须进统一库**——否则「这道题用哪个方法」「这个考点有哪些题」
 *   永远无法跨源查询。归宿：
 *   · 文档正文/结构 → `knowledge` 表（kind=methodology|kadian|skill|doc）
 *   · 文件级引用   → `asset` 表（L1 资产账本——铁律①「只引用不复制」对文档同样适用）
 *   · 题 ↔ 方法论  → relation 统一边表 `USES_METHOD`（零 DDL 增补——统一边表的价值兑现）
 *
 * ── 边界纪律 ──
 *   · 方法论索引复用 `huasheng13.buildIndex`（磁盘快照 + fixtureHash 失效——不重造轮子）；
 *   · kadian 考点节点来自题库自身（question.kadian 去重）——考点是题的聚合视角；
 *   · 纯文档仓只登记 asset（无结构化知识，正文不切分）。
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { putKnowledge, putAsset, putSource, putRelation, withTx, } from './poolDb.js'

/** 源内文件清单（relPath + size + mtime），限深 2；失败返回空 */
function listFiles(root: string, exts: string[], depth = 2, prefix = ''): Array<{ rel: string, size: number, mtime: number }> {
  const out: Array<{ rel: string, size: number, mtime: number }> = []
  let items: string[] = []
  try { items = readdirSync(root) } catch { return out }
  for (const name of items) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = join(root, name)
    let st: any = null
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      if (depth > 0) out.push(...listFiles(full, exts, depth - 1, prefix + name + '/'))
      continue
    }
    if (!exts.some(e => name.endsWith(e))) continue
    out.push({ rel: prefix + name, size: Number(st.size || 0), mtime: Number(st.mtimeMs || 0) })
  }
  return out
}

/**
 * 模块名别名映射（cycle-35）：
 * kadian 首段（题库命名）↔ 方法论文档 moduleLabel（HUASHENG13_META 命名）不一致——
 * 「言语理解与表达」vs「言语理解」是最典型一例。同一业务概念全仓必须可连接，
 * 此处集中登记别名（单一事实源：新增别名只改这里）。
 */
const MODULE_ALIASES: Record<string, string> = {
  '言语理解与表达': '言语理解',
  '常识判断': '常识判断',
  '判断推理': '判断推理',
  '数量关系': '数量关系',
  '资料分析': '资料分析',
  '政治理论': '政治理论',
}

export function normalizeModule(name: string): string {
  const n = String(name || '').trim()
  return MODULE_ALIASES[n] || n
}
/** 标题提取（md 首个 h1 / h2；无 → 文件名） */
function mdTitle(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m) || content.match(/^##\s+(.+)$/m)
  return (m ? m[1] : fallback).trim().slice(0, 160)
}

/**
 * 方法论知识节点（huasheng13 25 篇）+ kaogong-skill 技能文档。
 * 题 ↔ 方法论的连接在 ingestKadianNodes 做（题的 kadian → 考点节点 → 考点所属方法论文档）。
 */
export async function ingestMethodologySource(ctx: any): Promise<any> {
  const { repoRoot, db } = ctx
  const stats = { knowledge: 0, assets: 0, relations: 0, skipped: false, files: 0, lastError: '' }
  if (!existsSync(join(repoRoot, 'huasheng13'))) {
    return { source: 'huasheng13', ...stats, skipped: true, reason: 'huasheng13 语料未安装（题库管理可装）' }
  }

  // ① 方法论 25 篇：复用既有 buildIndex（磁盘快照，fixtureHash 失效——不重造轮子）。
  // ⚠️ 动态 import 必须在事务**外** await（withTx 回调是同步的；R33 教训：fire-and-forget
  //    的 import 会让计数全丢、静默少摄入）。
  let buildIndex: any = null
  try {
    ;({ buildIndex } = await import('./huasheng13.js'))
  } catch (e: any) {
    stats.lastError = 'huasheng13 模块加载失败: ' + (e && e.message ? e.message : String(e))
  }

  withTx(db, () => {
    putSource(db, 'huasheng13', 'required', 'WangJunqing-coder/huasheng13-skill', join(repoRoot, 'huasheng13'))
    putSource(db, 'kaogong-skill', 'recommended', 'kaogong-skill', join(repoRoot, 'kaogong-skill'))

    if (buildIndex) {
      try {
        const idx = buildIndex(join(repoRoot, 'huasheng13'))
        for (const doc of idx.docs) {
          const ok = putKnowledge(db,
            'hs13:' + doc.id, 'methodology', String(doc.moduleLabel || ''),
            doc.title, String(doc.text || '').slice(0, 65536), String(doc.rel || ''), 'huasheng13',
            JSON.stringify({ tables: doc.tables, formulas: doc.formulas, sections: doc.sectionCount, weight: doc.weight }))
          if (ok) { stats.knowledge++; stats.relations++ }
          // 考点 MOC ↔ 原文（REFERENCES_DOC：知识节点层内连接）
          putRelation(db, 'REFERENCES_DOC', 'knowledge', 'hs13:' + doc.id, 'asset', 'huasheng13/' + String(doc.rel || ''), 1.0,
            JSON.stringify({ src: 'huasheng13', rule: 'doc-asset' }))
          stats.relations++
        }
      } catch (e: any) {
        stats.lastError = '方法论索引失败: ' + (e && e.message ? e.message : String(e))
      }
    }

    // ② 方法论文件资产登记（references + examples 全量文件——L1 账本）
    for (const sub of ['references', 'examples']) {
      const dir = join(repoRoot, 'huasheng13', sub)
      for (const f of listFiles(dir, ['.md'], 1)) {
        if (putAsset(db, 'huasheng13', sub + '/' + f.rel, 'methodology-doc', f.size, '', f.mtime)) stats.assets++
      }
    }

    // ③ kaogong-skill 技能文档（10 主题 references——「方法论参考」端点的数据源）
    const skillDir = join(repoRoot, 'kaogong-skill', 'skills', 'kaogong', 'references')
    if (existsSync(skillDir)) {
      for (const f of listFiles(skillDir, ['.md'], 1)) {
        const full = join(skillDir, f.rel)
        let content = ''
        try { content = readFileSync(full, 'utf-8') } catch { content = '' }
        const knId = 'skill:' + f.rel.replace(/\.md$/, '')
        if (putKnowledge(db, knId, 'skill', '通用', mdTitle(content, f.rel), content.slice(0, 65536),
          'kaogong-skill/skills/kaogong/references/' + f.rel, 'kaogong-skill')) stats.knowledge++
        if (putAsset(db, 'kaogong-skill', 'skills/kaogong/references/' + f.rel, 'skill-doc', f.size, '', f.mtime)) stats.assets++
      }
    }
  })
  return { source: 'huasheng13', ...stats }
}

/**
 * 考点知识节点（kadian 去重）+ 题 ↔ 考点 ↔ 方法论的连接边。
 *
 * 连接逻辑（「这道题用哪个方法」的落地）：
 *   · 题的 `kadian` 形如「图形推理 / 数量规律-部分数（…）」——首段是**大类**；
 *   · 方法论文档的 moduleLabel 形如「资料分析」「判断推理」——**模块级**；
 *   · 大类 → 模块的映射：kadian 首段（图形推理/数量关系/资料分析/言语理解…）↔ 文档 moduleId。
 *   因此：题 —BELONGS_TO→ 考点节点 —REFERENCES_DOC→ 方法论文档（module 级近似）。
 *   题与考点已有 BELONGS_TO 边（naoku 摄入时建）；此处补「考点节点 → 方法论文档」。
 */
export function ingestKadianNodes(ctx: any): any {
  const { db } = ctx
  const stats = { knowledge: 0, relations: 0, skipped: false }
  try {
    const kadians = db.prepare(
      `SELECT DISTINCT dst_id k FROM relation WHERE rel_type = 'BELONGS_TO' AND dst_kind = 'kadian' AND LENGTH(dst_id) > 0`,
    ).all()
    if (!kadians.length) return { source: 'kadian', ...stats, skipped: true, reason: '库内无 BELONGS_TO/kadian 边（先摄入题目）' }

    withTx(db, () => {
      // ① 考点节点入库
      for (const r of kadians as any[]) {
        const kadian = String(r.k)
        const module = String(kadian).split('/')[0].trim()
        if (putKnowledge(db, 'kadian:' + kadian, 'kadian', module, kadian, '', '', 'derived')) stats.knowledge++
      }
      // ② 考点 → 方法论文档（数据驱动连接——cycle-35 v2 修正）。
      // ⚠️ kadian 首段是**大类**（图形推理/人文常识/倍数…），不是模块名——按字面猜永远 miss
      //   （cycle-35 实测 0/10552 命中）。正解 = **经所属题的 module 字段反查**（数据里本来就有）：
      //   kadian —BELONGS_TO 边→ question.module → normalizeModule → 方法论文档。
      //   模块名走 normalizeModule 别名映射（「言语理解与表达」≠「言语理解」字面不同义同）。
      try {
        const docs = db.prepare(`SELECT kn_id, module FROM knowledge WHERE kind = 'methodology'`).all()
        const byModule = new Map<string, string>()
        for (const d of docs as any[]) {
          const m = normalizeModule(String(d.module || ''))
          if (m && !byModule.has(m)) byModule.set(m, String(d.kn_id))
        }
        // 数据驱动：kadian → 众数 module（所属题 module 的最高频值）
        const kdMods = db.prepare(
          `SELECT r.dst_id kadian, q.module, COUNT(*) c
           FROM relation r JOIN question q ON q.canonical_id = r.src_id
           WHERE r.rel_type = 'BELONGS_TO' AND r.dst_kind = 'kadian' AND LENGTH(q.module) > 0
           GROUP BY r.dst_id, q.module ORDER BY c DESC`,
        ).all()
        const kadianModule = new Map<string, string>()
        for (const r of kdMods as any[]) {
          const k = String(r.kadian)
          if (!kadianModule.has(k)) kadianModule.set(k, normalizeModule(String(r.module)))
        }
        for (const r of kadians as any[]) {
          const kadian = String(r.k)
          const module = kadianModule.get(kadian) || ''
          const docId = module ? byModule.get(module) : ''
          if (docId) {
            putRelation(db, 'REFERENCES_DOC', 'knowledge', 'kadian:' + kadian, 'knowledge', docId, 0.5,
              JSON.stringify({ src: 'kadian-question-majority', rule: 'data-driven' }))
            stats.relations++
          }
        }
      } catch { /* 连接失败不阻塞节点入库 */ }
    })
  } catch (e: any) {
    return { source: 'kadian', ...stats, skipped: true, reason: '考点节点摄入异常: ' + (e && e.message) }
  }
  return { source: 'kadian', ...stats }
}

/**
 * USES_METHOD 边生产（cycle-46 · 用户确认项④：「方法论↔题」关联从声明变数据）。
 *
 * ⚠️ 时序纪律（本轮 rebuild 实测 0 边的根因）：本函数**必须**在 `rebuildFts(db)` 之后调用——
 * FTS trigram 表在 ingestAll 完成后才 rebuild（poolIngest 尾段），kadian 源在 registry
 * 中排 huasheng13 之后、早于 FTS rebuild → 在 ingestKadianNodes 内联生产时 FTS 是空表，
 * 全部短语命中 0 → continue 跳过（静默 0 边——「时序导致的声明不落地」）。
 *
 * 事实基础（本轮实测）：FTS 内题目解析已含方法论关键词（「截位直除」1605 题）。
 * 落法 = **方法论文档特征短语反查**：每个 methodology 节点抽 2-8 字特征短语
 * （复用 FTS trigram 匹配），命中题 ≥3 条才建边（防噪声单点）；上限 200 边/文档
 * （防止「常识判断」类大模块把关系表撑爆）。
 */
export function produceUsesMethodEdges(ctx: { db: any }): any {
  const { db } = ctx
  const stats = { relations: 0, docs: 0, skipped: false }
  try {
    // 特征短语表：方法论高频技巧名（手工登记——机器切分会产出碎词，教训㉜）
    const SIGNATURES: Array<{ kn: string, phrases: string[] }> = [
      { kn: 'hs13:ziliao-fenxi', phrases: ['截位直除', '增长率', '比重', '基期', '现期', '年均增长', '百化分'] },
      { kn: 'hs13:shuliang-guanxi', phrases: ['代入排除', '赋值', '方程', '行程', '工程', '排列组合', '倍数'] },
      { kn: 'hs13:panduan-tuili', phrases: ['翻译推理', '加强论证', '削弱论证', '定义判断', '类比推理', '真假话'] },
      { kn: 'hs13:yanyu-ciyu', phrases: ['逻辑填空', '中心理解', '主旨', '意图判断', '细节判断', '语句排序'] },
      { kn: 'hs13:panduan-tuxing', phrases: ['位置规律', '对称性', '面数量', '一笔画', '黑白块', '空间重构'] },
      { kn: 'hs13:changshi-panduan', phrases: ['时政', '法律常识', '政治常识', '科技常识', '人文常识'] },
    ]
    withTx(db, () => {
      for (const sig of SIGNATURES) {
        // 文档节点存在才建边（语料未安装时 putRelation 的 dst 无主——跳过）
        const kn = db.prepare(`SELECT kn_id FROM knowledge WHERE kn_id = ?`).get(sig.kn)
        if (!kn) continue
        let edges = 0
        for (const phrase of sig.phrases) {
          if (edges >= 200) break
          const hits = db.prepare(
            // ⚠️ question_fts 是外部内容表（content='question', content_rowid='id'）——
            // FTS 列只有 stem/options/analysis/...（无 canonical_id）；rowid 即 question.id。
            // 反查经 rowid → question.canonical_id 两跳完成（本轮实测 no such column 修正）。
            `SELECT q.canonical_id FROM question_fts f JOIN question q ON q.id = f.rowid WHERE question_fts MATCH ? LIMIT 400`,
          ).all('"' + phrase + '"')
          if (!hits.length || hits.length < 3) continue
          for (const h of hits as any[]) {
            if (edges >= 200) break
            putRelation(db, 'USES_METHOD', 'question', String(h.canonical_id), 'knowledge', sig.kn, 0.7,
              JSON.stringify({ src: 'method-signature', rule: 'fts-reverse', phrase }))
            edges++
          }
        }
        if (edges) stats.docs++
        stats.relations += edges
      }
    })
  } catch (e: any) {
    return { source: 'uses-method', ...stats, skipped: true, reason: String(e && e.message).slice(0, 120) }
  }
  return { source: 'uses-method', ...stats }
}

/**
 * 纯文档仓资产登记（sakib / developer2gwy / Exam_Database / NovaForge / yunduanqiqu）。
 * 只有 asset 账本（L1 引用），不产知识节点（正文无结构化语义）。
 * Exam_Database 上游 data/raw+processed 为空 → available 探针语义由「目录存在」承担（如实登记）。
 */
const DOC_ONLY_SOURCES: Array<{ id: string, tier: string, upstream: string }> = [
  { id: 'sakib', tier: 'optional', upstream: 'sakib（公基/判断/数量/申论/言语/资料）' },
  { id: 'developer2gwy', tier: 'optional', upstream: 'developer2gwy（策略/复盘/选岗）' },
  { id: 'Exam_Database', tier: 'optional', upstream: 'Exam_Database（多渠道素材）' },
  { id: 'NovaForge', tier: 'optional', upstream: 'NovaForge（LaTeX/Typst/Markdown 模板）' },
  { id: 'yunduanqiqu', tier: 'optional', upstream: 'yunduanqiqu（申论范文/面试真题）' },
]

export function ingestDocAssetsSource(ctx: any): any {
  const { repoRoot, db } = ctx
  const stats = { assets: 0, knowledge: 0, relations: 0, skipped: false, files: 0 }
  withTx(db, () => {
    for (const s of DOC_ONLY_SOURCES) {
      const root = join(repoRoot, s.id)
      if (!existsSync(root)) continue
      putSource(db, s.id, s.tier, s.upstream, root)
      for (const f of listFiles(root, ['.md', '.txt'], 2)) {
        if (putAsset(db, s.id, f.rel, 'doc', f.size, '', f.mtime)) { stats.assets++; stats.files++ }
      }
    }
  })
  return { source: 'doc-assets', ...stats }
}
