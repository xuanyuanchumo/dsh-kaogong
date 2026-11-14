/**
 * graph-view.ts — NativeGraphView 原生交互图谱视图（cycle-13 T-025 从 client.ts 拆出）
 * 契约 §3：Canvas 2D 力导向 + 搜索/类型过滤/布局切换/路径分析；引擎见 ./graph-engine.ts。
 * W2b 功能升级包：着色模式（类型/社区/PageRank/中介/度）+ 图例卡（节点/边过滤）+
 * 小地图 + 导出 PNG + 布局过渡动画（引擎侧）+ 键盘快捷键 + 度分布直方图 +
 * 空态/加载骨架 + 视觉现代化（精灵渐变/脉冲环/弧线/玻璃拟态）。
 */

import { h, React, entries, Stat, Bar, Card, G_BTN, G_BTN_ON, G_TAG, G_CHIP, MOUNT_PATH } from '../ui-kit.js'
import { createGraphEngine } from '../graph/graph-engine.js'
import { graphKeyCommand } from '../graph/graph-transition.js'
import { graphFetchSubgraph, graphNormalizeNeighborhood, graphDeriveImpact } from '../graph/graph-subgraph.js'
import { graphEngineStub, graphFuzzyIndex, graphLocalAnalytics, graphReadPresetLayout, graphReadLayers, GRAPH_NODE_META, GRAPH_EDGE_META, graphPaintModel, graphLocalBetweenness, graphDegreeHistogram, GRAPH_COLOR_MODES, GRAPH_SEQ_STOPS, graphSeqColor } from '../graph/graph-analytics.js'

    /* ── cycle-15：布局三态序列 + 文案（工具条按钮与键盘 l 键共用同一序列，单一事实源）──
       force=FR 力导向 · layered=Kahn 拓扑分层 · circular=语义环形（NODE_META.layer 层序圆周）。 */
    const KG_LAYOUTS = ['force', 'layered', 'circular']
    const KG_LAYOUT_LABEL: any = { force: '布局：力导向', layered: '布局：分层', circular: '布局：环形' }
    const kgNextLayout = (v: any) => KG_LAYOUTS[(KG_LAYOUTS.indexOf(String(v)) + 1) % KG_LAYOUTS.length]

    /**
     * NativeGraphView — 契约 §3 的原生交互图谱（真组件；hook 数量恒定）。
     * cycle-24 P0-1 取数下沉：props 收窄为 { api, wsKey, statsApi?, onGo? }，
     * /api/graph 与 /api/stats 由视图自治拉取（原 data.g 由父层 Promise.all 下发）。
     * api 必传；statsApi 缺省复用 api；onGo 供节点直达业务视图。
     */
    export function NativeGraphView(props) {
      const liveRef = React.useRef({})
      liveRef.current = { api: props && props.api, wsKey: props && props.wsKey }   // 每次渲染刷新最新 props（供异步回调用）

      /* ── 自治取数（R9：hooks 全部在组件顶部，跨渲染数量恒定） ── */
      const [graphData, setGraphData] = React.useState(null)
      const [statsData, setStatsData] = React.useState(null)
      const [fetchErr, setFetchErr] = React.useState(null)
      const [graphLoading, setGraphLoading] = React.useState(true)
      React.useEffect(() => {
        let cancelled = false
        setGraphLoading(true)
        const apiFn = (props && props.api) || props && (props as any).statsApi
        if (!apiFn) { setFetchErr('api 通道未注入'); setGraphLoading(false); return }
        Promise.all([
          apiFn('/graph'),
          (props.statsApi || apiFn)('/stats').catch(() => null),
        ]).then(([g, st]) => {
          if (cancelled) return
          setGraphData(g || {}); setStatsData(st); setFetchErr(null); setGraphLoading(false)
        }).catch((e: any) => {
          if (!cancelled) { setFetchErr(String((e && e.message) || e)); setGraphLoading(false) }
        })
        return () => { cancelled = true }
      }, [props && props.api, props && props.statsApi])

      const raw: any = graphData || {}
      const nodes: any[] = Array.isArray(raw.nodes) ? raw.nodes : []
      const edges: any[] = Array.isArray(raw.edges) ? raw.edges : []
      const nodeMeta: any = (raw.nodeMeta && typeof raw.nodeMeta === 'object') ? raw.nodeMeta : GRAPH_NODE_META
      const edgeMeta: any = (raw.edgeMeta && typeof raw.edgeMeta === 'object') ? raw.edgeMeta : GRAPH_EDGE_META
      const stats: any = statsData

      /* ── hooks：全部在组件顶部，跨渲染数量恒定（R9） ── */
      const canvasRef = React.useRef(null)
      const wrapRef = React.useRef(null)
      const engineRef = React.useRef(null)
      const searchRef = React.useRef(null)
      const miniRef = React.useRef(null)   // W2b：小地图 canvas（150×100，DPR 感知由引擎负责）
      const aliveRef = React.useRef(true)
      const pathRequestRef = React.useRef(null)

      const [selected, setSelected] = React.useState(null)
      const [layout, setLayout] = React.useState('force')
      const [showLabels, setShowLabels] = React.useState(true)
      const [hiddenTypes, setHiddenTypes] = React.useState(() => new Set())
      const [hiddenEdges, setHiddenEdges] = React.useState(() => new Set())
      const [showOrphans, setShowOrphans] = React.useState(true)
      const [searchQ, setSearchQ] = React.useState('')
      const [searchHit, setSearchHit] = React.useState(0)
      const [pathState, setPathState] = React.useState({ from: null, to: null, path: null, loading: false, error: null })
      const [narrow, setNarrow] = React.useState(false)
      const [canvasOk, setCanvasOk] = React.useState(true)
      const [focusId, setFocusId] = React.useState(null)
      // cycle-29 P1：子图模式（图谱节点按需加载）——服务端 /api/graph/neighborhood（k 跳邻域）
      // 与 /api/graph/impact（反向可达影响面）端点早已声明并实现，但 UI 一直未消费。
      // subData = { kind:'neighborhood'|'impact', center, depth?, label, nodes, edges, idSet }
      // 非空时引擎只渲染子图（全图分析面板/图例保持全图口径；面包屑一键返回全图）。
      const [subData, setSubData] = React.useState(null)
      const [subLoading, setSubLoading] = React.useState(false)
      const [subErr, setSubErr] = React.useState(null)
      // W2b 新增：着色模式 / 半径随指标 / 图例折叠
      const [colorMode, setColorMode] = React.useState('type')
      const [radiusBoost, setRadiusBoost] = React.useState(false)
      const [legendOpen, setLegendOpen] = React.useState(true)
      const [flowOn, setFlowOn] = React.useState(false)   // cycle-15：边流动粒子开关（opt-in，开启期间引擎保持 rAF）

      // 本地降级分析（analytics 缺失时作为唯一事实源；也用于抽屉的任意节点 PageRank）
      const local: any = React.useMemo(() => graphLocalAnalytics(nodes, edges), [nodes, edges])
      const nodeIndex: any = React.useMemo(() => {
        const m: any = {}
        for (const n of nodes) if (n && n.id != null) m[String(n.id)] = n
        return m
      }, [nodes])
      const typeChips: any[] = React.useMemo(() => {
        const seen: any = {}
        for (const n of nodes) if (n && n.type) seen[String(n.type)] = true
        return Object.keys(seen).map(t => ({ type: t, meta: nodeMeta[t] || GRAPH_NODE_META[t] || { label: t, color: '#94a3b8', icon: '•', layer: 0 } }))
          .sort((a, b) => (a.meta.layer || 0) - (b.meta.layer || 0) || String(a.meta.label).localeCompare(String(b.meta.label)))
      }, [nodes, nodeMeta])
      const edgeChips: any[] = React.useMemo(() => {
        const seen: any = {}
        for (const e of edges) if (e && e.rel) seen[String(e.rel)] = true
        return Object.keys(seen).map(r => ({ rel: r, meta: edgeMeta[r] || GRAPH_EDGE_META[r] || { label: r, color: '#94a3b8' } }))
      }, [edges, edgeMeta])
      // W2b：节点/边类型计数（图例卡显示；确定性）
      const typeCounts: any = React.useMemo(() => {
        const m: any = {}
        for (const n of nodes) if (n && n.type) m[String(n.type)] = (m[String(n.type)] || 0) + 1
        return m
      }, [nodes])
      const edgeCounts: any = React.useMemo(() => {
        const m: any = {}
        for (const e of edges) if (e && e.rel) m[String(e.rel)] = (m[String(e.rel)] || 0) + 1
        return m
      }, [edges])
      // W2b：着色模型（useMemo 一次 O(V)；引擎每帧只查表，避免 render 函数内重计算）
      const paint: any = React.useMemo(() => {
        try {
          const an = raw.analytics || {}
          // 度数表：服务端 analytics.degree 优先，缺失用本地降级
          const degSrc = (an.degree && typeof an.degree === 'object') ? an.degree : local.degree
          const degMap: any = {}
          for (const k of Object.keys(degSrc || {})) {
            const d = degSrc[k]
            degMap[k] = (d && typeof d.total === 'number') ? d.total : (((d && d.in) || 0) + ((d && d.out) || 0))
          }
          // 介数表：服务端只下发 top20，不足以全量着色 → 「中介」模式下本地 Brandes 补齐（确定性）
          let btMap: any = null
          if (colorMode === 'betweenness') {
            btMap = {}
            try { for (const it of graphLocalBetweenness(nodes, edges)) btMap[it.id] = it.score } catch { btMap = {} }
          }
          const communities = Array.isArray(an.communities) ? an.communities : local.communities
          // cycle-21 W2 学习画像：mastery 模式把 stats.mastery（模块正确率）传进着色模型
          const masteryMap = colorMode === 'mastery' ? ((stats && stats.mastery) || {}) : {}
          return graphPaintModel(nodes, colorMode, { communities, prMap: local.pagerank, btMap, degMap, boost: radiusBoost, masteryMap })
        } catch { return null }
      }, [raw, nodes, edges, local, colorMode, radiusBoost])
      // W2b：度分布直方图 bins（服务端 degreeStats.histogram 优先，本地兜底；展示前 26 桶）
      const hist: any[] = React.useMemo(() => {
        try {
          const an = raw.analytics
          if (an && an.degreeStats && Array.isArray(an.degreeStats.histogram) && an.degreeStats.histogram.length) {
            return an.degreeStats.histogram.slice(0, 26)
          }
          return graphDegreeHistogram(local.degree).slice(0, 26)
        } catch { return [] }
      }, [raw, local])
      const searchMatches: any[] = React.useMemo(() => {
        const q = String(searchQ || '').trim().toLowerCase()
        if (!q) return []
        const out: any[] = []
        for (const n of nodes) {
          if (!n) continue
          const label = String(n.label == null ? n.id : n.label)
          const hay = (label + ' ' + String(n.id == null ? '' : n.id)).toLowerCase()
          const score = graphFuzzyIndex(hay, q)
          if (score < 0) continue
          out.push({ id: String(n.id), label, score })
        }
        out.sort((a, b) => a.score - b.score || (a.label < b.label ? -1 : 1))
        return out.slice(0, 8)
      }, [searchQ, nodes])
      const metrics: any = React.useMemo(() => {
        try {
          const gm = raw.metrics || {}
          const an = raw.analytics || {}
          const num = (v: any, d: any) => (typeof v === 'number' && isFinite(v)) ? v : d
          return {
            V: num(gm.V, nodes.length),
            E: num(gm.E, edges.length),
            density: num(gm.density, local.density),
            components: num(gm.components, local.components),
            orphans: Array.isArray(gm.orphans) ? gm.orphans.length : local.orphans.length,
            health: (raw.health && typeof raw.health.total === 'number') ? raw.health.total : null,
            communities: Array.isArray(an.communities) ? an.communities.length : local.communities.length,
            clustering: (an.clustering && typeof an.clustering.avg === 'number') ? an.clustering.avg : local.clustering.avg,
          }
        } catch { return { V: nodes.length, E: edges.length, density: 0, components: 0, orphans: 0, health: null, communities: 0, clustering: 0 } }
      }, [raw, nodes, edges, local])

      /* ── 异步回调（组件卸载后不再 setState） ── */
      const requestPath = React.useCallback(async (from: any, to: any) => {
        if (!from || !to || from === to) return
        setPathState({ from, to, path: null, loading: true, error: null })
        try {
          let d: any = null
          const api = liveRef.current && liveRef.current.api
          const qs = '?from=' + encodeURIComponent(String(from)) + '&to=' + encodeURIComponent(String(to))
          if (typeof api === 'function') d = await api('/graph/path' + qs)
          else if (typeof fetch === 'function') {
            const ws = liveRef.current && liveRef.current.wsKey
            const r = await fetch(MOUNT_PATH + '/api/graph/path' + qs + (ws ? '&ws=' + encodeURIComponent(String(ws)) : ''))
            d = await r.json()
          }
          if (!aliveRef.current) return
          if (d && d.found && Array.isArray(d.path) && d.path.length) setPathState({ from, to, path: d.path, loading: false, error: null })
          else setPathState({ from, to, path: null, loading: false, error: '两节点之间暂无无向可达路径' })
        } catch {
          // 静默降级：端点未就绪/网络失败不抛到渲染期，仅给一行灰字提示
          if (aliveRef.current) setPathState({ from, to, path: null, loading: false, error: '路径服务未就绪（已静默降级）' })
        }
      }, [])
      pathRequestRef.current = requestPath

      const locate = React.useCallback((id: any) => {
        setSelected(id == null ? null : String(id))
        try {
          const e = engineRef.current
          if (e && e.ok) e.focusNode(String(id))
        } catch {}
      }, [])

      /* ── cycle-29 P1：子图取数（按需加载；崩溃安全：任何失败收敛为灰字提示）──
         纯函数族外提到 graph-subgraph.ts（cycle-13 教训①拆法：只读外提+参数穿线），
         本处只保留状态编排（setState），O(V+E) 归一化在模块层。 */
      const loadSubgraph = React.useCallback(async (kind: any, id: any, depth: any) => {
        const nid = String(id == null ? '' : id)
        if (!nid || !nid.includes(':')) return   // 节点 id 形如 type:key，防御性只对合规 id 提供
        setSubLoading(true); setSubErr(null)
        try {
          const api = liveRef.current && liveRef.current.api
          const wsKey = liveRef.current && liveRef.current.wsKey
          const d = await graphFetchSubgraph(String(kind), nid, Number(depth) || 1, api, wsKey)
          const norm = String(kind) === 'impact'
            ? graphDeriveImpact(d, nodeIndex, edges)
            : graphNormalizeNeighborhood(d, nodeIndex, Number(depth) || 1)
          if (!aliveRef.current) return
          if (!norm.nodes || !norm.nodes.length) { setSubErr('子图为空（可能是孤儿节点或未知节点）'); setSubLoading(false); return }
          setSubData(norm); setSelected(null); setFocusId(null)
          setSubLoading(false)
        } catch (e: any) {
          if (aliveRef.current) { setSubErr(String((e && e.message) || e)); setSubLoading(false) }
        }
      }, [nodes, edges, nodeIndex])

      /* ── 引擎装配（数据变化即重建；canvas/wrap 缺失时静默降级） ──
         cycle-29 P1：子图模式优先——subData 非空时引擎装配子图（nodes/edges 换源，
         其余配置同构）；返回全图 = subData 置空 → effect 依 [activeNodes, activeEdges] 自动重建。 */
      const activeNodes: any[] = (subData && Array.isArray(subData.nodes) && subData.nodes.length) ? subData.nodes : nodes
      const activeEdges: any[] = (subData && Array.isArray(subData.edges)) ? subData.edges : edges
      React.useEffect(() => {
        aliveRef.current = true
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        let eng: any = null
        try {
          eng = createGraphEngine({
            canvas, wrap, nodes: activeNodes, edges: activeEdges,
            presetLayout: graphReadPresetLayout(raw),
            layers: graphReadLayers(raw),
            nodeMeta, edgeMeta,
            miniCanvas: miniRef.current,   // W2b：小地图 canvas（可能为 null，引擎自行降级）
            onSelect: (id: any) => { try { setSelected(id == null ? null : String(id)) } catch {} },
            onRequestPath: (from: any, to: any) => { try { pathRequestRef.current && pathRequestRef.current(from, to) } catch {} },
          })
        } catch (e) {
          try { console.warn('[kaogong] 图谱引擎初始化失败（已降级为统计视图）:', e) } catch {}
          eng = graphEngineStub()
        }
        engineRef.current = eng
        setCanvasOk(!!(eng && eng.ok))
        return () => {
          aliveRef.current = false
          try { if (eng && eng.destroy) eng.destroy() } catch {}
          engineRef.current = null
        }
      }, [raw, activeNodes, activeEdges])

      // 布局模式同步
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setLayout(layout) } catch {}
      }, [layout])

      // 过滤/标签/选中同步
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setView({ hiddenTypes, hiddenEdges, showOrphans, showLabels, selected }) } catch {}
      }, [hiddenTypes, hiddenEdges, showOrphans, showLabels, selected])

      // W2b：着色模型 / 半径微调同步（引擎按字段级合并语义消费，不踩其他字段）
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setView({ colorModel: paint, radiusBoost }) } catch {}
      }, [paint, radiusBoost])

      // cycle-22 P1：掌握率表同步（tooltip 第三行；与「掌握度」着色模式同口径同数据源）
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        const mm = (stats && stats.mastery) || null
        try { e.setView({ masteryMap: mm }) } catch {}
      }, [statsData])

      // cycle-15：流动粒子开关同步（字段级合并语义；关闭即恢复省电停帧）
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setView({ flowParticles: flowOn }) } catch {}
      }, [flowOn])

      // 路径高亮同步
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setPath(pathState.path || null) } catch {}
      }, [pathState.path])

      // 聚焦（1 跳邻域子图）同步
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setFocus(focusId || null) } catch {}
      }, [focusId])

      // 窄屏检测（<520px：详情抽屉改底部面板，容器高度降到 320）
      React.useEffect(() => {
        const wrap = wrapRef.current
        if (!wrap) return
        let ro: any = null
        const measure = () => {
          try {
            const w = wrap.getBoundingClientRect ? wrap.getBoundingClientRect().width : (wrap.clientWidth || 0)
            if (w > 0) setNarrow(w < 520)
          } catch {}
        }
        try {
          if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(wrap) }
          else if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', measure)
          measure()
        } catch {}
        return () => {
          try { if (ro && ro.disconnect) ro.disconnect() } catch {}
          try { if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', measure) } catch {}
        }
      }, [])

      /* ── 交互处理器（普通函数，非组件，无 hook） ── */
      function toggleType(type: any) {
        setHiddenTypes((prev: any) => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next })
      }
      function toggleEdge(rel: any) {
        setHiddenEdges((prev: any) => { const next = new Set(prev); if (next.has(rel)) next.delete(rel); else next.add(rel); return next })
      }
      function pickSearchResult(id: any, keepQuery?: boolean) {
        // cycle-19 R-GRAPH-1：keepQuery=true 时保留搜索词——「回车循环」体验：
        // 连按 Enter 逐个命中循环定位（searchHit 推进），Esc 或点结果项才收起面板。
        if (!keepQuery) { setSearchQ(''); setSearchHit(0) }
        locate(id)
      }
      function onSearchKey(ev: any) {
        const k = ev && ev.key
        if (k === 'Enter') {
          if (ev.preventDefault) ev.preventDefault()
          if (!searchMatches.length) return
          // 回车循环：首回定位第 1 命中，后续回车按序循环（keepQuery 保留下拉与上下文）
          const nextIdx = searchHit < searchMatches.length - 1 ? searchHit + 1 : 0
          setSearchHit(nextIdx)
          pickSearchResult(searchMatches[nextIdx].id, true)
        } else if (k === 'ArrowDown') {
          if (ev.preventDefault) ev.preventDefault()
          setSearchHit((i: any) => Math.min(searchMatches.length - 1, i + 1))
        } else if (k === 'ArrowUp') {
          if (ev.preventDefault) ev.preventDefault()
          setSearchHit((i: any) => Math.max(0, i - 1))
        } else if (k === 'Escape') {
          setSearchQ('')
          setSearchHit(0)
        }
      }
      /* ── W2b：导出 PNG（主 canvas 原生分辨率 + 已含白底 → 直接 toBlob；
            失败静默降级：不抛错、不 role=alert） ── */
      function exportPNG() {
        try {
          const cv = canvasRef.current
          if (!cv || typeof cv.toBlob !== 'function') return
          cv.toBlob((blob: any) => {
            try {
              if (!blob || typeof document === 'undefined') return
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'kaogong-graph-' + metrics.V + 'x' + metrics.E + '.png'
              document.body.appendChild(a)
              a.click()
              a.remove()
              setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 3000)
            } catch {}
          }, 'image/png')
        } catch {}
      }
      /* ── W2b：键盘快捷键（容器 tabIndex=0；目标不是输入控件时才生效）──
         +/= 放大 · − 缩小 · 0/f 适配画布 · l 切换布局 · Esc 清除选中/退出聚焦。
         key→命令判定已外提为 graph-transition.ts 的纯表 graphKeyCommand；本函数只执行命令。 */
      function onCanvasKey(ev: any) {
        try {
          const t = ev && ev.target
          const tag = t && t.tagName ? String(t.tagName).toLowerCase() : ''
          if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return
          const cmd = graphKeyCommand(ev && ev.key)
          if (!cmd) return
          const e = engineRef.current
          if (cmd === 'zoom-in') {
            if (e && e.ok) { e.zoomBy(1.25); if (ev.preventDefault) ev.preventDefault() }
          } else if (cmd === 'zoom-out') {
            if (e && e.ok) { e.zoomBy(1 / 1.25); if (ev.preventDefault) ev.preventDefault() }
          } else if (cmd === 'fit') {
            if (e && e.ok) { e.fit(); if (ev.preventDefault) ev.preventDefault() }
          } else if (cmd === 'toggle-layout') {
            // cycle-15：l 键在 力导向→分层→环形 三态间轮换（与工具条按钮同一序列）
            setLayout((v: any) => kgNextLayout(v))
            if (ev.preventDefault) ev.preventDefault()
          } else if (cmd === 'clear') {
            setSelected(null)
            setFocusId(null)
          }
        } catch {}
      }
      /* ── W2b：着色模式图例（随模式联动；连续=渐变条+min/max，离散=色块+社区计数）── */
      function renderColorLegend() {
        const lg = paint && paint.legend
        if (!lg) return null
        const fmt = (v: any) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')) : String(v))
        if (lg.kind === 'seq') {
          const modeLabel = (GRAPH_COLOR_MODES.find((m: any) => m.id === colorMode) || {}).label || ''
          return h('div', { key: 'g-legend-seq', style: { marginTop: 8, fontSize: 10, color: '#64748b' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, fmt(lg.min)),
              h('i', { style: { flex: 1, height: 8, borderRadius: 4, display: 'inline-block', border: '1px solid rgba(148,163,184,.25)', background: 'linear-gradient(90deg,' + GRAPH_SEQ_STOPS.join(',') + ')' } }),
              h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, fmt(lg.max))),
            h('div', { style: { marginTop: 3, color: '#94a3b8' } },
              modeLabel + ' 低 → 高（min-max 归一化着色' + (radiusBoost ? '，半径 +10%~30%' : '') + '）'))
        }
        if (lg.kind === 'community') {
          return h('div', { key: 'g-legend-com', style: { marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 10 } },
            lg.items.map((it: any) => h('span', {
              key: it.idx,
              title: '社区 ' + (it.idx + 1) + '：' + it.count + ' 个节点',
              style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 9, background: it.color + '1a', color: it.color, fontWeight: 700 },
            },
              h('i', { style: { width: 7, height: 7, borderRadius: '50%', background: it.color, display: 'inline-block' } }),
              '社区' + (it.idx + 1) + ' · ' + it.count)),
            lg.rest > 0 ? h('span', { style: { color: '#94a3b8', alignSelf: 'center' } }, '其余 ' + lg.rest + ' 个社区（色板循环）') : null)
        }
        // cycle-21 W2 学习画像图例：模块掌握率 chips（红=弱区→绿=强区，与 graphSeqColor 反向语义一致）
        if (lg.kind === 'mastery') {
          return h('div', { key: 'g-legend-mastery', style: { marginTop: 8, fontSize: 10, color: '#64748b' } },
            h('div', { style: { marginBottom: 4 } }, '学习画像 · 我的模块掌握率（' + (lg.covered || 0) + ' 个模块有数据）· 红色=弱区'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
              (lg.items || []).slice().sort((a: any, b: any) => a.rate - b.rate).map((it: any) => h('span', {
                key: it.name,
                title: it.name + ' 正确率 ' + it.rate + '%',
                style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 9, background: graphSeqColor(1 - it.rate / 100) + '1a', color: graphSeqColor(1 - it.rate / 100), fontWeight: 700 },
              },
                h('i', { style: { width: 7, height: 7, borderRadius: '50%', background: graphSeqColor(1 - it.rate / 100), display: 'inline-block' } }),
                it.name + ' ' + it.rate + '%'))))
        }
        return null
      }
      function degreeOf(id: any) {
        try {
          const an = raw.analytics
          const d = an && an.degree && an.degree[id]
          if (d && typeof d.in === 'number') return { in: d.in, out: d.out, total: typeof d.total === 'number' ? d.total : d.in + d.out }
          return local.degree[id] || { in: 0, out: 0, total: 0 }
        } catch { return { in: 0, out: 0, total: 0 } }
      }
      function prOf(id: any) {
        try {
          const an = raw.analytics
          const fromAn = an && an.pagerank && an.pagerank[id]
          if (typeof fromAn === 'number') return fromAn.toFixed(4)
          const rk = Array.isArray(raw.rank) ? raw.rank.find((r: any) => r && r.id === id) : null
          if (rk && typeof rk.pr === 'number') return rk.pr.toFixed(4)
          const lv = local.pagerank[id]
          return typeof lv === 'number' ? lv.toFixed(4) : '—'
        } catch { return '—' }
      }
      function communityOf(id: any) {
        try {
          const an = raw.analytics
          const list = (an && Array.isArray(an.communities)) ? an.communities : local.communities
          for (let i = 0; i < list.length; i++) {
            const c = list[i] || {}
            if (Array.isArray(c.members) && c.members.indexOf(id) >= 0) return '#' + (i + 1) + '（' + (c.size || c.members.length) + ' 节点）'
          }
          return '—'
        } catch { return '—' }
      }
      function neighborRows(id: any) {
        const rows: any[] = []
        try {
          const seen: any = {}
          for (const e of edges) {
            if (!e) continue
            let other: any = null, dir = ''
            if (String(e.source) === String(id)) { other = e.target; dir = '→出' }
            else if (String(e.target) === String(id)) { other = e.source; dir = '←入' }
            if (other == null) continue
            const key = String(other) + '|' + String(e.rel || '')
            if (seen[key]) continue
            seen[key] = true
            const om = nodeIndex[String(other)]
            rows.push({
              key,
              other: String(other),
              label: om ? String(om.label == null ? om.id : om.label) : String(other),
              rel: String(e.rel || ''),
              relLabel: (edgeMeta[e.rel] && edgeMeta[e.rel].label) || (GRAPH_EDGE_META[e.rel] && GRAPH_EDGE_META[e.rel].label) || String(e.rel || ''),
              dir,
            })
            if (rows.length >= 16) break
          }
        } catch {}
        return rows
      }

      // 考点掌握（既有 T-020 卡片，移到图谱下方；逻辑保持不变）
      const mastery: any = (stats && stats.mastery) || {}
      // cycle-29（沙箱视觉验证实证）：stats.mastery 真实形状是 { rate, confidence, mastery, answered }
      // ——没有 correct 字段（rate 由服务端按 check 记录预计算），旧 v.correct||0 恒 0 →
      // 显示「0/54 · NaN%」（0/0 未定义率）+ Bar pct=NaN。双形状兼容：correct 缺失时用
      // rate 派生 correct = round(rate×answered/100)；rate 也缺失才走旧本地口径。
      const mRows: any[] = entries(mastery)
        .map(([m, v]: any) => {
          const answered = v.answered || 0
          const rate = (typeof v.rate === 'number') ? v.rate : (answered ? Math.round(((v.correct || 0) / answered) * 100) : 0)
          const correct = (typeof v.correct === 'number') ? v.correct : Math.round((rate * answered) / 100)
          return { m, answered, correct, rate }
        })
        .filter((r: any) => r.answered > 0)
        .sort((a: any, b: any) => a.rate - b.rate)

      const hasNodes = nodes.length > 0
      // W2b：加载态（父层 data 未到达）/ 成因提示 / 全类型被过滤 / 连续着色模式判定
      const loading = graphLoading || !graphData
      const banksNotReady = !!(raw.banks && raw.banks.ready === false)
      const allTypesHidden = hasNodes && typeChips.length > 0 && typeChips.every((c: any) => hiddenTypes.has(c.type))
      const isContinuous = colorMode === 'pagerank' || colorMode === 'betweenness' || colorMode === 'degree'
      const histMax = hist.reduce((mx: number, b: any) => Math.max(mx, b.count || 0), 0) || 1
      // 画布高度响应式：窄屏 320 / 常规 520 / 宽屏（≥1100px）600
      // 桌面端全屏面板可用高度充裕，460 会让 141 节点图过度拥挤。
      const wide = typeof window !== 'undefined' && (window as any).innerWidth >= 1100
      const graphH = narrow ? 320 : (wide ? 600 : 520)
      const selectedNode: any = selected ? nodeIndex[selected] : null
      const gbtn = (label: string, on: boolean, fn: any) => h('button', { key: label, style: Object.assign({}, G_BTN, on ? G_BTN_ON : {}), onClick: fn }, label)
      const shortId = (id: any) => {
        const s = String(id == null ? '' : id)
        return s.length > 22 ? '…' + s.slice(-21) : s
      }

      /** 详情抽屉（宽屏右栏 / 窄屏底部面板同一份内容） */
      function renderDrawer() {
        const n = selectedNode
        if (!n) return null
        const m = nodeMeta[n.type] || GRAPH_NODE_META[n.type] || { label: String(n.type || '未知'), color: '#94a3b8', icon: '•' }
        const deg = degreeOf(String(n.id))
        const rows = neighborRows(String(n.id))
        // cycle-22 P1（图谱直达业务）：节点 id 形如 `type:id`——view:/module:/method: 三类
        // 可映射到具体业务视图（view→setView(id)；module→practice?module=；method→专题方法论分区）。
        // 无 onGo（右栏引导页等父层未接线）或类型不可跳 → 按钮不渲染（不臆造入口）。
        const rawId = String(n.id || '')
        const sepAt = rawId.indexOf(':')
        const nType = sepAt > 0 ? rawId.slice(0, sepAt) : String(n.type || '')
        const nKey = sepAt > 0 ? rawId.slice(sepAt + 1) : rawId
        const goItems: any[] = []
        if (typeof (props && props.onGo) === 'function') {
          if (nType === 'view' && nKey) goItems.push({ label: '🖥 打开该视图', v: nKey, p: {} })
          else if (nType === 'module' && nKey) goItems.push({ label: '✏️ 去刷该模块', v: 'practice', p: { module: nKey } })
          else if (nType === 'method' && nKey) goItems.push({ label: '📖 读方法论', v: 'huasheng13', p: { section: nKey } })
        }
        return h('div', {
          key: 'g-drawer',
          style: {
            width: narrow ? '100%' : 292, flexShrink: 0, boxSizing: 'border-box',
            background: 'var(--surface-card,#fff)', border: '1px solid rgba(148,163,184,.25)',
            borderRadius: 12, padding: 12, fontSize: 12,
            maxHeight: narrow ? 260 : graphH, overflowY: 'auto',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
            h('i', { style: { width: 10, height: 10, borderRadius: '50%', background: m.color, display: 'inline-block', flexShrink: 0 } }),
            h('span', { style: { fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(n.label == null ? n.id : n.label)),
            h('button', { style: Object.assign({}, G_BTN, { padding: '0 6px', fontSize: 14, lineHeight: 1.2 }), onClick: () => setSelected(null), 'aria-label': '关闭详情抽屉' }, '×')),
          h('div', { style: { fontFamily: 'monospace', fontSize: 10, color: '#94a3b8', wordBreak: 'break-all', marginBottom: 8 } }, String(n.id)),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
            h('span', { style: Object.assign({}, G_TAG, { background: m.color + '1a', color: m.color }) }, (m.icon || '•') + ' ' + (m.label || n.type)),
            h('span', { style: G_TAG }, '入 ' + deg.in + ' · 出 ' + deg.out),
            h('span', { style: G_TAG }, 'PageRank ' + prOf(String(n.id))),
            h('span', { style: G_TAG }, '社区 ' + communityOf(String(n.id)))),
          h('div', { style: { fontWeight: 700, fontSize: 11.5, margin: '4px 0 4px' } }, '邻接关系（' + rows.length + (rows.length >= 16 ? '+' : '') + '）'),
          rows.length
            ? rows.map(r => h('div', {
                key: r.key,
                style: { display: 'flex', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(148,163,184,.12)', cursor: 'pointer', alignItems: 'baseline' },
                onClick: () => locate(r.other),
                title: r.other,
              },
                h('span', { style: { color: '#94a3b8', fontSize: 10, width: 30, flexShrink: 0 } }, r.dir),
                h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.label),
                h('span', { style: { fontSize: 10, color: '#94a3b8', flexShrink: 0 } }, r.relLabel)))
            : h('div', { style: { fontSize: 11, color: '#94a3b8' } }, '无邻接边（可能是孤儿节点）'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 } },
            // cycle-22 P1：直达业务按钮（图谱节点 → 业务视图的连通性闭环）
            goItems.length ? goItems.map(it => h('button', {
              key: it.label,
              style: Object.assign({}, G_BTN, { background: 'rgba(99,102,241,.1)', borderColor: 'rgba(99,102,241,.4)', color: '#4f46e5', fontWeight: 700 }),
              onClick: () => { try { (props as any).onGo(it.v, it.p) } catch {} },
            }, it.label)) : null,
            h('button', { style: G_BTN, onClick: () => setPathState({ from: String(n.id), to: pathState.to || null, path: null, loading: false, error: null }) }, '设为起点'),
            h('button', {
              style: G_BTN,
              onClick: () => {
                if (pathState.from && pathState.from !== String(n.id)) requestPath(pathState.from, String(n.id))
                else setPathState((s: any) => Object.assign({}, s, { to: String(n.id), path: null, error: null }))
              },
            }, pathState.from ? '设为终点并分析' : '设为终点'),
            h('button', { style: G_BTN, onClick: () => locate(String(n.id)) }, '居中'),
            h('button', { style: G_BTN, onClick: () => setFocusId(focusId ? null : String(n.id)) }, focusId ? '退出聚焦' : '聚焦 1 跳'),
            // cycle-29 P1：子图按需加载（neighborhood k跳邻域 / impact 影响面——服务端已声明端点的 UI 消费闭环）
            h('button', {
              style: Object.assign({}, G_BTN, { background: 'rgba(16,185,129,.1)', borderColor: 'rgba(16,185,129,.4)', color: '#059669', fontWeight: 700 }),
              disabled: subLoading,
              title: '只渲染该节点 k 跳邻域子图（按需加载，大图提速）',
              onClick: () => { try { loadSubgraph('neighborhood', n.id, 1) } catch {} },
            }, subLoading ? '⏳ 子图加载中' : '🕸 1跳邻域'),
            h('button', {
              style: Object.assign({}, G_BTN, { background: 'rgba(16,185,129,.1)', borderColor: 'rgba(16,185,129,.4)', color: '#059669', fontWeight: 700 }),
              disabled: subLoading,
              title: '只渲染该节点 2 跳邻域子图',
              onClick: () => { try { loadSubgraph('neighborhood', n.id, 2) } catch {} },
            }, '🕸 2跳邻域'),
            h('button', {
              style: Object.assign({}, G_BTN, { background: 'rgba(245,158,11,.1)', borderColor: 'rgba(245,158,11,.4)', color: '#b45309', fontWeight: 700 }),
              disabled: subLoading,
              title: '反向可达：谁会因该节点变化受影响（影响面量化）',
              onClick: () => { try { loadSubgraph('impact', n.id, null) } catch {} },
            }, '⚡ 影响面')),
          h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 8, lineHeight: 1.6 } },
            '提示：Shift+点击另一节点可直接做路径分析'))
      }

      return h('div', {},
        // ⓪ 骨架动画 keyframes（零依赖；加载中给脉冲条，绝不 role="alert"）
        h('style', { key: 'g-style' },
          '@keyframes kgGraphSk{0%,100%{opacity:.4}50%{opacity:1}}' +
          '@keyframes kgGraphGlow{0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,.18)}50%{box-shadow:0 0 14px 2px rgba(99,102,241,.28)}}'),
        loading ? h('div', { key: 'g-sk', style: { marginBottom: 8 } },
          [92, 74, 84].map((w: number, i: number) => h('div', {
            key: 'sk' + i,
            style: {
              height: 10, width: w + '%', borderRadius: 6, marginBottom: 6,
              background: 'linear-gradient(90deg,rgba(148,163,184,.28),rgba(148,163,184,.16))',
              animation: 'kgGraphSk 1.2s ease-in-out ' + (i * 0.15) + 's infinite',
            },
          }))) : null,
        // ① 工具条（玻璃拟态：半透明底 + backdrop blur + 圆角细边；深浅色随 CSS 变量自适应）
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8,
            padding: '6px 10px', borderRadius: 12,
            // 玻璃拟态：先给不透明度兜底色（旧 WebView 不识别 color-mix 时仍可读），
            // 支持时由 backgroundColor 覆盖为「表面色 72% 透明」实现深浅色自适应
            background: 'rgba(255,255,255,.72)',
            backgroundColor: 'color-mix(in srgb, var(--surface-card,#fff) 72%, transparent)',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(148,163,184,.28)', boxShadow: '0 2px 10px rgba(15,23,42,.06)',
          },
        },
          h('span', { style: { fontSize: 12.5, fontWeight: 800, marginRight: 2 } }, '🕸️ 交互图谱'),
          gbtn('重置视图', false, () => { setFocusId(null); try { if (engineRef.current && engineRef.current.ok) engineRef.current.reset() } catch {} }),
          gbtn('适配画布', false, () => { try { if (engineRef.current && engineRef.current.ok) engineRef.current.fit() } catch {} }),
          gbtn(KG_LAYOUT_LABEL[layout] || '布局：力导向', true, () => setLayout((v: any) => kgNextLayout(v))),
          gbtn(flowOn ? '流动粒子：开' : '流动粒子：关', !!flowOn, () => setFlowOn((v: any) => !v)),
          gbtn(showLabels ? '标签：开' : '标签：关', !!showLabels, () => setShowLabels((v: any) => !v)),
          gbtn(focusId ? '退出聚焦' : '聚焦选中', !!focusId, () => { if (selected) setFocusId(focusId ? null : selected) }),
          // W2b：着色模式胶囊组（type 默认 / community / pagerank / betweenness / degree）
          h('span', {
            title: '着色模式：连续指标走五停渐变，社区走 12 色定性循环',
            style: { display: 'inline-flex', gap: 2, alignItems: 'center', background: 'rgba(148,163,184,.14)', borderRadius: 10, padding: 2 },
          },
            GRAPH_COLOR_MODES.map((m: any) => h('button', {
              key: m.id,
              onClick: () => setColorMode(m.id),
              title: m.tip,
              style: Object.assign({}, G_BTN, { border: 'none', padding: '3px 8px', borderRadius: 8 }, colorMode === m.id ? G_BTN_ON : {}),
            }, m.label))),
          // W2b：连续模式下的半径微调开关（+10%~30%，纯视觉）
          isContinuous
            ? gbtn('半径：随指标', !!radiusBoost, () => setRadiusBoost((v: any) => !v))
            : null,
          // W2b：导出 PNG（主 canvas 原生分辨率；失败静默）
          gbtn('⬇ 导出 PNG', false, exportPNG),
          h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: '#94a3b8' } },
            '滚轮缩放 · 拖空白平移 · 拖节点钉住 · 双击聚焦 · Shift+点击路径 · 快捷键 +/−/0/f/l/Esc')),
        // cycle-29 P1：子图模式面包屑（engine 装配的是 activeNodes/activeEdges；此处仅状态提示与返回全图）
        subData ? h('div', {
          key: 'g-sub-crumb',
          style: {
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8,
            padding: '6px 10px', borderRadius: 10, fontSize: 11.5,
            background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.35)',
          },
        },
          h('span', { style: { fontWeight: 800, color: '#059669' } }, '🧩 子图模式'),
          h('span', { style: { color: '#475569' } },
            subData.label + ' · ' + subData.nodes.length + ' 节点 / ' + subData.edges.length + ' 边' +
            (subData.kind === 'impact' ? '（反向可达 · 含自身）' : '')),
          h('span', { style: { fontSize: 10, color: '#94a3b8' } }, '统计面板/图例仍按全图口径；分析完成后回到全图继续探索'),
          h('button', {
            style: Object.assign({}, G_BTN, { marginLeft: 'auto', background: 'rgba(16,185,129,.12)', borderColor: 'rgba(16,185,129,.5)', color: '#059669', fontWeight: 700 }),
            onClick: () => { setSubData(null); setSubErr(null) },
          }, '← 返回全图'))
          : null,
        subErr ? h('div', { key: 'g-sub-err', style: { marginBottom: 8, fontSize: 10.5, color: '#b45309' } }, '⚠ 子图加载失败（已静默降级，可返回全图继续）：' + subErr) : null,
        // ② 搜索
        h('div', { style: { position: 'relative', marginBottom: 8, maxWidth: 420 } },
          h('input', {
            ref: searchRef,
            value: searchQ,
            placeholder: '🔍 搜索节点标签（回车定位并选中）',
            onChange: (ev: any) => { setSearchQ(ev.target.value); setSearchHit(0) },
            onKeyDown: onSearchKey,
            style: { width: '100%', boxSizing: 'border-box', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'inherit', outline: 'none' },
          }),
          searchQ && searchMatches.length
            ? h('div', {
                style: { position: 'absolute', zIndex: 8, top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--surface-card,#fff)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, boxShadow: '0 10px 26px rgba(15,23,42,.14)', maxHeight: 236, overflowY: 'auto' },
              },
                searchMatches.map((mm: any, i: number) => h('div', {
                  key: mm.id,
                  style: { padding: '6px 10px', fontSize: 11.5, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline', background: i === searchHit ? 'rgba(99,102,241,.1)' : 'transparent' },
                  onClick: () => pickSearchResult(mm.id),
                },
                  h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, mm.label),
                  h('span', { style: { fontFamily: 'monospace', fontSize: 9.5, color: '#94a3b8' } }, shortId(mm.id)))),
                // R-GRAPH-1 循环提示行：回车循环命中数（≥2 时才显示，避免噪音）
                searchMatches.length > 1
                  ? h('div', { style: { padding: '4px 10px', fontSize: 9.5, color: '#94a3b8', borderTop: '1px dashed rgba(148,163,184,.2)' } },
                      '回车循环定位 ' + (searchHit + 1) + '/' + searchMatches.length + ' · Esc 收起')
                  : null)
            : searchQ ? h('div', { style: { fontSize: 11, color: '#94a3b8', marginTop: 4 } }, '无匹配节点') : null),
        // ③ W2b 图例卡（可折叠）：节点类型（色点+图标+label+计数+点击显隐）+
        //    边类型过滤（色点+label+计数+点击显隐）+ 孤儿开关 + 着色模式图例联动
        h('div', {
          style: {
            marginBottom: 8, borderRadius: 12, padding: legendOpen ? '8px 10px' : '6px 10px',
            background: 'rgba(255,255,255,.72)',
            backgroundColor: 'color-mix(in srgb, var(--surface-card,#fff) 72%, transparent)',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(148,163,184,.28)', boxShadow: '0 2px 10px rgba(15,23,42,.06)',
          },
        },
          h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' },
            onClick: () => setLegendOpen((v: any) => !v),
            title: '点击折叠/展开图例与过滤',
          },
            h('span', { style: { fontSize: 11.5, fontWeight: 800 } }, '🎨 图例与过滤'),
            h('span', { style: { fontSize: 10, color: '#94a3b8' } },
              typeChips.length + ' 类节点 · ' + edgeChips.length + ' 类边' + (allTypesHidden ? ' · ⚠ 全部节点类型已被过滤' : '')),
            h('button', {
              'aria-label': '折叠或展开图例',
              style: Object.assign({}, G_BTN, { marginLeft: 'auto', padding: '1px 8px' }),
              onClick: (ev: any) => { try { ev.stopPropagation() } catch {}; setLegendOpen((v: any) => !v) },
            }, legendOpen ? '▾ 收起' : '▸ 展开')),
          legendOpen ? h('div', { style: { marginTop: 7 } },
            // 节点类型行（保留 button 形态：点击显隐 = 过滤；计数与色点增强）
            h('div', { style: { fontSize: 10, color: '#94a3b8', marginBottom: 4 } }, '节点类型（点击显隐）'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
              typeChips.map((c: any) => {
                const hid = hiddenTypes.has(c.type)
                return h('button', {
                  key: c.type,
                  onClick: () => toggleType(c.type),
                  title: '点击显示/隐藏「' + (c.meta.label || c.type) + '」节点（' + (typeCounts[c.type] || 0) + ' 个）',
                  style: Object.assign({}, G_CHIP, {
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    borderColor: c.meta.color + '66',
                    background: hid ? 'transparent' : c.meta.color + '1f',
                    color: hid ? '#94a3b8' : c.meta.color,
                    opacity: hid ? 0.55 : 1,
                    textDecoration: hid ? 'line-through' : 'none',
                  }),
                },
                  h('i', { style: { width: 8, height: 8, borderRadius: '50%', background: c.meta.color, display: 'inline-block', flexShrink: 0 } }),
                  (c.meta.icon || '•') + ' ' + (c.meta.label || c.type) + ' ' + (typeCounts[c.type] || 0))
              }),
              h('button', {
                onClick: () => setShowOrphans((v: any) => !v),
                title: '孤儿 = 度数为 0 的节点',
                style: Object.assign({}, G_CHIP, { opacity: showOrphans ? 1 : 0.55 }),
              }, '孤儿：' + (showOrphans ? '显示' : '隐藏'))),
            // 边类型过滤行（engine setView 的 hiddenEdges 消费端）
            h('div', { style: { fontSize: 10, color: '#94a3b8', margin: '8px 0 4px' } }, '边类型（点击显隐）'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
              edgeChips.map((ec: any) => {
                const hid = hiddenEdges.has(ec.rel)
                return h('button', {
                  key: ec.rel,
                  onClick: () => toggleEdge(ec.rel),
                  title: '点击显示/隐藏「' + (ec.meta.label || ec.rel) + '」边（' + (edgeCounts[ec.rel] || 0) + ' 条）',
                  style: Object.assign({}, G_CHIP, {
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    borderColor: (ec.meta.color || '#94a3b8') + '55',
                    opacity: hid ? 0.45 : 1,
                    textDecoration: hid ? 'line-through' : 'none',
                  }),
                },
                  h('i', { style: { width: 12, height: 2, background: ec.meta.color, display: 'inline-block', borderRadius: 2, flexShrink: 0 } }),
                  (ec.meta.label || ec.rel) + ' ' + (edgeCounts[ec.rel] || 0))
              })),
            // 着色模式图例（连续模式=渐变条+min/max；社区模式=色块+计数）
            renderColorLegend())
            : null),
        // ⑤ 画布 + 小地图 + 详情抽屉（画布容器 tabIndex=0 承接键盘快捷键）
        h('div', { style: { display: 'flex', gap: 10, flexDirection: 'row', alignItems: 'stretch' } },
          h('div', {
            ref: wrapRef,
            tabIndex: 0,
            onKeyDown: onCanvasKey,
            'aria-label': '知识图谱（获得焦点后可用键盘：+ 放大、− 缩小、0 适配、l 切布局、Esc 清除）',
            style: { position: 'relative', flex: '1 1 420px', minWidth: 0, height: graphH, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(148,163,184,.25)', background: '#f8fafc' },
          },
            h('canvas', {
              ref: canvasRef,
              role: 'img',
              'aria-label': '知识图谱交互画布：' + activeNodes.length + ' 个节点、' + activeEdges.length + ' 条边' + (subData ? '（子图模式）' : ''),
              style: { display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: hasNodes ? 'grab' : 'default' },
            }),
            // W2b 小地图覆盖层（右下角 150×100；点击/拖拽平移视口，绘制由引擎驱动）
            hasNodes && canvasOk
              ? h('div', {
                  title: '小地图：点击/拖拽平移视口',
                  style: {
                    position: 'absolute', right: 10, bottom: 10, width: 150, height: 100, zIndex: 6,
                    borderRadius: 10, overflow: 'hidden',
                    border: '1px solid rgba(148,163,184,.4)',
                    background: 'rgba(255,255,255,.66)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
                    boxShadow: '0 6px 18px rgba(15,23,42,.14)', cursor: 'crosshair',
                  },
                },
                  h('canvas', { ref: miniRef, style: { width: '100%', height: '100%', display: 'block', touchAction: 'none' } }))
              : null,
            !hasNodes
              ? h('div', { style: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#64748b', fontSize: 12.5, textAlign: 'center', padding: 16, pointerEvents: 'none' } },
                  h('div', { style: { fontSize: 26 } }, loading ? '⏳' : '🕸️'),
                  h('div', { style: { fontWeight: 700 } }, loading ? '图谱数据加载中…' : '图谱数据为空'),
                  h('div', { style: { fontSize: 11, color: '#94a3b8', lineHeight: 1.7 } },
                    loading
                      ? '正在从 /api/graph 拉取图谱快照（骨架条仅过渡展示）'
                      : banksNotReady
                        ? '成因提示：仓库未就绪（banks.ready=false），数据层就绪后自动恢复'
                        : '成因提示：/api/graph 未返回 nodes（数据层降级，非渲染错误，其他视图不受影响）'))
              : allTypesHidden
                ? h('div', { style: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 } },
                    h('div', { style: { fontSize: 11.5, color: '#64748b', background: 'rgba(248,250,252,.9)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, padding: '8px 14px' } },
                      '当前所有节点类型都被过滤 —— 点击图例中的节点类型可恢复显示'))
                : null,
            !canvasOk && hasNodes
              ? h('div', { style: { position: 'absolute', left: 10, top: 10, fontSize: 10.5, color: '#b45309', background: 'rgba(255,255,255,.92)', padding: '3px 8px', borderRadius: 8, zIndex: 6 } },
                  'Canvas 2D 不可用 · 已降级为只读统计')
              : null),
          !narrow && selectedNode
            ? h('div', { style: { flex: '0 0 auto' } }, renderDrawer())
            : null),
        // ⑥ 窄屏底部抽屉（<520px）
        narrow && selectedNode ? h('div', { style: { marginTop: 8 } }, renderDrawer()) : null,
        // ⑦ 路径分析状态行（失败只给灰字，不 role=alert）
        pathState.path
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: '#b45309' } },
              h('span', null, '🛤 路径 ' + shortId(pathState.from) + ' → ' + shortId(pathState.to) + ' · ' + Math.max(0, pathState.path.length - 1) + ' 跳：' + pathState.path.map((x: any) => shortId(x)).join(' → ')),
              h('button', { style: G_BTN, onClick: () => setPathState({ from: null, to: null, path: null, loading: false, error: null }) }, '清除路径'))
          : pathState.loading
            ? h('div', { style: { marginTop: 8, fontSize: 11, color: '#64748b' } }, '路径分析中…')
            : pathState.error
              ? h('div', { style: { marginTop: 8, fontSize: 10.5, color: '#94a3b8' } }, '⚠ ' + pathState.error)
              : pathState.from
                ? h('div', { style: { marginTop: 8, fontSize: 10.5, color: '#94a3b8' } }, '路径起点：' + shortId(pathState.from) + ' —— 按住 Shift 点击终点节点，或到详情抽屉点「设为终点并分析」')
                : null,
        // ⑧ 指标条（现代卡片风格统一由 Stat 承担；直方图卡片紧随其后）
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8, marginTop: 12, marginBottom: 12 } },
          h(Stat, { v: metrics.V, l: '节点 |V|', color: '#6366f1' }),
          h(Stat, { v: metrics.E, l: '边 |E|', color: '#8b5cf6' }),
          h(Stat, { v: metrics.density, l: '密度 ρ' }),
          h(Stat, { v: metrics.components, l: '连通分量' }),
          h(Stat, { v: metrics.orphans, l: '孤儿', color: metrics.orphans ? '#ef4444' : '#10b981' }),
          h(Stat, { v: metrics.health == null ? '—' : metrics.health, l: '健康度', color: metrics.health == null ? '#64748b' : (metrics.health >= 80 ? '#10b981' : '#f59e0b') }),
          h(Stat, { v: metrics.communities, l: '社区数', color: '#8b5cf6' }),
          h(Stat, { v: metrics.clustering, l: '平均集聚系数' })),
        // ⑧b W2b：度分布直方图（迷你条形图；bins 来自服务端 degreeStats 或本地确定性兜底）
        hist.length
          ? h(Card, { title: '📊 度分布（节点度数 → 数量）' },
              h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 64, padding: '0 2px' } },
                hist.map((b: any, i: number) => h('div', {
                  key: i,
                  title: '度 ' + b.deg + '：' + b.count + ' 个节点',
                  style: {
                    flex: 1, minWidth: 3, height: Math.max(4, Math.round((b.count / histMax) * 100)) + '%',
                    borderRadius: 2, background: 'linear-gradient(180deg,#6366f1,#8b5cf6)', opacity: 0.9,
                  },
                }))),
              h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#94a3b8', marginTop: 4 } },
                h('span', null, '度 ' + hist[0].deg),
                h('span', null, '峰值 ' + histMax + ' 个'),
                h('span', null, '度 ' + hist[hist.length - 1].deg + (hist.length >= 26 ? '+' : ''))))
          : null,
        // ⑨ 保留：PageRank 中心节点（服务端 rank 缺失时用本地幂迭代兜底）
        h(Card, { title: '⭐ 中心节点 top8（PageRank 幂迭代 d=0.85）' },
          (() => {
            const rk: any[] = Array.isArray(raw.rank) && raw.rank.length
              ? raw.rank.slice(0, 8)
              : entries(local.pagerank).sort((a: any, b: any) => b[1] - a[1]).slice(0, 8).map(([id, v]: any) => ({ id, pr: v }))
            const maxPr = rk.reduce((mx: number, r: any) => Math.max(mx, Number(r.pr) || 0), 0) || 1
            return rk.length
              ? rk.map((r: any) => h('div', { key: r.id, style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 12 } },
                  h('span', { title: String(r.id), style: { width: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 10.5, cursor: 'pointer' }, onClick: () => locate(String(r.id)) }, String(r.id)),
                  h('div', { style: { flex: 1 } }, h(Bar, { pct: Math.min(100, (Number(r.pr) || 0) / maxPr * 100) })),
                  h('span', { style: { width: 62, textAlign: 'right', color: '#64748b' } }, Number(r.pr || 0).toFixed(4))))
              : h('div', { style: { fontSize: 11.5, color: '#64748b' } }, '暂无中心性数据')
          })()),
        // ⑩ 既有「我的考点掌握」卡片（数据来自自治 statsData.mastery，逻辑保持原样）
        h(Card, { title: '🔥 我的考点掌握（弱 → 强）' },
          mRows.length === 0
            ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '暂无作答数据 —— 去「刷题」或「模考」后再看')
            : mRows.map((r: any) => h('div', { key: r.m, style: { marginBottom: 9 } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 } },
                  h('span', null, r.m),
                  h('span', { style: { color: '#64748b' } }, r.correct + '/' + r.answered + ' · ' + r.rate + '%')),
                h(Bar, { pct: r.rate, color: r.rate >= 75 ? 'linear-gradient(135deg,#10b981,#34d399)' : r.rate >= 50 ? undefined : 'linear-gradient(135deg,#ef4444,#f87171)' })))))
    }