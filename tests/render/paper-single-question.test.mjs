/**
 * tests/render/paper-single-question.test.mjs — 真题卷「单题呈现」七段守卫（cycle-62）
 *
 * ── 事故 ──
 * 用户报「题目的来源/题型/题号/材料/题干/选项/答案/解析（均可能带图）组件化显示有问题」。
 * 真题卷侧的两处真实缺陷：
 *   ① `QwPaperMode` 题目卡**只透传 `answer`**，而池/卷出站发的是 `correctAnswer`
 *      → 卷内答题（专题/模考同源）的「✅ 答案」整行永不显示；
 *   ② 题号取题目自带 `no`（依赖卷内 seq，naoku 等源为 0）→ 与答题卡格子序号自相矛盾。
 *
 * ── 本守卫（走真实路径：真题卷 → 选卷 → 整卷模式 → 翻到第 2 题行测选择题）──
 *   0 编号 = 答题卡位置号（1 起，与「2 / 2」位置指示同源）
 *   1/2 来源与题型（📕 模块 + 🏷 类型）
 *   4 题干    5 选项（A–D 文本）    6 答案（✅ 答案：B）    7 解析
 *
 * ⚠️ 注意：真题卷选卷后**没有独立的「单题浏览页」**——直接进整卷模式（QwPaperMode），
 * 单题呈现即该容器的题目区。守卫按此真实路径编写（不假设不存在的页面）。
 *
 * 运行：npx vitest run tests/render/paper-single-question.test.mjs
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
const click = async (b, w = 250) => { await act(async () => { b.props.onClick() }); await wait(w) }
const snap = () => JSON.stringify(tr.toJSON())

/** 扁平文本（深度展开，用于 div 行定位） */
function flatText(node, depth) {
  if (depth > 8 || !node) return ''
  let s = ''
  if (node.children && Array.isArray(node.children)) {
    for (const ch of node.children) {
      if (typeof ch === 'string') s += ch
      else if (ch && typeof ch === 'object') s += flatText(ch, depth + 1)
    }
  }
  return s
}

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
  await wait(60)
  // 真题卷 → 选卷（选卷后直接进整卷模式）
  const ppBtn = btns().find(b => txt(b.props.children).includes('真题卷'))
  expect(!!ppBtn, '未找到「真题卷」导航').toBe(true)
  await click(ppBtn, 300)
  const rows = tr.root.findAll(n => n.type === 'div' && typeof n.props.onClick === 'function', { deep: true })
  const paperRow = rows.find(r => flatText(r, 0).includes('副省级'))
  expect(!!paperRow, '未找到试卷列表项「副省级」').toBe(true)
  await click(paperRow, 400)
}, 60_000)

afterAll(() => {
  if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } }
})

test('PSQ-01 选卷后进入整卷模式（答题卡 + 题目切换齐备）', async () => {
  const t = snap()
  expect(t.includes('整卷浏览') || t.includes('整卷模式'), 'PSQ-01 未进入整卷模式').toBe(true)
  expect(t.includes('答题卡'), 'PSQ-01 答题卡缺失').toBe(true)
  expect(!!btns().find(b => /下一题/.test(txt(b.props.children))), 'PSQ-01 题目切换缺失').toBe(true)
})

test('PSQ-02 第 2 题（行测选择题）七段齐全：编号/题型/题干/选项/答案/解析', async () => {
  // 翻到第 2 题（mock 第 2 题是行测选择题，带 options/correctAnswer='B'/analysis）
  const next = btns().find(b => /下一题/.test(txt(b.props.children)))
  await click(next, 300)
  const t = snap()

  // 4 题干
  expect(t.includes('行测题干'), 'PSQ-02 题干未渲染').toBe(true)
  // 5 选项（A–D 文本）
  for (const L of ['选项A', '选项B', '选项C', '选项D']) {
    expect(t.includes(L), `PSQ-02 选项 ${L} 未渲染`).toBe(true)
  }
  // 2 题型（模块 chip + 类型 chip）
  expect(t.includes('📕') && t.includes('判断推理'), 'PSQ-02 模块 chip 未渲染').toBe(true)
  expect(t.includes('🏷') && t.includes('单项选择题'), 'PSQ-02 类型 chip 未渲染').toBe(true)
  // 6 答案（cycle-62 修复点：QwPaperMode 原先只传 answer → 答案行永不显示）
  expect(/答案[：:]\s*B/.test(t),
    'PSQ-02 答案行未渲染（QwPaperMode 只透传 answer，服务端发 correctAnswer）').toBe(true)
  // 7 解析
  expect(t.includes('解析文本'), 'PSQ-02 解析段未渲染').toBe(true)
})

test('PSQ-03 编号 = 答题卡位置号（与「i / N」位置指示同源，非 ?/0）', async () => {
  const t = snap()
  // 第 2 题：位置指示「2 / 2」，答题卡第 2 格与卡片头徽章均应为 2
  expect(t.includes('2 / 2'), 'PSQ-03 位置指示缺失').toBe(true)
  expect(/"children":\["2"\]/.test(t), 'PSQ-03 编号未渲染为位置号 2').toBe(true)
  expect(/"children":\["\?"\]/.test(t), 'PSQ-03 编号显示 `?`（字段名错配未修）').toBe(false)
})
