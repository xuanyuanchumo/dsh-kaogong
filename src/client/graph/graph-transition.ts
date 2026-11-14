/**
 * graph-transition.ts — 图谱布局过渡动画插值 + 视口查询 + 键盘命令映射（cycle-13 W3 复杂度拆分）
 *
 * 沿用 W1 先例（graph-physics.ts 头注释）：只读纯函数外提 + 闭包值同名参数穿线，
 * 「读调用时刻实参 ≡ 读调用时刻闭包值」，函数体语义逐字节等价。本模块拆分来源：
 *  · graph-engine.ts：setLayout / stepTrans 中只读或只写【节点堆对象】的插值计算段
 *    （引擎原语 alpha / zoom / pan / raf 的写入保留在引擎侧薄壳，闭包语义原样不变）；
 *  · graph-view.ts：onCanvasKey 的 key→命令判定（纯表、无副作用）——命令的执行
 *    （引擎调用 / setState）仍留在视图组件，本模块只回答「这个键是什么命令」。
 * 确定性：无 Math.random 真调用；同输入两次输出深相等（smoke 断言口径）。
 */

/* ── 布局过渡时长（setLayout 与 stepTrans 共用同一常量，避免两处魔数漂移） ── */
export const GRAPH_TRANS_DUR = 350

/** 过渡进度：clamp((now − t0) / dur, 0, 1)；dur 缺省/非法时回退 350（与原 `dur || 350` 等价） */
export function graphTransProgress(now: any, t0: any, dur: any): number {
  const d = (typeof dur === 'number' && dur > 0) ? dur : GRAPH_TRANS_DUR
  const t = (now - t0) / d
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** easeInOutCubic 缓动：先缓后急再缓（与 CSS ease-in-out 观感一致） */
export function graphTransEase(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** 起点坐标快照（setLayout 第①步）：纯读节点对象，分配 Float64Array（确定性布局快照） */
export function graphTransSnapshotFrom(simNodes: any[]): any {
  const V = simNodes.length
  const fx = new Float64Array(V), fy = new Float64Array(V)
  for (let i = 0; i < V; i++) { fx[i] = simNodes[i].x; fy[i] = simNodes[i].y }
  return { fx, fy }
}

/** 终点坐标快照 + 总位移（setLayout 第③步）：dist 用于「已在目标布局」时跳过动画 */
export function graphTransSnapshotTo(simNodes: any[], fx: any, fy: any): any {
  const V = simNodes.length
  const tx = new Float64Array(V), ty = new Float64Array(V)
  let dist = 0
  for (let i = 0; i < V; i++) {
    tx[i] = simNodes[i].x; ty[i] = simNodes[i].y
    dist += Math.abs(tx[i] - fx[i]) + Math.abs(ty[i] - fy[i])
  }
  return { tx, ty, dist }
}

/** 回写起点坐标并清零速度（setLayout 第④步）：只写节点堆对象（W1 先例允许的写入面） */
export function graphTransRestoreFrom(simNodes: any[], fx: any, fy: any): void {
  for (let i = 0; i < simNodes.length; i++) {
    simNodes[i].x = fx[i]; simNodes[i].y = fy[i]
    simNodes[i].vx = 0; simNodes[i].vy = 0
  }
}

/** 逐帧插值：按缓动值 e 写过渡态坐标并清零速度（stepTrans 每帧；只写节点堆对象） */
export function graphTransLerpCoords(simNodes: any[], fx: any, fy: any, tx: any, ty: any, e: number): void {
  for (let i = 0; i < simNodes.length; i++) {
    const n = simNodes[i]
    n.x = fx[i] + (tx[i] - fx[i]) * e
    n.y = fy[i] + (ty[i] - fy[i]) * e
    n.vx = 0
    n.vy = 0
  }
}

/** 终态精确回写目标坐标（过渡 t≥1 时调用，保证与「无动画」路径深相等） */
export function graphTransSnapCoords(simNodes: any[], tx: any, ty: any): void {
  for (let i = 0; i < simNodes.length; i++) { simNodes[i].x = tx[i]; simNodes[i].y = ty[i] }
}

/* ── 视口查询（W2b 小地图视口框 / 导出等消费）：纯读，状态在调用点穿线 ── */
/** 主画布可见区域的世界坐标矩形 + 缩放（zoom/panX/panY/W/H 由引擎调用时刻传入） */
export function graphViewportOf(zoom: any, panX: any, panY: any, W: any, H: any): any {
  return {
    zoom,
    x: (0 - panX) / zoom, y: (0 - panY) / zoom,   // 世界矩形左上角
    w: W / zoom, h: H / zoom,                      // 世界矩形尺寸
    sw: W, sh: H,                                  // 屏幕尺寸（逻辑像素）
  }
}

/* ── 键盘命令映射（W2b 快捷键）：key → 命令纯表，无副作用 ──
   +/= 放大 · −/_ 缩小 · 0/f/F 适配画布 · l/L 切换布局 · Esc 清除选中/退出聚焦 */
export function graphKeyCommand(key: any): any {
  const k = (key === undefined || key === null) ? '' : String(key)
  if (k === '+' || k === '=') return 'zoom-in'
  if (k === '-' || k === '_') return 'zoom-out'
  if (k === '0' || k === 'f' || k === 'F') return 'fit'
  if (k === 'l' || k === 'L') return 'toggle-layout'
  if (k === 'Escape') return 'clear'
  return null
}

/* ── 视图过滤态字段级合并（W2b setView 的「字段级合并」语义实现段）──
   只写 view 堆对象属性（过滤集合 / 开关），标量引擎字段（selected/colorModel/
   radiusBoost）的赋值留在引擎闭包内 —— 与本文件头的拆分纪律一致。 */
export function graphMergeViewFilters(view: any, v: any): void {
  if (v.hiddenTypes !== undefined) view.hiddenTypes = (v.hiddenTypes instanceof Set) ? v.hiddenTypes : new Set(v.hiddenTypes || [])
  if (v.hiddenEdges !== undefined) view.hiddenEdges = (v.hiddenEdges instanceof Set) ? v.hiddenEdges : new Set(v.hiddenEdges || [])
  if (v.showOrphans !== undefined) view.showOrphans = v.showOrphans !== false
  if (v.showLabels !== undefined) view.showLabels = v.showLabels !== false
}

/* ── cycle-15：环形布局（第三布局，setLayout 的 'circular' 终态计算段）──
   数学模型：语义环 = 节点按 NODE_META.layer（插件→生命周期→入口/通道→视图/端点/工具→
   数据域→仓库→模块…）分层序 + 同层内 id 字典序排序，沿单位圆顺时针铺开；
   半径自适应：R = min(R_fit, max(R_need, 140))，其中 R_need = V·labelGap/(2π)
   （周长恰好容纳 V 个标签间距），R_fit = 0.42·min(W,H)（画布可容纳上限）——
   标签不重叠由周长约束保证，画布不溢出由 fit 上限保证。
   确定性：排序键固定（layer,id）→ 同输入两次输出坐标深相等（smoke 口径）。
   写入面：仅节点堆对象属性 x/y/vx/vy（W1 先例允许面，与 graphTransSnapCoords 同级）。 */
export function graphCircularLayout(simNodes: any[], nodeMeta: any, W: any, H: any): void {
  const V = simNodes.length
  if (!V) return
  const ordered = simNodes.slice().sort((a, b) => {
    const la = (nodeMeta && nodeMeta[a.type] && nodeMeta[a.type].layer) || 0
    const lb = (nodeMeta && nodeMeta[b.type] && nodeMeta[b.type].layer) || 0
    if (la !== lb) return la - lb
    const sa = String(a.id), sb = String(b.id)
    return sa < sb ? -1 : sa > sb ? 1 : 0
  })
  const labelGap = 26                                     // 单标签占位弧长（px，与标签字号匹配）
  const rFit = Math.max(120, Math.min(Number(W) || 640, Number(H) || 420) * 0.42)
  const rNeed = (V * labelGap) / (2 * Math.PI)            // 周长约束半径
  const R = Math.min(rFit, Math.max(rNeed, 140))
  const cx = (Number(W) || 640) / 2, cy = (Number(H) || 420) / 2
  for (let i = 0; i < V; i++) {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / V      // 顶部起、顺时针
    const n = ordered[i]
    n.x = cx + R * Math.cos(ang)
    n.y = cy + R * Math.sin(ang)
    n.vx = 0; n.vy = 0
  }
}
