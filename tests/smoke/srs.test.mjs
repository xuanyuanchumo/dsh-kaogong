/**
 * tests/smoke/srs.test.mjs — 错题本 SRS 闭环域（cycle-47 阶段 5 迁移）
 *
 * 从 smoke.test.mjs §11 迁移：收集→回炉→升箱→掌握→移除→统计
 * （独立 PROJ_VTEST_SRS 命名空间 + 测前清理——重复题残留是旧文件标注的 flaky 根因）。
 * 断言判定逐字等价；「干净错题」抽取循环保留（同 stem 撞签名计数 flaky 防线）。
 *
 * 运行：npx vitest run tests/smoke/srs.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_SRS' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('§4 工作区隔离 + 判分记录（PROJ_A 记录 · PROJ_B 零污染）', async () => {
  const qA = await h.J(`/api/questions?module=判断推理&count=1&ws=PROJ_A2`)
  expect(qA.questions?.length).toBe(1)
  const checkRes = await h.P(`/api/check?ws=PROJ_A2`, {
    question: qA.questions[0],
    answer: qA.questions[0].correctAnswer,
    label: 'PROJ_A',
  })
  expect(checkRes.isCorrect).toBe(true)
  const pa = await h.J(`/api/progress?ws=PROJ_A2`)
  const pb = await h.J(`/api/progress?ws=PROJ_B2`)
  expect(pa.answered).toBeGreaterThanOrEqual(1)
  expect(pb.answered || 0).toBe(0)
})

test('§11 SRS 闭环：答错入本(box=1) → 回炉 → 升箱 → 掌握 → 移除 → 统计', async () => {
  const W = ''    // h.JW/PW 自动带 ws=PROJ_VTEST_SRS
  // 取一道"干净"错题：循环抽题直到 stem 不在错题本（同文件重复题会致签名计数>1，flaky 根因）
  // cycle-29 加固：空响应/错误响应防御——抽题器偶发 {error} 时跳过本轮而非裸崩
  let q1 = null
  for (let i = 0; i < 6; i++) {
    const qr = await h.J(`/api/questions?module=常识判断&count=1`)
    const cand = qr && Array.isArray(qr.questions) && qr.questions.length ? qr.questions[0] : null
    if (!cand) continue
    const existing = (await h.JW(`/api/wrong${W}`)).wrong.find(w => w.stem === cand.stem)
    if (!existing || existing.wrongCount === 0) { q1 = cand; break }
    if (existing) await h.PW(`/api/wrong/remove${W}`, { sig: existing.sig })
  }
  // cycle-29：6 轮全部空响应 = 服务端抽题不可用（真实缺陷），响亮失败而非裸崩
  if (!q1) throw new Error('SRS 前置抽题 6 轮均空响应（/api/questions 常识判断）——检查数据根与题库文件')
  const wrongAns = 'A' === q1.correctAnswer ? 'B' : 'A'
  await h.PW(`/api/check${W}`, { question: q1, answer: wrongAns })  // 故意答错
  const wb1 = await h.JW(`/api/wrong${W}`)
  const item = wb1.wrong.find(w => w.stem === q1.stem)
  expect(!!item && item.box === 1 && item.wrongCount === 1, '答错自动入错题本(box=1)').toBe(true)
  const srs = await h.JW(`/api/questions?module=all&count=1&sort=srs${W.startsWith('?') ? '' : ''}`)
  expect(srs.mode === 'retry' && srs.questions[0]?.fromWrongBook === true, 'SRS 回炉优先未掌握错题').toBe(true)
  const rq = srs.questions[0]
  const r1 = await h.PW(`/api/check${W}`, { question: rq, answer: rq.correctAnswer })
  expect(r1.wrongEvent?.type === 'promoted' && r1.wrongEvent.box === 2, '回炉答对升箱').toBe(true)
  const r2 = await h.PW(`/api/check${W}`, { question: rq, answer: rq.correctAnswer })
  expect(r2.wrongEvent?.type === 'mastered', '连对2次+箱≥3 → 掌握').toBe(true)
  const rm = await h.PW(`/api/wrong/remove${W}`, { sig: rq.sig })
  expect(rm.removed === 1, '错题可移除').toBe(true)
  const stats = await h.JW(`/api/stats${W}`)
  expect(Array.isArray(stats.days) && typeof stats.streak === 'number' && stats.wrong && typeof stats.wrong.open === 'number',
    '统计端点结构(days/streak/mastery/wrong)').toBe(true)
})

test('§5-§6 计划结构化 + 检索/方法论（server 运行时面抽验）', async () => {
  const plan = await h.J(`/api/plan`)
  expect(plan.phases?.length).toBe(4)
  expect(plan.days?.length).toBe(30)
  expect(plan.days?.[0]?.title && Array.isArray(plan.days?.[0]?.tasks)).toBe(true)
  const se = await h.J(`/api/search?q=增长率`)
  expect(se.results?.length).toBeGreaterThan(0)
  const me = await h.J(`/api/methods`)
  expect(me.topics?.length).toBe(10)
  const m1 = await h.J(`/api/method?topic=行测`)
  expect((m1.content || '').length).toBeGreaterThan(100)
})

test('§7-§9 图谱 + 遥测 + 能力矩阵 + 命名空间（server 运行时面抽验）', async () => {
  const g = await h.J(`/api/graph`)
  expect(g.nodes?.length).toBeGreaterThan(30)
  expect(g.edges?.length).toBeGreaterThan(30)
  expect(typeof g.metrics?.density === 'number' && g.metrics?.components >= 1 && Array.isArray(g.rank)).toBe(true)
  expect(g.nodes.filter(n => n.type === 'entry').length).toBe(2)
  expect(g.health?.total >= 0 && g.health?.total <= 100).toBe(true)
  const tel = await h.J(`/api/telemetry`)
  expect(tel.totalRequests).toBeGreaterThan(5)
  expect(Object.values(tel.endpoints).some(e => typeof e.p50 === 'number')).toBe(true)
  expect(typeof tel.coverage === 'number').toBe(true)
  const caps = await h.J(`/api/capabilities`)
  expect(caps.endpoints?.length).toBeGreaterThanOrEqual(14)
  expect(caps.entries?.length === 2 && caps.entries.some(e => e.kind === 'left-immersive') && caps.entries.some(e => e.kind === 'right-docked')).toBe(true)
  expect(caps.channels?.length === 2 && caps.channels.find(c => c.id === 'same-origin')?.preferred === true).toBe(true)
  const wss = await h.J(`/api/workspaces`)
  expect((wss.workspaces || []).some(w => w.ns.includes('PROJ_A2'))).toBe(true)
})
