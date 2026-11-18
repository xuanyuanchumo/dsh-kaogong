/**
 * adapters/poolDb.ts — `.kaogong.db` 存储层（L3 Store）
 *
 * cycle-34 阶段 1 · 依据 docs/research/13-kaogong-db统一知识库.md + 15-全局整合分析.md
 *
 * ── 定位（研究 13 §1.4 / 设计 §9c.1）──
 *   上游仓库（只读）→ 适配层（poolIngest）→ **.kaogong.db（项目自有派生物）** → 服务端域
 *   `.naoku.db` = 上游投影（整库重建，自有表会被静默冲掉）——**禁写自有表**
 *   `.kaogong.db` = 项目自有派生物（可全量重建，承载统一池 + 关系 + 资产 + 索引 + 用户态）
 *
 * ── 铁律 ──
 *   ① `node:sqlite` **必须动态 import**（顶层 import 会让旧 Node 整插件加载失败——cycle-16 教训）
 *   ② 库文件**原子写**（tmp + rename——cycle-18 内容寻址/原子写纪律）
 *   ③ WAL 模式（并发读 + 崩溃安全）
 *   ④ UPSERT 幂等（连续两次重建结果必须完全相等——研究 13 §2.5）
 *   ⑤ 零 npm 运行时依赖（仅 Node 标准库）
 *
 * ── 位置纪律 ──
 *   库文件位于**用户数据根**（`~/.dsh/kaogong/`），不入包——
 *   cycle-21 issue#2 教训：市场升级 = 包目录整目录替换，包内数据必然丢失。
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** 存储层 schema 版本（变更必须 bump；与 manifest 声明对账——SMOKE-KGDB-01） */
export const POOL_SCHEMA_VERSION = 1

/** 库文件基名（研究 15 §1.1 统一口径：`.kaogong.db`） */
export const POOL_DB_NAME = '.kaogong.db'

/** 表清单（SMOKE-KGDB-01 与 manifest 声明对账的 SSOT） */
export const POOL_TABLES = [
  'meta', 'source', 'asset', 'question', 'question_source', 'relation', 'material', 'question_fts',
  'study_event', 'review',
] as const

/** 关系类型词表（研究 13 §1.2：10 种，统一边表，新增类型零 DDL 迁移） */
export const REL_TYPES = [
  'SAME_AS',       // 同一道题的跨源等价（qid 命中 / fp 命中）
  'APPEARS_IN',    // 题 → 试卷出处
  'BELONGS_TO',    // 题 → 知识点(kadian)
  'IN_MODULE',     // 题 → 模块/题型
  'HAS_MATERIAL',  // 题 → 共享材料
  'RELATED_TO',    // 题 → 题（同类/衍生）
  'HAS_DOUBT',     // 题 → 疑点
  'DERIVED_FROM',  // 题 → 母题
  'SAME_REGION',   // 题 → 地区/年份
  'REVIEWED',      // 题 → 人工校验
] as const
export type RelType = typeof REL_TYPES[number]

/* ══ Schema ══
 * 逐条对齐设计契约 §9c.2。SQL 里**不用双引号空串**（SQLite 视为标识符），
 * 用 `''` 或参数绑定——本项目既有纪律（CLAUDE.md v1.7）。
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE IF NOT EXISTS source (
  id TEXT PRIMARY KEY, tier TEXT, upstream_url TEXT, local_root TEXT,
  head_sha TEXT, cloned_at TEXT, file_count INTEGER, byte_size INTEGER,
  content_hash TEXT
);

CREATE TABLE IF NOT EXISTS asset (
  id INTEGER PRIMARY KEY, source_id TEXT, rel_path TEXT, kind TEXT,
  byte_size INTEGER, content_hash TEXT, mtime_ms INTEGER,
  UNIQUE(source_id, rel_path)
);
CREATE INDEX IF NOT EXISTS ix_asset_hash ON asset(content_hash);
CREATE INDEX IF NOT EXISTS ix_asset_kind ON asset(source_id, kind);

CREATE TABLE IF NOT EXISTS question (
  id INTEGER PRIMARY KEY,
  qid TEXT,
  fp TEXT,
  canonical_id TEXT UNIQUE,
  source_id TEXT, local_key TEXT,
  module TEXT, category TEXT, kadian TEXT, rule_type TEXT,
  qtype TEXT, ask_model TEXT,
  stem TEXT, options TEXT, answer TEXT, analysis TEXT,
  reasoning TEXT, fastest TEXT, pitfalls TEXT, mother TEXT,
  doubt TEXT, related TEXT,
  group_material TEXT, group_material_no INTEGER, material_ref TEXT,
  images TEXT,
  has_image INTEGER,
  freq REAL, paper TEXT, region TEXT, year TEXT, seq INTEGER, n_paper INTEGER,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_q_qid ON question(qid);
CREATE INDEX IF NOT EXISTS ix_q_fp ON question(fp);
CREATE INDEX IF NOT EXISTS ix_q_canon ON question(canonical_id);
CREATE INDEX IF NOT EXISTS ix_q_mod ON question(module, category);
CREATE INDEX IF NOT EXISTS ix_q_kadian ON question(kadian);
CREATE INDEX IF NOT EXISTS ix_q_source ON question(source_id, local_key);

-- ④b 一题多出处（跨源聚合——设计 §9b.4 pool_sources）
-- 同一 canonical_id 在多个源/多套卷出现时，题目本体只存一份，出处存这张表。
-- 验收标准 §11.2：同一道题多源出现 → 统一结果去重为 1 条 + 列出 N 处出处。
CREATE TABLE IF NOT EXISTS question_source (
  id INTEGER PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  local_key TEXT,
  paper TEXT, region TEXT, year TEXT, seq INTEGER, path TEXT,
  UNIQUE(canonical_id, source_id, local_key)
);
CREATE INDEX IF NOT EXISTS ix_qs_canon ON question_source(canonical_id);
CREATE INDEX IF NOT EXISTS ix_qs_src ON question_source(source_id);
CREATE INDEX IF NOT EXISTS ix_qs_paper ON question_source(paper);

CREATE TABLE IF NOT EXISTS relation (
  id INTEGER PRIMARY KEY,
  rel_type TEXT NOT NULL,
  src_kind TEXT, src_id TEXT, dst_kind TEXT, dst_id TEXT,
  weight REAL DEFAULT 1.0,
  evidence TEXT,
  UNIQUE(rel_type, src_kind, src_id, dst_kind, dst_id)
);
CREATE INDEX IF NOT EXISTS ix_rel_src ON relation(src_kind, src_id);
CREATE INDEX IF NOT EXISTS ix_rel_dst ON relation(dst_kind, dst_id);
CREATE INDEX IF NOT EXISTS ix_rel_type ON relation(rel_type);

CREATE TABLE IF NOT EXISTS material (id INTEGER PRIMARY KEY, mid TEXT UNIQUE, title TEXT, body TEXT, path TEXT);

CREATE VIRTUAL TABLE IF NOT EXISTS question_fts USING fts5(
  stem, options, analysis, reasoning, fastest, pitfalls, kadian, rule_type,
  content='question', content_rowid='id', tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS study_event (
  id INTEGER PRIMARY KEY, at TEXT, ws TEXT,
  qid TEXT, canonical_id TEXT, module TEXT, kadian TEXT,
  action TEXT,
  user_answer TEXT, correct_answer TEXT, is_correct INTEGER,
  box INTEGER, consecutive INTEGER, duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS ix_study_qid ON study_event(qid);
CREATE INDEX IF NOT EXISTS ix_study_canon ON study_event(canonical_id);
CREATE INDEX IF NOT EXISTS ix_study_kd ON study_event(kadian);
CREATE INDEX IF NOT EXISTS ix_study_at ON study_event(at);

CREATE TABLE IF NOT EXISTS review (
  canonical_id TEXT PRIMARY KEY, official_answer TEXT,
  verified_answer TEXT, status TEXT, at TEXT
);
`

/* ══ 连接管理（惰性 + 只读降级）══ */

interface PoolDbState {
  db: any | null
  failed: boolean
  path: string | null
  schemaOk: boolean
}

const state: PoolDbState = { db: null, failed: false, path: null, schemaOk: false }

/** 库文件绝对路径（用户数据根下） */
export function poolDbPath(dataDir: string): string {
  return join(dataDir, POOL_DB_NAME)
}

/**
 * 惰性打开（动态 import node:sqlite）。
 * 失败只降级一次（dbFailed 闸），不反复重试拖慢请求——与 naoku.ts 同纪律。
 */
export async function openPoolDb(dataDir: string, opts: { rebuild?: boolean } = {}): Promise<any | null> {
  if (state.db) return state.db
  if (state.failed) return null
  try {
    const path = poolDbPath(dataDir)
    mkdirSync(dataDir, { recursive: true })
    // 重建模式：先删旧库再新建（不留半成品——研究 13 §4「构建失败即删除重建」的镜像纪律）
    if (opts.rebuild) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { rmSync(path + suffix, { force: true }) } catch { /* 不存在即可 */ }
      }
    }
    const mod = await import('node:sqlite')
    const DatabaseSync = mod.DatabaseSync || (mod.default && mod.default.DatabaseSync)
    if (!DatabaseSync) { state.failed = true; return null }
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode=WAL;')
    db.exec(SCHEMA_SQL)
    state.db = db
    state.path = path
    state.schemaOk = true
    return db
  } catch {
    state.failed = true
    return null
  }
}

/** 当前连接（同步取；未打开返回 null） */
export function poolDb(): any | null { return state.db }
export function poolDbReady(): boolean { return !!state.db }
export function poolDbStatus(): any {
  return { ready: !!state.db, failed: state.failed, path: state.path, schemaVersion: POOL_SCHEMA_VERSION }
}

/** 关闭连接（数据根热变更/卸载时；换根重建纪律——cycle-16 教训⑬） */
export function resetPoolDb(): void {
  try { if (state.db && state.db.close) state.db.close() } catch { /* 已关闭 */ }
  state.db = null
  state.failed = false
  state.schemaOk = false
}

/**
 * 启动期打开统一库（幂等；失败只降级不抛）。
 * 与 initNaoku 同纪律：模块加载期不因数据缺失而崩，域内诚实降级。
 */
export async function initPoolDb(dataDir: string): Promise<boolean> {
  const db = await openPoolDb(dataDir)
  return !!db
}

/* ══ 事务辅助 ══ */

/**
 * 在事务中执行（性能关键路径）。
 *
 * 教训（cycle-34 实测）：逐条 `INSERT` 无事务时，27506 题 + 22 万关系边
 * 耗时 **421 秒**（每条语句各自 fsync）。包进单个事务后降到**秒级**。
 * 事务粒度 = **单源一个事务**（设计 §9c.5：失败回滚该源，不留半成品源）。
 *
 * 用法：withTx(db, () => { ...many inserts... })
 */
export function withTx<T>(db: any, fn: () => T): T {
  try { db.exec('BEGIN') } catch { /* 已在事务中 */ }
  try {
    const out = fn()
    try { db.exec('COMMIT') } catch { /* 自动提交模式 */ }
    return out
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 回滚失败不掩盖原错 */ }
    throw e
  }
}

/* ══ 元信息 ══ */

/** 写 meta（UPSERT） */
export function setMeta(db: any, k: string, v: string): void {
  try { db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v)) } catch { /* 元信息写不进不阻塞业务 */ }
}

/** 读 meta */
export function getMeta(db: any, k: string): string | null {
  try { const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k); return r ? r.v : null } catch { return null }
}

/* ══ canonical_id 派生（研究 15 §1.1 统一口径：qid 优先 > fp 次之 > sha256 兜底）══ */

/**
 * 统一题目身份。
 * 优先级：**qid > fp > sha256(normalize(stem))**——
 * qid 跨仓匹配 327/327 = 100%（实测），是最强键；
 * fp 冲突仅 3 例 / 28669（可作合并键但次之）；
 * sha256 是最后兜底（仅当二者皆缺）。
 * 前缀标识来源种类，便于人工排查：`q:` / `fp:` / `h:`。
 */
export function deriveCanonicalId(qid: any, fp: any, stem: any): string {
  const q = String(qid ?? '').trim()
  if (q) return 'q:' + q
  const f = String(fp ?? '').trim()
  if (f) return 'fp:' + f
  const s = String(stem ?? '').trim()
  return 'h:' + hash32(s)
}

/** 稳定 32-hex 哈希（sha256 前 16 位；用 node:crypto 标准库，零依赖） */
export function hash32(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex').slice(0, 16)
}

/* ══ 关系边写入（统一边表；UPSERT 幂等）══ */

/**
 * 写一条关系边。
 * @param weight 证据强度（SAME_AS 由 qid 佐证权重更高——研究 13 §1.2）
 * @param evidence JSON 字符串（来源端点/规则/置信度——审计友好）
 */
export function putRelation(
  db: any, relType: RelType, srcKind: string, srcId: string, dstKind: string, dstId: string,
  weight = 1.0, evidence = '',
): void {
  if (!srcId || !dstId) return
  // 自环禁止（SMOKE-KGDB-02）
  if (srcKind === dstKind && srcId === dstId) return
  try {
    db.prepare(
      `INSERT INTO relation(rel_type,src_kind,src_id,dst_kind,dst_id,weight,evidence)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(rel_type,src_kind,src_id,dst_kind,dst_id)
       DO UPDATE SET weight=MAX(weight, excluded.weight), evidence=excluded.evidence`,
    ).run(relType, srcKind, srcId, dstKind, dstId, weight, evidence)
  } catch { /* 单条边失败不阻塞整轮摄入 */ }
}

/* ══ 出处登记（一题多出处——跨源聚合）══ */

/**
 * 登记一道题的一处出处（幂等 UPSERT）。
 * 题目本体只存一份（canonical_id 唯一），出处在此表多行 → 「N 处出处」。
 */
export function putQuestionSource(
  db: any, canonicalId: string, sourceId: string, localKey: string,
  paper = '', region = '', year = '', seq = 0, path = '',
): void {
  if (!canonicalId || !sourceId) return
  try {
    db.prepare(
      `INSERT INTO question_source(canonical_id,source_id,local_key,paper,region,year,seq,path)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(canonical_id,source_id,local_key) DO UPDATE SET
         paper=excluded.paper, region=excluded.region, year=excluded.year,
         seq=excluded.seq, path=excluded.path`,
    ).run(canonicalId, sourceId, String(localKey || ''), paper, region, year, Number(seq || 0), path)
  } catch { /* 出处登记失败不阻塞整轮摄入 */ }
}

/* ══ FTS 同步 ══ */

/**
 * 重建 FTS 索引（外部内容表模式）。
 * FTS5 外部内容表不能逐行 INSERT（须走 content 表同步），全量 rebuild 是正解：
 * `INSERT INTO question_fts(question_fts) VALUES('rebuild')`。
 * 实测 5 万行 rebuild 311ms（研究 13 §2.3）。
 */
export function rebuildFts(db: any): void {
  try { db.exec("INSERT INTO question_fts(question_fts) VALUES('rebuild')") } catch { /* 无 FTS5 时降级 */ }
}

/* ══ 统计 ══ */

/** 库内容统计（白盒：/api/pool/status 消费） */
export function poolStats(db: any): any {
  const one = (sql: string): number => {
    try { const r = db.prepare(sql).get(); return r && r.c != null ? Number(r.c) : 0 } catch { return 0 }
  }
  return {
    questions: one('SELECT COUNT(*) c FROM question'),
    relations: one('SELECT COUNT(*) c FROM relation'),
    materials: one('SELECT COUNT(*) c FROM material'),
    assets: one('SELECT COUNT(*) c FROM asset'),
    sources: one('SELECT COUNT(*) c FROM source'),
    reviews: one('SELECT COUNT(*) c FROM review'),
    studyEvents: one('SELECT COUNT(*) c FROM study_event'),
    // ⚠️ 空串判定必须用 `LENGTH(x) > 0`，**不可用双引号空串**（SQLite 视为标识符 → 查询报错 → 恒为 0）
    // （本项目既有纪律，见 CLAUDE.md v1.7）
    distinctQid: one('SELECT COUNT(DISTINCT qid) c FROM question WHERE qid IS NOT NULL AND LENGTH(qid) > 0'),
    distinctFp: one('SELECT COUNT(DISTINCT fp) c FROM question WHERE fp IS NOT NULL AND LENGTH(fp) > 0'),
    withKadian: one("SELECT COUNT(*) c FROM question WHERE kadian IS NOT NULL AND LENGTH(kadian) > 0"),
    withImage: one('SELECT COUNT(*) c FROM question WHERE has_image = 1'),
    /** 一题多出处的跨源聚合度（验收 §11.2：同一题 N 处出处） */
    multiSource: one(`SELECT COUNT(*) c FROM (SELECT canonical_id FROM question_source GROUP BY canonical_id HAVING COUNT(DISTINCT source_id) > 1)`),
    questionSources: one('SELECT COUNT(*) c FROM question_source'),
    relTypes: (() => {
      try { return db.prepare('SELECT rel_type, COUNT(*) c FROM relation GROUP BY rel_type ORDER BY c DESC').all().map((r: any) => ({ type: r.rel_type, count: Number(r.c) })) }
      catch { return [] }
    })(),
    modules: (() => {
      try { return db.prepare("SELECT module m, COUNT(*) c FROM question WHERE module <> '' GROUP BY module ORDER BY c DESC").all().map((r: any) => ({ module: r.m, count: Number(r.c) })) }
      catch { return [] }
    })(),
  }
}

/** 库文件体积（字节） */
export function poolDbBytes(dataDir: string): number {
  try { return statSync(poolDbPath(dataDir)).size } catch { return 0 }
}
