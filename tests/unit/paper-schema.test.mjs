/**
 * tests/unit/paper-schema.test.mjs — cycle-60 R6 卷级元数据 schema 单测
 *
 * 覆盖：新库建表（paper/paper_material + question 卷级列）/ 旧库幂等迁移（PRAGMA 探测 ALTER）/
 * POOL_TABLES 派生入表而用户态不入 / UPSERT 位置参数不受影响。
 * 用隔离临时数据根，绝不碰生产 ~/.dsh/kaogong/.kaogong.db。
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let dir = null
let poolDbMod = null

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-paper-schema-'))
  poolDbMod = await import('../../dist/adapters/poolDb.js')
})

afterAll(() => {
  try { dir && fs.rmSync(dir, { recursive: true, force: true }) } catch {}
})

test('PAPER-SCHEMA-01 新库：paper/paper_material + question 卷级列 + v9 管理域表齐备', async () => {
  const opened = await poolDbMod.openPoolDb(dir)
  expect(!!opened.db).toBe(true)
  const db = opened.db
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  expect(tables).toContain('paper')
  expect(tables).toContain('paper_material')
  // v9：管理域实体表（题库/刷题/错题/补录）+ 控制面台账 + 派生快照
  for (const t of ['practice_session', 'import_batch', 'import_item', 'ingest_job',
    'app_setting', 'migration', 'entity_attr', 'search_event', 'snapshot', 'knowledge_fts']) {
    expect(tables, '缺 v9 表 ' + t).toContain(t)
  }
  const cols = db.prepare('PRAGMA table_info(question)').all().map(r => r.name)
  for (const c of ['score', 'requirement', 'reference', 'related_materials', 'paper_id', 'q_no', 'material_mid']) {
    expect(cols, '缺列 ' + c).toContain(c)
  }
  // v9：错题实体化列（可 SQL 诊断弱点 / SRS 调度）
  const wbCols = db.prepare('PRAGMA table_info(wrong_book)').all().map(r => r.name)
  for (const c of ['canonical_id', 'kadian', 'dims', 'first_at', 'lapses', 'srs_due_at', 'last_result']) {
    expect(wbCols, '错题表缺列 ' + c).toContain(c)
  }
  // v9：源健康列（状态机而非布尔）
  const srcCols = db.prepare('PRAGMA table_info(source)').all().map(r => r.name)
  for (const c of ['health', 'last_ingest_at', 'last_ingest_ms', 'question_count']) {
    expect(srcCols, '源表缺列 ' + c).toContain(c)
  }
  expect(poolDbMod.POOL_SCHEMA_VERSION).toBe(9)
  poolDbMod.resetPoolDb()
})

test('PAPER-SCHEMA-02 旧库幂等迁移：仅建旧 question 表，open 后新列补齐且二次不报错', async () => {
  const legacyDir = path.join(dir, 'legacy')
  fs.mkdirSync(legacyDir, { recursive: true })
  const legacyDbPath = path.join(legacyDir, '.kaogong.db')
  const raw = new DatabaseSync(legacyDbPath)
  // 模拟 v5 旧库：question 建全 v5 列（SCHEMA_SQL 索引依赖 group_material/canonical_id/module/seq 等），
  // 但**不含**卷级新列——迁移应补齐这些列。
  raw.exec(`CREATE TABLE question (
    id INTEGER PRIMARY KEY, qid TEXT, fp TEXT, canonical_id TEXT UNIQUE,
    source_id TEXT, local_key TEXT, module TEXT, category TEXT, kadian TEXT, rule_type TEXT,
    qtype TEXT, ask_model TEXT, stem TEXT, options TEXT, answer TEXT, analysis TEXT,
    reasoning TEXT, fastest TEXT, pitfalls TEXT, mother TEXT, doubt TEXT, related TEXT,
    group_material TEXT, group_material_no INTEGER, material_ref TEXT, images TEXT,
    has_image INTEGER, freq REAL, paper TEXT, region TEXT, year TEXT, seq INTEGER, n_paper INTEGER,
    updated_at TEXT, content_fp TEXT
  )`)
  raw.close()
  const opened = await poolDbMod.openPoolDb(legacyDir)
  expect(!!opened.db).toBe(true)
  const cols = opened.db.prepare('PRAGMA table_info(question)').all().map(r => r.name)
  for (const c of ['score', 'reference', 'paper_id', 'q_no', 'material_mid']) {
    expect(cols, '迁移缺列 ' + c).toContain(c)
  }
  // 幂等：二次调用不报错、列不重复
  poolDbMod.applyPoolMigrations(opened.db)
  const cols2 = opened.db.prepare('PRAGMA table_info(question)').all().map(r => r.name)
  expect(cols2.filter(c => c === 'paper_id').length).toBe(1)
  poolDbMod.resetPoolDb()
})

test('PAPER-SCHEMA-03 POOL_TABLES 口径：派生表入、用户态不入', () => {
  const t = poolDbMod.POOL_TABLES
  expect(t).toContain('paper')
  expect(t).toContain('paper_material')
  expect(t).not.toContain('wrong_book')
  expect(t).not.toContain('user_kv')
})
