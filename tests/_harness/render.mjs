/**
 * tests/_harness/render.mjs — render 分域共享设施（cycle-47 阶段 17 抽取）
 *
 * 从 render.test.mjs 机械切割（行号区间 A=L10-19 / B=L66-399 / C=L401-457，顶层声明
 * 切点——教训㉙：不做括号平衡推断）。导入本模块即完成：dev 依赖解析 + 全局环境
 * （localStorage/fetchLog/mock fetch 49 端点）+ 记忆仓库 + combo 加载/apply（顶层 await）。
 * 旅程文件调 mountPanel() 获得 fresh mount 的 { tr }。
 *
 * ⚠️ 教训⑩：常驻视图重入不重挂是设计行为——fresh mount 下重入断言仅单文件内有效。
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { resolve } = require('node:path')
// React 解析顺序：**本仓 node_modules 优先** → 回退开发机 ../_kgtest/node_modules。
//
// 背景（cycle-62 CI 修复）：原实现硬编码开发机路径 '../_kgtest/node_modules'，
// CI runner 上不存在 → 7 个 render 旅程文件整体失败（CI 自 2026-11-21 起持续红）。
// 修法 = React/react-test-renderer 进 devDependencies（**不进运行时依赖面**：
// package.json dependencies 仍为空，零 npm 运行时依赖特征不变），
// harness 改为「本仓优先 · 开发机回退」——CI 用本仓，本地零安装也能用回退路径。
const devCandidates = [
  resolve(process.cwd(), 'node_modules'),
  resolve(process.cwd(), '..', '_kgtest', 'node_modules'),
]
function requireDev(name) {
  let lastErr = null
  for (const base of devCandidates) {
    try { return require(resolve(base, name)) } catch (e) { lastErr = e }
  }
  throw new Error(
    `[render-harness] 无法加载 ${name}：已尝试 ${devCandidates.join(' / ')}。` +
    '请执行 npm install（React/react-test-renderer 为 devDependencies）。原始错误：' +
    String((lastErr && lastErr.message) || lastErr),
  )
}
const React = requireDev('react')
const TestRenderer = requireDev('react-test-renderer')
const { act } = TestRenderer

let pass = 0, fail = 0
const captured = {}   // 宿主席位捕获（模块级——try 块内赋值）
const ok = (name) => { console.log('✅ ' + name); pass++ }
const bad = (name, e) => { console.log('❌ ' + name + ' — ' + ((e && e.message) || e)); fail++ }



const store = { view: null }
globalThis.localStorage = { getItem: () => store.view, setItem: (_k, v) => { store.view = v } }
globalThis.__kgFetchLog = []   // RENDER-P-01：记录全部 fetch URL（断言省份 chip 触发带参请求）
globalThis.fetch = async (url) => {
  const u = String(url)
  globalThis.__kgFetchLog.push(u)
  if (u.includes('/api/stats')) return { json: async () => ({ rate: 60, answered: 10, day: 1, streak: 2, importedTotal: 0, wrong: { open: 1, mastered: 0 }, mastery: { '判断推理': { rate: 55, confidence: 0.5, mastery: 28, answered: 10 }, '资料分析': { rate: 85, confidence: 0.9, mastery: 77, answered: 20 } } }) }
  if (u.includes('/api/status')) return { json: async () => ({ app: 'dsh-kaogong', port: 8400, repos: { ready: 15, total: 15 }, uptimeSec: 5 }) }
  /**
   * 「抽题」mock —— **必须与服务端真实出站形状一致**（cycle-62 七段字段修复）。
   *
   * 事故背景：原 mock 只有 `{ module, type, stem, options, correctAnswer }`，
   * 但真实 `/api/questions`（poolApi.toLegacyShape）发的是
   * `{ no, number, source, paperFile, region, year, type, module,
   *    groupMaterial, groupMaterialNo, materialRef, stem, options,
   *    correctAnswer, analysis, dims }`。
   * 组件事后读的是 `q.no` / `q.answer` / `q.material` 三个**不存在的名字** →
   * 题号恒 `?`、答案与材料整段不渲染 —— 而 render 测试当年全绿（mock 字段名恰好
   * 与组件读的一致，「mock 形状即契约」的纪律在 mock 失真时**反向失效**）。
   *
   * 纪律：mock 只允许**照抄服务端出站字段**（含图片占位 kgimg://），
   * 否则测试测的是 mock 而不是产品。
   */
  if (u.includes('/api/questions')) return { json: async () => ({
    source: 'pool',
    count: 1,
    questions: [{
      id: 'q:mock:render#7',
      no: 7, number: 7,                                  // 0 编号（双写法）
      source: 'naoku', paperFile: '2024年国考《行测》',    // 1 来源
      region: '国考', year: '2024',
      type: 'single', module: '判断推理',                  // 2 题型
      groupMaterial: '【材料】某市 2018-2023 年铁路旅客运输量变化情况如下表所示。',  // 3 材料
      groupMaterialNo: 1,
      materialRef: '材料 1',
      stem: '测试题干（含图）【图:kgimg://90-图片/题目图/mock-stem.png】',          // 4 题干 + 图
      options: { A: 'a', B: 'b', C: 'c', D: 'd' },                                 // 5 选项
      correctAnswer: 'A',                                                          // 6 答案
      analysis: '测试解析【图:kgimg://90-图片/题目图/mock-analysis.png】',          // 7 解析 + 图
      dims: { kadian: '测试考点', reasoning: '测试推理链' },
    }],
  }) }
  if (u.includes('/api/check')) return { json: async () => ({ isCorrect: true }) }
  // cycle-34 统一题库：mock 必须给**真实形状**（含 health/quality/registry/relTypes），
  // 否则字段级降级分支测不到（教训：mock 形状即契约——R12 同款纪律）。
  if (u.includes('/api/pool/status')) return { json: async () => ({
    ready: true, built: true, schemaVersion: 1, bytes: 399196160,
    builtAt: '2026-11-18T05:00:00.000Z',
    stats: { questions: 27506, relations: 222894, questionSources: 59093, withKadian: 27506, multiSource: 70 },
    registry: [
      { id: 'naoku', tier: 'required', label: '深度题库（GongkaoNaoku）', available: true },
      { id: 'xingcezhenti', tier: 'required', label: '行测真题库（xingcezhenti）', available: true },
    ],
    health: {
      available: true, snapshotMs: 12,
      tables: [{ name: 'question', rows: 27506 }, { name: 'relation', rows: 222894 }],
      relTypes: [
        { type: 'BELONGS_TO', count: 27506, label: '知识点', color: '#10b981', known: true },
        { type: 'APPEARS_IN', count: 59020, label: '出处', color: '#3b82f6', known: true },
        { type: 'NEWREL', count: 12, label: 'NEWREL', color: '#94a3b8', known: false },
      ],
      modules: [{ module: '判断推理', count: 7749 }, { module: '资料分析', count: 3120 }],
      sources: [{ sourceId: 'naoku', questions: 27506, occurrences: 59020 }],
      quality: [
        { key: 'identity', label: '身份唯一', value: 27506, total: 27506, ok: true, desc: 'distinct qid / 题目总数' },
        { key: 'orphan', label: '出处完整', value: 27458, total: 27506, ok: false, desc: '有出处登记的题数' },
      ],
      topKadian: [{ kadian: '人文常识', edges: 2698 }],
    },
  }) }
  if (u.includes('/api/pool/search')) return { json: async () => ({
    query: '图形推理', count: 2, tookMs: 19, engine: 'fts5-trigram',
    results: [
      { canonicalId: 'q:10204454', module: '判断推理', category: '图形推理', kadian: '图形推理 / 数量规律', stem: '从所给的四个选项中，选择最合适的一个填入问号处', sources: [{ source: 'naoku', paper: '2024年甘肃公务员录用考试《行测》题', region: '甘肃', year: '2024' }, { source: 'xingcezhenti', paper: '甘肃卷', region: '甘肃', year: '2024' }] },
      { canonicalId: 'q:10204455', module: '判断推理', category: '图形推理', kadian: '图形推理 / 位置规律', stem: '下列图形的变化规律是', sources: [{ source: 'naoku', paper: '2023年某卷', region: '江苏', year: '2023' }] },
    ],
  }) }
  /**
   * 池抽题 —— 练习/专题/深度题库的**主供数路径**（study-view 走 /api/pool/questions）。
   * cycle-62：原 mock 只有 5 个字段（canonicalId/module/stem/answer/sourceCount），
   * 真实 `poolApi.sampleQuestions` 出站是 toLegacyShape 的**七段全集**——
   * mock 缺 `correctAnswer`/`groupMaterial`/`options`/`no` → 卡片只能显示题干，
   * 答案/材料/选项/题号全空，而测试仍绿（mock 失真）。
   * 纪律：mock 字段必须照抄 toLegacyShape（与 /api/questions 的 mock 同源）。
   */
  if (u.includes('/api/pool/questions')) return { json: async () => {
    // cycle-62：`?source=naoku` 即「深度题库」口径（原 /api/naoku/questions 平移到池端点）。
    // 深度题库视图有自己的断言驱动题（C22-IMG 图片 / C23-MAT 材料），按 module 过滤。
    if (/[?&]source=naoku/.test(u)) return deepbankPoolQuestions(u)
    return {
      count: 1, candidates: 500, strategy: '模块弱点（SRS 1/(rate+0.15)）× 多出处加成',
      questions: [{
        id: 'q:mock:pool#1', canonicalId: 'q:mock:pool#1',
        no: 1, number: 1,
        source: 'naoku', paperFile: '2024年国考《行测》', region: '国考', year: '2024',
        type: 'single', module: '判断推理', qid: 'mock-1',
        groupMaterial: '【材料】某市 2018-2023 年铁路旅客运输量变化情况如下表所示。',
        groupMaterialNo: 1, materialRef: '材料 1',
        stem: '抽到的统一池题目：下列推断正确的是（　）',
        options: { A: '选项甲', B: '选项乙', C: '选项丙', D: '选项丁' },
        correctAnswer: 'C',
        analysis: '元素组成相同，考虑数量规律。',
        dims: { kadian: '图形推理 / 数量规律', reasoning: '第1步：观察元素组成' },
        sources: [{ source_id: 'naoku', paper: '2024年甘肃卷', region: '甘肃', year: '2024' }],
        sourceCount: 1,
      }],
    }
  } }
  if (u.includes('/api/pool/question')) return { json: async () => ({
    canonicalId: 'q:10204454', module: '判断推理', category: '图形推理', kadian: '图形推理 / 数量规律',
    stem: '从所给的四个选项中，选择最合适的一个填入问号处', analysis: '元素组成相同，考虑数量规律。',
    dims: { reasoning: '第1步：元素组成不同', fastest: '⚡ 做和法', pitfalls: '- ⚠ 只看黑球', mother: '🧩 母题', askModel: '', doubt: '' },
    sources: [{ source_id: 'naoku', paper: '2024年甘肃卷', region: '甘肃', year: '2024' }, { source_id: 'xingcezhenti', paper: '甘肃卷', region: '甘肃', year: '2024' }],
    sourceCount: 2, relations: [{ rel_type: 'BELONGS_TO', src_id: 'q:10204454', dst_id: '图形推理' }, { rel_type: 'APPEARS_IN', dst_id: '2024年甘肃卷' }],
  }) }
  // R12：以下三类端点的真实形状必须 mock 到，否则 prop 形状缺陷测不出
  // v1.8.0：图谱 mock 必须带 nodes/edges（否则 canvas 分支不执行，新图谱逻辑测不到），
  // 且包含 nodeMeta/analytics/layout 以覆盖「服务端字段优先」路径。
  if (u.includes('/api/graph/neighborhood')) return { json: async () => ({ center: 'plugin:kaogong', depth: 1, nodes: [{ id: 'plugin:kaogong', type: 'plugin', label: 'dsh-kaogong' }, { id: 'endpoint:/api/stats', type: 'endpoint', label: '学习统计' }], edges: [{ source: 'plugin:kaogong', target: 'endpoint:/api/stats', rel: 'produces', w: 1 }], stats: { nodes: 2, edges: 1 } }) }
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
  // cycle-61 v9：数据域就绪矩阵（六域 + 三态 + 缺源 + 质量门）
  if (u.includes('/api/data-domains')) return { json: async () => ({
    domains: [
      { id: 'question', label: '练习题', desc: '模块化练习题', ready: true, ingesting: false, ingestMode: 'sync', sources: ['xingcezhenti'], views: ['practice'], available: true, details: [{ table: 'question', where: '', min: 1, rows: 86534, ok: true }] },
      { id: 'paper', label: '真题卷', desc: '1683 套真题卷', ready: false, ingesting: true, ingestMode: 'background', sources: ['gwy-zhenti'], views: ['papers'], available: true, details: [{ table: 'paper', where: '', min: 1, rows: 0, ok: false }] },
      { id: 'tuxing', label: '图形推理', desc: '354 题图形推理专项', ready: true, ingesting: false, ingestMode: 'sync', sources: ['gk-tuxing'], views: ['tuxing'], available: true, details: [{ table: 'question', where: "source_id = 'gk-tuxing'", min: 1, rows: 354, ok: true }] },
      { id: 'method', label: '方法论', desc: '花生十三六模块体系', ready: true, ingesting: false, ingestMode: 'sync', sources: ['huasheng13'], views: ['huasheng13'], available: true, details: [{ table: 'knowledge', where: '', min: 1, rows: 36, ok: true }] },
      { id: 'knowledge', label: '考点知识', desc: '考点节点', ready: true, ingesting: false, ingestMode: 'sync', sources: ['kadian'], views: [], available: true, details: [{ table: 'knowledge', where: "kind='kadian'", min: 1, rows: 9685, ok: true }] },
      { id: 'pool', label: '统一题库', desc: '跨源统一池', ready: true, ingesting: false, ingestMode: 'background', sources: ['naoku'], views: ['pool'], available: true, details: [{ table: 'question', where: '', min: 1, rows: 86534, ok: true }] },
    ],
    contracts: { problems: [], consistent: true },
    quality: { fresh: false, hint: '统一池数据为旧版本（cf 污染/低 schema/图推覆盖不足）——建议在「🗄️ 统一题库」重建' },
    pending: [{ id: 'paper', label: '真题卷', sources: ['gwy-zhenti'] }],
    ingesting: [{ id: 'paper', label: '真题卷', sources: ['gwy-zhenti'] }],
    ready: 5, total: 6,
  }) }
  // cycle-61 v9：统一缓存白盒（命中率 + 快照 + 失效图 + 订阅者）
  if (u.includes('/api/cache')) return { json: async () => ({
    domains: [
      { domain: 'graph', hits: 12, misses: 3, sets: 3, hitRate: 80, entries: 2, snapshot: null },
      { domain: 'search', hits: 5, misses: 5, sets: 5, hitRate: 50, entries: 3, snapshot: null },
      { domain: 'stats', hits: 9, misses: 1, sets: 1, hitRate: 90, entries: 1, snapshot: { builtAt: Date.now(), key: 'fp-abc' } },
    ],
    slots: 6,
    snapshots: 1,
    invalidationGraph: { question: ['graph', 'stats', 'search', 'domains', 'tuxing'], paper: ['stats', 'search', 'domains', 'paperIndex'] },
    policy: { graph: { ttlMs: 5000, maxEntries: 24 }, search: { ttlMs: 30000, maxEntries: 48 } },
    subscribers: ['poolDb.statsCache', 'methodology.idxSlot', 'dataApi.moduleCounts'],
  }) }
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
  if (u.includes('/api/wrong')) return { json: async () => ({ wrong: [{ sig: 'wb1', module: '判断推理', wrongCount: 2, box: 1, mastered: false, stem: '错题题干文本示例（超过九十字符以验证展开全文交互）——此处继续填充题干内容用于确认截断线与展开按钮的渲染行为是否正常工作，需要足够长的文本内容才能越过九十字符阈值从而触发展开全文提示行的条件渲染，因此继续追加更多文字直到确实超过阈值为止。' }], summary: { open: 1, mastered: 0 } }) }
  // cycle-20 题库管理：批量安装端点必须先于 /api/repos 匹配（否则被通配吞掉）
  if (u.includes('/api/repos/install-batch')) return { json: async () => ({ ok: true, batchId: 'b1-test', batch: { id: 'b1-test', state: 'running', items: [{ key: 'xingcezhenti', state: 'running', error: null }], done: 0, total: 1 } }) }
  if (u.includes('/api/repos/batch')) return { json: async () => ({ batch: { id: 'b1-test', state: 'done', items: [{ key: 'xingcezhenti', state: 'done', error: null }], done: 1, total: 1 } }) }
  if (u.includes('/api/repos/jobs')) return { json: async () => ({ total: 1, jobs: [{ key: 'gwy-zhenti', action: 'clone', state: 'failed', error: '网络中断', elapsedSec: 12 }] }) }
  // cycle-21 W1 数据位置白盒卡数据源（/api/data-location 真实形状）
  if (u.includes('/api/data-location')) return { json: async () => ({
    userDataRoot: 'C:/Users/demo/.dsh/kaogong', source: 'user-home',
    reposRoot: { root: 'C:/Users/demo/.dsh/kaogong/repos', source: 'managed-default' },
    pkgResidual: [], pkgDataDir: 'D:/pkg/data',
    migration: { performed: true, status: 'migrated', movedCount: 4 },
  }) }
  // cycle-21 H5 纸质补录：搜索候选（带 contentSig + matchSource）/批次台账真实形状
  if (u.includes('/api/history/search')) return { json: async () => ({
    keyword: '林产品', list: [{ id: 'n-1', module: '资料分析', type: '现期比重', stem: '能够正确描述2017年A市间接经济价值占比的统计图是：', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'B', contentSig: 'abc123def456', matchSource: 'naoku', year: '2019' }],
  }) }
  if (u.includes('/api/history/entries')) return { json: async () => ({ batchId: 'imp-test-01', accepted: 1, acceptedItems: [{ sig: 'abc123def456', result: 'wrong' }], conflicts: [], rejected: [], total: 1 }) }
  if (u.includes('/api/history/undo')) return { json: async () => ({ undone: true, batchId: 'imp-test-01', removedHistory: 1, removedWrong: 1 }) }
  if (u.includes('/api/history/batches')) return { json: async () => ({ batches: [{ batchId: 'imp-test-01', at: Date.now(), count: 1, source: null }], importedTotal: 1, undoWindow: 30 }) }
  // cycle-16 题库管理面板数据源（self 元数据驱动「关于本项目」卡；repos 分级卡片）
  if (u.includes('/api/repos')) return { json: async () => ({
    root: 'D:/demo/repos', rootSource: 'auto', mirror: '', git: true,
    previousRoot: 'D:/old/repos', previousRootRepos: 3,
    diskFreeMB: 51200,
    recentJobs: [{ key: 'gwy-zhenti', action: 'clone', state: 'failed', error: '网络中断', elapsedSec: 12 }],
    self: { name: 'dsh-kaogong', version: '1.11.0', repo: 'https://github.com/xuanyuanchumo/dsh-kaogong', homepage: 'https://github.com/xuanyuanchumo/dsh-kaogong#readme', releases: 'https://github.com/xuanyuanchumo/dsh-kaogong/releases', issues: 'https://github.com/xuanyuanchumo/dsh-kaogong/issues', npm: 'https://www.npmjs.com/package/dsh-kaogong', license: 'MIT', desc: '考公备考整合插件' },
    repos: [
      { key: 'xingcezhenti', tier: 'required', size: '341MB', desc: '行测真题', upstream: 'https://github.com/ERRRC/xingcezhenti', present: false, isGit: false, files: 0, health: 'absent', lastCommitAt: null, job: null },
      { key: 'kaogong-skill', tier: 'required', size: '3MB', desc: '方法论', upstream: 'https://github.com/KeWang0622/kaogong-skill', present: true, isGit: true, files: 16, health: 'ok', lastCommitAt: Date.now() - 86400000, job: { state: 'done', action: 'clone', log: ['ok'] } },
      { key: 'gwy-zhenti', tier: 'recommended', size: '626MB', desc: '真题卷', upstream: 'https://github.com/ProfessorZhi/gwy-zhenti', present: true, isGit: false, files: 3, health: 'no-git', lastCommitAt: null, job: null },
      { key: 'sakib', tier: 'optional', size: '1MB', desc: '文档库', upstream: 'https://github.com/vsakib/sakib', present: false, isGit: false, files: 0, health: 'absent', lastCommitAt: null, job: null },
    ],
    summary: { total: 15, present: 2, requiredMissing: ['xingcezhenti'], running: 0, tiers: { required: 3, recommended: 2, optional: 10 }, health: { ok: 1, empty: 0, 'half-clone': 0, 'no-git': 1, absent: 13 } },
  }) }
  // cycle-15 专项刷题记忆：GET 返回全局记忆仓库（POST 由视图静默回写，响应不参与断言）
  if (u.includes('/api/memory')) {
    return { json: async () => ({ memory: globalThis.__kgMemStore || {} }) }
  }
  // cycle-46 幽灵视图补齐：plan/search/method 三页面的端点 mock（真实形状——mock 即契约）
  if (u.includes('/api/plan/schedule')) return { json: async () => ({
    schedule: Array.from({ length: 30 }, (_, i) => ({ day: i + 1, focus: [{ module: '判断推理', weight: 0.4, suggested: 12 }, { module: '资料分析', weight: 0.3, suggested: 9 }, { module: '言语理解与表达', weight: 0.3, suggested: 9 }] })),
    profile: { hasProfile: true, focus: [{ module: '判断推理', primaryRate: 0.55, backlog: 3 }, { module: '资料分析', primaryRate: 0.85, backlog: 0 }] },
  }) }
  if (u.includes('/api/plan')) return { json: async () => ({
    day: 1, phases: [
      { name: '第一阶段', startDay: 1, endDay: 7 }, { name: '第二阶段', startDay: 8, endDay: 15 },
      { name: '第三阶段', startDay: 16, endDay: 22 }, { name: '第四阶段', startDay: 23, endDay: 30 },
    ],
    days: Array.from({ length: 30 }, (_, i) => ({ day: i + 1, title: '第 ' + (i + 1) + ' 天 · 训练', phase: '', tasks: ['刷题 30 题', '错题复盘'] })),
  }) }
  if (u.includes('/api/search')) return { json: async () => ({
    results: [
      { file: 'sakib/判断推理/index.md', snippet: '1. 图形推理\n   - 定义：每道题给出一套图形' },
      { file: 'kaogong-skill/references/xingce.md', snippet: '图形推理常见规律：位置/样式/数量/空间' },
    ],
  }) }
  if (u.includes('/api/methods')) return { json: async () => ({
    topics: [
      { id: '行测', label: '行测', file: 'xingce.md', exists: true },
      { id: '申论', label: '申论', file: 'shenlun.md', exists: true },
      { id: '公基', label: '公基', file: 'gongji.md', exists: true },
    ],
  }) }
  if (u.includes('/api/method')) return { json: async () => ({
    topic: '行测', file: 'xingce.md', content: '# 行测方法参考\n\n截位直除、ABRX 等速算技巧说明（mock 全文）。',
  }) }
  // cycle-15 图形推理/深度题库数据源 mock（让横幅与恢复路径可测；N-02 分区切换零降级）
  if (u.includes('/api/tuxing/cats')) return { json: async () => ({ ready: true, total: 354, cats: [{ cat: 'shuliang', name: '数量规律', count: 40 }] }) }
  if (u.includes('/api/tuxing/list')) return { json: async () => ({ total: 2, questions: [{ no: 1, catName: '数量规律', ans: 'A', imgUrl: '' }, { no: 2, catName: '数量规律', ans: 'B', imgUrl: '' }] }) }
  /**
   * 深度题库视图的 mock（cycle-62 端点收敛）：视图不再消费 /api/naoku/*，
   * 改走池端点 —— 此处把原 naoku mock 的**断言驱动能力**平移到池端点形状：
   *   /api/naoku/status      → /api/pool/status（已在上方有完整 mock）
   *   /api/naoku/questions   → /api/pool/questions?source=naoku（下面这条，含 module 过滤）
   *   /api/naoku/practice    → /api/pool/by-kadian
   *   /api/naoku/kadian      → /api/pool/kadians
   */
  if (u.includes('/api/pool/by-kadian')) return { json: async () => {
    // 按考点抽题（原 /api/naoku/practice 语义）：返回一题，驱动「练此知识点」链路
    return {
      kadian: decodeURIComponent((u.match(/[?&]kadian=([^&]*)/) || [])[1] || ''),
      count: 1, sourceTier: 'pool',
      questions: [{ no: 1, number: 1, module: '判断推理', stem: '深度题库抽题', options: { A: 'a', B: '【图:kgimg://90-图片/题目图/mock-opt-b.png】', C: 'c', D: 'd' }, correctAnswer: 'A', kadian: '考点X', analysis: '解析含图：【图:kgimg://90-图片/公式图/formula-mock.png】请注意变化。', source: 'naoku' }],
    }
  } }
  // 池抽题（source=naoku 限定即为「深度题库」口径）——沿用原 naoku mock 的两道驱动题
  function deepbankPoolQuestions(u) {
    // cycle-23 C23-MAT：mock 按 module 参数过滤——点「资料分析」抽题 → 返回带材料（groupMaterial）的题
    // 语法纪律：json 必须单层（曾因双层嵌套 r.json() 返回内层响应对象 → draw 拿 {} → 题卡消失）
    const qs = [
      // cycle-22 C22-IMG：选项/解析带 kgimg:// 占位——驱动 RichText 出图渲染与图片化选项行
      { no: 1, number: 1, source: 'naoku', module: '判断推理', stem: '深度题库抽题', options: { A: 'a', B: '【图:kgimg://90-图片/题目图/mock-opt-b.png】', C: 'c', D: 'd' }, correctAnswer: 'A', kadian: '考点X', analysis: '解析含图：【图:kgimg://90-图片/公式图/formula-mock.png】请注意变化。' },
      // cycle-23 C23-MAT：资料分析题带材料（统计图表占位）——驱动深度题库材料块渲染
      // cycle-62：材料字段用 groupMaterial（池/卷出站口径）+ material 回落双写
      { no: 2, number: 2, source: 'naoku', module: '资料分析', stem: '2022年彩票月销售额最大的月份是：', options: { A: '甲', B: '乙', C: '丙', D: '丁' }, correctAnswer: 'D', kadian: '比重',
        groupMaterial: '【图:kgimg://90-图片/题目图/mock-material.png】2022年全国彩票销售情况如下：', material: '【图:kgimg://90-图片/题目图/mock-material.png】2022年全国彩票销售情况如下：', materialRef: '6425570 2018-2023年国家铁路旅客运输', analysis: '纯文字解析' },
    ]
    let want = ''
    try { want = decodeURIComponent((u.match(/[?&]module=([^&]*)/) || [])[1] || '') } catch { want = '' }
    const filtered = want ? qs.filter(q => q.module === want) : qs
    // 无命中模块（如 C15 记忆恢复后的「数量关系」）回退全量，保持 C22-IMG 抽到判断推理题
    return { questions: filtered.length ? filtered : qs, count: (filtered.length ? filtered : qs).length, sourceTier: 'pool' }
  }
  // cycle-21 W2 学习画像：stats.mastery（模块正确率）mock——驱动「掌握度」着色模式与图例
  if (u.includes('/api/stats')) return { json: async () => ({
    days: [{ date: '2026-11-14', answered: 10, correct: 6, rate: 60 }], streak: 1, day: 1,
    answered: 10, correct: 6, rate: 60, importedTotal: 0,
    wrong: { open: 2, mastered: 1, total: 3 },
    mastery: { '判断推理': { rate: 55, confidence: 0.5, mastery: 28, answered: 10 }, '资料分析': { rate: 85, confidence: 0.9, mastery: 77, answered: 20 } },
  }) }
  // v1.6 新端点真实形状（cycle-13：papers mock 带 provinces facet ≥3 项，驱动省份 chips 行）
  if (u.includes('/api/papers')) return { json: async () => ({ total: 1683, papers: [{ id: '国考/2009/申论-副省级', exam: '国考', year: 2009, subject: '申论', paperType: '副省级', province: '全国', questionCount: 4, verified: true }], subjects: [{ subject: '申论', count: 944 }, { subject: '行测', count: 739 }], provinces: [{ name: '山东', total: 12, minYear: 2009, maxYear: 2024, subjects: { 申论: 6, 行测: 6 } }, { name: '全国', total: 100, minYear: 2008, maxYear: 2026, subjects: { 申论: 50, 行测: 50 } }, { name: '广东', total: 30, minYear: 2010, maxYear: 2025, subjects: { 申论: 15, 行测: 15 } }] }) }
  if (u.includes('/api/paper?')) return { json: async () => ({ id: 'x', exam: '国考', year: 2009, subject: '申论', paperType: '副省级', materials: [{ no: 1, text: '材料正文' }], questions: [{ no: 1, stem: '题干', score: 20, requirement: '不超过300字', relatedMaterials: '材料1', reference: '参考答案内容' }, { no: 2, type: '单项选择题', module: '判断推理', stem: '行测题干', options: { A: '选项A', B: '选项B', C: '选项C', D: '选项D' }, correctAnswer: 'B', analysis: '解析文本' }] }) }
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
// cycle-62：practice 记忆题升级为**七段全集**（与 /api/pool/questions 出站同形），
// 使「继续上次」这条已确认可用的旅程能验证七段渲染（编号/来源/题型/材料/题干/选项/答案/解析 + 图片）。
globalThis.__kgMemStore = {
  practice: {
    module: '判断推理', at: Date.now() - 60e3,
    question: {
      id: 'q:mock:mem#1', canonicalId: 'q:mock:mem#1',
      no: 1, number: 1,                                       // 0 编号
      source: 'naoku', paperFile: '2024年国考《行测》', region: '国考', year: '2024',  // 1 来源
      type: '逻辑', module: '判断推理',                        // 2 题型
      groupMaterial: '【材料】某市 2018-2023 年铁路旅客运输量变化情况如下表所示。',      // 3 材料
      groupMaterialNo: 1, materialRef: '材料 1',
      stem: '上次的题干（记忆恢复）',                           // 4 题干
      options: { A: 'a1', B: 'b1', C: 'c1', D: 'd1' },        // 5 选项
      correctAnswer: 'B',                                      // 6 答案（池原生字段名）
      analysis: '解析文本',                                    // 7 解析
      dims: { kadian: '判断推理 / 逻辑', reasoning: '推理链文本' },
    },
  },
  tuxing: { cat: 'shuliang', catName: '数量规律', no: 2, idx: 1, at: Date.now() - 120e3 },
  deep: { module: '数量关系', at: Date.now() - 180e3, question: { module: '数量关系', stem: '深度题库上次的题', options: { A: 'x', B: 'y' }, correctAnswer: 'A', kadian: '母题思维' } },
}

try {
  // R11 后 client 是 combo 格式（window.__ModuleLoader__.load）：mock 加载器捕获定义
  const fs = await import('node:fs')
  const combo = fs.readFileSync(new URL('../../dist/client/client.js', import.meta.url), 'utf8')
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
  // captured 为模块级常量（上方声明）
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

} catch (e) { bad("render harness 初始化", e) }

export async function mountPanel() {
  let tr
  await act(async () => { tr = TestRenderer.create(React.createElement(captured.mainComp, { wsKey: "D:/test/ws", t: (k) => k })) })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  const text1 = JSON.stringify(tr.toJSON())
  if (!text1.includes("考公") && !text1.includes("title")) throw new Error("主面板未渲染: " + text1.slice(0, 80))
  // cycle-13 导航重构辅助：进入「专题」枢纽并切换分区（data-kg-hub-tab 是组件内 tab，非路由）
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
  // 安全文本提取防循环引用
  function textOf(children) {
    const arr = Array.isArray(children) ? children : [children]
    for (const c of arr) {
      if (typeof c === 'string') return c
      if (c && c.props) { const t = textOf(c.props.children); if (t) return t }
    }
    return ''
  }
  return { tr, enterHubTab, textOf }
}

export { React, TestRenderer, act }
