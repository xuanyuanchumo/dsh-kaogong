/**
 * server/historyApi.ts — 纸质刷题记录补录域（cycle-21 · issue #3；v9 统一数据层改造）
 *
 * 用户旅程：纸质资料（粉笔 5000 题等）已做过题 → 在现有题库中**搜索同题** →
 * 核对候选（题干/选项/来源）→ 补录「已做·对/错/结果未知」→ 错题自动进错题本 →
 * 同批次可撤销。
 *
 * ── v9 改造（消除外源直读）──
 *   旧实现三通道串联，其中两条直读外源：
 *     ① `.naoku.db` 直读（adapters/naoku.searchQuestionsByStem）
 *     ③ 真题卷目录逐卷扫描（buildPaperIndex + loadPaper，最坏 80 卷 × 18ms）
 *   v9：**唯一检索通道 = 统一池**（FTS5 trigram + LIKE 兜底 + 出处溯源），
 *   两条外源通道删除。池未就绪时经 dataGate 按需摄入后重试，仍不可用则返回结构化未就绪。
 *
 *   补录台账也从「progress JSON 桶」迁到实体表 import_batch / import_item（可 SQL 审计），
 *   同时**保留** progress 侧的 JSON 台账为读侧权威（双写期语义，见研究 15 C7 阶段 2 口径）——
 *   切读是独立决策，本轮不偷偷改读路径。
 *
 * 设计纪律（来自 issue #3 的验收口径）：
 *  - 稳定标识：候选匹配用「内容指纹」（module|stem 前 120 字 sha1，与 srs.questionSig 同源）。
 *  - 统计隔离：补录记 progress.history 带 `source:'import'`；statsSnapshot/今日新刷
 *    口径排除 import 条目（历史归历史，不污染今日打卡）。
 *  - 幂等：同批次内指纹去重；同题已补录过（progress.importedSigs）→ 冲突提示不重复计数。
 *  - 可撤销：批次 id + undo 端点按批次回滚（只动 import 条目，绝不动在线作答）。
 *  - 只有对错没有选项：允许 result=unknown / 无所选答案。
 */
import { createHash } from 'node:crypto'
import { poolDb, putImportBatch, undoSImportBatch } from '../adapters/poolDb.js'
// v9：统一错题/补录层（库为权威读源，JSON 为兼容镜像）
import { readImportBatches, upsertWrongEntry, removeWrongEntry } from './reviewStore.js'
import { poolRowToQuestion } from './poolApi.js'
import { ensureDomain } from './dataGate.js'

// v9：批次列表改走 reviewStore（库优先），本地 entries 辅助不再需要

/** 内容指纹（与 srs.questionSig 同算法：module|stem前120字 → sha1 12位）——跨进程稳定 */
function contentSig(module: string, stem: string): string {
  return createHash('sha1').update((module || '') + '|' + (stem || '').slice(0, 120)).digest('hex').slice(0, 12)
}

/** 题干规范化（搜索比对用：去空白差异） */
function normStem(s: string): string {
  return String(s || '').replace(/\s+/g, '').toLowerCase()
}

/** 本地今日（ISO 日期，与 /api/check 同口径） */
function today(): string { return new Date().toISOString().slice(0, 10) }

export function makeHistoryApi({ store, repoRoot = '', dataCtx }: { store: any, repoRoot?: string, dataCtx?: { repoRoot: string, dataDir: string } }) {
  const { loadProgress, saveProgress } = store
  /** 目录题库扫描用的 repoRoot（装配层注入；仅用于 dataGate 摄入上下文，不用于直读） */
  const repoRootRef: string = repoRoot

  /** 注入给 dataGate 的上下文 */
  const ctx = (): { repoRoot: string, dataDir: string } => dataCtx || { repoRoot: repoRootRef, dataDir: '' }

  /**
   * 在现有题库中搜索候选题（v9：**唯一通道 = 统一池**）。
   * 池检索同时具备「全文命中 + 跨源去重 + 出处溯源」，因此三条旧通道可以收敛为一条：
   * 通道①（naoku 直读）与通道③（真题卷目录扫描）被它完全覆盖且更便宜。
   */
  function search(q: string, module: string, limit: number) {
    const kw = String(q || '').trim()
    if (!kw) return { keyword: kw, list: [], sourceTier: 'pool', hint: '输入题干关键词（≥2 字）' }
    const pdb = poolDb()
    if (!pdb) return { keyword: kw, list: [], total: 0, ready: false, fallback: true, hint: '统一题库未就绪（node:sqlite 不可用）' }

    const list: any[] = []
    const seen = new Set<string>()
    let rows: any[] = []
    try {
      if (kw.length >= 3) {
        rows = pdb.prepare(
          `SELECT q.* FROM question_fts f JOIN question q ON q.id = f.rowid
           WHERE question_fts MATCH ? ORDER BY bm25(question_fts) LIMIT ?`,
        ).all(kw, limit * 3) as any[]
      }
      if (!rows.length) {
        rows = pdb.prepare(
          'SELECT * FROM question WHERE stem LIKE ? OR analysis LIKE ? LIMIT ?',
        ).all('%' + kw + '%', '%' + kw + '%', limit * 3) as any[]
      }
    } catch { rows = [] }

    // 出处溯源（question_source 有 paper/region/year/seq/path）——用户可回原卷核对
    const provenance = new Map<string, any>()
    try {
      const ids = rows.map((r: any) => String(r.canonical_id)).filter(Boolean)
      if (ids.length) {
        const marks = ids.map(() => '?').join(',')
        for (const s of pdb.prepare(
          `SELECT canonical_id, paper, region, year, seq, path FROM question_source
           WHERE canonical_id IN (${marks}) AND LENGTH(paper) > 0
           ORDER BY year DESC LIMIT ?`,
        ).all(...ids, ids.length * 2) as any[]) {
          if (!provenance.has(s.canonical_id)) provenance.set(s.canonical_id, s)
        }
      }
    } catch { /* 溯源查询失败 → 降级为无出处（不影响主命中） */ }

    for (const row of rows) {
      if (list.length >= limit) break
      if (module && module !== 'all' && row.module !== module) continue
      const item = poolRowToQuestion(row)
      if (!item) continue
      const stem = String(item.stem || '').replace(/【图:kgimg:\/\/[^\]】]+】/g, '')
      if (!normStem(stem).includes(normStem(kw))) continue
      const sig = contentSig(item.module || row.module, item.stem || row.stem)
      if (seen.has(sig)) continue
      seen.add(sig)
      const src = provenance.get(String(row.canonical_id || ''))
      list.push({
        ...item, contentSig: sig, matchSource: 'pool',
        ...(src ? { paperId: src.path || src.paper, exam: src.paper, year: src.year, paperFile: String(src.path || '').split(/[\\/]/).pop() } : {}),
      })
    }
    return { keyword: kw, module: module || null, list, total: list.length, sourceTier: 'pool' }
  }

  /** 需摄入的重载：池内没有命中时才尝试按需入库一次（首次使用场景） */
  async function searchAsync(q: string, module: string, limit: number) {
    let out = search(q, module, limit)
    if (out.list.length) return out
    const g = await ensureDomain('pool', ctx())
    out = search(q, module, limit)
    if (!out.list.length && g.hint) {
      return { ...out, ready: false, fallback: true, ingesting: !!g.ingesting, hint: g.hint }
    }
    return out
  }

  /**
   * 补录（逐题/批量）。entries: [{ contentSig|question, result: 'right'|'wrong'|'unknown',
   *   userAnswer?, source?, happenedAt? }]
   * 返回 { batchId, accepted, conflicts, rejected }；错题进 wrongBook（box=1，historical 标记）。
   */
  function addEntries(post: any, wsRaw: any) {
    const list = Array.isArray(post && post.entries) ? post.entries : (post && post.contentSig ? [post] : [])
    if (!list.length) return { error: '缺少 entries（至少一条 {contentSig|question, result}）' }
    const p = loadProgress(wsRaw)
    p.wrongBook = p.wrongBook || []
    p.importedSigs = p.importedSigs || {}      // sig → batchId（幂等台账）
    p.importBatches = p.importBatches || {}    // batchId → { sigs, at, source }（撤销索引）
    const batchId = 'imp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    const accepted: any[] = []
    const conflicts: any[] = []
    const rejected: any[] = []
    const batchSigs = new Set<string>()
    for (const it of list) {
      const q = it.question
      const result = String(it.result || '').toLowerCase()
      if (!['right', 'wrong', 'unknown'].includes(result)) { rejected.push({ reason: 'result 必须是 right/wrong/unknown', item: it }); continue }
      if (!q || !q.stem) { rejected.push({ reason: '缺少 question.stem（候选须来自 /api/history/search）', item: it }); continue }
      const sig = it.contentSig || contentSig(q.module, q.stem)
      // 幂等三闸：本批次内重复 / 历史已补录 / 无法定位题目
      if (batchSigs.has(sig)) { conflicts.push({ sig, reason: '同批次内重复', stem: String(q.stem).slice(0, 40) }); continue }
      if (p.importedSigs[sig]) { conflicts.push({ sig, reason: '此前已补录（批次 ' + p.importedSigs[sig] + '）', stem: String(q.stem).slice(0, 40) }); continue }
      batchSigs.add(sig)
      // 原始作答日期未知 → happenedAt 缺省 null，历史语义由 historical 标记承载（不算今日新刷）
      const happenedAt = (it.happenedAt && /^\d{4}-\d{2}-\d{2}$/.test(String(it.happenedAt))) ? String(it.happenedAt) : null
      const entry = {
        date: today(),                    // 导入日（统计隔离见下）
        module: q.module || '未知', type: q.type || '',
        userAnswer: it.userAnswer ? String(it.userAnswer).toUpperCase().trim() : null,
        correctAnswer: q.correctAnswer || null,
        isCorrect: result === 'right' ? true : result === 'wrong' ? false : null,
        source: 'import',                 // ★ 统计隔离标记：statsSnapshot/今日口径排除
        historical: true,                 // 原始作答发生在导入之前
        happenedAt,                       // 用户填了才记录；未知保持 null（不虚构）
        importMeta: { batchId, book: it.source ? String(it.source).slice(0, 80) : null },
        sig,
      }
      p.history.push(entry)
      // 错题进错题本（复用五箱结构；historical 标记 + box=1；答错才入）
      if (result === 'wrong') {
        const exist = p.wrongBook.find((w: any) => w.sig === sig)
        if (!exist) {
          p.wrongBook.push({
            sig, module: q.module || '未知', type: q.type || '',
            stem: q.stem, options: q.options || {}, correctAnswer: q.correctAnswer || null,
            analysis: q.analysis || '', wrongCount: 1, box: 1, consecutive: 0, mastered: false,
            // cycle-43 材料保真：补录候选带材料时随快照入错题本（回炉可复现作答语境）
            groupMaterial: q.groupMaterial || '', groupMaterialNo: q.groupMaterialNo || 0,
            // v9：错题实体化字段（可 SQL 诊断）
            canonicalId: q.id || '', kadian: (q.dims && q.dims.kadian) || '',
            lastAt: Date.now(), historical: true, fromImport: batchId,
          })
        } else { exist.wrongCount++; exist.lastAt = Date.now(); exist.fromImport = exist.fromImport || batchId }
      }
      accepted.push({ sig, result, stem: String(q.stem).slice(0, 40), module: q.module || '', correctAnswer: q.correctAnswer || null, userAnswer: entry.userAnswer, isCorrect: entry.isCorrect, happenedAt })
    }
    if (accepted.length) {
      for (const a of accepted) p.importedSigs[a.sig] = batchId
      p.importBatches[batchId] = { at: Date.now(), sigs: accepted.map(a => a.sig), count: accepted.length, source: post.source || null }
      // 台账环形：批次最多留 30（撤销窗口），超限淘汰最旧（其 sigs 台账保留，仅批次索引淘汰）
      const bKeys = Object.keys(p.importBatches)
      if (bKeys.length > 30) for (const k of bKeys.slice(0, bKeys.length - 30)) delete p.importBatches[k]
      saveProgress(wsRaw, p)
      // v9：镜像到实体表（可 SQL 审计；失败静默——JSON 台账仍是兼容写回）
      try {
        const key = store.wsKey ? store.wsKey(wsRaw) : String(wsRaw || 'default')
        putImportBatch(poolDb(), key, {
          batchId, at: p.importBatches[batchId].at, source: post.source || '', book: post.book || '',
          total: list.length, accepted: accepted.length,
          conflicts: conflicts.length, rejected: rejected.length,
          importedTotal: accepted.length, status: 'active',
        }, accepted.map(a => ({
          sig: a.sig, module: a.module, stem: a.stem, result: a.result,
          userAnswer: a.userAnswer || '', correctAnswer: a.correctAnswer || '',
          isCorrect: a.isCorrect === null ? null : !!a.isCorrect,
          happenedAt: a.happenedAt, source: 'import',
        })))
        // v9：补录产生的错题在库侧带 origin_batch（可追溯/可撤销；在线答错的那条不带）
        for (const w of p.wrongBook) {
          if (w && w.fromImport === batchId) {
            upsertWrongEntry(key, { ...w, fromImport: batchId, historical: true })
          }
        }
      } catch { /* 镜像失败不影响补录主链路 */ }
    }
    return { batchId: accepted.length ? batchId : null, accepted: accepted.length, acceptedItems: accepted, conflicts, rejected, total: list.length }
  }

  /** 按批次撤销：只删 source==='import' ∧ importMeta.batchId===batchId 的 history 条目
   *  与 fromImport===batchId 且**仅由补录产生**的错题（在线答错的同指纹题不动）。 */
  function undo(batchId: string, wsRaw: any) {
    if (!batchId) return { error: '缺少 batchId' }
    const p = loadProgress(wsRaw)
    p.importBatches = p.importBatches || {}
    const batch = p.importBatches[batchId]
    if (!batch) return { error: '批次不存在或已过撤销窗口（环形 30）', batchId }
    const before = (p.history || []).length
    p.history = (p.history || []).filter((h: any) => !(h.source === 'import' && h.importMeta && h.importMeta.batchId === batchId))
    const removedHistory = before - p.history.length
    let removedWrong = 0
    p.wrongBook = (p.wrongBook || []).filter((w: any) => {
      if (w.fromImport === batchId && !w.historicalOnline) { removedWrong++; return false }
      return true
    })
    for (const s of batch.sigs || []) delete p.importedSigs[s]
    delete p.importBatches[batchId]
    saveProgress(wsRaw, p)
    // v9：实体表同步软删 + 库侧错题删除
    // （只软删批次而不删库内错题 → 读路径库优先时「撤销了又回来」，是双写不一致的经典形态）
    try {
      const key = store.wsKey ? store.wsKey(wsRaw) : String(wsRaw || 'default')
      undoSImportBatch(poolDb(), key, batchId)
      for (const s of batch.sigs || []) removeWrongEntry(key, String(s))
    } catch { /* 镜像失败不影响撤销主链路 */ }
    return { undone: true, batchId, removedHistory, removedWrong }
  }

  /** 补录台账摘要（UI 批次列表 / 撤销入口；v9 库优先 + JSON 降级） */
  function batches(wsRaw: any) {
    const p = loadProgress(wsRaw)
    const key = store.wsKey ? String(store.wsKey(wsRaw)) : String(wsRaw || 'default')
    const read = readImportBatches(key, p.importBatches)
    const importedCount = (p.history || []).filter((h: any) => h.source === 'import').length
    return {
      batches: read.list.map((b: any) => ({
        batchId: b.batchId, at: b.at, count: b.count, source: b.source || null,
        status: b.status || 'active', items: b.items == null ? b.count : b.items,
      })),
      importedTotal: importedCount,
      undoWindow: 30,
      // 来源可观测（前端/白盒能看出台账来自库还是 JSON 降级）
      tier: read.tier,
    }
  }

  return { handle, search, searchAsync, addEntries, undo, batches }

  /** HTTP 域入口（域链分发约定：未接管返回 undefined） */
  async function handle(path: string, params: any, post: any, method: string, wsRaw: any) {
    if (!path.startsWith('/api/history/')) return undefined
    if (path === '/api/history/search' && method === 'GET') {
      return await searchAsync(params.get('q') || '', params.get('module') || '', Math.min(30, parseInt(params.get('limit') || '12')))
    }
    if (path === '/api/history/entries' && method === 'POST') return addEntries(post, wsRaw)
    if (path === '/api/history/undo' && method === 'POST') return undo(post && post.batchId, wsRaw)
    if (path === '/api/history/batches' && method === 'GET') return batches(wsRaw)
    return undefined
  }
}
