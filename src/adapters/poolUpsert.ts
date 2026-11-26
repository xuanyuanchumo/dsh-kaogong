/**
 * adapters/poolUpsert.ts — 共享 UPSERT 语句（cycle-35）
 *
 * ── 为什么单独成文件（可维护性）──
 *   五个源实现（naoku/xingcezhenti/xingce-app/gk-tuxing/qiuzhao/cea）需要**同一条**
 *   question 表 UPSERT。若各处复制 SQL，合并语义（只填空位）改动时要改五处——
 *   「同文件不留幸存者」纪律（cycle-22）的反面教材。单一事实源：改一处，全源生效。
 *
 * ── 合并语义（铁律）──
 *   「只填空位」：现有值非空则保留，空则取新值（`CASE WHEN LENGTH(现有) > 0 THEN 现有 ELSE 新值 END`）。
 *   否则「最后写入者赢」会把先到源的富字段（五维标注）洗掉。
 *   数值字段（has_image/freq/n_paper/seq）按「现有更大/非零优先」。
 */
import { putRelation, putQuestionSource } from './poolDb.js'

/** question 表列清单（33 个绑定参数，与 prepare 顺序严格一致） */
export const QUESTION_COLS = `qid,fp,canonical_id,source_id,local_key,module,category,kadian,rule_type,qtype,ask_model,
  stem,options,answer,analysis,reasoning,fastest,pitfalls,mother,doubt,related,
  group_material,group_material_no,material_ref,images,has_image,freq,paper,region,year,seq,n_paper,updated_at,content_fp`

/** 统一题目 UPSERT（只填空位合并语义；所有源实现共用） */
export function prepareQuestionUpsert(db: any) {
  return db.prepare(
    `INSERT INTO question(${QUESTION_COLS})
     VALUES(${QUESTION_COLS.split(',').map((_, i) => '?').join(',')})
     ON CONFLICT(canonical_id) DO UPDATE SET
       stem=CASE WHEN LENGTH(question.stem) > 0 THEN question.stem ELSE excluded.stem END,
       options=CASE WHEN LENGTH(question.options) > 0 THEN question.options ELSE excluded.options END,
       answer=CASE WHEN LENGTH(question.answer) > 0 THEN question.answer ELSE excluded.answer END,
       analysis=CASE WHEN LENGTH(question.analysis) > 0 THEN question.analysis ELSE excluded.analysis END,
       reasoning=CASE WHEN LENGTH(question.reasoning) > 0 THEN question.reasoning ELSE excluded.reasoning END,
       fastest=CASE WHEN LENGTH(question.fastest) > 0 THEN question.fastest ELSE excluded.fastest END,
       pitfalls=CASE WHEN LENGTH(question.pitfalls) > 0 THEN question.pitfalls ELSE excluded.pitfalls END,
       mother=CASE WHEN LENGTH(question.mother) > 0 THEN question.mother ELSE excluded.mother END,
       doubt=CASE WHEN LENGTH(question.doubt) > 0 THEN question.doubt ELSE excluded.doubt END,
       related=CASE WHEN LENGTH(question.related) > 0 THEN question.related ELSE excluded.related END,
       group_material=CASE WHEN LENGTH(question.group_material) > 0 THEN question.group_material ELSE excluded.group_material END,
       material_ref=CASE WHEN LENGTH(question.material_ref) > 0 THEN question.material_ref ELSE excluded.material_ref END,
       images=CASE WHEN LENGTH(question.images) > 2 THEN question.images ELSE excluded.images END,
       has_image=CASE WHEN question.has_image = 1 THEN 1 ELSE excluded.has_image END,
       freq=CASE WHEN question.freq > 0 THEN question.freq ELSE excluded.freq END,
       category=CASE WHEN LENGTH(question.category) > 0 THEN question.category ELSE excluded.category END,
       kadian=CASE WHEN LENGTH(question.kadian) > 0 THEN question.kadian ELSE excluded.kadian END,
       rule_type=CASE WHEN LENGTH(question.rule_type) > 0 THEN question.rule_type ELSE excluded.rule_type END,
       qtype=CASE WHEN LENGTH(question.qtype) > 0 THEN question.qtype ELSE excluded.qtype END,
       ask_model=CASE WHEN LENGTH(question.ask_model) > 0 THEN question.ask_model ELSE excluded.ask_model END,
       paper=CASE WHEN LENGTH(question.paper) > 0 THEN question.paper ELSE excluded.paper END,
       region=CASE WHEN LENGTH(question.region) > 0 THEN question.region ELSE excluded.region END,
       year=CASE WHEN LENGTH(question.year) > 0 THEN question.year ELSE excluded.year END,
       seq=CASE WHEN question.seq > 0 THEN question.seq ELSE excluded.seq END,
       n_paper=CASE WHEN question.n_paper > 0 THEN question.n_paper ELSE excluded.n_paper END,
       updated_at=excluded.updated_at`,
  )
}

/**
 * cycle-55：content_fp 家族统一回填 pass（摄入完成后调用）。
 *
 * 为什么需要：naoku 是富源（kadian/五维），注册表排首位先入库；其它源（xingcezhenti 等）
 * 后到时若因自身 fp/cf 未命中而**另插一条 canonical**（同 content_fp 家族、不同 qid），
 * naoku 先到的归并回填只打当时存在的行，后到的主行拿不到富字段——
 * 实测 kadian 含「图形推理」naoku.db 1895 题 / pool 仅 925 题。
 * 逐源回填无法覆盖「主行后到」时序（在 naoku 分支回填时后到主行还不存在 → no-op）。
 *
 * 正解：全源摄入结束后，按 content_fp 家族把富字段**并集**回填到组内每一行（只填空位）。
 * 幂等：CASE WHEN LENGTH(现有)>0 保旧值，连续两次执行结果完全相同。
 * 不变量：只改富字段（kadian/五维/fp/materials），绝不改 canonical_id/qid/source_id
 * （跨源身份不变，question_source/analysis/relation 的引用全部保持有效）。
 *
 * @returns 回填影响行数（白盒可观测）
 */
export function backfillContentFpFamilies(db: any): number {
  if (!db) return 0
  const RICH_COLS = ['fp', 'kadian', 'reasoning', 'fastest', 'pitfalls', 'mother', 'doubt', 'group_material', 'material_ref']
  const NUM_COLS = ['has_image', 'n_paper']
  try {
    // 家族 = 相同 content_fp 且非空；只处理多行家族（单行无补齐对象）
    const families = db.prepare(
      `SELECT content_fp FROM question WHERE LENGTH(content_fp) > 0
       GROUP BY content_fp HAVING COUNT(*) > 1`,
    ).all() as any[]
    if (!families.length) return 0
    let touched = 0
    const getRow = db.prepare('SELECT * FROM question WHERE content_fp = ?')
    const upd = db.prepare(
      `UPDATE question SET
         fp = CASE WHEN LENGTH(fp) = 0 THEN ? ELSE fp END,
         kadian = CASE WHEN LENGTH(kadian) = 0 THEN ? ELSE kadian END,
         reasoning = CASE WHEN LENGTH(reasoning) = 0 THEN ? ELSE reasoning END,
         fastest = CASE WHEN LENGTH(fastest) = 0 THEN ? ELSE fastest END,
         pitfalls = CASE WHEN LENGTH(pitfalls) = 0 THEN ? ELSE pitfalls END,
         mother = CASE WHEN LENGTH(mother) = 0 THEN ? ELSE mother END,
         doubt = CASE WHEN LENGTH(doubt) = 0 THEN ? ELSE doubt END,
         group_material = CASE WHEN LENGTH(group_material) = 0 THEN ? ELSE group_material END,
         material_ref = CASE WHEN LENGTH(material_ref) = 0 THEN ? ELSE material_ref END,
         has_image = CASE WHEN has_image = 0 THEN ? ELSE has_image END,
         n_paper = CASE WHEN n_paper = 0 THEN ? ELSE n_paper END
       WHERE canonical_id = ?`,
    )
    for (const fam of families) {
      const rows = getRow.all(String(fam.content_fp)) as any[]
      // 家族并集：每个富字段取组内第一个非空值（确定性：按 canonical_id 字典序）
      const sorted = rows.slice().sort((a, b) => String(a.canonical_id).localeCompare(String(b.canonical_id)))
      const union: Record<string, any> = {}
      for (const col of [...RICH_COLS, ...NUM_COLS]) {
        union[col] = sorted.find(r => {
          const v = r[col]
          return NUM_COLS.includes(col) ? Number(v) > 0 : String(v ?? '').length > 0
        })?.[col] ?? (NUM_COLS.includes(col) ? 0 : '')
      }
      for (const row of sorted) {
        // 幂等计数：只有确实存在「空位且家族有值可补」时才 UPDATE——否则 SQL changes
        // 会把「值没变但仍执行 UPDATE」也计入，导致连续两次 rebuild 的 enrichedRows
        // 数字不同（违反同输入两次深相等纪律）。
        const need = [...RICH_COLS].some(col => String(row[col] ?? '').length === 0 && String(union[col] ?? '').length > 0)
          || NUM_COLS.some(col => Number(row[col] || 0) === 0 && Number(union[col] || 0) > 0)
        if (!need) continue
        const r = upd.run(
          union.fp, union.kadian, union.reasoning, union.fastest, union.pitfalls,
          union.mother, union.doubt, union.group_material, union.material_ref,
          Number(union.has_image) || 0, Number(union.n_paper) || 0,
          String(row.canonical_id),
        )
        touched += Number((r as any)?.changes || 0)
      }
    }
    return touched
  } catch {
    return 0   // 回填失败不影响 rebuild 主链路（与 USES_METHOD 同纪律）
  }
}

/** 统一题目插入参数行（与 prepareQuestionUpsert 的列顺序严格一致） */
export function questionRow(q: {
  qid?: any, fp?: any, canonicalId: any, sourceId: any, localKey?: any,
  module?: any, category?: any, kadian?: any, ruleType?: any, qtype?: any, askModel?: any,
  stem?: any, options?: any, answer?: any, analysis?: any,
  reasoning?: any, fastest?: any, pitfalls?: any, mother?: any, doubt?: any, related?: any,
  groupMaterial?: any, groupMaterialNo?: any, materialRef?: any,
  images?: any, hasImage?: any, freq?: any,
  paper?: any, region?: any, year?: any, seq?: any, nPaper?: any, contentFp?: any,
}): any[] {
  return [
    String(q.qid ?? ''), String(q.fp ?? ''), String(q.canonicalId), String(q.sourceId), String(q.localKey ?? ''),
    String(q.module ?? ''), String(q.category ?? ''), String(q.kadian ?? ''), String(q.ruleType ?? ''), String(q.qtype ?? ''), String(q.askModel ?? ''),
    String(q.stem ?? ''), String(q.options ?? ''), String(q.answer ?? ''), String(q.analysis ?? ''),
    String(q.reasoning ?? ''), String(q.fastest ?? ''), String(q.pitfalls ?? ''), String(q.mother ?? ''), String(q.doubt ?? ''), String(q.related ?? ''),
    String(q.groupMaterial ?? ''), Number(q.groupMaterialNo ?? 0), String(q.materialRef ?? ''),
    String(q.images ?? '[]'), Number(q.hasImage ?? 0), Number(q.freq ?? 0),
    String(q.paper ?? ''), String(q.region ?? ''), String(q.year ?? ''), Number(q.seq ?? 0), Number(q.nPaper ?? 0),
    new Date().toISOString(),
    String(q.contentFp ?? ''),
  ]
}

/** 写一条题 + 出处 + 基础关系（大多数源的同构路径；在调用方事务内执行） */
export function upsertQuestionBundle(
  insQ: any,
  q: Parameters<typeof questionRow>[0],
  extras: { evidence?: string, relations?: Array<{ type: any, dstKind: string, dstId: string, weight?: number }> } = {},
  putQs?: { db: any, localKey?: string, paper?: string, region?: string, year?: string, seq?: number, path?: string },
): { ok: boolean, mergedInto?: string } {
  const db = putQs && putQs.db
  const cfp = String(q.contentFp ?? '').trim()
  // ── cycle-40 跨源去重（研究 21 §2 纪律②）：内容指纹命中已有行 → **归并而非新行**。
  // canonical_id 靠 qid/namespace 隔离防撞库（跨源天然不同）——内容级同题的合并靠
  // content_fp 查重：命中则把本源出处挂到已有 canonical 下（来源标记不丢），本行不插入。
  if (db && cfp) {
    try {
      const existing = db.prepare('SELECT canonical_id FROM question WHERE content_fp = ? LIMIT 1').get(cfp)
      if (existing && existing.canonical_id && String(existing.canonical_id) !== String(q.canonicalId)) {
        const canon = String(existing.canonical_id)
        if (putQs && putQs.db) {
          putQuestionSource(db, canon, String(q.sourceId), putQs.localKey || String(q.localKey ?? ''),
            putQs.paper || String(q.paper ?? ''), putQs.region || String(q.region ?? ''),
            putQs.year || String(q.year ?? ''), putQs.seq ?? Number(q.seq ?? 0), putQs.path || '')
        }
        for (const r of extras.relations || []) {
          putRelation(db, r.type, 'question', canon, r.dstKind, r.dstId, r.weight ?? 1.0, extras.evidence || '')
        }
        return { ok: true, mergedInto: canon }   // 合并未插行——出处已挂
      }
    } catch { /* 查重失败 → 走正常插入（不去重但不丢数据） */ }
  }
  try {
    insQ.run(...questionRow(q))
  } catch {
    return { ok: false }
  }
  const canon = String(q.canonicalId)
  const ev = extras.evidence || ''
  for (const r of extras.relations || []) {
    putRelation(putQs?.db, r.type, 'question', canon, r.dstKind, r.dstId, r.weight ?? 1.0, ev)
  }
  if (putQs && putQs.db) {
    putQuestionSource(putQs.db, canon, String(q.sourceId), putQs.localKey || String(q.localKey ?? ''),
      putQs.paper || String(q.paper ?? ''), putQs.region || String(q.region ?? ''),
      putQs.year || String(q.year ?? ''), putQs.seq ?? Number(q.seq ?? 0), putQs.path || '')
  }
  return { ok: true }
}
