/**
 * graph-view.ts — NativeGraphView 原生交互图谱视图（cycle-13 T-025 从 client.ts 拆出）
 * 契约 §3：Canvas 2D 力导向 + 搜索/类型过滤/布局切换/路径分析；引擎见 ./graph-engine.ts。
 */

import { h, React, entries, Stat, Bar, Card, G_BTN, G_BTN_ON, G_TAG, G_CHIP, MOUNT_PATH } from './ui-kit.js'
import { createGraphEngine } from './graph-engine.js'
import { graphEngineStub, graphFuzzyIndex, graphLocalAnalytics, graphReadPresetLayout, graphReadLayers, GRAPH_NODE_META, GRAPH_EDGE_META } from './graph-analytics.js'

    /**
     * NativeGraphView — 契约 §3 的原生交互图谱（真组件；hook 数量恒定）。
     * props: { data: /api/graph 响应, stats?: /api/stats, api?: (p,opts)=>Promise }
     * api 是可选的（父层若未传，路径分析降级为同源直接 fetch，失败静默）。
     */
    export function NativeGraphView(props) {
      const liveRef = React.useRef({})
      liveRef.current = { api: props && props.api, wsKey: props && props.wsKey }   // 每次渲染刷新最新 props（供异步回调用）

      const raw: any = (props && props.data) || {}
      const nodes: any[] = Array.isArray(raw.nodes) ? raw.nodes : []
      const edges: any[] = Array.isArray(raw.edges) ? raw.edges : []
      const nodeMeta: any = (raw.nodeMeta && typeof raw.nodeMeta === 'object') ? raw.nodeMeta : GRAPH_NODE_META
      const edgeMeta: any = (raw.edgeMeta && typeof raw.edgeMeta === 'object') ? raw.edgeMeta : GRAPH_EDGE_META

      /* ── hooks：全部在组件顶部，跨渲染数量恒定（R9） ── */
      const canvasRef = React.useRef(null)
      const wrapRef = React.useRef(null)
      const engineRef = React.useRef(null)
      const searchRef = React.useRef(null)
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

      /* ── 引擎装配（数据变化即重建；canvas/wrap 缺失时静默降级） ── */
      React.useEffect(() => {
        aliveRef.current = true
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        let eng: any = null
        try {
          eng = createGraphEngine({
            canvas, wrap, nodes, edges,
            presetLayout: graphReadPresetLayout(raw),
            layers: graphReadLayers(raw),
            nodeMeta, edgeMeta,
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
      }, [raw, nodes, edges])

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
      function pickSearchResult(id: any) {
        setSearchQ('')
        setSearchHit(0)
        locate(id)
      }
      function onSearchKey(ev: any) {
        const k = ev && ev.key
        if (k === 'Enter') {
          if (ev.preventDefault) ev.preventDefault()
          const hit = searchMatches[searchHit] || searchMatches[0]
          if (hit) pickSearchResult(hit.id)
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
      const mastery: any = (props && props.stats && props.stats.mastery) || {}
      const mRows: any[] = entries(mastery)
        .map(([m, v]: any) => ({ m, answered: v.answered || 0, correct: v.correct || 0, rate: v.answered ? Math.round(v.correct / v.answered * 100) : 0 }))
        .filter((r: any) => r.answered > 0)
        .sort((a: any, b: any) => a.rate - b.rate)

      const hasNodes = nodes.length > 0
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
            h('button', { style: G_BTN, onClick: () => setPathState({ from: String(n.id), to: pathState.to || null, path: null, loading: false, error: null }) }, '设为起点'),
            h('button', {
              style: G_BTN,
              onClick: () => {
                if (pathState.from && pathState.from !== String(n.id)) requestPath(pathState.from, String(n.id))
                else setPathState((s: any) => Object.assign({}, s, { to: String(n.id), path: null, error: null }))
              },
            }, pathState.from ? '设为终点并分析' : '设为终点'),
            h('button', { style: G_BTN, onClick: () => locate(String(n.id)) }, '居中'),
            h('button', { style: G_BTN, onClick: () => setFocusId(focusId ? null : String(n.id)) }, focusId ? '退出聚焦' : '聚焦 1 跳')),
          h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 8, lineHeight: 1.6 } },
            '提示：Shift+点击另一节点可直接做路径分析'))
      }

      return h('div', {},
        // ① 工具条
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
          h('span', { style: { fontSize: 12.5, fontWeight: 800, marginRight: 2 } }, '🕸️ 交互图谱'),
          gbtn('重置视图', false, () => { setFocusId(null); try { if (engineRef.current && engineRef.current.ok) engineRef.current.reset() } catch {} }),
          gbtn('适配画布', false, () => { try { if (engineRef.current && engineRef.current.ok) engineRef.current.fit() } catch {} }),
          gbtn(layout === 'force' ? '布局：力导向' : '布局：分层', true, () => setLayout((v: any) => (v === 'force' ? 'layered' : 'force'))),
          gbtn(showLabels ? '标签：开' : '标签：关', !!showLabels, () => setShowLabels((v: any) => !v)),
          gbtn(focusId ? '退出聚焦' : '聚焦选中', !!focusId, () => { if (selected) setFocusId(focusId ? null : selected) }),
          h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: '#94a3b8' } },
            '滚轮缩放 · 拖空白平移 · 拖节点钉住 · 双击节点聚焦 · Shift+点击做路径分析')),
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
                  h('span', { style: { fontFamily: 'monospace', fontSize: 9.5, color: '#94a3b8' } }, shortId(mm.id)))))
            : searchQ ? h('div', { style: { fontSize: 11, color: '#94a3b8', marginTop: 4 } }, '无匹配节点') : null),
        // ③ 节点类型 chips + 孤儿开关
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 7 } },
          h('span', { style: { fontSize: 10, color: '#94a3b8', marginRight: 2 } }, '节点类型'),
          typeChips.map((c: any) => h('button', {
            key: c.type,
            onClick: () => toggleType(c.type),
            title: '点击显示/隐藏「' + (c.meta.label || c.type) + '」节点',
            style: Object.assign({}, G_CHIP, {
              borderColor: c.meta.color + '66',
              background: hiddenTypes.has(c.type) ? 'transparent' : c.meta.color + '1f',
              color: hiddenTypes.has(c.type) ? '#94a3b8' : c.meta.color,
              opacity: hiddenTypes.has(c.type) ? 0.55 : 1,
            }),
          }, (c.meta.icon || '•') + ' ' + (c.meta.label || c.type))),
          h('button', {
            onClick: () => setShowOrphans((v: any) => !v),
            title: '孤儿 = 度数为 0 的节点',
            style: Object.assign({}, G_CHIP, { opacity: showOrphans ? 1 : 0.55 }),
          }, '孤儿：' + (showOrphans ? '显示' : '隐藏'))),
        // ④ 边类型图例（可点击切换显隐）
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8, fontSize: 10.5, color: '#64748b' } },
          h('span', { style: { fontSize: 10, color: '#94a3b8' } }, '边类型'),
          edgeChips.map((ec: any) => h('span', {
            key: ec.rel,
            title: '点击显示/隐藏「' + (ec.meta.label || ec.rel) + '」边',
            onClick: () => toggleEdge(ec.rel),
            style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', opacity: hiddenEdges.has(ec.rel) ? 0.35 : 1, whiteSpace: 'nowrap' },
          },
            h('i', { style: { width: 14, height: 2, background: ec.meta.color, display: 'inline-block', borderRadius: 2 } }),
            ec.meta.label || ec.rel))),
        // ⑤ 画布 + 详情抽屉
        h('div', { style: { display: 'flex', gap: 10, flexDirection: 'row', alignItems: 'stretch' } },
          h('div', {
            ref: wrapRef,
            style: { position: 'relative', flex: '1 1 420px', minWidth: 0, height: graphH, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(148,163,184,.25)', background: '#f8fafc' },
          },
            h('canvas', {
              ref: canvasRef,
              role: 'img',
              'aria-label': '知识图谱交互画布：' + nodes.length + ' 个节点、' + edges.length + ' 条边',
              style: { display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: hasNodes ? 'grab' : 'default' },
            }),
            !hasNodes
              ? h('div', { style: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#64748b', fontSize: 12.5, textAlign: 'center', padding: 16, pointerEvents: 'none' } },
                  h('div', { style: { fontSize: 24 } }, '🕸️'),
                  h('div', null, '图谱暂无节点数据'),
                  h('div', { style: { fontSize: 11, color: '#94a3b8' } }, '数据层降级：/api/graph 未返回 nodes（不是渲染错误，其他视图不受影响）'))
              : null,
            !canvasOk && hasNodes
              ? h('div', { style: { position: 'absolute', left: 10, bottom: 10, fontSize: 10.5, color: '#b45309', background: 'rgba(255,255,255,.92)', padding: '3px 8px', borderRadius: 8 } },
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
        // ⑧ 指标条
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8, marginTop: 12, marginBottom: 12 } },
          h(Stat, { v: metrics.V, l: '节点 |V|', color: '#6366f1' }),
          h(Stat, { v: metrics.E, l: '边 |E|', color: '#8b5cf6' }),
          h(Stat, { v: metrics.density, l: '密度 ρ' }),
          h(Stat, { v: metrics.components, l: '连通分量' }),
          h(Stat, { v: metrics.orphans, l: '孤儿', color: metrics.orphans ? '#ef4444' : '#10b981' }),
          h(Stat, { v: metrics.health == null ? '—' : metrics.health, l: '健康度', color: metrics.health == null ? '#64748b' : (metrics.health >= 80 ? '#10b981' : '#f59e0b') }),
          h(Stat, { v: metrics.communities, l: '社区数', color: '#8b5cf6' }),
          h(Stat, { v: metrics.clustering, l: '平均集聚系数' })),
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
        // ⑩ 既有「我的考点掌握」卡片（数据来自 props.stats.mastery，逻辑保持原样）
        h(Card, { title: '🔥 我的考点掌握（弱 → 强）' },
          mRows.length === 0
            ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '暂无作答数据 —— 去「刷题」或「模考」后再看')
            : mRows.map((r: any) => h('div', { key: r.m, style: { marginBottom: 9 } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 } },
                  h('span', null, r.m),
                  h('span', { style: { color: '#64748b' } }, r.correct + '/' + r.answered + ' · ' + r.rate + '%')),
                h(Bar, { pct: r.rate, color: r.rate >= 75 ? 'linear-gradient(135deg,#10b981,#34d399)' : r.rate >= 50 ? undefined : 'linear-gradient(135deg,#ef4444,#f87171)' })))))
    }