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
// cycle-61 v9：库名/schema 版本/表分组常量外提到 shared/storage（零依赖，client 侧也能引用）——
// 本文件 re-export 保持既有 import 点零改动，且杜绝「版本号/库名」第二处字面量。
import { POOL_DB_NAME, POOL_SCHEMA_VERSION, POOL_TABLES, USER_TABLES, META_TABLES, ALL_TABLES } from '../shared/storage.js'
export { POOL_DB_NAME, POOL_SCHEMA_VERSION, POOL_TABLES, USER_TABLES, META_TABLES, ALL_TABLES }

/** 存储层 schema 版本 / 库名 / 表分组 —— 定义在 shared/storage.ts（零依赖常量，client 侧亦引用），
 *  本文件 re-export 以保持既有 import 点零改动。版本史见 shared/storage.ts 注释。
 *  ⚠️ 纪律：版本号只允许在 shared/storage.ts 出现一次（守卫 SMOKE-KGDB-01 对账）。 */

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
  content_hash TEXT,
  -- cycle-61 v9：题库管理域（源健康/驻留信息）——「装了但不可用」必须可判定（教训㊻：布尔表达不了状态机）
  health TEXT, last_ingest_at TEXT, last_ingest_ms INTEGER, question_count INTEGER, note TEXT
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
  content_fp TEXT,
  -- cycle-60 R6 真题卷卷级字段（追加在末列，既有 UPSERT 位置参数零影响；
  -- 摄入侧用独立 UPDATE 定向写，勿扩 QUESTION_COLS——cycle-40b/55 错位事故）
  score REAL, requirement TEXT, reference TEXT, related_materials TEXT,
  paper_id TEXT, q_no INTEGER, material_mid TEXT,
  -- cycle-60 T-038：通用上游原始对象列（JSON）——gk-tuxing 的 acc/trap/fmt/g/cat 代码等
  -- 派生列装不下的源特有字段全存此；追加在末列，既有 UPSERT 位置参数零影响。
  -- 不建索引（读者按 canonical_id/source_id 定位，无需按 extras 检索）。
  source_extras TEXT
);
-- 新列索引由迁移函数统一创建（紧随 SCHEMA 之后）——
-- 若在此处建索引，旧库尚无新列时建表脚本会抛 "no such column"（实测）。
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

-- ══ cycle-60 R6 真题卷卷级元数据（换源前置；派生数据，进 POOL_TABLES）══
-- 口径纪律（paper-audit A）：卷级标量以 buildPaperIndex 索引记录为准（含 province/relPath
-- 与路径回退），nature 从 loadPaper 详情补；questionCount（overview 声明）与
-- parsed_question_count（实际解析题数）分列，禁止合并——两者口径不同。
CREATE TABLE IF NOT EXISTS paper (
  paper_id TEXT PRIMARY KEY,
  exam TEXT, region TEXT, province TEXT, year INTEGER,
  subject TEXT, paper_type TEXT,
  question_count INTEGER, parsed_question_count INTEGER, image_count INTEGER,
  verified INTEGER, source TEXT, nature TEXT, rel_path TEXT,
  material_count INTEGER, built_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_paper_subject ON paper(subject, year);
CREATE INDEX IF NOT EXISTS ix_paper_province ON paper(province, year);
CREATE INDEX IF NOT EXISTS ix_paper_exam ON paper(exam);
CREATE INDEX IF NOT EXISTS ix_paper_type ON paper(paper_type);

-- 材料实体（申论 kind='s' / 行测 kind='g' 统一入表；独立命名空间，不与 naoku 的 material.mid 冲突）
-- body 保留原始 markdown 图片语法（paperApi.rewriteImages 依赖），截断 20000 字（上游既定上限）。
CREATE TABLE IF NOT EXISTS paper_material (
  id INTEGER PRIMARY KEY,
  mid TEXT NOT NULL UNIQUE,
  paper_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  no INTEGER NOT NULL,
  title TEXT, body TEXT, path TEXT, at TEXT,
  UNIQUE(paper_id, kind, no)
);
CREATE INDEX IF NOT EXISTS ix_pm_paper ON paper_material(paper_id, kind, no);

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

-- ══ cycle-60 管理数据表（题库管理 / 刷题管理 / 错题管理）══
-- 设计纪律（ARCH-CONVERGENCE-BASELINE §1 / STORAGE-LAYER §8）：
--   · 只读整合的上游题库放 question/relation/asset（可由 rebuild 重建）；
--   · **用户态管理数据放本组表，第一列一律 ws（租户级维度）——禁止跨项目污染（R20）；**
--   · 两表**故意不进 POOL_TABLES**：rebuild 的「原地清库」只清 POOL_TABLES，用户错题/进度永不丢失。
--   · 双写期：progress.json 仍是读侧权威，本组表由 saveProgress 边界镜像写入（研究 15 C7 阶段 2）；
--     切读是独立决策（带迁移），本轮不偷偷改读路径。
CREATE TABLE IF NOT EXISTS wrong_book (
  ws TEXT NOT NULL, sig TEXT NOT NULL,
  module TEXT, type TEXT, stem TEXT, options TEXT, correct_answer TEXT, analysis TEXT,
  wrong_count INTEGER, box INTEGER, consecutive INTEGER, mastered INTEGER, last_at INTEGER,
  source TEXT, exam TEXT, year TEXT, paper_file TEXT, group_material TEXT, group_material_no INTEGER,
  updated_at TEXT,
  -- cycle-61 v9：错题管理域增强（从「快照」升级为「可 SQL 诊断的实体」）——
  -- canonical_id 让错题与统一池对得上（回炉时可按需重取最新解析/五维）；
  -- kadian/dims 支撑「按考点分桶的弱点诊断」；srs_due_at 是 SRS 调度的可查询物化结果；
  -- first_at/lapses/last_result 是遗忘曲线的必需统计量（漏一次 ≠ 只错一次）。
  canonical_id TEXT, kadian TEXT, dims TEXT,
  first_at INTEGER, lapses INTEGER, srs_due_at INTEGER, last_result TEXT, historical INTEGER,
  -- cycle-61 v9：来源批次（补录产生的错题记 batch_id；在线答错为 NULL）。
  -- 「这条错题是纸质补录进来的还是在线做错的」是可筛选事实（统计隔离与撤销都要它）。
  origin_batch TEXT,
  PRIMARY KEY(ws, sig)
);
CREATE INDEX IF NOT EXISTS ix_wb_ws ON wrong_book(ws);
CREATE INDEX IF NOT EXISTS ix_wb_due ON wrong_book(ws, mastered, last_at);
-- ⚠️ v9 新列（canonical_id/kadian/srs_due_at）的索引**必须**在 applyPoolMigrations 里建：
-- 旧库此刻还没有这些列，在此建索引会让整个 SCHEMA_SQL exec 抛 "no such column"
-- → openPoolDb 整库降级失败（实测：poolDbStatus.ready=false，所有域读不到数据）。
-- 这与 cycle-60 R6 的教训是同一条：**新列索引不得写进建表脚本**。

-- 通用 KV：进度快照 / 专项记忆 / 模考记录 / 申论记录 / 补录台账等"域对象"以 (domain,key) 入表，
-- 值 JSON 原样存；既能承载现有 progress 的全部域，又为新增管理域零 DDL 扩展。
CREATE TABLE IF NOT EXISTS user_kv (
  ws TEXT NOT NULL, domain TEXT NOT NULL, k TEXT NOT NULL, v TEXT, updated_at TEXT,
  PRIMARY KEY(ws, domain, k)
);
CREATE INDEX IF NOT EXISTS ix_ukv_ws ON user_kv(ws, domain);

-- ══ cycle-61 v9 统一数据层：管理域实体表（题库管理 / 刷题管理 / 错题管理 / 补录管理）══
-- 设计纪律（研究 26 §3）：**本系统只维护 .kaogong.db**——凡「本系统产生的管理数据」
-- 都必须是有主键、可 SQL 诊断、可幂等 upsert 的实体表；user_kv 仅保留给「无固定形状的
-- 域对象」（模考记录数组/申论记录数组等），不得再用 JSON 桶承载有明确维度的管理数据。
-- 全部第一列/主键以 ws 开头（R20 跨租户污染防线），且**不进 POOL_TABLES**（rebuild 不碰）。

-- ① 刷题会话（刷题管理）：一次练习/模考/回炉的会话头 + 逐题作答摘要
--    「今天刷了多少、各模块对错、哪个会话还没做完」成为可 SQL 聚合的事实，
--    不再依赖 progress.history 数组的隐式形状（历史数组仍保留为统计口径权威）。
CREATE TABLE IF NOT EXISTS practice_session (
  ws TEXT NOT NULL, session_id TEXT NOT NULL,
  mode TEXT,                    -- practice | exam | srs | paper | tuxing | deepbank
  origin TEXT,                  -- 抽题来源标记（pool / srs / paper:<id> / tuxing）
  module TEXT, kadian TEXT, paper_id TEXT,
  started_at INTEGER, ended_at INTEGER, elapsed_ms INTEGER,
  total INTEGER, answered INTEGER, correct INTEGER, wrong INTEGER,
  status TEXT,                  -- active | submitted | abandoned
  meta TEXT,                    -- 源特有信息（JSON：卷名/规律类别/难度等）
  PRIMARY KEY(ws, session_id)
);
CREATE INDEX IF NOT EXISTS ix_ps_ws ON practice_session(ws, started_at);
CREATE INDEX IF NOT EXISTS ix_ps_status ON practice_session(ws, status);

-- ② 补录管理（纸质记录补录）：批次与条目**实体化**
--    旧实现把批次/幂等台账塞在 progress.importBatches / importedSigs JSON 桶，
--    「某本书补了多少、能不能撤销、这条为何被判重复」只能靠翻 JSON。实体化后可 SQL 审计。
CREATE TABLE IF NOT EXISTS import_batch (
  ws TEXT NOT NULL, batch_id TEXT NOT NULL,
  at INTEGER, source TEXT, book TEXT,
  total INTEGER, accepted INTEGER, conflicts INTEGER, rejected INTEGER,
  imported_total INTEGER,       -- 该批次带来的历史作答条数
  status TEXT,                  -- active | undone
  undone_at INTEGER,
  PRIMARY KEY(ws, batch_id)
);
CREATE INDEX IF NOT EXISTS ix_ib_ws ON import_batch(ws, at);

CREATE TABLE IF NOT EXISTS import_item (
  ws TEXT NOT NULL, batch_id TEXT NOT NULL, sig TEXT NOT NULL,
  module TEXT, stem TEXT, result TEXT,          -- right | wrong | unknown
  user_answer TEXT, correct_answer TEXT, is_correct INTEGER,
  happened_at TEXT,                              -- 原始作答日期（未知为 NULL，不臆造）
  source TEXT, canonical_id TEXT,
  at INTEGER,
  PRIMARY KEY(ws, batch_id, sig)
);
CREATE INDEX IF NOT EXISTS ix_ii_ws_sig ON import_item(ws, sig);
CREATE INDEX IF NOT EXISTS ix_ii_batch ON import_item(ws, batch_id);

-- ③ 题库管理作业归档（持久）：旧实现作业表只在内存 Map，完成即被覆盖，
--    宿主重启后「上次为什么失败」永久丢失（教训㊸）。归档落库后跨进程可查。
CREATE TABLE IF NOT EXISTS ingest_job (
  job_id TEXT PRIMARY KEY,
  action TEXT,                   -- clone | pull | probe | remove | rebuild | batch
  key TEXT,                      -- 仓库 key 或 pool
  url TEXT,
  state TEXT,                    -- queued | running | done | failed | canceled
  started_at INTEGER, ended_at INTEGER, elapsed_ms INTEGER,
  error TEXT, log_tail TEXT, retried_from TEXT,
  created_dir INTEGER,           -- 本次是否新建目录（半成品清理判据，教训㊶）
  ws TEXT,
  at TEXT
);
CREATE INDEX IF NOT EXISTS ix_ij_state ON ingest_job(state, started_at);
CREATE INDEX IF NOT EXISTS ix_ij_key ON ingest_job(key, started_at);

-- ④ 应用设置（引导/镜像/主题/模型偏好等非引导配置）——单一事实源，
--    取代散落在 repos-config.json 之外的隐式默认值。值 JSON 原样存，键词表由代码校验。
CREATE TABLE IF NOT EXISTS app_setting (
  k TEXT PRIMARY KEY, v TEXT, updated_at TEXT
);

-- ⑤ 迁移台账（schema/数据迁移的可审计历史）：每次 bump/迁移写一行，
--    「这个库经过哪些迁移、何时、结果如何」可查——杜绝静默迁移（教训㊿）。
CREATE TABLE IF NOT EXISTS migration (
  id TEXT PRIMARY KEY,           -- schema-vN / data-<name>
  applied_at TEXT, ok INTEGER, detail TEXT
);

-- ⑥ 实体扩展属性（零 DDL 扩展）：任意实体（question/paper/knowledge/source…）的
--    源特有/未来字段以 (kind, ref, k) 三元组存放。与 source_extras 的分工：
--    source_extras = 上游原始对象（原样保真）；entity_attr = **本系统**新增的标注
--    （人工校验结论、标签、收藏、笔记等），可被 SQL 过滤。
CREATE TABLE IF NOT EXISTS entity_attr (
  kind TEXT NOT NULL, ref TEXT NOT NULL, k TEXT NOT NULL,
  v TEXT, updated_at TEXT,
  PRIMARY KEY(kind, ref, k)
);
CREATE INDEX IF NOT EXISTS ix_ea_kind_k ON entity_attr(kind, k);

-- ⑦ 派生快照（卷索引等）：旧实现把 .paper-index.json / .huasheng13-index.json
--    旁挂在 data/ 目录（跨进程逃逸、无法事务化、无版本）。入库后：
--    ① 统一在 .kaogong.db 内（「只维护一个库」纪律）；② 写路径走事务；
--    ③ 带 fixture_hash 做失效判定（与既有快照语义一致）。
CREATE TABLE IF NOT EXISTS snapshot (
  key TEXT PRIMARY KEY,          -- paper-index | hs13-index | ...
  v TEXT,                        -- JSON 快照体
  fixture_hash TEXT, built_at TEXT, bytes INTEGER
);

-- ⑧ 检索流水（白盒）：统一检索层每次调用的 provider/耗时/命中数——
--    「哪个 provider 常空、哪个慢」是可观测事实，不是日志文本。
CREATE TABLE IF NOT EXISTS search_event (
  id INTEGER PRIMARY KEY, at TEXT, ws TEXT,
  provider TEXT, query TEXT, total INTEGER, took_ms INTEGER, tier TEXT
);
CREATE INDEX IF NOT EXISTS ix_se_at ON search_event(at);
CREATE INDEX IF NOT EXISTS ix_se_provider ON search_event(provider, at);

-- ⑨ 知识全文索引（FTS5 trigram）：方法论/技能文档入库后可**零外源直读**检索。
--    外部内容表模式（content='knowledge'），与 question_fts 同构。
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  title, body, kn_id UNINDEXED, kind UNINDEXED,
  content='knowledge', content_rowid='id', tokenize='trigram'
);
`

/**
 * cycle-60 R6 幂等列迁移（旧库补齐 question 卷级列）。
 * SQLite 旧版无 ADD COLUMN IF NOT EXISTS，用 PRAGMA table_info 探测后补——
 * 全部 ADDITIVE，不改既有列、不打偏 UPSERT 位置参数（新列追加在末列之后）。
 * 新库由 SCHEMA_SQL 直接建全，本函数对其零操作（探测到列已存在）。
 */
const QUESTION_COL_MIGRATIONS: Array<[string, string]> = [
  ['score', 'REAL'], ['requirement', 'TEXT'], ['reference', 'TEXT'],
  ['related_materials', 'TEXT'], ['paper_id', 'TEXT'], ['q_no', 'INTEGER'], ['material_mid', 'TEXT'],
  // cycle-60 T-038：图推无损换源——上游原始对象 JSON（无索引，纯末列追加）
  ['source_extras', 'TEXT'],
]

/**
 * cycle-61 v9 幂等列迁移（旧库补齐 v9 新增列）。
 * 与 question 迁移同一纪律：PRAGMA 探测 + ADDITIVE ADD COLUMN，不改既有列。
 * 新库由 SCHEMA_SQL 直接建全，本函数对其零操作。
 */
const V9_COL_MIGRATIONS: Array<[string, Array<[string, string]>]> = [
  ['source', [
    ['health', 'TEXT'], ['last_ingest_at', 'TEXT'], ['last_ingest_ms', 'INTEGER'],
    ['question_count', 'INTEGER'], ['note', 'TEXT'],
  ]],
  ['wrong_book', [
    ['canonical_id', 'TEXT'], ['kadian', 'TEXT'], ['dims', 'TEXT'],
    ['first_at', 'INTEGER'], ['lapses', 'INTEGER'], ['srs_due_at', 'INTEGER'],
    ['last_result', 'TEXT'], ['historical', 'INTEGER'],
    // v9：来源批次（补录错题可追溯、可撤销；在线答错为 NULL）
    ['origin_batch', 'TEXT'],
  ]],
]

export function applyPoolMigrations(db: any): void {
  if (!db) return
  try {
    const cols = (db.prepare('PRAGMA table_info(question)').all() as any[]).map(r => String(r.name))
    for (const [name, def] of QUESTION_COL_MIGRATIONS) {
      if (!cols.includes(name)) db.exec(`ALTER TABLE question ADD COLUMN ${name} ${def}`)
    }
    // 新列索引（IF NOT EXISTS 幂等；新库 SCHEMA 已含，此处兜旧库）
    db.exec('CREATE INDEX IF NOT EXISTS ix_q_paper ON question(paper_id, q_no)')
    db.exec('CREATE INDEX IF NOT EXISTS ix_q_matmid ON question(material_mid)')
    // v9：管理域列迁移（source 健康字段 / wrong_book 错题实体化字段）
    for (const [table, migs] of V9_COL_MIGRATIONS) {
      let have: string[] = []
      try { have = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(r => String(r.name)) } catch { continue }
      for (const [name, def] of migs) {
        if (!have.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`)
      }
    }
    // v9 新列索引（同样只能在此建——旧库列刚补上）
    db.exec('CREATE INDEX IF NOT EXISTS ix_wb_canon ON wrong_book(canonical_id)')
    db.exec('CREATE INDEX IF NOT EXISTS ix_wb_kadian ON wrong_book(ws, kadian)')
    db.exec('CREATE INDEX IF NOT EXISTS ix_wb_srs ON wrong_book(ws, mastered, srs_due_at)')
    // 迁移台账（v9 起每次 schema 迁移留痕；幂等）
    try {
      db.prepare('INSERT INTO migration(id,applied_at,ok,detail) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING')
        .run('schema-v' + POOL_SCHEMA_VERSION, new Date().toISOString(), 1, 'applyPoolMigrations')
    } catch { /* 台账写不进不阻塞业务（白盒会对账） */ }
  } catch { /* 迁移失败不击杀宿主；白盒 schema 版本会对账失配（响亮可见） */ }
}

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
 * **只读连接**（cycle-61 v9-b）：重建期的读路径专用。
 *
 * ── 问题（重建压测实测）──
 *   重建是 worker 里的长写事务（整库原子重建，~150s）。主线程的**同一个**连接做读时，
 *   `prepare().all()` 会参与连接级的写锁等待（`busy_timeout`），于是 bm25+JOIN 的重查询
 *   排队到数秒（实测 5086ms），把「重建期间宿主仍可用」从 100% 可靠变成「大部分快、偶尔卡 5s」。
 *
 * ── 正解 ──
 *   WAL 模式下**只读连接**能看到写事务开始前的快照，完全不受写锁影响。
 *   重建期另开一个 `readOnly:true` 连接服务读请求；重建结束即关闭（回到主连接，避免长期双连接）。
 *
 *   调用方式：`withReadConnAsync(fn)` —— 重建期用只读连接，其余时间用主连接（零行为变化）。
 */
let readConn: any = null
let readConnPath: string | null = null
let rebuildingFlag = false

/** 标记「正在重建」（由 poolApi 作业状态机驱动；影响读连接选择） */
export function setRebuilding(on: boolean): void {
  rebuildingFlag = !!on
  if (!on) closeReadConn()
}
export function isRebuilding(): boolean { return rebuildingFlag }

function closeReadConn(): void {
  try { if (readConn && readConn.close) readConn.close() } catch { /* 已关闭 */ }
  readConn = null
  readConnPath = null
}

/**
 * 用一个「重建期不受写锁影响」的连接执行读。
 * · 非重建期 → 直接用主连接（零开销）；
 * · 重建期 → 惰性打开只读连接（同 WAL 快照）；
 * · 只读连接打不开（旧 Node / 权限）→ 降级回主连接（诚实降级，不假装更快）。
 */
export async function withReadConnAsync<T>(fn: (db: any) => T): Promise<T> {
  const main = poolDb()
  if (!rebuildingFlag || !main) return fn(main)
  if (!readConn || readConnPath !== state.path) {
    closeReadConn()
    try {
      const mod = await import('node:sqlite')
      const DatabaseSync = mod.DatabaseSync || (mod.default && mod.default.DatabaseSync)
      if (DatabaseSync && state.path) {
        readConn = new DatabaseSync(state.path, { readOnly: true })
        readConn.exec('PRAGMA busy_timeout=500;')   // 只读连接不需要长等
        readConnPath = state.path
      }
    } catch { readConn = null }
  }
  try { return fn(readConn || main) }
  catch (e) {
    /**
     * 只读连接失败（重建提交瞬间 WAL 换代 / 句柄失效）→ 关掉重建一次主连接。
     *
     * 为什么要重试而不是直接抛：重建**提交那一刻**，只读连接持有的旧 WAL 快照可能
     * 与新的 checkpoint 交错，极少数请求会拿到「无法读取」的错误（压测里表现为
     * 152 次中 1 次失败）。这类失败是**瞬时**的（下一次请求就好了），
     * 让用户看到 500 是不可接受的——重试一次主连接即可稳妥收敛。
     */
    closeReadConn()
    try { return fn(main) }
    catch (e2) {
      // 主连接也失败 → 让调用方以 null 走「未就绪」降级分支（结构化，不冒泡成 500）
      void e; void e2
      return fn(null)
    }
  }
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
    /**
     * cycle-61 v9-b：忙等超时（毫秒）。
     *
     * 背景：重建改为 worker 线程里的**长事务**（整库原子重建），期间主线程的用户态写入
     * （saveProgress 镜像 / 错题 upsert）可能撞上写锁。旧实现没有 busy_timeout →
     * 立即抛 SQLITE_BUSY → 镜像静默丢失。设 5s 忙等：让短写入排队等重建提交，
     * 而不是直接失败（WAL 下读者不受影响，只有写者互斥）。
     */
    db.exec('PRAGMA busy_timeout=5000;')
    /**
     * cycle-61 v9-b：**读连接与写连接分离的 WAL 快照**。
     *
     * 背景（重建压测实测）：全量重建是 worker 里一个 160 秒级长事务（整库原子重建）。
     * WAL 语义下读者本不该被阻塞——但同一连接的读会看到未提交事务的**自身**视图，
     * 且 `bm25()` + JOIN 的重查询在写事务持锁期间会排队（实测统一检索 p-max 5085ms）。
     *
     * 关键 pragma：
     *   · `journal_mode=WAL`（已有）：读写并发的基础；
     *   · `synchronous=NORMAL`：WAL 下的推荐值——崩溃只丢最后一个事务，换来数倍写入吞吐
     *     （重建 16 万行时差异显著；本库是可重建派生物，丢失一个重建事务可接受）；
     *   · `wal_autocheckpoint` 保持默认（1000 页）：checkpoint 太频繁会与长事务抢锁。
     */
    db.exec('PRAGMA synchronous=NORMAL;')
    db.exec(SCHEMA_SQL)
    applyPoolMigrations(db)
    state.db = db
    state.path = path
    state.schemaOk = true
    // ⚠️ 旧「打开即清库」语义（保留仅供独立脚本/迁移工具使用）：
    // 运行期重建**不再**走这里——它会把清空立即提交，一旦后续摄入失败就留下空库
    // （真实事故：截断重建把生产库清空）。`rebuildPool` 现在用 clearPoolTables()
    // 在**事务内**清空，失败整体回滚 → 旧数据完好。
    if (opts.rebuild) {
      try {
        db.exec('BEGIN')
        clearPoolTables(db)
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

/**
 * 写队列（cycle-61 v9-b）：把「用户态小写入」从请求线程的同步栈里挪出去。
 *
 * ── 为什么（重建压测实测）──
 *   重建时 worker 持写锁 + WAL checkpoint 繁忙，主线程里任何同步 `INSERT/UPDATE`
 *   都会在 busy_timeout 里排队，**整条请求链**（含 `/api/status` 这种轻量信标）被拖到
 *   数秒（实测 2316ms）。而这些用户态写入（错题 upsert / 进度镜像）**不需要同步完成**：
 *   它们写的是「镜像/账本」，业务结果已经在 JSON 主链路里返回给用户了。
 *
 * 正解 = 单槽串行队列：
 *   · 入队立即返回（调用方零等待）；
 *   · 用 `setImmediate` 分片执行，每条之间让出事件循环（长队列不会变成新的一次阻塞）；
 *   · 单飞（同一时刻只有一条写），避免 SQLite 同连接写竞争；
 *   · 任何异常静默丢弃（镜像失败不影响主链路——既有纪律）。
 */
type QueuedWrite = () => void
const writeQueue: QueuedWrite[] = []
let pumping = false
/** 队列深度（白盒：能看出「有没有积压」） */
export function writeQueueDepth(): number { return writeQueue.length }

function pumpWrites(): void {
  if (pumping) return
  pumping = true
  const step = () => {
    const job = writeQueue.shift()
    if (!job) { pumping = false; return }
    try { job() } catch { /* 单条失败不影响队列 */ }
    // 让出事件循环再取下一条（关键：否则队列本身成了一次新阻塞）
    setImmediate(step)
  }
  setImmediate(step)
}

/** 异步执行一次用户态写入（不阻塞调用方；失败静默） */
export function enqueueUserWrite(job: QueuedWrite): void {
  try {
    if (typeof job !== 'function') return
    // 队列上限：防止宿主长时间运行后积压无界（丢弃最旧——用户态写入是可重放的镜像）
    if (writeQueue.length > 500) writeQueue.splice(0, writeQueue.length - 500)
    writeQueue.push(job)
    pumpWrites()
  } catch { /* 入队失败不影响主链路 */ }
}

/**
 * 在事务中执行（性能关键路径）。
 *
 * 教训（cycle-34 实测）：逐条 `INSERT` 无事务时，27506 题 + 22 万关系边
 * 耗时 **421 秒**（每条语句各自 fsync）。包进单个事务后降到**秒级**。
 *
 * ── cycle-61 v9-b：**嵌套深度感知**（原子重建的前置条件）──
 *   旧实现用 `try { BEGIN } catch { /* 已在事务中 *\/ }` 判断嵌套，然后在函数末尾
 *   `COMMIT` —— 嵌套时内层 COMMIT 会把**外层事务提前提交**，于是「整库原子重建」
 *   根本不可能成立（每个源各自提交，中途失败就留下半成品库）。
 *   正解 = 按连接记录深度：只有最外层（depth 0）才 BEGIN/COMMIT/ROLLBACK，
 *   内层只递增深度并透传异常。这样 `rebuildPool` 可以用一个外层事务包住全部源。
 */
const txDepth = new WeakMap<any, number>()

export function withTx<T>(db: any, fn: () => T): T {
  const depth = txDepth.get(db) || 0
  if (depth === 0) { try { db.exec('BEGIN') } catch { /* 已在外部事务（非本门面） */ } }
  txDepth.set(db, depth + 1)
  try {
    const out = fn()
    if (depth === 0) { try { db.exec('COMMIT') } catch { /* 自动提交模式 */ } }
    return out
  } catch (e) {
    if (depth === 0) { try { db.exec('ROLLBACK') } catch { /* 回滚失败不掩盖原错 */ } }
    throw e
  } finally {
    txDepth.set(db, depth)
  }
}

/**
 * 异步事务（cycle-61 v9-b）：与 `withTx` 同语义，但允许回调内部 `await`
 * （摄入某些源需要 `await import('node:sqlite')`）。
 *
 * ⚠️ 纪律：同一连接上**不得并发**调用本函数（SQLite 单连接单事务）。
 * 本项目的重建是单飞作业（poolApi 的 rebuildJobs 单槽 + worker 单实例），
 * 已在编排层保证串行；写入路径的 withTx 都很短，不会与重建的长事务并发。
 */
export async function withTxAsync<T>(db: any, fn: () => Promise<T>): Promise<T> {
  const depth = txDepth.get(db) || 0
  if (depth === 0) { try { db.exec('BEGIN') } catch { /* 已在外部事务 */ } }
  txDepth.set(db, depth + 1)
  try {
    const out = await fn()
    if (depth === 0) { try { db.exec('COMMIT') } catch { /* 自动提交模式 */ } }
    return out
  } catch (e) {
    if (depth === 0) { try { db.exec('ROLLBACK') } catch { /* 回滚失败不掩盖原错 */ } }
    throw e
  } finally {
    txDepth.set(db, depth)
  }
}

/**
 * 清空全部派生表（cycle-61 v9-b：从 `openPoolDb({rebuild})` 抽出）。
 *
 * 为什么抽出：原子重建要求「清空 + 重灌」在**同一个事务**里完成——
 * 旧实现把清空做在 `openPoolDb` 里并立即提交，随后若某个源失败，
 * 用户就得到一个**空库/半成品库**（真实事故：测试截断重建把生产库清空）。
 * 现在清空由 `rebuildPool` 在事务内调用，失败整体回滚 → 旧数据完好。
 */
export function clearPoolTables(db: any): void {
  for (const t of POOL_TABLES) {
    // FTS 是外部内容表，DELETE 走 rebuild 指令（不能直接 DELETE，否则索引与内容失配）
    if (t === 'question_fts' || t === 'knowledge_fts') continue
    try { db.exec(`DELETE FROM ${t}`) } catch { /* 表不存在 = 新库，正常 */ }
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
  /**
   * cycle-56 修复（cf 过度合并吞掉不同考点图推题）：
   * 原 norm 用 `<[^>]+>` 把 `<img src="...">` 整标签剥掉 → 图推题「从所给四个选项…」
   * 通用题干 + 不同图（内容寻址文件名不同）剥完后文本完全相同 → 不同考点的题被
   * 误判同题合并（实测 naoku 1895 图形推理题仅 545 唯一题干，1350 行冗余被吞成 925）。
   *
   * 正解沿用项目「剥 HTML 必须保留 img 语义」纪律（CLAUDE.md cycle-22）：
   * 先把 img 的 src 提取为**稳定区分因子**（取内容寻址文件名/路径，不含尺寸等表现属性），
   * 再剥 HTML。图片是内容寻址（sha256 文件名）——同图跨源 src 文件名一致，仍能正常合并；
   * 不同图文件名不同 → 指纹不同 → 保住不同考点的题为独立题。
   */
  const imgRefs = (t: any): string => {
    const srcs: string[] = []
    const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(String(t ?? ''))) !== null) {
      // 取 basename 去扩展名（内容寻址文件名主体）：kgimg:///path 形态统一取末段；
      // 去扩展名规避「DB 记 .webp / 磁盘 .png」差异（cycle-21 实测）破坏跨源合并。
      const src = String(m[1] || '').split(/[\\/]/).pop() || ''
      const stemName = src.replace(/\.[a-z0-9]+$/i, '')
      if (stemName) srcs.push(stemName)
    }
    return srcs.sort().join(',')
  }
  const norm = (t: any) => String(t ?? '')
    .replace(/<[^>]+>/g, '')                    // 剥 HTML（图片引用已在 imgRefs 中提取）
    .replace(/\s+/g, '')                        // 去全部空白（含全角空格差异）
    .toLowerCase()
  // 图区分因子附在 stem 后：同图→同因子（跨源可并）；不同图→不同因子（不误并）
  const stemN = norm(stem) + '|img:' + imgRefs(stem)
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
        box?: number | null, consecutive?: number | null, durationMs?: number },
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

/**
 * ══ cycle-60 管理数据镜像写（双写期：progress.json 仍是读侧权威）══
 *
 * 把 per-ws progress 对象的管理域镜像进 .kaogong.db：
 *   · wrongBook[] → wrong_book 表（错题管理：SRS 五箱/掌握态/出处快照全字段）；
 *   · 其余域（统计快照 byModule/day/answered、memory、examRecords、essayRecords、
 *     importBatches、importedSigs…）→ user_kv 表按 (domain,key) JSON 存放，零 DDL 扩展。
 *
 * 设计要点：
 *   ① **ws 必填且为第一隔离维度**——所有主键/索引以 ws 开头（R20 跨租户污染防线）；
 *   ② 幂等 UPSERT——saveProgress 每次调用都过这里，重复写不产生重复行；
 *   ③ 崩溃安全——写失败静默（本表是镜像，progress.json 才是权威，丢镜像不影响功能）；
 *   ④ 不进 POOL_TABLES——rebuild「原地清库」不碰用户态数据。
 *
 * @returns { ok:boolean, wrongRows:number, kvRows:number }
 */
export function mirrorProgressToDb(db: any, ws: string, progress: any): { ok: boolean; wrongRows: number; kvRows: number } {
  const out = { ok: false, wrongRows: 0, kvRows: 0 }
  if (!db || !progress || typeof progress !== 'object') return out
  const key = String(ws || 'default')
  const now = new Date().toISOString()
  try {
    db.exec('BEGIN')
    // ① 错题管理（整本替换语义：progress.wrongBook 是权威，镜像跟随其增删/掌握）
    if (Array.isArray(progress.wrongBook)) {
      const del = db.prepare('DELETE FROM wrong_book WHERE ws=?')
      del.run(key)
      const ins = db.prepare(
        // cycle-61 v9：镜像也必须带 origin_batch / historical / 增强字段——
        // 否则「saveProgress 整本替换」会把补录标记与考点信息洗成 NULL
        //（实测：补录错题进本后 fromImport 立刻消失，历史旅程断言假红；
        //  这与 cycle-43「整本替换会丢字段」是同一条纪律）。
        `INSERT INTO wrong_book(ws, sig, module, type, stem, options, correct_answer, analysis,
           wrong_count, box, consecutive, mastered, last_at, source, exam, year, paper_file,
           group_material, group_material_no, updated_at,
           canonical_id, kadian, dims, first_at, lapses, srs_due_at, last_result, historical, origin_batch)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      for (const w of progress.wrongBook) {
        if (!w || typeof w !== 'object') continue
        try {
          ins.run(
            key, String(w.sig || ''), String(w.module || ''), String(w.type || ''),
            String(w.stem || ''), JSON.stringify(w.options || {}), String(w.correctAnswer || ''), String(w.analysis || ''),
            Number(w.wrongCount || 0), Number(w.box || 0), Number(w.consecutive || 0), w.mastered ? 1 : 0,
            Number(w.lastAt || 0), String(w.source || ''), String(w.exam || ''), String(w.year || ''),
            String(w.paperFile || ''), String(w.groupMaterial || ''), Number(w.groupMaterialNo || 0), now,
            w.canonicalId || null, w.kadian || (w.dims && w.dims.kadian) || null,
            w.dims ? JSON.stringify(w.dims) : null,
            Number(w.firstAt || w.lastAt || 0), Number(w.lapses || 0),
            w.srsDueAt == null ? null : Number(w.srsDueAt), String(w.lastResult || ''),
            w.historical ? 1 : 0, w.fromImport || null,
          )
          out.wrongRows++
        } catch { /* 单行脏数据跳过，不拖垮整本镜像 */ }
      }
    }
    // ② 刷题管理/进度快照/补录台账等域对象 → user_kv（JSON 原样，新增域零 DDL）
    // 域清单：progress(byModule)/memory/exam(examRecords)/essay(essayRecords)/import(importBatches)
    // ⚠️ 与 readProgressFromDb 的 DOMAIN_TO_FIELD 反向映射必须一致（守卫 MGMT-05 round-trip 固化）
    const KV_DOMAINS = ['progress', 'memory', 'exam', 'essay', 'import', 'band']
    const kv = db.prepare(
      `INSERT INTO user_kv(ws, domain, k, v, updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(ws, domain, k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`,
    )
    for (const domain of KV_DOMAINS) {
      const obj = (progress as any)[domain === 'progress' ? 'byModule' : domain === 'import' ? 'importBatches' : domain === 'exam' ? 'examRecords' : domain === 'essay' ? 'essayRecords' : domain]
      if (obj === undefined || obj === null) continue
      try {
        kv.run(key, domain, 'main', JSON.stringify(obj), now)
        out.kvRows++
      } catch { /* 不可序列化对象跳过 */ }
    }
    // 标量进度快照（day/answered/correct/wrong）单独一行，避免嵌套 JSON 里被 byModule 冲掉
    kv.run(key, 'progress', 'stats', JSON.stringify({
      day: progress.day, answered: progress.answered, correct: progress.correct,
      wrong: progress.wrong, label: progress.label,
    }), now)
    out.kvRows++
    db.exec('COMMIT')
    out.ok = true
  } catch {
    try { db.exec('ROLLBACK') } catch { /* 回滚失败不掩盖 */ }
  }
  return out
}

/**
 * cycle-60 R12：管理数据**读回**（mirrorProgressToDb 的逆运算）。
 *
 * ── 为什么现在才加 ──
 *   写侧镜像早已存在（saveProgress → wrong_book/user_kv），但没有读回函数 →
 *   「库里的管理数据是否忠实反映 progress」无法机器验证，也就无法安全切换读侧。
 *   本函数只做**重建**，不做切换：调用方（白盒/测试）用它做 round-trip 等价性校验。
 *   切换读侧是独立决策（需全 6 个 server 域改调用点 + 数据迁移），不在本轮偷做。
 *
 * @returns 与 loadProgress 同形的对象；库不可用/该 ws 无数据时返回 null（诚实降级）
 */
export function readProgressFromDb(db: any, ws: string): any {
  if (!db) return null
  const key = String(ws || 'default')
  try {
    // 标量进度（day/answered/correct/wrong/label）
    const statsRow = db.prepare("SELECT v FROM user_kv WHERE ws=? AND domain='progress' AND k='stats'").get(key)
    if (!statsRow) return null  // 从未镜像过 → 让调用方回落 JSON
    const out: any = { history: [], byModule: {}, wrongBook: [] }
    try { Object.assign(out, JSON.parse(String(statsRow.v || '{}'))) } catch { /* 损坏走默认 */ }
    // 域 JSON（memory/exam/essay/import…）——读回时还原为 progress 的原字段名
    // （写侧把 examRecords→domain 'exam'、importBatches→'import'，读回必须反向映射，
    //  否则 round-trip 不等价——MGMT-05 实测暴露。）
    const DOMAIN_TO_FIELD: Record<string, string> = { exam: 'examRecords', essay: 'essayRecords', import: 'importBatches' }
    const kvRows = db.prepare("SELECT domain, k, v FROM user_kv WHERE ws=? AND NOT (domain='progress' AND k='stats')").all(key) as any[]
    for (const r of kvRows) {
      try {
        const parsed = JSON.parse(String(r.v || 'null'))
        const field = DOMAIN_TO_FIELD[String(r.domain)] || String(r.domain)
        if (r.k === 'main') out[field] = parsed
        else (out[field] = out[field] || {})[r.k] = parsed
      } catch { /* 单条损坏跳过 */ }
    }
    // 错题本（wrong_book 全字段还原为 progress.wrongBook 形态）
    const wb = db.prepare(
      `SELECT sig, module, type, stem, options, correct_answer, analysis, wrong_count, box,
        consecutive, mastered, last_at, source, exam, year, paper_file, group_material, group_material_no
       FROM wrong_book WHERE ws=? ORDER BY last_at`,
    ).all(key) as any[]
    out.wrongBook = wb.map(w => {
      let options: any = {}
      try { if (w.options) options = JSON.parse(String(w.options)) } catch { options = {} }
      return {
        sig: w.sig, module: w.module, type: w.type, stem: w.stem, options,
        correctAnswer: w.correct_answer, analysis: w.analysis,
        wrongCount: Number(w.wrong_count || 0), box: Number(w.box || 0),
        consecutive: Number(w.consecutive || 0), mastered: !!w.mastered,
        lastAt: Number(w.last_at || 0), source: w.source || null, exam: w.exam || null,
        year: w.year || null, paperFile: w.paper_file || null,
        groupMaterial: w.group_material || '', groupMaterialNo: Number(w.group_material_no || 0),
      }
    })
    return out
  } catch { return null }
}

/** 管理数据白盒读（只读；口径与 mirror 对称，供 /api/pool/health 与测试消费） */
export function managementStats(db: any, ws?: string): any {
  if (!db) return null
  try {
    const key = ws ? String(ws) : null
    const wb = key
      ? db.prepare('SELECT COUNT(*) c, SUM(CASE WHEN mastered=1 THEN 1 ELSE 0 END) m FROM wrong_book WHERE ws=?').get(key)
      : db.prepare('SELECT COUNT(*) c, SUM(CASE WHEN mastered=1 THEN 1 ELSE 0 END) m FROM wrong_book').get()
    const kv = key
      ? db.prepare('SELECT domain, COUNT(*) c FROM user_kv WHERE ws=? GROUP BY domain ORDER BY c DESC').all(key)
      : db.prepare('SELECT domain, COUNT(*) c FROM user_kv GROUP BY domain ORDER BY c DESC').all()
    return {
      wrongBook: { total: Number(wb?.c || 0), mastered: Number(wb?.m || 0) },
      kvDomains: kv.map((r: any) => ({ domain: r.domain, rows: Number(r.c) })),
    }
  } catch { return null }
}

/** 学习事件统计（阶段 3 预研：按 kadian 聚合的正确率——读侧尚未切，仅供白盒观测） */export function studyEventStats(db: any, limit = 20): any {
  if (!db) return null
  try {
    const total = db.prepare('SELECT COUNT(*) c FROM study_event').get().c
    const byAction = db.prepare('SELECT action, COUNT(*) c FROM study_event GROUP BY action ORDER BY c DESC').all()
    /**
     * cycle-59 口径修正：is_correct 用 NULL 表示「无判定」（putStudyEvent 中写入 null）。
     * SQLite SUM 忽略 NULL，但 COUNT(*) 计入——旧实现分子只算有判定行、分母含无判定行，
     * 导致正确率被系统性低估（可观测数据撒谎，违反「不可探测用 null 而非 0」纪律）。
     * 正解：分母 COUNT(is_correct) 与分子 SUM(is_correct) 口径一致，只统计有判定的行；
     * 另透出 judged/skipped 让白盒看清「多少事件有判定、多少被排除」，缺失降级 null 不臆造。
     */
    const byKadian = db.prepare(
      `SELECT kadian, COUNT(is_correct) judged, COUNT(*) c, SUM(is_correct) ok FROM study_event
       WHERE LENGTH(kadian) > 0 GROUP BY kadian ORDER BY c DESC LIMIT ?`).all(limit)
    return {
      total: Number(total),
      byAction: byAction.map((r: any) => ({ action: r.action, count: Number(r.c) })),
      topKadian: byKadian.map((r: any) => ({
        kadian: String(r.kadian), total: Number(r.c),
        count: Number(r.c),   // 兼容别名：既有消费方读 count，语义不变（事件总数）
        judged: Number(r.judged || 0),
        skipped: Math.max(0, Number(r.c) - Number(r.judged || 0)),
        correct: Number(r.ok || 0),
        rate: Number(r.judged) ? Math.round(Number(r.ok || 0) / Number(r.judged) * 100) : null,
      })),
    }
  } catch { return null }
}

/* ══ cycle-61 v9：管理域实体表读写（刷题会话 / 补录台账 / 检索流水）══
 *
 * 设计纪律（研究 26 §3）：有明确维度的管理数据必须落**实体表**（可 SQL 诊断、可幂等 upsert），
 * 不再用 user_kv 的 JSON 桶承载。写失败一律静默降级——镜像/台账不是判分主链路。
 */

/** 刷题会话 upsert（开始/心跳/提交共用；幂等：同 ws+session_id 覆盖头信息与累计） */
export function putPracticeSession(db: any, ws: string, s: any): boolean {
  if (!db || !ws || !s || !s.sessionId) return false
  try {
    db.prepare(
      `INSERT INTO practice_session(ws,session_id,mode,origin,module,kadian,paper_id,
         started_at,ended_at,elapsed_ms,total,answered,correct,wrong,status,meta)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(ws, session_id) DO UPDATE SET
         mode=excluded.mode, origin=excluded.origin, module=excluded.module, kadian=excluded.kadian,
         paper_id=excluded.paper_id,
         started_at=COALESCE(practice_session.started_at, excluded.started_at),
         ended_at=COALESCE(excluded.ended_at, practice_session.ended_at),
         elapsed_ms=COALESCE(excluded.elapsed_ms, practice_session.elapsed_ms),
         total=COALESCE(excluded.total, practice_session.total),
         answered=COALESCE(excluded.answered, practice_session.answered),
         correct=COALESCE(excluded.correct, practice_session.correct),
         wrong=COALESCE(excluded.wrong, practice_session.wrong),
         status=COALESCE(excluded.status, practice_session.status),
         meta=COALESCE(excluded.meta, practice_session.meta)`,
    ).run(
      String(ws), String(s.sessionId), String(s.mode || 'practice'), String(s.origin || ''),
      String(s.module || ''), String(s.kadian || ''), String(s.paperId || ''),
      s.startedAt == null ? null : Number(s.startedAt),
      s.endedAt == null ? null : Number(s.endedAt),
      s.elapsedMs == null ? null : Number(s.elapsedMs),
      s.total == null ? null : Number(s.total),
      s.answered == null ? null : Number(s.answered),
      s.correct == null ? null : Number(s.correct),
      s.wrong == null ? null : Number(s.wrong),
      s.status == null ? null : String(s.status),
      s.meta == null ? null : JSON.stringify(s.meta),
    )
    return true
  } catch { return false }
}

/** 会话列表（刷题管理面板：按 started_at 倒序，可过滤状态/模式） */
export function listPracticeSessions(db: any, ws: string, opts: { status?: string, limit?: number } = {}): any[] {
  if (!db || !ws) return []
  try {
    const where = ['ws = ?']
    const args: any[] = [String(ws)]
    if (opts.status) { where.push('status = ?'); args.push(String(opts.status)) }
    const rows = db.prepare(
      `SELECT session_id, mode, origin, module, kadian, paper_id, started_at, ended_at, elapsed_ms,
         total, answered, correct, wrong, status, meta
       FROM practice_session WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT ?`,
    ).all(...args, Math.max(1, Math.min(200, Number(opts.limit || 30)))) as any[]
    return rows.map(r => ({
      sessionId: r.session_id, mode: r.mode, origin: r.origin, module: r.module, kadian: r.kadian,
      paperId: r.paper_id, startedAt: r.started_at, endedAt: r.ended_at, elapsedMs: r.elapsed_ms,
      total: r.total, answered: r.answered, correct: r.correct, wrong: r.wrong, status: r.status,
      // rate 由真实判分量派生（answered=0 → null，不臆造 0%）
      rate: Number(r.answered) ? Math.round(Number(r.correct || 0) / Number(r.answered) * 100) : null,
      meta: (() => { try { return r.meta ? JSON.parse(String(r.meta)) : null } catch { return null } })(),
    }))
  } catch { return [] }
}

/** 刷题会话聚合统计（「今天刷了多少/各模式分布」的白盒口径） */
export function practiceSessionStats(db: any, ws: string): any {
  if (!db || !ws) return null
  try {
    const agg = db.prepare(
      `SELECT COUNT(*) sessions, COALESCE(SUM(answered),0) answered, COALESCE(SUM(correct),0) correct,
         COALESCE(SUM(elapsed_ms),0) elapsedMs,
         SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) submitted,
         SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active
       FROM practice_session WHERE ws=?`,
    ).get(String(ws)) as any
    const byMode = db.prepare(
      'SELECT mode, COUNT(*) c, COALESCE(SUM(answered),0) answered FROM practice_session WHERE ws=? GROUP BY mode ORDER BY c DESC',
    ).all(String(ws)) as any[]
    return {
      sessions: Number(agg?.sessions || 0),
      answered: Number(agg?.answered || 0),
      correct: Number(agg?.correct || 0),
      elapsedMs: Number(agg?.elapsedMs || 0),
      submitted: Number(agg?.submitted || 0),
      active: Number(agg?.active || 0),
      rate: Number(agg?.answered) ? Math.round(Number(agg.correct || 0) / Number(agg.answered) * 100) : null,
      byMode: byMode.map(r => ({ mode: String(r.mode || ''), sessions: Number(r.c || 0), answered: Number(r.answered || 0) })),
    }
  } catch { return null }
}

/** 补录批次 + 条目（同一事务；幂等 upsert） */
export function putImportBatch(db: any, ws: string, batch: any, items: any[] = []): boolean {
  if (!db || !ws || !batch || !batch.batchId) return false
  try {
    db.exec('BEGIN')
    db.prepare(
      `INSERT INTO import_batch(ws,batch_id,at,source,book,total,accepted,conflicts,rejected,imported_total,status,undone_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(ws, batch_id) DO UPDATE SET
         at=excluded.at, source=excluded.source, book=excluded.book, total=excluded.total,
         accepted=excluded.accepted, conflicts=excluded.conflicts, rejected=excluded.rejected,
         imported_total=excluded.imported_total, status=excluded.status, undone_at=excluded.undone_at`,
    ).run(
      String(ws), String(batch.batchId), Number(batch.at || Date.now()),
      String(batch.source || ''), String(batch.book || ''),
      Number(batch.total || 0), Number(batch.accepted || 0),
      Number(batch.conflicts || 0), Number(batch.rejected || 0),
      Number(batch.importedTotal || 0), String(batch.status || 'active'),
      batch.undoneAt == null ? null : Number(batch.undoneAt),
    )
    const ins = db.prepare(
      `INSERT INTO import_item(ws,batch_id,sig,module,stem,result,user_answer,correct_answer,is_correct,
         happened_at,source,canonical_id,at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(ws, batch_id, sig) DO UPDATE SET
         module=excluded.module, stem=excluded.stem, result=excluded.result,
         user_answer=excluded.user_answer, correct_answer=excluded.correct_answer,
         is_correct=excluded.is_correct, happened_at=excluded.happened_at,
         source=excluded.source, canonical_id=excluded.canonical_id, at=excluded.at`,
    )
    for (const it of items) {
      if (!it || !it.sig) continue
      ins.run(
        String(ws), String(batch.batchId), String(it.sig), String(it.module || ''),
        String(it.stem || '').slice(0, 2000), String(it.result || 'unknown'),
        String(it.userAnswer || ''), String(it.correctAnswer || ''),
        it.isCorrect === null || it.isCorrect === undefined ? null : (it.isCorrect ? 1 : 0),
        it.happenedAt == null ? null : String(it.happenedAt),
        String(it.source || ''), String(it.canonicalId || ''), Number(it.at || Date.now()),
      )
    }
    db.exec('COMMIT')
    return true
  } catch {
    try { db.exec('ROLLBACK') } catch { /* 回滚失败不掩盖原错 */ }
    return false
  }
}

/** 批次撤销（软删：status='undone'；条目保留供审计——「撤了什么」是可查事实） */
export function undoSImportBatch(db: any, ws: string, batchId: string): boolean {
  if (!db || !ws || !batchId) return false
  try {
    db.prepare("UPDATE import_batch SET status='undone', undone_at=? WHERE ws=? AND batch_id=?")
      .run(Date.now(), String(ws), String(batchId))
    return true
  } catch { return false }
}

/** 补录批次列表（倒序 + 条目数） */
export function listImportBatches(db: any, ws: string, limit = 30): any[] {
  if (!db || !ws) return []
  try {
    return (db.prepare(
      `SELECT b.batch_id, b.at, b.source, b.book, b.total, b.accepted, b.conflicts, b.rejected,
         b.imported_total, b.status, b.undone_at,
         (SELECT COUNT(*) FROM import_item i WHERE i.ws=b.ws AND i.batch_id=b.batch_id) items
       FROM import_batch b WHERE b.ws=? ORDER BY b.at DESC LIMIT ?`,
    ).all(String(ws), Math.max(1, Math.min(200, Number(limit || 30)))) as any[]).map(r => ({
      batchId: String(r.batch_id), at: Number(r.at || 0), source: r.source || null, book: r.book || null,
      total: Number(r.total || 0), accepted: Number(r.accepted || 0),
      conflicts: Number(r.conflicts || 0), rejected: Number(r.rejected || 0),
      importedTotal: Number(r.imported_total || 0), status: String(r.status || 'active'),
      undoneAt: r.undone_at == null ? null : Number(r.undone_at), items: Number(r.items || 0),
    }))
  } catch { return [] }
}

/** 已补录指纹集合（幂等判据——跨批次、跨进程稳定） */
export function importedSigs(db: any, ws: string): Set<string> {
  const out = new Set<string>()
  if (!db || !ws) return out
  try {
    for (const r of db.prepare("SELECT DISTINCT sig FROM import_item WHERE ws=? AND result <> ''").all(String(ws)) as any[]) {
      out.add(String(r.sig))
    }
  } catch { /* 降级为空集（调用方回退 JSON 台账） */ }
  return out
}

/** 检索流水记录（白盒：哪个 provider 慢/常空） */
export function putSearchEvent(db: any, ev: { ws?: string, provider: string, query?: string, total?: number, tookMs?: number, tier?: string }): boolean {
  if (!db || !ev || !ev.provider) return false
  try {
    db.prepare(
      'INSERT INTO search_event(at, ws, provider, query, total, took_ms, tier) VALUES(?,?,?,?,?,?,?)',
    ).run(new Date().toISOString(), String(ev.ws || ''), String(ev.provider),
      String(ev.query || '').slice(0, 200), Number(ev.total || 0), Number(ev.tookMs || 0), String(ev.tier || ''))
    return true
  } catch { return false }
}

/** 检索流水聚合（白盒面板：provider 维度 p50 耗时 + 空命中率） */
export function searchEventStats(db: any, limit = 10): any[] {
  if (!db) return []
  try {
    const rows = db.prepare(
      `SELECT provider, COUNT(*) calls, SUM(total) hits, SUM(CASE WHEN total=0 THEN 1 ELSE 0 END) empty,
         AVG(took_ms) avgMs, MAX(took_ms) maxMs
       FROM search_event GROUP BY provider ORDER BY calls DESC LIMIT ?`,
    ).all(Math.max(1, Math.min(50, limit))) as any[]
    return rows.map(r => ({
      provider: String(r.provider), calls: Number(r.calls || 0), hits: Number(r.hits || 0),
      empty: Number(r.empty || 0),
      // 空命中率：调用数为 0 时 null（不臆造 0%）
      emptyRate: Number(r.calls) ? Math.round(Number(r.empty || 0) / Number(r.calls) * 100) : null,
      avgMs: r.avgMs == null ? null : Math.round(Number(r.avgMs) * 10) / 10,
      maxMs: r.maxMs == null ? null : Number(r.maxMs),
    }))
  } catch { return [] }
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

/** 同步登记 source 目录行（注册表 → source 表——cycle-35：注册表与库内 source 表必须一致）
 *
 * cycle-61 v9：补 health / last_ingest_* / question_count 的**可选**写入路径。
 * health 词表（ok/empty/half-clone/no-git/absent/unknown）——布尔表达不了状态机（教训㊻）；
 * 不可探测的量保留 NULL（降级），绝不用 0 冒充。
 */
export function putSource(
  db: any, id: string, tier: string, upstreamUrl: string, localRoot: string,
  extra: { health?: string | null, questionCount?: number | null, lastIngestAt?: string | null, lastIngestMs?: number | null, note?: string | null } = {},
): boolean {
  if (!id) return false
  try {
    db.prepare(
      `INSERT INTO source(id,tier,upstream_url,local_root,head_sha,cloned_at,file_count,byte_size,content_hash,
         health,last_ingest_at,last_ingest_ms,question_count,note)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         tier=excluded.tier, upstream_url=excluded.upstream_url, local_root=excluded.local_root,
         -- 健康/统计字段「有值才覆盖」（未探测时不得把既有事实洗成空）
         health=COALESCE(excluded.health, source.health),
         last_ingest_at=COALESCE(excluded.last_ingest_at, source.last_ingest_at),
         last_ingest_ms=COALESCE(excluded.last_ingest_ms, source.last_ingest_ms),
         question_count=COALESCE(excluded.question_count, source.question_count),
         note=COALESCE(excluded.note, source.note)`,
    ).run(id, String(tier || 'optional'), String(upstreamUrl || ''), String(localRoot || ''),
      '', new Date().toISOString(), 0, 0, '',
      extra.health ?? null, extra.lastIngestAt ?? null,
      extra.lastIngestMs == null ? null : Number(extra.lastIngestMs),
      extra.questionCount == null ? null : Number(extra.questionCount),
      extra.note ?? null)
    return true
  } catch { return false }
}

/** 更新源健康态（题库管理探测/安装/删除后调用；幂等） */
export function putSourceHealth(db: any, id: string, health: string, note?: string): boolean {
  if (!db || !id) return false
  try {
    db.prepare(
      `INSERT INTO source(id,tier,upstream_url,local_root,head_sha,cloned_at,file_count,byte_size,content_hash,health,note)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET health=excluded.health, note=COALESCE(excluded.note, source.note)`,
    ).run(id, 'optional', '', '', '', new Date().toISOString(), 0, 0, '', String(health), note ?? null)
    return true
  } catch { return false }
}

/* ══ cycle-61 v9：派生快照（入库，取代 data/*.json 旁挂文件）══ */

/**
 * 写派生快照（幂等 upsert）。
 * @param fixtureHash 用于失效判定（与既有快照 fixtureHash 语义一致）
 */
export function putSnapshot(db: any, key: string, value: any, fixtureHash = ''): boolean {
  if (!db || !key) return false
  try {
    const json = JSON.stringify(value)
    db.prepare(
      `INSERT INTO snapshot(key,v,fixture_hash,built_at,bytes) VALUES(?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET v=excluded.v, fixture_hash=excluded.fixture_hash,
         built_at=excluded.built_at, bytes=excluded.bytes`,
    ).run(String(key), json, String(fixtureHash || ''), new Date().toISOString(), json.length)
    return true
  } catch { return false }
}

/** 读派生快照：不存在/损坏返回 null（诚实降级，调用方自行重建） */
export function getSnapshot(db: any, key: string): any {
  if (!db) return null
  try {
    const row = db.prepare('SELECT v, fixture_hash, built_at FROM snapshot WHERE key=?').get(String(key)) as any
    if (!row) return null
    return { value: JSON.parse(String(row.v || 'null')), fixtureHash: String(row.fixture_hash || ''), builtAt: String(row.built_at || '') }
  } catch { return null }
}

/* ══ cycle-61 v9：应用设置（单一事实源）══ */

/** 写设置（值 JSON 序列化；幂等） */
export function putSetting(db: any, k: string, v: any): boolean {
  if (!db || !k) return false
  try {
    db.prepare(
      `INSERT INTO app_setting(k,v,updated_at) VALUES(?,?,?)
       ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`,
    ).run(String(k), JSON.stringify(v ?? null), new Date().toISOString())
    return true
  } catch { return false }
}

/** 读设置：缺失返回 undefined（区别于「显式 null」——调用方可判定默认值） */
export function getSetting(db: any, k: string): any {
  if (!db) return undefined
  try {
    const row = db.prepare('SELECT v FROM app_setting WHERE k=?').get(String(k)) as any
    if (!row) return undefined
    return JSON.parse(String(row.v || 'null'))
  } catch { return undefined }
}

/** 设置全量快照（白盒/端点透出） */
export function settingsSnapshot(db: any): Record<string, any> {
  if (!db) return {}
  try {
    const out: Record<string, any> = {}
    for (const r of db.prepare('SELECT k, v FROM app_setting ORDER BY k').all() as any[]) {
      try { out[String(r.k)] = JSON.parse(String(r.v || 'null')) } catch { out[String(r.k)] = null }
    }
    return out
  } catch { return {} }
}

/* ══ cycle-61 v9：实体扩展属性（零 DDL 扩展）══ */

/** 写实体属性（kind/ref/k 三元组；幂等） */
export function putAttr(db: any, kind: string, ref: string, k: string, v: any): boolean {
  if (!db || !kind || !ref || !k) return false
  try {
    db.prepare(
      `INSERT INTO entity_attr(kind,ref,k,v,updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(kind, ref, k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`,
    ).run(String(kind), String(ref), String(k), JSON.stringify(v ?? null), new Date().toISOString())
    return true
  } catch { return false }
}

/** 读一个实体的全部扩展属性 */
export function getAttrs(db: any, kind: string, ref: string): Record<string, any> {
  if (!db) return {}
  try {
    const out: Record<string, any> = {}
    for (const r of db.prepare('SELECT k, v FROM entity_attr WHERE kind=? AND ref=?').all(String(kind), String(ref)) as any[]) {
      try { out[String(r.k)] = JSON.parse(String(r.v || 'null')) } catch { out[String(r.k)] = null }
    }
    return out
  } catch { return {} }
}

/* ══ cycle-61 v9：迁移台账 ══ */

/** 记录一次迁移（幂等：同 id 只留首条——迁移是历史事实，不可覆盖） */
export function recordMigration(db: any, id: string, ok = true, detail = ''): boolean {
  if (!db || !id) return false
  try {
    db.prepare('INSERT INTO migration(id,applied_at,ok,detail) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(String(id), new Date().toISOString(), ok ? 1 : 0, String(detail || ''))
    return true
  } catch { return false }
}

/** 迁移台账快照（白盒透出） */
export function migrationLog(db: any): any[] {
  if (!db) return []
  try {
    return (db.prepare('SELECT id, applied_at, ok, detail FROM migration ORDER BY applied_at').all() as any[])
      .map(r => ({ id: String(r.id), appliedAt: String(r.applied_at || ''), ok: !!r.ok, detail: String(r.detail || '') }))
  } catch { return [] }
}

/* ══ FTS 同步 ══ */

/**
 * 重建 FTS 索引（外部内容表模式）。
 * FTS5 外部内容表不能逐行 INSERT（须走 content 表同步），全量 rebuild 是正解：
 * `INSERT INTO question_fts(question_fts) VALUES('rebuild')`。
 * 实测 5 万行 rebuild 311ms（研究 13 §2.3）。
 *
 * cycle-61 v9：knowledge_fts 同步重建——方法论/技能文档入库后可零外源直读检索。
 */
export function rebuildFts(db: any): void {
  try { db.exec("INSERT INTO question_fts(question_fts) VALUES('rebuild')") } catch { /* 无 FTS5 时降级 */ }
  try { db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')") } catch { /* 同上 */ }
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
