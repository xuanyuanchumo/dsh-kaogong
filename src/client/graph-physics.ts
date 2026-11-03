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

import { graphHash, graphClamp, GRAPH_NODE_META, GRAPH_EDGE_META } from './graph-analytics.js'

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
      export function draw(ctx: any, dpr: any, W: any, H: any, zoom: any, panX: any, panY: any, hoverId: any, selectedId: any, simNodes: any, simEdges: any, byId: any, view: any, pathNodeSet: any, pathEdgeSet: any, hoverPos: any, focusSet: any, nodeMeta: any, edgeMeta: any) {
        if (!ctx) return
        try {
          if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, W, H)
          ctx.fillStyle = '#f8fafc'
          ctx.fillRect(0, 0, W, H)
          // 背景点阵（随平移/缩放轻微跟随，提供空间参考）
          const gap = graphClamp(30 * zoom, 18, 64)
          ctx.fillStyle = 'rgba(148,163,184,.28)'
          const ox = ((panX % gap) + gap) % gap
          const oy = ((panY % gap) + gap) % gap
          for (let gx = ox; gx < W; gx += gap) for (let gy = oy; gy < H; gy += gap) ctx.fillRect(gx, gy, 1.1, 1.1)

          const active = hoverId || selectedId
          const nbs = active ? neighborSetOf(active, simNodes, simEdges) : null

          // 边
          for (const e of simEdges) {
            const a = simNodes[e.a], b = simNodes[e.b]
            if (!a || !b || !nodeVisible(a, view, focusSet) || !nodeVisible(b, view, focusSet)) continue
            if (view.hiddenEdges.has(e.rel)) continue
            const onPath = !!(pathEdgeSet && pathEdgeSet.has(edgeKey(e)))
            let color = colorOfEdge(e.rel, edgeMeta), lw = 1 / zoom, ea = 0.34
            if (onPath) { color = '#f59e0b'; lw = 3 / zoom; ea = 1 }
            else if (active) {
              if (a.id === active || b.id === active) ea = 0.85
              else if (nbs && (nbs.has(a.id) || nbs.has(b.id))) ea = 0.45
              else ea = pathNodeSet ? 0.16 : 0.1
            }
            ctx.globalAlpha = ea
            ctx.strokeStyle = color
            ctx.lineWidth = lw
            ctx.beginPath()
            ctx.moveTo(a.x * zoom + panX, a.y * zoom + panY)
            ctx.lineTo(b.x * zoom + panX, b.y * zoom + panY)
            ctx.stroke()
          }
          ctx.globalAlpha = 1

          /* 标签去重叠（贪心占位）：v1.8.0 修复「141 个标签 100% 重叠不可读」。
             策略：先画节点，再按优先级（选中>路径>hover>高度数>其余）尝试放置标签，
             与已放置标签的包围盒冲突则跳过；缩放小(<0.55)时进一步收紧只留重点节点。 */
          const labelBoxes: any[] = []
          const labelCands: any[] = []
          // 节点
          for (const n of simNodes) {
            if (!nodeVisible(n, view, focusSet)) continue
            const sx = n.x * zoom + panX, sy = n.y * zoom + panY
            if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue
            const m = metaOf(n.type, nodeMeta)
            const r = screenRadius(n, zoom)
            // 压暗强度：普通 hover/选中 0.34；有路径高亮时其余节点保留 0.5
            // （原 0.22 让整张图在「路径分析」态几乎不可见，失去上下文）
            const dim = active && active !== n.id && !(nbs && nbs.has(n.id)) && !(pathNodeSet && pathNodeSet.has(n.id))
            ctx.globalAlpha = dim ? (pathNodeSet ? 0.5 : 0.34) : 1
            // 高亮光环：选中 > 路径 > hover
            if (n.id === selectedId) { ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2.4; ctx.stroke() }
            else if (pathNodeSet && pathNodeSet.has(n.id)) { ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2.2; ctx.stroke() }
            else if (n.id === hoverId) { ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(99,102,241,.75)'; ctx.lineWidth = 1.8; ctx.stroke() }
            ctx.beginPath()
            ctx.arc(sx, sy, r, 0, Math.PI * 2)
            ctx.fillStyle = m.color || '#94a3b8'
            ctx.fill()
            ctx.lineWidth = 1.4
            ctx.strokeStyle = '#ffffff'
            ctx.stroke()
            // 钉住标记（右上角小方块）
            if (n.pinned) {
              ctx.fillStyle = '#0f172a'
              ctx.fillRect(sx + r * 0.55, sy - r * 1.05, 4, 4)
            }
            // 标签候选（延后统一绘制，做去重叠）
            const mustLabel = n.id === active || (pathNodeSet && pathNodeSet.has(n.id))
            if (mustLabel || view.showLabels) {
              labelCands.push({
                n, sx, sy, r, dim,
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
            const bx0 = c.sx - tw / 2 - 2, by0 = c.sy + c.r + 1, bw = tw + 4, bh = fs * 1.25
            // 与已放置标签冲突 → 跳过（这就是「标签去重叠」的全部成本：O(k²)，k 为候选数）
            let clash = false
            for (const b of labelBoxes) {
              if (bx0 < b.x + b.w && bx0 + bw > b.x && by0 < b.y + b.h && by0 + bh > b.y) { clash = true; break }
            }
            if (clash) continue
            labelBoxes.push({ x: bx0, y: by0, w: bw, h: bh })
            ctx.globalAlpha = c.dim ? (pathNodeSet ? 0.62 : 0.44) : 1
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.lineWidth = 3 / zoom
            ctx.strokeStyle = 'rgba(248,250,252,.92)'
            ctx.strokeText(short, c.sx, c.sy + c.r + 2)
            ctx.fillStyle = c.dim ? 'rgba(51,65,85,.45)' : '#334155'
            ctx.fillText(short, c.sx, c.sy + c.r + 2)
          }
          ctx.globalAlpha = 1

          // 悬停工具提示（屏幕坐标系，避免随缩放变形）
          if (hoverId && hoverPos) {
            const n = byId[hoverId]
            if (n) {
              const m = metaOf(n.type, nodeMeta)
              const line1 = String(n.label || n.id)
              const line2 = (m.icon || '•') + ' ' + (m.label || n.type) + ' · 度 ' + n.deg + (n.pinned ? ' · 已钉住' : '')
              ctx.font = '700 11.5px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              const w1 = ctx.measureText(line1).width
              ctx.font = '11px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              const w2 = ctx.measureText(line2).width
              const bw = Math.min(W - 12, Math.max(w1, w2) + 18)
              const bh = 38
              let bx = hoverPos.x + 12, by = hoverPos.y + 12
              if (bx + bw > W - 6) bx = Math.max(6, hoverPos.x - bw - 12)
              if (by + bh > H - 6) by = Math.max(6, hoverPos.y - bh - 12)
              ctx.fillStyle = 'rgba(15,23,42,.92)'
              ctx.fillRect(bx, by, bw, bh)
              ctx.fillStyle = '#f8fafc'
              ctx.textAlign = 'left'
              ctx.textBaseline = 'top'
              ctx.font = '700 11.5px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              ctx.fillText(line1.length > 30 ? line1.slice(0, 29) + '…' : line1, bx + 9, by + 6)
              ctx.fillStyle = 'rgba(203,213,225,.95)'
              ctx.font = '11px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              ctx.fillText(line2, bx + 9, by + 21)
            }
          }
        } catch { /* 渲染期任何异常都不得扩散到 React 树 */ }
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