/**
 * server/reviewStore.ts — 统一错题与补录层（cycle-61 v9）
 *
 * ── 收敛前的分裂（真实缺陷）──
 *   错题本：`srs.ts` 直接改 `progress.wrongBook` 数组；`/api/wrong` 从 JSON 读。
 *   补录：  `historyApi.ts` 直接改 `progress.history` + `importedSigs` + `importBatches`；
 *           `mirrorProgressToDb` 再把它们「顺手」镜像进库。
 *   于是**同一份数据有两个所有者**：JSON 是读侧权威、库只是影子。
 *   症状：白盒看到的 `wrong_book` 行数永远是「上次 saveProgress 时的样子」，
 *   而真实错题本可能已经被后续操作改过——**影子数据滞后**，且无人能判定谁对。
 *
 * ── v9 的正解：库为权威读源，JSON 为兼容写回 ──
 *   · 读：`readWrongBook` / `readImportBatches` 一律先读库；库为空（从未镜像/新用户）
 *     时**降级读 JSON**（迁移期语义：老数据不丢），并明确标记 `tier`。
 *   · 写：写库（事务、幂等）→ 再写 JSON（兼容旧消费方与既有统计口径）。
 *     **库为主，JSON 为镜像**（与 v8 的「JSON 为主」正好反转）。
 *   · 统计：`study_event` 流水 + `import_item` 台账是「历史事实」，不随 JSON 重置而丢失
 *     ——这是「撤销补录不该让统计凭空减少」的数据基础。
 *
 * ── 边界 ──
 *   本模块只做**数据存取**，不做 SRS 策略（box/consecutive 的升降仍在 srs.ts：
 *   策略是业务，存储是机制）。策略改动的正确性由 srs 域守卫保证。
 */
import { poolDb, putImportBatch, undoSImportBatch, listImportBatches, importedSigs } from '../adapters/poolDb.js'

/** 读来源标记（白盒可解释：这条数据来自库还是 JSON 降级） */
export type ReadTier = 'db' | 'json' | 'none'

export interface WrongBookRead {
  list: any[]
  tier: ReadTier
  /** 库内行数（tier='db' 时 = list.length；降级时为 0，便于白盒看出「库还是空的」） */
  dbRows: number
}

/** 错题条目（库行 → 与 progress.wrongBook 同形；JSON 消费方零改动） */
function rowToWrong(w: any): any {
  let options: any = {}
  try { if (w.options) options = typeof w.options === 'string' ? JSON.parse(w.options) : w.options } catch { options = {} }
  return {
    sig: w.sig, module: w.module, type: w.type, stem: w.stem, options,
    correctAnswer: w.correct_answer, analysis: w.analysis,
    wrongCount: Number(w.wrong_count || 0), box: Number(w.box || 0),
    consecutive: Number(w.consecutive || 0), mastered: !!w.mastered,
    lastAt: Number(w.last_at || 0), source: w.source || null, exam: w.exam || null,
    year: w.year || null, paperFile: w.paper_file || null,
    groupMaterial: w.group_material || '', groupMaterialNo: Number(w.group_material_no || 0),
    // v9 增强字段（库有才带；JSON 旧快照无此字段 → undefined，消费方按可选处理）
    canonicalId: w.canonical_id || undefined,
    kadian: w.kadian || undefined,
    historical: !!w.historical,
    lastResult: w.last_result || undefined,
    srsDueAt: w.srs_due_at == null ? undefined : Number(w.srs_due_at),
    firstAt: w.first_at == null ? undefined : Number(w.first_at),
    lapses: w.lapses == null ? undefined : Number(w.lapses),
    // 补录来源批次（在线答错为 undefined）——统计隔离/撤销/工作台筛选都依赖它
    fromImport: w.origin_batch || undefined,
  }
}

/**
 * 读错题本（库优先 + JSON 降级）。
 *
 * @param wsKey  归一化租户键（store.wsKey 的结果）
 * @param jsonFallback 库为空时的 JSON 兜底（由调用方传入 loadProgress(ws).wrongBook）
 */
export function readWrongBook(wsKey: string, jsonFallback?: any[]): WrongBookRead {
  const db = poolDb()
  if (db) {
    try {
      const rows = db.prepare(
        `SELECT sig, module, type, stem, options, correct_answer, analysis, wrong_count, box,
           consecutive, mastered, last_at, source, exam, year, paper_file, group_material,
           group_material_no, canonical_id, kadian, historical, last_result, srs_due_at, first_at, lapses,
           origin_batch
         FROM wrong_book WHERE ws=? ORDER BY last_at`,
      ).all(String(wsKey)) as any[]
      if (rows.length) return { list: rows.map(rowToWrong), tier: 'db', dbRows: rows.length }
      // 库里没有该 ws 的行 → 可能从未镜像；用 JSON 兜底（不丢老用户数据）
      if (Array.isArray(jsonFallback) && jsonFallback.length) {
        return { list: jsonFallback.slice(), tier: 'json', dbRows: 0 }
      }
      return { list: [], tier: db && rows.length === 0 ? 'db' : 'none', dbRows: 0 }
    } catch { /* 库查询失败 → 走 JSON 降级 */ }
  }
  if (Array.isArray(jsonFallback) && jsonFallback.length) return { list: jsonFallback.slice(), tier: 'json', dbRows: 0 }
  return { list: [], tier: 'none', dbRows: 0 }
}

/** 错题本汇总（与 `/api/wrong` 的 summary 口径一致：open/mastered） */
export function wrongSummary(list: any[]): { open: number, mastered: number, total: number } {
  const arr = Array.isArray(list) ? list : []
  const mastered = arr.filter(w => w && w.mastered).length
  return { open: arr.length - mastered, mastered, total: arr.length }
}

/** 补录批次读（库优先 + JSON 降级；同 readWrongBook 语义） */
export function readImportBatches(wsKey: string, jsonFallback?: any): { list: any[], tier: ReadTier } {
  const db = poolDb()
  if (db) {
    try {
      const list = listImportBatches(db, String(wsKey))
      if (list.length) return { list, tier: 'db' }
    } catch { /* 降级 JSON */ }
  }
  const obj = jsonFallback && typeof jsonFallback === 'object' ? jsonFallback : {}
  const list = Object.entries(obj)
    .sort((a: any, b: any) => (b[1].at || 0) - (a[1].at || 0))
    .map(([id, b]: any) => ({ batchId: id, at: b.at, count: b.count, source: b.source || null, status: 'active', items: b.count }))
  return { list, tier: list.length ? 'json' : 'none' }
}

/** 已补录指纹集合（库优先；库空时用 JSON 台账——避免重复补录判定失效） */
export function readImportedSigs(wsKey: string, jsonFallback?: Record<string, any>): Set<string> {
  const db = poolDb()
  if (db) {
    try {
      const s = importedSigs(db, String(wsKey))
      if (s.size) return s
    } catch { /* 降级 JSON */ }
  }
  const out = new Set<string>()
  for (const k of Object.keys(jsonFallback || {})) if (jsonFallback && jsonFallback[k]) out.add(k)
  return out
}

/** 写补录批次（库事务 + 幂等；返回是否落库成功——失败时调用方仍写 JSON 兜底） */
export function writeImportBatch(wsKey: string, batch: any, items: any[]): boolean {
  try { return putImportBatch(poolDb(), String(wsKey), batch, items) } catch { return false }
}

/** 撤销补录批次（库软删 status='undone'，保留审计痕迹） */
export function undoImportBatch(wsKey: string, batchId: string): boolean {
  try { return undoSImportBatch(poolDb(), String(wsKey), batchId) } catch { return false }
}

/**
 * 错题条目 upsert（库侧，单条；供 SRS 策略改动后回写）。
 *
 * 为什么单条 upsert 而不是整本替换：整本替换（`mirrorProgressToDb` 的做法）在并发下会
 * 「后写者覆盖先写者」——A 答错入本的同时 B 答对升箱，两次整本替换只留一份。
 * 单条 upsert 让每个 sig 的更新互相独立（SRS 的真相是「每题一行」而不是「一个数组」）。
 */
export function upsertWrongEntry(wsKey: string, w: any): boolean {
  const db = poolDb()
  if (!db || !w || !w.sig) return false
  try {
    db.prepare(
      `INSERT INTO wrong_book(ws, sig, module, type, stem, options, correct_answer, analysis,
         wrong_count, box, consecutive, mastered, last_at, source, exam, year, paper_file,
         group_material, group_material_no, updated_at, canonical_id, kadian, dims,
         first_at, lapses, srs_due_at, last_result, historical, origin_batch)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(ws, sig) DO UPDATE SET
         module=excluded.module, type=excluded.type, stem=excluded.stem, options=excluded.options,
         correct_answer=excluded.correct_answer, analysis=excluded.analysis,
         wrong_count=excluded.wrong_count, box=excluded.box, consecutive=excluded.consecutive,
         mastered=excluded.mastered, last_at=excluded.last_at,
         canonical_id=COALESCE(excluded.canonical_id, wrong_book.canonical_id),
         kadian=COALESCE(excluded.kadian, wrong_book.kadian),
         dims=COALESCE(excluded.dims, wrong_book.dims),
         first_at=COALESCE(wrong_book.first_at, excluded.first_at),
         lapses=excluded.lapses, srs_due_at=excluded.srs_due_at,
         last_result=excluded.last_result,
         historical=CASE WHEN wrong_book.historical=1 THEN 1 ELSE excluded.historical END,
         origin_batch=COALESCE(wrong_book.origin_batch, excluded.origin_batch),
         updated_at=excluded.updated_at`,
    ).run(
      String(wsKey), String(w.sig), String(w.module || ''), String(w.type || ''),
      String(w.stem || ''), JSON.stringify(w.options || {}), String(w.correctAnswer || ''),
      String(w.analysis || ''), Number(w.wrongCount || 0), Number(w.box || 0),
      Number(w.consecutive || 0), w.mastered ? 1 : 0, Number(w.lastAt || 0),
      String(w.source || ''), String(w.exam || ''), String(w.year || ''),
      String(w.paperFile || ''), String(w.groupMaterial || ''), Number(w.groupMaterialNo || 0),
      new Date().toISOString(),
      w.canonicalId || null, w.kadian || (w.dims && w.dims.kadian) || null,
      w.dims ? JSON.stringify(w.dims) : null,
      Number(w.firstAt || w.lastAt || 0), Number(w.lapses || 0),
      w.srsDueAt == null ? null : Number(w.srsDueAt),
      String(w.lastResult || ''),
      w.historical ? 1 : 0,
      w.fromImport || null,
    )
    return true
  } catch { return false }
}

/** 删除错题（库侧） */
export function removeWrongEntry(wsKey: string, sig: string): boolean {
  const db = poolDb()
  if (!db || !sig) return false
  try { db.prepare('DELETE FROM wrong_book WHERE ws=? AND sig=?').run(String(wsKey), String(sig)); return true }
  catch { return false }
}

/**
 * 错题诊断（按考点/模块分桶——v9 新增能力，JSON 数组时代无法 SQL 化）。
 * 白盒/错题工作台消费：告诉用户「你最该补哪个考点」。
 */
export function wrongDiagnostics(wsKey: string, limit = 15): any {
  const db = poolDb()
  if (!db) return null
  try {
    const byModule = db.prepare(
      `SELECT module, COUNT(*) total, SUM(CASE WHEN mastered=1 THEN 1 ELSE 0 END) mastered,
         SUM(COALESCE(lapses,0)) lapses, MAX(last_at) lastAt
       FROM wrong_book WHERE ws=? GROUP BY module ORDER BY total DESC LIMIT ?`,
    ).all(String(wsKey), Math.max(1, Math.min(50, limit))) as any[]
    const byKadian = db.prepare(
      `SELECT kadian, COUNT(*) total, SUM(CASE WHEN mastered=1 THEN 1 ELSE 0 END) mastered
       FROM wrong_book WHERE ws=? AND LENGTH(kadian) > 0 GROUP BY kadian ORDER BY total DESC LIMIT ?`,
    ).all(String(wsKey), Math.max(1, Math.min(50, limit))) as any[]
    return {
      byModule: byModule.map(r => ({
        module: String(r.module || ''), total: Number(r.total || 0),
        mastered: Number(r.mastered || 0),
        open: Number(r.total || 0) - Number(r.mastered || 0),
        lapses: Number(r.lapses || 0),
        lastAt: Number(r.lastAt || 0),
        // 掌握率：总数 0 时 null（不臆造 0%）
        masteryRate: Number(r.total) ? Math.round(Number(r.mastered || 0) / Number(r.total) * 100) : null,
      })),
      byKadian: byKadian.map(r => ({
        kadian: String(r.kadian || ''), total: Number(r.total || 0),
        mastered: Number(r.mastered || 0), open: Number(r.total || 0) - Number(r.mastered || 0),
      })),
    }
  } catch { return null }
}
