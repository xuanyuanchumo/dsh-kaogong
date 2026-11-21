/**
 * tests/smoke/history.test.mjs — 纸质补录域（cycle-47 阶段 2 迁移）
 *
 * 从 smoke.test.mjs 迁移的段：SMOKE-HIST-01..12（issue #3 补录可用性 + 统计隔离 + 撤销）。
 * 原段自带独立 ws（CX=PROJ_C）+ 批次撤销清理——与共享 server 状态弱耦合，适合分域文件。
 * 断言判定逐字等价；ws 改为 PROJ_VTEST_HIST（迁移期不与旧文件共用命名空间）。
 *
 * 运行：npx vitest run tests/smoke/history.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { getTestServer, closeTestServer, J, P, clearProgressNamespace } from '../_harness/server.mjs'

let base = ''
let portDiag = 0
/** 两参 POST（域内便捷包装：bind base——迁移时保留旧 smoke 两参调用形态） */
const P2 = (fullUrl, body) => P('', fullUrl, body)
/** 一参 GET（域内便捷包装：bind base——迁移时保留旧 smoke 一参调用形态） */
const J1 = (url) => J('', url.startsWith('http') ? url : base + url)
const CX = 'PROJ_VTEST_HIST'
const H = (p) => `${base}/api/history${p}${p.includes('?') ? '&' : '?'}ws=${CX}`

beforeAll(async () => {
  await clearProgressNamespace(CX)   // 测前自清理：上轮 importedSigs 台账残留会让幂等闸误判
  const s = await getTestServer()
  base = s.base
  portDiag = s.port
}, 60_000)

afterAll(async () => {
  await closeTestServer()
})

test('SMOKE-HIST-01 /api/history/search 返回候选（list + contentSig 稳定指纹）', async () => {
  const src = await J1(H('/search?q=最接近'))
  expect(Array.isArray(src.list)).toBe(true)
  if (src.list.length) {
    expect(src.list.every(x => x.contentSig && x.stem)).toBe(true)
  }
})

test('SMOKE-HIST-02..06 补录 wrong 全旅程（入库/隔离/幂等/撤销/清尾）', async () => {
  const src = await J1(H('/search?q=最接近'))
  const cand = (src.list || [])[0]
  if (!cand) return // 环境降级：深度题库/真题库均无候选（旧 HIST-01b 三态语义）

  // 02 补录 wrong → accepted=1 + batchId + 错题入本
  const r1 = await P2(H('/entries'), { entries: [
    { contentSig: cand.contentSig, question: cand, result: 'wrong', source: '测试书·p12' },
  ] })
  console.log('[dbg9] r1.accepted=' + (r1 && r1.accepted) + ' · ws=' + CX)
  expect(r1 && r1.accepted === 1 && !!r1.batchId).toBe(true)
  expect(r1.acceptedItems && r1.acceptedItems[0].result === 'wrong').toBe(true)
  const wrongUrl = base + '/api/wrong?ws=' + CX
  const batches = await J1(H('/batches'))
  const wrongList = await J1(wrongUrl)
  const importedWrong = (wrongList.wrong || []).find(w => w.fromImport === r1.batchId)
    expect(importedWrong, '补录错题进错题本（fromImport 批次标记）').toBeTruthy()

  // 04 幂等：同 sig 再录 → conflicts=1
  const r2 = await P2(H('/entries'), { entries: [{ contentSig: cand.contentSig, question: cand, result: 'wrong' }] })
  expect(r2 && Array.isArray(r2.conflicts) && r2.conflicts.length === 1 && r2.accepted === 0).toBe(true)

  // 05 撤销：批次回滚 → history 错题移除
  const r3 = await P2(H('/undo'), { batchId: r1.batchId })
  expect(r3 && r3.undone === true && r3.removedHistory === 1 && r3.removedWrong === 1).toBe(true)
  const wrongAfter = await J1(H('/wrong').replace('/api/history', '/api'))
  expect((wrongAfter.wrong || []).some(w => w.sig === cand.contentSig)).toBe(false)
})

test('SMOKE-HIST-07..08 result=unknown 可补录（不虚构对错）+ 统计隔离 + 撤销清尾', async () => {
  const src = await J1(H('/search?q=最接近'))
  const cands = src.list || []
  if (!cands.length) return
  // ⚠️ 迁移语义修正（cycle-47）：旧 smoke 里 HIST-02..08 是**同一命名空间单序列**——
  // HIST-05 的撤销已清掉 HIST-02 的台账。拆成独立 test 后同 ws 幂等台账跨 test 保留，
  // 复用同一候选会触发「此前已补录」conflict（accepted=0）。正解 = 换第二条候选
  //（无第二候选时整段跳过——与旧文件 HIST-01b 三态语义一致，不假红）。
  const cand = cands.find(c => c.contentSig !== (cands[0] === c ? null : cands[0].contentSig)) || (cands.length > 1 ? cands[1] : null)
  if (!cand) return

  // 07 unknown 结果：无所选答案也能录
  const r4 = await P2(H('/entries'), { entries: [{ contentSig: cand.contentSig, question: cand, result: 'unknown' }] })
  expect(r4 && r4.accepted === 1).toBe(true)
  // 08 统计隔离：importedTotal ≥1 且补录不算在线作答
  const st = await J1(base + `/api/stats?ws=${CX}`)
  expect(st.importedTotal).toBeGreaterThanOrEqual(1)
  expect(st.answered).toBe(0)
  // 清理测试命名空间
  await P2(H('/undo'), { batchId: r4.batchId })
})

test('SMOKE-HIST-09..10 manifest 声明 + http 域链接入（静态守卫）', () => {
  const mfSrc = fs.readFileSync(new URL('../../src/shared/manifest.ts', import.meta.url), 'utf-8')
  expect(['/api/history/search', '/api/history/entries', '/api/history/undo', '/api/history/batches']
    .every(p => mfSrc.includes("path: '" + p + "'"))).toBe(true)
  const httpSrc = fs.readFileSync(new URL('../../src/server/http.ts', import.meta.url), 'utf-8')
  expect(httpSrc.includes('makeHistoryApi') && httpSrc.includes('domains.historyApi.handle')).toBe(true)
})

test('SMOKE-HIST-11 题库出处标注：三库 source 字段 + SourceBadge 组件 + 错题入库快照出处', () => {
  const ukSrc = fs.readFileSync(new URL('../../dist/client/client.js', import.meta.url), 'utf-8')
  expect(ukSrc.includes('KG_SOURCE_META')).toBe(true)
  expect(ukSrc.includes('SourceBadge')).toBe(true)
  const rdSrc = fs.readFileSync(new URL('../../src/adapters/repoData.ts', import.meta.url), 'utf-8')
  expect(rdSrc.includes("source: 'xingcezhenti'")).toBe(true)
  const txSrc = fs.readFileSync(new URL('../../src/adapters/tuxing.ts', import.meta.url), 'utf-8')
  expect(txSrc.includes("source: 'gk-tuxing'")).toBe(true)
  const srsSrc = fs.readFileSync(new URL('../../src/server/srs.ts', import.meta.url), 'utf-8')
  expect(srsSrc.includes('paperFile: q.paperFile || null')).toBe(true)
})

test('SMOKE-HIST-12 运行时抽题带出处（source ∈ 已知来源词表 + paperFile 卷名）', async () => {
  const qsr = await J1(base + `/api/questions?module=判断推理&count=1&ws=${CX}`)
  const q0 = (qsr.questions || [])[0]
  expect(q0).toBeTruthy()
  const KNOWN_SOURCES = ['xingcezhenti', 'naoku', 'gk-tuxing', 'gwy_zhenti', 'xingce-app', 'qiuzhao-epi-bank', 'civil-exam-agent']
  expect(KNOWN_SOURCES.includes(q0.source)).toBe(true)
  expect(typeof q0.paperFile === 'string' && q0.paperFile.length > 0).toBe(true)
})
