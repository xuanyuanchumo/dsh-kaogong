/**
 * client/ui-kit.ts — 无状态小组件与共享样式常量（cycle-13 T-025 从 client.ts 拆出）
 *
 * 内容：entries 守卫 · Stat/Bar/Card/RichText/Sparkline 纯组件 · KV_* 与 G_* 样式常量 ·
 *       optionStyle/OptionRow/DIM_META/DimBlock/TagRow 判分辅助 · KaogongErrorBoundary。
 * React 约定：全组合唯一一份 require('react') 在此发生（combo factory 的 require
 * 参数经闭包对模块体可见），其余模块一律 import { h, React } from './ui-kit.js'——
 * bundler 合并后所有模块体共享 factory 单作用域，require 只允许发生这一次。
 */

const React = require('react')
export const h = React.createElement
export { React }

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
export const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

    export const MOUNT_PATH = '/kaogong'
    export const PORTS = [8400, 8401, 8402, 8403, 8404]
    export const APP_NAME = 'dsh-kaogong'

    /* ── 无状态小组件（零 hook）── */
    export function Stat(props) {
      return h('div', { style: { background: 'var(--surface-card,#fff)', borderRadius: 14, padding: '16px 8px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.07)', border: '1px solid rgba(148,163,184,.12)' } },
        h('div', { style: { fontSize: 24, fontWeight: 800, color: props.color || 'var(--text-primary,#0f172a)' } }, props.v),
        h('div', { style: { fontSize: 11.5, color: '#64748b', marginTop: 3 } }, props.l))
    }
    export function Bar(props) {
      return h('div', { style: { height: 7, background: 'rgba(148,163,184,.25)', borderRadius: 4, overflow: 'hidden' } },
        h('i', { style: { display: 'block', height: '100%', width: Math.max(0, Math.min(100, props.pct)) + '%', background: props.color || 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: 4, transition: 'width .5s' } }))
    }
    export function Card(props) {
      return h('div', { style: { background: 'var(--surface-card,#fff)', borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,.07)', border: '1px solid rgba(148,163,184,.12)' } },
        props.title && h('div', { style: { fontWeight: 700, fontSize: 13.5, marginBottom: 12 } }, props.title),
        props.children)
    }

    /**
     * 富文本渲染：把 markdown 图片引用 ![](url) 转为 <img>，其余按段落保留换行。
     * T-018：行测图形推理题必须看图才能作答（gwy-zhenti 内 11 万张本地图，走 /api/paper-img 服务）。
     */
    export function RichText(props) {
      const src = String(props.text || '')
      const parts: any[] = []
      const re = /!\[([^\]]*)\]\(([^)]+)\)/g
      let last = 0, m, n = 0
      while ((m = re.exec(src)) !== null) {
        if (m.index > last) parts.push({ t: 'text', k: 't' + (n++), v: src.slice(last, m.index) })
        parts.push({ t: 'img', k: 'i' + (n++), alt: m[1], src: m[2] })
        last = m.index + m[0].length
      }
      if (last < src.length) parts.push({ t: 'text', k: 't' + (n++), v: src.slice(last) })
      const mh = props.maxHeight
      return h('div', { style: { fontSize: props.fontSize || 12.5, lineHeight: 1.85, maxHeight: mh || 'none', overflowY: mh ? 'auto' : 'visible' } },
        parts.map(pt => pt.t === 'img'
          ? h('img', {
              key: pt.k, src: pt.src, alt: pt.alt || '题目配图', loading: 'lazy',
              style: { maxWidth: '100%', maxHeight: 320, display: 'block', margin: '10px 0', borderRadius: 8, border: '1px solid rgba(148,163,184,.25)' },
              onError: (e) => { if (e && e.target) { e.target.style.display = 'none' } },
            })
          : h('span', { key: pt.k, style: { whiteSpace: 'pre-wrap' } }, pt.v)))
    }

    /** 图谱区通用样式（纯对象，无 hook） */
    export const G_BTN = { border: '1px solid rgba(148,163,184,.35)', background: 'transparent', color: 'var(--text-muted,#64748b)', borderRadius: 8, padding: '3px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
    export const G_BTN_ON = { background: 'rgba(99,102,241,.12)', borderColor: 'rgba(99,102,241,.5)', color: '#4f46e5', fontWeight: 700 }
    export const G_TAG = { background: 'rgba(148,163,184,.15)', color: '#475569', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }
    export const G_CHIP = { border: '1px solid rgba(148,163,184,.35)', background: 'transparent', color: '#64748b', borderRadius: 20, padding: '2px 9px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.6 }

    /** 迷你折线（纯 SVG，无 canvas/无 hook；样本不足 2 个返回占位） */
    export function Sparkline({ series, color, width = 84, height: hh = 20 }) {
      const arr = Array.isArray(series) ? series.filter(v => typeof v === 'number' && isFinite(v)) : []
      if (arr.length < 2) return h('span', { style: { color: '#cbd5e1', fontSize: 10 } }, '—')
      const max = Math.max.apply(null, arr) || 1
      const min = Math.min.apply(null, arr)
      const span = Math.max(1, max - min)
      const stepX = width / Math.max(1, arr.length - 1)
      const pts = arr.map((v, i) => (i * stepX).toFixed(1) + ',' + (hh - ((v - min) / span) * (hh - 3) - 1.5).toFixed(1)).join(' ')
      return h('svg', { width, height: hh, viewBox: '0 0 ' + width + ' ' + hh, style: { display: 'block' }, 'aria-hidden': 'true' },
        h('polyline', { points: pts, fill: 'none', stroke: color || '#6366f1', strokeWidth: 1.6, strokeLinejoin: 'round' }))
    }

    /** 生命周期阶段配色（done / current / pending 三态） */
    export function stageColor(state) {
      if (state === 'done') return { bg: 'rgba(16,185,129,.12)', fg: '#059669', dot: '#10b981' }
      if (state === 'current') return { bg: 'rgba(99,102,241,.14)', fg: '#4f46e5', dot: '#6366f1' }
      return { bg: 'rgba(148,163,184,.14)', fg: '#94a3b8', dot: '#cbd5e1' }
    }
    /** 告警分级配色 */
    export function alertColor(level) {
      if (level === 'error') return { bg: 'rgba(239,68,68,.1)', fg: '#dc2626', border: 'rgba(239,68,68,.35)', icon: '⛔' }
      if (level === 'warn') return { bg: 'rgba(245,158,11,.1)', fg: '#b45309', border: 'rgba(245,158,11,.35)', icon: '⚠️' }
      return { bg: 'rgba(148,163,184,.1)', fg: '#64748b', border: 'rgba(148,163,184,.3)', icon: 'ℹ️' }
    }

    export const KV_TAG = { background: '#eef2ff', color: '#4338ca', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }
    export const KV_BTN = { border: '1px solid rgba(148,163,184,.35)', background: 'transparent', color: 'var(--text-muted,#64748b)', borderRadius: 8, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }
    export const KV_TH = { fontWeight: 700, fontSize: 13.5, marginBottom: 12 }

    /**
     * R14：复杂度治理辅助——把「选项渲染 / 标注块 / 标签行」三处高频重复
     * 从各视图内联三元中提出来，既降分支密度也让样式口径统一。
     */
    export function optionStyle(state) {
      // state: 'idle' | 'chosen' | 'right' | 'wrong'
      if (state === 'right') return { border: '#10b981', bg: 'rgba(16,185,129,.09)', badge: '#10b981', color: '#fff' }
      if (state === 'wrong') return { border: '#ef4444', bg: 'rgba(239,68,68,.08)', badge: '#ef4444', color: '#fff' }
      if (state === 'chosen') return { border: '#6366f1', bg: 'rgba(99,102,241,.08)', badge: '#6366f1', color: '#fff' }
      return { border: 'rgba(148,163,184,.3)', bg: 'transparent', badge: 'rgba(148,163,184,.15)', color: 'inherit' }
    }
    export function OptionRow({ label, text, state, onClick, disabled }) {
      const st = optionStyle(state)
      return h('div', {
        style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '2px solid ' + st.border, background: st.bg, borderRadius: 10, marginTop: 8, cursor: disabled ? 'default' : 'pointer', fontSize: 13, lineHeight: 1.6 },
        onClick: disabled ? undefined : onClick,
      },
        h('div', { style: { width: 24, height: 24, borderRadius: '50%', background: st.badge, color: st.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 } }, label),
        h('div', { style: { flex: 1 } }, text))
    }
    /** 五维标注块：kind ∈ analysis/kadian/reasoning/fastest/pitfalls/mother */
    export const DIM_META = {
      analysis: { icon: '📖', title: '解析', color: '#64748b', border: 'rgba(148,163,184,.4)' },
      kadian: { icon: '🎯', title: '考点定位', color: '#6366f1', border: '#6366f1' },
      reasoning: { icon: '🧠', title: '解题推理链', color: '#0ea5e9', border: '#0ea5e9' },
      fastest: { icon: '⚡', title: '最快解法（考场用）', color: '#f59e0b', border: '#f59e0b' },
      pitfalls: { icon: '⚠️', title: '易错点', color: '#ef4444', border: '#ef4444' },
      mother: { icon: '🧩', title: '母题思维', color: '#8b5cf6', border: '#8b5cf6' },
    }
    export function DimBlock({ kind, text }) {
      const m = DIM_META[kind]
      if (!m || !text) return null
      return h('div', { style: { marginBottom: 10, padding: 12, background: 'rgba(148,163,184,.07)', borderRadius: 10, borderLeft: '3px solid ' + m.border } },
        h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: m.color } }, m.icon + ' ' + m.title),
        h(RichText, { text }))
    }
    /** 标签行 */
    export function TagRow({ items }) {
      const list = (items || []).filter(Boolean)
      if (!list.length) return null
      return h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
        list.map((it, i) => h('span', { key: i, style: { ...KV_TAG, ...(it.style || {}) } }, it.text)))
    }

    /** 渲染错误边界（R9 纵深）：子树抛错降级提示条，绝不白屏宿主 GUI */
    export class KaogongErrorBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(e) { return { err: String((e && e.message) || e) } }
      componentDidCatch(e) { try { console.error('[kaogong] 渲染降级:', e) } catch {} }
      render() {
        if (this.state.err) {
          return h('div', { className: 'kg-load', role: 'alert' },
            '⚠️ 面板渲染降级（宿主 GUI 不受影响）: ' + this.state.err,
            h('button', { className: 'kg-navbtn', onClick: () => this.setState({ err: null }) }, '↻ 重试'))
        }
        return this.props.children
      }
    }