/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/**
 * manifest.js — 能力注册清单（单一事实源）+ 图算法
 *
 * 白盒透明化核心：声明插件全部能力的「注册 → 生产 → 消费」映射，
 * server / host 工具 / client 视图三方共用，供 /api/capabilities 与
 * /api/graph 输出连通性分析（孤儿检测、PageRank 中心性、健康度评分）。
 *
 * 数据结构与算法：
 *  - 有向图 G=(V,E)，边类型 contains/produces/consumes/registers
 *  - PageRank 幂迭代 (d=0.85, iter=40, ε=1e-6)：节点重要性
 *  - 图密度 ρ = |E| / (|V|·(|V|-1))：连通紧密度
 *  - 连通分量（弱连通, Union-Find）：孤岛检测
 *  - 健康度 H = Σ wᵢ·mᵢ（加权几何平均→算术平均，可解释）
 */

// ── 能力清单（与 index.js / client.js / ui 实际注册保持同步）──
export const CAPABILITIES = {
  plugin: { id: 'kaogong', name: 'dsh-kaogong', version: '1.8.0', mode: 'offline-first' },

  // 宿主 UI 双入口（client 半注册；图谱与可观测面板消费此声明）
  entries: [
    { id: 'panel', kind: 'left-immersive', slots: ['sidebar.panellist', 'main'], desc: '左栏图标 + 中央全屏原生面板（同源路由渲染）' },
    { id: 'tab', kind: 'right-docked', slots: ['sidebar.right.pane.tab', 'guide'], desc: '右侧边栏标签并排原生面板' },
  ],

  // 传输通道（v1.4：宿主同源为主，独立端口为兜底）
  channels: [
    { id: 'same-origin', via: 'ctx.webServer', mount: '/kaogong', desc: '宿主 GUI 同源路由（零 CORS、无端口依赖）', preferred: true },
    { id: 'standalone', via: 'node:http', mount: '127.0.0.1:8400-8404', desc: '独立回环端口（Electron/降级/测试兜底）', preferred: false },
  ],

  // 生命周期阶段（host 插件从加载到卸载的状态流）
  lifecycle: [
    { stage: 'load', desc: '模块导入' },
    { stage: 'apply', desc: 'apply(ctx) 执行' },
    { stage: 'server-start', desc: 'HTTP 服务绑定/端口发现' },
    { stage: 'tools-register', desc: '4 个 AI 工具注册' },
    { stage: 'runtime-publish', desc: 'runtime.json 信标写入' },
    { stage: 'serve', desc: '稳态服务' },
    { stage: 'cleanup', desc: 'effect 卸载关闭服务' },
  ],

  // 服务端点（生产者）
  endpoints: [
    { path: '/api/status', label: '信标·状态', consumers: ['ui:header', 'client:discovery', 'tool:kaogong_launch', 'tool:kaogong_ai_*'] },
    { path: '/api/banks', label: '题库清单', consumers: ['ui:dashboard'] },
    { path: '/api/modules', label: '模块索引', consumers: ['ui:practice'] },
    { path: '/api/questions', label: '抽题(含SRS)', consumers: ['ui:practice', 'ui:wrongbook'] },
    { path: '/api/check', label: '判分+错题收集', consumers: ['ui:practice', 'ui:wrongbook'] },
    { path: '/api/wrong', label: '错题清单', consumers: ['ui:wrongbook'] },
    { path: '/api/wrong/remove', label: '错题移除', consumers: ['ui:wrongbook'] },
    { path: '/api/stats', label: '学习统计', consumers: ['ui:dashboard', 'ui:wrongbook'] },
    { path: '/api/papers', label: '真题卷列表', consumers: ['ui:papers'] },
    { path: '/api/paper', label: '单卷详情(材料+题+答案)', consumers: ['ui:papers', 'ui:essay'] },
    { path: '/api/topics', label: '专题聚合', consumers: ['ui:topics'] },
    { path: '/api/essay/list', label: '申论题目聚合', consumers: ['ui:essay'] },
    { path: '/api/essay/grade', label: '申论离线评分', consumers: ['ui:essay', 'tool:kaogong_ai_shenlun'] },
    { path: '/api/essay/history', label: '申论历史', consumers: ['ui:essay', 'ui:dashboard'] },
    { path: '/api/essay/article', label: '大作文分档评估', consumers: ['ui:essay'] },
    { path: '/api/paper-img', label: '题目配图服务', consumers: ['ui:papers', 'ui:practice', 'ui:deepbank'] },
    { path: '/api/paper/exam/start', label: '整卷模考开始', consumers: ['ui:exam'] },
    { path: '/api/paper/exam/submit', label: '整卷模考交卷', consumers: ['ui:exam'] },
    { path: '/api/paper/exam/history', label: '模考历史', consumers: ['ui:exam', 'ui:dashboard'] },
    { path: '/api/naoku/status', label: '深度题库状态', consumers: ['ui:deepbank'] },
    { path: '/api/naoku/questions', label: '深度标注抽题', consumers: ['ui:deepbank'] },
    { path: '/api/naoku/kadian', label: '知识点检索', consumers: ['ui:deepbank'] },
    { path: '/api/naoku/practice', label: '按知识点刷题', consumers: ['ui:deepbank'] },
    { path: '/api/naoku-img', label: '深度题库配图服务', consumers: ['ui:deepbank', 'ui:practice'] },
    { path: '/api/naoku/papers', label: '考点→试卷反查', consumers: ['ui:papers', 'ui:topics'] },
    { path: '/api/naoku/categories', label: '考点清单', consumers: ['ui:papers', 'ui:deepbank'] },
    { path: '/api/tuxing/cats', label: '图形推理规律分类', consumers: ['ui:tuxing'] },
    { path: '/api/tuxing/list', label: '图形推理抽题', consumers: ['ui:tuxing'] },
    { path: '/api/tuxing/q', label: '图形推理单题详情', consumers: ['ui:tuxing'] },
    { path: '/api/tuxing-img', label: '图形推理配图', consumers: ['ui:tuxing'] },
    { path: '/api/plan', label: '学习计划', consumers: ['ui:plan'] },
    { path: '/api/search', label: '知识检索', consumers: ['ui:search', 'tool:kaogong_ai_tutor'] },
    { path: '/api/method', label: '方法论', consumers: ['ui:method', 'tool:kaogong_ai_tutor', 'tool:kaogong_ai_shenlun'] },
    { path: '/api/methods', label: '方法论目录', consumers: ['ui:method'] },
    { path: '/api/progress', label: '进度', consumers: ['ui:dashboard', 'ui:plan', 'tool:kaogong_ai_plan'] },
    { path: '/api/graph', label: '图谱数据', consumers: ['ui:graph'] },
    // v1.8 交互式图谱三端点 + 生命周期状态机（白盒链路：client 视图消费）
    { path: '/api/graph/neighborhood', label: '图谱·k跳邻域', consumers: ['ui:graph'] },
    { path: '/api/graph/path', label: '图谱·最短路', consumers: ['ui:graph'] },
    { path: '/api/graph/impact', label: '图谱·影响面', consumers: ['ui:graph'] },
    { path: '/api/lifecycle', label: '生命周期状态机', consumers: ['ui:observability'] },
    { path: '/api/telemetry', label: '遥测', consumers: ['ui:observability'] },
    { path: '/api/capabilities', label: '能力矩阵', consumers: ['ui:observability'] },
    { path: '/api/workspaces', label: '命名空间清单', consumers: ['ui:observability'] },
  ],

  // 宿主 AI 工具（可选消费者，模型增强）
  tools: [
    { name: 'kaogong_launch', class: 'optional-ai', depends: ['/api/status'] },
    { name: 'kaogong_ai_tutor', class: 'optional-ai', depends: ['/api/method', '/api/search'] },
    { name: 'kaogong_ai_plan', class: 'optional-ai', depends: ['/api/progress'] },
    { name: 'kaogong_ai_shenlun', class: 'optional-ai', depends: ['/api/method'] },
    { name: 'kaogong_ai_essay_review', class: 'optional-ai', depends: ['/api/essay/grade', '/api/essay/article', '/api/method'] },
  ],

  // 客户端 UI 视图（消费端）
  views: [
    { id: 'dashboard', label: '仪表盘' },
    { id: 'practice', label: '刷题' },
    { id: 'deepbank', label: '深度题库' },
    { id: 'tuxing', label: '图形推理' },
    { id: 'exam', label: '整卷模考' },
    { id: 'papers', label: '真题卷' },
    { id: 'topics', label: '专题' },
    { id: 'essay', label: '申论' },
    { id: 'wrongbook', label: '错题本' },
    { id: 'plan', label: '学习计划' },
    { id: 'search', label: '知识检索' },
    { id: 'method', label: '方法论' },
    { id: 'graph', label: '知识图谱' },
    { id: 'observability', label: '可观测' },
  ],

  // 数据域（15 仓库 × 模块）
  repos: [
    'xingcezhenti', 'kaogongzhentizhengliu', 'GongkaoNaoku', 'AdministrativeAptitudeTest',
    'NovaForge', 'kaogong-skill', 'sakib', 'developer2gwy', 'gwy-zhenti', 'Exam_Database',
    'qiuzhao-epi-bank', 'xingce-app', 'gk-tuxing', 'civil-exam-agent', 'yunduanqiqu',
  ],
  modules: ['政治理论', '常识判断', '言语理解与表达', '数量关系', '判断推理', '资料分析'],
  methodTopics: ['行测', '申论', '职测', '综应', '公基', '公文', '面试', '时政', '报考', '复盘'],
}

// ── 图构建：邻接表 ──
export function buildGraph({ banks, modules, telemetry, plan }: any = {}) {
  const nodes: any[] = []
  const edges: any[] = []
  const nid = (t, id) => `${t}:${id}`
  const addNode = (t, id, label, meta = {}) => { nodes.push({ id: nid(t, id), type: t, label, ...meta }); return nid(t, id) }
  const addEdge = (s, d, rel, w = 1) => { if (s && d && s !== d) edges.push({ source: s, target: d, rel, w }) }

  const pluginId = addNode('plugin', 'kaogong', 'dsh-kaogong', { version: CAPABILITIES.plugin.version })

  // 生命周期链
  let prev = null
  for (const lc of CAPABILITIES.lifecycle) {
    const id = addNode('lifecycle', lc.stage, lc.stage, { desc: lc.desc })
    addEdge(pluginId, id, 'registers')
    if (prev) addEdge(prev, id, 'next')
    prev = id
  }

  // 视图 → 端点（消费边）
  const viewIds: any = {}
  for (const v of CAPABILITIES.views) viewIds[v.id] = addNode('view', v.id, v.label)
  // 宿主 UI 双入口（左沉浸 / 右并排）
  for (const en of CAPABILITIES.entries || []) {
    const eid = addNode('entry', en.id, `${en.kind}:${en.id}`, { desc: en.desc })
    addEdge(pluginId, eid, 'registers')
    if (en.id === 'tab') addEdge(eid, viewIds['dashboard'], 'hosts')
    if (en.id === 'panel') addEdge(eid, viewIds['graph'], 'hosts')
  }
  // 传输通道（v1.4：同源主 / 独立端口兜底）
  for (const ch of CAPABILITIES.channels || []) {
    const cid = addNode('channel', ch.id, ch.mount, { desc: ch.desc, preferred: !!ch.preferred })
    addEdge(pluginId, cid, 'serves')
    if (ch.id === 'same-origin' && viewIds['dashboard']) addEdge(cid, viewIds['dashboard'], 'hosts')
  }
  const epIds: any = {}
  for (const ep of CAPABILITIES.endpoints) {
    epIds[ep.path] = addNode('endpoint', ep.path, ep.label, { consumers: ep.consumers.length })
    addEdge(pluginId, epIds[ep.path], 'produces')
    // 静态消费关系
    for (const c of ep.consumers) {
      if (c.startsWith('ui:')) {
        const vv = viewIds[c.slice(3)]
        if (vv) addEdge(epIds[ep.path], vv, 'consumed-by')
      }
    }
  }

  // 工具 → 端点
  for (const t of CAPABILITIES.tools) {
    const tid = addNode('tool', t.name, t.name, { class: t.class })
    addEdge(pluginId, tid, 'registers')
    for (const dep of t.depends) addEdge(tid, epIds[dep], 'consumes')
  }

  // 题库数据域
  if (banks && banks.banks) {
    const domain = addNode('domain', 'repos', '本地题库域', { ready: banks.ready, total: banks.total })
    addEdge(pluginId, domain, 'contains')
    for (const [key, info] of entries(banks.banks)) {
      const rid = addNode('repo', key, key, { exists: info.exists, desc: info.desc })
      addEdge(domain, rid, 'contains')
      if (key === 'xingcezhenti') {
        for (const [mname, minfo] of entries((modules && modules.modules) || {})) {
          const mid = addNode('module', mname, mname, { files: minfo.fileCount })
          addEdge(rid, mid, 'contains')
          addEdge(mid, epIds['/api/questions'], 'feeds')
        }
      }
      if (key === 'kaogong-skill') {
        for (const topic of CAPABILITIES.methodTopics) {
          const mtid = addNode('method', topic, topic)
          addEdge(rid, mtid, 'contains')
          addEdge(mtid, epIds['/api/method'], 'feeds')
        }
      }
    }
  }

  // 计划域
  if (plan && plan.phases) {
    const pd = addNode('domain', 'plan', '30天计划', {})
    addEdge(pluginId, pd, 'contains')
    for (const ph of plan.phases) {
      const phid = addNode('phase', ph.name, ph.name, { days: `${ph.startDay}-${ph.endDay}` })
      addEdge(pd, phid, 'contains')
      for (const d of plan.days.filter(x => x.phase === ph.name)) {
        addEdge(phid, addNode('day', 'D' + d.day, 'D' + d.day, { title: d.title }), 'contains')
      }
    }
  }

  return { nodes, edges }
}

// ── PageRank 幂迭代 ──
export function pageRank(nodes, edges, { d = 0.85, iter = 40 } = {}) {
  const n = nodes.length
  if (!n) return {}
  const out: any = {}
  const adj: any = {}
  for (const x of nodes) { out[x.id] = 1 / n; adj[x.id] = [] }
  for (const e of edges) {
    if (adj[e.source] && out[e.target] !== undefined) adj[e.source].push(e.target)
  }
  for (let it = 0; it < iter; it++) {
    let dangling = 0
    for (const x of nodes) if (adj[x.id].length === 0) dangling += out[x.id]
    const next: any = {}
    for (const x of nodes) next[x.id] = (1 - d) / n + d * (dangling / n)
    for (const x of nodes) {
      const share = out[x.id] / (adj[x.id].length || 1)
      for (const t of adj[x.id]) next[t] += d * share
    }
    for (const x of nodes) out[x.id] = next[x.id]
  }
  return out
}

// ── Union-Find 弱连通分量 ──
export function components(nodes, edges) {
  const parent: any = {}
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (const x of nodes) parent[x.id] = x.id
  for (const e of edges) { if (parent[e.source] !== undefined && parent[e.target] !== undefined) union(e.source, e.target) }
  const groups: any = {}
  for (const x of nodes) { const r = find(x.id); (groups[r] = groups[r] || []).push(x.id) }
  return Object.values(groups)
}

// ── 图指标 + 健康度评分 ──
export function graphMetrics(nodes, edges) {
  const V = nodes.length, E = edges.length
  const density = V > 1 ? (E / (V * (V - 1))) : 0
  const degree: any = {}
  for (const x of nodes) degree[x.id] = { in: 0, out: 0 }
  for (const e of edges) {
    if (degree[e.source]) degree[e.source].out++
    if (degree[e.target]) degree[e.target].in++
  }
  // 孤儿：无任何消费/入边的可消费节点（端点/视图/工具）
  const orphans = nodes
    .filter(x => ['endpoint', 'tool', 'view'].includes(x.type))
    .filter(x => (degree[x.id]?.in || 0) === 0)
    .map(x => x.id)
  const comps = components(nodes, edges)
  const rank = pageRank(nodes, edges)
  return { V, E, density: +density.toFixed(4), orphans, components: comps.length, rank }
}

// ── 插件健康度（可解释加权模型）──
// H = w1·连通性 + w2·消费活跃度 + w3·延迟达标率 + w4·(1-错误率) + w5·数据就绪率
export function healthScore({ metrics, telemetry, banks, endpointsCount }: any = {}) {
  const connectivity = metrics.V > 0 ? Math.max(0, 1 - metrics.orphans.length / Math.max(1, metrics.V)) : 0
  const activeRate = metrics.V > 0 ? metrics.density * 10 : 0 // 密度小，放大
  const eps: any = telemetry?.endpoints || {}
  const totalReq = (Object.values(eps) as any[]).reduce((s: number, e: any) => s + (e.count || 0), 0)
  const totalErr = (Object.values(eps) as any[]).reduce((s: number, e: any) => s + (e.errors || 0), 0)
  const errRate = totalReq ? totalErr / totalReq : 0
  const p95All = (Object.values(eps) as any[]).map((e: any) => e.p95 || 0)
  const latencyOk = p95All.length ? p95All.filter(p => p < 200).length / p95All.length : 1
  const dataReady = banks && banks.total ? banks.ready / banks.total : 0
  const W = { connectivity: 0.25, activity: 0.2, latency: 0.2, errors: 0.15, data: 0.2 }
  const H = W.connectivity * Math.min(1, connectivity + activeRate) +
            W.activity * Math.min(1, totalReq > 0 ? 1 : 0.5) +
            W.latency * latencyOk +
            W.errors * (1 - errRate) +
            W.data * dataReady
  return {
    total: +(H * 100).toFixed(1),
    factors: {
      connectivity: +connectivity.toFixed(3),
      requestActivity: totalReq,
      errorRate: +errRate.toFixed(4),
      latencyP95Ok: +latencyOk.toFixed(3),
      dataReady: +dataReady.toFixed(3),
    },
    weights: W,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// cycle-12 图数据层（v1.8.0）：类型元数据 + 交互式图谱分析算法族
//
// 设计约束（docs/design/cycle-12-contract.md §2）：
//  - NODE_META / EDGE_META 是节点/边视觉语义的**单一事实源**，client 视图与
//    /api/graph 同时消费，避免「颜色/标签各写一份」导致的能力矩阵漂移。
//  - 全部算法是**纯函数**：不修改入参（nodes/edges 只读，内部一律复制/索引），
//    输出仅依赖入参内容而与插入顺序无关（必要时字典序排序），因此同输入
//    两次调用结果深相等（可复现，smoke 可断言）。
//  - 节点量级 V≈300-600、E≈1-2k：算法均为 O(V+E) / O(V·E) / O(V·k²) 量级，
//    实测整包 < 20ms；无递归（BFS/显式队列/迭代），不会爆栈。
// ══════════════════════════════════════════════════════════════════════════

/**
 * 节点类型元数据：label 中文名 / color 画布色 / icon 图标 / layer 分层序（0..6）
 * layer 同时作为 layeredLayout 的兜底分层语义（拓扑分层失败时仍可排布）。
 */
export const NODE_META = {
  plugin:    { label: '插件',   color: '#6366f1', icon: '📦', layer: 0 },
  lifecycle: { label: '生命周期', color: '#0ea5e9', icon: '🔁', layer: 1 },
  entry:     { label: '入口',   color: '#8b5cf6', icon: '🚪', layer: 1 },
  channel:   { label: '通道',   color: '#14b8a6', icon: '🔌', layer: 1 },
  view:      { label: '视图',   color: '#f59e0b', icon: '🖥', layer: 2 },
  endpoint:  { label: '端点',   color: '#3b82f6', icon: '🔗', layer: 2 },
  tool:      { label: '工具',   color: '#ec4899', icon: '🧰', layer: 2 },
  domain:    { label: '数据域', color: '#10b981', icon: '🗂', layer: 3 },
  repo:      { label: '仓库',   color: '#64748b', icon: '📚', layer: 4 },
  module:    { label: '模块',   color: '#84cc16', icon: '🧩', layer: 5 },
  method:    { label: '方法论', color: '#a855f7', icon: '📖', layer: 5 },
  phase:     { label: '阶段',   color: '#f97316', icon: '📅', layer: 5 },
  day:       { label: '日',     color: '#94a3b8', icon: '·',  layer: 6 },
}

/** 边类型元数据：label 中文关系名 / color 连线色（图例直接由此渲染） */
export const EDGE_META = {
  contains:    { label: '包含', color: '#94a3b8' },
  produces:    { label: '生产', color: '#3b82f6' },
  consumes:    { label: '消费', color: '#10b981' },
  registers:   { label: '注册', color: '#6366f1' },
  serves:      { label: '服务', color: '#14b8a6' },
  hosts:       { label: '承载', color: '#8b5cf6' },
  next:        { label: '下一阶段', color: '#0ea5e9' },
  'consumed-by': { label: '被消费', color: '#f59e0b' },
  feeds:       { label: '喂给', color: '#84cc16' },
}

// ── 内部工具：无向邻接表（去自环、去重、邻居字典序）──────────────────────
// 确定性基石：所有依赖邻居遍历顺序的算法都走这张表，保证与 edges 的插入
// 顺序无关。复杂度 O(V+E)。不修改入参。
function undirectedAdj(nodes: any[], edges: any[]): Map<string, string[]> {
  const bags = new Map<string, Set<string>>()
  for (const n of nodes) if (n && n.id !== undefined && !bags.has(n.id)) bags.set(n.id, new Set())
  for (const e of edges) {
    if (!e) continue
    const s = e.source, t = e.target
    const a = bags.get(s), b = bags.get(t)
    if (!a || !b || s === t) continue
    a.add(t); b.add(s)
  }
  const adj = new Map<string, string[]>()
  for (const [id, bag] of bags) adj.set(id, [...bag].sort())
  return adj
}

/**
 * 出入度分析 —— O(V+E)。
 * @returns degree: { [id]: {in,out,total} }；stats: 极值/均值/中位数/次数直方图。
 * 直方图按 deg 升序，仅列出实际出现的度数（含 0），便于前端稀疏渲染。
 */
export function degreeAnalysis(nodes: any[] = [], edges: any[] = []) {
  const degree: any = {}
  for (const n of nodes) degree[n.id] = { in: 0, out: 0, total: 0 }
  for (const e of edges) {
    if (!e) continue
    if (degree[e.source]) degree[e.source].out++
    if (degree[e.target]) degree[e.target].in++
  }
  for (const n of nodes) { const d = degree[n.id]; d.total = d.in + d.out }
  const totals = nodes.map(n => degree[n.id].total).sort((a, b) => a - b)
  const sum = totals.reduce((s, x) => s + x, 0)
  const max = totals.length ? totals[totals.length - 1] : 0
  const avg = totals.length ? +(sum / totals.length).toFixed(2) : 0
  const median = !totals.length ? 0
    : totals.length % 2 ? totals[(totals.length - 1) / 2]
    : +((totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2).toFixed(2)
  const counts: any = {}
  for (const t of totals) counts[t] = (counts[t] || 0) + 1
  const histogram = Object.keys(counts).map(Number).sort((a, b) => a - b)
    .map(deg => ({ deg, count: counts[deg] }))
  return { degree, stats: { max, avg, median, histogram } }
}

/**
 * 标签传播社区发现（异步 LPA）—— 最坏 O(maxIter·E)，maxIter≤20。
 * 确定性：节点按 id 字典序扫描、邻居已排序、平票取字典序最小标签，
 * 无随机洗牌；迭代到无变化即提前退出。maxIter 兜底防振荡。
 * @returns [{id,size,members}] —— 按 size 降序、id 字典序；members 升序；
 *          社区 id 取「最小成员 id」，保证 id ∈ members 且全局唯一。
 */
export function labelPropagation(nodes: any[] = [], edges: any[] = [], { maxIter = 20 } = {}) {
  const ids = nodes.map(n => n.id).sort()
  const adj = undirectedAdj(nodes, edges)
  const label = new Map<string, string>()
  for (const id of ids) label.set(id, id)
  let iter = 0
  let changed = true
  while (changed && iter < maxIter) {
    changed = false; iter++
    for (const id of ids) {
      const counts = new Map<string, number>()
      for (const nb of adj.get(id) || []) {
        const lb = label.get(nb)
        counts.set(lb, (counts.get(lb) || 0) + 1)
      }
      if (!counts.size) continue
      // 平票裁决：计数最大且标签字典序最小（排序后取首个达标项）
      let best = null, bestCount = 0
      for (const [lb, c] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
        if (c > bestCount) { best = lb; bestCount = c }
      }
      if (best && best !== label.get(id)) { label.set(id, best); changed = true }
    }
  }
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const lb = label.get(id)
    if (!groups.has(lb)) groups.set(lb, [])
    groups.get(lb).push(id)
  }
  const out = [...groups.values()].map(members => {
    const sorted = members.slice().sort()
    return { id: sorted[0], size: sorted.length, members: sorted }
  })
  out.sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

/**
 * 无向集聚系数（Watts-Strogatz）—— O(V·k²)，k 为平均度（本图 ~5，很快）。
 * c(v) = 2·links(v) / (k·(k-1))，k<2 记 0；avg 只对 k≥2 的节点取平均。
 * @returns {avg, top:[{id,c}]} —— top 按 c 降序 / id 升序，取前 10。
 */
export function clusteringCoefficient(nodes: any[] = [], edges: any[] = []) {
  const adj = undirectedAdj(nodes, edges)
  const ids = [...adj.keys()].sort()
  const nbSets = new Map<string, Set<string>>()
  for (const id of ids) nbSets.set(id, new Set(adj.get(id)))
  const coef: any = {}
  let sum = 0, cnt = 0
  for (const id of ids) {
    const nb = adj.get(id)
    const k = nb.length
    if (k < 2) { coef[id] = 0; continue }
    let links = 0
    for (let i = 0; i < k; i++) {
      const set = nbSets.get(nb[i])
      for (let j = i + 1; j < k; j++) if (set.has(nb[j])) links++
    }
    const c = (2 * links) / (k * (k - 1))
    coef[id] = +c.toFixed(4)
    sum += c; cnt++
  }
  const avg = cnt ? +(sum / cnt).toFixed(4) : 0
  const top = ids.map(id => ({ id, c: coef[id] }))
    .sort((a, b) => b.c - a.c || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 10)
  return { avg, top }
}

/**
 * Brandes 介数中心性（无向、无权）—— O(V·E)，V=600/E=2k 实测 ~20ms。
 * 每源一次 BFS：sigma 记最短路条数、d 记层深；回推按 sigma 比例累加依赖量。
 * 实现细节：节点先映射为整数下标，σ/dist/delta 用 TypedArray，避免每源
 * 重建 O(V) 个 Map/数组（原 Map 版 600 节点实测 320ms，TypedArray 版 ~20ms）。
 * 归一化：无向图除以 ((V-1)(V-2)/2)，score 落在 0..1（极端稠密图 σ 溢出时
 * 该节点记 0，保证输出始终有限可 JSON 化）。
 * @returns [{id,score}] —— 按 score 降序 / id 升序，取前 20。
 */
export function brandesBetweenness(nodes: any[] = [], edges: any[] = []) {
  const adj = undirectedAdj(nodes, edges)
  const ids = [...adj.keys()].sort()
  const n = ids.length
  if (n < 3) return ids.map(id => ({ id, score: 0 }))
  const idx = new Map<string, number>()
  for (let i = 0; i < n; i++) idx.set(ids[i], i)
  const adjIdx: number[][] = ids.map(id => adj.get(id).map(x => idx.get(x)))
  // 前驱表用「CSR 式链表」而非 Array<number[]>：每源零分配、零 GC 抖动。
  // 容量上界 = 邻接表条目总数（每源每条 BFS 边最多贡献 1 个前驱条目）。
  let cap = 0
  for (const a of adjIdx) cap += a.length
  const prevHead = new Int32Array(n)
  const prevFrom = new Int32Array(cap + 1)
  const prevNext = new Int32Array(cap + 1)
  const CB = new Float64Array(n)
  const sigma = new Float64Array(n)
  const delta = new Float64Array(n)
  const dist = new Int32Array(n)
  const stack = new Int32Array(n)
  const order = new Int32Array(n)
  for (let s = 0; s < n; s++) {
    sigma.fill(0); delta.fill(0); dist.fill(-1); prevHead.fill(-1)
    sigma[s] = 1; dist[s] = 0
    let qh = 0, qt = 0, sp = 0, pc = 0
    order[qt++] = s
    while (qh < qt) {
      const v = order[qh++]
      stack[sp++] = v
      const dv = dist[v] + 1
      for (const w of adjIdx[v]) {
        if (dist[w] < 0) { dist[w] = dv; order[qt++] = w }
        if (dist[w] === dv) {
          sigma[w] += sigma[v]
          if (!isFinite(sigma[w])) sigma[w] = 1e300 // 极端稠密图防溢出（保守截断）
          prevFrom[pc] = v; prevNext[pc] = prevHead[w]; prevHead[w] = pc; pc++
        }
      }
    }
    while (sp > 0) {
      const w = stack[--sp]
      const sw = sigma[w]
      let e = prevHead[w]
      while (e !== -1) {
        const v = prevFrom[e]
        if (sw > 0) delta[v] += (sigma[v] / sw) * (1 + delta[w])
        e = prevNext[e]
      }
      if (w !== s) CB[w] += delta[w]
    }
  }
  const norm = 1 / (((n - 1) * (n - 2)) / 2)
  const out: any[] = []
  for (let i = 0; i < n; i++) {
    const score = CB[i] * norm
    out.push({ id: ids[i], score: isFinite(score) ? +score.toFixed(4) : 0 })
  }
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 20)
}

/**
 * Kahn 拓扑最长路径分层 —— O(V+E)。
 * layer(v) = max(layer(前驱)) + 1；入度为 0 的节点为第 0 层。
 * 环内剩余节点（Kahn 无法出队）统一置于 maxLayer+1，保证「分层覆盖全部节点」
 * 这一不变量恒成立（测绘场景覆盖率优先于环内精确深度）。
 * @returns {layer:{[id]:number}, maxLayer}
 */
export function topoLayers(nodes: any[] = [], edges: any[] = []) {
  const ids = nodes.map(n => n.id).sort()
  const inDeg = new Map<string, number>()
  const outAdj = new Map<string, string[]>()
  for (const id of ids) { inDeg.set(id, 0); outAdj.set(id, []) }
  for (const e of edges) {
    if (!e || !inDeg.has(e.source) || !inDeg.has(e.target)) continue
    outAdj.get(e.source).push(e.target)
    inDeg.set(e.target, inDeg.get(e.target) + 1)
  }
  for (const id of ids) outAdj.get(id).sort()
  const layer = new Map<string, number>()
  for (const id of ids) layer.set(id, 0)
  // 初始队列即已按字典序（ids 有序），后续入队顺序由出邻表有序保证 → 确定性
  const queue = ids.filter(id => inDeg.get(id) === 0)
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi]
    for (const w of outAdj.get(v)) {
      if (layer.get(w) < layer.get(v) + 1) layer.set(w, layer.get(v) + 1)
      inDeg.set(w, inDeg.get(w) - 1)
      if (inDeg.get(w) === 0) queue.push(w)
    }
  }
  let maxLayer = 0
  for (const id of ids) maxLayer = Math.max(maxLayer, layer.get(id))
  const leftover = ids.filter(id => inDeg.get(id) > 0)
  if (leftover.length) {
    const tail = maxLayer + 1
    for (const id of leftover) layer.set(id, tail)
    maxLayer = tail
  }
  const out: any = {}
  for (const id of ids) out[id] = layer.get(id)
  return { layer: out, maxLayer }
}

/**
 * 无向 BFS 最短路 —— O(V+E)。
 * @returns {found, path, length}：未找到时 path=[] / length=0；
 *          from===to 视为 found 且 length=0；未知节点直接 not-found。
 */
export function shortestPath(nodes: any[] = [], edges: any[] = [], from: string, to: string) {
  const adj = undirectedAdj(nodes, edges)
  if (!from || !to || !adj.has(from) || !adj.has(to)) return { found: false, path: [], length: 0 }
  if (from === to) return { found: true, path: [from], length: 0 }
  const prev = new Map<string, string>()
  const seen = new Set<string>([from])
  const queue: string[] = [from]
  let found = false
  for (let qi = 0; qi < queue.length && !found; qi++) {
    const v = queue[qi]
    for (const w of adj.get(v)) {
      if (seen.has(w)) continue
      seen.add(w); prev.set(w, v)
      if (w === to) { found = true; break }
      queue.push(w)
    }
  }
  if (!found) return { found: false, path: [], length: 0 }
  const rev: string[] = [to]
  while (rev[rev.length - 1] !== from) rev.push(prev.get(rev[rev.length - 1]))
  const path = rev.reverse()
  return { found: true, path, length: path.length - 1 }
}

/**
 * k 跳邻域（无向）—— O(V+E)。
 * depth 内部 clamp 到 1..3（HTTP 层同样 clamp，双保险）。
 * @returns {center, depth, nodes:[node], edges:[edge]}：nodes 按 id 升序，
 *          edges 为两端都在邻域内的原始边（source,target,rel 三级排序）。
 */
export function neighborhood(nodes: any[] = [], edges: any[] = [], id: string, depth = 1) {
  const d = Math.max(1, Math.min(3, Math.floor(Number(depth) || 1)))
  const adj = undirectedAdj(nodes, edges)
  if (!id || !adj.has(id)) return { center: id, depth: d, nodes: [], edges: [] }
  const seen = new Set<string>([id])
  let frontier: string[] = [id]
  for (let k = 0; k < d; k++) {
    const next: string[] = []
    for (const v of frontier) {
      for (const w of adj.get(v)) {
        if (seen.has(w)) continue
        seen.add(w); next.push(w)
      }
    }
    if (!next.length) break
    frontier = next
  }
  const byId = new Map<string, any>()
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n)
  const ns = [...seen].sort().map(x => byId.get(x))
  const es = edges.filter(e => e && seen.has(e.source) && seen.has(e.target)).slice()
  es.sort((a, b) => {
    if (a.source !== b.source) return a.source < b.source ? -1 : 1
    if (a.target !== b.target) return a.target < b.target ? -1 : 1
    return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
  })
  return { center: id, depth: d, nodes: ns, edges: es }
}

/**
 * 反向可达（影响面）—— O(V+E)。
 * 沿边反向 BFS：谁会因为 node 变化而受影响。dependents 含自身（自反性），
 * 按 id 升序返回，count = dependents.length。
 */
export function reverseReach(nodes: any[] = [], edges: any[] = [], id: string) {
  const ids = nodes.map(n => n.id)
  const known = new Set(ids)
  if (!id || !known.has(id)) return { node: id, dependents: [], count: 0 }
  const radj = new Map<string, string[]>()
  for (const x of ids) radj.set(x, [])
  for (const e of edges) {
    if (!e || !radj.has(e.target) || !radj.has(e.source)) continue
    radj.get(e.target).push(e.source)
  }
  for (const x of ids) radj.get(x).sort()
  const seen = new Set<string>([id])
  const queue: string[] = [id]
  for (let qi = 0; qi < queue.length; qi++) {
    for (const w of radj.get(queue[qi])) {
      if (seen.has(w)) continue
      seen.add(w); queue.push(w)
    }
  }
  // 自反闭包：影响面必须包含被查节点自身（语义 = 「改动此节点会波及的集合」，
  // 该节点本身当然在其中）。原实现返回 strict 反向可达（不含自身），
  // 会让 UI 上的「影响面 count」比实际少 1，且自反性测试失败。
  const dependents = [...seen].sort()
  return { node: id, dependents, count: dependents.length }
}

/**
 * 确定性分层布局（canvas 用）—— O(V+E)。
 * y 轴 = 拓扑层号归一化（单层时 0.5）；x 轴 = 同层内按 id 字典序均匀铺开
 * （同层单节点时居中）。输出坐标全部落在 0..1，宽度/高度归一为 1。
 * @returns {id:{x,y}, width, height}
 */
export function layeredLayout(nodes: any[] = [], edges: any[] = []) {
  const ids = nodes.map(n => n.id).sort()
  if (!ids.length) return { id: {}, width: 1, height: 1 }
  const { layer, maxLayer } = topoLayers(nodes, edges)
  const cols = maxLayer + 1
  const byLayer: string[][] = []
  for (let l = 0; l < cols; l++) byLayer.push([])
  for (const id of ids) byLayer[layer[id]].push(id) // ids 已排序 → 层内天然有序
  const pos: any = {}
  for (let l = 0; l < cols; l++) {
    const arr = byLayer[l]
    const y = cols > 1 ? +(l / (cols - 1)).toFixed(4) : 0.5
    for (let i = 0; i < arr.length; i++) {
      const x = arr.length > 1 ? +(i / (arr.length - 1)).toFixed(4) : 0.5
      pos[arr[i]] = { x, y }
    }
  }
  return { id: pos, width: 1, height: 1 }
}
