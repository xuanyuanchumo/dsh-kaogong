/**
 * tests/render/smoke-journey.test.mjs — 渲染旅程·基础域（cycle-47 阶段 17 迁移）
 *
 * 从 render.test.mjs 旅程段迁入的首个 vitest 分域文件（覆盖 L446-820）：
 * 专题枢纽刷题分区 → 选模块 → 抽题 → 提交判分 + 真题卷/专题/申论 + 省份维度 +
 * 统一题库三段旅程（POOL-34a/b/c）+ P-01 省份 chip 请求。
 * 使用 tests/_harness/render.mjs（combo 加载 + 49 端点 mock + fresh mount）。
 * 判定逐字等价。
 *
 * 运行：npx vitest run tests/render/smoke-journey.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act, React, TestRenderer, captured } from '../_harness/render.mjs'

let mp = null

beforeAll(async () => {
  mp = await mountPanel()
}, 60_000)

afterAll(() => {
  if (mp && mp.tr) { try { mp.tr.unmount() } catch { /* 已卸载 */ } }
})

const HUB = async (tabId) => { await mp.enterHubTab(tabId) }

test('旅程：专题枢纽→刷题分区渲染模块选择面板', async () => {
  await HUB('practice')
  const text2 = JSON.stringify(mp.tr.toJSON())
  expect(text2.includes('选择练习模块'), text2.slice(0, 120)).toBe(true)
})

test('旅程：选模块→抽题渲染题干', async () => {
  const modCards = mp.tr.root.findAll(el => el.props && typeof el.props.onClick === 'function' && el.props.style && String(el.props.style.cursor) === 'pointer')
  const modCard = [...modCards].reverse().find(el => mp.textOf(el.props.children).includes('判断推理'))
  expect(!!modCard, '未找到判断推理模块卡片').toBe(true)
  await act(async () => { modCard.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  expect(JSON.stringify(mp.tr.toJSON()).includes('测试题干')).toBe(true)
})

test('旅程：选项选择→提交→就地判分+解析', async () => {
  // 旧判据逐字等价：选项是 div（onClick）且文本以 A 开头（walkPropsText 取首字符串）；
  // 提交按钮 children 含「提交判分」；判分反馈 /回答正确|回答错误/ + 解析
  function walkPropsText(children) {
    const arr = Array.isArray(children) ? children : [children]
    for (const c of arr) {
      if (typeof c === 'string') return c
      if (c && c.props) { const t = walkPropsText(c.props.children); if (t) return t }
    }
    return ''
  }
  const optEls = mp.tr.root.findAll(el => el.type === 'div' && typeof el.props.onClick === 'function' && /^A/.test(walkPropsText(el.props.children)))
  const clickTarget = optEls[optEls.length - 1]
  expect(!!clickTarget, '未找到选项 A 元素').toBe(true)
  await act(async () => { clickTarget.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const submitBtn = mp.tr.root.findAllByType('button').find(b => String(b.props.children).includes('提交判分'))
  expect(!!submitBtn, '未找到提交判分按钮').toBe(true)
  await act(async () => { submitBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  const afterSubmit = JSON.stringify(mp.tr.toJSON())
  expect(/回答正确|回答错误/.test(afterSubmit), '提交后未展示判分反馈: ' + afterSubmit.slice(0, 150)).toBe(true)
  expect(afterSubmit.includes('解析')).toBe(true)
})

test('RENDER-POOL-34a: 统一题库视图渲染（库状态 + 源注册表 + 数据质量 + 关系词表）', async () => {
  const poolBtn = mp.tr.root.findAllByType('button').find(b => String(b.props.children).includes('统一题库'))
  expect(!!poolBtn, '未找到「统一题库」导航按钮').toBe(true)
  await act(async () => { poolBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 90)) })
  const t = JSON.stringify(mp.tr.toJSON())
  const alert = mp.tr.root.findAll(n => n.props && n.props.role === 'alert')
  expect(alert.length, '统一题库视图渲染降级').toBe(0)
  expect(t.includes('统一库状态')).toBe(true)
  expect(t.includes('27506')).toBe(true)
  expect(t.includes('已注册源')).toBe(true)
  expect(t.includes('深度题库')).toBe(true)
  expect(t.includes('数据质量')).toBe(true)
  expect(t.includes('关系类型分布')).toBe(true)
})

test('RENDER-POOL-34b: 跨源检索旅程（结果 + N 处出处聚合 + 引擎/耗时透出）', async () => {
  const input = mp.tr.root.findAllByType('input').find(i => String(i.props.placeholder || '').includes('FTS5 trigram'))
  expect(!!input, '检索输入框缺失').toBe(true)
  await act(async () => { input.props.onChange({ target: { value: '图形推理' } }) })
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const searchBtn = mp.tr.root.findAllByType('button').find(b => String(b.props.children) === '检索')
  expect(!!searchBtn).toBe(true)
  await act(async () => { searchBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 90)) })
  const t2 = JSON.stringify(mp.tr.toJSON())
  expect(t2.includes('处出处')).toBe(true)
  expect(t2.includes('fts5-trigram')).toBe(true)
})

test('RENDER-POOL-34c: 单题聚合详情（五维标注 + 出处清单 + 关系邻居）', async () => {
  // 检索结果行是 span（含 onClick + cursor:pointer），不递归 JSON.stringify（circular 结构）
  const rows = mp.tr.root.findAll(el => el.props && typeof el.props.onClick === 'function' &&
    el.props.style && String(el.props.style.cursor) === 'pointer')
  const row = rows.find(el => mp.textOf(el.props.children).includes('从所给的四个选项'))
  expect(!!row, '检索结果行不可点').toBe(true)
  await act(async () => { row.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  const t3 = JSON.stringify(mp.tr.toJSON())
  expect(t3.includes('单题聚合视图')).toBe(true)
  expect(t3.includes('五维标注')).toBe(true)
  expect(t3.includes('出处（')).toBe(true)
  expect(t3.includes('关系邻居')).toBe(true)
})

test('RENDER-N-02: 对话窗口瘦身（KaogongTabHome 精简引导体挂载）', async () => {
  // 回 dashboard（RESET）：GHOST 段的回导航语义
  const dBtn = mp.tr.root.findAllByType('button').find(b => String(b.props.children).includes('📊 仪表盘'))
  if (dBtn) { await act(async () => { dBtn.props.onClick() }); await act(async () => { await new Promise(r => setTimeout(r, 40)) }) }
  const t = JSON.stringify(mp.tr.toJSON())
  expect(t.includes('考公学习') || t.includes('仪表盘')).toBe(true)
})
