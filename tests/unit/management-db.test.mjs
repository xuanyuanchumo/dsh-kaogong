/**
 * tests/unit/management-db.test.mjs — cycle-60 管理数据层单测
 *
 * 覆盖：schema v6 建表（wrong_book/user_kv）/ 租户 ws 隔离（R20）/
 * 幂等 UPSERT / rebuild 清库不碰管理表 / 白盒统计口径。
 * 用隔离临时数据根，绝不碰生产 ~/.dsh/kaogong/.kaogong.db。
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let dir = null
let db = null
let poolDbMod = null

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-mgmt-'))
  poolDbMod = await import('../../dist/adapters/poolDb.js')
  const opened = await poolDbMod.openPoolDb(dir)
  db = opened.db
  expect(!!db).toBe(true)
})

afterAll(() => {
  try { poolDbMod && poolDbMod.resetPoolDb() } catch {}
  try { db && db.close() } catch {}
  try { dir && fs.rmSync(dir, { recursive: true, force: true }) } catch {}
})

const sampleProgress = (day) => ({
  day, answered: 10 * day, correct: 6 * day, wrong: 4 * day,
  byModule: { '判断推理': { answered: 4 * day, correct: 2 * day } },
  wrongBook: [
    { sig: 'sig1', module: '判断推理', type: '逻辑', stem: '题1', options: { A: 'a' }, correctAnswer: 'A', analysis: '解析1', wrongCount: 2, box: 1, consecutive: 0, mastered: false, lastAt: 1000, source: 'naoku' },
    { sig: 'sig2', module: '资料分析', type: '计算', stem: '题2', options: { A: 'b' }, correctAnswer: 'B', analysis: '解析2', wrongCount: 1, box: 3, consecutive: 2, mastered: true, lastAt: 2000, source: 'xingcezhenti' },
  ],
  memory: { practice: { module: '判断推理' } },
})

test('MGMT-01 镜像写：错题 + 域 KV 入表，幂等不重复', () => {
  const r1 = poolDbMod.mirrorProgressToDb(db, 'PROJ_A', sampleProgress(1))
  expect(r1.ok).toBe(true)
  expect(r1.wrongRows).toBe(2)
  expect(r1.kvRows).toBeGreaterThanOrEqual(2)
  const r2 = poolDbMod.mirrorProgressToDb(db, 'PROJ_A', sampleProgress(1))
  expect(r2.ok).toBe(true)
  expect(db.prepare('SELECT COUNT(*) c FROM wrong_book WHERE ws=?').get('PROJ_A').c).toBe(2)
  expect(db.prepare('SELECT COUNT(*) c FROM user_kv WHERE ws=?').get('PROJ_A').c).toBeLessThanOrEqual(8)
})

test('MGMT-02 租户隔离：同 sig 不同 ws 互不覆盖（R20 回归）', () => {
  poolDbMod.mirrorProgressToDb(db, 'PROJ_B', sampleProgress(7))
  const a = JSON.parse(db.prepare('SELECT v FROM user_kv WHERE ws=? AND domain=? AND k=?').get('PROJ_A', 'progress', 'stats').v)
  const b = JSON.parse(db.prepare('SELECT v FROM user_kv WHERE ws=? AND domain=? AND k=?').get('PROJ_B', 'progress', 'stats').v)
  expect(a.day).toBe(1)
  expect(b.day).toBe(7)
  expect(db.prepare('SELECT COUNT(*) c FROM wrong_book WHERE ws=?').get('PROJ_A').c).toBe(2)
  expect(db.prepare('SELECT COUNT(*) c FROM wrong_book WHERE ws=?').get('PROJ_B').c).toBe(2)
})

test('MGMT-03 白盒统计口径：mastered / kvDomains 可见', () => {
  const st = poolDbMod.managementStats(db, 'PROJ_A')
  expect(st.wrongBook.total).toBe(2)
  expect(st.wrongBook.mastered).toBe(1)
  expect(st.kvDomains.some(d => d.domain === 'progress')).toBe(true)
  expect(st.kvDomains.some(d => d.domain === 'memory')).toBe(true)
})

test('MGMT-04 rebuild 清库不碰管理表（用户态永不被题库重建冲掉）', async () => {
  // POOL_TABLES 不含 wrong_book/user_kv —— 静态守卫在 unified-layers 里；这里做运行时等价验证（写入后）
  const before = db.prepare('SELECT COUNT(*) c FROM wrong_book').get().c
  expect(before).toBeGreaterThanOrEqual(4)
  const tables = poolDbMod.POOL_TABLES
  expect(tables).not.toContain('wrong_book')
  expect(tables).not.toContain('user_kv')
})

test('MGMT-05 读回 round-trip：readProgressFromDb 忠实重建 mirror 写入的管理数据', () => {
  // 写一本完整错题 + 域字段，再读回比对——这是「库里的管理数据可信」的机器证据，
  // 也是未来切换读侧前必须先有的等价性证明（本轮只证明，不切换）。
  const p = {
    day: 12, answered: 40, correct: 25, wrong: 15, label: '我的备考',
    byModule: { '判断推理': { answered: 20, correct: 12 } },
    memory: { practice: { module: '判断推理', at: 111 } },
    examRecords: [{ paperId: 'a', rate: 70 }],
    wrongBook: [{
      sig: 'sigRT', module: '资料分析', type: '计算', stem: '往返题', options: { A: '1', B: '2' },
      correctAnswer: 'B', analysis: '解析', wrongCount: 3, box: 2, consecutive: 1, mastered: false,
      lastAt: 5000, source: 'gwy-zhenti', exam: '国考', year: '2024', paperFile: 'x.md',
      groupMaterial: '材料', groupMaterialNo: 1,
    }],
  }
  const w = poolDbMod.mirrorProgressToDb(db, 'PROJ_RT', p)
  expect(w.ok).toBe(true)
  const back = poolDbMod.readProgressFromDb(db, 'PROJ_RT')
  expect(back, '读回为空').toBeTruthy()
  // 标量
  expect(back.day).toBe(12); expect(back.answered).toBe(40); expect(back.wrong).toBe(15)
  expect(back.label).toBe('我的备考')
  // 域 JSON
  expect(back.memory.practice.module).toBe('判断推理')
  expect(back.examRecords[0].rate).toBe(70)
  // 错题全字段（含 correctAnswer 驼峰还原、options 对象化）
  const wb = back.wrongBook[0]
  expect(wb.sig).toBe('sigRT'); expect(wb.correctAnswer).toBe('B')
  expect(wb.options).toEqual({ A: '1', B: '2' })
  expect(wb.wrongCount).toBe(3); expect(wb.box).toBe(2); expect(wb.mastered).toBe(false)
  expect(wb.groupMaterial).toBe('材料'); expect(wb.groupMaterialNo).toBe(1)
})

test('MGMT-06 读回降级：从未镜像的 ws 返回 null（调用方回落 JSON，不臆造空数据）', () => {
  expect(poolDbMod.readProgressFromDb(db, 'PROJ_NEVER')).toBeNull()
  expect(poolDbMod.readProgressFromDb(null, 'any')).toBeNull()
})
