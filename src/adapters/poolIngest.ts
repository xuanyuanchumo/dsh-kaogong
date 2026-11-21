/**
 * adapters/poolIngest.ts — 统一池摄入编排（L2 Adapter → L3 Store）
 *
 * cycle-34 阶段 1 · 依据设计契约 §9c.3「各源适配规范」
 *
 * ── 分层纪律（研究 14 L2 适配层）──
 *   适配层**知道**上游的具体格式（文件名/字段名/正则/编码）；
 *   存储层**不知道**上游格式（只认统一中间形态）；
 *   内核层**既不知道**上游格式，也**不碰**文件系统。
 *
 * ── 可扩展性（cycle-34 用户要求）──
 *   本文件是**编排器**，源清单在 `poolSources.ts` 注册表，源实现在 `poolSourceImpls.ts`。
 *   新增一个源 = ① 写 `ingestXxxSource(ctx)` ② 注册表加一条 → **主流程零改动**。
 *   （若把源清单写死在本文件，每加一个源都要改主流程 = 改一处漏十处的反模式。）
 *
 * ── 归一铁律（设计 §9c.3 三条，由各源实现遵守）──
 *   ① 图片只引用不复制  ② HTML 剥除必须枚举字段（img 占位保留）  ③ 可空字段不臆造
 *
 * ── 本轮源（研究 13 §2.3 / 设计 §9c.6 K-1）──
 *   ① naoku（`.naoku.db` 上游投影，只读）—— 27506 题 + 五维标注 + 58890 出处
 *   ② xingcezhenti（md 目录）—— qid 直取上游，跨源 SAME_AS 边的来源
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { openPoolDb, rebuildFts, setMeta, poolStats, withTx, invalidateStatsCache, POOL_SCHEMA_VERSION } from './poolDb.js'
import { ingestAll, registrySnapshot, SOURCE_REGISTRY } from './poolSources.js'

export { stripHtmlKeepImg, extractImages } from './poolSourceImpls.js'

/**
 * 全量重建 `.kaogong.db`。
 *
 * 幂等保证：所有写入走 UPSERT（canonical_id / mid / relation 五元组 / question_source 三元组 唯一键），
 * 连续两次重建的池条目数与边数必须完全相等（研究 13 §2.5 / SMOKE-KGDB-06c）。
 *
 * 性能纪律（cycle-34 实测）：**单源一个事务**——逐条 INSERT 无事务时
 * 27506 题 + 22 万关系边耗时 421 秒（每条各自 fsync），事务内降到 41 秒。
 */
export async function rebuildPool(repoRoot: string, dataDir: string, opts: { rebuild?: boolean; maxFiles?: number; maxPapers?: number } = {}): Promise<any> {
  const t0 = Date.now()
  const opened = await openPoolDb(dataDir, { rebuild: opts.rebuild !== false })
  if (opened.locked) {
    // 重建语义不可达（旧库被其它进程持有——典型：宿主 link: 同库文件，测试进程重建）
    // 响亮失败并给**可操作**的根因提示（白盒可观测：不说「失败」，说「为什么失败、怎么解」）
    return {
      ok: false,
      error: '重建失败：库文件被其它进程占用（EPERM）——' + opened.lockPath +
        '。请先停掉占用方（如另一 dsh 宿主/测试进程）再重建，或改用 incremental 模式。',
      locked: true,
      lockPath: opened.lockPath,
    }
  }
  const db = opened.db
  if (!db) return { ok: false, error: '存储层不可用（node:sqlite 缺失或库打开失败）' }
  try {
    setMeta(db, 'schema_version', String(POOL_SCHEMA_VERSION))
    setMeta(db, 'built_at', new Date().toISOString())
    // 源注册表快照（可观测：白盒透出「已注册哪些源、各自可用性」）
    setMeta(db, 'source_registry', JSON.stringify(registrySnapshot({ repoRoot, dataDir })))
    const sources = await ingestAll({ repoRoot, dataDir, db, opts })
    // cycle-43（评审修复）：清理孤儿出处——cf 归并/覆盖后可能有 question_source 行的
    // canonical_id 已不在 question 表（评审实测 1987 条）。rebuild 后立即清理，
    // 保证「每题必有出处，出处必指向存在的题」不变量（issue #5 POOL-02「出处完整」）。
    let orphanSrc = 0
    try {
      const before = (db.prepare('SELECT COUNT(*) c FROM question_source').get() as any).c
      db.exec('DELETE FROM question_source WHERE canonical_id NOT IN (SELECT canonical_id FROM question)')
      orphanSrc = before - (db.prepare('SELECT COUNT(*) c FROM question_source').get() as any).c
    } catch { /* 清理失败不阻塞重建 */ }
    // FTS 重建（外部内容表模式；实测 5 万行 311ms）
    rebuildFts(db)
    // cycle-46：USES_METHOD 边生产必须在 FTS rebuild **之后**（特征短语经 question_fts
    // 反查命中题——FTS 空表时全跳过=静默 0 边。曾内联在 ingestKadianNodes 时序错误，
    // rebuild 实测 0 边的根因；抽为独立函数由本处显式调用）。
    try {
      const { produceUsesMethodEdges } = await import('./poolSourceKnowledge.js')
      const um = produceUsesMethodEdges({ db })
      if (um && um.relations) sources['uses-method'] = um
    } catch { /* USES_METHOD 生产失败不阻塞 rebuild 主链路 */ }
    const stats = poolStats(db)
    setMeta(db, 'ingest_stats', JSON.stringify(sources))
    const totalQ = Object.values(sources).reduce((s: number, x: any) => s + ((x && x.questions) || 0), 0)
    setMeta(db, 'source_fingerprint', String(totalQ) + ':' + String(stats.relations))
    // cycle-36 O1：数据已变更 → 统计快照全部失效（下次查询重算，保证口径新鲜）
    invalidateStatsCache('rebuild')
    return {
      ok: true, schemaVersion: POOL_SCHEMA_VERSION, elapsedMs: Date.now() - t0,
      sources, stats, orphanCleaned: orphanSrc,
    }
  } catch (e: any) {
    return { ok: false, error: '重建失败: ' + (e && e.message ? e.message : String(e)) }
  }
}

/**
 * 增量重建（按源指纹判定是否需重解析）。
 * 指纹 = 池内题数 + 关系边数（`meta.source_fingerprint`）；未变则跳过。
 */
export async function incrementalRebuild(repoRoot: string, dataDir: string): Promise<any> {
  const opened = await openPoolDb(dataDir)
  const db = opened.db
  if (!db) return { ok: false, error: '存储层不可用' }
  try {
    let fp = ''
    try { fp = String(statSync(join(dataDir, '.naoku.db')).mtimeMs) } catch { fp = '' }
    const prev = (() => { try { const r = db.prepare("SELECT v FROM meta WHERE k='source_fingerprint'").get(); return r ? r.v : '' } catch { return '' } })()
    if (prev && fp && prev === fp) {
      return { ok: true, skipped: true, reason: '源指纹未变（增量跳过）', stats: poolStats(db) }
    }
    return await rebuildPool(repoRoot, dataDir, { rebuild: false })
  } catch (e: any) {
    return { ok: false, error: '增量重建失败: ' + (e && e.message ? e.message : String(e)) }
  }
}

/** 注册表快照（白盒透出） */
export { registrySnapshot, SOURCE_REGISTRY }
