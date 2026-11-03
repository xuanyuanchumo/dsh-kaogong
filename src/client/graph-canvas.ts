/**
 * graph-canvas.ts — 图谱画布装配原语（cycle-13 W3 复杂度拆分）
 *
 * 沿用 W1 先例（graph-physics.ts 头注释）：只读/仅写【堆上共享对象】的函数外提 +
 * 闭包值同名参数穿线。本模块的写入面收敛为 canvas/ctx 堆对象属性（尺寸 / 样式 /
 * 变换 / 监听器 / 光标），绝不触碰引擎原语（W/H/zoom/pan/alpha/raf/miniCtx/ro 的
 * 赋值保留在 graph-engine.ts 闭包内）；引擎侧只保留「状态赋值 + 调用」。
 * 确定性：无 Math.random 真调用；同输入两次输出效果一致。
 */

/** 视口尺寸测量（resize 消费）：wrap 优先、canvas 兜底、640×420/最小 120 兜底链原样保留 */
export function graphMeasureSize(wrap: any, canvas: any): any {
  let w = 0, hh = 0
  if (wrap && typeof wrap.getBoundingClientRect === 'function') {
    const r = wrap.getBoundingClientRect()
    w = r && r.width ? r.width : 0
    hh = r && r.height ? r.height : 0
  }
  if (!w) w = canvas.clientWidth || 640
  if (!hh) hh = canvas.clientHeight || 420
  return { w: Math.max(120, Math.round(w)), h: Math.max(120, Math.round(hh)) }
}

/** 画布物理尺寸应用（DPR 感知）：写 canvas 像素尺寸 + CSS 尺寸 + ctx 变换矩阵 */
export function graphApplyCanvasSize(canvas: any, ctx: any, w: number, h: number, dpr: number): void {
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  if (canvas.style) { canvas.style.width = '100%'; canvas.style.height = '100%' }
  if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/** 光标守卫写入（canvas.style 缺席的宿主环境静默跳过，不抛错） */
export function graphSetCursor(canvas: any, cur: string): void {
  if (canvas && canvas.style) canvas.style.cursor = cur
}

/** 小地图装配（DPR 感知尺寸 + 交互绑定）：写 miniCanvas 堆对象，返回 2D 上下文（失败 null）。
 *  getContext 不可用 / 抛错时返回 null 且不绑定监听 —— 与原 if(miniCtx) 门语义一致。 */
export function graphBindMiniMap(miniCanvas: any, dpr: number, w: number, h: number, handlers: any): any {
  let mc: any = null
  try { miniCanvas.width = Math.round(w * dpr); miniCanvas.height = Math.round(h * dpr) } catch {}
  try { mc = miniCanvas.getContext('2d') } catch { mc = null }
  if (mc) {
    miniCanvas.addEventListener('pointerdown', handlers.onDown)
    miniCanvas.addEventListener('pointermove', handlers.onMove)
    miniCanvas.addEventListener('pointerup', handlers.onUp)
    miniCanvas.addEventListener('pointercancel', handlers.onUp)
    miniCanvas.addEventListener('pointerleave', handlers.onUp)
  }
  return mc
}

/** 小地图解绑（与 graphBindMiniMap 严格成对；miniCanvas 缺席时安全 no-op）。
 *  多余解绑对未绑定的监听是安全 no-op（与原 destroy 行为一致）。 */
export function graphUnbindMiniMap(miniCanvas: any, handlers: any): void {
  if (!miniCanvas) return
  miniCanvas.removeEventListener('pointerdown', handlers.onDown)
  miniCanvas.removeEventListener('pointermove', handlers.onMove)
  miniCanvas.removeEventListener('pointerup', handlers.onUp)
  miniCanvas.removeEventListener('pointercancel', handlers.onUp)
  miniCanvas.removeEventListener('pointerleave', handlers.onUp)
}
