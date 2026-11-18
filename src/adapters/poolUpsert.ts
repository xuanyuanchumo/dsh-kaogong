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
  group_material,group_material_no,material_ref,images,has_image,freq,paper,region,year,seq,n_paper,updated_at`

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

/** 统一题目插入参数行（与 prepareQuestionUpsert 的列顺序严格一致） */
export function questionRow(q: {
  qid?: any, fp?: any, canonicalId: any, sourceId: any, localKey?: any,
  module?: any, category?: any, kadian?: any, ruleType?: any, qtype?: any, askModel?: any,
  stem?: any, options?: any, answer?: any, analysis?: any,
  reasoning?: any, fastest?: any, pitfalls?: any, mother?: any, doubt?: any, related?: any,
  groupMaterial?: any, groupMaterialNo?: any, materialRef?: any,
  images?: any, hasImage?: any, freq?: any,
  paper?: any, region?: any, year?: any, seq?: any, nPaper?: any,
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
  ]
}

/** 写一条题 + 出处 + 基础关系（大多数源的同构路径；在调用方事务内执行） */
export function upsertQuestionBundle(
  insQ: any,
  q: Parameters<typeof questionRow>[0],
  extras: { evidence?: string, relations?: Array<{ type: any, dstKind: string, dstId: string, weight?: number }> } = {},
  putQs?: { db: any, localKey?: string, paper?: string, region?: string, year?: string, seq?: number, path?: string },
): { ok: boolean } {
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
