/**
 * obs-view.ts — NativeObsView 白盒管理/可观测面板
 * （cycle-13 T-025 从 client.ts 拆出；W2c 升级：能力流三列图 · 量化卡 · 三态灯对账 · 生命周期泳道）
 *
 * 设计原则（继承 + W2c 追加）：
 *  ① 所有接口字段都视为「可选」——端点未就绪/字段缺失一律卡片级降级（显示「暂无数据」），
 *     绝不抛错、绝不渲染 alert 角色降级条（render 测试断言任何视图不得出现该角色）；
 *  ② 三态判定口径 = 相对挂载点的逻辑路径（v1.8 假阳性事故教训：凡「声明 vs 运行态」对账，
 *     两侧口径必须同源——遥测记 /api/graph 而非 /kaogong/api/graph，否则对账 100% 失配）；
 *  ③ SVG 全部手绘（h('svg',…)），零运行时依赖；确定性排序（同输入同输出，无 Math.random）；
 *  ④ 事件一律 onClick 驼峰（R6 事故）；hook 全部在组件顶部、数量恒定（R9 事故）；
 *  ⑤ 本模块顶层声明一律 Obs/OBS 前缀——combo 合并后所有模块共享 factory 单作用域，
 *     顶层名与其他模块（graph 系 / study-view / papers-view）撞名会直接重复声明 SyntaxError。
 */
import { h, React, Stat, Bar, Sparkline, stageColor, alertColor, G_BTN, G_BTN_ON, G_TAG } from './ui-kit.js'

/* ═══════════════ W2c 共享样式：玻璃拟态（与图谱升级风格统一） ═══════════════
   沿用既有 CSS 变量（--surface-card 等）保持深浅色自适应；color-mix 把不透明
   卡面混出 76% 透明度，再叠 backdrop-filter 磨砂——宿主 webview 是 Chromium，
   color-mix/backdrop-filter 均可用（src/ui/app.css 的 .nav 已在用 color-mix）。 */
const OBS_GLASS: any = {
  position: 'relative',
  background: 'color-mix(in srgb, var(--surface-card,#fff) 76%, transparent)',
  backdropFilter: 'blur(10px) saturate(1.35)',
  WebkitBackdropFilter: 'blur(10px) saturate(1.35)',
  borderRadius: 16,
  padding: 18,
  marginBottom: 14,
  border: '1px solid rgba(148,163,184,.22)',
  boxShadow: '0 2px 12px rgba(15,23,42,.07)',
  overflow: 'hidden',
}

/** 渐变大数字（background-clip:text；Chromium 内渲染为渐变字，不支持时退化看下条） */
const obsGradNum = (from: any, to: any): any => ({
  fontSize: 26, fontWeight: 800, lineHeight: 1.2,
  background: 'linear-gradient(135deg,' + from + ',' + to + ')',
  WebkitBackgroundClip: 'text', backgroundClip: 'text',
  color: 'transparent',
})

/** 三态灯语义（注册→生产→消费 的判定结论色板，流动图与对账表共用） */
const OBS_STATE_META: any = {
  ok: { dot: '#10b981', fg: '#059669', bg: 'rgba(16,185,129,.12)', border: '#10b981', label: '正常（已声明 ∧ 已消费）' },
  amber: { dot: '#f59e0b', fg: '#b45309', bg: 'rgba(245,158,11,.14)', border: '#f59e0b', label: '注册未消费（声明 ∧ ¬消费，= reconciliation.unconsumedEndpoints）' },
  red: { dot: '#ef4444', fg: '#dc2626', bg: 'rgba(239,68,68,.14)', border: '#ef4444', label: '未声明/漂移（消费 ∧ ¬声明，= reconciliation.missingProducers）' },
  gray: { dot: '#94a3b8', fg: '#64748b', bg: 'rgba(148,163,184,.14)', border: '#94a3b8', label: '未生产（遥测请求数 = 0）' },
}
/** 三态优先级（聚合胶囊取组内最差态着色：红 > 琥珀 > 绿） */
const OBS_STATE_RANK: any = { red: 0, amber: 1, ok: 2, gray: 3 }

/** 生命周期阶段兜底顺序（life.stages 缺席时仍可画泳道；与 CAPABILITIES.lifecycle 一致） */
const OBS_STAGE_ORDER: string[] = ['load', 'apply', 'server-start', 'tools-register', 'runtime-publish', 'serve', 'cleanup']

/** 事件→阶段映射（客户端镜像 server 的 STAGE_EVENTS 反查表；无法映射归「其他」行）。
 *  注意 server 表里 server-listen 同时喂 server-start 与 runtime-publish 两阶段；
 *  泳道计数取**首个匹配阶段**，避免同一事件在两行被双计。 */
const OBS_EVENT_STAGE: any = {
  load: 'load', 'plugin-load': 'load',
  apply: 'apply', 'plugin-apply': 'apply',
  'server-listen': 'server-start', 'server-listen-probe': 'server-start', 'server-adopt': 'server-start',
  'tools-register': 'tools-register', 'tool-register': 'tools-register',
  'runtime-publish': 'runtime-publish',
  serve: 'serve',
  cleanup: 'cleanup', 'plugin-cleanup': 'cleanup',
}
const obsEventStage = (name: any): string => OBS_EVENT_STAGE[String(name || '')] || '其他'

/** 本地时区日期桶：ISO ts → 'YYYY-MM-DD'（确定性：同输入同输出；无效 ts → null 丢弃） */
function obsLocalDate(ts: any): string | null {
  try {
    const d = new Date(ts)
    if (!d || isNaN(d.getTime())) return null
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  } catch { return null }
}

/** 流动图聚合键：/api/<域> 前缀（如 /api/graph/neighborhood → /api/graph）；非 /api 路径原样成组 */
function obsFlowGroupKey(p: any): string {
  const s = String(p || '')
  const m = /^\/api\/[^/]+/.exec(s)
  return m ? m[0] : (s || '∅')
}
/** 胶囊显示文本：去掉 /api/ 前缀（列头已注明），如 /api/graph/neighborhood → graph/neighborhood */
function obsFlowLabel(p: any): string {
  return String(p || '').replace(/^\/api\//, '') || '∅'
}
/** SVG 文本定长截断（SVG 无自动省略号；9px monospace ≈ 5.4px/字符） */
const obsClip = (s: any, n: number): string => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/** 玻璃拟态区块卡：左侧色条 + 标题行（可挂 extra 徽章/按钮）+ children */
function ObsGlassCard(props: any) {
  const accent = props.accent || '#6366f1'
  return h('div', { style: Object.assign({}, OBS_GLASS) },
    h('i', { style: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 3, background: 'linear-gradient(180deg,' + accent + ' 10%,transparent 95%)' } }),
    props.title
      ? h('div', { style: { fontWeight: 800, fontSize: 13.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          props.title, props.extra || null)
      : null,
    props.children)
}

/* ═══════════════ W2c 量化卡片区（面板顶部四指标卡） ═══════════════
   SLO 达成率 = p95<200ms 端点数 / 有样本端点数；
   错误预算   = 1 − 总错误/总请求（剩余预算百分比，截断 0..100）；
   遥测样本   = 总请求数 + 采样端点数；
   能力健康度 = capabilities 无现成 health 字段（healthScore 只挂在 /api/graph），
                由对账四率派生：H=100×(.30×(1−孤儿率)+.30×(1−未消费率)+.20×(1−漂移率)+.20×(1−错误率))。
   数值缺失 → '—' + 降级说明，绝不报错。 */
function ObsQuantCards(props: any) {
  const tel: any = props.tel || {}
  const caps: any = props.caps || {}
  const eps: any = tel.endpoints || {}
  const list: any[] = Object.keys(eps).map(p => Object.assign({ path: p }, eps[p] || {}))
  const telReady = tel.totalRequests !== undefined || list.length > 0

  const sampled = list.filter(e => (e.count || 0) > 0)
  const sloOk = sampled.filter(e => (e.p95 || 0) < 200)
  const sloPct = telReady && sampled.length ? Math.round((sloOk.length / sampled.length) * 1000) / 10 : null

  const totReq = sampled.reduce((s, e) => s + (e.count || 0), 0)
  const totErr = sampled.reduce((s, e) => s + (e.errors || 0), 0)
  const budget = telReady && totReq > 0 ? Math.round(Math.max(0, Math.min(100, (1 - totErr / totReq) * 100)) * 10) / 10 : null

  const recon: any = caps.reconciliation || {}
  const declaredN = Array.isArray(caps.endpoints) ? caps.endpoints.length : 0
  const consumedN = list.length
  const orphanRate = declaredN ? (Array.isArray(recon.orphanEndpoints) ? recon.orphanEndpoints.length : 0) / declaredN : 0
  const uncRate = declaredN ? (Array.isArray(recon.unconsumedEndpoints) ? recon.unconsumedEndpoints.length : 0) / declaredN : 0
  const driftRate = consumedN ? (Array.isArray(recon.missingProducers) ? recon.missingProducers.length : 0) / consumedN : 0
  const errRateAll = totReq ? totErr / totReq : 0
  const health = declaredN
    ? Math.round(100 * (0.30 * (1 - orphanRate) + 0.30 * (1 - uncRate) + 0.20 * (1 - driftRate) + 0.20 * (1 - errRateAll)) * 10) / 10
    : null

  const cards: any[] = [
    {
      label: 'SLO 达成率', v: sloPct === null ? '—' : sloPct + '%',
      sub: sloPct === null ? '暂无数据（遥测未就绪）' : 'p95<200ms 达标 ' + sloOk.length + ' / 有样本 ' + sampled.length + ' 端点',
      grad: ['#4f46e5', '#8b5cf6'],
    },
    {
      label: '错误预算', v: budget === null ? '—' : budget + '%',
      sub: budget === null ? '暂无数据（遥测未就绪）' : '剩余预算 = 1−错误 ' + totErr + ' / 请求 ' + totReq,
      grad: ['#059669', '#14b8a6'],
    },
    {
      label: '遥测样本', v: !telReady ? '—' : String(tel.totalRequests !== undefined ? tel.totalRequests : totReq),
      sub: !telReady ? '暂无数据（遥测未就绪）' : '采样端点 ' + sampled.length + ' 个 · QPS ' + (tel.qpsWindow || 0),
      grad: ['#0284c7', '#22d3ee'],
    },
    {
      label: '能力健康度', v: health === null ? '—' : String(health),
      sub: health === null ? '暂无数据（/api/capabilities 未就绪）'
        : '孤儿 ' + Math.round(orphanRate * 100) + '% · 未消费 ' + Math.round(uncRate * 100) + '% · 漂移 ' + Math.round(driftRate * 100) + '%',
      grad: ['#c026d3', '#8b5cf6'],
    },
  ]

  return h('div', null,
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(158px,1fr))', gap: 10, marginBottom: 4 } },
      cards.map((c, i) => h('div', {
        key: 'q' + i,
        style: Object.assign({}, OBS_GLASS, { padding: '12px 14px', marginBottom: 0 }),
      },
        h('div', { style: { fontSize: 10.5, color: '#64748b', fontWeight: 700, letterSpacing: '.4px' } }, c.label),
        h('div', { style: obsGradNum(c.grad[0], c.grad[1]) }, c.v),
        h('div', { style: { fontSize: 9.5, color: '#94a3b8', marginTop: 2, lineHeight: 1.5 } }, c.sub)))),
    h('div', { style: { fontSize: 9.5, color: '#94a3b8', margin: '2px 2px 12px', lineHeight: 1.6 } },
      '算法标注：对账图 V/E（O(V+E)）· 密度 ρ=|E|/(V·(V−1)) · PageRank 幂迭代 d=0.85（O(40·E)）· 孤儿=零入度（Union-Find O(V·α)）· ',
      '健康度 H=Σwᵢ·mᵢ（连通.25/活跃.2/延迟.2/错误.15/数据.2，/api/graph 输出）· 量化卡健康度由对账四率派生（.30/.30/.20/.20）'))
}

/* ═══════════════ W2c 能力流三列图（注册 → 生产 → 消费） ═══════════════
   左=注册（manifest 声明端点；漂移端点画成红色虚线幽灵胶囊，对齐三列）；
   中=生产（服务端活跃：遥测请求数>0）；右=消费（遥测触达：telemetry.endpoints 有该路径）。
   三态：绿=声明∧消费；琥珀=声明∧¬消费；红=消费∧¬声明。列间三次贝塞尔链接。
   >40 节点自动折叠为按 /api/<域> 前缀聚合（推荐形态，更现代），点胶囊在明细条展开成员。 */
function ObsFlowChart(props: any) {
  const declared: any[] = Array.isArray(props.declared) ? props.declared : []
  const eps: any = props.eps || {}

  /* ── 节点模型（声明序 + 漂移按字典序追加 → 确定性） ── */
  const declaredSet = new Set(declared.map(d => String(d.path || '')))
  const consumedPaths = Object.keys(eps).sort()
  const consumedSet = new Set(consumedPaths)
  const nodes: any[] = []
  for (const d of declared) {
    const p = String(d.path || '')
    const consumed = consumedSet.has(p)
    nodes.push({ path: p, label: String(d.label || ''), consumers: Array.isArray(d.consumers) ? d.consumers : [], declared: true, produced: consumed, consumed, state: consumed ? 'ok' : 'amber', r: eps[p] || {} })
  }
  for (const p of consumedPaths) {
    if (declaredSet.has(p)) continue
    nodes.push({ path: p, label: '未在 manifest 声明', consumers: [], declared: false, produced: true, consumed: true, state: 'red', r: eps[p] || {} })
  }

  /* ── hooks：全部在顶部、数量恒定（R9）——空数据也先过 hooks 再降级返回 ── */
  const [selKey, setSelKey] = React.useState(null)     // 点击钉选（节点 path 或聚合组 key）
  const [hoverKey, setHoverKey] = React.useState(null) // 悬停瞬态高亮
  const [grouped, setGrouped] = React.useState(null)   // null=自动（>40 折叠聚合）
  const active = hoverKey || selKey

  const amberN = nodes.filter(n => n.state === 'amber').length
  const redN = nodes.filter(n => n.state === 'red').length
  const producedN = nodes.filter(n => n.produced).length
  const consumedN = nodes.filter(n => n.consumed).length

  /* ── 聚合模型（grouped 模式）：/api/<域> 前缀成组，组色取组内最差态 ── */
  const isGrouped = grouped === null ? nodes.length > 40 : grouped
  const groups: any = {}
  const gOrder: string[] = []
  for (const n of nodes) {
    const g = obsFlowGroupKey(n.path)
    if (!groups[g]) { groups[g] = { key: g, members: [], ok: 0, amber: 0, red: 0, produced: 0, consumed: 0, count: 0, p95: 0 }; gOrder.push(g) }
    const G: any = groups[g]
    G.members.push(n)
    if (n.state === 'ok') G.ok++; else if (n.state === 'amber') G.amber++; else G.red++
    if (n.produced) G.produced++
    if (n.consumed) G.consumed++
    G.count += n.r.count || 0
    G.p95 = Math.max(G.p95, n.r.p95 || 0)
  }
  gOrder.sort()
  for (const g of gOrder) { const G: any = groups[g]; G.state = G.red ? 'red' : G.amber ? 'amber' : 'ok' }

  const nodeByPath: any = {}
  for (const n of nodes) nodeByPath[n.path] = n

  /* ── 空数据降级：三列空框架 + 说明文字（不报错） ── */
  if (!nodes.length) {
    return h('div', null,
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 } },
        ['注册（manifest）', '生产（服务端活跃）', '消费（遥测触达）'].map((t, i) => h('div', {
          key: 'ef' + i,
          style: { border: '1.5px dashed rgba(148,163,184,.4)', borderRadius: 12, padding: '26px 8px', textAlign: 'center', fontSize: 11, color: '#94a3b8', background: 'rgba(148,163,184,.05)' },
        }, h('div', { style: { fontWeight: 700, marginBottom: 6 } }, t), h('div', null, '—')))),
      h('div', { style: { fontSize: 11, color: '#94a3b8', marginTop: 10 } },
        '能力/遥测数据不可用（/api/capabilities 或 /api/telemetry 未就绪）—— 服务可用，仅该卡片降级'))
  }

  /* ── 几何布局 ── */
  const colX = [10, 262, 514], nodeW = 190, rowH = 24, capH = 18, topPad = 34
  const leftRows: any[] = isGrouped ? gOrder.map(g => groups[g]) : nodes
  const midRows: any[] = leftRows.filter((x: any) => isGrouped ? x.produced > 0 : x.produced)
  const rightRows: any[] = leftRows.filter((x: any) => isGrouped ? x.consumed > 0 : x.consumed)
  const rowOf = (arr: any[], keyOf: any): any => { const m: any = {}; arr.forEach((x, i) => { m[keyOf(x)] = i }); return m }
  const leftIdx = rowOf(leftRows, (x: any) => x.key || x.path)
  const midIdx = rowOf(midRows, (x: any) => x.key || x.path)
  const rightIdx = rowOf(rightRows, (x: any) => x.key || x.path)
  const yAt = (idx: any) => topPad + idx * rowH + capH / 2
  const svgH = topPad + leftRows.length * rowH + 10
  const midX = colX[1], rightX = colX[2], leftOut = colX[0] + nodeW, midOut = colX[1] + nodeW

  const meta = (s: any) => OBS_STATE_META[s] || OBS_STATE_META.gray
  const isDim = (k: any) => !!active && active !== k   // 有高亮目标时压暗无关节点

  /* 贝塞尔链接（生产链路：左列→中列→右列；漂移链路红色虚线） */
  const link = (x1: any, y1: any, x2: any, y2: any, color: any, dashed: any, emph: any, title: any) => h('path', {
    d: 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + (x2 - x1) * 0.45) + ' ' + y1 + ', ' + (x2 - (x2 - x1) * 0.45) + ' ' + y2 + ', ' + x2 + ' ' + y2,
    fill: 'none', stroke: emph ? '#4f46e5' : color, strokeWidth: emph ? 2.4 : 1.4,
    strokeDasharray: dashed ? '4 3' : undefined, opacity: emph ? 1 : (active ? 0.12 : 0.55),
  }, title ? h('title', null, title) : null)

  /* 胶囊节点（g 包装交互；SVG :hover 描边由注入样式接管） */
  const capsule = (key: any, x: any, y: any, state: any, main: any, tail: any, onClick: any, ghost: any) => {
    const m = meta(state)
    return h('g', {
      key, className: 'kgobs-node', onClick: (e: any) => { try { e.stopPropagation() } catch {} ; onClick() },
      onMouseEnter: () => setHoverKey(key), onMouseLeave: () => setHoverKey(null),
      opacity: isDim(key) ? 0.3 : 1,
    },
      h('rect', {
        x, y, width: nodeW, height: capH, rx: 9,
        fill: m.bg, stroke: m.border, strokeWidth: active === key ? 2.2 : 1.2,
        strokeDasharray: ghost ? '4 3' : undefined,
      }),
      h('circle', { cx: x + 10, cy: y + capH / 2, r: 3, fill: m.dot }),
      h('text', { x: x + 18, y: y + 13, fontSize: 9, fontFamily: 'monospace', fill: m.fg }, obsClip(main, 22)),
      tail ? h('text', { x: x + nodeW - 6, y: y + 13, fontSize: 8.5, fontFamily: 'monospace', fill: '#94a3b8', textAnchor: 'end' }, obsClip(tail, 10)) : null)
  }

  /* 列头（计数徽章 + 漂移/未消费醒目点） */
  const colHead = (x: any, label: any, n: any, warnAmber: any, warnRed: any, key: any) => h('g', { key },
    h('text', { x: x + 2, y: 16, fontSize: 10.5, fontWeight: 800, fill: '#475569' }, label + ' ' + n),
    warnAmber ? h('circle', { cx: x + label.length * 7 + 24, cy: 12, r: 4, fill: '#f59e0b' }, h('title', null, '注册未消费 ' + warnAmber + ' 个')) : null,
    warnRed ? h('circle', { cx: x + label.length * 7 + (warnAmber ? 36 : 24), cy: 12, r: 4, fill: '#ef4444' }, h('title', null, '未声明/漂移 ' + warnRed + ' 个')) : null)

  const items: any[] = []
  items.push(h('style', null,
    '.kgobs-tb tbody tr:hover td{background:rgba(99,102,241,.055)}' +
    '.kgobs-node{cursor:pointer}.kgobs-node:hover rect{stroke-width:2}'))

  /* 底层透明点击板：点击空白清除高亮（节点 onClick 已 stopPropagation） */
  items.push(h('rect', { key: 'bg', x: 0, y: 0, width: colX[2] + nodeW + 10, height: Math.max(svgH, 120), fill: 'transparent', onClick: () => { setSelKey(null); setHoverKey(null) } }))

  items.push(colHead(colX[0], '注册', declared.length, amberN, redN, 'h0'))
  items.push(colHead(colX[1], '生产', producedN, 0, 0, 'h1'))
  items.push(colHead(colX[2], '消费', consumedN, 0, 0, 'h2'))
  items.push(h('text', { key: 'cap', x: colX[2] + nodeW, y: 16, fontSize: 8, fill: '#cbd5e1', textAnchor: 'end' }, '/api/* 逻辑路径'))

  /* 链接层（先画线，节点后画盖在线上） */
  const links: any[] = []
  for (const n of nodes) {
    if (isGrouped) continue
    if (!n.produced) continue
    const emph = !!active && (active === n.path)
    links.push(link(leftOut, yAt(leftIdx[n.path]), midX, yAt(midIdx[n.path]), meta(n.state).dot, n.state === 'red', emph, n.path + ' · ' + meta(n.state).label))
  }
  for (const n of nodes) {
    if (isGrouped) continue
    if (!n.consumed) continue
    const emph = !!active && (active === n.path)
    links.push(link(midOut, yAt(midIdx[n.path]), rightX, yAt(rightRows.length ? rightIdx[n.path] : 0), meta(n.state).dot, n.state === 'red', emph, n.path + ' · 消费触达'))
  }
  for (const g of gOrder) {
    if (!isGrouped) continue
    const G: any = groups[g]
    if (G.produced > 0) {
      const emph = !!active && (active === g)
      links.push(link(leftOut, yAt(leftIdx[g]), midX, yAt(midIdx[g]), meta(G.state).dot, G.state === 'red', emph,
        G.key + ' → 生产 · ' + G.produced + '/' + G.members.length + ' 端点活跃'))
      links.push(link(midOut, yAt(midIdx[g]), rightX, yAt(rightIdx[g]), meta(G.state).dot, G.state === 'red', emph,
        G.key + ' → 消费 · ' + G.consumed + '/' + G.members.length + ' 端点触达'))
    }
  }
  items.push(h('g', { key: 'links' }, links))

  /* 节点层：左列（含漂移幽灵）→ 中列（生产）→ 右列（消费） */
  leftRows.forEach((x: any, i: number) => {
    if (isGrouped) {
      const G: any = groups[x.key]
      items.push(capsule('L' + x.key, colX[0], topPad + i * rowH, G.state, obsFlowLabel(x.key) + ' ·' + G.members.length, (G.amber ? '琥珀' + G.amber + ' ' : '') + (G.red ? '漂移' + G.red : ''), () => setSelKey(k => (k === x.key ? null : x.key)), G.state === 'red' && !G.ok && !G.amber))
    } else {
      items.push(capsule('L' + x.path, colX[0], topPad + i * rowH, x.state, obsFlowLabel(x.path), x.label && x.label !== '未在 manifest 声明' ? x.label : '', () => setSelKey(k => (k === x.path ? null : x.path)), x.state === 'red'))
    }
  })
  midRows.forEach((x: any, i: number) => {
    if (isGrouped) {
      const G: any = groups[x.key]
      items.push(capsule('M' + x.key, colX[1], topPad + i * rowH, G.state, obsFlowLabel(x.key), G.count + '次', () => setSelKey(k => (k === x.key ? null : x.key)), false))
    } else {
      items.push(capsule('M' + x.path, colX[1], topPad + i * rowH, x.state, obsFlowLabel(x.path), (x.r.count || 0) + '次', () => setSelKey(k => (k === x.path ? null : x.path)), false))
    }
  })
  rightRows.forEach((x: any, i: number) => {
    if (isGrouped) {
      const G: any = groups[x.key]
      items.push(capsule('R' + x.key, colX[2], topPad + i * rowH, G.state, obsFlowLabel(x.key), 'p95 ' + G.p95 + 'ms', () => setSelKey(k => (k === x.key ? null : x.key)), false))
    } else {
      items.push(capsule('R' + x.path, colX[2], topPad + i * rowH, x.state, obsFlowLabel(x.path), 'p95 ' + (x.r.p95 || 0) + 'ms', () => setSelKey(k => (k === x.path ? null : x.path)), false))
    }
  })

  /* ── 底部明细条：激活节点/聚合组的端点明细（缺失字段显示 '—'） ── */
  const activeNode = active ? nodeByPath[active] : null
  const activeGroup = !activeNode && active && groups[active] ? groups[active] : null
  const detail: any[] = []
  if (activeNode) {
    const m = meta(activeNode.state)
    const r = activeNode.r || {}
    detail.push(h('div', { key: 'd0', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 } },
      h('span', { style: { background: m.bg, color: m.fg, padding: '2px 8px', borderRadius: 20, fontSize: 9.5, fontWeight: 700 } }, m.label.split('（')[0]),
      h('span', { style: { fontFamily: 'monospace', fontSize: 10.5, color: '#334155' } }, activeNode.path),
      h('span', { style: G_TAG }, '请求 ' + (r.count || 0)),
      h('span', { style: G_TAG }, 'p50 ' + (r.p50 !== undefined ? r.p50 : '—') + 'ms'),
      h('span', { style: G_TAG }, 'p95 ' + (r.p95 !== undefined ? r.p95 : '—') + 'ms'),
      h('span', { style: G_TAG }, '错误率 ' + (r.errRate !== undefined ? (r.errRate * 100).toFixed(1) + '%' : '—')),
      activeNode.consumers.length ? h('span', { style: G_TAG }, '消费者 ' + activeNode.consumers.join(' · ')) : null))
  } else if (activeGroup) {
    const G = activeGroup
    detail.push(h('div', { key: 'g0', style: { fontSize: 10.5, color: '#475569', marginBottom: 4 } },
      h('span', { style: { fontFamily: 'monospace', fontWeight: 700 } }, G.key + '/*'),
      '　' + G.members.length + ' 端点 · 正常 ' + G.ok + ' · 未消费 ' + G.amber + ' · 漂移 ' + G.red))
    detail.push(h('div', { key: 'g1', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      G.members.slice(0, 10).map((n: any) => {
        const m = meta(n.state)
        return h('div', { key: n.path, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 10.5, fontFamily: 'monospace' } },
          h('i', { style: { width: 7, height: 7, borderRadius: '50%', background: m.dot, flex: '0 0 auto' }, title: m.label }),
          h('span', { style: { color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.path),
          h('span', { style: { color: '#94a3b8' } }, (n.r.count || 0) + '次 · p95 ' + (n.r.p95 || 0) + 'ms'))
      }),
      G.members.length > 10 ? h('div', { key: 'more', style: { fontSize: 10, color: '#94a3b8' } }, '… 其余 ' + (G.members.length - 10) + ' 个见下方对账表') : null))
  }

  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
      h('button', {
        onClick: () => setGrouped(v => (v === null ? !(nodes.length > 40) : !v)),
        style: Object.assign({}, G_BTN, (grouped === null ? nodes.length > 40 : grouped) ? G_BTN_ON : {}),
        title: '按 /api/<域> 前缀聚合端点（>40 节点自动启用；点胶囊展开成员）',
      }, '聚合', (grouped === null ? nodes.length > 40 : grouped) ? ' ✓' : ''),
      h('span', { style: { fontSize: 10, color: '#94a3b8' } }, '悬停/点击节点高亮链路并看明细 · 点击空白清除')),
    h('div', { style: { maxHeight: 330, overflowY: 'auto', overflowX: 'auto', borderRadius: 10, background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.14)' } },
      h('svg', { width: '100%', viewBox: '0 0 ' + (colX[2] + nodeW + 10) + ' ' + Math.max(svgH, 120), style: { display: 'block', minWidth: 620 } }, items)),
    detail.length
      ? h('div', { style: { marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.18)' } }, detail)
      : null,
    h('div', { style: { fontSize: 9.5, color: '#94a3b8', marginTop: 6 } },
      '● 正常（声明∧已消费）　● 注册未消费　● 未声明/漂移　· 三态=声明集×遥测集集合运算（口径=相对挂载点逻辑路径）'))
}

/* ═══════════════ W2c 生命周期事件泳道（阶段 × 近 14 天热力） ═══════════════
   行=阶段（无法映射的事件归「其他」行），列=最近 14 天（本地时区 YYYY-MM-DD），
   色深=事件数；当前阶段行高亮描边；hover 经 SVG <title> 显示 阶段+日期+次数。
   events 为空 → 整块隐藏（降级）。纯组件零 hook。 */
function ObsLaneHeat(props: any) {
  const life: any = props && props.life
  const events: any[] = Array.isArray(life && life.events) ? life.events : []
  if (!events.length) return null

  const stageOrder: string[] = (Array.isArray(life && life.stages) ? life.stages : [])
    .map((s: any) => String(s.stage || '')).filter(Boolean)
  if (!stageOrder.length) stageOrder.push(...OBS_STAGE_ORDER)

  /* 14 天日期桶：今天为最后一天，向前 13 天（本地时区，确定性） */
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days: string[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    days.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))
  }
  const dayIdx: any = {}; days.forEach((d, i) => { dayIdx[d] = i })

  const counts: any = {}; let hasOther = false
  for (const ev of events) {
    const st = obsEventStage(ev && ev.event)
    if (st === '其他') hasOther = true
    const d = obsLocalDate(ev && ev.ts)
    if (!d || dayIdx[d] === undefined) continue
    const k = st + '|' + d
    counts[k] = (counts[k] || 0) + 1
  }
  const rows: string[] = stageOrder.slice()
  if (hasOther && rows.indexOf('其他') < 0) rows.push('其他')
  const maxC = Math.max.apply(null, [1].concat(Object.keys(counts).map(k => counts[k])))
  const currentStage = String((life && life.current) || '')

  const cell = 16, gap = 3, labelW = 96, topH = 16
  const gridW = labelW + 14 * (cell + gap) + 12
  const gridH = topH + rows.length * (cell + gap) + 8
  const cells: any[] = []
  rows.forEach((st, r) => {
    const isCur = st === currentStage
    cells.push(h('text', {
      key: 'lb' + st, x: 4, y: topH + r * (cell + gap) + 12,
      fontSize: 9.5, fontWeight: isCur ? 800 : 500, fill: isCur ? '#4f46e5' : '#64748b',
    }, obsClip(st, 11) + (isCur ? ' ●' : '')))
    if (isCur) cells.push(h('rect', { key: 'cur' + st, x: 0, y: topH + r * (cell + gap) - 2, width: gridW - 6, height: cell + 4, rx: 5, fill: 'none', stroke: 'rgba(99,102,241,.4)', strokeWidth: 1 }))
    days.forEach((d, c) => {
      const n = counts[st + '|' + d] || 0
      cells.push(h('rect', {
        key: st + '|' + d, x: labelW + c * (cell + gap), y: topH + r * (cell + gap),
        width: cell, height: cell, rx: 3.5,
        fill: n ? 'rgba(99,102,241,' + (0.24 + 0.66 * (n / maxC)).toFixed(3) + ')' : 'rgba(148,163,184,.10)',
        stroke: n ? 'rgba(99,102,241,.35)' : 'rgba(148,163,184,.14)', strokeWidth: 0.8,
      }, h('title', null, st + ' · ' + d + ' · ' + n + ' 次')))
    })
  })

  return h('div', { style: { marginTop: 4, paddingTop: 10, borderTop: '1px dashed rgba(148,163,184,.25)' } },
    h('div', { style: { fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6 } },
      '🔥 事件泳道 · 阶段 × 近 14 天',
      h('span', { style: { fontWeight: 400, fontSize: 9.5, color: '#94a3b8', marginLeft: 8 } },
        days[0] + ' ~ ' + days[13] + '（本地时区，色深=事件数）')),
    h('svg', { width: '100%', viewBox: '0 0 ' + gridW + ' ' + gridH, style: { display: 'block', maxWidth: gridW } }, cells))
}

/* ═══════════════════════════════════════════════════════════════════════
   NativeObsView — 白盒管理/可观测面板（v1.8.0 重做 + W2c 流动可视化升级）
   区块：量化卡(W2c) · 能力流(W2c) · 告警 · 学习质量 · 运行态 · 生命周期 stepper
        + 事件泳道(W2c) · 能力对账×性能表(三态灯 W2c) · 慢端点 TOP · 命名空间
   ═══════════════════════════════════════════════════════════════════════ */

export function NativeObsView(props) {
  const data: any = (props && props.data) || {}
  const tel: any = data.tel || {}
  const caps: any = data.caps || {}
  const life: any = data.life || null
  const wsList: any[] = Array.isArray(data.workspaces) ? data.workspaces : (Array.isArray(data.wsList) ? data.wsList : [])

  /* ── hooks：全部在顶部声明，跨渲染数量恒定（R9） ── */
  const [sortKey, setSortKey] = React.useState('p95')     // p95 | count | p50 | errRate | path
  const [sortAsc, setSortAsc] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [onlyProblems, setOnlyProblems] = React.useState(false)
  const [triFilter, setTriFilter] = React.useState('all') // W2c 三态筛选：all | abnormal | unconsumed
  const [busy, setBusy] = React.useState(false)
  const [lastAt, setLastAt] = React.useState(null)

  const ins: any = (props && props.insight) || {}
  const eps: any = tel.endpoints || {}
  const consumed = new Set(Object.keys(eps))
  const declared: any[] = Array.isArray(caps.endpoints) ? caps.endpoints : []
  const recon: any = caps.reconciliation || {}
  const orphanEndpoints = new Set(Array.isArray(recon.orphanEndpoints) ? recon.orphanEndpoints : [])
  const unconsumedEndpoints = new Set(Array.isArray(recon.unconsumedEndpoints) ? recon.unconsumedEndpoints : [])
  const missingProducers = Array.isArray(recon.missingProducers) ? recon.missingProducers : []

  /* ── 行数据：声明端点 ∪ 运行态端点（并集，暴露「未声明」影子端点） ── */
  const rows: any[] = React.useMemo(() => {
    const out: any[] = []
    for (const d of declared) {
      const p = String(d.path || '')
      const r: any = eps[p] || {}
      out.push({
        path: p, label: String(d.label || ''), consumers: Array.isArray(d.consumers) ? d.consumers : [],
        count: r.count || 0, errors: r.errors || 0,
        errRate: typeof r.errRate === 'number' ? r.errRate : 0,
        p50: r.p50 || 0, p95: r.p95 || 0, series: r.series || [],
        active: consumed.has(p), orphan: orphanEndpoints.has(p), undeclared: false,
      })
    }
    // 运行态出现但 manifest 未登记的端点 = 绕过单一事实源的调用（白盒断裂证据）
    for (const p of Object.keys(eps)) {
      if (declared.some(d => String(d.path) === p)) continue
      const r: any = eps[p] || {}
      out.push({
        path: p, label: '未在 manifest 声明', consumers: [],
        count: r.count || 0, errors: r.errors || 0, errRate: r.errRate || 0,
        p50: r.p50 || 0, p95: r.p95 || 0, series: r.series || [],
        active: true, orphan: false, undeclared: true,
      })
    }
    return out
  }, [declared, eps, orphanEndpoints, consumed])

  /* ── 过滤（文本 + 仅问题 + W2c 三态）+ 排序（表格视图） ── */
  const viewRows: any[] = React.useMemo(() => {
    let list = rows
    const q = String(filter || '').trim().toLowerCase()
    if (q) list = list.filter(r => (r.path + ' ' + r.label).toLowerCase().includes(q))
    // 「问题」= 真实被调用过且慢/有错误，或绕过 manifest 的未声明端点。
    // 从未被调用的端点 p95=0 属于「未触达」，不是性能问题（否则 40+ 端点全算问题）。
    if (onlyProblems) list = list.filter(r => r.undeclared || (r.count > 0 && (r.p95 > 200 || r.errRate > 0.01)))
    // W2c 三态筛选：异常（漂移/孤儿/慢/错误）· 未消费（声明∧¬消费 的琥珀灯行）
    if (triFilter === 'abnormal') list = list.filter(r => r.undeclared || r.orphan || (r.count > 0 && (r.p95 > 200 || r.errRate > 0.01)))
    else if (triFilter === 'unconsumed') list = list.filter(r => !r.undeclared && !r.active)
    const dir = sortAsc ? 1 : -1
    const copy = [...list]
    copy.sort((a, b) => {
      if (sortKey === 'path') return (sortAsc ? 1 : 1) * (a.path < b.path ? 1 : a.path > b.path ? -1 : 0)
      return dir * (((a[sortKey] || 0) - (b[sortKey] || 0)) || 0)
    })
    return copy
  }, [rows, filter, onlyProblems, triFilter, sortKey, sortAsc])

  const hist: any = tel.histogram || {}
  const alertsRows: any[] = Array.isArray(tel.alerts) ? tel.alerts : []
  const topSlow: any[] = Array.isArray(tel.topSlow) ? tel.topSlow : []
  const stages: any[] = Array.isArray(life && life.stages) ? life.stages : []
  const lifeEvents: any[] = Array.isArray(life && life.events) ? life.events.slice(0, 12) : []

  const essayAvg = (ins.essay && ins.essay.avgRatio) || 0
  const examAvg = (ins.exam && ins.exam.avgRate) || 0
  const essayN = (ins.essay && ins.essay.total) || 0
  const examN = (ins.exam && ins.exam.total) || 0

  const coverage = typeof tel.coverage === 'number' ? tel.coverage : (declared.length ? Object.keys(eps).length / declared.length : 0)
  const problemCount = rows.filter(r => r.undeclared || (r.count > 0 && (r.p95 > 200 || r.errRate > 0.01))).length
  const maxP95 = Math.max.apply(null, [1].concat(rows.map(r => r.p95 || 0)))

  const th: any = { textAlign: 'left', padding: '7px 8px', fontSize: 11, color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(148,163,184,.3)' }
  const thSort: any = { ...th, cursor: 'pointer', userSelect: 'none' }
  const td: any = { padding: '6px 8px', fontSize: 11.5, borderBottom: '1px solid rgba(148,163,184,.12)', verticalAlign: 'middle' }
  const doSort = (key: any) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }
  const sortHead = (key: any, label: any) => h('th', {
    style: Object.assign({}, thSort, { color: sortKey === key ? '#4f46e5' : '#64748b' }),
    onClick: () => doSort(key),
    title: '点击按「' + label + '」排序',
  }, label + (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''))

  /* ── W2c 三态灯：单行三枚判定点（注册 / 生产 / 消费），title 携带判定依据 ── */
  const lamp = (color: any, title: any, key: any) => h('span', { key, title, style: { color, fontSize: 10, lineHeight: 1 } }, '●')
  const lamps = (r: any) => h('span', { style: { display: 'inline-flex', gap: 5, alignItems: 'center' } },
    lamp(r.undeclared ? '#ef4444' : '#10b981', r.undeclared ? '注册：漂移——遥测出现但 manifest 未声明（绕过单一事实源）' : '注册：manifest 已声明', 'lp'),
    lamp(r.count > 0 ? '#10b981' : '#94a3b8', r.count > 0 ? '生产：遥测请求数 ' + r.count + ' > 0' : '生产：零请求（从未被调用）', 'pp'),
    lamp(r.active ? '#10b981' : (r.undeclared ? '#10b981' : '#f59e0b'), r.active ? '消费：telemetry.endpoints 已触达' : (r.undeclared ? '消费：已触达（但未声明）' : '消费：注册未消费——遥测无样本'), 'cp'))

  /* ── 管理动作：刷新 / 导出诊断 / 复制摘要 ── */
  const doRefresh = () => {
    if (busy) return
    setBusy(true)
    try { if (typeof props.onReload === 'function') props.onReload() } catch {}
    setTimeout(() => { setBusy(false); setLastAt(new Date()) }, 500)
  }
  const doExport = () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        plugin: { id: (caps.plugin && caps.plugin.id) || 'kaogong', version: (caps.plugin && caps.plugin.version) || '?' },
        telemetry: {
          uptimeSec: tel.uptimeSec || 0, totalRequests: tel.totalRequests || 0,
          qpsWindow: tel.qpsWindow || 0, coverage, histogram: hist, alerts: alertsRows,
        },
        endpoints: rows.map(r => ({
          path: r.path, label: r.label, count: r.count, errors: r.errors,
          errRate: r.errRate, p50: r.p50, p95: r.p95, active: r.active, orphan: r.orphan, undeclared: r.undeclared,
        })),
        reconciliation: recon,
        lifecycle: life,
        workspaces: wsList,
        insight: ins,
      }
      const text = JSON.stringify(payload, null, 2)
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([text], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'dsh-kaogong-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 800)
      }
    } catch {}
  }
  const doCopy = () => {
    try {
      const summary = rows
        .map(r => [r.path, r.count, 'p50=' + r.p50 + 'ms', 'p95=' + r.p95 + 'ms', 'err=' + (r.errRate * 100).toFixed(1) + '%', r.undeclared ? '未声明' : r.orphan ? '孤儿' : r.active ? '活跃' : '未触达'].join('\t'))
        .join('\n')
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(summary)
    } catch {}
  }
  const mgBtn = (label: any, fn: any, title: any) => h('button', {
    key: label, onClick: fn, title: title || label,
    style: { border: '1px solid rgba(148,163,184,.4)', background: 'rgba(255,255,255,.7)', color: '#475569', borderRadius: 9, padding: '5px 11px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' },
  }, label)

  return h('div', {},
    /* ── 行 hover 高亮样式（React 内联样式写不了 :hover，注入一次作用域样式） ── */
    h('style', null, '.kgobs-tb tbody tr:hover td{background:rgba(99,102,241,.055)}.kgobs-node{cursor:pointer}.kgobs-node:hover rect{stroke-width:2}'),

    /* ── H 管理动作条 ── */
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: '8px 12px', borderRadius: 12, background: 'rgba(148,163,184,.08)', border: '1px solid rgba(148,163,184,.2)' } },
      h('span', { style: { fontWeight: 800, fontSize: 12.5, color: '#334155' } }, '📡 白盒管理面板'),
      h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, '覆盖 ' + (coverage * 100).toFixed(0) + '% · ' + (lastAt ? '刷新于 ' + lastAt.toLocaleTimeString() : '实时')),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' } },
        mgBtn(busy ? '刷新中…' : '↻ 刷新', doRefresh, '重新拉取遥测/能力/生命周期'),
        mgBtn('⤓ 导出诊断', doExport, '下载完整诊断 JSON（仅本机数据，无凭据）'),
        mgBtn('⧉ 复制摘要', doCopy, '复制端点性能表为 TSV，便于贴给模型分析'))),

    /* ── W2c 量化卡片区（面板顶部四指标卡，渐变数字） ── */
    h(ObsQuantCards, { tel, caps }),

    /* ── F 告警区（有告警才出现，避免视觉噪音）── */
    alertsRows.length
      ? h(ObsGlassCard, { title: '🚨 运行告警 · ' + alertsRows.length + ' 条', accent: '#ef4444' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            alertsRows.slice(0, 8).map((a, i) => {
              const c = alertColor(a.level)
              return h('div', { key: 'al' + i, style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', borderRadius: 9, background: c.bg, border: '1px solid ' + c.border } },
                h('span', null, c.icon),
                h('span', { style: { fontSize: 11.5, color: c.fg, lineHeight: 1.6 } }, String(a.msg || '')))
            })))
      : null,

    /* ── W2c 能力流三列图（注册→生产→消费 流动可视化） ── */
    h(ObsGlassCard, {
      title: '🔀 能力流 · 注册→生产→消费',
      accent: '#6366f1',
      extra: h('span', { style: { display: 'inline-flex', gap: 6, alignItems: 'center' } },
        h('span', { style: G_TAG }, '注册 ' + declared.length),
        h('span', { style: G_TAG }, '生产 ' + nodesFilteredCount(eps)),
        h('span', { style: G_TAG }, '消费 ' + Object.keys(eps).length),
        unconsumedEndpoints.size ? h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(245,158,11,.12)', color: '#b45309' }) }, '● 未消费 ' + unconsumedEndpoints.size) : null,
        missingProducers.length ? h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(239,68,68,.12)', color: '#dc2626' }) }, '● 漂移 ' + missingProducers.length) : null),
    }, h(ObsFlowChart, { declared, eps })),

    /* ── A 学习质量 ── */
    h(ObsGlassCard, { title: '📈 我的学习质量', accent: '#10b981' },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 } },
        h(Stat, { v: essayN ? essayAvg + '%' : '—', l: '申论均分率 · ' + essayN + ' 次', color: essayAvg >= 60 ? '#10b981' : '#f59e0b' }),
        h(Stat, { v: examN ? examAvg + '%' : '—', l: '模考均分率 · ' + examN + ' 场', color: examAvg >= 60 ? '#10b981' : '#f59e0b' }),
        h(Stat, { v: (ins.essay && ins.essay.recent && ins.essay.recent.length) || 0, l: '近期申论记录' }),
        h(Stat, { v: (ins.exam && ins.exam.recent && ins.exam.recent.length) || 0, l: '近期模考记录' }))),

    /* ── B 运行态 ── */
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8, marginBottom: 14 } },
      h(Stat, { v: (tel.uptimeSec || 0) + 's', l: '运行时长' }),
      h(Stat, { v: tel.totalRequests || 0, l: '总请求' }),
      h(Stat, { v: tel.qpsWindow || 0, l: 'QPS(60s)' }),
      h(Stat, { v: (coverage * 100).toFixed(0) + '%', l: '端点覆盖', color: coverage > .7 ? '#10b981' : '#f59e0b' }),
      h(Stat, { v: (tel.activeEndpoints || Object.keys(eps).length) + '/' + (tel.declaredEndpoints || declared.length), l: '活跃/声明' }),
      h(Stat, { v: problemCount, l: '问题端点', color: problemCount ? '#ef4444' : '#10b981' }),
      h(Stat, { v: (hist.p95 || 0) + 'ms', l: '全局 p95', color: (hist.p95 || 0) > 200 ? '#f59e0b' : '#10b981' }),
      h(Stat, { v: (hist.max || 0) + 'ms', l: '最慢样本' })),

    /* ── C 生命周期状态机 + W2c 事件泳道 ── */
    h(ObsGlassCard, { title: '🔁 生命周期状态机', accent: '#0ea5e9' },
      stages.length
        ? h('div', null,
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', marginBottom: 12 } },
              stages.map((s, i) => {
                const c = stageColor(s.state)
                return h('div', { key: String(s.stage), style: { display: 'flex', alignItems: 'center' } },
                  h('div', {
                    title: String(s.desc || '') + (s.at ? ' · ' + new Date(s.at).toLocaleTimeString() : ''),
                    style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
                  },
                    h('i', { style: { width: 7, height: 7, borderRadius: '50%', background: c.dot, display: 'inline-block' } }),
                    String(s.stage),
                    s.state === 'done' ? ' ✓' : s.state === 'current' ? ' ●' : ''),
                  i < stages.length - 1 ? h('span', { key: 'ar' + i, style: { color: '#cbd5e1', margin: '0 3px', fontSize: 11 } }, '→') : null)
              })),
            h(ObsLaneHeat, { life }),
            lifeEvents.length
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 190, overflowY: 'auto', marginTop: 8 } },
                  lifeEvents.map((e, i) => h('div', { key: 'ev' + i, style: { display: 'flex', gap: 8, fontSize: 10.5, color: '#64748b', padding: '2px 0', borderBottom: '1px dashed rgba(148,163,184,.15)' } },
                    h('span', { style: { fontFamily: 'monospace', color: '#94a3b8', flex: '0 0 62px' } }, String(e.ts || '').slice(11, 19)),
                    h('span', { style: { fontWeight: 700, color: '#475569' } }, String(e.event || '')),
                    e.port ? h('span', null, ':' + e.port) : null,
                    e.pid ? h('span', null, 'pid ' + e.pid) : null)))
              : null)
        : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '生命周期端点未就绪（/api/lifecycle 未返回 stages）—— 服务可用，仅该卡片降级')),

    /* ── D 能力对账 + E 端点性能表（共用一张表，一屏看全；W2c 三态灯列） ── */
    h(ObsGlassCard, { title: '🧩 能力对账 × 端点性能（注册 → 生产 → 消费）', accent: '#6366f1' },
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, fontSize: 10.5 } },
        h('span', { style: G_TAG }, '声明 ' + declared.length),
        h('span', { style: G_TAG }, '活跃 ' + consumed.size),
        h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(239,68,68,.12)', color: '#dc2626' }) }, '孤儿 ' + orphanEndpoints.size),
        h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(245,158,11,.12)', color: '#b45309' }) }, '未触达 ' + unconsumedEndpoints.size),
        h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(239,68,68,.12)', color: '#dc2626' }) }, '漂移 ' + missingProducers.length),
        h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(16,185,129,.12)', color: '#059669' }) }, '无问题 ' + Math.max(0, declared.length - orphanEndpoints.size))),
      rows.length
        ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9, alignItems: 'center' } },
            h('input', {
              value: filter, placeholder: '过滤端点路径 / 名称…',
              onChange: (e) => setFilter(e && e.target ? e.target.value : ''),
              'aria-label': '过滤端点',
              style: { flex: '1 1 180px', minWidth: 130, padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,.35)', fontSize: 11.5, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'inherit' },
            }),
            h('button', { onClick: () => setOnlyProblems(v => !v), style: Object.assign({}, G_BTN, onlyProblems ? G_BTN_ON : {}) }, onlyProblems ? '✓ 仅问题端点' : '仅问题端点'),
            /* W2c 三态筛选 chips（与三态灯列联动） */
            ['all', 'abnormal', 'unconsumed'].map(k => h('button', {
              key: 'tf' + k, onClick: () => setTriFilter(k),
              style: Object.assign({}, G_BTN, triFilter === k ? G_BTN_ON : {}),
              title: k === 'all' ? '显示全部端点' : k === 'abnormal' ? '漂移/孤儿/慢/错误 端点' : '注册未消费（琥珀灯）端点',
            }, (triFilter === k ? '✓ ' : '') + (k === 'all' ? '全部' : k === 'abnormal' ? '异常' : '未消费'))),
            h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, viewRows.length + ' / ' + rows.length + ' 行'))
        : null,
      rows.length
        ? h('div', { style: { overflowX: 'auto' } },
            h('table', { className: 'kgobs-tb', style: { width: '100%', borderCollapse: 'collapse', minWidth: 700 } },
              h('thead', null, h('tr', null,
                sortHead('path', '端点'),
                h('th', { key: 'lamp', style: th, title: '三态灯：绿=通过 · 琥珀=注册未消费 · 红=漂移/未声明 · 灰=零请求未生产（悬停看点看判定依据）' }, '注册·生产·消费'),
                sortHead('count', '次数'),
                sortHead('p50', 'p50'),
                sortHead('p95', 'p95'),
                sortHead('errRate', '错误率'),
                h('th', { key: 'spark', style: th }, '延迟趋势'),
                h('th', { key: 'st', style: th }, '状态'))),
              h('tbody', null, viewRows.slice(0, 60).map(r => {
                const bad = r.p95 > 200 || r.errRate > 0.01
                const statusBg = r.undeclared ? 'rgba(245,158,11,.15)' : r.orphan ? 'rgba(239,68,68,.15)' : r.active ? 'rgba(16,185,129,.15)' : 'rgba(148,163,184,.15)'
                const statusFg = r.undeclared ? '#b45309' : r.orphan ? '#dc2626' : r.active ? '#059669' : '#64748b'
                const statusText = r.undeclared ? '未声明' : r.orphan ? '孤儿' : r.active ? '活跃' : '未触达'
                return h('tr', { key: r.path, style: { background: bad ? 'rgba(245,158,11,.045)' : 'transparent' } },
                  h('td', { style: Object.assign({}, td, { fontFamily: 'monospace', fontSize: 10.5 }) },
                    h('div', null, r.path),
                    (r.label && r.label !== '未在 manifest 声明')
                      ? h('div', { style: { fontSize: 9.5, color: '#94a3b8', marginTop: 1, fontFamily: 'inherit' } }, r.label + ' · ' + r.consumers.length + ' 消费者')
                      : null),
                  h('td', { style: td }, lamps(r)),
                  h('td', { style: td }, r.count),
                  h('td', { style: Object.assign({}, td, { color: r.p50 > 100 ? '#b45309' : 'inherit' }) }, r.p50 ? r.p50 + 'ms' : '—'),
                  h('td', { style: Object.assign({}, td, { fontWeight: bad ? 800 : 400, color: bad ? '#dc2626' : 'inherit' }) }, r.p95 ? r.p95 + 'ms' : '—'),
                  h('td', { style: Object.assign({}, td, { color: r.errRate > 0.01 ? '#dc2626' : '#94a3b8' }) }, r.errRate ? (r.errRate * 100).toFixed(1) + '%' : '0%'),
                  h('td', { style: td }, h(Sparkline, { series: r.series, color: bad ? '#ef4444' : '#6366f1' })),
                  h('td', { style: td }, h('span', { style: { background: statusBg, color: statusFg, padding: '2px 8px', borderRadius: 20, fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' } }, statusText)))
              }))))
        : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '能力矩阵未就绪（/api/capabilities 未返回 endpoints）—— 服务可用，仅该卡片降级')),

    /* ── E 慢端点 TOP（性能优先级直读） ── */
    topSlow.length
      ? h(ObsGlassCard, { title: '🐌 慢端点 TOP（p95 降序）', accent: '#f59e0b' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            topSlow.slice(0, 6).map(r => h('div', { key: String(r.path), style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 } },
              h('span', { style: { flex: '0 0 auto', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 10.5 } }, String(r.path)),
              h('div', { style: { flex: 1 } }, h(Bar, { pct: Math.min(100, Math.round(((r.p95 || 0) / maxP95) * 100)), color: (r.p95 || 0) > 200 ? 'linear-gradient(135deg,#ef4444,#f87171)' : undefined })),
              h('span', { style: { flex: '0 0 66px', textAlign: 'right', color: '#64748b', fontSize: 10.5 } }, (r.p95 || 0) + 'ms · ' + (r.count || 0) + '次')))))
      : null,

    /* ── G 命名空间清单 ── */
    h(ObsGlassCard, { title: '🗂 工作区命名空间 · ' + wsList.length + ' 个', accent: '#8b5cf6' },
      wsList.length
        ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 170, overflowY: 'auto' } },
            wsList.slice(0, 40).map((w, i) => h('span', {
              key: String(w.ns || w.label || i),
              title: '答题 ' + (w.answered || 0) + ' · 正确率 ' + (w.rate || 0) + '%',
              style: Object.assign({}, G_TAG, { fontFamily: 'monospace', fontSize: 10 }),
            }, String(w.ns || w.label || '?') + ' · D' + (w.day || 1) + ' · ' + (w.answered || 0) + '题')))
        : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '命名空间端点未就绪（/api/workspaces）—— 服务可用，仅该卡片降级')),

    /* ── 白盒口径说明 ── */
    h('div', { style: { fontSize: 10.5, color: '#94a3b8', lineHeight: 1.8, marginTop: 4 } },
      '口径：p50/p95 = 每端点最近 100 次请求的环形样本百分位；覆盖 = 运行态被触达端点数 / 声明端点数；',
      '孤儿 = 声明了但能力图上无人消费（矩阵断裂点）；「未声明」= 运行态出现但 manifest 未登记（绕过单一事实源的证据）；',
      '三态 = 声明集 × 遥测集 的集合运算（绿=声明∧消费 · 琥珀=声明∧¬消费 · 红=消费∧¬声明），与 reconciliation 口径一致；',
      '量化卡：SLO=p95<200ms 占比 · 错误预算=1−Σerr/Σreq · 健康度=对账四率加权派生（cap 无现成 health 字段时不读 /api/graph，保持单端点数据源）。'))
}

/** 生产列计数徽章辅助：遥测请求数 >0 的端点数（W2c「生产」判定口径） */
function nodesFilteredCount(eps: any): number {
  let n = 0
  for (const p of Object.keys(eps || {})) { const e: any = (eps || {})[p]; if (e && (e.count || 0) > 0) n++ }
  return n
}
