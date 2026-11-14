/**
 * graph-physics.ts — 图谱引擎物理/渲染/查询原语（cycle-13 T-025 复杂度拆分）
 *
 * 实测 createGraphEngine 单函数复杂度 260 > 预算 180，且内部函数与引擎共享可变
 * 状态（zoom/pan/alpha/simNodes…）为深度闭包，无法直接外提。拆法（行为等价）：
 *  · 只读共享状态的函数（step/draw/applyLayered/worldOf/localPt/hitTest 及
 *    metaOf 等小原语）外提至本模块：原闭包变量改为【同名参数】在调用点穿线——
 *    「读调用时刻的闭包值」与「读调用时刻的实参」语义一致，函数体逐字节未动。
 *  · 需要写引擎原语状态（alpha/zoom/panX/panY/raf…）的函数（relax/fit/reset/
 *    frame/事件族/装配）留在 graph-engine.ts，闭包语义原样保留。
 *  · 本模块对共享状态只读；唯一写入是节点对象属性（本就是堆上共享对象，与
 *    原实现一致）。节点/边模型构建（buildGraphModel）为纯函数，确定性初始化。
 */

import { graphHash, graphClamp, graphShade, GRAPH_NODE_META, GRAPH_EDGE_META } from './graph-analytics.js'

    /** cycle-15：流动粒子语义边集合（produces/consumes/feeds/serves = 注册→生产→消费 的数据流关系） */
    const KG_FLOW_RELS = ['produces', 'consumes', 'feeds', 'serves']

    /* ── 节点/边模型（服务端边缺失端点时直接跳过该边，不抛错） ── */
    /** buildGraphModel — 原 createGraphEngine 内联模型构建段逐字节等价外提；
     *  BASE_R 随模型返回，供引擎 reset 复用同一确定性初值（v1.8 事故簿契约）。 */
    export function buildGraphModel(nodesIn: any[], edgesIn: any[], presetLayout: any): any {
      const simNodes: any[] = []
      const byId: any = {}
      const indexById: any = {}
      // 力学参数（v1.8.0 重标定）：原 LINK=90/REP=9000/向心 0.004 在 V≈140 时
      // 弹簧与向心压过斥力 → 全图塌缩成中心一团（标签 100% 重叠、不可读）。
      // 现按「节点数自适应」标定：斥力随 V 放大、弹簧随 V 拉长、向心减半。
      const BASE_R = 300, BASE_W = 520, BASE_H = 380
      const VN = Math.max(1, nodesIn.length)
      const LINK = Math.round(110 + Math.min(70, VN * 0.5))          // 140 节点 → 180
      const REP = Math.round(9000 * Math.max(1, VN / 60))            // 140 节点 → 21000
      const GRAVITY = 0.0016                                          // 向心：0.004 → 0.0016
      for (let i = 0; i < nodesIn.length; i++) {
        const n = nodesIn[i] || {}
        const id = String(n.id == null ? 'n' + i : n.id)
        if (byId[id]) continue
        const lp = presetLayout && presetLayout[id]
        let x: number, y: number
        if (lp && isFinite(lp.x) && isFinite(lp.y)) {
          // 服务端归一化 0..1 → 世界坐标（确定性，无随机）
          x = (Number(lp.x) - 0.5) * 2 * BASE_W
          y = (Number(lp.y) - 0.5) * 2 * BASE_H
        } else {
          // 降级初始化：圆环 + id 散列抖动（可复现；不用 Math.random）
          const ang = (i / Math.max(1, nodesIn.length)) * Math.PI * 2 + graphHash(id + '#a') * 0.7
          const rad = BASE_R * (0.7 + graphHash(id + '#r') * 0.55)
          x = Math.cos(ang) * rad * 1.3
          y = Math.sin(ang) * rad
        }
        const node = { id, type: String(n.type || 'unknown'), label: String(n.label == null ? id : n.label), x, y, vx: 0, vy: 0, pinned: false, deg: 0, idx: simNodes.length }
        byId[id] = node
        indexById[id] = node.idx
        simNodes.push(node)
      }
      const simEdges: any[] = []
      for (const e of edgesIn) {
        if (!e || !e.source || !e.target) continue
        const a = byId[String(e.source)], b = byId[String(e.target)]
        if (!a || !b || a === b) continue
        simEdges.push({ a: a.idx, b: b.idx, rel: String(e.rel || ''), w: Number(e.w) || 1 })
      }
      for (const e of simEdges) { simNodes[e.a].deg++; simNodes[e.b].deg++ }
      return { simNodes, simEdges, byId, indexById, BASE_R }
    }

      function metaOf(type: any, nodeMeta: any) {
        return (nodeMeta && nodeMeta[type]) || GRAPH_NODE_META[type] || { label: String(type || '未知'), color: '#94a3b8', icon: '•', layer: 0 }
      }
      function colorOfEdge(rel: any, edgeMeta: any) {
        const m = (edgeMeta && edgeMeta[rel]) || GRAPH_EDGE_META[rel]
        return (m && m.color) || '#94a3b8'
      }
      function screenRadius(n: any, zoom: any) {
        const world = 5 + Math.min(9, Math.sqrt(Math.max(0, n.deg)) * 2.4)
        return graphClamp(world * zoom, 3, 30)
      }
      export function nodeVisible(n: any, view: any, focusSet: any) {
        if (!n) return false
        if (view.hiddenTypes.has(n.type)) return false
        if (!view.showOrphans && n.deg === 0) return false
        if (focusSet && !focusSet.has(n.id)) return false
        return true
      }
      function neighborSetOf(id: any, simNodes: any, simEdges: any) {
        const set = new Set()
        if (!id) return set
        for (const e of simEdges) {
          const a = simNodes[e.a], b = simNodes[e.b]
          if (!a || !b) continue
          if (a.id === id) set.add(b.id)
          else if (b.id === id) set.add(a.id)
        }
        return set
      }
      function edgeKey(e: any) { return Math.min(e.a, e.b) + '-' + Math.max(e.a, e.b) }

      /* ── 坐标换算 ── */
      export function worldOf(sx: any, sy: any, zoom: any, panX: any, panY: any) { return { x: (sx - panX) / zoom, y: (sy - panY) / zoom } }
      export function localPt(ev: any, canvas: any) {
        let sx = 0, sy = 0
        try {
          const r = canvas.getBoundingClientRect()
          sx = ev.clientX - r.left
          sy = ev.clientY - r.top
        } catch {}
        return { x: sx, y: sy }
      }
      export function hitTest(sx: any, sy: any, simNodes: any, view: any, focusSet: any, zoom: any, panX: any, panY: any) {
        let best = null, bestD = Infinity
        for (let i = simNodes.length - 1; i >= 0; i--) {
          const n = simNodes[i]
          if (!nodeVisible(n, view, focusSet)) continue
          const px = n.x * zoom + panX, py = n.y * zoom + panY
          const d = Math.sqrt((px - sx) * (px - sx) + (py - sy) * (py - sy))
          if (d <= screenRadius(n, zoom) + 4 && d < bestD) { best = n; bestD = d }
        }
        return best
      }

      /* ── 物理步进（v1.8.0 重写：Fruchterman-Reingold 风格）──
         原实现是「凭空斥力 + 定长弹簧」，两个缺陷：
         ① 斥力对全部点对同权，中心枢纽（度 60+）与其 60 个邻居被同量推开，
            但弹簧又把它们全部拉回 LINK 处 → 邻居在中心半径 ~LINK 的环上挤成一圈；
         ② 没有「理想边长」概念，节点度数差异无法反映到几何（deg 61 与 deg 1 同样距离）。
         现改用 FR 经典形式：
           k = sqrt(area / V)              —— 理想边长（由画布面积与节点数导出）
           fa(d) = k²/d                     —— 斥力（与距离成反比，近处急剧增大）
           fr(d) = d²/k                     —— 引力（远处强，近处弱）
         并按度加权理想边长 k_ij = k·(1 + log2(1+min(deg_i,deg_j))/4)：
         高度节点拥有更长的边 → 枢纽自然撑开，叶子紧密成簇。 */

      /* ── 物理步进 ── */
      export function step(simNodes: any, simEdges: any, alpha: any, W: any, H: any, zoom: any) {
        const n = simNodes.length
        if (!n) return
        const a0 = Math.max(0.02, alpha)
        const stride = n > 600 ? Math.ceil(n / 600) : 1
        // 理想边长 k：由「可视区域面积 / 节点数」导出（视野随缩放变化，k 只在力模拟用世界坐标）
        const areaW = Math.max(900, W / Math.max(0.2, zoom))
        const areaH = Math.max(700, H / Math.max(0.2, zoom))
        const K = Math.sqrt((areaW * areaH) / Math.max(1, n))
        // ① FR 斥力 fa(d)=k²/d（O(V²)；>600 节点抽样，保持帧预算）
        for (let i = 0; i < n; i++) {
          const a = simNodes[i]
          if (a.pinned) continue
          let fx = 0, fy = 0
          for (let j = 0; j < n; j += stride) {
            if (i === j) continue
            const b = simNodes[j]
            let dx = a.x - b.x, dy = a.y - b.y
            let d2 = dx * dx + dy * dy
            if (d2 < 0.01) {
              // 重合点用确定性散列错开，避免除零
              dx = (graphHash(a.id + '#x') - 0.5) * 0.3 + 0.05
              dy = (graphHash(b.id + '#y') - 0.5) * 0.3 + 0.05
              d2 = dx * dx + dy * dy
            }
            const d = Math.sqrt(d2)
            // fa 与 k²/d 成正比；上限防止极端贴近时数值爆炸
            const f = Math.min((K * K) / d, K * 3)
            fx += (dx / d) * f
            fy += (dy / d) * f
          }
          a.vx += fx * 0.012 * a0
          a.vy += fy * 0.012 * a0
        }
        // ② FR 引力 fr(d)=d²/k，理想边长按两端度加权（枢纽→更长边）
        for (const e of simEdges) {
          const a = simNodes[e.a], b = simNodes[e.b]
          if (!a || !b || a === b) continue
          const dx = b.x - a.x, dy = b.y - a.y
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01
          const dmin = Math.min(a.deg, b.deg)
          const kij = K * (1 + Math.log2(1 + Math.min(60, dmin)) / 5)
          const f = (d * d / kij) * 0.012 * a0
          const ux = dx / d, uy = dy / d
          if (!a.pinned) { a.vx += ux * f; a.vy += uy * f }
          if (!b.pinned) { b.vx -= ux * f; b.vy -= uy * f }
        }
        // 向心 + 阻尼 + 位移
        for (const a of simNodes) {
          if (a.pinned) { a.vx = 0; a.vy = 0; continue }
          // 向心：把整体收在 K*sqrt(V) 量级的盘内（避免孤立簇飘远）
          a.vx += -a.x * (0.0012 * a0)
          a.vy += -a.y * (0.0012 * a0)
          a.vx *= 0.86
          a.vy *= 0.86
          const sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
          if (sp > 40) { a.vx = a.vx / sp * 40; a.vy = a.vy / sp * 40 }
          a.x += a.vx
          a.y += a.vy
        }
      }

      /* ── 渲染 ── */

      /* ── 视觉精灵缓存（W2b 现代化）：径向渐变（主色→提亮高光→压暗边缘）+ 柔和投影
            + 白描边预烘焙成离屏 canvas，每帧只 drawImage——避免逐节点
            createRadialGradient/shadowBlur 的每帧开销。纯视觉缓存：不参与布局、
            不影响确定性；键 = 颜色|半径桶|dpr，超上限防御性清空。 ── */
      const spriteCache = new Map()
      function nodeSprite(color: any, r: any, dpr: any) {
        const rb = Math.max(2, Math.round(r))
        const key = String(color) + '|' + rb + '|' + dpr
        const hit = spriteCache.get(key)
        if (hit) return hit
        try {
          if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
          const pad = Math.ceil(rb * 0.9) + 2
          const size = (rb + pad) * 2
          const cv = document.createElement('canvas')
          cv.width = Math.max(2, Math.ceil(size * dpr))
          cv.height = cv.width
          const c = cv.getContext('2d')
          if (!c) return null
          c.scale(dpr, dpr)
          const cx = rb + pad, cy = rb + pad
          // 柔和投影（烘焙一次，逐帧零成本）
          c.shadowColor = 'rgba(15,23,42,.32)'
          c.shadowBlur = Math.max(3, rb * 0.6)
          c.shadowOffsetY = 1
          // 径向渐变：高光偏左上 → 主色 → 压暗边缘（立体质感）
          const g = c.createRadialGradient(cx - rb * 0.35, cy - rb * 0.4, rb * 0.12, cx, cy, rb)
          g.addColorStop(0, graphShade(color, 0.3))
          g.addColorStop(0.55, color)
          g.addColorStop(1, graphShade(color, -0.36))
          c.beginPath(); c.arc(cx, cy, rb, 0, Math.PI * 2)
          c.fillStyle = g
          c.fill()
          // 1px 白描边烘焙（原逐节点 stroke 移入精灵）
          c.shadowColor = 'transparent'
          c.lineWidth = 1.2
          c.strokeStyle = 'rgba(255,255,255,.95)'
          c.stroke()
          const sp = { cv, logical: size }
          if (spriteCache.size > 1600) spriteCache.clear()   // 防御性上限（渐变模式可能产生大量颜色）
          spriteCache.set(key, sp)
          return sp
        } catch { return null }
      }

      /** 选中/hover 外圈光环脉冲（相位 0..1 由引擎按帧时钟推进；纯过渡视觉，不影响布局） */
      function pulseRing(ctx: any, sx: any, sy: any, r: any, color: any, ph: any) {
        try {
          ctx.beginPath()
          ctx.arc(sx, sy, r + 3 + ph * 8, 0, Math.PI * 2)
          ctx.globalAlpha = (1 - ph) * 0.55
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.globalAlpha = 1
        } catch {}
      }

      /** 圆角矩形路径（标签底板/工具提示；不依赖 ctx.roundRect 以兼容旧 WebView） */
      function roundRectPath(ctx: any, x: any, y: any, w: any, h: any, r: any) {
        const rr = Math.max(0, Math.min(r, w / 2, h / 2))
        ctx.beginPath()
        ctx.moveTo(x + rr, y)
        ctx.arcTo(x + w, y, x + w, y + h, rr)
        ctx.arcTo(x + w, y + h, x, y + h, rr)
        ctx.arcTo(x, y + h, x, y, rr)
        ctx.arcTo(x, y, x + w, y, rr)
        ctx.closePath()
      }

      /* ── 渲染主函数（W2b：新增绘制状态经【选项对象 o】穿线，位置参数不再增长）──
         o: { hoverId, selectedId, simNodes, simEdges, byId, view, pathNodeSet,
              pathEdgeSet, hoverPos, focusSet, nodeMeta, edgeMeta, colorModel, pulse }
         colorModel：graphPaintModel 产物（colors/radius 表）或 null（= 类型着色，旧行为）。 */
      export function draw(ctx: any, dpr: any, W: any, H: any, zoom: any, panX: any, panY: any, o: any) {
        if (!ctx) return
        const hoverId = o && o.hoverId, selectedId = o && o.selectedId
        const simNodes = (o && o.simNodes) || [], simEdges = (o && o.simEdges) || []
        const byId = (o && o.byId) || {}
        const view = (o && o.view) || { hiddenTypes: new Set(), hiddenEdges: new Set(), showOrphans: true, showLabels: true }
        const pathNodeSet = o && o.pathNodeSet, pathEdgeSet = o && o.pathEdgeSet
        const hoverPos = o && o.hoverPos, focusSet = o && o.focusSet
        const nodeMeta = o && o.nodeMeta, edgeMeta = o && o.edgeMeta
        const colorModel = o && o.colorModel
        const pulse = typeof (o && o.pulse) === 'number' ? o.pulse : 0.5
        try {
          if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, W, H)
          ctx.fillStyle = '#f8fafc'
          ctx.fillRect(0, 0, W, H)
          // 背景点阵（随平移/缩放轻微跟随，提供空间参考）
          const gap = graphClamp(30 * zoom, 18, 64)
          ctx.fillStyle = 'rgba(148,163,184,.22)'
          const ox = ((panX % gap) + gap) % gap
          const oy = ((panY % gap) + gap) % gap
          for (let gx = ox; gx < W; gx += gap) for (let gy = oy; gy < H; gy += gap) ctx.fillRect(gx, gy, 1.1, 1.1)

          const active = hoverId || selectedId
          const nbs = active ? neighborSetOf(active, simNodes, simEdges) : null
          // 性能护栏：V<200 才启用二次贝塞尔弧线（控制点确定性）；大图退回直线
          const arcOn = simNodes.length < 200

          // ── 边：低透明度基线 + hover 邻域增强 + 路径高亮（V<200 时轻微弧线）──
          for (const e of simEdges) {
            const a = simNodes[e.a], b = simNodes[e.b]
            if (!a || !b || !nodeVisible(a, view, focusSet) || !nodeVisible(b, view, focusSet)) continue
            if (view.hiddenEdges.has(e.rel)) continue
            const onPath = !!(pathEdgeSet && pathEdgeSet.has(edgeKey(e)))
            let color = colorOfEdge(e.rel, edgeMeta), lw = 1 / zoom, ea = 0.3
            if (onPath) { color = '#f59e0b'; lw = 3 / zoom; ea = 1 }
            else if (active) {
              if (a.id === active || b.id === active) { ea = 0.9; lw = Math.max(lw, 1.7 / zoom) }   // 邻域高亮增强
              else if (nbs && (nbs.has(a.id) || nbs.has(b.id))) ea = 0.45
              else ea = pathNodeSet ? 0.16 : 0.1
            }
            ctx.globalAlpha = ea
            ctx.strokeStyle = color
            ctx.lineWidth = lw
            const ax = a.x * zoom + panX, ay = a.y * zoom + panY
            const bx = b.x * zoom + panX, by = b.y * zoom + panY
            ctx.beginPath()
            ctx.moveTo(ax, ay)
            if (arcOn && !onPath) {
              // 轻微二次贝塞尔弧线：控制点 = 中点 + 法向偏移；
              // 偏移方向由边端点 id 散列决定（确定性：同输入同弧向），幅度随边长收敛
              const dx = bx - ax, dy = by - ay
              const len = Math.sqrt(dx * dx + dy * dy) || 1
              const side = graphHash(a.id + '>' + b.id) >= 0.5 ? 1 : -1
              const off = Math.min(18, len * 0.14) * side
              ctx.quadraticCurveTo((ax + bx) / 2 - (dy / len) * off, (ay + by) / 2 + (dx / len) * off, bx, by)
            } else {
              ctx.lineTo(bx, by)
            }
            ctx.stroke()
          }
          ctx.globalAlpha = 1

          /* ── cycle-15：边流动粒子（数据流可视化，opt-in）──
             仅 KG_FLOW_RELS 四类「流动语义」边沿线画匀速粒子；每边相位由端点 id 散列
             决定（确定性：同输入同相位），时间项由引擎以 now/周期 传入（渲染层无时钟
             副作用）。开启期间引擎保持 rAF，关闭即恢复省电停帧。 */
          if (o && o.flow && o.flow.on) {
            const ft = (typeof o.flow.t === 'number' && isFinite(o.flow.t)) ? o.flow.t % 1 : 0
            for (const e of simEdges) {
              const rel = e && e.rel
              if (!rel || KG_FLOW_RELS.indexOf(rel) < 0) continue
              const a = simNodes[e.a], b = simNodes[e.b]
              if (!a || !b || !nodeVisible(a, view, focusSet) || !nodeVisible(b, view, focusSet)) continue
              if (view.hiddenEdges.has(rel)) continue
              const ax2 = a.x * zoom + panX, ay2 = a.y * zoom + panY
              const bx2 = b.x * zoom + panX, by2 = b.y * zoom + panY
              const phase = graphHash(String(e.a) + '>' + String(e.b))
              const pr = Math.max(1.6, 2.4 / zoom + 1.1)
              ctx.fillStyle = colorOfEdge(rel, edgeMeta)
              ctx.globalAlpha = 0.85
              for (let k = 0; k < 2; k++) {
                const tt = (ft + phase + k * 0.5) % 1
                ctx.beginPath()
                ctx.arc(ax2 + (bx2 - ax2) * tt, ay2 + (by2 - ay2) * tt, pr, 0, Math.PI * 2)
                ctx.fill()
              }
            }
            ctx.globalAlpha = 1
          }

          /* 标签去重叠（贪心占位）：算法不变（labelBoxes 包围盒冲突即跳过）。
             现代化：节点改用预烘焙径向渐变精灵 + 柔和阴影；选中/hover 外圈脉冲光环。 */
          const labelBoxes: any[] = []
          const labelCands: any[] = []
          // 节点
          for (const n of simNodes) {
            if (!nodeVisible(n, view, focusSet)) continue
            const sx = n.x * zoom + panX, sy = n.y * zoom + panY
            if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue
            const m = metaOf(n.type, nodeMeta)
            // 着色模式：colorModel 表优先（视图 useMemo 确定性预计算），缺失回退类型色板
            const col = (colorModel && colorModel.colors && colorModel.colors[n.id]) || m.color || '#94a3b8'
            // 半径微调（连续模式 + 开关开启时 ×1.10~1.30）；只影响绘制，不影响 hitTest/布局
            let r = screenRadius(n, zoom)
            if (colorModel && colorModel.radius && colorModel.radius[n.id]) r = graphClamp(r * colorModel.radius[n.id], 3, 34)
            // 压暗强度：普通 hover/选中 0.34；有路径高亮时其余节点保留 0.5
            const dim = active && active !== n.id && !(nbs && nbs.has(n.id)) && !(pathNodeSet && pathNodeSet.has(n.id))
            ctx.globalAlpha = dim ? (pathNodeSet ? 0.5 : 0.34) : 1
            // 高亮：选中（静态环 + 脉冲）> 路径（静态环）> hover（脉冲）
            if (n.id === selectedId) {
              ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2.4; ctx.stroke()
              pulseRing(ctx, sx, sy, r, '#6366f1', pulse)
            } else if (pathNodeSet && pathNodeSet.has(n.id)) {
              ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2.2; ctx.stroke()
            } else if (n.id === hoverId) {
              pulseRing(ctx, sx, sy, r, col, pulse)
            }
            // 节点本体：优先精灵（径向渐变 + 阴影已烘焙），创建失败回退纯色圆
            const sp = nodeSprite(col, r, dpr)
            if (sp) {
              ctx.drawImage(sp.cv, sx - sp.logical / 2, sy - sp.logical / 2, sp.logical, sp.logical)
            } else {
              ctx.beginPath()
              ctx.arc(sx, sy, r, 0, Math.PI * 2)
              ctx.fillStyle = col
              ctx.fill()
              ctx.lineWidth = 1.4
              ctx.strokeStyle = '#ffffff'
              ctx.stroke()
            }
            // 钉住标记（右上角小方块）
            if (n.pinned) {
              ctx.fillStyle = '#0f172a'
              ctx.fillRect(sx + r * 0.55, sy - r * 1.05, 4, 4)
            }
            // 标签候选（延后统一绘制，做去重叠）
            const mustLabel = n.id === active || (pathNodeSet && pathNodeSet.has(n.id))
            if (mustLabel || view.showLabels) {
              labelCands.push({
                n, sx, sy, r, dim, color: col,
                pri: mustLabel ? 4 : (n.deg >= 6 ? 3 : n.deg >= 3 ? 2 : 1),
                text: String(n.label || n.id),
              })
            }
          }
          // 优先级：选中/路径 > 高度数 > 低度数；同优先级按 deg 降序、id 字典序（确定性）
          labelCands.sort((a, b) =>
            (b.pri - a.pri) || (b.n.deg - a.n.deg) || (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0))
          for (const c of labelCands) {
            if (c.n.id !== active && !(pathNodeSet && pathNodeSet.has(c.n.id)) && zoom < 0.55 && c.pri < 3) continue
            const text = c.text
            const short = text.length > 14 ? text.slice(0, 13) + '…' : text
            const fs = graphClamp(10.5 / zoom, 7, 18)
            ctx.font = '600 ' + fs.toFixed(1) + 'px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
            const tw = ctx.measureText(short).width
            // 圆角底板：半透明 surface 色 + 类型色左边条 + 1px 细描边（尺寸随文本）
            const padX = 5, barW = 3, gapBar = 3
            const bw = padX + barW + gapBar + tw + padX
            const bh = fs * 1.35 + 4
            const bx0 = c.sx - bw / 2, by0 = c.sy + c.r + 2
            // 与已放置标签冲突 → 跳过（去重叠的全部成本：O(k²)，k 为候选数）
            let clash = false
            for (const b of labelBoxes) {
              if (bx0 < b.x + b.w && bx0 + bw > b.x && by0 < b.y + b.h && by0 + bh > b.y) { clash = true; break }
            }
            if (clash) continue
            labelBoxes.push({ x: bx0, y: by0, w: bw, h: bh })
            ctx.globalAlpha = c.dim ? (pathNodeSet ? 0.62 : 0.44) : 1
            ctx.textAlign = 'left'
            ctx.textBaseline = 'top'
            roundRectPath(ctx, bx0, by0, bw, bh, Math.min(5, bh / 2))
            ctx.fillStyle = 'rgba(248,250,252,.88)'
            ctx.fill()
            ctx.lineWidth = 1
            ctx.strokeStyle = 'rgba(148,163,184,.4)'
            ctx.stroke()
            ctx.fillStyle = c.color || '#6366f1'   // 类型色左边条
            ctx.fillRect(bx0 + padX * 0.6, by0 + 2.5, barW, bh - 5)
            ctx.fillStyle = c.dim ? 'rgba(51,65,85,.45)' : '#334155'
            ctx.fillText(short, bx0 + padX + barW + gapBar, by0 + (bh - fs * 1.15) / 2)
          }
          ctx.globalAlpha = 1

          // 悬停工具提示（屏幕坐标系，避免随缩放变形；圆角玻璃底 + 细描边）
          if (hoverId && hoverPos) {
            const n = byId[hoverId]
            if (n) {
              const m = metaOf(n.type, nodeMeta)
              const line1 = String(n.label || n.id)
              const line2 = (m.icon || '•') + ' ' + (m.label || n.type) + ' · 度 ' + n.deg + (n.pinned ? ' · 已钉住' : '')
              // cycle-22 P1：tooltip 第三行——模块/端点/视图节点叠加掌握率（与「掌握度」着色模式同口径）
              const mst = o && o.masteryMap && (n.type === 'module' || n.type === 'endpoint' || n.type === 'view')
                ? (o.masteryMap[String(n.label || '')] || o.masteryMap[String(n.id || '')]) : null
              const line3 = mst && typeof mst.rate === 'number'
                ? '🎯 掌握率 ' + mst.rate + '%' + (typeof mst.answered === 'number' ? ' · ' + mst.answered + ' 题' : '')
                : ''
              ctx.font = '700 11.5px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              const w1 = ctx.measureText(line1).width
              ctx.font = '11px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              const w2 = ctx.measureText(line2).width
              const w3 = line3 ? ctx.measureText(line3).width : 0
              const bh = line3 ? 52 : 38
              const bw = Math.min(W - 12, Math.max(w1, w2, w3) + 18)
              let bx = hoverPos.x + 12, by = hoverPos.y + 12
              if (bx + bw > W - 6) bx = Math.max(6, hoverPos.x - bw - 12)
              if (by + bh > H - 6) by = Math.max(6, hoverPos.y - bh - 12)
              ctx.fillStyle = 'rgba(15,23,42,.92)'
              roundRectPath(ctx, bx, by, bw, bh, 8)
              ctx.fill()
              ctx.lineWidth = 1
              ctx.strokeStyle = 'rgba(148,163,184,.35)'
              ctx.stroke()
              ctx.fillStyle = '#f8fafc'
              ctx.textAlign = 'left'
              ctx.textBaseline = 'top'
              ctx.font = '700 11.5px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              ctx.fillText(line1.length > 30 ? line1.slice(0, 29) + '…' : line1, bx + 9, by + 6)
              ctx.fillStyle = 'rgba(203,213,225,.95)'
              ctx.font = '11px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              ctx.fillText(line2, bx + 9, by + 21)
              if (line3) {
                ctx.fillStyle = mst.rate >= 75 ? '#34d399' : mst.rate >= 50 ? '#fbbf24' : '#f87171'
                ctx.fillText(line3, bx + 9, by + 36)
              }
            }
          }
        } catch { /* 渲染期任何异常都不得扩散到 React 树 */ }
      }

      /* ── 小地图原语（W2b）：世界总览 + 视口框。
            miniTransform 给出唯一的 world→mini 线性映射（绘制与「点击→世界坐标」
            共用同一映射，保证框与点击落点一致）；drawMini 每帧由引擎调用。 ── */
      /** world→mini 映射：mx = wx*s + ox（等比缩放 + 内容居中；无节点返回 empty） */
      export function miniTransform(simNodes: any, mw: any, mh: any) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const n of simNodes) {
          if (!n || !isFinite(n.x) || !isFinite(n.y)) continue
          if (n.x < minX) minX = n.x
          if (n.y < minY) minY = n.y
          if (n.x > maxX) maxX = n.x
          if (n.y > maxY) maxY = n.y
        }
        if (!simNodes.length || !isFinite(minX)) return { s: 0, ox: 0, oy: 0, empty: true }
        const pad = 10
        const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY)
        const s = Math.min((mw - pad * 2) / spanX, (mh - pad * 2) / spanY) || 0
        const ox = (mw - spanX * s) / 2 - minX * s
        const oy = (mh - spanY * s) / 2 - minY * s
        return { s, ox, oy, empty: false }
      }
      /** mini → world（点击/拖拽小地图时的逆映射；tr 来自 miniTransform） */
      export function miniToWorld(mx: any, my: any, tr: any) {
        const s = (tr && tr.s) || 1
        return { x: ((mx || 0) - ((tr && tr.ox) || 0)) / s, y: ((my || 0) - ((tr && tr.oy) || 0)) / s }
      }
      /**
       * 小地图绘制（引擎每帧调用）：全部节点降采样点（着色随当前模式）+ 主画布视口矩形框。
       * 性能护栏：节点 > 800 时跳过点绘制（只画视口框 + 提示文字），防每帧重压。
       * 任何异常吞掉——小地图故障不得影响主画布。
       */
      export function drawMini(mc: any, mdpr: any, mw: any, mh: any, o: any) {
        if (!mc) return
        const simNodes = (o && o.simNodes) || []
        const zoom = (o && o.zoom) || 1, panX = (o && o.panX) || 0, panY = (o && o.panY) || 0
        const W = (o && o.W) || 640, H = (o && o.H) || 420
        const colorModel = o && o.colorModel, nodeMeta = o && o.nodeMeta
        const focusSet = o && o.focusSet, view = o && o.view
        try {
          if (typeof mc.setTransform === 'function') mc.setTransform(mdpr, 0, 0, mdpr, 0, 0)
          mc.clearRect(0, 0, mw, mh)
          const tr = miniTransform(simNodes, mw, mh)
          // 主画布可见区域 → 世界矩形 → 小地图矩形
          const vx0 = (0 - panX) / zoom, vy0 = (0 - panY) / zoom
          const vw = W / zoom, vh = H / zoom
          const vpx = vx0 * tr.s + tr.ox, vpy = vy0 * tr.s + tr.oy
          const vpw = Math.max(3, vw * tr.s), vph = Math.max(3, vh * tr.s)
          if (!tr.empty && simNodes.length <= 800) {
            // 降采样点：直接 fillRect（2.8px 方点比 arc 便宜一个量级，150×100 下视觉等价）
            for (const n of simNodes) {
              if (!n || !isFinite(n.x) || !isFinite(n.y)) continue
              const m = metaOf(n.type, nodeMeta)
              const col = (colorModel && colorModel.colors && colorModel.colors[n.id]) || (m && m.color) || '#94a3b8'
              mc.globalAlpha = nodeVisible(n, view, focusSet) ? 0.9 : 0.28
              mc.fillStyle = col
              mc.fillRect(n.x * tr.s + tr.ox - 1.4, n.y * tr.s + tr.oy - 1.4, 2.8, 2.8)
            }
            mc.globalAlpha = 1
          } else if (!tr.empty) {
            // 超大图：只画视口框 + 一行提示（护栏生效时点绘制跳过）
            mc.globalAlpha = 1
            mc.fillStyle = '#94a3b8'
            mc.font = '10px ui-sans-serif,system-ui,sans-serif'
            mc.textAlign = 'center'
            mc.textBaseline = 'middle'
            mc.fillText('节点 ' + simNodes.length + ' · 已省略点绘制', mw / 2, mh / 2)
          }
          mc.globalAlpha = 1
          mc.strokeStyle = '#4f46e5'
          mc.lineWidth = 1.4
          mc.strokeRect(vpx, vpy, vpw, vph)
          mc.fillStyle = 'rgba(99,102,241,.08)'
          mc.fillRect(vpx, vpy, vpw, vph)
        } catch { /* 小地图任何异常不得影响主画布 */ }
      }

      /* ── 分层布局（优先服务端 layers，否则用类型层级兜底；确定性） ── */
      export function applyLayered(simNodes: any, layers: any, nodeMeta: any) {
        try {
          const groups: any = {}
          for (const n of simNodes) {
            let L = layers ? Number(layers[n.id]) : NaN
            if (!isFinite(L)) {
              const m = metaOf(n.type, nodeMeta)
              L = (m && typeof m.layer === 'number') ? m.layer : 0
            }
            ;(groups[L] = groups[L] || []).push(n)
          }
          const ls = Object.keys(groups).map(Number).sort((a, b) => a - b)
          if (!ls.length) return
          let maxRow = 1
          for (const L of ls) maxRow = Math.max(maxRow, groups[L].length)
          const gapX = graphClamp(900 / maxRow, 46, 190)
          const gapY = 150
          for (let li = 0; li < ls.length; li++) {
            const arr = groups[ls[li]]
            const cy = (li - (ls.length - 1) / 2) * gapY
            for (let i = 0; i < arr.length; i++) {
              const n = arr[i]
              n.x = (i - (arr.length - 1) / 2) * gapX
              n.y = cy + (graphHash(n.id + '#ly') - 0.5) * 26
              n.vx = 0
              n.vy = 0
            }
          }
        } catch {}
      }

    /* ══ cycle-13 W3 复杂度拆分追加：引擎侧「只读计算段 / 仅写节点对象段」外提原语 ══
       沿本文件头注释同一模式：闭包变量在调用点以同名参数穿线（读调用时刻实参 ≡
       读调用时刻闭包值）；唯一写入面仍是节点堆对象属性（本就是堆上共享对象）。 */

    /** fit() 的包围盒计算段（纯读节点坐标）：min/max 四元组，空列表返回 Infinity 哨兵 */
    export function graphViewBBox(list: any[]): any {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of list) {
        if (n.x < minX) minX = n.x
        if (n.y < minY) minY = n.y
        if (n.x > maxX) maxX = n.x
        if (n.y > maxY) maxY = n.y
      }
      return { minX, minY, maxX, maxY }
    }

    /** relax() 的「限速 + 积分」段（只写节点对象）：单步位移截断到温度 T 后原地推进 */
    export function graphRelaxIntegrate(simNodes: any[], T: number): void {
      for (const a of simNodes) {
        const sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
        if (sp > T) { a.vx = a.vx / sp * T; a.vy = a.vy / sp * T }
      }
      for (const a of simNodes) { a.x += a.vx; a.y += a.vy; a.vx = 0; a.vy = 0 }
    }

    /** reset() 的确定性初值段（只写节点对象）：解钉 + 环形散列初值（与原实现逐字节等价） */
    export function graphResetInitialCoords(simNodes: any[], baseR: number): void {
      for (const n of simNodes) { n.pinned = false; n.vx = 0; n.vy = 0 }
      for (let i = 0; i < simNodes.length; i++) {
        const n = simNodes[i]
        const ang = (i / Math.max(1, simNodes.length)) * Math.PI * 2 + graphHash(n.id + '#a') * 0.7
        const rad = baseR * (0.7 + graphHash(n.id + '#r') * 0.55)
        n.x = Math.cos(ang) * rad * 1.3
        n.y = Math.sin(ang) * rad
      }
    }

    /** setPath() 的路径边集计算段（纯读）：相邻 id 对 → 「min-max」无向边键集合 */
    export function graphPathEdgeSet(ids: any[], simEdges: any[], indexById: any): any {
      const pathEdgeSet = new Set()
      for (let i = 0; i < ids.length - 1; i++) {
        const a = indexById[String(ids[i])], b = indexById[String(ids[i + 1])]
        if (a != null && b != null) pathEdgeSet.add(Math.min(a, b) + '-' + Math.max(a, b))
      }
      return pathEdgeSet
    }

    /** setFocus() 的 1 跳邻域集计算段（纯读）：中心自身 + 所有相邻节点 id */
    export function graphNeighborSet(id: any, simNodes: any[], simEdges: any[]): any {
      const set = new Set([String(id)])
      for (const e of simEdges) {
        const a = simNodes[e.a], b = simNodes[e.b]
        if (!a || !b) continue
        if (a.id === id) set.add(b.id)
        else if (b.id === id) set.add(a.id)
      }
      return set
    }