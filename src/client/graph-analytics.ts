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

    /** 本地 PageRank（幂迭代 d=0.85）：服务端 rank 只有 top12，抽屉需要任意节点值 */
    function graphLocalPageRank(nodes: any[], edges: any[]): any {
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

    /** 空引擎（画布不可用 / 2D 上下文缺失时的静默降级桩，方法齐全便于组件无脑调用） */
    export function graphEngineStub(): any {
      return {
        ok: false,
        kick() {}, requestDraw() {}, destroy() {}, setLayout() {}, setView() {},
        setPath() {}, setFocus() {}, fit() {}, reset() {}, focusNode() {}, resize() {},
      }
    }