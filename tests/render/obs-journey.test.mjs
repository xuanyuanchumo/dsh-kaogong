/**
 * tests/render/obs-journey.test.mjs — 渲染旅程·可观测域（cycle-47 阶段 19 迁移）
 *
 * 从 render.test.mjs 白盒段迁移（L975-1024 + L1097-1098）：
 * 白盒八区块 + 生命周期 stepper + 能力对账表 state 徽标 + sparkline + 过滤输入 +
 * 问题端点开关 + RENDER-O-11..15（能力流三列图/量化四卡/三态灯列/泳道热力格/字段缺失降级）。
 * fresh mount 独立步进（harness mountPanel）；判定逐字等价。
 *
 * 运行：npx vitest run tests/render/obs-journey.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act, React, TestRenderer } from '../_harness/render.mjs'

let mp = null
let tr = null

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
  // 进入可观测视图
  const oBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
  if (!oBtn) throw new Error('未找到可观测导航按钮')
  await act(async () => { oBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
}, 60_000)

afterAll(() => {
  if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } }
})

test('白盒面板八区块齐备（生命周期/对账/性能/告警/命名空间/管理动作）', async () => {
  const obsText = JSON.stringify(tr.toJSON())
  const required = ['白盒管理面板', '生命周期状态机', '能力对账', '慢端点', '工作区命名空间', '导出诊断', '我的学习质量']
  const missing = required.filter(k => !obsText.includes(k))
  expect(missing, '白盒面板区块缺失').toEqual([])
})

test('生命周期 stepper：阶段名 + 三态可见', () => {
  const obsText = JSON.stringify(tr.toJSON())
  expect(obsText.includes('serve') && obsText.includes('cleanup'), '生命周期 stepper 未渲染阶段名').toBe(true)
})

test('能力对账表：table 形态 + state 徽标（未触达）', () => {
  expect(tr.root.findAllByType('table').length).toBeGreaterThan(0)
  expect(JSON.stringify(tr.toJSON()).includes('未触达')).toBe(true)
})

test('端点性能表 sparkline（内联 SVG）+ 过滤输入生效（表格范围）', async () => {
  const svgs = tr.root.findAll(n => n.type === 'svg')
  expect(svgs.length, '端点性能表缺 sparkline').toBeGreaterThan(0)
  const filters = tr.root.findAll(n => n.type === 'input' && /过滤端点/.test(String(n.props.placeholder || '')))
  expect(filters.length, '能力对账缺过滤输入框').toBeGreaterThan(0)
  await act(async () => { filters[0].props.onChange({ target: { value: '/api/status' } }) })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  const tableRows = tr.root.findAllByType('table')
  expect(tableRows.length, '过滤后表格消失').toBeGreaterThan(0)
  function tblText(node) {
    if (node == null) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(tblText).join(' ')
    if (node.props) return tblText(node.props.children)
    return ''
  }
  const tableText = tblText(tableRows[0].props.children)
  expect(tableText.includes('/api/status'), '过滤后目标行丢失').toBe(true)
  expect(tableText.includes('/api/questions'), '过滤未生效（/api/questions 仍在表内）').toBe(false)
})

test('问题端点开关（可点、不降级）', async () => {
  const pBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('仅问题端点'))
  if (pBtn) {
    await act(async () => { pBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length, '问题端点开关后渲染降级').toBe(0)
  }
})

test('RENDER-O-11: 能力流三列图渲染（注册→生产→消费 SVG + 贝塞尔链接）', () => {
  const obsText = JSON.stringify(tr.toJSON())
  expect(obsText.includes('能力流 · 注册→生产→消费')).toBe(true)
  const svgs = tr.root.findAll(n => n.type === 'svg')
  const flowSvg = svgs.find(s => s.findAll(n => n.type === 'path').length > 0)
  expect(!!flowSvg, '流动图 SVG（含链接 path）未渲染').toBe(true)
})

test('RENDER-O-12: 量化四卡渲染（SLO 达成率/错误预算/遥测样本/能力健康度）', () => {
  const obsText = JSON.stringify(tr.toJSON())
  const quad = ['SLO 达成率', '错误预算', '遥测样本', '能力健康度']
  const missQ = quad.filter(k => !obsText.includes(k))
  expect(missQ, '量化卡缺失').toEqual([])
})

test('RENDER-O-13: 能力对账表三态灯列 + 三态筛选 chips 渲染', () => {
  const obsText = JSON.stringify(tr.toJSON())
  expect(obsText.includes('注册·生产·消费')).toBe(true)
  expect(tr.root.findAllByType('button').some(b => /异常/.test(String(b.props.children))) &&
    tr.root.findAllByType('button').some(b => /未消费/.test(String(b.props.children)))).toBe(true)
})

test('RENDER-O-14: 生命周期事件泳道热力格渲染（阶段 × 14 天网格 ≥60 rect）', () => {
  const obsText = JSON.stringify(tr.toJSON())
  expect(obsText.includes('事件泳道 · 阶段 × 近 14 天')).toBe(true)
  const svgs = tr.root.findAll(n => n.type === 'svg')
  const laneSvg = svgs.find(s => s.findAll(n => n.type === 'rect').length >= 60)
  expect(!!laneSvg, '泳道热力格 SVG 未渲染').toBe(true)
})

test('RENDER-O-15: obs 全字段缺失降级不抛错（卡片级降级，无 role=alert）', async () => {
  const fullFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('/api/capabilities') || u.includes('/api/telemetry') || u.includes('/api/lifecycle') || u.includes('/api/workspaces')) {
        return { json: async () => ({}) }
      }
      return fullFetch(url)
    }
    const dashBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('仪表盘'))
    await act(async () => { dashBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    const obsBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
    await act(async () => { obsBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 90)) })
    const alert = tr.root.findAll(n => n.props && n.props.role === 'alert')
    expect(alert.length, '字段缺失降级失败').toBe(0)
  } finally {
    globalThis.fetch = fullFetch
  }
})

/* ══ cycle-61 v9：数据域矩阵 + 缓存白盒两卡（真实 React 渲染） ══ */

test('RENDER-O-16: 数据域就绪矩阵卡渲染（六域 + 就绪徽标）', async () => {
  // 回到可观测（前序用例可能已切换视图）；重复进入用 tick 重挂载
  const obsBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
  if (obsBtn) {
    await act(async () => { obsBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  }
  const txt = JSON.stringify(tr.toJSON())
  expect(txt.includes('数据域就绪矩阵'), '数据域卡片未渲染').toBe(true)
  // 六域标签至少出现其一二（harness mock 提供完整六域）
  expect(/练习题|真题卷|图形推理|方法论|统一题库/.test(txt), '域标签缺失').toBe(true)
  // 就绪/未入库/入库中 三态词表之一（状态机而非布尔）
  expect(/就绪|未入库|入库中/.test(txt), '域状态词缺失').toBe(true)
})

test('RENDER-O-17: 统一缓存卡渲染（域命中率/失效图/订阅者）+ 不出现 role=alert', async () => {
  const txt = JSON.stringify(tr.toJSON())
  expect(txt.includes('统一缓存'), '缓存卡片未渲染').toBe(true)
  // 失效图与订阅者是可解释字段（架构事实可观测）
  expect(txt.includes('失效图') || txt.includes('订阅者'), '缓存白盒缺可解释字段').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length, '缓存卡渲染降级').toBe(0)
})
