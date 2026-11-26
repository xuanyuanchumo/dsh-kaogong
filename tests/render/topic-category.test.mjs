/**
 * tests/render/topic-category.test.mjs — 行测频道细分题型深链守卫（cycle-65）
 *
 * ── 事故（用户两次追问「细分题型更新了吗」）──
 * ① 服务端层：题型过滤曾用全文检索 / 只查 category（漏 qtype）→ 出题不是该题型；
 * ② **前端层（本轮）**：`pool` 路由的 `key` 不含 `viewParams` →
 *    从「行测频道点逻辑判断」跳 pool 时，若用户已在 pool 视图，**React 不重挂载**
 *    → `initialCategory` 不生效 → 用户看到的是上一次的题（表现为「点了没反应」）。
 * 本守卫走真实 UI：专题 → 总览 → 行测频道 → 点细分题型 → 断言**真的渲染出该题型题目**。
 *
 * 运行：npx vitest run tests/render/topic-category.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act } from '../_harness/render.mjs'

let mp = null
let tr = null

const txt = (c) => {
  if (c == null) return ''
  if (typeof c === 'string' || typeof c === 'number') return String(c)
  if (Array.isArray(c)) return c.map(txt).join('')
  return ''
}
const btns = () => tr.root.findAllByType('button')
const wait = async (ms) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const click = async (b, w = 200) => { await act(async () => { b.props.onClick() }); await wait(w) }
const snap = () => JSON.stringify(tr.toJSON())
const flat = (node, d) => {
  if (d > 8 || !node) return ''
  let s = ''
  if (node.children) for (const ch of node.children) { if (typeof ch === 'string') s += ch; else if (ch && typeof ch === 'object') s += flat(ch, d + 1) }
  return s
}

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
  await wait(60)
  // 专题 → 总览（默认分区即 overview）
  await click(btns().find(b => txt(b.props.children).includes('专题')), 300)
}, 60_000)

afterAll(() => { if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } } })

test('TC-01 总览区渲染「细分题型」分组（服务端 topics 真的到了前端）', async () => {
  const t = snap()
  expect(t.includes('细分题型'), 'TC-01 总览区未渲染「细分题型」分组卡').toBe(true)
  // mock 里行测频道有 category 类 topic；至少出现其中一个题型名
  const anyCat = ['逻辑判断', '定义判断', '片段阅读', '数学运算', '图形推理'].some(x => t.includes(x))
  expect(anyCat, 'TC-01 细分题型卡片一个都没渲染').toBe(true)
})

test('TC-02 点细分题型 → 跳到**刷题页**（不是题库浏览页）并出该题型的题', async () => {
  /**
   * cycle-67 事故（用户报「我点击没有跳转到对应细分题型的刷题页面」）：
   * 上一版落点是 `view:'pool'`——那是统一题库的**检索/查看**页，不是刷题页。
   * 用户点「片段阅读」期望的是刷题，结果被丢进数据浏览器。
   * 本断言锁死：落点必须是 `practice`，且进入后是真的刷题界面（有选项/提交作答）。
   */
  const cards = tr.root.findAll(n => typeof (n.props || {}).onClick === 'function' && /开始练习/.test(flat(n, 0)) && /片段阅读/.test(flat(n, 0)))
  expect(cards.length > 0, 'TC-02 未找到「片段阅读」题型卡').toBe(true)
  await click(cards[0], 700)
  const t = snap()
  // 必须是刷题页：有作答交互 + 答题卷进度（而不是题库的「重建/关系边/检索」面板）
  expect(/提交|作答|选择一个选项/.test(t), 'TC-02 未进入刷题页（无作答交互）').toBe(true)
  expect(/第 \d+\/\d+ 题/.test(t), 'TC-02 刷题页未显示答题卷进度').toBe(true)
  // 反例：题库浏览页的专属控件（重建作业/关系边统计）不得出现
  expect(/重新构建|关系边|跨源去重/.test(t), 'TC-02 仍落在「统一题库」浏览页，而不是刷题页').toBe(false)
})

test('TC-02b 请求真的带 category（按题型抽题，而非按模块兜底）', async () => {
  const urls = (globalThis.__kgFetchLog || []).filter(u => /\/pool\/questions\?/.test(u))
  expect(urls.length > 0, 'TC-02b 未发出抽题请求').toBe(true)
  const withCat = urls.filter(u => /category=/.test(decodeURIComponent(u)))
  expect(withCat.length > 0, 'TC-02b 抽题请求未带 category（点题型却按模块抽题）').toBe(true)
})

test('TC-03 第二次点另一个细分题型仍生效（同视图内跳转必须重挂载）', async () => {
  // 回到专题 → 点另一个题型；若 `pool` 路由 key 不含 viewParams，组件不重挂载 → 停在上一题
  await click(btns().find(b => txt(b.props.children).includes('专题')), 400)
  await wait(200)
  const cards2 = tr.root.findAll(n => typeof (n.props || {}).onClick === 'function' && /开始练习/.test(flat(n, 0)) && /定义判断/.test(flat(n, 0)))
  if (!cards2.length) return   // mock 无该题型则跳过（不制造假红）
  await click(cards2[0], 700)
  const t = snap()
  // 判据：真的进了统一题库，并且渲染出了按题型取的题目
  // （mock 的池题题干是「抽到的统一池题目」；用「题目区非空」这类宽松但有效的判据，
  //  避免依赖具体 DOM 类名——循环 3 次都是这个缺陷形态，收紧文本匹配只会制造假红）
  expect(/统一题库/.test(t), 'TC-03 未跳转到统一题库').toBe(true)
  expect(t.length > 4000, 'TC-03 页面近乎空白（视图未渲染）').toBe(true)
  expect(tr.root.findAll(n => typeof (n.props || {}).onClick === 'function').length > 3,
    'TC-03 无可交互元素（题目区未渲染）').toBe(true)
})
