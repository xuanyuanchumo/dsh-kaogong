/**
 * img-search-integration.test.mjs — 图片搜题并入统一检索区真实 UI 旅程（用户 2026-11-28 反馈）
 *
 * 走真实 client.js + React 渲染：
 *  统一题库 → 跨源统一检索 → 展开「🖼 图片搜题」→ 模型开关/provider/model 入口
 *  → 检索结果七段渲染 → 加入错题本（真实补录 mock）。
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
/** PoolSearchRow 的题干是 <span onClick>，不是 button——需按 onClick 找任意节点 */
const clickables = () => {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (n.props && typeof n.props.onClick === 'function') out.push(n)
    if (n.children) for (const c of n.children) walk(c)
  }
  walk(tr.root)
  return out
}
const inputs = () => tr.root.findAllByType('input')
const wait = async (ms) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const click = async (b, w = 150) => { await act(async () => { b.props.onClick() }); await wait(w) }
const snap = () => JSON.stringify(tr.toJSON())

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
  await wait(80)
  // 左栏导航切到「统一题库」
  const pool = btns().find(b => txt(b.props.children).includes('统一题库')) || btns().find(b => txt(b.props.children).includes('题库'))
  if (pool) await click(pool, 250)
}, 60_000)

afterAll(() => { if (tr) { try { tr.unmount() } catch {} } })

test('ISINT-01 统一检索区有「🖼 图片搜题」展开入口（无独立视图）', async () => {
  const t = snap()
  expect(t.includes('跨源统一检索'), '未渲染跨源统一检索卡').toBe(true)
  expect(t.includes('🖼 图片搜题'), '检索区无图片搜题入口').toBe(true)
})

test('ISINT-02 展开后有「使用模型」开关 + provider/model 切换入口', async () => {
  const b = btns().find(x => txt(x.props.children).includes('🖼 图片搜题'))
  expect(!!b, '图片搜题按钮不存在').toBe(true)
  await click(b, 120)
  const t = snap()
  expect(t.includes('使用模型'), '缺使用模型开关').toBe(true)
  expect(t.includes('选择 provider'), '缺 provider 切换入口').toBe(true)
  expect(t.includes('选择模型'), '缺 model 切换入口').toBe(true)
})

test('ISINT-03 检索结果七段渲染（题号/选项/答案/材料）', async () => {
  // 在检索输入框填关键词（PoolSearchRow 题干是 <span onClick>）
  const qInput = inputs().find(x => String(x.props.placeholder || '').includes('关键词'))
  expect(!!qInput, '检索输入框不存在').toBe(true)
  await act(async () => { qInput.props.onChange({ target: { value: '图形推理' } }) })
  await wait(50)
  const searchBtn = btns().find(x => txt(x.props.children).trim() === '检索')
  await click(searchBtn, 250)
  const hit = clickables().find(x => txt(x.props.children).includes('从所给的四个选项中'))
  expect(!!hit, '检索命中行不存在（pool/search mock 未生效？）').toBe(true)
  await click(hit, 200)
  const t = snap()
  expect(t.includes('单题聚合视图'), '未渲染单题详情').toBe(true)
  expect(t.includes('第 44 题'), '缺题号渲染').toBe(true)
  expect(t.includes('选项甲'), '缺选项渲染').toBe(true)
  expect(t.includes('正确答案'), '缺答案渲染').toBe(true)
  expect(t.includes('给定材料'), '缺材料渲染').toBe(true)
})

test('ISINT-04 详情内有「加入错题本」按钮（可点，走真实补录）', async () => {
  const add = btns().find(x => txt(x.props.children).includes('加入错题本'))
  expect(!!add, '详情内无加入错题本按钮').toBe(true)
  await click(add, 200)
  const t = snap()
  expect(t.includes('已加入错题本'), '点击后未显示已加入状态').toBe(true)
})
