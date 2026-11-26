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
  /**
   * cycle-65 守卫（用户报「专题-总览-行测频道内容未同步」）：
   * 频道里的**每个 entry / topic.entry 的 view 必须是真实存在的视图**。
   * 此前 deepbank 视图删除后，行测频道仍指向 `view:'deepbank'` →
   * 用户点题型路由不到（表现为「点了没反应」）。静态声明与真实视图集必须对账。
   */
  const caps = await h.J('/api/capabilities')
  const viewSet = new Set((caps.views || []).map(v => v.id))
  const bad = []
  for (const e of (xcCh.entries || [])) if (!viewSet.has(e.view)) bad.push('entry:' + e.label + '→' + e.view)
  for (const e of (slCh.entries || [])) if (!viewSet.has(e.view)) bad.push('entry:' + e.label + '→' + e.view)
  for (const tp of (topicTree.topics || [])) {
    const v = tp && tp.entry && tp.entry.view
    if (v && !viewSet.has(v)) bad.push('topic:' + tp.title + '→' + v)
  }
  expect(bad, '专题入口/题型指向了不存在的视图: ' + bad.join(', ')).toEqual([])
})

test('v1.34.4 细分题型：出题必须是该题型（category∪qtype 精确过滤，非全文检索）', async () => {
  /**
   * cycle-65 事故（用户报「细分题型有问题」）：
   * ① 题型深链曾用 `pool/search?q=题型名` → 全文检索，实测「定义判断」5 条仅 1 条真属该题型；
   * ② 改按 `category` 等值后又漏 `qtype`（6 万题 category 为空）→ 题量腰斩；
   * ③ 带图补足未 honour 题型过滤 → 插队杂题，10 题里一半不符。
   * 本守卫端到端锁死：**返回的每一题都必须属于该题型**。
   */
  const { DatabaseSync } = await import('node:sqlite')
  const { USER_DATA_ROOT } = await import('../../dist/server/dataRoot.js')
  const db = new DatabaseSync(USER_DATA_ROOT + '/.kaogong.db', { readOnly: true })
  try {
    for (const cat of ['逻辑判断', '定义判断', '片段阅读']) {
      const d = await h.J('/api/pool/questions?category=' + encodeURIComponent(cat) + '&count=8')
      const qs = d.questions || []
      if (!qs.length) continue   // 该题型在池内为空 → 跳过（不制造假红）
      let ok = 0
      for (const q of qs) {
        const r = db.prepare('SELECT category, qtype FROM question WHERE canonical_id = ?').get(q.canonicalId || q.id)
        if (r && (r.category === cat || r.qtype === cat)) ok++
      }
      expect(ok === qs.length, `${cat}: 返回 ${qs.length} 题仅 ${ok} 题真属该题型（题型过滤失效/被补足污染）`).toBe(true)
    }
  } finally { db.close() }
})

test('v1.34.4b 细分题型落点必须是刷题页（practice），不是题库浏览页（pool）', async () => {
  /**
   * cycle-67 事故（用户报「点击没有跳转到对应细分题型的刷题页面」）：
   * 上一版落点是 `pool`（统一题库的检索/查看页）——用户点「片段阅读」被丢进数据浏览器。
   *
   * 为什么必须是**静态**守卫：render 测试用的是 harness mock（mock 里落点写死 practice），
   * 服务端把落点改回 pool 时 mock 不变 → render 仍绿（变异测试实证）。
   * 只有直接核对 `poolTopics.ts` 源码才能锁住「服务端真实落点」。
   */
  const fs = await import('node:fs')
  const src = fs.readFileSync('src/server/poolTopics.ts', 'utf8')
  // 细分题型的 entry 行：非图形推理必须落 practice（图形推理走 tuxing 专项）
  const line = src.split(/\r?\n/).find(l => l.includes("entry: c === '图形推理'") && l.includes('view:'))
  expect(!!line, '未找到细分题型 entry 定义行').toBe(true)
  expect(line.includes("view: 'practice'"), "细分题型落点应为 practice（刷题页），实际：" + String(line).trim()).toBe(true)
  expect(line.includes("params: { category: c }"), '细分题型落点必须带 category 参数').toBe(true)
  // 反向：不得再落 pool（题库浏览页）
  expect(/view: 'pool', params: \{ category/.test(src), '细分题型仍落 pool（题库浏览页），不是刷题页').toBe(false)
  // practice 必须真的消费 initialCategory（否则跳过去也只是停模块选择页）
  const sv = fs.readFileSync('src/client/views/study-view.tsx', 'utf8')
  expect(/initialCategory/.test(sv) && /draw\([^)]*cat0\)/.test(sv), 'practice 未把 initialCategory 用于抽题').toBe(true)
  // 关键：必须同时置 module（否则停在「选择练习模块」页 —— 用户报的直接原因）
  expect(/setModule\(/.test(sv) && /CAT_MODULE/.test(sv), 'practice 未按题型回填 module（会停在模块选择页）').toBe(true)
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

test('v1.7 深度题库（cycle-65 收敛后）：池内 2.7 万题 + 五维覆盖 + 考点检索走池端点', async () => {
  /**
   * 端点收敛：/api/naoku/* 六端点已退役，语义下沉到池——
   *   status→/api/pool/status、questions→/api/pool/questions?source=naoku、
   *   kadian→/api/pool/kadians、practice→/api/pool/by-kadian。
   * 断言语义不变（题量/五维覆盖/考点检索可用）。
   */
  const ps = await h.J('/api/pool/status')
  if (!ps.ready) return expect(true).toBe(true)   // 池未就绪降级（原 node:sqlite 不可用同语义）
  const nq = await h.J('/api/pool/questions?source=naoku&module=判断推理&count=1&ws=PROJ_VTEST_V17')
  const q3 = (nq.questions || [])[0]
  expect(!!(q3 && (q3.kadian || (q3.dims && (q3.dims.reasoning || q3.dims.fastest)))), '深度题库题缺五维标注').toBe(true)
  const kd = await h.J('/api/pool/kadians?q=' + encodeURIComponent('图形') + '&limit=3')
  expect((kd.list || []).length, '考点检索无结果').toBeGreaterThan(0)
  const bk = await h.J('/api/pool/by-kadian?kadian=' + encodeURIComponent('图形') + '&count=1')
  expect((bk.questions || []).length, '按考点反查无题').toBeGreaterThan(0)
})
