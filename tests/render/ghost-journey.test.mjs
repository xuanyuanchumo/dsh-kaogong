/**
 * tests/render/ghost-journey.test.mjs — 渲染旅程·幽灵视图补齐域（cycle-47 阶段 19 迁移·批四）
 *
 * 从 render.test.mjs RENDER-GHOST-46 段迁移（L1550-1590）：
 * GHOST-46a（学习计划：30 天日历 + 排程侧重 + 建议题量）+
 * GHOST-46b（知识检索：输入 → 检索 → 结果）+
 * GHOST-46c（方法参考：主题标签 → 全文渲染）。
 * fresh mount 独立步进；判定逐字等价。
 *
 * 运行：npx vitest run tests/render/ghost-journey.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act, React, TestRenderer } from '../_harness/render.mjs'

let mp = null
let tr = null

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
}, 60_000)

afterAll(() => {
  if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } }
})

test('RENDER-GHOST-46a: 学习计划（30 天日历 + 排程侧重 + 建议题量）', async () => {
  const planBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('🗓 计划'))
  expect(!!planBtn, '未找到「🗓 计划」导航按钮').toBe(true)
  await act(async () => { planBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  const tp = JSON.stringify(tr.toJSON())
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length, '学习计划渲染降级').toBe(0)
  expect(tp.includes('学习计划')).toBe(true)
  expect(tp.includes('画像侧重'), '智能排程画像卡未渲染').toBe(true)
  expect(tp.includes('12 题'), '排程建议题量未渲染').toBe(true)
})

test('RENDER-GHOST-46b: 知识检索旅程（输入 → 检索 → 结果渲染）', async () => {
  const sBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('🔎 检索'))
  expect(!!sBtn, '未找到「🔎 检索」导航按钮').toBe(true)
  await act(async () => { sBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  const sInput = tr.root.findAllByType('input').find(i => String(i.props.placeholder || '').includes('输入关键词'))
  expect(!!sInput, '知识检索输入框缺失').toBe(true)
  await act(async () => { sInput.props.onChange({ target: { value: '图形推理' } }) })
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const sRun = tr.root.findAllByType('button').find(b => String(b.props.children) === '检索')
  expect(!!sRun, '知识检索执行按钮缺失').toBe(true)
  await act(async () => { sRun.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  expect(JSON.stringify(tr.toJSON()).includes('sakib/判断推理/index.md'), '检索结果未渲染').toBe(true)
})

test('RENDER-GHOST-46c: 方法参考旅程（主题标签 → 全文渲染）', async () => {
  const mBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('📖 方法参考'))
  expect(!!mBtn, '未找到「📖 方法参考」导航按钮').toBe(true)
  await act(async () => { mBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  const mTag = tr.root.findAllByType('button').find(b => String(b.props.children) === '行测')
  expect(!!mTag, '方法参考主题标签缺失').toBe(true)
  await act(async () => { mTag.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  expect(JSON.stringify(tr.toJSON()).includes('行测方法参考'), '方法参考全文未渲染').toBe(true)
})
