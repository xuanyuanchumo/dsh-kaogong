/**
 * graph-analytics.ts — 图谱纯分析工具与语义色板（cycle-13 T-025 从 client.ts 拆出）
 *
 * GRAPH_NODE_META / GRAPH_EDGE_META：图语义降级色板（服务端下发时以服务端为准，
 * 与 manifest 的 NODE_META 同构）；graphHash：FNV-1a 确定性散列（替代 Math.random，
 * 布局可复现）；graphFuzzyIndex：模糊搜索打分；graphLocalPageRank/graphLocalAnalytics：
 * 服务端 analytics 缺席时的本地确定性降级；graphReadPresetLayout/graphReadLayers：
 * 服务端布局/层级字段读取；graphEngineStub：canvas 不可用时的无操作引擎壳。
 * 本模块零状态、零 DOM 依赖，可被引擎/物理/视图三方安全共享。
 */

    /* ════════════════════════════════════════════════════════════════════
     * cycle-12 · 原生交互式图谱（Canvas 2D 力导向）
     * 契约 §3：真交互（缩放/平移/拖节点 pin/hover/选中详情/搜索/类型过滤/
     * 布局切换/路径分析/自适应/降级）。R9：本视图仍是 props.data 驱动的真组件，
     * 全部 hook 写在组件顶部、数量跨渲染恒定；事件一律 onClick 驼峰。
     *
     * 【与服务端并行开发的兼容策略】task-1 追加的 nodeMeta / edgeMeta /
     * analytics / layout 字段在本文件里**全部按可选消费**：
     *   · 无 nodeMeta / edgeMeta → 用下方 GRAPH_NODE_META / GRAPH_EDGE_META 降级常量；
     *   · 无 analytics → 本地算 degree / 连通分量 / 标签传播社区 / 集聚系数 / PageRank；
     *   · 无 layout → 确定性圆环初始化（hash(id) 抖动，绝不用 Math.random，保证可复现）；
     *   · 无 nodes / edges（旧路由或 render mock）→ 友好空态，且不渲染 role="alert"。
     * ════════════════════════════════════════════════════════════════════ */

    /** 节点类型元数据降级副本（与服务端 NODE_META 同构；服务端下发时以服务端为准） */
    export const GRAPH_NODE_META: any = {
      plugin: { label: '插件', color: '#6366f1', icon: '📦', layer: 0 },
      lifecycle: { label: '生命周期', color: '#0ea5e9', icon: '🔁', layer: 1 },
      entry: { label: '入口', color: '#8b5cf6', icon: '🚪', layer: 1 },
      channel: { label: '通道', color: '#14b8a6', icon: '🔌', layer: 1 },
      view: { label: '视图', color: '#f59e0b', icon: '🖥', layer: 2 },
      endpoint: { label: '端点', color: '#3b82f6', icon: '🔗', layer: 2 },
      tool: { label: '工具', color: '#ec4899', icon: '🧰', layer: 2 },
      domain: { label: '数据域', color: '#10b981', icon: '🗂', layer: 3 },
      repo: { label: '仓库', color: '#64748b', icon: '📚', layer: 4 },
      module: { label: '模块', color: '#84cc16', icon: '🧩', layer: 5 },
      method: { label: '方法论', color: '#a855f7', icon: '📖', layer: 5 },
      phase: { label: '阶段', color: '#f97316', icon: '📅', layer: 5 },
      day: { label: '日', color: '#94a3b8', icon: '·', layer: 6 },
    }
    /** 边类型元数据降级副本（与服务端 EDGE_META 同构） */
    export const GRAPH_EDGE_META: any = {
      contains: { label: '包含', color: '#94a3b8' },
      produces: { label: '生产', color: '#3b82f6' },
      consumes: { label: '消费', color: '#10b981' },
      registers: { label: '注册', color: '#6366f1' },
      serves: { label: '服务', color: '#14b8a6' },
      hosts: { label: '承载', color: '#8b5cf6' },
      next: { label: '下一阶段', color: '#0ea5e9' },
      'consumed-by': { label: '被消费', color: '#f59e0b' },
      feeds: { label: '喂给', color: '#84cc16' },
    }

    /** 字符串 → [0,1) 的确定性散列（FNV-1a；替代 Math.random，保证布局可复现） */
    export function graphHash(s: any) {
      const str = String(s == null ? '' : s)
      let hv = 2166136261 >>> 0
      for (let i = 0; i < str.length; i++) { hv ^= str.charCodeAt(i); hv = Math.imul(hv, 16777619) }
      return ((hv >>> 0) % 100000) / 100000
    }
    export function graphClamp(v: any, lo: any, hi: any) { return v < lo ? lo : v > hi ? hi : v }

    /** 模糊匹配：先子串，再子序列；命中返回权重（越小越靠前），未命中 -1 */
    export function graphFuzzyIndex(hay: string, needle: string) {
      if (!needle) return -1
      const direct = hay.indexOf(needle)
      if (direct >= 0) return direct
      let pos = 0
      for (let i = 0; i < needle.length; i++) {
        const at = hay.indexOf(needle[i], pos)
        if (at < 0) return -1
        pos = at + 1
      }
      return 999
    }

    /** 本地 PageRank（幂迭代 d=0.85）：服务端 rank 只有 top12，着色/抽屉需要任意节点值
     *  （W2b 起导出：着色模型 pagerank 模式的全量分数来源） */
    export function graphLocalPageRank(nodes: any[], edges: any[]): any {
      const out: any = {}
      try {
        const n = nodes.length
        if (!n) return out
        const D = 0.85
        const pr: any = {}, adj: any = {}
        for (const x of nodes) { pr[x.id] = 1 / n; adj[x.id] = [] }
        for (const e of edges) { if (adj[e.source] && pr[e.target] !== undefined) adj[e.source].push(e.target) }
        for (let it = 0; it < 24; it++) {
          let dangling = 0
          for (const x of nodes) if (!adj[x.id].length) dangling += pr[x.id]
          const next: any = {}
          for (const x of nodes) next[x.id] = (1 - D) / n + D * (dangling / n)
          for (const x of nodes) {
            const share = pr[x.id] / (adj[x.id].length || 1)
            for (const t of adj[x.id]) if (next[t] !== undefined) next[t] += D * share
          }
          for (const x of nodes) pr[x.id] = next[x.id]
        }
        return pr
      } catch { return out }
    }

    /**
     * 本地图分析降级实现（analytics 缺失时使用）：
     * degree / 连通分量（迭代并查集，无递归）/ 孤儿 / 标签传播社区 / 平均集聚系数 / PageRank。
     * 全部确定性（索引序 + 字典序），同输入两次输出深相等。
     */
    export function graphLocalAnalytics(nodes: any[], edges: any[]): any {
      const empty = { degree: {}, density: 0, components: 0, orphans: [] as any[], communities: [] as any[], clustering: { avg: 0 }, pagerank: {} }
      try {
        const list = (Array.isArray(nodes) ? nodes : []).filter(x => x && x.id)
        const es = (Array.isArray(edges) ? edges : []).filter(e => e && e.source && e.target)
        const degree: any = {}, adj: any = {}
        for (const n of list) { degree[n.id] = { in: 0, out: 0, total: 0 }; adj[n.id] = new Set() }
        for (const e of es) {
          if (!degree[e.source] || !degree[e.target]) continue
          degree[e.source].out++; degree[e.target].in++
          adj[e.source].add(e.target); adj[e.target].add(e.source)
        }
        for (const id of Object.keys(degree)) degree[id].total = degree[id].in + degree[id].out
        const V = list.length, E = es.length
        // 连通分量
        const parent: any = {}
        for (const n of list) parent[n.id] = n.id
        const find = (x: any) => { let r = x; while (parent[r] !== r) r = parent[r]; while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx } return r }
        for (const e of es) {
          if (parent[e.source] === undefined || parent[e.target] === undefined) continue
          const a = find(e.source), b = find(e.target)
          if (a !== b) parent[a] = b
        }
        const roots = new Set()
        for (const n of list) roots.add(find(n.id))
        // 孤儿（度 0）
        const orphans = list.filter(n => (degree[n.id] || {}).total === 0).map(n => n.id)
        // 社区：标签传播（索引序 + 平票取字典序最小标签，确定性）
        const label: any = {}
        for (const n of list) label[n.id] = String(n.id)
        for (let it = 0; it < 20; it++) {
          let changed = false
          for (const n of list) {
            const cnt: any = {}
            adj[n.id].forEach((nb: any) => { const l = label[nb]; cnt[l] = (cnt[l] || 0) + 1 })
            let best = label[n.id], bestC = 0
            const keys = Object.keys(cnt).sort()
            for (const k of keys) if (cnt[k] > bestC) { best = k; bestC = cnt[k] }
            if (best !== label[n.id]) { label[n.id] = best; changed = true }
          }
          if (!changed) break
        }
        const groups: any = {}
        for (const n of list) { const l = label[n.id]; (groups[l] = groups[l] || []).push(n.id) }
        const communities = Object.keys(groups).sort().map(id => ({ id, size: groups[id].length, members: groups[id] }))
          .sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1))
        // 平均集聚系数（无向；度 <2 记 0）
        let sum = 0
        for (const n of list) {
          const nb = Array.from(adj[n.id]) as any[]
          const k = nb.length
          if (k < 2) continue
          let links = 0
          for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if (adj[nb[i]].has(nb[j])) links++
          sum += (2 * links) / (k * (k - 1))
        }
        return {
          degree,
          density: V > 1 ? +(E / (V * (V - 1))).toFixed(4) : 0,
          components: roots.size,
          orphans,
          communities,
          clustering: { avg: V ? +(sum / V).toFixed(4) : 0 },
          pagerank: graphLocalPageRank(list, es),
        }
      } catch { return empty }
    }

    /** 读取服务端预置布局：兼容 {id:{x,y}} / {nodes:{...}} / {id:{...}} 三种形态 */
    export function graphReadPresetLayout(raw: any) {
      try {
        const l = raw && raw.layout
        if (!l || typeof l !== 'object') return null
        if (l.nodes && typeof l.nodes === 'object') return l.nodes
        let found = false
        for (const k of Object.keys(l)) {
          const v = l[k]
          if (v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number') { found = true; break }
        }
        return found ? l : null
      } catch { return null }
    }
    /** 读取服务端分层结果：analytics.layers.layer（id→层号） */
    export function graphReadLayers(raw: any) {
      try {
        const an = raw && raw.analytics
        const l = an && an.layers
        if (l && l.layer && typeof l.layer === 'object') return l.layer
        return null
      } catch { return null }
    }

    /* ══ cycle-13 W2b · 着色模式支持（确定性纯函数族：视图 useMemo 一次计算 O(V)，
     *    引擎每帧只查表，不做重计算）══ */

    /** 连续指标五停色渐变带（低 → 高；线性 RGB 插值，确定性；#6366f1→#22d3ee→#34d399→#f59e0b→#ef4444） */
    export const GRAPH_SEQ_STOPS = ['#6366f1', '#22d3ee', '#34d399', '#f59e0b', '#ef4444']
    /** 社区定性色板（12 色循环；按社区在 communities 数组中的确定性序取色） */
    export const GRAPH_COMMUNITY_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#0ea5e9', '#8b5cf6', '#f97316', '#14b8a6', '#ef4444', '#84cc16', '#a855f7', '#64748b']
    /** 着色模式描述（控制条胶囊与提示文案共用；id 与视图 state 一一对应） */
    export const GRAPH_COLOR_MODES = [
      { id: 'type', label: '类型', tip: '按节点类型着色（默认）' },
      { id: 'community', label: '社区', tip: '按标签传播社区着色（12 色循环）' },
      { id: 'pagerank', label: 'PageRank', tip: '按 PageRank 分数渐变着色' },
      { id: 'betweenness', label: '中介', tip: '按中介中心性渐变着色' },
      { id: 'degree', label: '度', tip: '按节点度数渐变着色' },
      // cycle-21 W2 学习画像叠加（T-026）：模块掌握率弱→强渐变；模块/端点/视图三类节点生效
      { id: 'mastery', label: '掌握度', tip: '按「我的模块正确率」弱→强着色（红=弱区）' },
    ]

    /** hex → [r,g,b]（解析失败返回 null，调用方必须兜底；不抛错） */
    function graphParseHex(hex: any) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
      if (!m) return null
      const v = parseInt(m[1], 16)
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
    }
    /** 颜色明暗调整：f>0 向白混合（提亮高光），f<0 向黑混合（压暗边缘）；纯计算，确定性 */
    export function graphShade(hex: any, f: any) {
      const rgb = graphParseHex(hex)
      if (!rgb) return String(hex || '#94a3b8')
      const k = graphClamp(Number(f) || 0, -1, 1)
      const mix = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))
      return '#' + rgb.map(c => graphClamp(mix(c), 0, 255).toString(16).padStart(2, '0')).join('')
    }
    /** 连续指标 → 渐变色（t ∈ [0,1]，越界收敛；确定性） */
    export function graphSeqColor(t: any) {
      const x = graphClamp(Number(t) || 0, 0, 1)
      const n = GRAPH_SEQ_STOPS.length - 1
      const seg = Math.min(n - 1, Math.floor(x * n))
      const f = x * n - seg
      const a = graphParseHex(GRAPH_SEQ_STOPS[seg]), b = graphParseHex(GRAPH_SEQ_STOPS[seg + 1])
      if (!a || !b) return GRAPH_SEQ_STOPS[seg]
      return '#' + a.map((c, i) => Math.round(c + (b[i] - c) * f).toString(16).padStart(2, '0')).join('')
    }

    /**
     * 本地 Brandes 介数中心性（无向、无权）—— O(V·E)，V=600/E=2k 量级毫秒级。
     * 服务端 analytics.betweenness 只下发 top20（不足以给全部节点着色），视图切到
     * 「中介」模式时用本函数全量补齐；实现确定性（id 字典序 + 邻接升序）。
     * @returns {[id]: score} 归一化 0..1（与 manifest 版同口径：除以 ((V-1)(V-2)/2)）
     */
    export function graphLocalBetweenness(nodes: any[], edges: any[]): any {
      const out: any = {}
      try {
        const list = (Array.isArray(nodes) ? nodes : []).filter(x => x && x.id != null).map(x => String(x.id)).sort()
        const es = (Array.isArray(edges) ? edges : []).filter(e => e && e.source && e.target)
        const adj: any = {}
        for (const id of list) adj[id] = []
        const seen: any = {}
        for (const e of es) {
          const a = String(e.source), b = String(e.target)
          if (!adj[a] || !adj[b] || a === b) continue
          const k = a < b ? a + '|' + b : b + '|' + a   // 无向去重（并行边只计一次）
          if (seen[k]) continue
          seen[k] = true
          adj[a].push(b); adj[b].push(a)
        }
        for (const id of list) adj[id].sort()
        const n = list.length
        if (n < 3) { for (const id of list) out[id] = 0; return out }
        const idx: any = {}
        list.forEach((id, i) => { idx[id] = i })
        const adjIdx: number[][] = list.map(id => adj[id].map((x: any) => idx[x]))
        // TypedArray + 复用前驱表（每源清零重填，零分配抖动）
        const CB = new Float64Array(n), sigma = new Float64Array(n), delta = new Float64Array(n)
        const dist = new Int32Array(n), stack = new Int32Array(n), order = new Int32Array(n)
        const preds: number[][] = new Array(n)
        for (let i = 0; i < n; i++) preds[i] = []
        for (let s = 0; s < n; s++) {
          sigma.fill(0); delta.fill(0); dist.fill(-1)
          for (let i = 0; i < n; i++) preds[i].length = 0
          sigma[s] = 1; dist[s] = 0
          let qh = 0, qt = 0, sp = 0
          order[qt++] = s
          while (qh < qt) {
            const v = order[qh++]
            stack[sp++] = v
            const dv = dist[v] + 1
            for (const w of adjIdx[v]) {
              if (dist[w] < 0) { dist[w] = dv; order[qt++] = w }
              if (dist[w] === dv) { sigma[w] += sigma[v]; preds[w].push(v) }
            }
          }
          while (sp > 0) {
            const w = stack[--sp]
            const sw = sigma[w]
            for (const v of preds[w]) if (sw > 0) delta[v] += (sigma[v] / sw) * (1 + delta[w])
            if (w !== s) CB[w] += delta[w]
          }
        }
        const norm = 1 / (((n - 1) * (n - 2)) / 2)
        for (let i = 0; i < n; i++) {
          const sc = CB[i] * norm
          out[list[i]] = isFinite(sc) ? +sc.toFixed(6) : 0
        }
        return out
      } catch { return out }
    }

    /** 度分布直方图 bins（{deg,count} 按度升序）：服务端 degreeStats 缺席时用本地 degree map 兜底 */
    export function graphDegreeHistogram(degreeMap: any): any[] {
      try {
        const cnt: any = {}
        for (const k of Object.keys(degreeMap || {})) {
          const d = degreeMap[k]
          const t = (d && typeof d.total === 'number') ? d.total : (((d && d.in) || 0) + ((d && d.out) || 0))
          cnt[t] = (cnt[t] || 0) + 1
        }
        return Object.keys(cnt).map(Number).sort((a, b) => a - b).map(deg => ({ deg, count: cnt[deg] }))
      } catch { return [] }
    }

    /**
     * 着色模型（W2b 核心纯函数）：
     *  · type        → null（引擎回退 GRAPH_NODE_META 色板，行为与旧版逐字节一致）
     *  · community   → 12 色定性循环（未入社区 → 灰 #94a3b8）
     *  · pagerank/betweenness/degree → 五停渐变（按 min-max 归一化分数取色）
     * src.boost 开启时连续模式半径随分数 +10%~30% 浮动（纯视觉：不影响 hitTest 与布局）。
     * @returns {colors:{[id]:css色}, radius:{[id]:系数}, legend, min, max} 或 null
     */
    export function graphPaintModel(nodes: any[], mode: any, src: any): any {
      try {
        const m = String(mode || 'type')
        if (m === 'type') return null
        const list = (Array.isArray(nodes) ? nodes : []).filter(x => x && x.id != null)
        const colors: any = {}, radius: any = {}
        if (m === 'community') {
          const comms = Array.isArray(src && src.communities) ? src.communities : []
          const indexOf: any = {}
          comms.forEach((c: any, i: number) => { for (const id of (c && c.members) || []) indexOf[String(id)] = i })
          for (const n of list) {
            const ci = indexOf[String(n.id)]
            colors[String(n.id)] = (ci != null && ci >= 0) ? GRAPH_COMMUNITY_COLORS[ci % GRAPH_COMMUNITY_COLORS.length] : '#94a3b8'
            radius[String(n.id)] = 1
          }
          const items = comms.slice(0, GRAPH_COMMUNITY_COLORS.length).map((c: any, i: number) => ({
            idx: i,
            color: GRAPH_COMMUNITY_COLORS[i % GRAPH_COMMUNITY_COLORS.length],
            count: (c && c.size) || ((c && c.members) || []).length,
          }))
          return { colors, radius, legend: { kind: 'community', items, rest: Math.max(0, comms.length - GRAPH_COMMUNITY_COLORS.length) } }
        }
        // 连续模式：取值表（视图传入的确定性 map）
        let vals: any = null
        if (m === 'pagerank') vals = (src && src.prMap) || {}
        else if (m === 'betweenness') vals = (src && src.btMap) || {}
        else if (m === 'degree') vals = (src && src.degMap) || {}
        else if (m === 'mastery') {
          // cycle-21 W2 学习画像：mastery[模块名].rate（0-100）弱→强。
          // 生效节点 = module:* 与直连视图/端点（掌握率向关联节点透传 0.5 中性值不渲染噪声）。
          const mastery = (src && src.masteryMap) || {}
          const modRate: any = {}
          for (const [name, v] of Object.entries(mastery)) {
            const rate = Number((v as any) && (v as any).rate)
            if (isFinite(rate)) modRate[String(name)] = rate / 100
          }
          const colors: any = {}, radius: any = {}, items: any[] = []
          let covered = 0
          for (const n of list) {
            const nidStr = String(n.id)
            if (nidStr.startsWith('module:')) {
              const name = nidStr.slice('module:'.length)
              const t = modRate[name] != null ? modRate[name] : null
              colors[nidStr] = t != null ? graphSeqColor(1 - t) : '#94a3b8'   // 弱区=红端（t 小 → 1-t 大 → 红）
              radius[nidStr] = 1.15
              if (t != null) covered++
            } else { colors[nidStr] = '#cbd5e1'; radius[nidStr] = 1 }
          }
          // 图例：六模块掌握率红→绿梯度条（与视图热力条同色系语义）
          const mods = Object.keys(modRate)
          if (mods.length) for (const name of mods) items.push({ idx: 0, name, rate: Math.round(modRate[name] * 100) })
          return { colors, radius, legend: { kind: 'mastery', items, covered }, covered }
        }
        else return null
        let min = Infinity, max = -Infinity
        const score: any = {}
        for (const n of list) {
          const v = Number(vals[String(n.id)])
          const sv = isFinite(v) ? v : 0
          score[String(n.id)] = sv
          if (sv < min) min = sv
          if (sv > max) max = sv
        }
        const span = max - min
        for (const n of list) {
          const t = span > 0 ? (score[String(n.id)] - min) / span : 0.5
          colors[String(n.id)] = graphSeqColor(t)
          // 半径浮动：1.10 ~ 1.30（t=0 → +10%，t=1 → +30%；开关关闭时恒 1）
          radius[String(n.id)] = (src && src.boost) ? +(1.1 + 0.2 * t).toFixed(3) : 1
        }
        return { colors, radius, legend: { kind: 'seq', min, max, stops: GRAPH_SEQ_STOPS }, min, max }
      } catch { return null }
    }

    /** 空引擎（画布不可用 / 2D 上下文缺失时的静默降级桩，方法齐全便于组件无脑调用） */
    export function graphEngineStub(): any {
      return {
        ok: false,
        kick() {}, requestDraw() {}, destroy() {}, setLayout() {}, setView() {},
        setPath() {}, setFocus() {}, fit() {}, reset() {}, focusNode() {}, resize() {},
        zoomBy() {}, panTo() {}, getViewport() { return null }, layoutMode() { return 'force' },
      }
    }