/**
 * tests/unit/rebuild-safety.test.mjs — 重建安全性单测（cycle-61 v9-b · cycle-62 离线化）
 *
 * 覆盖四件「重建不能毁掉用户数据/宿主」的硬约束：
 *   ① **原子性**：全量重建中途有源异常 → 整体回滚，旧数据一条不少；
 *   ② **不清库**：`openPoolDb` 不得在 open 阶段清表（清库只能在事务内）；
 *   ③ **真增量**：逐源指纹未变 → 该源零重灌；
 *   ④ **事务嵌套感知**：`withTx` 内层不得提交外层事务（否则原子性失效）。
 *
 * ── cycle-62：改为「自建 fixture 源」，测试完全离线自足 ──
 * 原实现依赖开发机上级目录的真实题库仓（root = path.resolve('..')）：
 *   · CI runner 上没有这 16 个仓 → 基线库空 → REBUILD-01 断言「基线库非空」失败；
 *   · REBUILD-05 注入 gk-tuxing 的抛错，但该源在 CI 上 available=false → 根本没走到
 *     ingest 调用 → failures[0].kind='unavailable' 而非 'exception'。
 * 这与 C33「功能存在≠功能可用（环境矩阵验证缺失）」同族：**测试断言的是环境，
 * 不是被测行为**。修法 = 造一个「恒可用 + 自己写入题/边」的 fixture 源注入
 * SOURCE_REGISTRY，测试只依赖被测的重建/事务语义，与机器上装了什么仓无关。
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
let upsertMod = null

/** fixture 源 id（自建，不与任何真实上游仓同名） */
const FIXTURE_ID = 'kg-fixture-selftest'

/** fixture 源写入的题数（够基线非空即可，不追求规模） */
const FIXTURE_QUESTIONS = 3

/** 注入 fixture 源：恒可用 + 写入固定题/边（可被测试覆写为抛错） */
function makeFixtureSpec() {
  return {
    id: FIXTURE_ID,
    tier: 'optional',
    label: '自检 fixture 源（测试专用）',
    available: () => true,
    // 显式指纹（契约支持 spec.fingerprint）：默认实现读 repoRoot/<id> 目录 mtime，
    // fixture 源在 repoRoot 下无目录 → 指纹为空串 → 增量判据失效。
    fingerprint: () => 'kg-fixture-selftest-v1',
    ingest: async (ctx) => {
      const db = ctx.db
      for (let i = 1; i <= FIXTURE_QUESTIONS; i++) {
        const canonicalId = `q:kg-fixture-selftest:${i}`
        upsertMod.upsertQuestionBundle(
          db.prepare('INSERT OR REPLACE INTO question(' + upsertMod.QUESTION_COLS + ') VALUES(' +
            upsertMod.QUESTION_COLS.split(',').map(() => '?').join(',') + ')'),
          {
            qid: `fixture-${i}`,
            canonicalId,
            sourceId: FIXTURE_ID,
            localKey: `fixture-${i}`,
            module: 'fixture',
            category: 'selftest',
            stem: `fixture 题 ${i}（重建安全性自检）`,
            options: 'A. 甲\nB. 乙',
            answer: 'A',
            analysis: '自检解析',
            paper: 'fixture/2026/test',
            region: 'fixture',
            year: '2026',
            seq: i,
          },
          { relations: [{ type: 'SAME_AS', dstKind: 'question', dstId: canonicalId, weight: 1 }] },
          { db, localKey: `fixture-${i}`, paper: 'fixture/2026/test', region: 'fixture', year: '2026', seq: i, path: `fixture/${i}.md` },
        )
      }
      return { questions: FIXTURE_QUESTIONS, relations: FIXTURE_QUESTIONS }
    },
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-rbsafe-'))
  dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  // 仓库根（用于静态守卫读源码；不用于找题库数据）
  root = path.resolve('..')
  ingestMod = await import('../../dist/adapters/poolIngest.js')
  dbMod = await import('../../dist/adapters/poolDb.js')
  srcMod = await import('../../dist/adapters/poolSources.js')
  upsertMod = await import('../../dist/adapters/poolUpsert.js')
  // 注入 fixture 源（测试进程内，改完即用；afterAll 移除）
  srcMod.SOURCE_REGISTRY.push(makeFixtureSpec())
}, 120_000)

afterAll(() => {
  try {
    const i = srcMod.SOURCE_REGISTRY.findIndex(s => s.id === FIXTURE_ID)
    if (i >= 0) srcMod.SOURCE_REGISTRY.splice(i, 1)
  } catch { /* ignore */ }
  try { dbMod && dbMod.resetPoolDb() } catch { /* ignore */ }
  try { tmp && fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
})

const count = (sql) => {
  try { return Number((dbMod.poolDb().prepare(sql).get() || {}).c || 0) } catch { return 0 }
}

/**
 * 只跑 fixture 源的重建：**走生产的 rebuildPool 全路径**（含故障闸 + rolledBack 标记）。
 *
 * 为什么收敛注册表而不是给 rebuildPool 加「只跑某些源」的参数：
 * 生产路径本身就是「注册表里有啥就摄入啥」——加参数等于给生产代码开测试专用后门。
 * 这里改为**测试进程内临时把 SOURCE_REGISTRY 换成只剩 fixture 源**，
 * 调用结束后还原。被测的是生产的事务/故障闸语义，与机器上装了什么仓完全无关。
 */
async function rebuildFixtureOnly(opts = {}) {
  const all = srcMod.SOURCE_REGISTRY.splice(0, srcMod.SOURCE_REGISTRY.length)
  const fixtures = all.filter(s => s.id === FIXTURE_ID)
  srcMod.SOURCE_REGISTRY.push(...fixtures)
  try {
    return await ingestMod.rebuildPool(root, dataDir, { rebuild: true, ...opts })
  } finally {
    srcMod.SOURCE_REGISTRY.splice(0, srcMod.SOURCE_REGISTRY.length)
    srcMod.SOURCE_REGISTRY.push(...all)
  }
}

test('REBUILD-01 原子回滚：源异常 → ok:false + 旧数据一条不少（不产生半成品库）', async () => {
  // ① 先建一个有数据的库（fixture 源，离线自足）
  const base = await rebuildFixtureOnly()
  expect(base.ok, '基线重建应成功: ' + String(base.error || '')).toBe(true)
  const beforeQ = count('SELECT COUNT(*) c FROM question')
  expect(beforeQ, '基线库应非空（否则本用例无意义）').toBeGreaterThan(0)

  // ② 故障注入：让 fixture 源实现抛错（源**恒可用**，确保走到 ingest 调用）
  const spec = srcMod.SOURCE_REGISTRY.find(s => s.id === FIXTURE_ID)
  expect(!!spec, '注册表缺 fixture 源').toBe(true)
  const orig = spec.ingest
  spec.ingest = () => { throw new Error('故障注入：源实现崩溃') }
  let r = null
  try {
    r = await rebuildFixtureOnly()
  } finally {
    spec.ingest = orig   // 必须还原（否则污染后续用例）
  }
  // ③ 失败被如实上报（旧实现：ok:true 且数据被删——真实事故）
  expect(r.ok, '源异常时重建必须失败而非静默成功').toBe(false)
  // ④ 旧数据完好（这是「不毁用户数据」的核心断言）
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
  // fixture 源的指纹只依赖「源可用 + 数据根」，不随内容变化 → 第二次必定命中 skip
  const db = dbMod.poolDb() || (await dbMod.openPoolDb(dataDir, { rebuild: false })).db
  expect(!!db, '库未打开').toBe(true)
  const fps = srcMod.sourceFingerprints({ repoRoot: root, dataDir, db, opts: {} })
  expect(Object.keys(fps).length, '注册表应产出逐源指纹').toBeGreaterThan(0)
  expect(!!fps[FIXTURE_ID], 'fixture 源应有指纹').toBe(true)
  // 指纹未变的源进入 skip 集合 → ingestAll 直接跳过（零重灌）
  const skip = new Set([FIXTURE_ID])
  const failures = []
  const out = await srcMod.ingestAll({ repoRoot: root, dataDir, db, opts: {} }, [FIXTURE_ID], { skip, failures })
  expect(out[FIXTURE_ID].skipped, '指纹未变的源应被跳过（真增量）').toBe(true)
  expect(Number(out[FIXTURE_ID].questions || 0), '跳过的源不应写入任何题').toBe(0)
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
  const spec = srcMod.SOURCE_REGISTRY.find(s => s.id === FIXTURE_ID)
  expect(!!spec, '注册表缺 fixture 源').toBe(true)
  const orig = spec.ingest
  spec.ingest = () => { throw new Error('注入') }
  try {
    await srcMod.ingestAll({ repoRoot: root, dataDir, db: dbMod.poolDb(), opts: {} }, [FIXTURE_ID], { failures })
  } finally {
    spec.ingest = orig
  }
  expect(failures.length, '异常未进 failures（会被当成正常跳过）').toBeGreaterThan(0)
  expect(failures[0].kind, '异常必须标记为 exception 而非 unavailable').toBe('exception')
})
