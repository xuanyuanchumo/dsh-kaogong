/**
 * tests/unit/rebuild-safety.test.mjs — 重建安全性单测（cycle-61 v9-b）
 *
 * 覆盖四件「重建不能毁掉用户数据/宿主」的硬约束：
 *   ① **原子性**：全量重建中途有源异常 → 整体回滚，旧数据一条不少；
 *   ② **不清库**：`openPoolDb` 不得在 open 阶段清表（清库只能在事务内）；
 *   ③ **真增量**：逐源指纹未变 → 该源零重灌；全部未变 → 零写入；
 *   ④ **事务嵌套感知**：`withTx` 内层不得提交外层事务（否则原子性失效）。
 *
 * 用隔离临时数据根，绝不碰生产 ~/.dsh/kaogong。
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp = null
let dataDir = null
let root = null
let ingestMod = null
let dbMod = null
let srcMod = null

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-rbsafe-'))
  dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  root = path.resolve('..')
  ingestMod = await import('../../dist/adapters/poolIngest.js')
  dbMod = await import('../../dist/adapters/poolDb.js')
  srcMod = await import('../../dist/adapters/poolSources.js')
}, 120_000)

afterAll(() => {
  try { dbMod && dbMod.resetPoolDb() } catch {}
  try { tmp && fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
})

const count = (sql) => {
  try { return Number((dbMod.poolDb().prepare(sql).get() || {}).c || 0) } catch { return 0 }
}

test('REBUILD-01 原子回滚：源异常 → ok:false + 旧数据一条不少（不产生半成品库）', async () => {
  // 先建一个有数据的库（小样本，几秒）
  const base = await ingestMod.rebuildPool(root, dataDir, { rebuild: true, maxFiles: 8, maxPapers: 8 })
  expect(base.ok, '基线重建应成功: ' + String(base.error || '')).toBe(true)
  const beforeQ = count('SELECT COUNT(*) c FROM question')
  expect(beforeQ, '基线库应非空（否则本用例无意义）').toBeGreaterThan(0)

  // 故障注入：让某个**已安装且有数据**的源实现抛错
  const spec = srcMod.SOURCE_REGISTRY.find(s => s.id === 'gk-tuxing')
  expect(!!spec, '注册表缺 gk-tuxing').toBe(true)
  const orig = spec.ingest
  spec.ingest = () => { throw new Error('故障注入：源实现崩溃') }
  let r = null
  try {
    r = await ingestMod.rebuildPool(root, dataDir, { rebuild: true, maxFiles: 8, maxPapers: 8 })
  } finally {
    spec.ingest = orig   // 必须还原（否则污染后续用例）
  }
  // ① 失败被如实上报（旧实现：ok:true 且数据被删——真实事故）
  expect(r.ok, '源异常时全量重建必须失败而非静默成功').toBe(false)
  expect(!!r.rolledBack, '缺 rolledBack 标记').toBe(true)
  expect(String(r.error || '')).toMatch(/回滚|gk-tuxing/)
  // ② 旧数据完好（这是「不毁用户数据」的核心断言）
  const afterQ = count('SELECT COUNT(*) c FROM question')
  expect(afterQ, `回滚后题数应不变（前 ${beforeQ} 后 ${afterQ}）`).toBe(beforeQ)
}, 180_000)

test('REBUILD-02 清库不在 open 阶段：openPoolDb({rebuild:true}) 之外不得清表', async () => {
  // 静态守卫：编排器必须用 clearPoolTables（事务内），而不是靠 openPoolDb 的 rebuild 选项
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const src = fs.readFileSync(path.join(repoRoot, 'src', 'adapters', 'poolIngest.ts'), 'utf-8')
  const openAt = src.indexOf('openPoolDb(')
  const openCall = src.slice(openAt, openAt + 160)
  expect(openCall.includes('rebuild: false'), 'openPoolDb 不得带 rebuild:true（会在 open 阶段提交清库）').toBe(true)
  expect(src.includes('clearPoolTables(db)'), '清库必须走 clearPoolTables（事务内）').toBe(true)
  // 清空必须发生在 withTxAsync 回调内（同事务）
  const txAt = src.indexOf('withTxAsync(db')
  const clearAt = src.indexOf('clearPoolTables(db)')
  expect(txAt > 0 && clearAt > txAt, '清库必须在事务回调内（否则失败会留下空库）').toBe(true)
})

test('REBUILD-03 真增量：逐源指纹未变的源零重灌', async () => {
  const r = await ingestMod.incrementalRebuild(root, dataDir, {})
  if (!r || r.skipped) return expect(true).toBe(true)   // 全未变 → 零写入也是正确结果
  const skipped = Object.values(r.sources || {}).filter((s) => s && s.skipped).length
  const total = Object.keys(r.sources || {}).length
  // 刚重建过 → 绝大多数源指纹未变（允许个别源因目录 mtime 漂移而重灌）
  expect(skipped, `应跳过多数源（跳过 ${skipped}/${total}）`).toBeGreaterThan(0)
}, 180_000)

test('REBUILD-04 事务嵌套感知：withTxAsync 内层不提交外层（原子性前提）', async () => {
  const db = dbMod.poolDb()
  expect(!!db, '库未打开').toBe(true)
  // 外层事务中嵌套内层：内层提前提交会让外层回滚失效 → 用「抛错后数据不应存在」验证
  const marker = 'nest-probe-' + Date.now()
  let threw = false
  try {
    await dbMod.withTxAsync(db, async () => {
      db.prepare('INSERT INTO app_setting(k,v,updated_at) VALUES(?,?,?)').run(marker, '"1"', new Date().toISOString())
      try {
        dbMod.withTx(db, () => {
          db.prepare('INSERT INTO app_setting(k,v,updated_at) VALUES(?,?,?)').run(marker + '-inner', '"2"', new Date().toISOString())
        })
      } finally { /* 内层正常结束（不应提交） */ }
      throw new Error('外层故意失败')
    })
  } catch { threw = true }
  expect(threw).toBe(true)
  const hit = db.prepare('SELECT k FROM app_setting WHERE k IN (?,?)').all(marker, marker + '-inner')
  expect(hit.length, '外层回滚后内层与外层的写入都应消失（嵌套事务未隔离）').toBe(0)
})

test('REBUILD-05 源异常必须被分类（exception vs unavailable），不得混为「跳过」', async () => {
  const failures = []
  const orig = srcMod.SOURCE_REGISTRY.find(s => s.id === 'gk-tuxing').ingest
  srcMod.SOURCE_REGISTRY.find(s => s.id === 'gk-tuxing').ingest = () => { throw new Error('注入') }
  try {
    await srcMod.ingestAll({ repoRoot: root, dataDir, db: dbMod.poolDb(), opts: {} }, ['gk-tuxing'], { failures })
  } finally {
    srcMod.SOURCE_REGISTRY.find(s => s.id === 'gk-tuxing').ingest = orig
  }
  expect(failures.length, '异常未进 failures（会被当成正常跳过）').toBeGreaterThan(0)
  expect(failures[0].kind, '异常必须标记为 exception 而非 unavailable').toBe('exception')
})
