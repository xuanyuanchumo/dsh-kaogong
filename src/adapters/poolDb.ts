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
import { mkdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** 存储层 schema 版本（变更必须 bump；与 manifest 声明对账——SMOKE-KGDB-01） */
export const POOL_SCHEMA_VERSION = 5

/** 库文件基名（研究 15 §1.1 统一口径：`.kaogong.db`） */
export const POOL_DB_NAME = '.kaogong.db'

/** 表清单（SMOKE-KGDB-01 与 manifest 声明对账的 SSOT） */
export const POOL_TABLES = [
  'meta', 'source', 'asset', 'question', 'question_source', 'question_analysis', 'relation', 'material', 'knowledge',
  'question_fts', 'study_event', 'review',
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
  'USES_METHOD',   // 题 → 方法论知识节点（cycle-35：huasheng13 文档 ↔ 题；统一边表零 DDL 增补）
  'REFERENCES_DOC', // 知识节点 → 文档/资产（cycle-35：考点 MOC ↔ 原文）
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
  updated_at TEXT,
  content_fp TEXT
);
CREATE INDEX IF NOT EXISTS ix_q_qid ON question(qid);
CREATE INDEX IF NOT EXISTS ix_q_fp ON question(fp);
CREATE INDEX IF NOT EXISTS ix_q_canon ON question(canonical_id);
CREATE INDEX IF NOT EXISTS ix_q_mod ON question(module, category);
CREATE INDEX IF NOT EXISTS ix_q_kadian ON question(kadian);
CREATE INDEX IF NOT EXISTS ix_q_source ON question(source_id, local_key);
CREATE INDEX IF NOT EXISTS ix_q_cfp ON question(content_fp);
-- cycle-45（性能·研究 23 实测）：材料组索引（L0 层 sampleQuestions 首建用）。
-- 全表行拆包扫 86,534 行宽表 = 735ms/次；**部分索引**（仅 18,419 有材料行入索引页）
-- 扫描 281ms（2.6 倍）且随索引成长不随全表成长。WHERE 与查询条件一致（部分索引
-- 匹配规则：查询 WHERE 须蕴含索引 WHERE）；排序不放 SQL（索引键序是 group_material
-- 前缀，ORDER BY seq 无法利用 → 内存排序 20ms 内），首建成本由快照缓存 amortize。
CREATE INDEX IF NOT EXISTS ix_q_mat ON question(group_material, canonical_id, module, seq) WHERE group_material != '';

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
-- cycle-36 研究 17 O3b：单列索引——关系邻域查询（WHERE src_id=? OR dst_id=?）此前
-- 只能用复合索引前缀失效 → 全表扫 80-90ms/次 × 每题 detail 2 次 = questions 端点 936ms 的元凶。
-- 加独立单列索引后走 index seek（<1ms）。
CREATE INDEX IF NOT EXISTS ix_rel_src_id ON relation(src_id);
CREATE INDEX IF NOT EXISTS ix_rel_dst_id ON relation(dst_id);
CREATE INDEX IF NOT EXISTS ix_rel_type ON relation(rel_type);

-- ⑦c 解析多版本（cycle-40 · 研究 21 §2 纪律③：解析差异必须保留）
-- 跨源合并后，同一 canonical_id 的解析可能有 N 个版本（不同来源的解析质量/角度不同）。
-- question.analysis 保留「首个入库」的解析（主版本）；所有版本（含主版本）在此全量留痕，
-- 每条带 source_id 溯源——「这道题的解析有哪些版本、来自哪个题库」可查。
CREATE TABLE IF NOT EXISTS question_analysis (
  id INTEGER PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  local_key TEXT,
  analysis TEXT,
  answer TEXT,
  at TEXT,
  UNIQUE(canonical_id, source_id, local_key)
);
CREATE INDEX IF NOT EXISTS ix_qa_canon ON question_analysis(canonical_id);
CREATE INDEX IF NOT EXISTS ix_qa_src ON question_analysis(source_id);

CREATE TABLE IF NOT EXISTS material (id INTEGER PRIMARY KEY, mid TEXT UNIQUE, title TEXT, body TEXT, path TEXT);

-- ⑦b 知识节点（cycle-35 schema v2）：方法论文档 / 考点 / 技能文档作为**图节点**入库。
-- 题与知识的关联走既有 relation 统一边表（零 DDL 新增关系类型）——
-- 「这道题用哪个方法」「这个考点有哪些题」成为可 JOIN 查询。
-- kn_id 是源内稳定键（方法论 = 文档 id 如 ziliao-fenxi；考点 = kadian 全文；技能 = 文件名）。
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY,
  kn_id TEXT UNIQUE,
  kind TEXT,
  module TEXT,
  title TEXT,
  body TEXT,
  path TEXT,
  source_id TEXT,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS ix_kn_kind ON knowledge(kind, module);
CREATE INDEX IF NOT EXISTS ix_kn_src ON knowledge(source_id);

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
 *
 * ⚠️ 重建模式语义（cycle-35 v2 修正：「原地清库」替代「删文件重建」）：
 *   原 v1 设计是「先删库文件再新建」，但 Windows 上**同一进程持有连接时也锁文件**
 *   （宿主 fallback server 的连接 + WAL/SHM 句柄）→ EPERM → 重建语义不可达。
 *   v2 正解 = **原地重建**：连接保持打开，`DELETE FROM` 清空全部业务表 +
 *   重跑 SCHEMA（幂等 IF NOT EXISTS）。效果等价（库回到空白态），且：
 *   · 同进程安全（不碰文件锁）；
 *   · 跨进程仍受保护（若**其它**进程持有连接，本进程 DELETE 会遇到 SQLITE_BUSY →
 *     降级报错，语义仍响亮）。
 *   库文件损坏（真正需要删文件）的场景交给显式运维动作，不归 rebuild。
 */
export async function openPoolDb(dataDir: string, opts: { rebuild?: boolean } = {}): Promise<{ db: any | null, locked?: boolean, lockPath?: string }> {
  if (state.db && !opts.rebuild) return { db: state.db }
  if (state.failed && !opts.rebuild) return { db: null }
  try {
    const path = poolDbPath(dataDir)
    mkdirSync(dataDir, { recursive: true })
    const mod = await import('node:sqlite')
    const DatabaseSync = mod.DatabaseSync || (mod.default && mod.default.DatabaseSync)
    if (!DatabaseSync) { state.failed = true; return { db: null } }
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode=WAL;')
    db.exec(SCHEMA_SQL)
    state.db = db
    state.path = path
    state.schemaOk = true
    // 原地重建：清空全部业务表（连接保持有效，不碰文件锁）
    if (opts.rebuild) {
      try {
        db.exec('BEGIN')
        for (const t of POOL_TABLES) {
          if (t === 'question_fts') continue   // FTS 是外部内容表，DELETE 走 rebuild 指令
          try { db.exec(`DELETE FROM ${t}`) } catch { /* 表不存在 = 新库，正常 */ }
        }
        db.exec('COMMIT')
      } catch (e: any) {
        // SQLITE_BUSY = 其它进程持有写锁 → 响亮失败（重建语义不可达）
        try { db.exec('ROLLBACK') } catch { /* 回滚失败不掩盖原错 */ }
        state.db = null
        try { if (db && db.close) db.close() } catch { /* 已关闭 */ }
        return { db: null, locked: true, lockPath: path }
      }
    }
    return { db }
  } catch {
    state.failed = true
    return { db: null }
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
  const opened = await openPoolDb(dataDir)
  return !!opened.db
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
 * 统一题目身份（v2 · cycle-35 研究 16 §2.2）。
 *
 * 优先级：**qid > fp > sha256(normalize(stem))**——
 * qid 跨仓匹配 327/327 = 100%（实测），是最强键；
 * fp 冲突仅 3 例 / 28669（可作合并键但次之）；
 * sha256 是最后兜底（仅当二者皆缺）。
 *
 * ⚠️ **命名空间纪律（v2 新增）**：
 *   `qid` 不是天然全局唯一——粉笔系三仓（naoku/xingcezhenti/kaogongzhentizhengliu）
 *   **共享同一个 qid 命名空间**（跨仓 327/327 一致，这正是合并键）；
 *   但 xingce-app（id=44152）、qiuzhao（id=1001）、civil-exam-agent（id=Q_01）
 *   是**独立 id 空间**。若不同命名空间的 id 撞库，两道不同的题会被合并成一个
 *   canonical_id = **跨源身份污染**（比漏摄入严重得多）。
 *
 *   修正：独立命名空间的源，canonical_id 带源前缀（`q:<sourceId>:<qid>`）；
 *   共享命名空间（粉笔系）保持 `q:<qid>`（向后兼容，已入库数据不变）。
 *   跨源等价（独立源 ↔ 粉笔系同题）走 **SAME_AS 边**（带 evidence）——合并靠认亲，不靠重名。
 *
 * 前缀标识来源种类，便于人工排查：`q:` / `fp:` / `h:`。
 */
export function deriveCanonicalId(qid: any, fp: any, stem: any, opts: { namespace?: string, contentFp?: string } = {}): string {
  const q = String(qid ?? '').trim()
  if (q) {
    // 独立命名空间：带源前缀（永不与其它源撞库）；共享命名空间（namespace 为空）：裸 qid
    return opts.namespace ? 'q:' + opts.namespace + ':' + q : 'q:' + q
  }
  // cycle-40（研究 21）：内容指纹强合并键——**跨源同题去重**（qid 不同源天然不合并，
  // 但内容完全相同就是同一道题）。优先级仍按统一口径：qid > fp > 内容指纹 > stem 哈希。
  const cf = String(opts.contentFp ?? '').trim()
  if (cf) return 'cf:' + cf
  const f = String(fp ?? '').trim()
  if (f) return 'fp:' + f
  const s = String(stem ?? '').trim()
  return 'h:' + hash32(s)
}

/**
 * 内容指纹（cycle-40 跨源去重合并键）：sha1(normalize(stem) + '|' + normalize(options 规范序))。
 * normalize = 去 HTML 标签与 kgimg 占位、去空白差异、小写拉丁——内容等价性判断，不是格式判断。
 *
 * ⚠️ 使用纪律（三原则，对应研究 21 §2）：
 *   ① 只对「实质内容足够长」的题启用（stem 归一后 ≥ 40 字符）——短题干碰撞率高，
 *      图推合成行禁用（'【图形推理 · cat】' 同类题干天然同文，合并会吞掉不同图）。
 *   ② 合并 = canonical 归一 + **出处全保留**（question_source 每源一行——来源标记绝不丢）。
 *   ③ 解析差异不覆盖：富字段合并只填空位；**解析不同版本走 analysis 多版本表**
 *      （question_analysis，带 source 溯源——「解析有差异必须保留」是用户硬要求）。
 */
export function contentFingerprint(stem: any, options: any): string {
  const norm = (t: any) => String(t ?? '')
    .replace(/<[^>]+>/g, '')                    // 剥 HTML
    .replace(/【图:kgimg:\/\/[^】]*】/g, '')     // 剥图占位（图片引用不入指纹）
    .replace(/kgimg:\/\/[^】\s]*/g, '')
    .replace(/\s+/g, '')                        // 去全部空白（含全角空格差异）
    .toLowerCase()
  const stemN = norm(stem)
  // options 规范序：按 key 排序后拼值（A-D 选项顺序天然稳定，但 source 间可能有空值差异）
  let optN = ''
  try {
    const parsed = typeof options === 'string' ? JSON.parse(options || '{}') : (options || {})
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      optN = Object.keys(parsed).sort().map(k => k + ':' + norm(parsed[k])).join('|')
    } else if (Array.isArray(parsed)) {
      optN = parsed.map((o: any) => String((o && (o.label ?? o.k ?? o.key)) || '') + ':' + norm(o && (o.text ?? o.t ?? o.html))).sort().join('|')
    }
  } catch { optN = norm(options) }
  // cycle-40b：长度判据放**组合后**而非仅 stem——资料分析「材料+公式图+短问」剥图后
  // stem 只剩 9 字（实测），但 options 内容足够区分 → 组合指纹照样唯一。
  // 仅当组合后仍过短（<40）才放弃指纹（真·退化行：空题干/纯占位）。
  const combined = stemN + '|' + optN
  if (combined.replace(/\|/g, '').length < 40) return ''
  return createHash('sha1').update(combined, 'utf-8').digest('hex').slice(0, 24)
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

/* ══ 解析多版本（cycle-40 · 研究 21 纪律③）══ */

/**
 * 登记一条解析版本（幂等：canonical_id+source_id+local_key 唯一）。
 * 主版本（question.analysis）由合并语义管理；本表是**全量留痕**——
 * 不同来源的解析各存一行，删除/重建不丢（可追溯「谁说的」）。
 */
export function putAnalysis(
  db: any, canonicalId: string, sourceId: string, localKey: string,
  analysis: string, answer: string,
): boolean {
  if (!canonicalId || !sourceId) return false
  const a = String(analysis ?? '').trim()
  if (!a) return false   // 空解析不留版本（可空字段不臆造——㊲ 纪律）
  try {
    db.prepare(
      `INSERT INTO question_analysis(canonical_id,source_id,local_key,analysis,answer,at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(canonical_id,source_id,local_key) DO UPDATE SET
         analysis=excluded.analysis, answer=excluded.answer, at=excluded.at`,
    ).run(canonicalId, sourceId, String(localKey || ''), a.slice(0, 65536), String(answer || ''), new Date().toISOString())
    return true
  } catch { return false }
}

/* ══ 学习事件写入（cycle-38 阶段 2 · 研究 15 C7）══ */

/**
 * 记录一次学习事件（答题/错题/掌握/升箱/补录）到 `study_event` 表。
 *
 * ── 双写期语义（研究 15 C7 阶段 2 口径）──
 *   **只写表，不改读路径**：progress json 仍是统计/错题本的事实源（阶段 1 起作用），
 *   study_event 是为阶段 3 的「按知识点诊断」沉淀流水（kadian 维度聚合需要事件粒度）。
 *   双写期**必须显式**：两个事实源写同一动作，读侧只用 progress——
 *   切读路径是阶段 3 的独立决策（带数据迁移），不在本轮偷偷做。
 *
 * 崩溃安全：写失败静默（学习流水丢失不影响判分主链路——progress 是权威事实源）。
 */
export function putStudyEvent(
  db: any,
  ev: { ws?: string, qid?: string, canonicalId?: string, module?: string, kadian?: string,
        action: string, userAnswer?: string, correctAnswer?: string, isCorrect?: boolean | null,
        box?: number, consecutive?: number, durationMs?: number },
): boolean {
  if (!db || !ev || !ev.action) return false
  try {
    db.prepare(
      `INSERT INTO study_event(at, ws, qid, canonical_id, module, kadian, action,
         user_answer, correct_answer, is_correct, box, consecutive, duration_ms)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      new Date().toISOString(), String(ev.ws || ''), String(ev.qid || ''), String(ev.canonicalId || ''),
      String(ev.module || ''), String(ev.kadian || ''), String(ev.action),
      String(ev.userAnswer || ''), String(ev.correctAnswer || ''),
      ev.isCorrect === null || ev.isCorrect === undefined ? null : (ev.isCorrect ? 1 : 0),
      ev.box == null ? null : Number(ev.box), ev.consecutive == null ? null : Number(ev.consecutive),
      ev.durationMs == null ? null : Number(ev.durationMs),
    )
    return true
  } catch { return false }
}

/** 学习事件统计（阶段 3 预研：按 kadian 聚合的正确率——读侧尚未切，仅供白盒观测） */
export function studyEventStats(db: any, limit = 20): any {
  if (!db) return null
  try {
    const total = db.prepare('SELECT COUNT(*) c FROM study_event').get().c
    const byAction = db.prepare('SELECT action, COUNT(*) c FROM study_event GROUP BY action ORDER BY c DESC').all()
    const byKadian = db.prepare(
      `SELECT kadian, COUNT(*) c, SUM(is_correct) ok FROM study_event
       WHERE LENGTH(kadian) > 0 GROUP BY kadian ORDER BY c DESC LIMIT ?`).all(limit)
    return {
      total: Number(total),
      byAction: byAction.map((r: any) => ({ action: r.action, count: Number(r.c) })),
      topKadian: byKadian.map((r: any) => ({
        kadian: String(r.kadian), count: Number(r.c),
        correct: Number(r.ok || 0),
        rate: Number(r.c) ? Math.round(Number(r.ok || 0) / Number(r.c) * 100) : null,
      })),
    }
  } catch { return null }
}

/* ══ 知识节点 / 资产登记（cycle-35 schema v2）══ */

/**
 * 登记一个知识节点（方法论文档 / 考点 MOC / 技能文档）。
 * 幂等 UPSERT（kn_id 唯一）。body 截断保护（方法论全文可能很大——
 * 库体积纪律：媒体/全文走引用，body 只存检索所需的正文摘要级内容，上限 64KB）。
 */
export function putKnowledge(
  db: any, knId: string, kind: string, module: string,
  title: string, body: string, path: string, sourceId: string, meta = '',
): boolean {
  if (!knId || !kind) return false
  try {
    db.prepare(
      `INSERT INTO knowledge(kn_id,kind,module,title,body,path,source_id,meta)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(kn_id) DO UPDATE SET
         kind=excluded.kind, module=excluded.module, title=excluded.title,
         body=excluded.body, path=excluded.path, source_id=excluded.source_id, meta=excluded.meta`,
    ).run(knId, kind, String(module || ''), String(title || ''), String(body || '').slice(0, 65536),
      String(path || ''), String(sourceId || ''), String(meta || '').slice(0, 8192))
    return true
  } catch { return false }
}

/**
 * 登记一个资产（L1 资产账本——文件级**引用**而非复制：铁律①「图片只引用不复制」对文档同样适用）。
 * 幂等 UPSERT（source_id + rel_path 唯一）。
 */
export function putAsset(
  db: any, sourceId: string, relPath: string, kind: string,
  byteSize = 0, contentHash = '', mtimeMs = 0,
): boolean {
  if (!sourceId || !relPath) return false
  try {
    db.prepare(
      `INSERT INTO asset(source_id,rel_path,kind,byte_size,content_hash,mtime_ms)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(source_id, rel_path) DO UPDATE SET
         kind=excluded.kind, byte_size=excluded.byte_size,
         content_hash=excluded.content_hash, mtime_ms=excluded.mtime_ms`,
    ).run(sourceId, relPath, String(kind || 'doc'), Number(byteSize || 0), String(contentHash || ''), Number(mtimeMs || 0))
    return true
  } catch { return false }
}

/** 同步登记 source 目录行（注册表 → source 表——cycle-35：注册表与库内 source 表必须一致） */
export function putSource(
  db: any, id: string, tier: string, upstreamUrl: string, localRoot: string,
): boolean {
  if (!id) return false
  try {
    db.prepare(
      `INSERT INTO source(id,tier,upstream_url,local_root,head_sha,cloned_at,file_count,byte_size,content_hash)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         tier=excluded.tier, upstream_url=excluded.upstream_url, local_root=excluded.local_root`,
    ).run(id, String(tier || 'optional'), String(upstreamUrl || ''), String(localRoot || ''),
      '', new Date().toISOString(), 0, 0, '')
    return true
  } catch { return false }
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

/* ══ 统计快照缓存（cycle-36 · 研究 17 O1）══
 *
 * R44（结构性根因）：统计型查询全表扫描且无缓存——status/health/relations 三端点
 * 各自全量重算（51211 题规模下 status 实测 1006ms、health 788ms），
 * 同一份数据一秒内被算 3 次。正解 = **快照缓存**：算一次，四处共享，
 * 数据变更（重建/增量/写入）时失效。缓存的只是「计算结果」，不是「采样值」——
 * 数字口径不变（R06 不降级）。
 */
interface StatsCacheEntry { data: any, builtAt: number }
const statsCache = new Map<string, StatsCacheEntry>()

/** 取统计快照（命中返回缓存；未命中由 compute 回填） */
export function getCachedStats<T>(key: string, compute: () => T): { data: T, builtAt: number, cached: boolean } {
  const hit = statsCache.get(key)
  if (hit) return { data: hit.data as T, builtAt: hit.builtAt, cached: true }
  const data = compute()
  statsCache.set(key, { data, builtAt: Date.now() })
  return { data, builtAt: statsCache.get(key)!.builtAt, cached: false }
}

/** 失效全部统计快照（rebuild 完成 / 增量重建 / question·relation 写入后必须调用） */
export function invalidateStatsCache(reason = ''): number {
  const n = statsCache.size
  statsCache.clear()
  return n
}

/** 快照状态（白盒透出：面板显示「快照缓存命中率/构建时间」） */
export function statsCacheStatus(): { entries: number, keys: string[], builtAt: Record<string, number> } {
  const builtAt: Record<string, number> = {}
  for (const [k, v] of statsCache.entries()) builtAt[k] = v.builtAt
  return { entries: statsCache.size, keys: [...statsCache.keys()], builtAt }
}

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
    // 知识层（cycle-35 schema v2）：方法论/技能/考点节点与文档资产
    knowledgeNodes: one('SELECT COUNT(*) c FROM knowledge'),
    knowledgeByKind: (() => {
      try { return db.prepare('SELECT kind, COUNT(*) c FROM knowledge GROUP BY kind ORDER BY c DESC').all().map((r: any) => ({ kind: r.kind, count: Number(r.c) })) }
      catch { return [] }
    })(),
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
