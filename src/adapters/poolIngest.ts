/**
 * adapters/poolIngest.ts — 统一池摄入编排（L2 Adapter → L3 Store）
 *
 * cycle-34 阶段 1 · 依据设计契约 §9c.3「各源适配规范」
 * cycle-61 v9-b 重构：**原子重建 + 真增量 + 进度上报**（修复「重建导致宿主功能失效」）
 *
 * ── 分层纪律（研究 14 L2 适配层）──
 *   适配层**知道**上游的具体格式（文件名/字段名/正则/编码）；
 *   存储层**不知道**上游格式（只认统一中间形态）；
 *   内核层**既不知道**上游格式，也**不碰**文件系统。
 *
 * ── 可扩展性（cycle-34 用户要求）──
 *   本文件是**编排器**，源清单在 `poolSources.ts` 注册表，源实现在 `poolSourceImpls.ts`。
 *   新增一个源 = ① 写 `ingestXxxSource(ctx)` ② 注册表加一条 → **主流程零改动**。
 *
 * ── 两个历史事故（本文件的核心约束）──
 *   ① **重建阻塞宿主**：旧实现把「清库 + 全量摄入」放在 HTTP 请求的异步函数里直接跑，
 *      但内部全是**同步**读盘/SQLite 调用 → Node 单线程被独占数分钟 → 整个 DSH 宿主
 *      （所有插件、所有会话、UI 心跳）全部失去响应，用户感知「宿主功能失效/能力崩溃」。
 *      正解（v9-b）：把重建移入 **worker 线程**（`poolRebuildWorker.ts`），
 *      主线程只做作业状态机；worker 里再分片让出（见该文件）。
 *   ② **半成品库**：旧实现先 `DELETE` 并立即 COMMIT，再逐源摄入（每源各自 COMMIT）。
 *      任一源失败 → 库里只剩半套数据（真实事故：测试截断重建把生产库清空）。
 *      正解（v9-b）：**整库原子重建**——清空 + 全部源 + FTS + 元信息在**同一个事务**里，
 *      失败整体回滚，旧数据完好；WAL 下读者全程看到重建前的完整快照。
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import {
  openPoolDb, rebuildFts, setMeta, poolStats, invalidateStatsCache, clearPoolTables,
  withTxAsync, POOL_SCHEMA_VERSION,
} from './poolDb.js'
import { backfillContentFpFamilies } from './poolUpsert.js'
import { ingestAll, registrySnapshot, sourceFingerprints, SOURCE_REGISTRY, type IngestProgress, type IngestFailure } from './poolSources.js'
export { stripHtmlKeepImg, extractImages } from './poolSourceImpls.js'

export interface RebuildOpts {
  /** 是否先清空派生表（全量重建 = true；增量 = false） */
  rebuild?: boolean
  maxFiles?: number
  maxPapers?: number
  /** v9：数据变更广播钩子（server 装配时注入 emitDataChanged——L2 不认识 L4，经钩子反转依赖） */
  onDataChanged?: (entity: string, reason: string) => void
  /** v9-b：进度回调（worker 转发给主线程，透出到 /api/pool/rebuild/status） */
  onProgress?: (p: IngestProgress | { phase: string, [k: string]: any }) => void
  /** v9-b：增量模式要跳过的源（指纹未变） */
  skip?: Set<string>
  /** v9-b：增量判定诊断（透出到响应/白盒——「为什么这次是全量」必须可回答） */
  diagnostics?: any
}

/** 主源指纹（`.naoku.db` mtime；增量判据的兼容字段） */
function primaryFingerprint(dataDir: string): string {
  try { return String(statSync(join(dataDir, '.naoku.db')).mtimeMs) } catch { return '' }
}

/**
 * 全量 / 增量重建 `.kaogong.db`（**原子**：整库一个事务）。
 *
 * 幂等保证：所有写入走 UPSERT（canonical_id / mid / relation 五元组 / question_source 三元组 唯一键），
 * 连续两次重建的池条目数与边数必须完全相等（研究 13 §2.5 / SMOKE-KGDB-06c）。
 *
 * @param opts.rebuild true=清空后重建（全量）；false=在现有数据上重灌（增量/补源）
 */
export async function rebuildPool(repoRoot: string, dataDir: string, opts: RebuildOpts = {}): Promise<any> {
  const t0 = Date.now()
  const opened = await openPoolDb(dataDir, { rebuild: false })   // ⚠️ 绝不在 open 阶段清库
  if (opened.locked) {
    return {
      ok: false,
      error: '重建失败：库文件被其它进程占用（EPERM）——' + opened.lockPath +
        '。请先停掉占用方（如另一 dsh 宿主/测试进程）再重建。',
      locked: true,
      lockPath: opened.lockPath,
    }
  }
  const db = opened.db
  if (!db) return { ok: false, error: '存储层不可用（node:sqlite 缺失或库打开失败）' }

  const progress = (phase: string, extra: any = {}) => {
    try { opts.onProgress && opts.onProgress({ phase, ...extra }) } catch { /* 进度失败不影响重建 */ }
  }

  try {
    progress('prepare')
    const sources = await withTxAsync(db, async () => {
      // ① 清空（仅全量）——与后续写入同事务，失败整体回滚
      const clearing = opts.rebuild !== false
      if (clearing) {
        progress('clear')
        clearPoolTables(db)
      }
      setMeta(db, 'schema_version', String(POOL_SCHEMA_VERSION))
      setMeta(db, 'built_at', new Date().toISOString())
      setMeta(db, 'source_registry', JSON.stringify(registrySnapshot({ repoRoot, dataDir })))

      // ② 逐源摄入（progress 逐源上报；skip 集合实现真增量）
      const failures: IngestFailure[] = []
      const out = await ingestAll(
        { repoRoot, dataDir, db, opts },
        undefined,
        { skip: opts.skip, onProgress: opts.onProgress, failures },
      )

      /**
       * ③ **故障闸（cycle-61 v9-b·关键）**：全量重建清空过表，此时若有源**异常**
       * （源实现抛错 = bug/上游格式变了/IO 故障），继续提交就会永久丢掉该源原有数据。
       * 真实事故：故障注入后重建仍 `ok:true`，gk-tuxing 354 题被静默删除。
       * 处置：全量模式下一旦有 `kind:'exception'` → 抛错让事务整体回滚（宁可这次不更新，
       * 也不把用户的库改成残缺状态）。增量模式不清表，失败源原有数据仍在，跳过即安全。
       */
      const exceptions = failures.filter(f => f.kind === 'exception')
      if (clearing && exceptions.length) {
        throw Object.assign(
          new Error('有 ' + exceptions.length + ' 个源摄入失败，已整体回滚：' +
            exceptions.map(f => f.source + '（' + f.reason + '）').join('；')),
          { failures },
        )
      }

      // ④ 收尾（同一事务内）
      progress('postprocess')
      // 孤儿出处清理：cf 归并/覆盖后可能有 question_source 行指向不存在的题
      let orphanSrc = 0
      try {
        const before = (db.prepare('SELECT COUNT(*) c FROM question_source').get() as any).c
        db.exec('DELETE FROM question_source WHERE canonical_id NOT IN (SELECT canonical_id FROM question)')
        orphanSrc = before - (db.prepare('SELECT COUNT(*) c FROM question_source').get() as any).c
      } catch { /* 清理失败不阻塞重建 */ }
      // content_fp 家族富字段回填（必须在 FTS rebuild 之前：FTS 基于最终 kadian/stem 文本）
      const enrichedRows = backfillContentFpFamilies(db)
      // FTS 重建（外部内容表模式）
      rebuildFts(db)
      // USES_METHOD 边生产必须在 FTS rebuild 之后（特征短语经 question_fts 反查命中题）
      try {
        const { produceUsesMethodEdges } = await import('./poolSourceKnowledge.js')
        const um = produceUsesMethodEdges({ db })
        if (um && um.relations) out['uses-method'] = um
      } catch { /* USES_METHOD 生产失败不阻塞 rebuild 主链路 */ }

      // ④ 元信息（事务内写，随重建一起提交）
      const stats = poolStats(db)
      setMeta(db, 'ingest_stats', JSON.stringify(out))
      setMeta(db, 'source_fingerprint', primaryFingerprint(dataDir))
      // v9-b：逐源指纹（增量重建的判据；随本次重建一起提交，保证「指纹 ≡ 数据」）
      try { setMeta(db, 'source_fingerprints', JSON.stringify(sourceFingerprints({ repoRoot, dataDir, db, opts }))) }
      catch { /* 指纹写失败 → 下次增量保守全量 */ }
      const totalQ = Object.values(out).reduce((s: number, x: any) => s + ((x && x.questions) || 0), 0)
      setMeta(db, 'pool_size', String(totalQ) + ':' + String(stats.relations))
      return { out, stats, orphanSrc, enrichedRows, failures }
    })

    // ⑤ 事务已提交 → 才广播失效（提交前广播会让别的读者去重算「尚未可见」的新数据）
    invalidateStatsCache('rebuild')
    if (typeof opts.onDataChanged === 'function') {
      try { opts.onDataChanged('question', 'rebuild') } catch { /* 失效失败降级为下次重算 */ }
    }
    progress('done', { elapsedMs: Date.now() - t0 })
    return {
      ok: true, schemaVersion: POOL_SCHEMA_VERSION, elapsedMs: Date.now() - t0,
      sources: sources.out, stats: sources.stats,
      orphanCleaned: sources.orphanSrc, enrichedRows: sources.enrichedRows,
    }
  } catch (e: any) {
    // 事务已整体回滚 → 旧数据完好（这是与旧实现最本质的区别）
    progress('failed', { error: String((e && e.message) || e) })
    return { ok: false, error: '重建失败（已回滚，旧数据未受影响）: ' + (e && e.message ? e.message : String(e)), rolledBack: true }
  }
}

/**
 * 增量重建：按**逐源指纹**跳过未变化的源，只重灌变化源（旧实现名为增量、实为全量重灌）。
 *
 * 判定：
 *   1. `meta.source_fingerprints` 与当前实际指纹逐源比对 → 未变源进 skip 集合；
 *   2. 全部未变 → 直接返回 `skipped:true`（零写入，毫秒级）；
 *   3. 有变化 → 原子增量重建（不清库，只 upsert 变化源；失败整体回滚）。
 *
 * 兼容：旧库只有单值 `source_fingerprint` 时，退化为「整体比对」（未变即跳过，变了全量重灌）。
 */
export async function incrementalRebuild(repoRoot: string, dataDir: string, opts: RebuildOpts = {}): Promise<any> {
  const opened = await openPoolDb(dataDir, { rebuild: false })
  const db = opened.db
  if (!db) return { ok: false, error: '存储层不可用' }
  const progress = (phase: string, extra: any = {}) => {
    try { opts.onProgress && opts.onProgress({ phase, ...extra }) } catch { /* ignore */ }
  }
  try {
    progress('fingerprint')
    const current = sourceFingerprints({ repoRoot, dataDir, db, opts })
    let prev: Record<string, string> | null = null
    let prevRaw = false
    let prevParseError = ''
    try {
      const row = db.prepare("SELECT v FROM meta WHERE k='source_fingerprints'").get() as any
      if (row && row.v) {
        prevRaw = true
        try { prev = JSON.parse(String(row.v)) } catch (e: any) { prevParseError = String((e && e.message) || e) }
      }
    } catch (e: any) { prevParseError = 'meta 读取失败: ' + String((e && e.message) || e) }

    const skip = new Set<string>()
    // v9-b：诊断（「为什么这次要走全量」必须可回答——旧实现静默全量重灌，无法排查）
    const diag: any = { hasPrev: !!prev, prevRaw, prevParseError, currentSources: Object.keys(current).length }

    if (prev && typeof prev === 'object') {
      for (const [id, fp] of Object.entries(current)) if (prev[id] && prev[id] === fp) skip.add(id)
      const changed = Object.keys(current).filter(id => !skip.has(id))
      diag.skipped = [...skip]
      diag.changed = changed
      if (!changed.length) {
        return { ok: true, skipped: true, reason: '全部源指纹未变（真增量跳过，零写入）', changed: [], diagnostics: diag, stats: poolStats(db) }
      }
      return await rebuildPool(repoRoot, dataDir, { ...opts, rebuild: false, skip, diagnostics: diag })
    }

    // 旧库兼容：单值指纹（历史上只跟踪 .naoku.db mtime）
    let fp = ''
    try { fp = String(statSync(join(dataDir, '.naoku.db')).mtimeMs) } catch { fp = '' }
    const prevOne = (() => { try { const r = db.prepare("SELECT v FROM meta WHERE k='source_fingerprint'").get() as any; return r ? r.v : '' } catch { return '' } })()
    diag.legacyPrev = String(prevOne).slice(0, 24)
    diag.legacyCurrent = String(fp).slice(0, 24)
    if (prevOne && fp && prevOne === fp) {
      return { ok: true, skipped: true, reason: '主源指纹未变（旧库口径跳过；下次重建会升级为逐源指纹）', diagnostics: diag, stats: poolStats(db) }
    }
    return await rebuildPool(repoRoot, dataDir, { ...opts, rebuild: false, diagnostics: diag })
  } catch (e: any) {
    return { ok: false, error: '增量重建失败: ' + (e && e.message ? e.message : String(e)) }
  }
}

/** 注册表快照（白盒透出） */
export { registrySnapshot, SOURCE_REGISTRY }
