/**
 * tests/smoke/unified-layers.test.mjs — cycle-60 统一缓存/检索层形态守卫
 *
 * 静态守卫（零 server）：验证「声明 vs 运行态」同源——
 *  · manifest 声明两新端点，http 路由实现，registry 从 manifest 派生；
 *  · 缓存键四维度单一事实源；graph 快照经门面且带 ws+root；换根失效含 tuxing；
 *  · 旧五检索端点零删改（兼容硬约束 STORAGE-LAYER §8）。
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const readSrc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

test('C60-01 统一检索层：manifest 声明 + http 路由 + registry 从 manifest 派生', () => {
  const mf = readSrc('src/shared/manifest.ts')
  const http = readSrc('src/server/http.ts')
  const reg = readSrc('src/server/searchRegistry.ts')
  expect(mf.includes("path: '/api/search/unified'")).toBe(true)
  expect(mf.includes("path: '/api/search/providers'")).toBe(true)
  expect(http.includes("path === '/api/search/unified'")).toBe(true)
  expect(http.includes("createSearchRegistry(CAPABILITIES.endpoints as any")).toBe(true)
  expect(reg.includes("const decl = declaredEndpoints.find(e => e.path === p.endpoint)")).toBe(true)
  expect(reg.includes("if (!decl) throw new Error")).toBe(true)
})

test('C60-02 统一信封兼容：五旧检索端点零删改 + 源特有字段进 meta', () => {
  const mf = readSrc('src/shared/manifest.ts')
  for (const p of ['/api/search', '/api/pool/search', '/api/huasheng13/search', '/api/naoku/kadian', '/api/history/search']) {
    expect(mf.includes(`path: '${p}'`), `${p} 被删改`).toBe(true)
  }
  const reg = readSrc('src/server/searchRegistry.ts')
  expect(reg.includes('meta: {') && reg.includes('matchSource: r.matchSource')).toBe(true)
  expect(reg.includes('confidence/coverage')).toBe(true)
})

test('C60-03 统一缓存层：键四维度单一事实源 + graph 经门面带 ws/root + 裸 Map 不回归', () => {
  const cache = readSrc('src/server/cache.ts')
  const http = readSrc('src/server/http.ts')
  expect(cache.includes('`${d.domain}|${ws}|${root}|${stableParams(d.params)}`')).toBe(true)
  expect(cache.includes('CACHE_DOMAINS')).toBe(true)
  expect(/domain: 'graph', ws: domains\.store\.wsKey\(wsRaw\), root: domains\.root/.test(http)).toBe(true)
  expect(/const graphCache = new Map/.test(http)).toBe(false)
  expect(/graphCache\.clear\(\)/.test(http)).toBe(false)
})

test('C60-04 换根失效链补 tuxing 缺口（cycle-16 ⑬）+ resetTuxing 导出', () => {
  const http = readSrc('src/server/http.ts')
  const tx = readSrc('src/adapters/tuxing.ts')
  expect(http.includes("kgCache.invalidate({ domain: 'graph' })") && http.includes('resetTuxing()')).toBe(true)
  expect(tx.includes('export function resetTuxing')).toBe(true)
})

test('C60-05 管理数据表：ws 第一隔离维度 + rebuild 清库不碰用户态 + 双写边界', () => {
  const pdb = readSrc('src/adapters/poolDb.ts')
  const shape = readSrc('src/shared/storage.ts')
  const ws = readSrc('src/server/ws.ts')
  // v9：schema 版本常量外提到 shared/storage（单一事实源，client 侧亦引用）
  expect(shape.includes('POOL_SCHEMA_VERSION = 9')).toBe(true)
  expect(pdb.includes('CREATE TABLE IF NOT EXISTS wrong_book') && pdb.includes('PRIMARY KEY(ws, sig)')).toBe(true)
  expect(pdb.includes('CREATE TABLE IF NOT EXISTS user_kv') && pdb.includes('PRIMARY KEY(ws, domain, k)')).toBe(true)
  // rebuild 白名单不纳入用户态表（用户错题/进度永不被题库重建冲掉）
  const ptBlock = shape.slice(shape.indexOf('export const POOL_TABLES'), shape.indexOf('] as const', shape.indexOf('export const POOL_TABLES')))
  expect(ptBlock.includes('wrong_book') || ptBlock.includes('user_kv')).toBe(false)
  // v9 新增用户态实体表（刷题会话/补录台账）同样不进派生白名单
  expect(ptBlock.includes('practice_session') || ptBlock.includes('import_batch') || ptBlock.includes('import_item')).toBe(false)
  // 双写边界在 saveProgress（单一事实源 choke point），且动态 import 避免加载期拉起 sqlite
  expect(ws.includes('saveProgress') && ws.includes("import('../adapters/poolDb.js')") && ws.includes('mirrorProgressToDb')).toBe(true)
})

test('C60-06 卷级元数据 schema（v7+）：paper/paper_material 派生表 + question 卷级列 + 独立 UPDATE 纪律', () => {
  const pdb = readSrc('src/adapters/poolDb.ts')
  const shape = readSrc('src/shared/storage.ts')
  // 两张派生表 + 索引 + question 新列（追加在 content_fp 之后，不打偏 UPSERT 位置参数）
  expect(pdb.includes('CREATE TABLE IF NOT EXISTS paper (') && pdb.includes('CREATE TABLE IF NOT EXISTS paper_material (')).toBe(true)
  expect(pdb.includes('score REAL, requirement TEXT, reference TEXT, related_materials TEXT')).toBe(true)
  expect(pdb.includes('paper_id TEXT, q_no INTEGER, material_mid TEXT')).toBe(true)
  // 幂等迁移：PRAGMA 探测 + ALTER ADD COLUMN，不改既有列
  expect(pdb.includes('export function applyPoolMigrations') && pdb.includes('PRAGMA table_info(question)') && pdb.includes('ALTER TABLE question ADD COLUMN')).toBe(true)
  // ⚠️ 新列索引只能在迁移函数内建（SCHEMA_SQL 内建会让旧库 exec 抛 no such column
  // → openPoolDb 整库降级失败。cycle-60 R6 与本轮 v9 各踩一次，故守卫覆盖两处新列）
  const schemaStart = pdb.indexOf('const SCHEMA_SQL')
  const schemaBlock = pdb.slice(schemaStart, pdb.indexOf('\n`', schemaStart))
  expect(/CREATE INDEX IF NOT EXISTS ix_q_paper/.test(schemaBlock)).toBe(false)
  expect(pdb.includes("db.exec('CREATE INDEX IF NOT EXISTS ix_q_paper ON question(paper_id, q_no)')")).toBe(true)
  // v9：wrong_book 新列索引也必须在迁移函数内（否则旧库 SCHEMA exec 直接抛 no such column）
  expect(/CREATE INDEX IF NOT EXISTS ix_wb_canon[^;]*\n(?!.*applyPoolMigrations)/.test(schemaBlock), 'wrong_book 新列索引写进了建表脚本').toBe(false)
  expect(pdb.includes('CREATE INDEX IF NOT EXISTS ix_wb_canon ON wrong_book(canonical_id)')).toBe(true)
  // 派生数据进 POOL_TABLES；用户态表绝不进（与 C60-05 一致）
  const ptBlock = shape.slice(shape.indexOf('export const POOL_TABLES'), shape.indexOf('] as const', shape.indexOf('export const POOL_TABLES')))
  expect(ptBlock.includes("'paper'") && ptBlock.includes("'paper_material'")).toBe(true)
  expect(ptBlock.includes('wrong_book') || ptBlock.includes('user_kv')).toBe(false)
})

test('C60-07 真题卷摄入 wiring：单次 loadPaper + 独立 UPDATE + merge 分支 mergedInto', () => {
  const imp = readSrc('src/adapters/poolSourceImpls.ts')
  const fn = imp.slice(imp.indexOf('export async function ingestGwyZhentiSource'))
  const body = fn.slice(0, fn.indexOf('\n}\n') >= 0 ? fn.indexOf('\n}\n') : fn.length)
  // 单一整卷解析点（防重复解析——paper-audit D）
  expect((body.match(/loadPaper\(/g) || []).length).toBe(1)
  expect(/parsePaperText\(/.test(body)).toBe(false)
  // 卷/材料 INSERT + 题新列独立 UPDATE（不扩共享 QUESTION_COLS）
  expect(body.includes('INSERT INTO paper(') && body.includes('INSERT INTO paper_material(')).toBe(true)
  expect(body.includes('UPDATE question SET') && body.includes('r.mergedInto || canon')).toBe(true)
  // 只填空位（不洗先到源数据——STORAGE-LAYER §8）
  expect(/score = CASE WHEN score IS NOT NULL THEN score ELSE \? END/.test(body)).toBe(true)
  // 材料 mid 规则与 schema 一致
  expect(body.includes("'pm:' + meta.id + ':' + kind + ':' + no")).toBe(true)
})

test('C60-08 真题卷端点：单次 loadPaperSafe 收口 + 池读层（v9：无 md 回落）', () => {
  const api = readSrc('src/server/paperApi.ts')
  const reader = readSrc('src/server/poolPaper.ts')
  const http = readSrc('src/server/http.ts')
  // 所有单卷读取经 loadPaperSafe（唯一读点）
  expect((api.match(/loadPaperSafe\(/g) || []).length).toBeGreaterThanOrEqual(6)
  // v9：唯一读路径 = 池；md(loadPaper) 只在适配层摄入期出现，运行期零 md 读
  expect(/loadPaper\(repoRoot/.test(api), '运行期仍回落 md 直读').toBe(false)
  expect(api.includes('ensureDomain(\'paper\'') || api.includes("ensureDomain('paper'"), '缺按需摄入门的端点').toBe(true)
  expect(http.includes('paperApi: makePaperApi({ repoRoot: root, store, dataCtx })')).toBe(true)
  // 读层 shape 对齐：材料的 body→text、题 q_no→no、reference/requirement/score 全字段
  expect(reader.includes('poolListPapers') && reader.includes('poolLoadPaper')).toBe(true)
  expect(reader.includes('body text FROM paper_material') && reader.includes('related_materials relatedMaterials')).toBe(true)
})

test('C60-09 方法论参考：knowledge 表读 skill 文档（v9：无 md 回落）', () => {
  const data = readSrc('src/server/dataApi.ts')
  const pool = readSrc('src/server/poolPaper.ts')
  const http = readSrc('src/server/http.ts')
  expect(pool.includes('export function poolGetMethodRef')).toBe(true)
  expect(pool.includes("knId = 'skill:' + String(fileName).replace(/\\.md$/, '')")).toBe(true)
  // v9：dataApi 直接从 knowledge 表读（不再走 md 兜底 getMethodRef）
  expect(data.includes('FROM knowledge WHERE kn_id'), '方法论未从库读').toBe(true)
  expect(/getMethodRef\(repoRoot/.test(data), 'md 兜底复辟').toBe(false)
  expect(http.includes('dataApi: makeDataApi({ repoRoot: root, planFile: PLAN_FILE, dataCtx })')).toBe(true)
})

test('C60-10 图形推理无损换源：source_extras 摄入 + 池唯一读路径 + shape 字段映射', () => {
  const pdb = readSrc('src/adapters/poolDb.ts')
  const shape = readSrc('src/shared/storage.ts')
  const ingest = readSrc('src/adapters/poolSourceJson.ts')
  const api = readSrc('src/server/tuxingApi.ts')
  const reader = readSrc('src/server/poolTuxing.ts')
  const http = readSrc('src/server/http.ts')
  // schema：通用 source_extras 末列（无索引）+ 幂等迁移；版本常量在 shared/storage（v9 单一事实源）
  expect(shape.includes('POOL_SCHEMA_VERSION = 9')).toBe(true)
  expect(pdb.includes('source_extras TEXT') && pdb.includes("['source_extras', 'TEXT']")).toBe(true)
  expect(/CREATE INDEX[^;]*source_extras/.test(pdb)).toBe(false)
  // 摄入：独立 UPDATE 写完整上游对象，merge 分支写 r.mergedInto（不扩 QUESTION_COLS）
  const fn = ingest.slice(ingest.indexOf('export function ingestTuxingSource'))
  const body = fn.slice(0, fn.indexOf('\n}\n') >= 0 ? fn.indexOf('\n}\n') : fn.length)
  expect(body.includes('UPDATE question SET source_extras')).toBe(true)
  expect(body.includes('JSON.stringify(q)') && body.includes('r.mergedInto || canon')).toBe(true)
  // v9：图推唯一读路径 = 池（data.js 回落已删除）
  expect(api.includes("ensureDomain('tuxing'"), '缺按需摄入门').toBe(true)
  expect(/tuxingQuestions\(repoRoot/.test(api) || /tuxingReady\(repoRoot/.test(api), 'data.js 回落复辟').toBe(false)
  expect(api.includes('serveTuxingImage(repoRoot')).toBe(true)
  expect(http.includes('tuxingApi: makeTuxingApi({ repoRoot: root, poolTuxing: makePoolTuxingReader(), dataCtx })')).toBe(true)
  // shape：TuxingQuestion 全字段（含 trap/acc/fmt/cat 代码）+ catName/imgUrl
  for (const f of ['group', 'no', 'img', 'src', 'cat', 'catName', 'fmt', 'ans', 'exp', 'acc', 'trap']) {
    expect(new RegExp('\\b' + f + '[,:]').test(reader), '读层缺字段 ' + f).toBe(true)
  }
  expect(reader.includes('CAT_NAMES') && reader.includes('imgUrlOf') && reader.includes("source: 'gk-tuxing'")).toBe(true)
})

test('C60-11 专题/申论列表：从 paper/question 派生（v9：无 buildPaperIndex 直读）', () => {
  const api = readSrc('src/server/paperApi.ts')
  const topics = readSrc('src/server/poolTopics.ts')
  // v9：两个端点唯一读路径 = 池
  expect(api.includes('poolEssayList(wantType, limit)')).toBe(true)
  expect(api.includes('let tree = poolBuildTopicTree()')).toBe(true)
  // 旧 md 直读已删除
  expect(/buildPaperIndex\(repoRoot/.test(api), 'buildPaperIndex 运行期直读复辟').toBe(false)
  expect(/buildTopicTree\(repoRoot/.test(api), 'buildTopicTree 运行期直读复辟').toBe(false)
  // 读层从 pool 表派生（不 import paperData/naoku）
  expect(topics.includes('FROM paper') && topics.includes("source_id='naoku'")).toBe(true)
  expect(!/from '\.\.\/adapters\/(paperData|naoku)\.js'/.test(topics)).toBe(true)
  // 申论题型五类 + 防作弊式字段（hasReference 布尔）
  expect(topics.includes("key: '大作文'") && topics.includes('hasReference: !!')).toBe(true)
})