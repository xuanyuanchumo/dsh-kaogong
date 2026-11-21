/**
 * tests/render/huasheng13-journey.test.mjs — 渲染旅程·方法论视图域（cycle-47 阶段 19 迁移·批三）
 *
 * 从 render.test.mjs C18 段迁移（L1390-1540）：
 * C18-01（视图挂载 + 五分区 tab）/ C18-02（逐区切换零降级）/ C18-03（总览六模块卡 +
 * 覆盖率 97.6% 口径一致）/ C18-04（检索交互 + 置信度）/ C18-05（配套练习）/
 * C18-06（白盒链路）/ C18-07（hub method 分区可达）/ C18-08（白盒方法论链路卡）。
 * 导航锚定纪律（教训④）：一律属性锚定 data-kg-hs13-tab / data-kg-hub-tab。
 * fresh mount 独立步进；判定逐字等价。
 *
 * 运行：npx vitest run tests/render/huasheng13-journey.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act, React, TestRenderer } from '../_harness/render.mjs'

let mp = null
let tr = null

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
  // 进入专题枢纽 → 方法论分区
  const topicBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('专题'))
  if (!topicBtn) throw new Error('C18 未找到「🎯 专题」一级导航按钮')
  await act(async () => { topicBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 140)) })
  const hubTab = tr.root.findAll(n => n.props && n.props['data-kg-hub-tab'] === 'method')
  if (!hubTab.length) throw new Error('C18 专题枢纽未找到 data-kg-hub-tab=method 分区')
  await act(async () => { hubTab[0].props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 160)) })
}, 60_000)

afterAll(() => {
  if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } }
})

test('C18-01: 花生十三体系视图挂载 + 五分区 tab 齐备（属性锚定）+ 无独立一级入口', () => {
  // 一级导航不得再出现独立「花生十三体系」入口（用户要求：并入专题方法论）
  const strayBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('花生十三体系'))
  expect(!strayBtn, 'C18 违规：一级导航仍存在独立「花生十三体系」入口').toBe(true)
  const rootEl = tr.root.findAll(n => n.props && n.props['data-kg-hs13-root'] === '1')
  expect(rootEl.length, 'C18 枢纽方法论分区内未挂载花生十三体系视图').toBeGreaterThan(0)
  const SEC = ['overview', 'catalog', 'search', 'practice', 'trace']
  const tabEls = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'])
  const foundIds = new Set(tabEls.map(n => String(n.props['data-kg-hs13-tab'])))
  const missSec = SEC.filter(id => !foundIds.has(id))
  expect(missSec, 'C18 五分区 tab 缺失').toEqual([])
})

test('C18-02: 五分区逐区切换零降级（overview/catalog/search/practice/trace 全绿）', async () => {
  for (const id of ['overview', 'catalog', 'search', 'practice', 'trace']) {
    const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === id)
    expect(tb.length, 'C18 分区 tab 未找到: ' + id).toBeGreaterThan(0)
    await act(async () => { tb[0].props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 90)) })
    const alert = tr.root.findAll(n => n.props && n.props.role === 'alert')
    expect(alert.length, `C18 分区「${id}」渲染降级`).toBe(0)
  }
})

test('C18-03: 体系总览渲染六模块卡片 + 覆盖率（0.9756 → 97.6% 口径一致）', async () => {
  const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === 'overview')
  await act(async () => { tb[0].props.onClick() })
  await act(async () => {
    for (let i = 0; i < 24; i++) {
      if (JSON.stringify(tr.toJSON()).includes('资料分析')) break
      await new Promise(r => setTimeout(r, 50))
    }
  })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  const t = JSON.stringify(tr.toJSON())
  expect(t.includes('资料分析') && t.includes('数量关系'), 'C18 总览缺少模块卡片').toBe(true)
  expect(/97\.6%/.test(t), 'C18 总览未渲染覆盖率').toBe(true)
  expect(/98%/.test(t), 'C18 总览出现 98% 取整口径不一致').toBe(false)
})

test('C18-04: 检索交互（输入「截位直除」→ 发请求 → 结果列表 + 置信度「精确命中」）', async () => {
  const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === 'search')
  await act(async () => { tb[0].props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 90)) })
  const input = tr.root.findAllByType('input').find(i => {
    const ph = String((i.props && i.props.placeholder) || '')
    return ph.includes('考点') || ph.includes('截位直除') || ph.includes('方法名')
  })
  expect(!!input, 'C18 检索分区未找到搜索输入框').toBe(true)
  await act(async () => { input.props.onChange({ target: { value: '截位直除' } }) })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  // 精确文本匹配（教训：includes('检索') 会命中「🔍 知识检索」导航导致切视图）
  const searchBtn = tr.root.findAllByType('button').find(b => {
    const txt = String(b.props && b.props.children == null ? '' : b.props.children).trim()
    return txt === '检索' || txt === '检索中…'
  })
  expect(!!searchBtn, 'C18 未找到检索分区内的「检索」按钮（精确文本）').toBe(true)
  const before = globalThis.__kgFetchLog.length
  await act(async () => { searchBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  const hitUrl = globalThis.__kgFetchLog.slice(before).find(x => x.includes('/api/huasheng13/search') && x.includes('q=' + encodeURIComponent('截位直除')))
  expect(!!hitUrl, 'C18 检索未触发带 q=截位直除 的请求').toBe(true)
  const t = JSON.stringify(tr.toJSON())
  expect(t.includes('三大速算方法'), 'C18 检索结果列表未渲染').toBe(true)
  expect(t.includes('精确命中'), 'C18 未渲染置信度 high→精确命中').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})

test('C18-05: 配套练习分区渲染题干（practice 消费真实 items）+ 零降级', async () => {
  const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === 'practice')
  await act(async () => { tb[0].props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 150)) })
  const t = JSON.stringify(tr.toJSON())
  expect(t.includes('资料分析练习第'), 'C18 练习分区未渲染题干').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})

test('C18-06: 白盒链路分区渲染 trace（端点命中/检索统计）+ 零降级', async () => {
  const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === 'trace')
  await act(async () => { tb[0].props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  const t = JSON.stringify(tr.toJSON())
  expect(t.includes('链路') || t.includes('命中'), 'C18 白盒分区未渲染链路信息').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})

test('C18-07: 专题枢纽「📖 方法论」分区仍可达且零降级（与 hs13 数据域不混用）', async () => {
  await mp.enterHubTab('method')
  const methodTab = tr.root.findAll(n => n.props && n.props['data-kg-hub-tab'] === 'method')
  expect(methodTab.length, 'C18 专题枢纽 method 分区 tab 缺失').toBeGreaterThan(0)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})

test('C18-08: 白盒「📖 方法论链路」卡（三源齐请求 + 热力条 + 量化 + 缺口如实 + 零降级）', async () => {
  const oBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
  if (!oBtn) throw new Error('C18 未找到「可观测」导航按钮')
  const before = globalThis.__kgFetchLog.length
  await act(async () => { oBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 140)) })
  const reqs = globalThis.__kgFetchLog.slice(before).join(' ')
  for (const ep of ['/api/huasheng13/trace', '/api/huasheng13/coverage', '/api/huasheng13/catalog']) {
    expect(reqs.includes(ep), 'C18-08 白盒面板未请求方法论三源: ' + ep).toBe(true)
  }
  const t = JSON.stringify(tr.toJSON())
  expect(t.includes('方法论链路'), 'C18-08 白盒面板「📖 方法论链路」卡未渲染').toBe(true)
  for (const k of ['资料分析', '言语理解', '常识判断']) {
    expect(t.includes(k), 'C18-08 方法论链路卡缺模块热力条: ' + k).toBe(true)
  }
  expect(t.includes('97.6%'), 'C18-08 未渲染覆盖率 97.6%').toBe(true)
  expect(t.includes('100.0%'), 'C18-08 未渲染检索命中率 100.0%').toBe(true)
  expect(/端点 p95 均值/.test(t), 'C18-08 未渲染 p95 指标').toBe(true)
  expect(t.includes('缺口'), 'C18-08 未展示缺口清单').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})
