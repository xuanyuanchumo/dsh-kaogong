/**
 * graph-engine.ts — createGraphEngine 主体（cycle-13 T-025 复杂度拆分后）
 *
 * 保留：引擎状态与闭包写路径（alpha/zoom/pan/raf/事件族/装配销毁/对外 API）。
 * 外提：只读型物理/渲染/查询原语在 ./graph-physics.ts（同名参数在调用点穿线，
 * 读取语义 = 调用时刻闭包值，行为逐字节等价）；模型构建 = buildGraphModel。
 */

import { graphClamp, graphHash, GRAPH_NODE_META, GRAPH_EDGE_META, graphEngineStub } from './graph-analytics.js'
import { buildGraphModel, step, draw, applyLayered, nodeVisible, worldOf, localPt, hitTest } from './graph-physics.js'

    /**
     * 力导向图引擎（纯函数式闭包，内部无 hook；由组件在 useEffect 里创建与销毁）。
     * 物理模型：斥力（O(V²)，V>600 时按步长抽样保帧预算）+ 弹簧 + 向心 + 阻尼；
     * alpha 从 1 衰减到 0.02，稳定后停 rAF（省电），交互再 kick 重启。
     */
    export function createGraphEngine(cfg: any): any {
      const canvas = cfg && cfg.canvas
      const wrap = cfg && cfg.wrap
      let ctx: any = null
      try { if (canvas && typeof canvas.getContext === 'function') ctx = canvas.getContext('2d') } catch { ctx = null }
      if (!canvas || !ctx) return graphEngineStub()

      const nodesIn: any[] = Array.isArray(cfg.nodes) ? cfg.nodes : []
      const edgesIn: any[] = Array.isArray(cfg.edges) ? cfg.edges : []
      const nodeMeta: any = cfg.nodeMeta || GRAPH_NODE_META
      const edgeMeta: any = cfg.edgeMeta || GRAPH_EDGE_META
      const presetLayout: any = cfg.presetLayout || null
      const layers: any = cfg.layers || null
      const onSelect = typeof cfg.onSelect === 'function' ? cfg.onSelect : () => {}
      const onRequestPath = typeof cfg.onRequestPath === 'function' ? cfg.onRequestPath : () => {}

      const dpr = graphClamp((typeof globalThis !== 'undefined' && (globalThis as any).devicePixelRatio) || 1, 1, 3)
      const rafFn: any = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: any) => setTimeout(cb, 16)
      const cafFn: any = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id: any) => clearTimeout(id)

      let W = 640, H = 420
      let zoom = 1, panX = 0, panY = 0
      let alpha = 1, raf: any = null, sized = false, autoFitted = false
      let userAdjusted = false   // 用户是否手动缩放过/平移过（决定了 resize 时要不要重新 fit）
      let layoutMode = 'force'
      let hoverId: any = null, selectedId: any = null
      let drag: any = null, pan: any = null, pinch: any = null, downPt: any = null
      let hoverPos: any = null
      let focusSet: any = null
      let pathNodeSet: any = null
      let pathEdgeSet: any = null
      let view = { hiddenTypes: new Set(), hiddenEdges: new Set(), showOrphans: true, showLabels: true }
      const pointers = new Map()

      /* ── 节点/边模型：构建在 graph-physics.ts 的 buildGraphModel（逐字节等价外提；
         BASE_R 随模型返回，reset 与初值共用同一确定性来源） ── */
      const { simNodes, simEdges, byId, indexById, BASE_R } = buildGraphModel(nodesIn, edgesIn, presetLayout)

      /* ── 画布尺寸（DPR 感知） ── */
      function resize() {
        try {
          let w = 0, hh = 0
          if (wrap && typeof wrap.getBoundingClientRect === 'function') {
            const r = wrap.getBoundingClientRect()
            w = r && r.width ? r.width : 0
            hh = r && r.height ? r.height : 0
          }
          if (!w) w = canvas.clientWidth || 640
          if (!hh) hh = canvas.clientHeight || 420
          W = Math.max(120, Math.round(w))
          H = Math.max(120, Math.round(hh))
          const prevW = W, prevH = H
          canvas.width = Math.round(W * dpr)
          canvas.height = Math.round(H * dpr)
          if (canvas.style) { canvas.style.width = '100%'; canvas.style.height = '100%' }
          if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          if (!sized) {
            sized = true
            // 首次拿到尺寸：预收敛到稳态 → 适配视口 → 停止在线物理（省电且不抖）
            relax(140)
          }
          // 视口尺寸变化：用户没有手动缩放/平移过时，重新适配（否则图会溢出画布）
          // 修复点：首帧 wrap 尺寸可能为 0（按 640×420 兜底算 fit），真实尺寸到达后必须重算。
          if (!userAdjusted) fit()
          alpha = 0
          autoFitted = true
        } catch { W = 640; H = 420 }
      }

      /* ── 坐标换算/命中检测原语在 graph-physics.ts（worldOf/localPt/hitTest，
         调用点穿线共享状态；metaOf 等元数据原语同在物理模块） ── */

      /**
       * 预收敛（v1.8.0）：同步跑若干 FR 迭代把图先收敛到一个稳定、适合画布的形状，
       * 再 fit() 适配视口。理由：纯在线 rAF 力模拟会在几十帧里持续膨胀，
       * 用户打开图谱时先看到「糊成一团」再看到「飞出画布」，体验与可读性都差。
       * 这里用「较少迭代 + 温度调度（位移随迭代衰减）」得到与在线模拟相同的稳态，
       * 却在一帧内完成（141 节点 × 120 迭代 ≈ 数万次运算，实测 < 30ms）。
       * 确定性：初始化用 id 散列（无 Math.random），迭代顺序固定 → 每次打开位置一致。
       */
      function relax(iterations: any, temperature?: any) {
        try {
          const n = simNodes.length
          if (!n) return
          const T0 = typeof temperature === 'number' ? temperature : Math.max(W, H) * 0.16
          const savedAlpha = alpha
          for (let it = 0; it < iterations; it++) {
            alpha = Math.max(0.02, 1 - it / Math.max(1, iterations))
            step(simNodes, simEdges, alpha, W, H, zoom)
            // 温度调度：限制单步位移，避免早期炸开、后期震荡
            const T = T0 * (1 - it / Math.max(1, iterations)) + 1
            for (const a of simNodes) {
              const sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
              if (sp > T) { a.vx = a.vx / sp * T; a.vy = a.vy / sp * T }
            }
            for (const a of simNodes) { a.x += a.vx; a.y += a.vy; a.vx = 0; a.vy = 0 }
          }
          alpha = savedAlpha
        } catch {}
      }

      /* ── 物理步进 step / 渲染 draw（FR 力模型 + 标签去重叠）在 graph-physics.ts，
         调用点经同名参数穿线（step 见 relax/frame；draw 见 frame）；applyLayered 同。 ── */

      /* ── 帧循环：alpha 稳定后自动停 rAF（省电） ── */
      function frame() {
        raf = null
        try {
          if (alpha > 0.02) {
            step(simNodes, simEdges, alpha, W, H, zoom)
            alpha *= 0.986
            if (alpha <= 0.02) alpha = 0
          }
          draw(ctx, dpr, W, H, zoom, panX, panY, hoverId, selectedId, simNodes, simEdges, byId, view, pathNodeSet, pathEdgeSet, hoverPos, focusSet, nodeMeta, edgeMeta)
          // FR 力模型跑开后图会扩张到远超初始视口；冷却结束时自动适配一次
          // （只在「自然冷却到 0」时触发，用户交互 kick 不会反复抖动视图）
          if (alpha === 0 && !autoFitted) { autoFitted = true; fit() }
        } catch {}
        if (alpha > 0.02) schedule()
      }
      function schedule() { if (!raf) { try { raf = rafFn(frame) } catch { raf = null } } }
      function kick(boost: any) { autoFitted = false; alpha = Math.max(alpha, typeof boost === 'number' ? boost : 0.6); schedule() }
      function requestDraw() { kick(0) }

      /* ── 视图适配/聚焦 ── */
      function fit() {
        try {
          userAdjusted = false
          const list = simNodes.filter((n: any) => nodeVisible(n, view, focusSet))
          if (!list.length) { zoom = 1; panX = W / 2; panY = H / 2; requestDraw(); return }
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const n of list) {
            if (n.x < minX) minX = n.x
            if (n.y < minY) minY = n.y
            if (n.x > maxX) maxX = n.x
            if (n.y > maxY) maxY = n.y
          }
          // 标签画在节点圆心下方（半径 + 字号），所以「真实可视占用」是
          // [minY, maxY + 标签高度]。两个修正必须同时做，否则贴边：
          //   ① 高度按「节点 bbox + 下方标签余量」放大
          //   ② 纵向中心按下移后的区间中心平移（否则底部仍溢出）
          const LABEL_PAD = 26
          const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY + LABEL_PAD)
          zoom = graphClamp(Math.min((W - 96) / bw, (H - 48) / bh), 0.1, 4)
          panX = W / 2 - ((minX + maxX) / 2) * zoom
          panY = H / 2 - ((minY + maxY + LABEL_PAD) / 2) * zoom
          requestDraw()
        } catch {}
      }
      function reset() {
        try {
          for (const n of simNodes) { n.pinned = false; n.vx = 0; n.vy = 0 }
          // 重置 = 回到确定性初值再预收敛（不是把力模拟重新烧一遍）
          for (let i = 0; i < simNodes.length; i++) {
            const n = simNodes[i]
            const ang = (i / Math.max(1, simNodes.length)) * Math.PI * 2 + graphHash(n.id + '#a') * 0.7
            const rad = BASE_R * (0.7 + graphHash(n.id + '#r') * 0.55)
            n.x = Math.cos(ang) * rad * 1.3
            n.y = Math.sin(ang) * rad
          }
          relax(140)
          fit()
          alpha = 0
          autoFitted = true
          requestDraw()
        } catch {}
      }
      function focusNode(id: any) {
        try {
          const n = byId[id]
          if (!n) return
          zoom = Math.max(zoom, 0.9)
          panX = W / 2 - n.x * zoom
          panY = H / 2 - n.y * zoom
          requestDraw()
        } catch {}
      }

      /* ── 对外 API ── */
      function setLayout(mode: any) {
        try {
          layoutMode = mode === 'layered' ? 'layered' : 'force'
          if (layoutMode === 'layered') { applyLayered(simNodes, layers, nodeMeta); alpha = 0; fit() }
          else {
            // 力导向：从当前位置松弛到稳态后适配（不启动长时间在线模拟）
            relax(90)
            fit()
            alpha = 0
            autoFitted = true
          }
          requestDraw()
        } catch {}
      }
      function setView(v: any) {
        try {
          if (!v) return
          view.hiddenTypes = (v.hiddenTypes instanceof Set) ? v.hiddenTypes : new Set(v.hiddenTypes || [])
          view.hiddenEdges = (v.hiddenEdges instanceof Set) ? v.hiddenEdges : new Set(v.hiddenEdges || [])
          view.showOrphans = v.showOrphans !== false
          view.showLabels = v.showLabels !== false
          selectedId = v.selected || null
          requestDraw()
        } catch {}
      }
      function setPath(ids: any) {
        try {
          if (!ids || !ids.length) { pathNodeSet = null; pathEdgeSet = null; requestDraw(); return }
          pathNodeSet = new Set(ids)
          pathEdgeSet = new Set()
          for (let i = 0; i < ids.length - 1; i++) {
            const a = indexById[String(ids[i])], b = indexById[String(ids[i + 1])]
            if (a != null && b != null) pathEdgeSet.add(Math.min(a, b) + '-' + Math.max(a, b))
          }
          requestDraw()
          kick(0.25)
        } catch {}
      }
      function setFocus(id: any) {
        try {
          if (!id) { focusSet = null; requestDraw(); return }
          const set = new Set([String(id)])
          for (const e of simEdges) {
            const a = simNodes[e.a], b = simNodes[e.b]
            if (!a || !b) continue
            if (a.id === id) set.add(b.id)
            else if (b.id === id) set.add(a.id)
          }
          focusSet = set
          selectedId = String(id)
          fit()
          requestDraw()
        } catch {}
      }

      /* ── 事件（原生监听：wheel 必须 passive:false 才能 preventDefault） ── */
      function applyZoomAt(nextZoom: any, sx: any, sy: any) {
        const z = graphClamp(nextZoom, 0.1, 4)
        if (!isFinite(z) || z === zoom) return
        panX = sx - (sx - panX) * (z / zoom)
        panY = sy - (sy - panY) * (z / zoom)
        zoom = z
        userAdjusted = true      // 用户接管视图后，resize 不再强制 fit
        requestDraw()
      }
      function onWheel(ev: any) {
        try {
          if (ev.preventDefault) ev.preventDefault()
          const p = localPt(ev, canvas)
          applyZoomAt(zoom * Math.exp(-(ev.deltaY || 0) * 0.0015), p.x, p.y)
        } catch {}
      }
      function onDown(ev: any) {
        try {
          if (ev.button !== undefined && ev.button > 0) return
          const p = localPt(ev, canvas)
          pointers.set(ev.pointerId, p)
          try { if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId) } catch {}
          if (pointers.size === 2) {
            const arr = Array.from(pointers.values()) as any[]
            const p1 = arr[0], p2 = arr[1]
            pinch = { dist: Math.sqrt((p1.x - p2.x) * (p1.x - p2.x) + (p1.y - p2.y) * (p1.y - p2.y)) || 1 }
            drag = null
            pan = null
            return
          }
          if (pointers.size > 2) return
          downPt = p
          const hit = hitTest(p.x, p.y, simNodes, view, focusSet, zoom, panX, panY)
          if (hit) drag = { id: hit.id, moved: false }
          else pan = { x: p.x, y: p.y, panX, panY, moved: false }
        } catch {}
      }
      function onMove(ev: any) {
        try {
          const p = localPt(ev, canvas)
          hoverPos = p
          if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p)
          if (pinch && pointers.size === 2) {
            const arr = Array.from(pointers.values()) as any[]
            const p1 = arr[0], p2 = arr[1]
            const d = Math.sqrt((p1.x - p2.x) * (p1.x - p2.x) + (p1.y - p2.y) * (p1.y - p2.y)) || 1
            applyZoomAt(zoom * (d / pinch.dist), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
            pinch.dist = d
            return
          }
          if (drag) {
            const node = byId[drag.id]
            if (!node) return
            const moved = Math.abs(p.x - downPt.x) + Math.abs(p.y - downPt.y) > 3
            if (moved) drag.moved = true
            if (drag.moved) {
              const w = worldOf(p.x, p.y, zoom, panX, panY)
              node.x = w.x
              node.y = w.y
              node.vx = 0
              node.vy = 0
              node.pinned = true          // 拖拽即钉住（pin），重置视图可解钉
              alpha = Math.max(alpha, 0.25)
              kick(0.25)
              return
            }
          }
          if (pan) {
            pan.moved = Math.abs(p.x - pan.x) + Math.abs(p.y - pan.y) > 3
            if (pan.moved) userAdjusted = true
            panX = pan.panX + (p.x - pan.x)
            panY = pan.panY + (p.y - pan.y)
            if (canvas.style) canvas.style.cursor = 'grabbing'
            requestDraw()
            return
          }
          const hit = hitTest(p.x, p.y, simNodes, view, focusSet, zoom, panX, panY)
          const hId = hit ? hit.id : null
          if (canvas.style) canvas.style.cursor = hId ? 'pointer' : 'grab'
          if (hId !== hoverId) { hoverId = hId; requestDraw() }
          else if (hId) requestDraw()
        } catch {}
      }
      function onUp(ev: any) {
        try {
          const p = localPt(ev, canvas)
          pointers.delete(ev.pointerId)
          if (pointers.size < 2) pinch = null
          if (drag) {
            if (drag.moved) kick(0.35)
            else {
              // 单击：选中；Shift+点击 = 路径分析（A→B）
              const node = byId[drag.id]
              if (node) {
                if (ev.shiftKey && selectedId && selectedId !== node.id) onRequestPath(selectedId, node.id)
                else onSelect(node.id)
              }
            }
            drag = null
          } else if (pan) {
            if (!pan.moved) onSelect(null)   // 点空白 = 关闭详情
            pan = null
          }
          downPt = null
          if (canvas.style) canvas.style.cursor = hoverId ? 'pointer' : 'grab'
        } catch {}
      }
      function onLeave() {
        try { hoverId = null; hoverPos = null; requestDraw() } catch {}
      }
      function onDblClick(ev: any) {
        try {
          const p = localPt(ev, canvas)
          const hit = hitTest(p.x, p.y, simNodes, view, focusSet, zoom, panX, panY)
          if (hit) { setFocus(hit.id); onSelect(hit.id) }   // 双击节点 = 聚焦 1 跳邻域
          else reset()                                       // 双击空白 = 重置视图
        } catch {}
      }

      /* ── 装配 / 销毁 ── */
      let ro: any = null
      try {
        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onUp)
        canvas.addEventListener('pointerleave', onLeave)
        canvas.addEventListener('wheel', onWheel, { passive: false })
        canvas.addEventListener('dblclick', onDblClick)
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => { try { resize(); requestDraw() } catch {} })
          ro.observe(wrap || canvas)
        } else if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener('resize', resize)
        }
      } catch {}

      resize()
      schedule()

      return {
        ok: true,
        kick: kick,
        requestDraw: requestDraw,
        destroy() {
          try {
            if (raf != null) cafFn(raf)
            raf = null
            canvas.removeEventListener('pointerdown', onDown)
            canvas.removeEventListener('pointermove', onMove)
            canvas.removeEventListener('pointerup', onUp)
            canvas.removeEventListener('pointercancel', onUp)
            canvas.removeEventListener('pointerleave', onLeave)
            canvas.removeEventListener('wheel', onWheel)
            canvas.removeEventListener('dblclick', onDblClick)
            if (ro && ro.disconnect) ro.disconnect()
            if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', resize)
          } catch {}
        },
        setLayout: setLayout,
        setView: setView,
        setPath: setPath,
        setFocus: setFocus,
        fit: fit,
        reset: reset,
        focusNode: focusNode,
        resize: resize,
        layoutMode: () => layoutMode,
      }
    }