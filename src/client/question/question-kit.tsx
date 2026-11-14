/**
 * client/question/question-kit.tsx — 统一题目渲染域（cycle-25 v1.20.0）
 *
 * 用户诉求：单题渲染逻辑用同一套七段结构——
 *   0.编号 1.来源 2.类型 3.材料 4.问题 5.选项 6.答案与解析（3-6 可含图，支持折叠/展开/放大缩小）。
 * 整卷做题模式复用同一数据结构（QwQuestion），显示逻辑按 mode 变化 + 答题卡跳转。
 *
 * 组成（全部 Qw* 前缀，combo 单作用域唯一）：
 *  - QwQuestionCard：七段组装器（宿主唯一消费面；mode: 'single' | 'practice' | 'exam' | 'browse'）
 *  - QwNumberBadge（0）/ QwSourceMeta（1）/ QwTypeTag（2）/ QwMaterial（3，受控折叠）
 *    / QwStem（4）/ QwOptions（5，interactive 三态 / readonly）/ QwAnswerDims（6 五维+参考答案）
 *  - QwExamNavigator：整卷做题答题卡（网格跳转 + 未答/已答/标记/当前四态 + 计数）
 *  - QwQuestionLightboxHost：全组件域共享一个 Lightbox 实例（context 驱动，避免每图一个遮罩）
 *
 * 纪律：
 *  - 受控折叠：QwMaterial 的 collapsed/onToggle 由宿主持有（smoke 材料折叠契约保留在视图源码）
 *  - R9：所有早退 return 在全部 hooks 之后；派生防御读取（C24-2/C24-3）
 *  - 零模块级可变状态（R7 热重载竞态）
 */

import { h, React, entries, RichText, OptionRow, DimBlock, SourceBadge, KV_TAG, KV_BTN } from '../ui-kit.js'
import { QwLightbox } from './question-lightbox.js'

/* ══════════════ Lightbox 宿主（context 驱动，全组件域共享单实例） ══════════════ */

/** Lightbox 上下文：openLightbox(src, alt) 由 Host 提供；null = 未启用缩放 */
const QwZoomCtx: any = (React as any).createContext(null)

/** RichText 缩放管道：把 markdown 图片段交给 context（Host 渲染时挂 QwZoomHost） */
interface QwZoomHostProps { children: any }
export function QwZoomHost({ children }: QwZoomHostProps) {
  const [cur, setCur] = React.useState(null)
  const openLightbox = React.useCallback((src: string, alt?: string) => {
    setCur({ src: String(src || ''), alt: String(alt || '题目配图') })
  }, [])
  return (
    <QwZoomCtx.Provider value={openLightbox}>
      {children}
      {cur ? <QwLightbox src={cur.src} alt={cur.alt} onClose={() => setCur(null)} /> : null}
    </QwZoomCtx.Provider>
  )
}

/** 内部辅助：在 QwZoomHost 内时渲染可点击 img，否则退化静态 img（无条件守卫，零破坏） */
function QwImg(props: { src: string; alt?: string; style?: any }) {
  const openLightbox: any = React.useContext(QwZoomCtx)
  const { src, alt, style } = props
  if (typeof openLightbox !== 'function') {
    return <img src={src} alt={alt || '题目配图'} loading="lazy" style={style} />
  }
  return (
    <img
      src={src}
      alt={(alt || '题目配图') + '（点击放大）'}
      loading="lazy"
      style={{ ...style, cursor: 'zoom-in' }}
      title="点击放大查看"
      onClick={(e: any) => { e.stopPropagation(); openLightbox(src, alt) }}
    />
  )
}

/* ══════════════ 数据契约：QwQuestion（七段规范化输入） ══════════════ */

/** 五维标注（深度题库 27506 题的 kadian/reasoning/fastest/pitfalls/mother） */
interface QwDims { analysis?: string; kadian?: string; reasoning?: string; fastest?: string; pitfalls?: string; mother?: string }

/** 七段题目（各视图把既有对象 map 成此形态接入；字段有则渲染，不臆造空段） */
interface QwQuestion {
  no?: any; score?: number; flagged?: boolean          // 0 编号/分值/标记旗
  source?: string; exam?: string; year?: any; region?: string; paperFile?: string  // 1 来源
  type?: string; module?: string                        // 2 类型
  material?: string; materialRef?: string               // 3 材料
  stem?: string; requirement?: string                   // 4 题干（requirement 为申论作答要求）
  options?: Record<string, string>                      // 5 选项
  answer?: string; analysis?: string; dims?: QwDims; reference?: string  // 6 答案/解析/五维/参考答案
}

/** 渲染模式：single=单题浏览 practice=练习判分 exam=整卷做题 browse=整卷只读 */
type QwMode = 'single' | 'practice' | 'exam' | 'browse'
/* ══════════════ 0 编号 ══════════════ */

/** QwNumberBadge props：no 编号；score 分值可选；flagged 标记旗可选；onToggleFlag 可选 */
interface QwNumberBadgeProps { no: any; score?: number; flagged?: boolean; onToggleFlag?: () => void }
export function QwNumberBadge({ no, score, flagged, onToggleFlag }: QwNumberBadgeProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13.5, flexShrink: 0 }}>{String(no == null ? '?' : no)}</span>
      {typeof score === 'number' && score > 0 ? <span style={{ ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{score + ' 分'}</span> : null}
      {typeof onToggleFlag === 'function'
        ? <span
            title={flagged ? '取消标记本题' : '标记本题（答题卡黄点）'}
            onClick={onToggleFlag}
            style={{ cursor: 'pointer', fontSize: 14, lineHeight: 1, userSelect: 'none' }}
          >{flagged ? '🚩' : '🏳️'}</span>
        : null}
    </span>
  )
}

/* ══════════════ 1 来源 ══════════════ */

/** QwSourceMeta props：透传 SourceBadge 字段；browse 模式下隐藏（整卷页头已含卷源） */
interface QwSourceMetaProps { q: QwQuestion; hideInBrowse?: boolean }
export function QwSourceMeta({ q, hideInBrowse }: QwSourceMetaProps) {
  if (hideInBrowse && !q.source) return null
  if (!q.source && !q.exam && !q.paperFile) return null
  return <SourceBadge {...({ source: q.source, exam: q.exam, year: q.year, region: q.region, paperFile: q.paperFile } as any)} />
}

/* ══════════════ 2 类型 ══════════════ */

/** QwTypeTag props：module 模块 / type 题型，有则渲染 chip */
interface QwTypeTagProps { q: QwQuestion }
export function QwTypeTag({ q }: QwTypeTagProps) {
  if (!q.type && !q.module) return null
  return (
    <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
      {q.module ? <span style={{ ...KV_TAG, background: 'rgba(99,102,241,.1)', color: '#4338ca' }}>{'📕 ' + String(q.module)}</span> : null}
      {q.type ? <span style={{ ...KV_TAG, background: 'rgba(14,165,233,.1)', color: '#0284c7' }}>{'🏷 ' + String(q.type)}</span> : null}
    </span>
  )
}

/* ══════════════ 3 材料（受控折叠） ══════════════ */

/** QwMaterial props：受控（collapsed/onToggle 由宿主持有，保 smoke 材料折叠契约）或自治
 *  （无 onToggle 时组件内自持折叠态，长材料 >500 字默认折叠——browse 模式题组材料形态）。
 *  ⚠ matRef（勿名 ref）：ref 是 React 保留 prop——经 createElement 传字符串 ref 会在
 *  DOM 提交期抛错使整卡进 ErrorBoundary（cycle-26 实测「整卷面板渲染降级」根因）。 */
interface QwMaterialProps { text: string; matRef?: string; collapsed?: boolean; onToggle?: () => void }
export function QwMaterial({ text, matRef: materialRef, collapsed, onToggle }: QwMaterialProps) {
  /* ── R9：hooks 全顶部；自治模式才用的 useState（受控模式下恒 false，hook 链恒定） ── */
  const [selfCollapsed, setSelfCollapsed] = React.useState(null as boolean | null)
  const body = String(text || '')
  if (!body) return null
  const wordCount = body.replace(/\s/g, '').length
  // 受控模式：collapsed prop 生效；自治模式：长材料默认折叠（首次渲染计算一次）
  const isCollapsed = typeof onToggle === 'function'
    ? !!collapsed
    : (selfCollapsed != null ? selfCollapsed : wordCount > 500)
  const toggle = typeof onToggle === 'function' ? onToggle : () => setSelfCollapsed(v => !(v != null ? v : wordCount > 500))
  return (
    <div style={{ marginBottom: 10, padding: 12, background: 'rgba(14,165,233,.06)', borderRadius: 10, borderLeft: '3px solid #0ea5e9' }}>
      {/* 材料头：标题行 + 字数；整行可点折叠/展开（受控或自治） */}
      <div
        style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#0ea5e9', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
        onClick={toggle}
        title={isCollapsed ? '展开材料' : '折叠材料'}
      >
        <span style={{ display: 'inline-block', transition: 'transform .2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>{'▸'}</span>
        <span>{'📄 材料'}</span>
        {materialRef ? <span style={{ fontWeight: 400, fontSize: 10.5, color: '#64748b' }}>{String(materialRef).slice(0, 40)}</span> : null}
        <span style={{ fontWeight: 400, fontSize: 10.5, color: '#94a3b8' }}>{'约 ' + wordCount + ' 字' + (isCollapsed ? ' · 点击展开' : '')}</span>
      </div>
      {!isCollapsed ? <RichText text={body} fontSize={12.5} /> : null}
    </div>
  )
}

/* ══════════════ 4 题干 ══════════════ */

/** QwStem props：stem 题干；requirement 申论作答要求可选 */
interface QwStemProps { q: QwQuestion }
export function QwStem({ q }: QwStemProps) {
  const body = String(q.stem || '')
  if (!body) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <RichText text={body} fontSize={14} />
      {q.requirement ? <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 6 }}>{'作答要求：' + String(q.requirement)}</div> : null}
    </div>
  )
}

/* ══════════════ 5 选项 ══════════════ */

/** QwOptions props：两种形态——
 *  interactive：practice/exam 模式，selected/chosen 态 + onSelect 回调（right/wrong 判分揭示）
 *  readonly：single/browse 模式，纯展示（含图片选项 RichText 化） */
interface QwOptionsProps {
  q: QwQuestion
  interactive?: boolean
  selected?: string
  right?: string
  revealed?: boolean
  disabled?: boolean
  onSelect?: (letter: string) => void
}
export function QwOptions({ q, interactive, selected, right, revealed, disabled, onSelect }: QwOptionsProps) {
  const opts = entries(q.options || {})
  if (!opts.length) return null
  if (!interactive) {
    // 浏览态：答案字母描边高亮（right 已知时），其余纯展示
    return <div>{opts.map(([L, txt]) => {
      const isRight = revealed && typeof right === 'string' && right.toUpperCase() === L.toUpperCase()
      return (
        <div key={L} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', marginTop: 6, border: '1.5px solid ' + (isRight ? '#10b981' : 'rgba(148,163,184,.22)'), background: isRight ? 'rgba(16,185,129,.07)' : 'transparent', borderRadius: 10, fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: isRight ? '#10b981' : 'rgba(148,163,184,.15)', color: isRight ? '#fff' : 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{L}</div>
          <div style={{ flex: 1, minWidth: 0 }}>{String(txt || '').includes('![') || String(txt || '').includes('kgimg://') ? <RichText text={String(txt)} fontSize={13} /> : String(txt)}</div>
        </div>
      )
    })}</div>
  }
  // 交互态：OptionRow 三态（idle/chosen/right/wrong）
  return <div>{opts.map(([L, text]) => {
    let state = 'idle'
    if (selected === L) state = 'chosen'
    if (revealed && typeof right === 'string') {
      if (right.toUpperCase() === L.toUpperCase()) state = 'right'
      else if (selected === L) state = 'wrong'
    }
    return <OptionRow {...({ key: L, label: L, text: String(text || ''), state, disabled, onClick: () => { if (!disabled && typeof onSelect === 'function') onSelect(L) } } as any)} />
  })}</div>
}

/* ══════════════ 6 答案与解析 ══════════════ */

/** QwAnswerDims props：五维标注（analysis/kadian/reasoning/fastest/pitfalls/mother）+ 答案行 + 参考答案折叠 */
interface QwAnswerDimsProps { q: QwQuestion; revealed?: boolean; answerOf?: string }
export function QwAnswerDims({ q, revealed, answerOf }: QwAnswerDimsProps) {
  const d = q.dims || ({} as QwDims)
  const hasDims = !!(d.analysis || d.kadian || d.reasoning || d.fastest || d.pitfalls || d.mother)
  const hasPlain = !!q.analysis || !!q.reference || typeof q.answer === 'string'
  if (!revealed && !hasDims && !hasPlain) return null
  // 未揭示（practice 模式未答）：只显示「提交后可见」占位，不泄露
  if (!revealed && !hasDims) {
    return <div style={{ marginTop: 10, fontSize: 11.5, color: '#94a3b8' }}>{'提交作答后显示答案与解析'}</div>
  }
  return (
    <div style={{ marginTop: 10 }}>
      {/* 答案行：practice 揭示后 / single 浏览态 */}
      {(typeof q.answer === 'string' && q.answer) || answerOf ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ ...KV_TAG, background: 'rgba(16,185,129,.14)', color: '#059669' }}>{'✅ 答案：' + (answerOf || String(q.answer))}</span>
        </div>
      ) : null}
      {/* 五维标注（统一走 DimBlock 语义色板） */}
      {d.analysis ? <DimBlock kind="analysis" text={d.analysis} /> : null}
      {d.kadian ? <DimBlock kind="kadian" text={d.kadian} /> : null}
      {d.reasoning ? <DimBlock kind="reasoning" text={d.reasoning} /> : null}
      {d.fastest ? <DimBlock kind="fastest" text={d.fastest} /> : null}
      {d.pitfalls ? <DimBlock kind="pitfalls" text={d.pitfalls} /> : null}
      {d.mother ? <DimBlock kind="mother" text={d.mother} /> : null}
      {/* 深度题库平铺解析（dims 缺 analysis 时回落） */}
      {!d.analysis && q.analysis ? (
        <div style={{ marginBottom: 10, padding: 12, background: 'rgba(148,163,184,.07)', borderRadius: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#64748b' }}>{'📖 解析'}</div>
          <RichText text={q.analysis} />
        </div>
      ) : null}
      {/* 申论参考答案（<details> 折叠，保 papers 契约形态） */}
      {q.reference ? (
        <details style={{ fontSize: 12, lineHeight: 1.75 }}>
          <summary style={{ cursor: 'pointer', color: '#6366f1', fontWeight: 600, fontSize: 12 }}>{'▸ 参考答案'}</summary>
          <div style={{ marginTop: 8, padding: 10, background: 'rgba(148,163,184,.08)', borderRadius: 8 }}><RichText text={q.reference} /></div>
        </details>
      ) : null}
    </div>
  )
}

/* ══════════════ 整卷做题：答题卡（借鉴粉笔/华图） ══════════════ */

/** QwExamNavigator props：
 *  questions 题目数组（no 唯一）；answers 已答 Map<no, letter>；flags 标记 Set<no>；
 *  current 当前下标；onJump(i) 跳转；narrow 窄屏折叠态由宿主持有 */
interface QwExamNavigatorProps {
  questions: any[]
  answers: Record<string, string>
  flags?: Set<any>
  current: number
  onJump: (i: number) => void
}
export function QwExamNavigator({ questions, answers, flags, current, onJump }: QwExamNavigatorProps) {
  const answeredCount = questions.filter(q => answers[q.no] != null).length
  const total = questions.length
  const pct = total ? Math.round(answeredCount / total * 100) : 0
  return (
    <div style={{ padding: 12, border: '1px solid rgba(148,163,184,.2)', borderRadius: 12, background: 'var(--surface-card,#fff)', marginBottom: 12 }}>
      {/* 头部：进度统计 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 12.5 }}>{'🗂 答题卡'}</span>
        <span style={{ fontSize: 11.5, color: '#64748b' }}>{'已答 ' + answeredCount + '/' + total + '（' + pct + '%）'}</span>
        <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{'🚩 标记 ' + ((flags && flags.size) || 0)}</span>
        <span style={{ fontSize: 10.5, color: '#94a3b8', marginLeft: 'auto' }}>{'灰=未答 · 蓝=已答 · 黄=标记 · 描边=当前'}</span>
      </div>
      {/* 网格：每题一格，四态着色（确定性遍历：题目顺序即网格顺序） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))', gap: 6 }}>
        {questions.map((q, i) => {
          const answered = answers[q.no] != null
          const flagged = !!(flags && flags.has(q.no))
          const isCur = i === current
          return (
            <div
              key={String(q.no) + '-' + i}
              title={'第 ' + q.no + ' 题' + (q.type ? ' · ' + q.type : '') + (answered ? ' · 已答 ' + answers[q.no] : ' · 未答') + (flagged ? ' · 已标记' : '')}
              onClick={() => onJump(i)}
              style={{
                height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11.5, fontWeight: 700, cursor: 'pointer', userSelect: 'none',
                background: isCur ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : answered ? 'rgba(99,102,241,.12)' : 'rgba(148,163,184,.1)',
                color: isCur ? '#fff' : answered ? '#4338ca' : '#64748b',
                border: isCur ? '2px solid #4f46e5' : flagged ? '2px solid #f59e0b' : '1px solid rgba(148,163,184,.18)',
              }}
            >{String(q.no)}</div>
          )
        })}
      </div>
    </div>
  )
}

/* ══════════════ 七段组装器 ══════════════ */

/** QwQuestionCard props：
 *  q 七段题目；mode 渲染模式；interactive/onSelect/selected/right/revealed 选项态；
 *  matCollapsed/matOnToggle 材料受控折叠；onToggleFlag 标记旗；hideSourceInBrowse 浏览态隐藏来源行 */
interface QwQuestionCardProps {
  q: QwQuestion
  mode?: QwMode
  interactive?: boolean
  selected?: string
  right?: string
  revealed?: boolean
  disabled?: boolean
  onSelect?: (letter: string) => void
  matCollapsed?: boolean
  matOnToggle?: () => void
  onToggleFlag?: () => void
}
export function QwQuestionCard({ q, mode = 'single', interactive, selected, right, revealed, disabled, onSelect, matCollapsed, matOnToggle, onToggleFlag }: QwQuestionCardProps) {
  const isBrowse = mode === 'browse'
  return (
    <div style={{ padding: '14px 16px', background: 'var(--surface-card,#fff)', borderRadius: 14, border: '1px solid rgba(148,163,184,.15)', boxShadow: '0 1px 3px rgba(0,0,0,.07)', marginBottom: 12 }}>
      {/* 头部：0 编号 + 1 来源 + 2 类型（一行三段，browse 模式来源行由页面头承担） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <QwNumberBadge no={q.no} score={q.score} flagged={q.flagged} onToggleFlag={onToggleFlag} />
        <div style={{ flex: 1, minWidth: 120 }}>
          <QwSourceMeta q={q} hideInBrowse={isBrowse} />
          <QwTypeTag q={q} />
        </div>
      </div>
      {/* 3 材料（受控折叠；matRef 为材料副标题——ref 是 React 保留 prop，禁用作 prop 名） */}
      <QwMaterial text={q.material} matRef={q.materialRef} collapsed={matCollapsed} onToggle={matOnToggle} />
      {/* 4 题干 */}
      <QwStem q={q} />
      {/* 5 选项 */}
      <QwOptions q={q} interactive={interactive} selected={selected} right={right} revealed={revealed} disabled={disabled} onSelect={onSelect} />
      {/* 6 答案与解析 */}
      <QwAnswerDims q={q} revealed={revealed} />
    </div>
  )
}

/* ══════════════ 整卷容器：四区划分（cycle-27 v1.23.0） ══════════════ */

/**
 * QwPaperMode — 整卷模式容器（用户诉求四区划分，exam/browse 双态复用）：
 *   区1 材料区：当前题的题组材料（QwMaterial 自治折叠；无则整区隐藏）
 *   区2 题目区：QwQuestionCard（当前题；material 段禁传——材料已在区1，避免双事实源）
 *   区3 题目切换区：上一题/下一题 + 位置指示
 *   区4 答题卡区：QwExamNavigator（exam 交互四态 / browse 只读跳转）
 * 题组感知：材料区显示「共 X 题用此材料」；同组题切换时材料区不重挂（key=材料文本头）。
 * R9：hooks 全顶部；早退在全部 hooks 之后。
 */
interface QwPaperModeProps {
  questions: any[]
  current: number
  onJump: (i: number) => void
  // cycle-28：扩展 'practice' —— 专题刷题队列（同卷资料分析题组）复用四区体验：
  // 题目区=QwQuestionCard practice 判分交互；材料区/切换区/答题卡区与 exam 同构
  mode?: 'exam' | 'browse' | 'practice'
  paperMeta?: { exam?: string; year?: any; subject?: string; paperType?: string }
  // exam 态做题交互
  answers?: Record<string, string>
  flags?: Set<any>
  onSelect?: (letter: string) => void
  onToggleFlag?: (no: any) => void
  // practice 态判分交互（cycle-28）：selected/right/revealed 由宿主 useState 持有
  selected?: string
  right?: string
  revealed?: boolean
  disabled?: boolean
}

/** 题组材料 key：取材料文本头 24 字（同组题材料一致 → key 稳定 → 切题不重挂） */
function qwMatKey(text) {
  return String(text || '').slice(0, 24)
}

export function QwPaperMode({ questions, current, onJump, mode = 'exam', paperMeta, answers, flags, onSelect, onToggleFlag, selected, right, revealed, disabled }: QwPaperModeProps) {
  /* ── hooks（R9）：全顶部恒定 ── */
  const [navCollapsed, setNavCollapsed] = React.useState(false)
  const q = questions[current] || {}
  const isExam = mode === 'exam'
  const isPractice = mode === 'practice'
  // 题组材料：同组题共享同一段文本；无组材料的题整区隐藏
  const groupMaterial = String(q.groupMaterial || '')
  // 该材料被多少题共享 + 当前题在组内的位置（O(N) 顺序遍历，确定性）
  let groupCount = 0
  let groupPos = 0
  if (groupMaterial) {
    for (const x of questions) if (x.groupMaterial === q.groupMaterial) groupCount++
    // 组内位置：本组内排在当前题之前的题数 + 1（同组按题目顺序）
    for (let i = 0; i < current && i < questions.length; i++) if (questions[i].groupMaterial === q.groupMaterial) groupPos++
    groupPos++
  }
  const wide = typeof window !== 'undefined' && (window as any).innerWidth >= 1100

  return (
    <div>
      {/* 顶部状态条（exam/practice 态由宿主渲染倒计时/统计条；browse 态显示卷源 meta） */}
      {mode === 'browse' && paperMeta ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {paperMeta.exam ? <span style={KV_TAG}>{paperMeta.exam + ' ' + paperMeta.year}</span> : null}
          {paperMeta.subject ? <span style={KV_TAG}>{paperMeta.subject + (paperMeta.paperType ? ' · ' + paperMeta.paperType : '')}</span> : null}
          <span style={{ fontSize: 11.5, color: '#64748b' }}>{(questions.length) + ' 题 · 整卷浏览'}</span>
        </div>
      ) : null}
      {/* 区4 答题卡区（宽屏提到顶部右侧更贴近做题动线；窄屏纵向堆叠在材料/题目之后 → 由 CSS order 控制，
          此处统一放顶部：exam 宿主原形态即顶部，browse 新增也置顶保持一致性） */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 12.5 }}>{'🗂 答题卡'}</span>
          <button style={{ ...KV_BTN, fontSize: 10.5, padding: '2px 8px' }} onClick={() => setNavCollapsed(v => !v)}>
            {navCollapsed ? '展开答题卡' : '收起答题卡'}
          </button>
        </div>
        {!navCollapsed ? (
          <QwExamNavigator questions={questions} answers={answers || {}} flags={flags} current={current} onJump={onJump} />
        ) : null}
      </div>
      {/* 区1 材料区（题组材料；无则隐藏）+ 区2 题目区 */}
      <div style={wide ? { display: 'flex', gap: 14, alignItems: 'flex-start' } : undefined}>
        {/* 材料区：宽屏左栏 38%；key=材料文本头 → 同组切题不重挂（折叠态保留） */}
        {groupMaterial ? (
          <div key={qwMatKey(groupMaterial)} style={wide ? { width: '38%', flexShrink: 0 } : { marginBottom: 10 }}>
            <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 4 }}>
              {'📄 题组材料 · 共 ' + groupCount + ' 题用此材料 · 本组第 ' + groupPos + '/' + groupCount + ' 题'}
              {/* 组边界提示：下一题是否仍在同组（首/尾题特别标注，用户可预期材料区即将隐藏/切换） */}
              {current + 1 < questions.length && questions[current + 1].groupMaterial === q.groupMaterial ? '' : current > 0 && questions[current - 1].groupMaterial === q.groupMaterial ? ' · 下一题换材料' : ''}
            </div>
            <QwMaterial text={groupMaterial} matRef={'材料 ' + String(q.groupMaterialNo || '')} />
          </div>
        ) : null}
        {/* 题目区：QwQuestionCard（material 禁传——材料已在区1；exam/practice 态交互选项） */}
        <div style={wide ? { flex: 1, minWidth: 0 } : undefined}>
          <QwQuestionCard
            mode={mode}
            interactive={isExam || isPractice}
            q={{
              no: q.no, score: q.score, type: q.type, groupMaterialNo: q.groupMaterialNo || 0,
              exam: isExam || isPractice ? (paperMeta && paperMeta.subject) || q.exam : q.exam,
              year: isExam || isPractice ? (paperMeta && paperMeta.year) || q.year : q.year,
              module: q.module,
              source: q.source, region: q.region, paperFile: q.paperFile,
              stem: q.stem, options: q.options,
              flagged: flags && flags.has ? flags.has(q.no) : false,
              requirement: q.requirement, reference: q.reference,
              answer: q.answer, analysis: q.analysis,
              dims: q.dims,
            } as any}
            // exam 态：answers[q.no]；practice 态：宿主 selected/right/revealed（判分揭示三态）
            selected={isExam ? (answers && answers[q.no]) : selected}
            right={right}
            revealed={isExam ? false : revealed}
            disabled={isPractice ? disabled : undefined}
            onSelect={isExam || isPractice ? onSelect : undefined}
            onToggleFlag={onToggleFlag ? () => onToggleFlag(q.no) : undefined}
          />
        </div>
      </div>
      {/* 区3 题目切换区（上一题/下一题 + 位置指示；render 锚点文本「← 上一题」「下一题 →」保留） */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button style={KV_BTN} disabled={current <= 0} onClick={() => onJump(Math.max(0, current - 1))}>{'← 上一题'}</button>
        <button style={KV_BTN} disabled={current >= questions.length - 1} onClick={() => onJump(Math.min(questions.length - 1, current + 1))}>{'下一题 →'}</button>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#64748b' }}>{(current + 1) + ' / ' + questions.length}</span>
      </div>
    </div>
  )
}
