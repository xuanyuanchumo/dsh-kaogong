/**
 * server/historyApi.ts — 纸质刷题记录补录域（cycle-21 · issue #3 第一阶段）
 *
 * 用户旅程：纸质资料（粉笔 5000 题等）已做过题 → 在现有题库中**搜索同题** →
 * 核对候选（题干/选项/来源）→ 补录「已做·对/错/结果未知」→ 错题自动进错题本 →
 * 同批次可撤销。
 *
 * 设计纪律（来自 issue #3 的验收口径）：
 *  - 稳定标识：候选匹配用「内容指纹」（module|stem 前 120 字 sha1，与 srs.questionSig 同源）
 *    ——不依赖抽题随机 id。
 *  - 统计隔离：补录记 progress.history 带 `source:'import'`；statsSnapshot/今日新刷
 *    口径排除 import 条目（历史归历史，不污染今日打卡）；原始作答日期未知 → 保留未知
 *    （history 条目 date 仅记导入日且带 historical 标记）。
 *  - 幂等：同批次内指纹去重；同题已补录过（progress.importedSigs）→ 冲突提示不重复计数。
 *  - 可撤销：批次 id + undo 端点按批次回滚（只动 import 条目，绝不动在线作答）。
 *  - 只有对错没有选项：允许 result=unknown / 无所选答案（纸上只有叉号也能录）。
 */
import { createHash } from 'node:crypto'
import { naokuQuestions, naokuReady, searchQuestionsByStem } from '../adapters/naoku.js'
import { getRandomQuestions, XINGCE_MODULES } from '../adapters/repoData.js'
import { buildPaperIndex, loadPaper } from '../adapters/paperData.js'

const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/** 内容指纹（与 srs.questionSig 同算法：module|stem前120字 → sha1 12位）——跨进程稳定 */
function contentSig(module: string, stem: string): string {
  return createHash('sha1').update((module || '') + '|' + (stem || '').slice(0, 120)).digest('hex').slice(0, 12)
}

/** 题干规范化（搜索比对用：去空白差异） */
function normStem(s: string): string {
  return String(s || '').replace(/\s+/g, '').toLowerCase()
}

/** 本地今日（北京时间语义由宿主机时区决定，与 /api/check 同口径 ISO 日期） */
function today(): string { return new Date().toISOString().slice(0, 10) }

export function makeHistoryApi({ store, repoRoot = '' }: { store: any, repoRoot?: string }) {
  const { loadProgress, saveProgress } = store
  /** 目录题库扫描用的 repoRoot（装配层注入；数据根切换时随 rebuildDomains 重建） */
  let repoRootRef: string = repoRoot

  /** 在现有题库中搜索候选题（naoku 深度题库优先，xingcezhenti 目录题库兜底）
   *  返回条目带 contentSig + 来源标注，UI 直接展示核对。 */
  function search(q: string, module: string, limit: number) {
    const kw = String(q || '').trim()
    if (!kw) return { keyword: kw, list: [], hint: '输入题干关键词（≥2 字）' }
    const wantModule = module && XINGCE_MODULES[module] ? module : ''
    const list: any[] = []
    const seen = new Set<string>()
    // 1) 深度题库（27506 题，五维标注；DB LIKE 全量搜索，非截取；不可用时自动跳过）
    if (naokuReady()) {
      for (const r of searchQuestionsByStem(kw, limit * 2, storeRepoRoot())) {
        const stem = String(r.stem || '').replace(/【图:kgimg:\/\/[^\]】]+】/g, '')
        if (!normStem(stem).includes(normStem(kw))) continue
        if (wantModule && r.module !== wantModule) continue
        const sig = contentSig(r.module, r.stem)
        if (seen.has(sig)) continue
        seen.add(sig)
        list.push({ ...r, contentSig: sig, matchSource: 'naoku' })
        if (list.length >= limit) break
      }
    }
    // 2) 目录题库兜底（xingcezhenti 各模块逐文件扫描，限深保响应时间）
    if (list.length < limit) {
      for (const mod of Object.keys(XINGCE_MODULES)) {
        if (wantModule && mod !== wantModule) continue
        const picked = getRandomQuestions(storeRepoRoot(), mod, 12)
        for (const r of (picked.questions || [])) {
          const stem = String(r.stem || '').replace(/【图:kgimg:\/\/[^\]】]+】/g, '')
          if (!normStem(stem).includes(normStem(kw))) continue
          const sig = contentSig(r.module, r.stem)
          if (seen.has(sig)) continue
          seen.add(sig)
          list.push({ ...r, contentSig: sig, matchSource: 'xingcezhenti' })
          if (list.length >= limit) break
        }
        if (list.length >= limit) break
      }
    }
    // 3) 真题卷全文扫描（cycle-33 P0：issue#3「好像没实现」的根治通道）——
    //    根因：①naoku DB 由 GongkaoNaoku 的 Python 合并脚本生成，只装真题库的用户恒缺 → 通道①恒空；
    //    ②目录兜底用 getRandomQuestions 随机抽 12 题再过滤关键词 → 命中率≈0（兜底形同虚设）。
    //    本通道复用 buildPaperIndex（磁盘快照 13ms）+ loadPaper（~18ms/卷）逐卷扫描，
    //    行测卷按年份倒序、找满 limit 早停、maxPapers 上限控响应时间；结果带 paperId/exam/year/no
    //    溯源元数据（用户可回原卷核对）。守卫 C33-01。
    if (list.length < limit) {
      try {
        const idx = buildPaperIndex(storeRepoRoot())
        const papers = (idx.papers || [])
          .filter((p: any) => p.subject === '行测')
          .sort((a: any, b: any) => (b.year || 0) - (a.year || 0))
          .slice(0, 80)   // 最坏 ~1.4s（80 × 18ms）；早停常见 <10 卷
        for (const pp of papers) {
          if (list.length >= limit) break
          let detail: any = null
          try { detail = loadPaper(storeRepoRoot(), pp.id) } catch { continue }
          for (const q of (detail && detail.questions) || []) {
            const stem = String(q.stem || '').replace(/【图:kgimg:\/\/[^\]】]+】/g, '')
            if (!normStem(stem).includes(normStem(kw))) continue
            if (wantModule && q.module !== wantModule) continue
            const sig = contentSig(q.module || pp.subject, q.stem)
            if (seen.has(sig)) continue
            seen.add(sig)
            list.push({
              ...q, contentSig: sig, matchSource: 'papers',
              paperId: pp.id, exam: pp.exam || detail.exam, year: pp.year || detail.year, paperFile: pp.id.split('/').pop(),
            })
            if (list.length >= limit) break
          }
        }
      } catch { /* 真题库不可用：静默跳过（前两通道结果仍有效） */ }
    }
    return { keyword: kw, module: wantModule || null, list, total: list.length }
  }

  /** 目录题库扫描用的 repoRoot 引用 */
  function storeRepoRoot(): string { return repoRootRef }

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
            lastAt: Date.now(), historical: true, fromImport: batchId,
          })
        } else { exist.wrongCount++; exist.lastAt = Date.now(); exist.fromImport = exist.fromImport || batchId }
      }
      accepted.push({ sig, result, stem: String(q.stem).slice(0, 40) })
    }
    if (accepted.length) {
      p.importedSigs[batchId] = undefined // 占位防误用（台账按 sig 记）
      for (const a of accepted) p.importedSigs[a.sig] = batchId
      p.importBatches[batchId] = { at: Date.now(), sigs: accepted.map(a => a.sig), count: accepted.length, source: post.source || null }
      // 台账环形：批次最多留 30（撤销窗口），超限淘汰最旧（其 sigs 台账保留，仅批次索引淘汰）
      const bKeys = Object.keys(p.importBatches)
      if (bKeys.length > 30) for (const k of bKeys.slice(0, bKeys.length - 30)) delete p.importBatches[k]
      saveProgress(wsRaw, p)
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
    return { undone: true, batchId, removedHistory, removedWrong }
  }

  /** 补录台账摘要（UI 批次列表 / 撤销入口） */
  function batches(wsRaw: any) {
    const p = loadProgress(wsRaw)
    const list = entries(p.importBatches || {})
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .map(([id, b]) => ({ batchId: id, at: b.at, count: b.count, source: b.source || null }))
    const importedCount = (p.history || []).filter((h: any) => h.source === 'import').length
    return { batches: list, importedTotal: importedCount, undoWindow: 30 }
  }

  return { handle, search, addEntries, undo, batches }

  /** HTTP 域入口（域链分发约定：未接管返回 undefined） */
  function handle(path: string, params: URLSearchParams, post: any, method: string, wsRaw: any) {
    if (!path.startsWith('/api/history/')) return undefined
    if (path === '/api/history/search' && method === 'GET') {
      return search(params.get('q') || '', params.get('module') || '', Math.min(30, parseInt(params.get('limit') || '12')))
    }
    if (path === '/api/history/entries' && method === 'POST') return addEntries(post, wsRaw)
    if (path === '/api/history/undo' && method === 'POST') return undo(post && post.batchId, wsRaw)
    if (path === '/api/history/batches' && method === 'GET') return batches(wsRaw)
    return undefined
  }
}
