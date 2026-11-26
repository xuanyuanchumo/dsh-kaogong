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

import { React, entries, RichText, OptionRow, DimBlock, SourceBadge, KV_TAG, KV_BTN } from '../ui-kit.js'
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



/* ══════════════ 数据契约：QwQuestion（七段规范化输入） ══════════════ */

/** 五维标注（深度题库 27506 题的 kadian/reasoning/fastest/pitfalls/mother） */
interface QwDims { analysis?: string; kadian?: string; reasoning?: string; fastest?: string; pitfalls?: string; mother?: string }

/** 七段题目（各视图把既有对象 map 成此形态接入；字段有则渲染，不臆造空段） */
/**
 * QwQuestion — 七段渲染的题目形状（cycle-62 补齐，**字段零遗漏的类型底线**）
 *
 * ── 为什么要有这个类型（教训）──
 * 原接口只声明了 `no/answer/material` 等 12 个字段，而服务端 `/api/questions` 的
 * 实际出站形状是 **`number` / `correctAnswer` / `groupMaterial` / `groupMaterialNo`**
 * —— 类型没声明的字段，`strict` 编译期发现不了「读了不存在的字段」，
 * 于是三处读错字段（`q.no` / `q.answer` / `q.material`）同时静默生效：
 *   ① 题号恒 `?`（读 q.no，实际发 number）；
 *   ② 答案永不显示（读 q.answer，实际发 correctAnswer）；
 *   ③ 材料永不显示（读 q.material，实际发 groupMaterial）。
 * ⇒ 纪律：**凡渲染层消费的字段，必须在类型里出现**；服务端新增投影字段时同步补类型，
 *    否则「字段存在性」只能靠人肉核对（本次就是漏了三处）。
 *
 * 双写法（both）是**兼容层**：统一池出站用右列名，真题卷/旧错题快照用左列名。
 */
interface QwQuestion {
  /* 0 编号 —— no（真题卷/模考）与 number（统一池出站）双写 */
  no?: any; number?: any; score?: number; flagged?: boolean
  /* 1 来源 */
  source?: string; exam?: string; year?: any; region?: string; paperFile?: string
  /* 2 类型 */
  type?: string; module?: string; kadian?: string
  /* 3 材料 —— groupMaterial（统一池原生）/ material（真题卷与旧快照）双写 */
  material?: string; groupMaterial?: string; groupMaterialNo?: number; materialRef?: string
  /* 4 题干（requirement 为申论作答要求） */
  stem?: string; requirement?: string; images?: any[]
  /* 5 选项（值可为含 kgimg:// 占位或 markdown 图的文本） */
  options?: Record<string, string>
  /* 6 答案 —— correctAnswer（统一池出站）/ answer（真题卷）双写 */
  answer?: string; correctAnswer?: string
  /* 7 解析与五维 */
  analysis?: string; dims?: QwDims; reference?: string
  /* 溯源（白盒/双写用，不直接渲染） */
  id?: string; canonicalId?: string; qid?: string; sources?: any[]; sourceCount?: number
}

/** 渲染模式：single=单题浏览 practice=练习判分 exam=整卷做题 browse=整卷只读 */
type QwMode = 'single' | 'practice' | 'exam' | 'browse'
/* ══════════════ 0 编号 ══════════════ */

/** QwNumberBadge props：no 编号；score 分值可选；flagged 标记旗可选；onToggleFlag 可选 */
interface QwNumberBadgeProps { no: any; score?: number; flagged?: boolean; onToggleFlag?: () => void }
export function QwNumberBadge({ no, score, flagged, onToggleFlag }: QwNumberBadgeProps) {
  /**
   * cycle-62 题号字段修复（用户报「题号显示 ?」）：本组件收的是 `no`，而调用方
   * `QwQuestionCard` 传 `q.no` —— 统一池出站形状历史上只有 `number`（且恒 0）、
   * 真题卷形态才用 `no` → 练习/专题链路的题号整段显示 `?`。
   * 正解 = 组件内双字段兼容（number 优先，与出站映射的语义一致），
   * 两者都无/为 0 时才显示 `?`（不臆造编号）。
   */
  const n = (no != null && no !== '' && no !== 0) ? no : null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13.5, flexShrink: 0 }}>{String(n == null ? '?' : n)}</span>
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
  const toggle = typeof onToggle === 'function' ? onToggle : () => setSelfCollapsed((v: any) => !(v != null ? v : wordCount > 500))
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
interface QwAnswerDimsProps { q: QwQuestion; revealed?: boolean; answerOf?: string; hideBeforeAnswer?: boolean }
export function QwAnswerDims({ q, revealed, answerOf, hideBeforeAnswer }: QwAnswerDimsProps) {
  const d = q.dims || ({} as QwDims)
  const hasDims = !!(d.analysis || d.kadian || d.reasoning || d.fastest || d.pitfalls || d.mother)
  /**
   * ⚠️ cycle-62 答案字段修复（用户报「答案没显示」）：本组件原统一读 `q.answer`，
   * 但 `/api/questions` 与 `/api/pool/questions` 的**出站映射发的是 `correctAnswer`**
   * （池原生字段名，见 server/poolApi.ts L266/308）——`q.answer` 恒 undefined
   * → 「✅ 答案：X」整行永不渲染，只剩解析（用户可感知「有解析但没答案」）。
   *
   * 正解 = `correctAnswer` 优先 + `answer` 回落，两者都收成一个本地 answerText：
   *   · correctAnswer：统一池出站形状（练习/专题/模考主链路）
   *   · answer：真题卷 parseQuestion 形态（部分卷直出 answer）+ 旧错题快照
   * 判据同源：hasPlain 与答案行渲染都用同一个 answerText，避免「答案在但守卫说没有」。
   */
  const answerText = (typeof q.correctAnswer === 'string' && q.correctAnswer)
    || (typeof q.answer === 'string' && q.answer)
    || ''
  const hasPlain = !!q.analysis || !!q.reference || !!answerText
  if (!revealed && !hasDims && !hasPlain) return null
  // cycle-32b（用户报「学习模式的解析要答题之后才能显示」）：占位语义按 mode 分流——
  // practice/learn 是「作答后判分」场景（hideBeforeAnswer=true）：未揭示时解析/答案/参考答案
  // 一律占位隐藏（防偷看，cycle-31 放宽条件误伤了这里）；
  // browse/single 是「看卷面答案」场景（hideBeforeAnswer=false）：解析/参考答案未揭示也完整
  // 渲染（对照按钮只控制判色不控制内容隐藏，cycle-31 修复的语义只对浏览场景成立）。
  if (!revealed && hideBeforeAnswer) {
    return <div style={{ marginTop: 10, fontSize: 11.5, color: '#94a3b8' }}>{'提交作答后显示答案与解析'}</div>
  }
  return (
    <div style={{ marginTop: 10 }}>
      {/* 答案行：practice 揭示后 / single 浏览态（answerOf 为宿主显式覆盖值，优先） */}
      {answerOf || answerText ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ ...KV_TAG, background: 'rgba(16,185,129,.14)', color: '#059669' }}>{'✅ 答案：' + (answerOf || answerText)}</span>
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
  /**
   * 序号口径（cycle-62 · 用户确认）：**答题卡一律用位置号 `i + 1`**。
   *
   * 原实现用题目自带的 `q.no` 作格子文案与状态键，但统一池出站形状的 `no`
   * 依赖卷内序号 `seq`：naoku 等源**没有卷内序号**（seq=0）→ 格子显示 `0`/空，
   * 且 `answers[q.no]` 全部撞成同一个 key（`0`）→ 已答态互相污染。
   *
   * 位置号是答题卡唯一自洽的口径：第 i 格 = 第 i+1 题，与「当前题 current」
   * 和题目卡头的编号同源。答案/标记的状态键也随之收敛到位置号（DOM 内一致）。
   */
  const noOf = (q: any, i: number) => {
    const n = Number(q && (q.no != null ? q.no : q.number))
    return Number.isFinite(n) && n > 0 ? n : i + 1
  }
  const answeredCount = questions.filter((q, i) => answers[noOf(q, i)] != null).length
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
          const no = noOf(q, i)
          const answered = answers[no] != null
          const flagged = !!(flags && flags.has(no))
          const isCur = i === current
          return (
            <div
              key={no + '-' + i}
              title={'第 ' + no + ' 题' + (q.type ? ' · ' + q.type : '') + (answered ? ' · 已答 ' + answers[no] : ' · 未答') + (flagged ? ' · 已标记' : '')}
              onClick={() => onJump(i)}
              style={{
                height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11.5, fontWeight: 700, cursor: 'pointer', userSelect: 'none',
                background: isCur ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : answered ? 'rgba(99,102,241,.12)' : 'rgba(148,163,184,.1)',
                color: isCur ? '#fff' : answered ? '#4338ca' : '#64748b',
                border: isCur ? '2px solid #4f46e5' : flagged ? '2px solid #f59e0b' : '1px solid rgba(148,163,184,.18)',
              }}
            >{String(no)}</div>
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
  /**
   * 题号双字段兼容（cycle-62）：统一池出站形状是 `number`，真题卷/模考是 `no`——
   * 原实现只传 `q.no` → 池链路（练习/专题/深度题库）题号恒 `?`。
   */
  const qNo = (q.no != null && q.no !== '') ? q.no : (q.number != null && q.number !== '' ? q.number : null)
  return (
    <div style={{ padding: '14px 16px', background: 'var(--surface-card,#fff)', borderRadius: 14, border: '1px solid rgba(148,163,184,.15)', boxShadow: '0 1px 3px rgba(0,0,0,.07)', marginBottom: 12 }}>
      {/* 头部：0 编号 + 1 来源 + 2 类型（一行三段，browse 模式来源行由页面头承担） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <QwNumberBadge no={qNo} score={q.score} flagged={q.flagged} onToggleFlag={onToggleFlag} />
        <div style={{ flex: 1, minWidth: 120 }}>
          <QwSourceMeta q={q} hideInBrowse={isBrowse} />
          <QwTypeTag q={q} />
        </div>
      </div>
      {/* 3 材料（受控折叠；matRef 为材料副标题——ref 是 React 保留 prop，禁用作 prop 名）
          ⚠️ cycle-62 字段修复（用户报「材料没显示」）：本卡片原读 `q.material`，
          但服务端 `/api/questions` 投影只发 **`groupMaterial`**（池原生字段，见
          server/poolApi.ts 出站映射）——`q.material` 恒为 undefined → **单题卡材料永不渲染**。
          题干/来源/选项/解析/答案均正常，唯独材料整段丢失（用户可感知「题目没有对应的材料」）。
          正解 = `groupMaterial` 优先 + `material` 回落（兼容真题卷/旧错题快照的 material 形态）。 */}
      <QwMaterial text={q.groupMaterial || q.material || ''} matRef={q.materialRef || ''} collapsed={matCollapsed} onToggle={matOnToggle} />
      {/* 4 题干 */}
      <QwStem q={q} />
      {/* 5 选项 */}
      <QwOptions q={q} interactive={interactive} selected={selected} right={right} revealed={revealed} disabled={disabled} onSelect={onSelect} />
      {/* 6 答案与解析 */}
      {/* 6 答案与解析（cycle-32b：hideBeforeAnswer 按 mode 分流——practice/exam 答题场景
          未揭示占位防偷看；browse/single 浏览场景解析完整显示） */}
      <QwAnswerDims q={q} revealed={revealed} hideBeforeAnswer={mode === 'practice' || mode === 'exam'} />
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
  // cycle-30：browse 态自答对照（用户报「真题卷的答案选择交互功能没了」的根治）——
  // browse 不再纯只读：点选项=记录自选（selected 由宿主持有），宿主主动揭示后
  // revealed=true → QwOptions 绿/红判色 + QwAnswerDims 展开。与 practice 同构转发，
  // 容器层零新分支（C28 教训：mode 差异只在判分态来源）。
  browseAnswers?: Record<string, string>
}

/** 题组材料 key：取材料文本头 24 字（同组题材料一致 → key 稳定 → 切题不重挂） */
function qwMatKey(text: any) {
  return String(text || '').slice(0, 24)
}

export function QwPaperMode({ questions, current, onJump, mode = 'exam', paperMeta, answers, flags, onSelect, onToggleFlag, selected, right, revealed, disabled, browseAnswers }: QwPaperModeProps) {
  /* ── hooks（R9）：全顶部恒定 ── */
  const [navCollapsed, setNavCollapsed] = React.useState(false)
  const q = questions[current] || {}
  const isExam = mode === 'exam'
  const isPractice = mode === 'practice'
  const isBrowse = mode === 'browse'
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
          <button style={{ ...KV_BTN, fontSize: 10.5, padding: '2px 8px' }} onClick={() => setNavCollapsed((v: any) => !v)}>
            {navCollapsed ? '展开答题卡' : '收起答题卡'}
          </button>
        </div>
        {!navCollapsed ? (
          <QwExamNavigator questions={questions} answers={(isBrowse && browseAnswers) ? browseAnswers : (answers || {})} flags={flags} current={current} onJump={onJump} />
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
            interactive={isExam || isPractice || isBrowse}
            /**
             * 题号口径（cycle-62 · 用户确认）：**专题/模考/整卷一律用答题卡位置号**
             * （`current + 1`），不依赖题目自带 `no`/`seq`。
             * 理由：专题刷题队列是按卷抽出的题组，题面自带的 seq 可能为 0（naoku 等源
             * 无卷内序号）→ 显示 `?` 与答题卡格里显示的序号**自相矛盾**。
             * 答题卡（QwExamNavigator）本来就是「第 i+1 题」，两处口径必须同源。
             */
            q={{
              no: current + 1, score: q.score, type: q.type, groupMaterialNo: q.groupMaterialNo || 0,
              exam: isExam || isPractice ? (paperMeta && paperMeta.subject) || q.exam : q.exam,
              year: isExam || isPractice ? (paperMeta && paperMeta.year) || q.year : q.year,
              module: q.module,
              source: q.source, region: q.region, paperFile: q.paperFile,
              stem: q.stem, options: q.options,
              // 标记旗与答题卡同键（位置号）——原实现用 q.no，专题下 seq=0 会全部撞键
              flagged: flags && flags.has ? flags.has(current + 1) : false,
              requirement: q.requirement, reference: q.reference,
              // 答案双写法透传（cycle-62：原实现只传 answer，池出站是 correctAnswer
              // → 专题/模考路径的「✅ 答案」整行永远不渲染）
              answer: q.answer, correctAnswer: q.correctAnswer,
              analysis: q.analysis,
              dims: q.dims,
              // 材料：整卷路径的材料在「区 1 材料区」渲染，题目卡不再重复（避免双事实源）；
              // 但 materialRef 仍传，供卡片头部的材料副标题显示（若有）
              materialRef: q.materialRef,
            } as any}
            // exam 态：answers[位置号]（与答题卡同键）；practice 态：宿主 selected/right/revealed 三态
            // cycle-30：browse 态自答对照——selected/revealed/onSelect 与 practice 同构转发
            // （interactive=true 使选项可点；揭示只在宿主主动对照后发生，不自动判分）
            selected={isExam ? (answers && answers[current + 1]) : selected}
            right={right}
            revealed={isExam ? false : revealed}
            disabled={isPractice ? disabled : undefined}
            onSelect={isExam || isPractice || isBrowse ? onSelect : undefined}
            onToggleFlag={onToggleFlag ? () => onToggleFlag(current + 1) : undefined}
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
