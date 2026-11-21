/**
 * tests/smoke/papers-runtime.test.mjs — 真题卷/专题/申论评改域（cycle-47 阶段 9 迁移）
 *
 * 从 smoke.test.mjs §11b 迁移（L895-940）：
 *   · 真题卷索引（>1000 套 + 科目聚合含申论/行测）
 *   · 单卷详情（题目 + 给定材料 + 参考答案）
 *   · 专题聚合 + 申论题型聚合
 *   · 申论离线评分四维 + 优劣区分度 + 批改建议 + 采分点 + 历史落盘
 *
 * server 运行时段走 setupDomain（阶段 5 样板）；判定逐字等价。
 * 运行：npx vitest run tests/smoke/papers-runtime.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_PAPERS' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('真题卷索引可用（>1000 套）+ 科目聚合含申论与行测', async () => {
  const papers = await h.J('/api/papers')
  expect(papers.total, `total=${papers.total}`).toBeGreaterThan(1000)
  expect((papers.subjects || []).some(s => s.subject === '申论')).toBe(true)
  expect((papers.subjects || []).some(s => s.subject === '行测')).toBe(true)
})

test('单卷详情含题目 + 申论卷含给定材料 + 题目含参考答案', async () => {
  const papers = await h.J('/api/papers')
  const one = papers.papers.find(p => p.subject === '申论' && p.questionCount > 0) || papers.papers[0]
  const detail = await h.J(`/api/paper?id=${encodeURIComponent(one.id)}`)
  expect((detail.questions || []).length).toBeGreaterThan(0)
  if (one.subject === '申论') expect((detail.materials || []).length).toBeGreaterThan(0)
  const withRef = (detail.questions || []).find(q => q.reference && q.reference.length > 20)
  expect(!!withRef, withRef ? `参考长度 ${withRef.reference.length}` : '无').toBe(true)
  return { one, withRef }
})

test('专题聚合（科目+申论题型）+ 申论按题型聚合', async () => {
  const topics = await h.J('/api/topics')
  expect((topics.topics || []).some(t => t.kind === 'subject')).toBe(true)
  expect((topics.topics || []).some(t => t.kind === 'essay-type')).toBe(true)
  const el = await h.J('/api/essay/list?type=概括&limit=5')
  expect((el.questions || []).length).toBeGreaterThan(0)
})

test('申论离线评分：四维 + 优劣区分度 + 批改建议 + 采分点 + 历史落盘', async () => {
  const papers = await h.J('/api/papers')
  const one = papers.papers.find(p => p.subject === '申论' && p.questionCount > 0) || papers.papers[0]
  const detail = await h.J(`/api/paper?id=${encodeURIComponent(one.id)}`)
  const withRef = (detail.questions || []).find(q => q.reference && q.reference.length > 20)
  if (!withRef) return expect(true).toBe(true)  // 无参考答案样本（旧文件同语义跳过）
  const good = await h.PW('/api/essay/grade', {
    paperId: one.id, no: withRef.no,
    answer: '材料反映问题如下：一、产业结构问题。1.推动产业结构优化升级，提高利润率。2.增强自主创新能力，培养人才。3.减少环境污染实现可持续发展。二、粮食生产问题。1.完善相关政策提高农民收益。2.稳定农资价格加大补助。3.发展农业科技提高产量。4.加强粮食储备管理。',
  })
  const bad = await h.PW('/api/essay/grade', { paperId: one.id, no: withRef.no, answer: '我觉得问题挺多的，反正就是要发展经济吧，大概这样。' })
  expect(good.dims && typeof good.dims.coverage === 'number' && typeof good.dims.structure === 'number').toBe(true)
  expect(good.score, `优${good.score} vs 敷${bad.score}`).toBeGreaterThan(bad.score)
  expect(Array.isArray(good.feedback) && good.feedback.length > 0).toBe(true)
  expect(Array.isArray(good.hitTerms)).toBe(true)
  const hist = await h.JW('/api/essay/history')
  expect(hist.total).toBeGreaterThanOrEqual(2)
})
