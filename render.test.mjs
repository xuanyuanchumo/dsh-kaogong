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
globalThis.__kgFetchLog = []   // RENDER-P-01：记录全部 fetch URL（断言省份 chip 触发带参请求）
globalThis.fetch = async (url) => {
  const u = String(url)
  globalThis.__kgFetchLog.push(u)
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
      // cycle-14 复盘遗留：事件时间戳改相对当前时刻（写死日期会随时间滑出泳道 14 天窗口，演示价值衰减）
      { stage: 'server-start', desc: 'HTTP 绑定', state: 'done', at: new Date(Date.now() - 3600e3).toISOString() },
      { stage: 'tools-register', desc: '工具注册', state: 'done' },
      { stage: 'runtime-publish', desc: '信标写入', state: 'done', at: new Date(Date.now() - 1800e3).toISOString() },
      { stage: 'serve', desc: '稳态服务', state: 'current', at: new Date().toISOString() },
      { stage: 'cleanup', desc: '卸载清理', state: 'pending' },
    ],
    events: [{ ts: new Date(Date.now() - 3600e3).toISOString(), event: 'server-listen', port: 8400 }],
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
  // cycle-15 专项刷题记忆：GET 返回全局记忆仓库（POST 由视图静默回写，响应不参与断言）
  if (u.includes('/api/memory')) {
    return { json: async () => ({ memory: globalThis.__kgMemStore || {} }) }
  }
  // cycle-15 图形推理/深度题库数据源 mock（让横幅与恢复路径可测；N-02 分区切换零降级）
  if (u.includes('/api/tuxing/cats')) return { json: async () => ({ ready: true, total: 354, cats: [{ cat: 'shuliang', name: '数量规律', count: 40 }] }) }
  if (u.includes('/api/tuxing/list')) return { json: async () => ({ total: 2, questions: [{ no: 1, catName: '数量规律', ans: 'A', imgUrl: '' }, { no: 2, catName: '数量规律', ans: 'B', imgUrl: '' }] }) }
  if (u.includes('/api/naoku/status')) return { json: async () => ({ ready: true, stats: { total: 27506, kadianCoverage: 100, fastestCoverage: 90, withImage: 10647 } }) }
  if (u.includes('/api/naoku/questions') || u.includes('/api/naoku/practice')) return { json: async () => ({ questions: [{ module: '判断推理', stem: '深度题库抽题', options: { A: 'a' }, correctAnswer: 'A', kadian: '考点X' }] }) }
  // v1.6 新端点真实形状（cycle-13：papers mock 带 provinces facet ≥3 项，驱动省份 chips 行）
  if (u.includes('/api/papers')) return { json: async () => ({ total: 1683, papers: [{ id: '国考/2009/申论-副省级', exam: '国考', year: 2009, subject: '申论', paperType: '副省级', province: '全国', questionCount: 4, verified: true }], subjects: [{ subject: '申论', count: 944 }, { subject: '行测', count: 739 }], provinces: [{ name: '山东', total: 12, minYear: 2009, maxYear: 2024, subjects: { 申论: 6, 行测: 6 } }, { name: '全国', total: 100, minYear: 2008, maxYear: 2026, subjects: { 申论: 50, 行测: 50 } }, { name: '广东', total: 30, minYear: 2010, maxYear: 2025, subjects: { 申论: 15, 行测: 15 } }] }) }
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

// cycle-15 专项刷题记忆：全局记忆仓库（三专项视图挂载时 GET；翻题 POST 由视图静默回写）
globalThis.__kgMemStore = {
  practice: { module: '判断推理', at: Date.now() - 60e3, question: { module: '判断推理', type: '逻辑', stem: '上次的题干（记忆恢复）', options: { A: 'a1', B: 'b1', C: 'c1', D: 'd1' }, correctAnswer: 'B', analysis: '解析文本' } },
  tuxing: { cat: 'shuliang', catName: '数量规律', no: 2, idx: 1, at: Date.now() - 120e3 },
  deep: { module: '数量关系', at: Date.now() - 180e3, question: { module: '数量关系', stem: '深度题库上次的题', options: { A: 'x', B: 'y' }, correctAnswer: 'A', kadian: '母题思维' } },
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

  // cycle-13 导航重构辅助：进入「专题」枢纽并切换分区（data-kg-hub-tab 是组件内 tab，
  // 非路由）。刷题/申论/深度题库/图形推理一级入口已收敛进专题页分区（W2a）。
  async function enterHubTab(tabId) {
    const navBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('专题'))
    if (!navBtn) throw new Error('未找到「专题」导航按钮')
    await act(async () => { navBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    const tab = tr.root.findAll(el => el.props && el.props['data-kg-hub-tab'] === tabId)
    if (!tab.length) throw new Error('未找到专题枢纽分区 tab: ' + tabId)
    await act(async () => { tab[0].props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 90)) })
    const alert = tr.root.findAll(n => n.props && n.props.role === 'alert')
    if (alert.length) {
      const kids = alert[0].props.children
      const flat = (Array.isArray(kids) ? kids : [kids]).map(c => typeof c === 'string' ? c : '').join(' ')
      throw new Error(`专题枢纽分区「${tabId}」渲染降级: ${flat.slice(0, 160)}`)
    }
  }

  // 切到专题枢纽 → 刷题分区（v1.7：先出「选择模块」面板，点模块才抽题；
  // cycle-13：「刷题」一级入口收敛为枢纽分区，经 data-kg-hub-tab 锚点触达）
  await enterHubTab('practice')
  let text2 = JSON.stringify(tr.toJSON())
  if (!text2.includes('选择练习模块')) throw new Error('刷题分区未渲染模块选择: ' + text2.slice(0, 120))
  ok('真实 client.js: 专题枢纽→刷题分区渲染模块选择面板')

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
  // 枢纽形态下「判断推理」有两处可点卡：总览分区的专题卡（display:none，点击会路由离开）
  // 与刷题分区的模块卡（树序靠后）。取最后一个 = 刷题分区模块卡，练习流保持在枢纽内。
  const modCard = [...modCards].reverse().find(el => textOf(el.props.children).includes('判断推理'))
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

  // 快速来回切视图（hook 漂移压力 + prop 形状验证）。
  // cycle-13：一级导航已无「刷题」（收敛进专题枢纽分区），其切换压力由下方
  // RENDER-N-02 的六分区遍历承担，这里保留仍存在的一级入口。
  for (const label of ['图谱', '可观测', '错题本', '仪表盘', '图谱']) {
    const btn = tr.root.findAllByType('button').find(b => String(b.props.children).includes(label))
    if (!btn) throw new Error(`未找到导航按钮「${label}」`)
    await act(async () => { btn.props.onClick() }); await act(async () => { await new Promise(r => setTimeout(r, 25)) })
    // R12 守卫：任何视图都不得落到 ErrorBoundary 降级态
    const alert = tr.root.findAll(n => n.props && n.props.role === 'alert')
    if (alert.length) {
      const kids = alert[0].props.children
      const flat = (Array.isArray(kids) ? kids : [kids]).map(c => typeof c === 'string' ? c : '').join(' ')
      throw new Error(`视图「${label}」触发渲染降级: ${flat.slice(0, 140)}`)
    }
  }
  ok('真实 client.js: 5 连一级视图切换压力（含图谱 prop 形状，零降级；刷题分区压力见 RENDER-N-02）')
  // v1.6 新视图遍历（papers/topics 走一级导航；essay 经专题枢纽分区，验证不降级）
  for (const label of ['真题卷', '专题']) {
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
  // 申论：导航精简后经专题枢纽「✍️ 申论」分区触达（与 RENDER-N-02 同源路径）
  await enterHubTab('essay')
  ok('真实 client.js: v1.6 视图（真题卷/专题/申论·枢纽分区）零降级')

  // R15 守卫：模考（一级导航）/ 深度题库（专题枢纽分区）也必须能在宿主内挂载
  // （曾因脚本误删定义而漏检；cycle-13 深度题库一级入口收敛为枢纽分区）
  {
    const btn2 = tr.root.findAllByType('button').find(b => String(b.props.children).includes('模考'))
    if (!btn2) throw new Error('未找到导航按钮「模考」')
    await act(async () => { btn2.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 120)) })
    const al2 = tr.root.findAll(n => n.props && n.props.role === 'alert')
    if (al2.length) {
      const kids2 = al2[0].props.children
      const flat2 = (Array.isArray(kids2) ? kids2 : [kids2]).map(c => typeof c === 'string' ? c : '').join(' ')
      throw new Error(`视图「模考」渲染降级: ${flat2.slice(0, 200)}`)
    }
  }
  await enterHubTab('deepbank')
  ok('真实 client.js: 模考/深度题库（枢纽分区）零降级（R15 守卫）')

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

  /* ══ cycle-13 W3 新增断言（追加，不削弱既有）══ */

  // RENDER-N-02：专题枢纽六分区 tab 齐备（组件内 tab，非路由）+ 逐分区切换零降级
  {
    await enterHubTab('overview')
    const HUB_IDS = ['overview', 'practice', 'tuxing', 'deepbank', 'essay', 'method']
    const tabEls = tr.root.findAll(el => el.props && el.props['data-kg-hub-tab'])
    const foundIds = new Set(tabEls.map(el => String(el.props['data-kg-hub-tab'])))
    const missing = HUB_IDS.filter(id => !foundIds.has(id))
    if (missing.length) throw new Error('专题枢纽分区 tab 缺失: ' + missing.join(','))
    for (const id of HUB_IDS) {
      const tb = tr.root.findAll(el => el.props && el.props['data-kg-hub-tab'] === id)
      await act(async () => { tb[0].props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 70)) })
      const alert = tr.root.findAll(n => n.props && n.props.role === 'alert')
      if (alert.length) {
        const kids = alert[0].props.children
        const flat = (Array.isArray(kids) ? kids : [kids]).map(c => typeof c === 'string' ? c : '').join(' ')
        throw new Error(`RENDER-N-02 分区「${id}」切换降级: ${flat.slice(0, 160)}`)
      }
    }
    ok('RENDER-N-02: 专题枢纽六分区 tab（总览/行测刷题/图形推理/深度题库/申论/方法论）齐备且逐区切换零降级')
  }

  // RENDER-P-01：papers 视图省份 chips 行渲染 + 点击 chip 触发带 province 参数的请求
  {
    const ppBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('真题卷'))
    if (!ppBtn) throw new Error('RENDER-P-01 未找到「真题卷」导航按钮')
    await act(async () => { ppBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    const pText = JSON.stringify(tr.toJSON())
    if (!pText.includes('省份')) throw new Error('RENDER-P-01 省份 chips 行未渲染（provinces facet 未驱动 UI）')
    const provChips = tr.root.findAllByType('button').filter(b => /^(山东|全国|广东) \d+$/.test(String(b.props.children)))
    if (provChips.length < 3) throw new Error('RENDER-P-01 省份 chips 少于 3 个: ' + provChips.map(b => String(b.props.children)).join('|'))
    const sdChip = provChips.find(b => String(b.props.children).includes('山东'))
    globalThis.__kgFetchLog.length = 0
    await act(async () => { sdChip.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    const hit = globalThis.__kgFetchLog.find(u => u.includes('/api/papers') && u.includes('province=' + encodeURIComponent('山东')))
    if (!hit) throw new Error('RENDER-P-01 点击省份 chip 未触发带 province 参数的请求: ' + globalThis.__kgFetchLog.slice(-3).join(' ; '))
    ok('RENDER-P-01: 省份 chips 渲染（facet 驱动）且点击触发 ?province=山东 过滤请求')
  }

  // RENDER-O-11..14：obs 视图（mock capabilities+telemetry+lifecycle 全字段）
  // 此前 N-02/P-01 已切走视图，这里重新进入可观测后对 W2c 流动可视化断言。
  {
    const oBtn3 = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
    if (!oBtn3) throw new Error('RENDER-O 未找到「可观测」导航按钮')
    await act(async () => { oBtn3.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    const obsText = JSON.stringify(tr.toJSON())
    const svgs = tr.root.findAll(n => n.type === 'svg')
    // O-11 能力流三列图：卡片标题 + 含贝塞尔链接（path）的 SVG
    if (!obsText.includes('能力流 · 注册→生产→消费')) throw new Error('RENDER-O-11 能力流卡片未渲染')
    const flowSvg = svgs.find(s => s.findAll(n => n.type === 'path').length > 0)
    if (!flowSvg) throw new Error('RENDER-O-11 流动图 SVG（含链接 path）未渲染')
    ok('RENDER-O-11: 能力流三列图渲染（注册→生产→消费 SVG + 贝塞尔链接）')

    // O-12 量化四卡：SLO 达成率 / 错误预算 / 遥测样本 / 能力健康度
    const quad = ['SLO 达成率', '错误预算', '遥测样本', '能力健康度']
    const missQ = quad.filter(k => !obsText.includes(k))
    if (missQ.length) throw new Error('RENDER-O-12 量化卡缺失: ' + missQ.join(','))
    ok('RENDER-O-12: 量化四卡渲染（SLO/错误预算/遥测样本/健康度）')

    // O-13 对账表三态灯列：共用表头「注册·生产·消费」+ 三态筛选 chips
    if (!obsText.includes('注册·生产·消费')) throw new Error('RENDER-O-13 三态灯列表头未渲染')
    if (!tr.root.findAllByType('button').some(b => /异常/.test(String(b.props.children))) ||
        !tr.root.findAllByType('button').some(b => /未消费/.test(String(b.props.children)))) {
      throw new Error('RENDER-O-13 三态筛选 chips 缺失')
    }
    ok('RENDER-O-13: 能力对账表三态灯列 + 三态筛选 chips 渲染')

    // O-14 泳道热力格：标题 + ≥60 个 rect（7 阶段 × 14 天网格，显著区别于流动图胶囊/sparkline）
    if (!obsText.includes('事件泳道 · 阶段 × 近 14 天')) throw new Error('RENDER-O-14 泳道标题未渲染')
    const laneSvg = svgs.find(s => s.findAll(n => n.type === 'rect').length >= 60)
    if (!laneSvg) throw new Error('RENDER-O-14 泳道热力格 SVG 未渲染（rect 网格缺失）')
    ok('RENDER-O-14: 生命周期事件泳道热力格渲染（阶段 × 14 天网格）')

    // RENDER-O-15：obs 数据源字段缺失降级 —— capabilities/telemetry/lifecycle/workspaces
    // 四个 obs 专属端点返回空对象（其余端点透传原 mock，保证切走路由的宿主视图不受牵连）
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
      if (alert.length) {
        const kids = alert[0].props.children
        const flat = (Array.isArray(kids) ? kids : [kids]).map(c => typeof c === 'string' ? c : '').join(' ')
        throw new Error('RENDER-O-15 字段缺失降级失败: ' + flat.slice(0, 160))
      }
      ok('RENDER-O-15: obs 全字段缺失降级不抛错（卡片级降级，无 role=alert）')
    } finally {
      globalThis.fetch = fullFetch
    }
  }

  // RENDER-G-11..16：graph 视图 W2b 升级包（mock /api/graph 带 analytics；canvas stub 下降级不抛错）
  {
    const gBtn2 = tr.root.findAllByType('button').find(b => String(b.props.children).includes('图谱'))
    if (!gBtn2) throw new Error('RENDER-G 未找到「图谱」导航按钮')
    await act(async () => { gBtn2.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    const gText = JSON.stringify(tr.toJSON())

    // G-11 着色模式按钮组（GRAPH_COLOR_MODES 五模式精确匹配）+ 切换「社区」不降级
    const modeLabels = ['类型', '社区', 'PageRank', '中介', '度']
    const gBtns = tr.root.findAllByType('button')
    const missM = modeLabels.filter(l => !gBtns.some(b => String(b.props.children) === l))
    if (missM.length) throw new Error('RENDER-G-11 着色模式按钮缺失: ' + missM.join(','))
    const comBtn = gBtns.find(b => String(b.props.children) === '社区')
    await act(async () => { comBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 40)) })
    if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('RENDER-G-11 着色模式切换降级')
    ok('RENDER-G-11: 着色模式按钮组（类型/社区/PageRank/中介/度）且社区着色切换零降级')

    // G-12 图例卡 + 边类型 chips（边计数由 mock edges 的 rel 驱动）
    if (!gText.includes('🎨 图例与过滤')) throw new Error('RENDER-G-12 图例卡未渲染')
    if (!gText.includes('边类型（点击显隐）')) throw new Error('RENDER-G-12 边类型过滤行未渲染')
    if (!gBtns.some(b => /(生产|注册) \d+/.test(String(b.props.children)))) throw new Error('RENDER-G-12 边类型 chips 缺失')
    ok('RENDER-G-12: 图例卡（节点/边类型过滤 chips）渲染')

    // G-13 小地图接线：canvas stub 下引擎降级（容器条件渲染不出现），证据链在产物中
    const gCanvases = tr.root.findAll(n => n.type === 'canvas')
    if (!gCanvases.length) throw new Error('RENDER-G-13 主画布 canvas 未创建')
    const fs3 = await import('node:fs')
    const combo3 = fs3.readFileSync(new URL('./dist/client/client.js', import.meta.url), 'utf8')
    if (!combo3.includes('小地图：点击/拖拽平移视口') || !combo3.includes('graphBindMiniMap') || !combo3.includes('function drawMini')) {
      throw new Error('RENDER-G-13 小地图接线缺失（容器标题/装配原语/绘制函数）')
    }
    ok('RENDER-G-13: 小地图接线齐备（引擎 ok=false 时容器条件降级，装配/绘制链在产物中）')

    // G-14 导出 PNG 按钮存在且可点（canvas stub 下 toBlob 缺失 → 守卫静默，不抛错）
    const pngBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('导出 PNG'))
    if (!pngBtn) throw new Error('RENDER-G-14 导出 PNG 按钮缺失')
    await act(async () => { pngBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    ok('RENDER-G-14: 导出 PNG 按钮渲染且 canvas stub 下点击不抛错')

    // G-15 键盘提示 + 键盘命令真实生效（graphKeyCommand 接线：l → 切换布局）
    if (!gText.includes('快捷键 +/−/0/f/l/Esc')) throw new Error('RENDER-G-15 键盘提示文案缺失')
    const kbWrap = tr.root.findAll(n => n.props && String(n.props['aria-label'] || '').includes('获得焦点后可用键盘'))
    if (!kbWrap.length) throw new Error('RENDER-G-15 键盘 aria 提示缺失')
    const layoutBtn = () => tr.root.findAllByType('button').find(b => String(b.props.children).includes('布局：'))
    const before = String(layoutBtn().props.children)
    await act(async () => { kbWrap[0].props.onKeyDown({ key: 'l', target: { tagName: 'DIV' }, preventDefault: () => {} }) })
    await act(async () => { await new Promise(r => setTimeout(r, 40)) })
    const after = String(layoutBtn().props.children)
    if (before === after) throw new Error('RENDER-G-15 键盘 l 未触发布局切换（graphKeyCommand 接线断裂）')
    await act(async () => { kbWrap[0].props.onKeyDown({ key: 'Escape', target: { tagName: 'DIV' } }) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    ok(`RENDER-G-15: 键盘提示 + 快捷键真实生效（l: ${before} → ${after}；Esc 清除不抛错）`)

    // G-16 全部交互后 canvas stub 仍零降级
    if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('RENDER-G-16 图谱交互后出现渲染降级')
    if (!JSON.stringify(tr.toJSON()).includes('🕸️ 交互图谱')) throw new Error('RENDER-G-16 图谱视图主体消失')
    ok('RENDER-G-16: 图谱着色/导出/键盘全交互序列 canvas stub 零降级')

    /* ══ cycle-15：布局三态轮换 + 流动粒子开关（追加，不削弱既有）══ */
    // C15-01：布局按钮三态轮换 force→layered→circular→force（按钮与键盘 l 共用 KG_LAYOUTS 序列）
    {
      const lb = () => tr.root.findAllByType('button').find(b => String(b.props.children).includes('布局：'))
      if (!lb()) throw new Error('C15 布局按钮缺失')
      const seq = [String(lb().props.children)]
      for (let i = 0; i < 3; i++) {
        await act(async () => { lb().props.onClick() })
        await act(async () => { await new Promise(r => setTimeout(r, 25)) })
        seq.push(String(lb().props.children))
      }
      if (!(seq[0] !== seq[1] && seq[1] !== seq[2] && seq[2] !== seq[3] && seq[3] === seq[0])) {
        throw new Error('C15 布局三态轮换异常: ' + seq.join('→'))
      }
      ok(`C15-01: 布局按钮三态轮换（${seq.join('→')}）`)
    }
    // C15-02：流动粒子开关（opt-in：开→引擎维持 rAF；关→恢复停帧；全程零降级）
    {
      const fb = () => tr.root.findAllByType('button').find(b => String(b.props.children).includes('流动粒子'))
      if (!fb()) throw new Error('C15 流动粒子按钮缺失')
      await act(async () => { fb().props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 40)) })
      const onLabel = String(fb().props.children)
      if (!onLabel.includes('开')) throw new Error('C15 流动粒子开启失败: ' + onLabel)
      await act(async () => { fb().props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 40)) })
      if (!String(fb().props.children).includes('关')) throw new Error('C15 流动粒子关闭失败')
      if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C15 流动粒子交互后渲染降级')
      ok('C15-02: 流动粒子开关切换正常（opt-in rAF 语义，关闭恢复省电）')
    }

    /* ══ cycle-15：白盒三件套（延迟分位阶梯/吞吐四象限/生命周期完成度环）══ */
    {
      const oBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
      if (!oBtn) throw new Error('C15 未找到可观测导航按钮')
      await act(async () => { oBtn.props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 90)) })
      const obsText = JSON.stringify(tr.toJSON())
      for (const k of ['延迟分位阶梯', '吞吐 × 延迟四象限', 'SLO 200ms', '/7 阶段']) {
        if (!obsText.includes(k)) throw new Error('C15 白盒三件套缺失: ' + k)
      }
      if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C15 白盒渲染降级')
      ok('C15-03: 白盒三件套（延迟阶梯/吞吐象限/完成度环 5/7 阶段）渲染且零降级')
    }

    /* ══ cycle-15：专项刷题记忆三视图（横幅 + 一键跳回原题）══ */
    // C15-04：刷题 —— 回模块选择页 → 横幅出现 → 继续上次 → 恢复原题干
    {
      await enterHubTab('practice')
      const backBtn = tr.root.findAllByType('button').find(b => String(b.props.children) === '← 模块')
      if (backBtn) { await act(async () => { backBtn.props.onClick() }); await act(async () => { await new Promise(r => setTimeout(r, 40)) }) }
      let t = JSON.stringify(tr.toJSON())
      if (!t.includes('上次练到「判断推理」')) throw new Error('C15 刷题记忆横幅缺失')
      const resumeBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('继续上次'))
      if (!resumeBtn) throw new Error('C15 继续上次按钮缺失')
      await act(async () => { resumeBtn.props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 60)) })
      t = JSON.stringify(tr.toJSON())
      if (!t.includes('上次的题干（记忆恢复）')) throw new Error('C15 记忆跳回未恢复原题')
      ok('C15-04: 刷题记忆横幅 → 一键跳回上次的模块与原题')
    }
    // C15-05：图形推理 —— 横幅显示「规律类型 · 题号」
    {
      await enterHubTab('tuxing')
      const t = JSON.stringify(tr.toJSON())
      if (!t.includes('上次练到「数量规律」 · 第 2 题')) throw new Error('C15 图形推理记忆横幅缺失: [tx全串=' + t.includes('上次练到「数量规律」') + ', 第2题=' + t.includes('第 2 题') + ']')
      if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C15 图形推理记忆横幅渲染降级')
      ok('C15-05: 图形推理记忆横幅（规律类型 · 题号）渲染')
    }
    // C15-06：深度题库 —— 横幅出现 → 继续上次 → 恢复原题
    {
      await enterHubTab('deepbank')
      let t = JSON.stringify(tr.toJSON())
      if (!t.includes('上次练到「数量关系」')) throw new Error('C15 深度题库记忆横幅缺失')
      const resumeBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('继续上次'))
      if (!resumeBtn) throw new Error('C15 深度题库继续按钮缺失')
      await act(async () => { resumeBtn.props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 60)) })
      t = JSON.stringify(tr.toJSON())
      if (!t.includes('深度题库上次的题')) throw new Error('C15 深度题库跳回未恢复原题')
      ok('C15-06: 深度题库记忆横幅 → 一键跳回原题')
    }
  }

  tr.unmount()
} catch (e) { bad('真实 client.js 集成渲染', e) }

console.log(`\n═══ 渲染回归: ${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
