/**
 * tests/smoke/v17-runtime.test.mjs — v1.7 端到端域（cycle-47 阶段 13 迁移·批三）
 *
 * 从 smoke.test.mjs §11c v1.7 段迁移（L205-300）：
 * T-018 题目配图（行测卷图片可达）+ T-016 整卷模考（start 剥答案/交卷全对 100%/模块分布）
 * + T-017 大作文分档（字数档/结构要素/区分度）+ v1.7.1 专题树（双频道/练习入口）+
 * v1.7.5 图形推理专项（354 题 13 类 + 配图 + 原创思路）+ v1.7 深度题库（五维/检索）。
 * server 运行时段走 setupDomain；判定逐字等价。
 *
 * 运行：npx vitest run tests/smoke/v17-runtime.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

let h = null

beforeAll(async () => {
  h = await setupDomain({ ws: 'PROJ_VTEST_V17' })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('T-018 行测题配图：含图卷 → URL 改写 → 二进制可加载', async () => {
  const xc = ((await h.J('/api/papers?subject=行测')).papers || []).find(x => x.imageCount > 0)
  if (!xc) return expect(true).toBe(true)  // 无含图卷（环境降级，旧文件同语义）
  const pd = await h.J(`/api/paper?id=${encodeURIComponent(xc.id)}`)
  const withImg = (pd.questions || []).find(q => /!\[[^\]]*\]\(([^)]+)\)/.test(q.stem || ''))
  expect(!!withImg, '行测题含配图引用').toBe(true)
  const src = withImg.stem.match(/!\[[^\]]*\]\(([^)]+)\)/)[1]
  expect(src.includes('/api/paper-img'), src.slice(0, 60)).toBe(true)
  const img = await fetch(h.base + src)
  const buf = await img.arrayBuffer()
  expect(img.status === 200 && buf.byteLength > 500, `${img.status} / ${buf.byteLength}B`).toBe(true)
})

test('T-016 整卷模考：start 剥答案 + 全对 100% + 模块分布', async () => {
  const ex = await h.J(`/api/paper/exam/start?id=${encodeURIComponent('国考/2008/行测-统考')}&ws=PROJ_VTEST_V17`)
  expect(ex.questionCount > 100 && ex.questions[0].answer === undefined).toBe(true)
  const realPaper = await h.J(`/api/paper?id=${encodeURIComponent('国考/2008/行测-统考')}`)
  const ansReal = {}
  for (const q of realPaper.questions) if (q.correctAnswer) ansReal[q.no] = q.correctAnswer
  const sub = await h.PW('/api/paper/exam/submit', { id: '国考/2008/行测-统考', answers: ansReal, elapsedSec: 5400 })
  expect(sub.rate === 100 && sub.correct > 100, `${sub.rate}% (${sub.correct}/${sub.answered})`).toBe(true)
  expect(Array.isArray(sub.modules) && sub.modules.length > 1).toBe(true)
})

test('T-017 大作文：字数分档 + 结构要素 + 评分区分度', async () => {
  const art = await h.PW('/api/essay/article', {
    question: '请以「文化自信」为主题写一篇文章',
    requirement: '1000字左右',
    answer: '当前我国正处于高质量发展关键期，文化自信成为时代命题。首先，文化自信是治理现代化的根基，因为只有立足本土文化才能形成制度认同。例如，浙江余村的生态治理正是汲取了天人合一智慧。其次，文化创新为治理提供方法，诸如枫桥经验化解基层矛盾。再次，文化的开放包容拓展治理视野，借鉴人类文明有益成果。总之，唯有让传统文化与时代精神同频共振，方能开创治理新境界。',
  })
  expect(!!art.lengthBand, art.lengthBand + ' (' + art.chars + '/' + art.limit + ')').toBe(true)
  expect(art.elements && art.elements.subPoints >= 1).toBe(true)
  const artBad = await h.PW('/api/essay/article', { question: 'x', requirement: '1000字左右', answer: '我觉得挺重要的，反正要发展。' })
  expect(art.score, `好${art.score} vs 差${artBad.score}`).toBeGreaterThan(artBad.score)
})

test('v1.7.1 专题树：行测/申论分频道 + 练习入口 + entry 指向', async () => {
  const topicTree = await h.J('/api/topics')
  expect(Array.isArray(topicTree.channels) && topicTree.channels.length === 2).toBe(true)
  const xcCh = (topicTree.channels || []).find(c => c.id === 'xingce')
  const slCh = (topicTree.channels || []).find(c => c.id === 'shenlun')
  expect((xcCh.topics || []).filter(t => t.kind === 'module').length).toBeGreaterThanOrEqual(6)
  expect((xcCh.topics || []).some(t => t.kind === 'category')).toBe(true)
  expect((slCh.topics || []).length).toBe(5)
  expect((xcCh.entries || []).length).toBeGreaterThanOrEqual(3)
  expect((slCh.entries || []).some(e => e.view === 'essay')).toBe(true)
  expect((xcCh.topics || []).every(t => t.entry && t.entry.view)).toBe(true)
})

test('v1.7.5 图形推理专项：354 题 13 类 + 按规律抽题 + 配图 + 原创思路', async () => {
  const tx = await h.J('/api/tuxing/cats')
  expect(tx.ready === true && tx.total === 354).toBe(true)
  expect((tx.cats || []).length).toBe(13)
  const txList = await h.J('/api/tuxing/list?cat=symmetry&limit=2')
  expect(txList.questions.length === 2 && txList.questions[0].cat === 'symmetry').toBe(true)
  const img = await fetch(h.base + txList.questions[0].imgUrl)
  const buf = await img.arrayBuffer()
  expect(img.status === 200 && buf.byteLength > 500).toBe(true)
  const txQ = await h.J(`/api/tuxing/q?id=${txList.questions[0].id}`)
  expect(typeof txQ.exp === 'string' && txQ.exp.length > 30, `exp ${txQ.exp.length} 字`).toBe(true)
})

test('v1.7 深度题库：27506 题 + 五维覆盖 100% + 解题链 + 知识点检索', async () => {
  const nk = await h.J('/api/naoku/status')
  if (!nk.ready) return expect(true).toBe(true)  // node:sqlite 不可用降级（旧文件同语义）
  expect(nk.stats.total > 20000, `${nk.stats.total} 题`).toBe(true)
  expect(nk.stats.kadianCoverage).toBe(100)
  const nq = await h.J('/api/naoku/questions?module=判断推理&count=1&ws=PROJ_VTEST_V17')
  const q3 = nq.questions[0]
  expect(!!(q3 && (q3.kadian || q3.reasoning || q3.fastest))).toBe(true)
  const kd = await h.J('/api/naoku/kadian?q=图形&limit=3')
  expect((kd.list || []).length).toBeGreaterThan(0)
})
