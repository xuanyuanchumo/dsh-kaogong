/**
 * client/question/question-lightbox.tsx — 题目图片放大/缩小组件（cycle-25 统一题目渲染域）
 *
 * 设计动机（用户诉求）：题目的材料/题干/选项/解析（段 3-6）可能含图，
 * 前端需支持「点击放大、滚轮缩放、拖拽平移」。此前 RichText 内 <img> 是静态的，
 * 资料分析统计图/图形推理图在 320px 高度约束下不可辨识。
 *
 * 组成：
 *  - QwZoomImg：RichText 场景内联替身——点击打开全屏 Lightbox（无遮罩状态时零开销）
 *  - QwLightbox：全屏遮罩查看器——滚轮缩放（0.5-4x，围绕指针缩放）、拖拽平移、
 *    ESC/点击遮罩关闭、双击复位。状态全部组件内 useState（R7：无模块级可变状态）。
 *
 * R9 纪律：QwLightbox 的早退 return 在全部 hooks 之后；hook 链跨渲染恒定。
 * 前缀纪律：Qw* 顶层名全局唯一（combo 单作用域，教训⑨）。
 */

import { h, React } from '../ui-kit.js'


/** QwLightbox props：src 必传；alt 可选；onClose 由宿主传入 */
interface QwLightboxProps { src: string; alt?: string; onClose: () => void }

/** 缩放常量：0.5x-4x，滚轮单步 ×1.15 */
const QW_ZOOM_MIN = 0.5
const QW_ZOOM_MAX = 4
const QW_ZOOM_STEP = 1.15

/**
 * QwLightbox — 全屏图片查看器（缩放/平移/关闭）。
 * 交互借鉴主流看图器：滚轮围绕指针缩放、按住拖拽平移、双击复位、ESC 关闭。
 */
export function QwLightbox({ src, alt, onClose }: QwLightboxProps) {
  /* ── hooks 全顶部（R9）：scale/offset/drag 三状态 + 三 ref ── */
  const [scale, setScale] = React.useState(1)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const dragRef = React.useRef(null)
  const imgRef = React.useRef(null)

  /* ── 事件（useEffect 内挂 window 级监听，cleanup 成对） ── */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** 围绕指针缩放：先记指针在内容坐标系的位置，缩放后平移使其保持不动 */
  const wheelZoom = (e: any) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? QW_ZOOM_STEP : 1 / QW_ZOOM_STEP
    setScale(prev => {
      const next = Math.min(QW_ZOOM_MAX, Math.max(QW_ZOOM_MIN, prev * factor))
      if (next === prev) return prev
      // 指针相对遮罩中心的偏移 → 缩放前后该内容点保持在指针下
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const px = e.clientX - rect.left - rect.width / 2
      const py = e.clientY - rect.top - rect.height / 2
      setOffset(o => ({
        x: px - (px - o.x) * (next / prev),
        y: py - (py - o.y) * (next / prev),
      }))
      return next
    })
  }

  const dragStart = (e: any) => {
    if (e.button !== 0) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y }
  }
  const dragMove = (e: any) => {
    const d = dragRef.current
    if (!d) return
    setOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) })
  }
  const dragEnd = () => { dragRef.current = null }
  const dblReset = () => { setScale(1); setOffset({ x: 0, y: 0 }) }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(8,12,24,.86)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: scale > 1 ? 'grab' : 'zoom-out' }}
      onClick={onClose}
      onWheel={wheelZoom}
      onMouseDown={dragStart}
      onMouseMove={dragMove}
      onMouseUp={dragEnd}
      onMouseLeave={dragEnd}
      onDoubleClick={dblReset}
      title={'滚轮缩放（0.5-4x）· 拖拽平移 · 双击复位 · ESC/点击遮罩关闭'}
    >
      {/* 工具条：阻断了 onClick 冒泡，按钮才可点 */}
      <div
        style={{ position: 'fixed', top: 12, right: 16, display: 'flex', gap: 8, alignItems: 'center' }}
        onClick={(e: any) => e.stopPropagation()}
      >
        <span style={{ color: '#cbd5e1', fontSize: 12, fontFamily: 'monospace' }}>{Math.round(scale * 100) + '%'}</span>
        <button style={{ background: 'rgba(255,255,255,.12)', color: '#e2e8f0', border: 0, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
          onClick={() => setScale(s => Math.max(QW_ZOOM_MIN, s / QW_ZOOM_STEP))}>{'－'}</button>
        <button style={{ background: 'rgba(255,255,255,.12)', color: '#e2e8f0', border: 0, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
          onClick={() => setScale(s => Math.min(QW_ZOOM_MAX, s * QW_ZOOM_STEP))}>{'＋'}</button>
        <button style={{ background: 'rgba(255,255,255,.12)', color: '#e2e8f0', border: 0, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
          onClick={dblReset}>{'复位'}</button>
        <button style={{ background: 'rgba(239,68,68,.75)', color: '#fff', border: 0, borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
          onClick={onClose}>{'✕ 关闭'}</button>
      </div>
      <img
        ref={imgRef}
        src={src}
        alt={alt || '题目配图放大查看'}
        draggable={false}
        style={{ maxWidth: '92vw', maxHeight: '88vh', transform: 'translate(' + offset.x + 'px,' + offset.y + 'px) scale(' + scale + ')', transition: dragRef.current ? 'none' : 'transform .12s ease-out', userSelect: 'none', borderRadius: 6, boxShadow: '0 8px 40px rgba(0,0,0,.5)' }}
        onClick={(e: any) => e.stopPropagation()}
      />
    </div>
  )
}

/** QwZoomImg props：与 RichText 内 img 的字段对齐（src/alt/style），extra onClick 可选叠加 */
interface QwZoomImgProps { src: string; alt?: string; style?: any; onZoom?: () => void }

/**
 * QwZoomImg — 内联图片替身：渲染原 <img>，点击打开 QwLightbox。
 * 用于 RichText 的图片渲染替换（cycle-25 起 RichText 经 props.enableZoom 启用）。
 */
export function QwZoomImg({ src, alt, style, onZoom }: QwZoomImgProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <span style={{ display: 'inline-block', position: 'relative' }}>
      <img
        src={src}
        alt={alt || '题目配图（点击放大）'}
        loading="lazy"
        style={{ ...style, cursor: 'zoom-in' }}
        onClick={(e: any) => { e.stopPropagation(); if (typeof onZoom === 'function') onZoom(); setOpen(true) }}
        title={'点击放大查看'}
      />
      {open ? <QwLightbox src={src} alt={alt} onClose={() => setOpen(false)} /> : null}
    </span>
  )
}
