/**
 * render.test.mjs — R9 真实渲染回归（dev-only，不进运行时零依赖面）
 *
 * 三层证据：
 *  1) 模式证明：v1.4 条件直调 → "Rendered more hooks" 崩溃；v1.5 挂载 → 零崩溃
 *  2) 真实代码集成：导入**实际发布的 client.js**，mock 宿主席位系统，渲染真实
 *     KaogongMainPanel：加载 → 切刷题 → 选项 → 提交 → 重挂载，全程零崩溃
 *  3) 反证：把真实代码的挂载方式改回直调（monkey-patch 不可行，故以模式层 1 承担反证）
 * 依赖解析指向 ../_kgtest/node_modules（dev 工具链目录，不污染插件包运行时）。
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { resolve } = require('node:path')
const devModules = resolve(process.cwd(), '..', '_kgtest', 'node_modules')
const React = require(resolve(devModules, 'react'))
const TestRenderer = require(resolve(devModules, 'react-test-renderer'))
const { act } = TestRenderer

let pass = 0, fail = 0
const ok = (name) => { console.log(`✅ ${name}`); pass++ }
const bad = (name, e) => { console.log(`❌ ${name}: ${String((e && e.message) || e).slice(0, 100)}`); fail++ }

/* ══ 1) 模式证明（v1.4 反模式 vs v1.5 正模式）══ */
function V14Parent({ view }) {
  React.useState(0)
  const dash = view === 'dashboard' ? 'D' : null
  const prac = view === 'practice' ? V14Practice() : null  // 直调：子 hook 记到父链
  return React.createElement('div', null, dash, prac)
}
function V14Practice() {
  const [sel] = React.useState(null)
  return React.createElement('button', null, 'p' + (sel || ''))
}
function V15Parent({ view }) {
  React.useState(0)
  return React.createElement('div', null,
    view === 'dashboard' ? 'D' : null,
    view === 'practice' ? React.createElement(V15Practice, { key: 'p' }) : null)
}
function V15Practice() {
  const [sel] = React.useState(null)
  return React.createElement('button', null, 'p' + (sel || ''))
}
try {
  const tr = TestRenderer.create(React.createElement(V14Parent, { view: 'dashboard' }))
  act(() => { tr.update(React.createElement(V14Parent, { view: 'practice' })) })
  bad('模式层: v1.4 条件直调应抛 hook 违例', new Error('未抛错'))
} catch (e) { ok(`模式层: v1.4 条件直调如预期抛错（${String(e.message).slice(0, 50)}）`) }
try {
  const tr = TestRenderer.create(React.createElement(V15Parent, { view: 'dashboard' }))
  act(() => { tr.update(React.createElement(V15Parent, { view: 'practice' })) })
  ok('模式层: v1.5 组件挂载同序列零崩溃')
} catch (e) { bad('模式层: v1.5 组件挂载', e) }

/* ══ 2) 真实 client.js 集成渲染 ══ */
globalThis.React = React
globalThis.styles = { insert: () => () => {} }
const store = { view: null }
globalThis.localStorage = { getItem: () => store.view, setItem: (_k, v) => { store.view = v } }
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('/api/stats')) return { json: async () => ({ rate: 60, answered: 10, day: 1, streak: 2, mastery: {}, wrong: { open: 1, mastered: 0 } }) }
  if (u.includes('/api/status')) return { json: async () => ({ app: 'dsh-kaogong', port: 8400, repos: { ready: 15, total: 15 }, uptimeSec: 5 }) }
  if (u.includes('/api/questions')) return { json: async () => ({ questions: [{ module: '判断推理', type: '逻辑', stem: '测试题干', options: { A: 'a', B: 'b' }, correctAnswer: 'A' }] }) }
  if (u.includes('/api/check')) return { json: async () => ({ isCorrect: true }) }
  // R12：以下三类端点的真实形状必须 mock 到，否则 prop 形状缺陷测不出
  if (u.includes('/api/graph')) return { json: async () => ({ nodes: [], edges: [], metrics: { V: 100, E: 133, density: 0.013, components: 1, orphans: [] }, rank: [{ id: 'plugin:kaogong', pr: 0.05 }], health: { total: 99, factors: {}, weights: {} } }) }
  if (u.includes('/api/telemetry')) return { json: async () => ({ uptimeSec: 100, totalRequests: 50, qpsWindow: 0.5, coverage: 0.9, activeEndpoints: 10, declaredEndpoints: 17, endpoints: { '/api/status': { count: 5, errors: 0, p50: 1, p95: 3, series: [1, 2] } } }) }
  if (u.includes('/api/capabilities')) return { json: async () => ({ endpoints: [{ path: '/api/status', consumers: ['ui:header'] }], tools: [], views: [], entries: [], channels: [] }) }
  if (u.includes('/api/wrong')) return { json: async () => ({ wrong: [], summary: { open: 0, mastered: 0 } }) }
  // v1.6 新端点真实形状
  if (u.includes('/api/papers')) return { json: async () => ({ total: 1683, papers: [{ id: '国考/2009/申论-副省级', exam: '国考', year: 2009, subject: '申论', paperType: '副省级', questionCount: 4, verified: true }], subjects: [{ subject: '申论', count: 944 }, { subject: '行测', count: 739 }] }) }
  if (u.includes('/api/paper?')) return { json: async () => ({ id: 'x', exam: '国考', year: 2009, subject: '申论', paperType: '副省级', materials: [{ no: 1, text: '材料正文' }], questions: [{ no: 1, stem: '题干', score: 20, requirement: '不超过300字', relatedMaterials: '材料1', reference: '参考答案内容' }] }) }
  if (u.includes('/api/topics')) return { json: async () => ({
    channels: [
      { id: 'xingce', name: '行测', icon: '📐', desc: '深度题库 27506 题', entries: [{ label: '刷题（SRS）', view: 'practice', params: {} }], topics: [{ id: 'xc:module:判断推理', channel: '行测', kind: 'module', title: '判断推理', desc: '模块', questionCount: 7749, entry: { view: 'practice', params: { module: '判断推理' } } }] },
      { id: 'shenlun', name: '申论', icon: '✍️', desc: '944 套', entries: [{ label: '申论练习', view: 'essay', params: {} }], topics: [{ id: 'sl:概括', channel: '申论', kind: 'essay-type', title: '申论 · 概括', desc: '采分点制', entry: { view: 'essay', params: { type: '概括' } } }] },
    ],
    stats: { paperTotal: 1683, essayPapers: 944, xingcePapers: 739, naokuTotal: 27506 },
    topics: [{ id: 'subject:申论', kind: 'subject', title: '申论', desc: '944 套', years: [2026] }],
  }) }
  if (u.includes('/api/essay/list')) return { json: async () => ({ total: 1, questions: [{ paperId: 'x', year: 2020, exam: '国考', paperType: '副省级', no: 1, stem: '申论题干', score: 20, requirement: '300字', hasReference: true }] }) }
  if (u.includes('/api/essay/grade')) return { json: async () => ({ score: 15, max: 20, chars: 200, limit: 300, dims: { coverage: 78, structure: 80, length: 85, language: 100 }, hitTerms: ['产业结构'], missingTerms: ['粮食'], feedback: ['整体达标'], referenceAvailable: true }) }
  if (u.includes('/api/essay/history')) return { json: async () => ({ total: 2, recent: [], avgRatio: 70 }) }
  return { json: async () => ({}) }
}

try {
  // R11 后 client 是 combo 格式（window.__ModuleLoader__.load）：mock 加载器捕获定义
  const fs = await import('node:fs')
  const combo = fs.readFileSync(new URL('./dist/client/client.js', import.meta.url), 'utf8')
  let capturedDef = null
  globalThis.window = { __ModuleLoader__: { load: (d) => { capturedDef = d } } }
  new Function(combo)()
  if (!capturedDef || capturedDef.id !== 'dsh-kaogong') throw new Error('combo 未注册或 id 不符')
  const factoryApi = capturedDef.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  if (!factoryApi || typeof factoryApi.apply !== 'function') throw new Error('factory 未返回 {inject, apply}')
  ok('combo 格式: __ModuleLoader__.load 注册 + factory 返回 {inject,apply}')

  // mock 宿主席位系统，捕获注册的组件
  const captured = {}
  const tabsDefs = []
  const tabsMock = { register: (d) => { tabsDefs.push(d); return () => {} } }
  const slotsMock = {
    inject: (name, cb) => { cb() ; return () => {} },
    register: (def, comp) => {
      if (def.name === 'main') captured.mainComp = comp
      if (def.name === 'sidebar.right.pane.tab') captured.tabComp = comp
      return () => {}
    },
  }
  const localeMock = { register: () => () => {}, bind: () => (k) => k }
  const ctx = {
    slots: slotsMock,
    locale: localeMock,
    get: (n) => (n === 'sidebarRight' ? { openTab: () => {} } : undefined),
    effect: (fn) => { fn() ; return () => {} },
    on: () => () => {},
    inject: (deps, cb) => { cb({ get: (n) => (n === 'sidebarRightTabs' ? tabsMock : undefined) }) ; return () => {} },
  }
  factoryApi.apply(ctx)
  if (!captured.mainComp) throw new Error('main 席位未注册组件')
  ok('真实 client.js: apply() 注册 main/tab 席位')

  // 渲染真实主面板（经错误边界包装的注册组件）
  let tr
  await act(async () => { tr = TestRenderer.create(React.createElement(captured.mainComp, { wsKey: 'D:/test/ws', t: (k) => k })) })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  const text1 = JSON.stringify(tr.toJSON())
  if (!text1.includes('考公') && !text1.includes('title')) throw new Error('主面板未渲染: ' + text1.slice(0, 80))
  ok('真实 client.js: 主面板渲染（同源通道 + 仪表盘）')

  // 切到刷题视图（v1.7：先出「选择模块」面板，点模块才抽题）
  const navBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('刷题'))
  if (!navBtn) throw new Error('未找到刷题导航按钮')
  await act(async () => { navBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  let text2 = JSON.stringify(tr.toJSON())
  if (!text2.includes('选择练习模块')) throw new Error('刷题视图未渲染模块选择: ' + text2.slice(0, 120))
  ok('真实 client.js: 刷题视图渲染模块选择面板')

  // 点「判断推理」模块 → 抽题（安全文本提取防循环引用）
  function textOf(children) {
    const arr = Array.isArray(children) ? children : [children]
    for (const c of arr) {
      if (typeof c === 'string') return c
      if (c && c.props) { const t = textOf(c.props.children); if (t) return t }
    }
    return ''
  }
  const modCards = tr.root.findAll(el => el.props && typeof el.props.onClick === 'function' && el.props.style && String(el.props.style.cursor) === 'pointer')
  const modCard = modCards.find(el => textOf(el.props.children).includes('判断推理'))
  if (!modCard) throw new Error('未找到判断推理模块卡片')
  await act(async () => { modCard.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  text2 = JSON.stringify(tr.toJSON())
  if (!text2.includes('测试题干')) throw new Error('抽题后未渲染题干: ' + text2.slice(0, 150))
  ok('真实 client.js: 选模块→抽题渲染题干')

  // 选项 A → 提交 → **就地展示判分与解析**（v1.7 修复点）
  const safeText = () => {
    const walk = (n) => n == null ? '' : Array.isArray(n) ? n.map(walk).join('') : typeof n === 'string' ? n : (n.children ? walk(n.children) : '')
    return walk(tr.toJSON())
  }
  function walkPropsText(children) {
    const arr = Array.isArray(children) ? children : [children]
    for (const c of arr) {
      if (typeof c === 'string') return c
      if (c && c.props) { const t = walkPropsText(c.props.children); if (t) return t }
    }
    return ''
  }
  const optEls = tr.root.findAll(el => el.type === 'div' && typeof el.props.onClick === 'function' && /^A/.test(walkPropsText(el.props.children)))
  const clickTarget = optEls[optEls.length - 1]
  if (!clickTarget) throw new Error('未找到选项 A 元素')
  await act(async () => { clickTarget.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const submitBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('提交判分'))
  if (!submitBtn) throw new Error('未找到提交判分按钮')
  await act(async () => { submitBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  const afterSubmit = safeText()
  if (!/回答正确|回答错误/.test(afterSubmit)) throw new Error('提交后未展示判分反馈（v1.7 修复点失效）: ' + afterSubmit.slice(0, 150))
  if (!afterSubmit.includes('解析')) throw new Error('提交后未展示解析')
  ok('真实 client.js: 作答→提交→就地判分+解析（v1.7 刷题修复验证）')

  // 快速来回切视图（hook 漂移压力 + prop 形状验证）
  const viewChecks = { '图谱': 'graph', '可观测': 'obs', '错题本': 'wrongbook', '刷题': 'practice', '仪表盘': 'dashboard' }
  for (const label of ['图谱', '可观测', '错题本', '刷题', '仪表盘', '图谱', '刷题']) {
    const btn = tr.root.findAllByType('button').find(b => String(b.props.children).includes(label))
    if (btn) { await act(async () => { btn.props.onClick() }); await act(async () => { await new Promise(r => setTimeout(r, 25)) }) }
    // R12 守卫：任何视图都不得落到 ErrorBoundary 降级态
    const alert = tr.root.findAll(n => n.props && n.props.role === 'alert')
    if (alert.length) {
      const kids = alert[0].props.children
      const flat = (Array.isArray(kids) ? kids : [kids]).map(c => typeof c === 'string' ? c : '').join(' ')
      throw new Error(`视图「${label}」触发渲染降级: ${flat.slice(0, 140)}`)
    }
  }
  ok('真实 client.js: 7 连视图切换压力（含图谱 prop 形状，零降级）')
  // v1.6 新视图遍历（papers/topics/essay 自管数据，验证不降级）
  for (const label of ['真题卷', '专题', '申论']) {
    const btn = tr.root.findAllByType('button').find(b => String(b.props.children).includes(label))
    if (!btn) throw new Error(`未找到导航按钮「${label}」`)
    await act(async () => { btn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    const alert = tr.root.findAll(n => n.props && n.props.role === 'alert')
    if (alert.length) {
      const kids = alert[0].props.children
      const flat = (Array.isArray(kids) ? kids : [kids]).map(c => typeof c === 'string' ? c : '').join(' ')
      throw new Error('新视图「' + label + '」渲染降级: ' + flat.slice(0, 260))
    }
  }
  ok('真实 client.js: v1.6 新视图（真题卷/专题/申论）零降级')

  // R15 守卫：模考 / 深度题库 也必须能在宿主内挂载（曾因脚本误删定义而漏检）
  for (const label of ['模考', '深度题库']) {
    const btn2 = tr.root.findAllByType('button').find(b => String(b.props.children).includes(label))
    if (!btn2) throw new Error(`未找到导航按钮「${label}」`)
    await act(async () => { btn2.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 120)) })
    const al2 = tr.root.findAll(n => n.props && n.props.role === 'alert')
    if (al2.length) {
      const kids2 = al2[0].props.children
      const flat2 = (Array.isArray(kids2) ? kids2 : [kids2]).map(c => typeof c === 'string' ? c : '').join(' ')
      throw new Error(`视图「${label}」渲染降级: ${flat2.slice(0, 200)}`)
    }
  }
  ok('真实 client.js: 模考/深度题库视图零降级（R15 守卫）')
  tr.unmount()
} catch (e) { bad('真实 client.js 集成渲染', e) }

console.log(`\n═══ 渲染回归: ${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
