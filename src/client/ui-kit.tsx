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
export const h: typeof React.createElement = React.createElement
export { React }

/**
 * cycle-25：RichText 图片点击放大 context（question-kit 的 QwZoomHost Provider 写入 openZoom 函数）。
 * 宿主视图在题目区外包 QwZoomHost 时，RichText 内 <img> 点击即弹全屏 Lightbox；
 * 未包 Provider 时 _currentValue 为 null，img 保持纯静态（零破坏降级）。
 */
export const KgZoomCtx: any = (React as any).createContext(null)

/** combo 单作用域事实（cycle-25）：question-kit.tsx 顶层的 QwZoomCtx 是 QwZoomHost Provider
 *  实际写入的 context，合并 bundle 内对本模块可见；本文件独立类型检查时以 declare 占位
 *  （tsc 零产物、bundler 不产生新顶层名，无重名风险）。运行时经 typeof 守卫安全回落。 */
declare const QwZoomCtx: any

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
export const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

    export const MOUNT_PATH = '/kaogong'
    export const PORTS = [8400, 8401, 8402, 8403, 8404]
    export const APP_NAME = 'dsh-kaogong'

    /* ── 无状态小组件（零 hook；cycle-24 TSX 组件化示范：Props 类型化 + JSX 语法） ── */

    /** Stat 单指标卡 props */
    interface StatProps { v: any; l: string; color?: string }
    export function Stat({ v, l, color }: StatProps) {
      return (
        <div style={{ background: 'var(--surface-card,#fff)', borderRadius: 14, padding: '16px 8px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.07)', border: '1px solid rgba(148,163,184,.12)' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: color || 'var(--text-primary,#0f172a)' }}>{String(v)}</div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>{l}</div>
        </div>
      )
    }

    /** Bar 进度条 props（pct ∈ [0,100]，越界钳制在渲染处） */
    interface BarProps { pct: number; color?: string }
    export function Bar({ pct, color }: BarProps) {
      return (
        <div style={{ height: 7, background: 'rgba(148,163,184,.25)', borderRadius: 4, overflow: 'hidden' }}>
          <i style={{ display: 'block', height: '100%', width: Math.max(0, Math.min(100, pct)) + '%', background: color || 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: 4, transition: 'width .5s' }} />
        </div>
      )
    }

    /** Card 通用卡片 props（title 可选；children 经显式声明传递——宿主 slots 契约的组件级等价物） */
    interface CardProps { title?: string; children?: any }
    export function Card({ title, children }: CardProps) {
      return (
        <div style={{ background: 'var(--surface-card,#fff)', borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,.07)', border: '1px solid rgba(148,163,184,.12)' }}>
          {title ? <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12 }}>{title}</div> : null}
          {children}
        </div>
      )
    }

    /**
     * RichText props：text 必传；maxHeight 可选（传入即开启纵向滚动）。
     * 富文本渲染：把 markdown 图片引用 ![](url) 转为 <img>，其余按段落保留换行。
     * T-018：行测图形推理题必须看图才能作答（gwy-zhenti 内 11 万张本地图，走 /api/paper-img 服务）。
     */
    interface RichTextProps { text: any; fontSize?: number; maxHeight?: number }
    export function RichText({ text: rawText, fontSize, maxHeight }: RichTextProps) {
      const src = String(rawText || '')
      // cycle-21（issue #1）：xingcezhenti 题图占位 `【图:kgimg://90-图片/题目图/x.png】`
      // 先改写为 markdown 形式（与既有 ![]() 渲染共用一条链路）——URL 指向 /api/kg-img?p=。
      // 占位在落盘数据（进度/错题本）中保持中立形态：不含端口/挂载点，换挂载/换端口不失效。
      const withImgs = src.replace(/【图:kgimg:\/\/([^\]】]+)】/g, (_f, rel) =>
        `![](kgimg://${rel})`)
      const parts: any[] = []
      const re = /!\[([^\]]*)\]\(([^)]+)\)/g
      let last = 0, m, n = 0
      while ((m = re.exec(withImgs)) !== null) {
        if (m.index > last) parts.push({ t: 'text', k: 't' + (n++), v: withImgs.slice(last, m.index) })
        parts.push({ t: 'img', k: 'i' + (n++), alt: m[1], src: m[2] })
        last = m.index + m[0].length
      }
      if (last < withImgs.length) parts.push({ t: 'text', k: 't' + (n++), v: withImgs.slice(last) })
      const mh = maxHeight

      return (

        <div style={{ fontSize: fontSize || 12.5, lineHeight: 1.85, maxHeight: mh || 'none', overflowY: mh ? 'auto' : 'visible' }}>

          {parts.map(pt => pt.t === 'img'

            ? <img

                key={pt.k}

                src={/^kgimg:\/\//.test(pt.src) ? MOUNT_PATH + '/api/kg-img?p=' + encodeURIComponent(pt.src.replace(/^kgimg:\/\//, '')) : pt.src}

                alt={pt.alt || '题目配图'} loading="lazy"

                /* cycle-25：QwZoomHost 内时点击弹全屏 Lightbox（React legacy context 稳定字段 _currentValue）。
                   双源读取：QwZoomCtx（question-kit Provider 实际写入源）优先，KgZoomCtx 兜底（未来切换消费面）；
                   都未挂 Provider 时为 null → 纯静态，零破坏。其余样式/逻辑不变。 */
                onClick={(e: any) => {
                  e.stopPropagation()
                  const openZoom = (typeof QwZoomCtx !== 'undefined' && QwZoomCtx && (QwZoomCtx as any)._currentValue)
                    || (KgZoomCtx as any)._currentValue
                  if (typeof openZoom === 'function') openZoom(pt.src, pt.alt)
                }}

                style={{ maxWidth: '100%', maxHeight: 320, display: 'block', margin: '10px 0', borderRadius: 8, border: '1px solid rgba(148,163,184,.25)', cursor: typeof (KgZoomCtx as any)._currentValue === 'function' || (typeof QwZoomCtx !== 'undefined' && typeof (QwZoomCtx as any)?._currentValue === 'function') ? 'zoom-in' : undefined }}

                onError={(e: any) => { if (e && e.target) { e.target.style.display = 'none' } }}

              />

            : <span key={pt.k} style={{ whiteSpace: 'pre-wrap' }}>{pt.v}</span>)}

        </div>

      )
    }



    /** 图谱区通用样式（纯对象，无 hook） */
    export const G_BTN = { border: '1px solid rgba(148,163,184,.35)', background: 'transparent', color: 'var(--text-muted,#64748b)', borderRadius: 8, padding: '3px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
    export const G_BTN_ON = { background: 'rgba(99,102,241,.12)', borderColor: 'rgba(99,102,241,.5)', color: '#4f46e5', fontWeight: 700 }
    export const G_TAG = { background: 'rgba(148,163,184,.15)', color: '#475569', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }
    export const G_CHIP = { border: '1px solid rgba(148,163,184,.35)', background: 'transparent', color: '#64748b', borderRadius: 20, padding: '2px 9px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.6 }

    /** 迷你折线（纯 SVG，无 canvas/无 hook；样本不足 2 个返回占位） */
    export function Sparkline({ series, color, width = 84, height: hh = 20 }: any) {
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
    export function stageColor(state: any) {
      if (state === 'done') return { bg: 'rgba(16,185,129,.12)', fg: '#059669', dot: '#10b981' }
      if (state === 'current') return { bg: 'rgba(99,102,241,.14)', fg: '#4f46e5', dot: '#6366f1' }
      return { bg: 'rgba(148,163,184,.14)', fg: '#94a3b8', dot: '#cbd5e1' }
    }
    /** 告警分级配色 */
    export function alertColor(level: any) {
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
    export function optionStyle(state: any) {
      // state: 'idle' | 'chosen' | 'right' | 'wrong'
      if (state === 'right') return { border: '#10b981', bg: 'rgba(16,185,129,.09)', badge: '#10b981', color: '#fff' }
      if (state === 'wrong') return { border: '#ef4444', bg: 'rgba(239,68,68,.08)', badge: '#ef4444', color: '#fff' }
      if (state === 'chosen') return { border: '#6366f1', bg: 'rgba(99,102,241,.08)', badge: '#6366f1', color: '#fff' }
      return { border: 'rgba(148,163,184,.3)', bg: 'transparent', badge: 'rgba(148,163,184,.15)', color: 'inherit' }
    }
    export function OptionRow({ label, text, state, onClick, disabled }: any) {
      const st = optionStyle(state)
      // cycle-22：选项可携带配图占位（资料分析公式图/数学运算图/判断推理选项图）——
      // 含 kgimg:// 占位的选项文本走 RichText 渲染出图，纯文本走原链路（零变化）。
      const hasImg = typeof text === 'string' && text.includes('kgimg://')
      const body = hasImg ? h(RichText, { text, fontSize: 13 }) : text
      return h('div', {
        style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '2px solid ' + st.border, background: st.bg, borderRadius: 10, marginTop: 8, cursor: disabled ? 'default' : 'pointer', fontSize: 13, lineHeight: 1.6 },
        onClick: disabled ? undefined : onClick,
      },
        h('div', { style: { width: 24, height: 24, borderRadius: '50%', background: st.badge, color: st.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 } }, label),
        h('div', { style: { flex: 1, minWidth: 0 } }, body))
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
    export function DimBlock({ kind, text }: any) {
      const m = (DIM_META as Record<string, any>)[kind]
      if (!m || !text) return null
      return h('div', { style: { marginBottom: 10, padding: 12, background: 'rgba(148,163,184,.07)', borderRadius: 10, borderLeft: '3px solid ' + m.border } },
        h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: m.color } }, m.icon + ' ' + m.title),
        h(RichText, { text }))
    }
    /** 标签行 */
    export function TagRow({ items }: any) {
      const list = (items || []).filter(Boolean)
      if (!list.length) return null
      return h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
        list.map((it: any, i: any) => h('span', { key: i, style: { ...KV_TAG, ...(it.style || {}) } }, it.text)))
    }

    /**
     * cycle-21：题库出处徽章（用户要求「每道题标明出处」）
     * 统一映射四库来源 → 中文标签；exam/year/paperFile 存在时拼接「卷名 · 年份」。
     * 无出处信息（旧错题等）整行不渲染（不臆造来源）。
     */
    export const KG_SOURCE_META = {
      xingcezhenti: { label: '题库·真题', color: '#6366f1' },
      naoku: { label: '深度题库', color: '#8b5cf6' },
      'gk-tuxing': { label: '图形推理专项', color: '#0ea5e9' },
      gwy_zhenti: { label: '真题卷', color: '#14b8a6' },
      // cycle-35 新源（统一池接入；徽章色板与 pool-view 关系词表同风格）
      'xingce-app': { label: '刷题 App 题库', color: '#22c55e' },
      'qiuzhao-epi-bank': { label: '秋招 EPI', color: '#f59e0b' },
      'civil-exam-agent': { label: '督导题库', color: '#ef4444' },
      pool: { label: '统一题库', color: '#3b82f6' },
    }
    export function SourceBadge({ source, exam, year, region, paperFile, extra }: any) {
      const meta = (KG_SOURCE_META as Record<string, any>)[source]
      const vol = [exam || paperFile, year, region].filter(Boolean)
      if (!meta && !vol.length && !extra) return null
      return h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 10.5 } },
        meta ? h('span', { style: { ...KV_TAG, background: meta.color + '14', color: meta.color } }, '📌 ' + meta.label) : null,
        vol.length ? h('span', { style: KV_TAG, title: vol[0] }, vol.join(' · ')) : null,
        extra || null)
    }

    /**
     * cycle-44（前端组件化·三态基建）：KgState 状态块族——loading/err/empty 三态
     * 统一渲染。此前视图层三态各自手写（kg-load 块 ~10 处、红色错误行 ~6 处、
     * 灰色空态 ~10 处，样式口径漂移）。零 hook 纯组件（R9 安全：不改变调用方
     * hook 数），条件分支语义按「场景」留给调用方（C31 教训：组件不做场景推断）。
     */
    interface KgLoadProps { label?: string; pad?: number | string; flex?: boolean }
    export function KgLoad({ label, pad, flex }: KgLoadProps) {
      return <div className="kg-load" style={pad ? { padding: pad } : flex ? { flex: 1 } : undefined}><div className="kg-spin" role="status" />{label || null}</div>
    }
    interface KgErrProps { msg: any; label?: string; onRetry?: () => void }
    export function KgErr({ msg, label, onRetry }: KgErrProps) {
      return <div style={{ color: '#ef4444', fontSize: 13 }}>
        {(label || '加载失败') + ': ' + String(msg || '无数据')}
        {onRetry ? <button className="kg-navbtn" style={{ marginLeft: 8 }} onClick={onRetry}>↻ 重试</button> : null}
      </div>
    }
    interface KgEmptyProps { text: any; fontSize?: number; color?: string; pad?: number }
    export function KgEmpty({ text, fontSize, color, pad }: KgEmptyProps) {
      return <div style={{ fontSize: fontSize || 12, color: color || '#64748b', padding: pad ? pad + 'px 0' : undefined }}>{text}</div>
    }
    /**
     * cycle-44（chips 组件化）：KgChips —— 五套手写 chip 行（graph/obs/papers/study/
     * question-kit 各自 Object.assign(G_CHIP, …)）收敛为单一事实源。
     * 全 props 可选缺失降级（R4 纪律）；active 态由调用方声明，组件不做场景推断。
     * cycle-44b：icon 支持任意 ReactNode（graph-view 节点色点/边色条形态）——
     * 字符串走文本 chip，ReactNode 直接渲染（调用方负责形状）。
     */
    interface KgChipItem { key: string; text: string; icon?: any; active?: boolean; style?: any; title?: string }
    interface KgChipsProps { items: KgChipItem[]; onPick?: (key: string) => void; gap?: number }
    export function KgChips({ items, onPick, gap }: KgChipsProps) {
      const list = Array.isArray(items) ? items.filter(Boolean) : []
      if (!list.length) return null
      return <div style={{ display: 'flex', gap: gap != null ? gap : 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {list.map(it => {
          const base = Object.assign({}, G_CHIP, it.active ? G_BTN_ON : {}, it.style || {})
          return <button key={it.key} title={it.title || undefined} style={base}
            onClick={onPick ? () => onPick(it.key) : undefined}>
            {it.icon != null ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{it.icon}{it.text}</span> : it.text}
          </button>
        })}
      </div>
    }

    /** 渲染错误边界（R9 纵深）：子树抛错降级提示条，绝不白屏宿主 GUI */
    export class KaogongErrorBoundary extends React.Component {
      constructor(props: any) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(e: any) { return { err: String((e && e.message) || e) } }
      componentDidCatch(e: any) { try { console.error('[kaogong] 渲染降级:', e) } catch {} }
      render() {
        if (this.state.err) {
          return h('div', { className: 'kg-load', role: 'alert' },
            '⚠️ 面板渲染降级（宿主 GUI 不受影响）: ' + this.state.err,
            h('button', { className: 'kg-navbtn', onClick: () => this.setState({ err: null }) }, '↻ 重试'))
        }
        return this.props.children
      }
    }
