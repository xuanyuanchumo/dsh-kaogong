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
  plugin: { id: 'kaogong', name: 'dsh-kaogong', version: '1.7.5', mode: 'offline-first' },

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
