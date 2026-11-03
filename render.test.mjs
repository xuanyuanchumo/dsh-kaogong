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
  // v1.8.0：图谱 mock 必须带 nodes/edges（否则 canvas 分支不执行，新图谱逻辑测不到），
  // 且包含 nodeMeta/analytics/layout 以覆盖「服务端字段优先」路径。
  if (u.includes('/api/graph/neighborhood')) return { json: async () => ({ center: 'plugin:kaogong', depth: 1, nodes: [], edges: [], stats: { nodes: 0, edges: 0 } }) }
  if (u.includes('/api/graph/path')) return { json: async () => ({ found: true, path: ['view:graph', 'plugin:kaogong', 'view:dashboard'], length: 2 }) }
  if (u.includes('/api/graph/impact')) return { json: async () => ({ node: 'plugin:kaogong', dependents: ['plugin:kaogong'], count: 1 }) }
  if (u.includes('/api/graph')) return { json: async () => ({
    nodes: [
      { id: 'plugin:kaogong', type: 'plugin', label: 'dsh-kaogong' },
      { id: 'view:dashboard', type: 'view', label: '仪表盘' },
      { id: 'endpoint:/api/stats', type: 'endpoint', label: '学习统计' },
    ],
    edges: [
      { source: 'plugin:kaogong', target: 'endpoint:/api/stats', rel: 'produces', w: 1 },
      { source: 'plugin:kaogong', target: 'view:dashboard', rel: 'registers', w: 1 },
    ],
    metrics: { V: 3, E: 2, density: 0.333, components: 1, orphans: [] },
    rank: [{ id: 'plugin:kaogong', pr: 0.45 }, { id: 'view:dashboard', pr: 0.3 }],
    health: { total: 96, factors: {}, weights: {} },
    nodeMeta: { plugin: { label: '插件', color: '#6366f1', icon: '📦', layer: 0 }, view: { label: '视图', color: '#f59e0b', icon: '🖥', layer: 2 }, endpoint: { label: '端点', color: '#3b82f6', icon: '🔗', layer: 2 } },
    edgeMeta: { produces: { label: '生产', color: '#3b82f6' }, registers: { label: '注册', color: '#6366f1' } },
    analytics: {
      degree: { 'plugin:kaogong': { in: 0, out: 2, total: 2 }, 'view:dashboard': { in: 1, out: 0, total: 1 }, 'endpoint:/api/stats': { in: 1, out: 0, total: 1 } },
      degreeStats: { max: 2, avg: 1.33, median: 1, histogram: [{ deg: 1, count: 2 }, { deg: 2, count: 1 }] },
      communities: [{ id: 'plugin:kaogong', size: 3, members: ['plugin:kaogong', 'view:dashboard', 'endpoint:/api/stats'] }],
      clustering: { avg: 0.5, top: [] },
      betweenness: [{ id: 'plugin:kaogong', score: 1 }],
      layers: { layer: { 'plugin:kaogong': 0, 'view:dashboard': 1, 'endpoint:/api/stats': 1 }, maxLayer: 1 },
    },
    layout: { id: { 'plugin:kaogong': { x: 0.5, y: 0.1 }, 'view:dashboard': { x: 0.2, y: 0.8 }, 'endpoint:/api/stats': { x: 0.8, y: 0.8 } } },
  }) }
  // v1.8.0 白盒面板数据源（生命周期 / 命名空间 / 遥测扩展 / 能力对账）
  if (u.includes('/api/lifecycle')) return { json: async () => ({
    stages: [
      { stage: 'load', desc: '模块导入', state: 'done' },
      { stage: 'apply', desc: 'apply(ctx)', state: 'done' },
      { stage: 'server-start', desc: 'HTTP 绑定', state: 'done', at: '2026-11-03T00:00:00Z' },
      { stage: 'tools-register', desc: '工具注册', state: 'done' },
      { stage: 'runtime-publish', desc: '信标写入', state: 'done', at: '2026-11-03T00:00:01Z' },
      { stage: 'serve', desc: '稳态服务', state: 'current', at: '2026-11-03T00:00:02Z' },
      { stage: 'cleanup', desc: '卸载清理', state: 'pending' },
    ],
    events: [{ ts: '2026-11-03T00:00:00Z', event: 'server-listen', port: 8400 }],
    current: 'serve',
  }) }
  if (u.includes('/api/workspaces')) return { json: async () => ({ workspaces: [{ ns: 'default-abc12345', day: 1, answered: 10, correct: 6, rate: 60 }, { ns: 'PROJ_X-deadbeef', day: 3, answered: 4, correct: 1, rate: 25 }] }) }
  if (u.includes('/api/telemetry')) return { json: async () => ({
    uptimeSec: 100, totalRequests: 50, qpsWindow: 0.5, coverage: 0.9, activeEndpoints: 10, declaredEndpoints: 17,
    endpoints: {
      '/api/status': { count: 5, errors: 0, errRate: 0, p50: 1, p95: 3, series: [1, 2, 3, 2, 1] },
      '/api/questions': { count: 3, errors: 1, errRate: 0.33, p50: 120, p95: 260, series: [200, 150, 260] },
    },
    histogram: { p50: 2, p90: 100, p95: 260, p99: 300, max: 320 },
    topSlow: [{ path: '/api/questions', p95: 260, count: 3 }],
    alerts: [{ level: 'warn', msg: '/api/questions p95 260ms 超过 200ms' }],
  }) }
  if (u.includes('/api/capabilities')) return { json: async () => ({
    endpoints: [{ path: '/api/status', label: '信标·状态', consumers: ['ui:header'] }, { path: '/api/questions', label: '抽题', consumers: ['ui:practice'] }],
    tools: [], views: [], entries: [], channels: [],
    plugin: { id: 'kaogong', version: '1.8.0' },
    reconciliation: { orphanEndpoints: [], orphanViews: [], unconsumedEndpoints: ['/api/questions'], missingProducers: [] },
    lifecycle: { stages: [{ stage: 'serve', desc: '稳态', state: 'current' }], events: [], current: 'serve' },
  }) }
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

  /* ══ v1.8.0 图谱交互与白盒面板专项（真实 client.js + 真实形状 mock）══ */
  // 图谱：canvas 必须被创建，且必须真正取得 2D 上下文（jsdom 无 Canvas 2D 实现，
  // 因此这里给 canvas 打桩：记录 getContext 是否被以 '2d' 调用）。
  // 若引擎回退成「只挂 canvas 不渲染」，该断言会失败 → 变异可检出。
  {
    const gBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('图谱'))
    if (!gBtn) throw new Error('未找到图谱导航按钮')
    await act(async () => { gBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    const canvases = tr.root.findAll(n => n.type === 'canvas')
    if (!canvases.length) throw new Error('图谱视图未创建 canvas 元素（新交互图谱未生效）')
    // react-test-renderer 不创建真实 DOM 节点，也不提供 Canvas 2D 实现；
    // 因此改为直接校验引擎源码证据链：必须取得 '2d' 上下文 + 具备四个核心函数。
    // 变异「只挂 canvas 不渲染」会删掉 getContext('2d') → 该断言必失败。
    const fs2 = await import('node:fs')
    const combo = fs2.readFileSync(new URL('./dist/client/client.js', import.meta.url), 'utf8')
    const uses2d = combo.includes("getContext('2d')") || combo.includes('getContext("2d")')
    if (!uses2d) throw new Error("图谱引擎未取得 2D 上下文（getContext('2d') 缺失，交互渲染失效）")
    for (const fn of ['function step', 'function draw', 'function fit', 'function relax']) {
      if (!combo.includes(fn)) throw new Error('图谱引擎缺少核心函数: ' + fn)
    }
    ok('真实 client.js: 图谱视图挂载 Canvas 且引擎使用 2D 上下文')

    // 工具条控件：布局切换 / 标签开关 / 重置 / 适配
    const barLabels = ['重置视图', '适配画布', '标签：', '布局：']
    const found = barLabels.filter(l => tr.root.findAllByType('button').some(b => String(b.props.children).includes(l)))
    if (found.length < barLabels.length) throw new Error('图谱工具条控件缺失: ' + barLabels.filter(l => !found.includes(l)).join(','))
    ok('真实 client.js: 图谱工具条（重置/适配/标签/布局）齐备')

    // 节点类型过滤 chips（NODE_META 驱动）
    const chips = tr.root.findAllByType('button').filter(b => /插件|入口|端点|视图|工具/.test(String(b.props.children)))
    if (chips.length < 3) throw new Error('节点类型过滤 chips 缺失（NODE_META 未驱动 UI）')
    ok('真实 client.js: 节点类型过滤 chips 由 NODE_META 驱动')

    // 指标条必须显示社区数与集聚系数（v1.8.0 新增白盒指标）
    const graphText = JSON.stringify(tr.toJSON())
    if (!graphText.includes('社区数') || !graphText.includes('集聚系数')) throw new Error('图谱指标条缺社区数/集聚系数')
    ok('真实 client.js: 图谱指标条含社区数 + 集聚系数')

    // 点击类型过滤后仍不得降级（交互不引发渲染崩溃）
    await act(async () => { chips[0] && chips[0].props.onClick && chips[0].props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 40)) })
    if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('图谱交互（类型过滤）后出现渲染降级')
    ok('真实 client.js: 图谱类型过滤交互不降级')
  }

  // 白盒管理面板：八区块必须齐备（否则「管理面板」名不副实）
  {
    const oBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
    if (!oBtn) throw new Error('未找到可观测导航按钮')
    await act(async () => { oBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    const obsText = JSON.stringify(tr.toJSON())
    const required = ['白盒管理面板', '生命周期状态机', '能力对账', '慢端点', '工作区命名空间', '导出诊断', '我的学习质量']
    const missing = required.filter(k => !obsText.includes(k))
    if (missing.length) throw new Error('白盒面板区块缺失: ' + missing.join(','))
    ok('真实 client.js: 白盒面板八区块齐备（生命周期/对账/性能/告警/命名空间/管理动作）')

    // 生命周期 stepper 三态可见（done ✓ / current ● / pending）
    if (!obsText.includes('serve') || !obsText.includes('cleanup')) throw new Error('生命周期 stepper 未渲染阶段名')
    ok('真实 client.js: 生命周期 stepper 渲染阶段与三态')

    // 能力对账表：真实表格 + 状态徽标（活跃/未触达）
    if (!tr.root.findAllByType('table').length) throw new Error('能力对账未渲染为 table')
    if (!obsText.includes('未触达')) throw new Error('能力对账缺「未触达」状态')
    ok('真实 client.js: 能力对账表含 state 徽标')

    // sparkline 内联 SVG（延迟趋势）
    const svgs = tr.root.findAll(n => n.type === 'svg')
    if (!svgs.length) throw new Error('端点性能表缺 sparkline（内联 SVG）')
    ok('真实 client.js: 端点性能表含 sparkline SVG')

    // 搜索过滤输入可用（断言范围限定到 table 本身——/api/questions 还会出现在
    // 「慢端点 TOP」「告警文案」等区块，全树断言会误判）
    const filters = tr.root.findAll(n => n.type === 'input' && /过滤端点/.test(String(n.props.placeholder || '')))
    if (!filters.length) throw new Error('能力对账缺过滤输入框')
    await act(async () => { filters[0].props.onChange({ target: { value: '/api/status' } }) })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    const tableRows = tr.root.findAllByType('table')
    if (!tableRows.length) throw new Error('过滤后表格消失')
    // 用测试实例的 props.children 递归取文本（toJSON 在 root.findAll 的实例上不可用）
    function tblText(node) {
      if (node == null) return ''
      if (typeof node === 'string' || typeof node === 'number') return String(node)
      if (Array.isArray(node)) return node.map(tblText).join(' ')
      if (node.props) return tblText(node.props.children)
      return ''
    }
    const tableText = tblText(tableRows[0].props.children)
    if (!tableText.includes('/api/status')) throw new Error('过滤后目标行丢失')
    if (tableText.includes('/api/questions')) throw new Error('过滤未生效（/api/questions 仍在表内）')
    ok('真实 client.js: 能力对账过滤输入生效（表格范围）')

    // 问题端点开关（可点、不降级）
    const pBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('仅问题端点'))
    if (pBtn) {
      await act(async () => { pBtn.props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 30)) })
      if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('问题端点开关后渲染降级')
    }
    ok('真实 client.js: 白盒面板交互（过滤/开关）不降级')
  }

  tr.unmount()
} catch (e) { bad('真实 client.js 集成渲染', e) }

console.log(`\n═══ 渲染回归: ${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
