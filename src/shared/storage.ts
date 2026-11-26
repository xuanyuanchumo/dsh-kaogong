/**
 * shared/storage.ts — 存储层元信息常量（cycle-61 v9 · 单一事实源，零 IO）
 *
 * ── 为什么单独成文件 ──
 *   「库名 / schema 版本 / 表分组」需要被**四方**同时使用：
 *   · adapters/poolDb（建库、迁移、清库白名单）
 *   · shared/domains（域就绪判据与白盒）
 *   · server（/api/pool/status、能力对账）
 *   · client（白盒面板文案「统一题库 .kaogong.db · schema v9」）
 *   若常量写在 poolDb.ts，client 侧 import 会把 `node:fs` 拉进 combo bundle（客户端禁 fs，
 *   且 bundler 只合并 client 目录 + 白名单模块）。故常量外提到本文件：**纯常量，零依赖**。
 *
 * ── 纪律 ──
 *   本文件只放常量与纯类型，不得 import 任何模块（尤其不得 import node:*）。
 *   改 schema 版本 = 只改这里；poolDb.ts 从本文件 re-export，杜绝第二处字面量。
 */

/** 库文件基名（研究 15 §1.1 统一口径：`.kaogong.db`） */
export const POOL_DB_NAME = '.kaogong.db'

/**
 * 存储层 schema 版本（变更必须 bump；守卫 SMOKE-KGDB-01 与 manifest 声明对账）。
 *
 * 版本史：
 *   v5 统一池（question/relation/asset/knowledge 基座）
 *   v6 +wrong_book / +user_kv 管理表（ws 隔离，不入 POOL_TABLES）
 *   v7 +paper / +paper_material + question 卷级列（真题卷换源前置）
 *   v8 +question.source_extras（图推无损换源）
 *   v9 统一数据层收口：管理域实体化（practice_session/import_batch/import_item/ingest_job
 *      /app_setting/migration/entity_attr/search_event）+ 派生快照入表（snapshot）
 *      + knowledge_fts（方法论检索零外源直读）+ wrong_book 实体化列 + source 健康列
 */
export const POOL_SCHEMA_VERSION = 9

/** 表分组：派生数据（rebuild 清空） */
export const POOL_TABLES = [
  'meta', 'source', 'asset', 'question', 'question_source', 'question_analysis', 'relation', 'material',
  'knowledge', 'question_fts', 'knowledge_fts', 'review', 'paper', 'paper_material', 'snapshot', 'search_event',
] as const

/** 表分组：用户态数据（ws 隔离；rebuild 永不清理） */
export const USER_TABLES = [
  'wrong_book', 'user_kv', 'study_event', 'practice_session', 'import_batch', 'import_item',
] as const

/** 表分组：控制面/台账（随库持久；rebuild 保留——历史事实不可重建） */
export const META_TABLES = ['app_setting', 'migration', 'ingest_job', 'entity_attr'] as const

/** 全部业务表（白盒面板 / 守卫 / 迁移巡检的统一枚举源） */
export const ALL_TABLES = [...POOL_TABLES, ...USER_TABLES, ...META_TABLES] as const

/** 数据层不变量编号（文档与守卫引用同一编号，杜绝两处表述） */
export const DATA_INVARIANT = 'I-DB-1：运行期读路径禁止源文件 IO（外源只在适配层摄入期出现）'
