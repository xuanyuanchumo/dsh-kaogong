/**
 * graph-engine.ts — createGraphEngine 主体（cycle-13 T-025 复杂度拆分后）
 *
 * 保留：引擎状态与闭包写路径（alpha/zoom/pan/raf/事件族/装配销毁/对外 API）。
 * 外提：只读型物理/渲染/查询原语在 ./graph-physics.ts（同名参数在调用点穿线，
 * 读取语义 = 调用时刻闭包值，行为逐字节等价）；模型构建 = buildGraphModel。
 */

import { graphClamp, GRAPH_NODE_META, GRAPH_EDGE_META, graphEngineStub } from './graph-analytics.js'
import { buildGraphModel, step, draw, applyLayered, nodeVisible, worldOf, localPt, hitTest, drawMini, miniTransform, miniToWorld,
         graphViewBBox, graphRelaxIntegrate, graphResetInitialCoords, graphPathEdgeSet, graphNeighborSet } from './graph-physics.js'
import { GRAPH_TRANS_DUR, graphTransProgress, graphTransEase, graphTransSnapshotFrom, graphTransSnapshotTo, graphTransRestoreFrom,
         graphTransLerpCoords, graphTransSnapCoords, graphViewportOf, graphMergeViewFilters } from './graph-transition.js'
import { graphMeasureSize, graphApplyCanvasSize, graphSetCursor, graphBindMiniMap, graphUnbindMiniMap } from './graph-canvas.js'

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
      // 过渡动画时钟：rAF 时间戳与 performance.now 同源；setTimeout 兜底时退化为 Date.now
      const nowFn: any = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
        ? () => performance.now()
        : () => Date.now()

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

      /* ── W2b 新增状态：着色模型 + 布局过渡动画 ──
         colorModel：graphPaintModel 产物 {colors,radius,legend}，null = 类型着色（旧行为）；
         radiusBoost 与 colorModel 一起经 setView 传入（只影响绘制半径，不影响布局/hitTest）；
         trans：350ms 布局过渡（force↔layered），过渡期物理步进暂停。 */
      let colorModel: any = null
      let radiusBoost = false
      const trans: any = { active: false, t0: 0, dur: 350, fx: null, fy: null, tx: null, ty: null }
      // 脉冲环限频：hover/选中存在时以 ~30fps 重绘（60fps 裸跑会翻倍每秒工作量）
      let lastPulseDraw = 0

      /* ── W2b 小地图：右下角 150×100 覆盖层（HTML 容器内嵌小 canvas 由视图传入）。
            引擎负责：DPR 尺寸设置、每帧 drawMini、点击/拖拽 → 受控平移。 ── */
      const miniCanvas: any = (cfg && cfg.miniCanvas) || null
      const MINI_W = 150, MINI_H = 100
      const miniDpr = dpr
      let miniCtx: any = null
      let miniDrag = false

      /* ── 节点/边模型：构建在 graph-physics.ts 的 buildGraphModel（逐字节等价外提；
         BASE_R 随模型返回，reset 与初值共用同一确定性来源） ── */
      const { simNodes, simEdges, byId, indexById, BASE_R } = buildGraphModel(nodesIn, edgesIn, presetLayout)

      /* ── 画布尺寸（DPR 感知）：测量/应用段外提 graph-canvas.ts（只写 canvas/ctx 堆对象），
            W/H 引擎原语赋值与首次收敛/适配编排留在本闭包 ── */
      function resize() {
        try {
          const ms = graphMeasureSize(wrap, canvas)
          W = ms.w
          H = ms.h
          const prevW = W, prevH = H
          graphApplyCanvasSize(canvas, ctx, W, H, dpr)
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
            // 温度调度：限制单步位移，避免早期炸开、后期震荡（限速+积分外提为 graphRelaxIntegrate）
            const T = T0 * (1 - it / Math.max(1, iterations)) + 1
            graphRelaxIntegrate(simNodes, T)
          }
          alpha = savedAlpha
        } catch {}
      }

      /* ── 物理步进 step / 渲染 draw（FR 力模型 + 标签去重叠）在 graph-physics.ts，
         调用点经同名参数穿线（step 见 relax/frame；draw 见 frame）；applyLayered 同。 ── */

      /* ── W2b：布局过渡插值（~350ms ease-in-out）。起点/终点坐标在 setLayout 里
            一次性确定（终点 = 与「无动画」路径完全相同的确定性布局结果）；
            过渡期物理步进暂停（alpha 保持 0），插值只写过渡态坐标，终态深相等。
            插值计算段（进度/缓动/坐标插值/终态回写）已外提 graph-transition.ts，
            本函数只保留「写引擎原语」（trans.active / alpha / autoFitted / fit）的编排。 ── */
      function stepTrans(now: any) {
        try {
          const t = graphTransProgress(now, trans.t0, trans.dur)
          graphTransLerpCoords(simNodes, trans.fx, trans.fy, trans.tx, trans.ty, graphTransEase(t))
          if (t >= 1) {
            // 终态：精确回写目标坐标（保证与无动画路径深相等）→ fit 适配 → 停物理
            graphTransSnapCoords(simNodes, trans.tx, trans.ty)
            trans.active = false
            alpha = 0
            autoFitted = true
            fit()
          }
        } catch { trans.active = false }
      }

      /* ── 帧循环：alpha 稳定后自动停 rAF（省电）；过渡/脉冲期间按需续帧 ── */
      function frame(ts: any) {
        raf = null
        const now = (typeof ts === 'number' && isFinite(ts)) ? ts : nowFn()
        let busy = false
        try {
          if (trans.active) {
            // 过渡优先：物理步进暂停，只做坐标插值
            stepTrans(now)
            busy = trans.active
          } else if (alpha > 0.02) {
            step(simNodes, simEdges, alpha, W, H, zoom)
            alpha *= 0.986
            if (alpha <= 0.02) alpha = 0
            busy = alpha > 0.02
          }
          // 脉冲限频：无物理/过渡时 hover/选中脉冲按 ~30fps 重绘（每帧工作量受控）
          const pulseOn = !!(hoverId || selectedId)
          if (!busy && pulseOn && now - lastPulseDraw < 30) { schedule(); return }
          if (pulseOn || busy) lastPulseDraw = now
          const ph = pulseOn ? (now % 1600) / 1600 : 0.5
          // 主画布：新增绘制状态（着色/脉冲相位）经选项对象 o 穿线
          draw(ctx, dpr, W, H, zoom, panX, panY, {
            hoverId, selectedId, simNodes, simEdges, byId, view, pathNodeSet, pathEdgeSet,
            hoverPos, focusSet, nodeMeta, edgeMeta, colorModel, pulse: ph,
          })
          // 小地图：同一帧内绘制（数据/视口/着色天然一致，无第二循环）
          if (miniCtx) {
            drawMini(miniCtx, miniDpr, MINI_W, MINI_H, {
              simNodes, zoom, panX, panY, W, H, colorModel, nodeMeta, view, focusSet,
            })
          }
          // FR 力模型跑开后图会扩张到远超初始视口；冷却结束时自动适配一次
          // （只在「自然冷却到 0」时触发，用户交互 kick 不会反复抖动视图）
          if (alpha === 0 && !autoFitted && !trans.active) { autoFitted = true; fit() }
        } catch {}
        if (busy || hoverId || selectedId) schedule()
      }
      function schedule() { if (!raf) { try { raf = rafFn(frame) } catch { raf = null } } }
      function kick(boost: any) { autoFitted = false; alpha = Math.max(alpha, typeof boost === 'number' ? boost : 0.6); schedule() }
      // W2b 修复：requestDraw 语义 = 「只重绘一帧」。原实现 kick(0) 会顺带把 autoFitted
      // 清回 false —— 冷却结束的 fit() 内部调 requestDraw 又把 autoFitted 打回 false，
      // 下一帧再触发布局后自适应 → 无限 60fps 重绘循环（交互结束后 CPU 常驻高占用）。
      // kick(0) 本就不抬升 alpha（max(alpha,0)），去掉 autoFitted 副作用后视觉行为不变，
      // 且冷却自适应恰好执行一次后 rAF 正确停止（省电视铁律）。
      function requestDraw() { schedule() }

      /* ── 视图适配/聚焦 ── */
      function fit() {
        try {
          userAdjusted = false
          const list = simNodes.filter((n: any) => nodeVisible(n, view, focusSet))
          if (!list.length) { zoom = 1; panX = W / 2; panY = H / 2; requestDraw(); return }
          // 包围盒计算段外提 graph-physics.ts（纯读，min/max 四元组同名穿线）
          const { minX, minY, maxX, maxY } = graphViewBBox(list)
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
          trans.active = false   // 重置走确定性路径，进行中的过渡作废
          // 重置 = 回到确定性初值再预收敛（不是把力模拟重新烧一遍；初值段外提 graph-physics.ts）
          graphResetInitialCoords(simNodes, BASE_R)
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

      /* ── W2b 视口查询与受控平移（小地图/键盘快捷键消费） ── */
      /** 受控平移：把世界点 (wx,wy) 平移到画布中心（小地图点击/拖拽的落点）。
       *  用户接管语义：标记 userAdjusted（resize 不再强制 fit），并终止进行中的过渡。 */
      function panTo(wx: any, wy: any) {
        try {
          if (!isFinite(wx) || !isFinite(wy)) return
          trans.active = false            // 手动接管视口 → 过渡态作废
          panX = W / 2 - wx * zoom
          panY = H / 2 - wy * zoom
          userAdjusted = true
          requestDraw()
        } catch {}
      }
      /** 受控缩放：以画布中心为锚点乘性缩放（键盘 +/− 快捷键；f≈1.25 一档） */
      function zoomBy(f: any) {
        try {
          const k = Number(f)
          if (!isFinite(k) || k <= 0 || k === 1) return
          applyZoomAt(zoom * k, W / 2, H / 2)
        } catch {}
      }

      /* ── W2b 小地图交互：点击/拖拽 → 换算世界坐标 → panTo 受控平移。
            与主画布共用 miniTransform 映射（绘制与拾取一致）。 ── */
      function miniPanTo(ev: any) {
        try {
          if (!miniCanvas) return
          const p = localPt(ev, miniCanvas)
          const tr = miniTransform(simNodes, MINI_W, MINI_H)
          if (tr.empty || !tr.s) return
          const w = miniToWorld(p.x, p.y, tr)
          panTo(w.x, w.y)
        } catch {}
      }
      function onMiniDown(ev: any) {
        try {
          miniDrag = true
          try { if (miniCanvas && miniCanvas.setPointerCapture) miniCanvas.setPointerCapture(ev.pointerId) } catch {}
          miniPanTo(ev)
        } catch {}
      }
      function onMiniMove(ev: any) {
        try { if (miniDrag) miniPanTo(ev) } catch {}
      }
      function onMiniUp() { try { miniDrag = false } catch {} }

      /* ── 对外 API ── */
      /**
       * 布局切换（W2b：~350ms ease-in-out 过渡动画）。
       * 终态与「无动画」路径逐字节相同：layered = applyLayered(+fit)，force = relax(90)(+fit)；
       * 实现要点：① 记录起点坐标 → ② 按原路径计算目标（此刻节点坐标即终态）→
       * ③ 快照终点 → ④ 回写起点 → ⑤ rAF 内插值到终点，过渡期物理步进暂停。
       * 确定性：动画只影响过渡态，终点坐标精确回写 → 同输入布局结果深相等。
       */
      function setLayout(mode: any) {
        try {
          const target = mode === 'layered' ? 'layered' : 'force'
          const V = simNodes.length
          // ① 起点坐标快照（纯读外提 graph-transition.ts，同名参数穿线）
          const { fx, fy } = graphTransSnapshotFrom(simNodes)
          // ② 终态计算（与无动画路径完全一致的确定性结果；applyLayered/relax 原地写坐标）
          if (target === 'layered') applyLayered(simNodes, layers, nodeMeta)
          else relax(90)
          // ③ 终点快照 + 总位移（用于「已在目标布局」时跳过动画）
          const { tx, ty, dist } = graphTransSnapshotTo(simNodes, fx, fy)
          layoutMode = target
          alpha = 0
          if (!V || dist < 1) {
            // 无位移（V=0 或重复切换到当前布局）：直接呈现终态（与旧行为一致）
            trans.active = false
            fit()
            autoFitted = true
            requestDraw()
            return
          }
          // ④ 回写起点 → ⑤ 启动过渡（fit 延迟到过渡结束，避免中途视图跳动）
          graphTransRestoreFrom(simNodes, fx, fy)
          trans.active = true
          trans.t0 = nowFn()
          trans.dur = GRAPH_TRANS_DUR
          trans.fx = fx; trans.fy = fy; trans.tx = tx; trans.ty = ty
          requestDraw()
        } catch { trans.active = false }
      }
      /**
       * 视图状态同步（W2b：改为「字段级合并」语义——未出现的字段保持现值）。
       * 原因：视图层有多个独立 effect 分别传过滤/着色/选中，整体覆盖会互相踩掉
       * 对方刚设置的 colorModel 等；字段级合并让各 effect 只声明自己关心的字段。
       */
      function setView(v: any) {
        try {
          if (!v) return
          // 过滤/开关字段级合并外提 graph-transition.ts（只写 view 堆对象属性）
          graphMergeViewFilters(view, v)
          if (v.selected !== undefined) selectedId = v.selected || null
          if (v.colorModel !== undefined) colorModel = (v.colorModel && typeof v.colorModel === 'object') ? v.colorModel : null
          if (v.radiusBoost !== undefined) radiusBoost = !!v.radiusBoost
          requestDraw()
        } catch {}
      }
      function setPath(ids: any) {
        try {
          if (!ids || !ids.length) { pathNodeSet = null; pathEdgeSet = null; requestDraw(); return }
          pathNodeSet = new Set(ids)
          // 路径边集计算段外提 graph-physics.ts（纯读，ids/simEdges/indexById 同名穿线）
          pathEdgeSet = graphPathEdgeSet(ids, simEdges, indexById)
          requestDraw()
          kick(0.25)
        } catch {}
      }
      function setFocus(id: any) {
        try {
          if (!id) { focusSet = null; requestDraw(); return }
          // 1 跳邻域集计算段外提 graph-physics.ts（纯读，遍历顺序固定 → 确定性）
          focusSet = graphNeighborSet(id, simNodes, simEdges)
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
          // 用户触碰画布 = 接管视口/节点 → 进行中的布局过渡立即作废（过渡只属过渡态）
          if (trans.active) { trans.active = false; alpha = 0 }
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
            graphSetCursor(canvas, 'grabbing')
            requestDraw()
            return
          }
          const hit = hitTest(p.x, p.y, simNodes, view, focusSet, zoom, panX, panY)
          const hId = hit ? hit.id : null
          graphSetCursor(canvas, hId ? 'pointer' : 'grab')
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
          graphSetCursor(canvas, hoverId ? 'pointer' : 'grab')
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
        // 小地图：DPR 感知尺寸 + 交互绑定（装配原语在 graph-canvas.ts；与 destroy 解绑严格成对）
        if (miniCanvas) {
          miniCtx = graphBindMiniMap(miniCanvas, miniDpr, MINI_W, MINI_H, { onMiniDown, onMiniMove, onMiniUp })
        }
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
            // 小地图解绑（与装配成对；多余解绑对未绑定的监听是安全 no-op）
            graphUnbindMiniMap(miniCanvas, { onMiniDown, onMiniMove, onMiniUp })
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
        // ── W2b 新增 API ──
        getViewport: () => graphViewportOf(zoom, panX, panY, W, H),   // 视口查询（世界矩形 + 缩放 + 屏幕尺寸；纯计算外提）
        panTo: panTo,               // 受控平移（世界点 → 画布中心）
        zoomBy: zoomBy,             // 受控缩放（画布中心锚点，键盘 +/−）
      }
    }