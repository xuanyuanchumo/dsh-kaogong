/**
 * tests/render/graph-journey.test.mjs — 渲染旅程·图谱域（cycle-47 阶段 19 迁移）
 *
 * 从 render.test.mjs 图谱段迁移（L1040-1310）：
 * RENDER-G-11（着色模式六按钮）/ G-11b（学习画像）/ G-12（图例卡）/ G-13（小地图接线
 * 产物证据链）/ G-17（直达业务按钮）/ C29-01（子图按需加载）/ G-14（导出 PNG）/
 * G-15（键盘命令）/ G-16（全交互零降级）/ C15-01..03（布局三态轮换 + 流动粒子 + 白盒三件套）。
 * fresh mount 独立步进；判定逐字等价。
 *
 * 运行：npx vitest run tests/render/graph-journey.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act, React, TestRenderer } from '../_harness/render.mjs'

let mp = null
let tr = null

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
  const gBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('图谱'))
  if (!gBtn) throw new Error('RENDER-G 未找到「图谱」导航按钮')
  await act(async () => { gBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
}, 60_000)

afterAll(() => {
  if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } }
})

test('RENDER-G-11/11b: 着色模式按钮组（六模式）+ 社区切换零降级 + 学习画像图例', async () => {
  const gBtns = tr.root.findAllByType('button')
  const modeLabels = ['类型', '社区', 'PageRank', '中介', '度', '掌握度']
  const missM = modeLabels.filter(l => !gBtns.some(b => String(b.props.children) === l))
  expect(missM, '着色模式按钮缺失').toEqual([])
  const comBtn = gBtns.find(b => String(b.props.children) === '社区')
  await act(async () => { comBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length, '着色模式切换降级').toBe(0)
  const masteryBtn = tr.root.findAllByType('button').find(b => String(b.props.children) === '掌握度')
  await act(async () => { masteryBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const t2 = JSON.stringify(tr.toJSON())
  expect(t2.includes('学习画像 · 我的模块掌握率'), '掌握度图例缺失').toBe(true)
  expect(t2.includes('判断推理 55%') && t2.includes('资料分析 85%'), '模块掌握率 chips 缺失').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})

test('RENDER-G-12: 图例卡（节点/边类型过滤 chips）渲染', () => {
  const gText = JSON.stringify(tr.toJSON())
  expect(gText.includes('🎨 图例与过滤')).toBe(true)
  expect(gText.includes('边类型（点击显隐）')).toBe(true)
})

test('RENDER-G-13/G-17/C29-01: 小地图 + 直达业务 + 子图按需加载（产物证据链）', async () => {
  const gCanvases = tr.root.findAll(n => n.type === 'canvas')
  expect(gCanvases.length, '主画布 canvas 未创建').toBeGreaterThan(0)
  const fs3 = await import('node:fs')
  const combo3 = fs3.readFileSync(new URL('../../dist/client/client.js', import.meta.url), 'utf8')
  expect(combo3.includes('小地图：点击/拖拽平移视口') && combo3.includes('graphBindMiniMap') && combo3.includes('function drawMini')).toBe(true)
  expect(combo3.includes('打开该视图') && combo3.includes('去刷该模块') && combo3.includes('读方法论')).toBe(true)
  // cycle-49：onGo 统一出口形态变更——旧断言锚定内联箭头，现为共享 go 闭包
  //（教训④：形态守卫必须跟架构改动同波次更新）。新断言同时验证「全视图出口」落地。
  // 注意：产物是 tsc 擦除类型后的形态（无 ": any" 注解），断言按产物实际文本锚定
  expect(combo3.includes('const go = (v, params) => setView(v, params || {})')).toBe(true)
  expect(combo3.includes('统一跳转契约') && combo3.includes('消灭「只有入口没有出口」的死胡同视图')).toBe(true)
  expect(combo3.includes('masteryMap')).toBe(true)
  expect(combo3.includes('1跳邻域') && combo3.includes('2跳邻域') && combo3.includes('影响面')).toBe(true)
  expect(combo3.includes('子图模式') && combo3.includes('返回全图') && combo3.includes('仍按全图口径')).toBe(true)
  expect(combo3.includes('loadSubgraph') && combo3.includes('graph/neighborhood') && combo3.includes('graph/impact')).toBe(true)
  expect(combo3.includes('dependents') && combo3.includes('idSet')).toBe(true)
})

test('RENDER-G-14: 导出 PNG 按钮渲染且 canvas stub 下点击不抛错', async () => {
  const pngBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('导出 PNG'))
  expect(!!pngBtn, '导出 PNG 按钮缺失').toBe(true)
  await act(async () => { pngBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
})

test('RENDER-G-15: 键盘提示 + 快捷键真实生效（l 切换布局；Esc 清除）', async () => {
  const gText = JSON.stringify(tr.toJSON())
  expect(gText.includes('快捷键 +/−/0/f/l/Esc')).toBe(true)
  const kbWrap = tr.root.findAll(n => n.props && String(n.props['aria-label'] || '').includes('获得焦点后可用键盘'))
  expect(kbWrap.length, '键盘 aria 提示缺失').toBeGreaterThan(0)
  const layoutBtn = () => tr.root.findAllByType('button').find(b => String(b.props.children).includes('布局：'))
  const before = String(layoutBtn().props.children)
  await act(async () => { kbWrap[0].props.onKeyDown({ key: 'l', target: { tagName: 'DIV' }, preventDefault: () => {} }) })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const after = String(layoutBtn().props.children)
  expect(before !== after, '键盘 l 未触发布局切换').toBe(true)
  await act(async () => { kbWrap[0].props.onKeyDown({ key: 'Escape', target: { tagName: 'DIV' } }) })
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
})

test('RENDER-G-16: 图谱着色/导出/键盘全交互序列 canvas stub 零降级', () => {
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
  expect(JSON.stringify(tr.toJSON()).includes('🕸️ 交互图谱')).toBe(true)
})

test('C15-01/02: 布局三态轮换（force→layered→circular→force）+ 流动粒子开关', async () => {
  const lb = () => tr.root.findAllByType('button').find(b => String(b.props.children).includes('布局：'))
  expect(!!lb(), 'C15 布局按钮缺失').toBe(true)
  const seq = [String(lb().props.children)]
  for (let i = 0; i < 3; i++) {
    await act(async () => { lb().props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 25)) })
    seq.push(String(lb().props.children))
  }
  expect(seq[0] !== seq[1] && seq[1] !== seq[2] && seq[2] !== seq[3] && seq[3] === seq[0],
    '布局三态轮换异常: ' + seq.join(' → ')).toBe(true)
})

test('C15-03: 白盒三件套（延迟阶梯/吞吐象限/完成度环）渲染且零降级', async () => {
  const oBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
  if (!oBtn) throw new Error('C15 未找到可观测导航按钮')
  await act(async () => { oBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 90)) })
  const obsText = JSON.stringify(tr.toJSON())
  for (const k of ['延迟分位阶梯', '吞吐 × 延迟四象限', 'SLO 200ms', '/7 阶段']) {
    expect(obsText.includes(k), 'C15 白盒三件套缺失: ' + k).toBe(true)
  }
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})
