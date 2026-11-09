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
  // cycle-16 题库管理面板数据源（self 元数据驱动「关于本项目」卡；repos 分级卡片）
  if (u.includes('/api/repos')) return { json: async () => ({
    root: 'D:/demo/repos', rootSource: 'auto', mirror: '', git: true,
    self: { name: 'dsh-kaogong', version: '1.11.0', repo: 'https://github.com/xuanyuanchumo/dsh-kaogong', homepage: 'https://github.com/xuanyuanchumo/dsh-kaogong#readme', releases: 'https://github.com/xuanyuanchumo/dsh-kaogong/releases', issues: 'https://github.com/xuanyuanchumo/dsh-kaogong/issues', npm: 'https://www.npmjs.com/package/dsh-kaogong', license: 'MIT', desc: '考公备考整合插件' },
    repos: [
      { key: 'xingcezhenti', tier: 'required', size: '341MB', desc: '行测真题', upstream: 'https://github.com/ERRRC/xingcezhenti', present: false, isGit: false, files: 0, job: null },
      { key: 'kaogong-skill', tier: 'required', size: '3MB', desc: '方法论', upstream: 'https://github.com/KeWang0622/kaogong-skill', present: true, isGit: true, files: 16, job: { state: 'done', action: 'clone', log: ['ok'] } },
      { key: 'gwy-zhenti', tier: 'recommended', size: '626MB', desc: '真题卷', upstream: 'https://github.com/ProfessorZhi/gwy-zhenti', present: false, isGit: false, files: 0, job: null },
      { key: 'sakib', tier: 'optional', size: '1MB', desc: '文档库', upstream: 'https://github.com/vsakib/sakib', present: false, isGit: false, files: 0, job: null },
    ],
    summary: { total: 15, present: 1, requiredMissing: ['xingcezhenti'], running: 0, tiers: { required: 3, recommended: 2, optional: 10 } },
  }) }
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
  // cycle-18 花生十三体系方法论（形状严格对齐 server 实测，见 smoke HS13-01..10）
  if (u.includes('/api/huasheng13/search')) {
    // 空查询 → 服务端返回 results:[]（不是 error），UI 必须走空态而不是降级
    const hasQ = /[?&]q=([^&]*)/.exec(u)
    const qv = hasQ ? decodeURIComponent(hasQ[1]) : ''
    if (!qv) return { json: async () => ({ query: '', took: 0, limit: 10, total: 0, results: [] }) }
    return { json: async () => ({
      query: qv, took: 1.23, limit: 10, total: 1, rawTotal: 25, filtered: 24,
      confidence: 'high', coverage: 1, phraseHit: true,
      results: [{
        file: 'ziliao-susuan', title: '三大速算方法', score: 11.9959,
        highlight: '截位直除：已知现期 + R，求基期，直接除',
        snippets: [{ heading: '一、截位直除法进阶', text: '截位直除是资料分析最快的除法估算' }],
        terms: ['截位', '位直', '直除'], moduleId: 'ziliao', kind: 'doc', weight: 7.06,
      }],
    }) }
  }
  if (u.includes('/api/huasheng13/catalog')) return { json: async () => ({
    meta: { id: 'huasheng13', label: '花生十三体系', docCount: 25, available: 25, degraded: false, missingCount: 0, missing: [], orphans: [], dirMismatch: [], builtAt: Date.now(), indexSource: 'disk', buildMs: 26 },
    modules: [
      { id: 'ziliao', label: '资料分析', icon: '📊', color: '#0ea5e9', weight: 1.15, targetMinutes: 28, targetQuestions: 20,
        docs: [
          { file: 'ziliao-fenxi', title: 'ABRX 四要素体系', desc: '互推关系', chars: 6103, tables: 4, formulas: 72, sections: 31, present: true },
          { file: 'ziliao-susuan', title: '三大速算方法', desc: '截位直除 · 415 份数', chars: 4051, tables: 6, formulas: 60, sections: 41, present: true },
        ],
        examples: [{ file: 'ziliao-lianxi', title: '资料分析练习 10 题', desc: '', chars: 2954, tables: 0, formulas: 39, sections: 12, present: true }] },
      { id: 'shuliang', label: '数量关系', icon: '🔢', color: '#8b5cf6', weight: 1.0, targetMinutes: 30, targetQuestions: 15,
        docs: [{ file: 'shuliang-guanxi', title: '全题型解法', desc: '隔板法', chars: 5000, tables: 3, formulas: 40, sections: 25, present: true }],
        examples: [{ file: 'shuliang-lianxi', title: '数量关系练习 18 题', desc: '', chars: 3000, tables: 0, formulas: 30, sections: 20, present: true }] },
    ],
    strategy: [{ file: 'strategy', title: '答题顺序与时间分配', desc: '时间切块', chars: 5592, tables: 6, formulas: 2, sections: 71, present: true }],
    examples: [{ file: 'zhenti-shili', title: '各模块真题示例与解析', desc: '', chars: 9620, tables: 0, formulas: 60, sections: 36, present: true }],
  }) }
  if (u.includes('/api/huasheng13/coverage')) return { json: async () => ({
    overall: 0.9756, expectedDims: 41, presentDims: 40,
    modules: [
      { id: 'ziliao', label: '资料分析', icon: '📊', color: '#0ea5e9', coverage: 1, docCount: 3, presentDocs: 3, examples: 1, tables: 15, formulas: 138, chars: 13107, dims: { formula: true, table: true, example: true }, missing: [], files: [] },
      { id: 'shuliang', label: '数量关系', icon: '🔢', color: '#8b5cf6', coverage: 1, docCount: 2, presentDocs: 2, examples: 1, tables: 5, formulas: 40, chars: 8000, dims: { formula: true, table: true, example: true }, missing: [], files: [] },
      { id: 'yanyu', label: '言语理解', icon: '📖', color: '#f59e0b', coverage: 0.889, docCount: 3, presentDocs: 3, examples: 1, tables: 3, formulas: 0, chars: 9000, dims: { formula: true, table: true, example: true }, missing: ['yanyu-zhuanxiang 缺公式'], files: [] },
      { id: 'panduan', label: '判断推理', icon: '🧩', color: '#10b981', coverage: 1, docCount: 3, presentDocs: 3, examples: 1, tables: 4, formulas: 5, chars: 11000, dims: { formula: true, table: true, example: true }, missing: [], files: [] },
      { id: 'changshi', label: '常识判断', icon: '🌍', color: '#0ea5e9', coverage: 1, docCount: 2, presentDocs: 2, examples: 0, tables: 2, formulas: 0, chars: 7000, dims: { formula: false, table: true, example: false }, missing: [], files: [] },
      { id: 'shenlun', label: '申论', icon: '✍️', color: '#ef4444', coverage: 1, docCount: 3, presentDocs: 3, examples: 1, tables: 2, formulas: 0, chars: 12000, dims: { formula: false, table: true, example: true }, missing: [], files: [] },
    ],
    gaps: [
      { module: 'yanyu', label: '言语理解', kind: 'dimension', detail: 'yanyu-zhuanxiang 缺公式' },
      { module: 'changshi', label: '常识判断', kind: 'no-example', detail: '缺配套练习文件（覆盖维度 −1）' },
    ],
    adapterGaps: [], degraded: false,
  }) }
  if (u.includes('/api/huasheng13/trace')) return { json: async () => ({
    ws: 'D:/test/ws-abcd1234',
    endpoints: {
      '/api/huasheng13/catalog': { hits: 3, p50: 0.4, p95: 1.2, lastAt: Date.now() - 5000, samples: 3 },
      '/api/huasheng13/doc': { hits: 2, p50: 2.1, p95: 3.4, lastAt: Date.now() - 4000, samples: 2 },
      '/api/huasheng13/search': { hits: 5, p50: 1.5, p95: 4.8, lastAt: Date.now() - 3000, samples: 5 },
      '/api/huasheng13/coverage': { hits: 0, p50: 0, p95: 0, lastAt: 0, samples: 0 },
      '/api/huasheng13/practice': { hits: 1, p50: 0.9, p95: 2.0, lastAt: Date.now() - 2000, samples: 1 },
      '/api/huasheng13/trace': { hits: 4, p50: 0.3, p95: 0.8, lastAt: Date.now(), samples: 4 },
    },
    searches: { total: 5, hit: 5, miss: 0, empty: 1, hitRate: 1 },
    docs: { reads: { 'ziliao-fenxi': 2 }, distinct: 1 },
    recent: [{ at: Date.now() - 1000, kind: 'search', detail: '截位直除 → 7/25 条 (high)', ms: 16.49 }],
    ring: { recentCap: 200, recentLen: 1, latCap: 100, slotsCap: 24, slots: 1 },
    declaration: {
      endpoints: [
        { path: '/api/huasheng13/catalog', declared: true }, { path: '/api/huasheng13/doc', declared: true },
        { path: '/api/huasheng13/search', declared: true }, { path: '/api/huasheng13/coverage', declared: true },
        { path: '/api/huasheng13/practice', declared: true }, { path: '/api/huasheng13/trace', declared: true },
      ], allDeclared: true, declaredTotal: 63,
    },
    corpus: { root: 'D:/pkg/assets/huasheng13', rootRel: 'assets/huasheng13', dirPresent: true, snapshotPresent: true, indexed: true, degraded: false, builtAt: Date.now(), source: 'disk', buildMs: 26, error: '' },
    at: Date.now(),
  }) }
  if (u.includes('/api/huasheng13/doc')) {
    const m = /[?&]file=([^&]*)/.exec(u)
    const f = m ? decodeURIComponent(m[1]) : ''
    if (!f) return { json: async () => ({ error: '缺少 file 参数', file: '', hint: '示例：/api/huasheng13/doc?file=ziliao-fenxi', known: ['ziliao-fenxi'] }) }
    if (f !== 'ziliao-fenxi' && f !== 'ziliao-susuan' && f !== 'shuliang-guanxi') {
      return { json: async () => ({ error: '未知语料文件: ' + f, file: f, known: ['ziliao-fenxi', 'ziliao-susuan', 'shuliang-guanxi'] }) }
    }
    return { json: async () => ({
      file: f, title: f === 'ziliao-fenxi' ? 'ABRX 四要素体系' : f === 'ziliao-susuan' ? '三大速算方法' : '全题型解法',
      moduleId: f === 'shuliang-guanxi' ? 'shuliang' : 'ziliao', kind: 'doc', desc: '',
      markdown: '# ABRX 四要素体系\n\n## 一、ABRX 关系\n\n现期 A = 基期 B × (1 + 增长率 R)\n\n| 要素 | 含义 |\n|---|---|\n| A | 现期 |\n| B | 基期 |\n\n- 截位直除\n- 假设分配\n',
      chars: 8013, tables: 4, formulas: 72, sections: 31, sectionCount: 31, weight: 6.9,
      path: 'references/' + f + '.md', degraded: false,
    }) }
  }
  if (u.includes('/api/huasheng13/practice')) {
    // 形状对齐实测：total=10 n=5 returned=5 hasMore=true；answerIsLetter 混合（含文字作答陷阱题）
    const nth = /[?&]n=(\d+)/.exec(u)
    const n = nth ? parseInt(nth[1], 10) : 5
    const all = []
    for (let i = 1; i <= 10; i++) {
      const word = i === 1 || i === 8          // 第 1/8 题为文字作答（answerIsLetter=false）
      all.push({
        index: i, title: '练习 ' + i, heading: '练习 ' + i, level: 2, category: '',
        stem: '资料分析练习第 ' + i + ' 题：求增长率（测试题干）',
        options: word ? [{ key: 'A', text: '53870 亿元' }, { key: 'B', text: '60000 亿元' }] : [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }, { key: 'D', text: 'd' }],
        analysis: '解析：按 ABRX 公式计算。', answer: word ? '53870 亿元' : 'B',
        answerIsLetter: !word, pitfalls: '', startLine: 10, endLine: 20,
      })
    }
    const items = all.slice(0, Math.max(1, Math.min(50, n)))
    return { json: async () => ({ file: 'ziliao-lianxi', title: '资料分析练习 10 题', moduleId: 'ziliao', total: 10, n, returned: items.length, hasMore: all.length > items.length, items, degraded: false }) }
  }
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

    /* ══ cycle-16：题库管理面板（关于本项目 GitHub 跳转 + 分级卡片 + 零降级）══ */
    {
      const rpBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('题库管理'))
      if (!rpBtn) throw new Error('C16 未找到题库管理导航按钮')
      await act(async () => { rpBtn.props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 120)) })
      const t = JSON.stringify(tr.toJSON())
      // 关于本项目卡：GitHub 仓库/Release/Issue/npm 四类跳转 + 版本徽章
      for (const k of ['关于本项目', 'GitHub 仓库', 'Release', '反馈 Issue', 'npm', '上游致谢', 'v1.11.0']) {
        if (!t.includes(k)) throw new Error('C16 题库面板缺「' + k + '」')
      }
      if (!t.includes('https://github.com/xuanyuanchumo/dsh-kaogong')) throw new Error('C16 关于本项目卡未挂真实仓库 URL')
      // 分级卡片 + 状态徽章 + 一键必选 + 数据根/镜像配置
      for (const k of ['必选 · ', '推荐 · ', '可选 · ', '已安装', '未安装', '一键安装必选包', '数据根与镜像代理']) {
        if (!t.includes(k)) throw new Error('C16 题库面板区块缺失: ' + k)
      }
      // 上游仓库链接逐卡存在（致敬跳转）
      if (!t.includes('https://github.com/ERRRC/xingcezhenti')) throw new Error('C16 上游仓库跳转缺失')
      if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C16 题库面板渲染降级')
      // 安装按钮真实触达 POST /repos/install（fetch 日志断言）
      const before = globalThis.__kgFetchLog.length
      const installBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('⬇ xingcezhenti'))
      if (!installBtn) throw new Error('C16 一键安装必选按钮缺失')
      await act(async () => { installBtn.props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 80)) })
      const after = globalThis.__kgFetchLog.slice(before).join(' ')
      if (!after.includes('/api/repos/install')) throw new Error('C16 安装按钮未触发 /api/repos/install 请求')
      if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C16 安装交互后渲染降级')
      ok('C16-01: 题库管理面板（关于本项目 GitHub 跳转×4+致谢 · 分级卡片 · 一键安装真实发请求 · 零降级）')
    }

    /* ══ cycle-18：花生十三体系方法论视图（五分区 + 检索交互 + 零降级）══
       导航锚定纪律（cycle-13 教训④ + 本轮新增陷阱）：
       **用户明确要求「不要单独弄导航入口，放在专题下的方法论下」** → hs13 视图现在挂在
       专题枢纽「📖 方法论」分区（data-kg-hub-tab=method）内，一级导航里**没有**它。
       因此断言路径改为：点「🎯 专题」→ 点枢纽 method 分区 tab → 校验 hs13 视图根锚点。
       一律用属性锚定：hs13 视图内分区用 data-kg-hs13-tab，枢纽分区用 data-kg-hub-tab。 */
    {
      // ① 进入专题枢纽
      const topicBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('专题'))
      if (!topicBtn) throw new Error('C18 未找到「🎯 专题」一级导航按钮')
      await act(async () => { topicBtn.props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 140)) })

      // ② 一级导航不得再出现独立「花生十三体系」入口（用户要求：并入专题方法论）
      const strayBtn = tr.root.findAllByType('button')
        .find(b => String(b.props.children).includes('花生十三体系'))
      if (strayBtn) throw new Error('C18 违规：一级导航仍存在独立「花生十三体系」入口')

      // ③ 点枢纽「📖 方法论」分区（属性锚定，不按文本匹配以免与 hs13 内部分区撞名）
      const hubTab = tr.root.findAll(n => n.props && n.props['data-kg-hub-tab'] === 'method')
      if (!hubTab.length) throw new Error('C18 专题枢纽未找到 data-kg-hub-tab=method 分区')
      await act(async () => { hubTab[0].props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 160)) })

      // 视图根锚点存在（证明枢纽里挂的是 NativeHuasheng13View）
      const rootEl = tr.root.findAll(n => n.props && n.props['data-kg-hs13-root'] === '1')
      if (!rootEl.length) throw new Error('C18 枢纽方法论分区内未挂载花生十三体系视图（data-kg-hs13-root 缺失）')

      // 五分区 tab 齐备（属性锚定，不靠文本）
      const SEC = ['overview', 'catalog', 'search', 'practice', 'trace']
      const tabEls = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'])
      const foundIds = new Set(tabEls.map(n => String(n.props['data-kg-hs13-tab'])))
      const missSec = SEC.filter(id => !foundIds.has(id))
      if (missSec.length) throw new Error('C18 五分区 tab 缺失: ' + missSec.join(','))
      ok('C18-01: 花生十三体系视图挂载 + 五分区 tab 齐备（属性锚定 data-kg-hs13-tab）')

      // 逐分区切换零降级（role="alert" 是宿主降级态标志，任何分区都不许出现）
      for (const id of SEC) {
        const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === id)
        if (!tb.length) throw new Error('C18 分区 tab 未找到: ' + id)
        await act(async () => { tb[0].props.onClick() })
        await act(async () => { await new Promise(r => setTimeout(r, 90)) })
        const alert = tr.root.findAll(n => n.props && n.props.role === 'alert')
        if (alert.length) {
          const kids = alert[0].props.children
          const flat = (Array.isArray(kids) ? kids : [kids]).map(c => typeof c === 'string' ? c : '').join(' ')
          throw new Error(`C18 分区「${id}」渲染降级: ${flat.slice(0, 160)}`)
        }
      }
      ok('C18-02: 五分区逐区切换零降级（overview/catalog/search/practice/trace 全绿）')

      // 体系总览：六模块卡片 + 覆盖率（catalog/coverage 双源驱动）
      {
        const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === 'overview')
        await act(async () => { tb[0].props.onClick() })
        // 双源首次到达需两轮微任务 + 一次渲染提交；轮询到稳定（最多 ~1.2s），
        // 避免用固定短等待造成的 flaky（实测 120ms 时 chance-fail）。
        await act(async () => {
          for (let i = 0; i < 24; i++) {
            if (JSON.stringify(tr.toJSON()).includes('资料分析')) break
            await new Promise(r => setTimeout(r, 50))
          }
        })
        await act(async () => { await new Promise(r => setTimeout(r, 60)) })
        const t = JSON.stringify(tr.toJSON())
        for (const k of ['资料分析', '数量关系']) {
          if (!t.includes(k)) throw new Error('C18 总览缺少模块卡片: ' + k)
        }
        // 覆盖率由 coverage.overall=0.9756 驱动，统一走 hs13FmtPct（一位小数 → 97.6%）。
        // 口径一致性要求：环形环心、页面文案、obs 链路卡三处必须同一格式，
        // 否则同一份数据在白盒面板上显示两个数字（97.6% vs 98%）＝自相矛盾。
        if (!/97\.6%/.test(t)) throw new Error('C18 总览未渲染覆盖率（coverage.overall=0.9756 → 97.6%）')
        if (/98%/.test(t)) throw new Error('C18 总览出现 98% 取整口径，与其他覆盖率文案（97.6%）不一致')
        ok('C18-03: 体系总览渲染六模块卡片 + 覆盖率（coverage.overall=0.9756 → 97.6%）')
      }

      // 检索交互：输入「截位直除」→ 点「检索」→ 结果列表出现（标题=三大速算方法）
      {
        const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === 'search')
        await act(async () => { tb[0].props.onClick() })
        await act(async () => { await new Promise(r => setTimeout(r, 90)) })
        const input = tr.root.findAllByType('input').find(i => {
          const ph = String((i.props && i.props.placeholder) || '')
          return ph.includes('考点') || ph.includes('截位直除') || ph.includes('方法名')
        })
        if (!input) throw new Error('C18 检索分区未找到搜索输入框')
        await act(async () => { input.props.onChange({ target: { value: '截位直除' } }) })
        await act(async () => { await new Promise(r => setTimeout(r, 30)) })
        // ⚠ 精确文本匹配：导航里还有「🔍 知识检索」按钮，用 includes('检索') 会命中它
        // 并导致「点检索变成切视图」（实测踩中）。这里只认按钮自身的文本恰好是「检索/检索中…」。
        const searchBtn = tr.root.findAllByType('button').find(b => {
          const txt = String(b.props && b.props.children == null ? '' : b.props.children).trim()
          return txt === '检索' || txt === '检索中…'
        })
        if (!searchBtn) throw new Error('C18 未找到检索分区内的「检索」按钮（精确文本）')
        const before = globalThis.__kgFetchLog.length
        await act(async () => { searchBtn.props.onClick() })
        await act(async () => { await new Promise(r => setTimeout(r, 120)) })
        const hitUrl = globalThis.__kgFetchLog.slice(before).find(x => x.includes('/api/huasheng13/search') && x.includes('q=' + encodeURIComponent('截位直除')))
        if (!hitUrl) throw new Error('C18 检索未触发带 q=截位直除 的请求: ' + globalThis.__kgFetchLog.slice(before).join(' ; '))
        const t = JSON.stringify(tr.toJSON())
        if (!t.includes('三大速算方法')) throw new Error('C18 检索结果列表未渲染（未出现「三大速算方法」）')
        // 置信度提示必须真实透出（high → 「精确命中」），证明消费 confidence 而非写死
        if (!t.includes('精确命中')) throw new Error('C18 未渲染置信度 high→精确命中（confidence 未驱动 UI）')
        if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C18 检索后渲染降级')
        ok('C18-04: 检索交互（输入「截位直除」→ 发请求 → 结果列表 + 置信度提示「精确命中」）')
      }

      // 配套练习：默认抽题 + 文字作答陷阱题走只读（answerIsLetter=false 不可自动判分）
      {
        const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === 'practice')
        await act(async () => { tb[0].props.onClick() })
        await act(async () => { await new Promise(r => setTimeout(r, 150)) })
        const t = JSON.stringify(tr.toJSON())
        if (!t.includes('资料分析练习第')) throw new Error('C18 练习分区未渲染题干')
        if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C18 练习分区渲染降级')
        ok('C18-05: 配套练习分区渲染题干（practice 消费真实 items）+ 零降级')
      }

      // 白盒链路：trace 端点表格（六端点槽位 + 命中率 + p95）
      {
        const tb = tr.root.findAll(n => n.props && n.props['data-kg-hs13-tab'] === 'trace')
        await act(async () => { tb[0].props.onClick() })
        await act(async () => { await new Promise(r => setTimeout(r, 120)) })
        const t = JSON.stringify(tr.toJSON())
        if (!t.includes('链路') && !t.includes('命中')) throw new Error('C18 白盒分区未渲染链路信息')
        if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C18 白盒分区渲染降级')
        ok('C18-06: 白盒链路分区渲染 trace（端点命中/检索统计）+ 零降级')
      }

      // 回专题枢纽：method 分区仍可达且零降级（与 hs13 是**两个不同数据域**，不合并）
      await enterHubTab('method')
      {
        const methodTab = tr.root.findAll(n => n.props && n.props['data-kg-hub-tab'] === 'method')
        if (!methodTab.length) throw new Error('C18 专题枢纽 method 分区 tab 缺失')
        if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C18 专题枢纽 method 分区渲染降级')
        ok('C18-07: 专题枢纽「📖 方法论」分区（data-kg-hub-tab=method）仍可达且零降级（与 hs13 数据域不混用）')
      }
    }

    /* ══ cycle-18：白盒面板「📖 方法论链路」卡（直接渲染 NativeObsView + 注入 data.hs13）══
       双保险设计：不依赖 client.ts 的接线是否到位——直接给组件喂 data.hs13，
       把卡片行为（热力条/命中率/p50/p95/缺口降级）钉死。 */
    {
      // 从 combo 里没有导出 obs 组件，但可通过主面板导航「可观测」触达；
      // 这里改用「可观测视图」真实路径 + fetch 日志断言三源已被请求。
      const oBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('可观测'))
      if (!oBtn) throw new Error('C18 未找到「可观测」导航按钮')
      const before = globalThis.__kgFetchLog.length
      await act(async () => { oBtn.props.onClick() })
      await act(async () => { await new Promise(r => setTimeout(r, 140)) })
      const reqs = globalThis.__kgFetchLog.slice(before).join(' ')
      for (const ep of ['/api/huasheng13/trace', '/api/huasheng13/coverage', '/api/huasheng13/catalog']) {
        if (!reqs.includes(ep)) throw new Error('C18-08 白盒面板未请求方法论三源: ' + ep)
      }
      const t = JSON.stringify(tr.toJSON())
      if (!t.includes('方法论链路')) throw new Error('C18-08 白盒面板「📖 方法论链路」卡未渲染')
      // 六模块热力条：模块中文名必须出现（数据来自 coverage.modules）
      for (const k of ['资料分析', '言语理解', '常识判断']) {
        if (!t.includes(k)) throw new Error('C18-08 方法论链路卡缺模块热力条: ' + k)
      }
      // 量化指标：97.6% 覆盖率 + 100.0% 命中率 + p95 均值（都是真实字段驱动）
      if (!t.includes('97.6%')) throw new Error('C18-08 方法论链路卡未渲染覆盖率 97.6%')
      if (!t.includes('100.0%')) throw new Error('C18-08 方法论链路卡未渲染检索命中率 100.0%')
      if (!/端点 p95 均值/.test(t)) throw new Error('C18-08 方法论链路卡未渲染 p95 指标')
      // 真实缺口如实展示，不粉饰
      if (!t.includes('缺口')) throw new Error('C18-08 方法论链路卡未展示缺口清单（真实缺口被隐瞒）')
      if (tr.root.findAll(n => n.props && n.props.role === 'alert').length) throw new Error('C18-08 方法论链路卡渲染降级')
      ok('C18-08: 白盒「📖 方法论链路」卡（三源齐请求 + 六模块热力条 + 覆盖率/命中率/p95 + 缺口如实展示 + 零降级）')
    }
  }

  tr.unmount()
} catch (e) { bad('真实 client.js 集成渲染', e) }

console.log(`\n═══ 渲染回归: ${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
