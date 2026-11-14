/**
 * papers-view.ts — 真题卷族视图（cycle-13 T-025 从 client.ts 拆出）
 * 模考 / 真题卷库 / 专题 / 申论评改。
 */

import { h, React, entries, Stat, Bar, Card, RichText, KV_TAG, KV_BTN } from '../ui-kit.js'
// cycle-13 专题枢纽：行测刷题 / 图形推理 / 深度题库 三个既有视图嵌入本页分区（R9：h() 挂载）
import { NativePracticeView, NativeTuxingView, NativeDeepBankView } from './study-view.js'
// cycle-18：专题枢纽「📖 方法论」分区直接挂花生十三体系（语料由「📦 题库管理」安装到数据根）。
// 依赖方向 papers-view → huasheng13-view 是单向的；bundler 会按拓扑序排布（不会成环）。
import { NativeHuasheng13View } from './huasheng13-view.js'
// cycle-25：题目渲染接入统一组件域（QwQuestionCard 七段卡 / QwExamNavigator 答题卡 / QwZoomHost 图片放大宿主）
import { QwQuestionCard, QwExamNavigator, QwZoomHost } from '../question/question-kit.js'

    /* ══ v1.6 新增：真题卷 / 专题 / 申论评改（全部宿主原生渲染，组件自管数据）══ */

    /** T-016 整卷模考：计时作答 → 交卷 → 模块得分分布 */
    interface NativeExamViewProps { api: any }
    export function NativeExamView({ api }: NativeExamViewProps) {
      const [papers, setPapers] = React.useState(null)
      const [exam, setExam] = React.useState(null)
      const [answers, setAnswers] = React.useState({})
      const [idx, setIdx] = React.useState(0)
      const [left, setLeft] = React.useState(0)
      const [report, setReport] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      // cycle-25：答题卡标记旗 Set<no>——七段卡旗标与答题卡黄点共享（state 全部在组件顶部声明，不受 R9 跨渲染约束）
      const [flags, setFlags] = React.useState(() => new Set())

      React.useEffect(() => {
        api('/papers?subject=行测').then(d => setPapers(d)).catch(() => setPapers({ papers: [] }))
      }, [api])

      // 倒计时（仅考试中且未交卷）
      React.useEffect(() => {
        if (!exam || report) return
        const t = setInterval(() => setLeft(v => (v <= 1 ? 0 : v - 1)), 1000)
        return () => clearInterval(t)
      }, [exam, report])

      const fmt = (sec) => {
        const hh = Math.floor(sec / 3600)
        const mm = Math.floor((sec % 3600) / 60)
        const ss = sec % 60
        return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
      }

      const start = async (id) => {
        setBusy(true)
        try {
          const d = await api('/paper/exam/start?id=' + encodeURIComponent(id))
          if (d.error) return
          setExam(d)
          setAnswers({})
          setFlags(new Set())   // cycle-25：开新卷清空标记旗（flags 随卷走）
          setIdx(0)
          setLeft(d.durationSec || 7200)
          setReport(null)
        } finally { setBusy(false) }
      }

      const doSubmit = async () => {
        if (!exam || busy) return
        setBusy(true)
        try {
          const r = await api('/paper/exam/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: exam.id, answers, elapsedSec: (exam.durationSec || 0) - left }),
          })
          setReport(r)
        } finally { setBusy(false) }
      }

      // ── 分支 1：交卷报告 ──
      if (report) {
        const pct = report.totalScore ? Math.round(report.scored / report.totalScore * 100) : report.rate
        const color = pct >= 75 ? '#10b981' : pct >= 50 ? '#6366f1' : '#f59e0b'
        const wrongList = (report.detail || []).filter(d => !d.isCorrect)
        const wrongRows = wrongList.slice(0, 30).map(d =>
          <div
            key={d.no}
            style={{ display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(148,163,184,.12)' }}
          >
            <span style={{ ...KV_TAG, minWidth: 52 }}>{'第' + d.no + '题'}</span>
            <span style={{ flex: 1, color: '#64748b' }}>{d.type || ''}</span>
            <span style={{ color: '#ef4444' }}>{'你 ' + (d.mine || '—')}</span>
            <span style={{ color: '#10b981' }}>{'对 ' + (d.right || '?')}</span>
          </div>)
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button style={KV_BTN} onClick={() => { setExam(null); setReport(null) }}>{'← 换一套卷'}</button>
            </div>
            <Card title={'📊 模考报告 · ' + report.subject + ' ' + report.year}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 38, fontWeight: 800, color }}>{pct + '%'}</span>
                <span style={{ fontSize: 14, color: '#64748b' }}>{'答 ' + report.answered + ' 题 · 对 ' + report.correct + ' 题 · 正确率 ' + report.rate + '%'}</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{'用时 ' + fmt(report.elapsedSec || 0)}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>{'🎯 模块得分分布（弱→强）'}</div>
              {(report.modules || []).map(m =>
                <div key={m.type} style={{ marginBottom: 9 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span>{m.type + (m.total ? '（' + m.total + ' 题）' : '')}</span>
                    <span style={{ color: '#64748b' }}>{m.correct + '/' + m.answered + ' · ' + m.rate + '%'}</span>
                  </div>
                  <Bar pct={m.rate} color={m.rate >= 75 ? 'linear-gradient(135deg,#10b981,#34d399)' : m.rate >= 50 ? undefined : 'linear-gradient(135deg,#f59e0b,#fbbf24)'} />
                </div>)}
            </Card>
            <Card title={'❌ 错题清单（' + wrongList.length + ' 题）'}>
              {wrongRows}
              {wrongList.length === 0 ? <div style={{ fontSize: 12, color: '#10b981' }}>{'🎉 全对！'}</div> : null}
            </Card>
          </div>
        )
      }

      // ── 分支 2：考试中 ──
      if (exam) {
        const q = exam.questions[idx]
        if (!q) return <div className="kg-load">{'题目加载异常'}</div>
        {/* cycle-25：QwZoomHost 整卡图片可放大。本仓 JSX 工厂（classic/preact 签名）不把 JSX children 折叠进
            attrs 类型校验（ui-kit Card 能用是因其 children? 可选），QwZoomHostProps.children 必填 → 显式传参 */}
        return (
          <QwZoomHost children={
            <div>
              {/* 顶部状态条：倒计时/卷源/交卷保留（「已答 x/y」由答题卡头部统计承担，避免双事实源） */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: left < 300 ? '#ef4444' : 'var(--text-primary,#0f172a)' }}>{'⏱ ' + fmt(left)}</span>
                <span style={KV_TAG}>{exam.subject + ' ' + exam.year}</span>
                <button
                  style={{ ...KV_BTN, marginLeft: 'auto', background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', border: 0, padding: '6px 16px' }}
                  disabled={busy} onClick={doSubmit}
                >{busy ? '交卷中…' : '交卷'}</button>
              </div>
              {/* 答题卡跳转：网格四态（未答灰/已答蓝/标记黄/当前描边）+ 进度统计；flags 由宿主 useState 持有 */}
              <QwExamNavigator questions={exam.questions} answers={answers} flags={flags} current={idx} onJump={(i) => setIdx(i)} />
              {/* 统一七段卡（exam 做题态）：选项三态交互 + 标记旗（旗逻辑在 question-kit 内部） */}
              <QwQuestionCard
                mode="exam"
                q={{ no: q.no, type: q.type, exam: exam.subject, year: exam.year, stem: q.stem, options: q.options, flagged: flags.has(q.no) }}
                interactive
                selected={answers[q.no]}
                onSelect={(L) => setAnswers(a => ({ ...a, [q.no]: L }))}
                onToggleFlag={() => setFlags(f => { const n = new Set(f); n.has(q.no) ? n.delete(q.no) : n.add(q.no); return n })}
              />
              {/* 上下题按钮行保留（render.test 按钮文本锚点） */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                <button style={KV_BTN} disabled={idx === 0} onClick={() => setIdx(i => Math.max(0, i - 1))}>{'← 上一题'}</button>
                <button style={KV_BTN} disabled={idx >= exam.questions.length - 1} onClick={() => setIdx(i => Math.min(exam.questions.length - 1, i + 1))}>{'下一题 →'}</button>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#64748b' }}>{(idx + 1) + ' / ' + exam.questions.length}</span>
              </div>
            </div>
            } />
        )
      }

      // ── 分支 3：选题 ──
      const listRows = papers
        ? papers.papers.slice(0, 60).map(pp =>
            <div
              key={pp.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, marginBottom: 4, background: 'rgba(148,163,184,.06)', fontSize: 12.5 }}
            >
              <span style={{ width: 46, fontWeight: 700, color: '#6366f1' }}>{pp.year}</span>
              <span style={{ flex: 1 }}>{pp.exam + ' · ' + pp.paperType}</span>
              <span style={{ color: '#64748b', fontSize: 11.5, marginRight: 8 }}>{pp.questionCount + ' 题'}</span>
              <button style={{ ...KV_BTN, padding: '3px 12px' }} disabled={busy} onClick={() => start(pp.id)}>{'开始模考'}</button>
            </div>)
        : null

      return (
        <div>
          <Card title="⏱ 行测整卷模考（真实考场计时）">
            <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>{'选一套卷 → 限时作答（行测 120 分钟）→ 交卷得模块得分分布与错题清单'}</div>
            {!papers ? <div style={{ fontSize: 12, color: '#64748b' }}>{'加载卷库…'}</div> : null}
            {listRows ? <div style={{ maxHeight: '56vh', overflowY: 'auto' }}>{listRows}</div> : null}
          </Card>
        </div>
      )
    }

    /** 真题卷库 */
    interface NativePapersViewProps { api: any; initialSubject?: any }
    export function NativePapersView({ api, initialSubject = '' }: NativePapersViewProps) {
      // cycle-13 省份维度：filters 新增 province（与 subject/year 并列，URL 构建自动透传 ?province=）
      const [filters, setFilters] = React.useState({ subject: initialSubject || '', year: '', province: '' })
      // T-019：按考点看卷
      const [mode, setMode] = React.useState('year')
      const [cats, setCats] = React.useState([])
      const [cat, setCat] = React.useState('')
      const [catPapers, setCatPapers] = React.useState(null)

      React.useEffect(() => {
        if (mode !== 'topic' || cats.length) return
        api('/naoku/categories?limit=30').then((d: any) => setCats(d.list || [])).catch(() => {})
      }, [mode, cats.length, api])

      React.useEffect(() => {
        if (!cat) { setCatPapers(null); return }
        api('/naoku/papers?category=' + encodeURIComponent(cat))
          .then((d: any) => setCatPapers(d.papers || []))
          .catch(() => setCatPapers([]))
      }, [cat, api])
      const [list, setList] = React.useState(null)
      const [openId, setOpenId] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      // cycle-14：材料逐份折叠（用户诉求：给定材料除全局折叠外，支持材料 1/2/3/4 单独折叠展开）。
      // 键=材料段号，值=true 表示该份折叠；换卷时重置为全展开。
      const [collapsedMats, setCollapsedMats] = React.useState({})
      const toggleMat = (no) => setCollapsedMats(m => ({ ...m, [no]: !m[no] }))
      const mats = (detail && detail.materials) || []
      const allCollapsed = mats.length > 0 && mats.every(m => collapsedMats[m.no])

      React.useEffect(() => {
        let cancelled = false
        const qs = entries(filters).filter(([, v]) => v).map(([k, v]) => '&' + k + '=' + encodeURIComponent(v)).join('')
        api('/papers?_=1' + qs).then(d => { if (!cancelled) setList(d) }).catch(() => { if (!cancelled) setList({ papers: [], total: 0 }) })
        return () => { cancelled = true }
      }, [filters, api])

      React.useEffect(() => {
        if (!openId) return
        let cancelled = false
        setCollapsedMats({})   // cycle-14：换卷重置材料折叠态（新卷默认全展开）
        setDetail(null)
        api('/paper?id=' + encodeURIComponent(openId)).then(d => { if (!cancelled) setDetail(d) }).catch(() => { if (!cancelled) setDetail({ error: '加载失败' }) })
        return () => { cancelled = true }
      }, [openId, detail, api])

      if (openId) {
        if (!detail) return <div className="kg-load"><div className="kg-spin" />{'加载试卷…'}</div>
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <button style={KV_BTN} onClick={() => { setOpenId(null); setDetail(null) }}>{'← 返回列表'}</button>
              {detail.exam ? <span style={KV_TAG}>{detail.exam + ' ' + detail.year}</span> : null}
              {detail.subject ? <span style={KV_TAG}>{detail.subject}</span> : null}
              {detail.paperType ? <span style={KV_TAG}>{detail.paperType}</span> : null}
              <span style={{ fontSize: 11.5, color: '#64748b' }}>{((detail.materials || []).length) + ' 材料 · ' + ((detail.questions || []).length) + ' 题'}</span>
            </div>
            {detail.error ? <div style={{ color: '#ef4444' }}>{detail.error}</div> : null}
            {/* cycle-14：给定材料逐份折叠——每份材料头部可点击折叠/展开（含字数提示），另有「全部展开/收起」总开关 */}
            {(detail.materials || []).length > 0 ? <Card title="📄 给定材料">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <button
                  style={KV_BTN}
                  onClick={() => setCollapsedMats(() => {
                    const next = {}
                    for (const m of mats) next[m.no] = !allCollapsed
                    return next
                  })}
                >{allCollapsed ? '▼ 展开全部材料（' + mats.length + ' 份）' : '▲ 收起全部材料'}</button>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{'点击「材料 N」标题可单独折叠/展开该份材料'}</span>
              </div>
              {detail.materials.map(m => {
                const wordCount = String(m.text || '').replace(/\s/g, '').length
                const isCollapsed = !!collapsedMats[m.no]
                return (
                  <div key={m.no} style={{ marginBottom: 14, paddingBottom: isCollapsed ? 0 : 10, borderBottom: '1px dashed rgba(148,163,184,.18)' }}>
                    <div
                      style={{ fontWeight: 700, fontSize: 12, color: '#6366f1', marginBottom: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
                      onClick={() => toggleMat(m.no)}
                      title={isCollapsed ? '展开材料 ' + m.no : '折叠材料 ' + m.no}
                    >
                      <span style={{ display: 'inline-block', transition: 'transform .2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>{'▸'}</span>
                      <span>{'材料 ' + m.no}</span>
                      <span style={{ fontWeight: 400, fontSize: 10.5, color: '#94a3b8' }}>{'约 ' + wordCount + ' 字' + (isCollapsed ? ' · 已折叠' : '')}</span>
                    </div>
                    {!isCollapsed ? <RichText text={m.text} maxHeight={240} /> : null}
                  </div>
                )
              })}
            </Card> : null}
            <Card title="📝 题目与参考答案">
              {/* cycle-25：题目列表接入统一组件域（QwQuestionCard browse 只读，不传 interactive）；QwZoomHost 整卡图片可放大。
                  本仓无 @types/react（classic JSX 仅按 props 接口校验 attrs，不折叠 children/key）→ children 显式传参、key 走 kit 内 as any 展开惯例 */}
              <QwZoomHost children={(detail.questions || []).map(q =>
                <QwQuestionCard
                  {...({ key: q.no } as any)}
                  mode="browse"
                  q={{ no: q.no, score: q.score, stem: q.stem, requirement: q.requirement, reference: q.reference }}
                />)}
              />
            </Card>
          </div>
        )
      }

      return (
        <div>
          <Card title={'📚 真题卷库' + (list ? '（' + list.total + ' 套）' : '')}>
            {/* T-019 浏览模式：按科目/年份 或 按考点反查 */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{'浏览'}</span>
              <button style={{ ...KV_BTN, ...(mode === 'year' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }} onClick={() => setMode('year')}>{'按科目/年份'}</button>
              <button style={{ ...KV_BTN, ...(mode === 'topic' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }} onClick={() => setMode('topic')}>{'按考点'}</button>
              {cat ? <span style={{ ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{'考点：' + cat}</span> : null}
            </div>
            {mode === 'topic' ? <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                {cats.slice(0, 18).map((c: any) =>
                  <button
                    key={c.k}
                    style={{ ...KV_BTN, fontSize: 11, ...(cat === c.k ? { background: 'rgba(99,102,241,.15)', color: '#6366f1', borderColor: '#6366f1' } : {}) }}
                    onClick={() => setCat(cat === c.k ? '' : c.k)}
                  >{c.k + ' ' + c.c}</button>)}
              </div>
              {!cats.length ? <div style={{ fontSize: 12, color: '#64748b' }}>{'加载考点…'}</div> : null}
              {cat && catPapers === null ? <div style={{ fontSize: 12, color: '#64748b' }}>{'查询含「' + cat + '」的卷…'}</div> : null}
              {cat && catPapers ? <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{'共 ' + catPapers.length + ' 套卷含该考点（按题量排序）'}</div>
                {catPapers.map((cp: any, i: number) =>
                  <div
                    key={i}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, marginBottom: 4, background: 'rgba(148,163,184,.06)', fontSize: 12 }}
                  >
                    <span style={{ width: 44, fontWeight: 700, color: '#6366f1' }}>{String(cp.year || '—')}</span>
                    <span style={{ width: 50, color: '#64748b' }}>{cp.region || ''}</span>
                    <span style={{ flex: 1 }}>{String(cp.paper || '').replace(/（网友回忆版）|《行测》题|《申论》题/g, '')}</span>
                    <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{cp.count + ' 题'}</span>
                  </div>)}
              </div> : null}
            </div> : null}
            {list && list.subjects ? <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <button style={{ ...KV_BTN, ...(filters.subject === '' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }} onClick={() => setFilters({ subject: '', year: '', province: '' })}>{'全部'}</button>
              {list.subjects.map(sc =>
                <button
                  key={sc.subject}
                  style={{ ...KV_BTN, ...(filters.subject === sc.subject ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }}
                  onClick={() => setFilters({ subject: sc.subject, year: '', province: '' })}
                >{sc.subject + ' ' + sc.count}</button>)}
            </div> : null}
            {/* cycle-13 省份维度 chips：provinces facet 驱动（索引 v2 起可用；旧数据无 facet 时整行隐藏） */}
            {list && Array.isArray(list.provinces) && list.provinces.length ? <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{'省份'}</span>
              <button
                style={{ ...KV_BTN, ...(filters.province === '' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }}
                onClick={() => setFilters({ ...filters, province: '' })}
              >{'全部'}</button>
              {list.provinces.map((p: any) =>
                <button
                  key={p.name}
                  title={p.subjects ? entries(p.subjects).map(([s, n]) => s + ' ' + n).join(' · ') + `（${p.minYear || '?'}-${p.maxYear || '?'}）` : p.name}
                  style={{ ...KV_BTN, ...(filters.province === p.name ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }}
                  onClick={() => setFilters({ ...filters, province: filters.province === p.name ? '' : p.name })}
                >{p.name + ' ' + p.total}</button>)}
            </div> : null}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {['2026', '2025', '2024', '2023', '2022', '2021', '2020'].map(y =>
                <button
                  key={y}
                  style={{ ...KV_BTN, ...(filters.year === y ? { background: 'rgba(99,102,241,.15)', color: '#6366f1', borderColor: '#6366f1' } : {}) }}
                  onClick={() => setFilters({ ...filters, year: filters.year === y ? '' : y })}
                >{y}</button>)}
            </div>
            {!list ? <div style={{ fontSize: 12, color: '#64748b' }}>{'加载中…'}</div> : null}
            {list ? <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              {list.papers.map(p =>
                <div
                  key={p.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, marginBottom: 4, cursor: 'pointer', background: 'rgba(148,163,184,.06)', fontSize: 12.5 }}
                  onClick={() => { setOpenId(p.id); setDetail(null) }}
                >
                  <span style={{ width: 46, fontWeight: 700, color: '#6366f1' }}>{p.year || '—'}</span>
                  <span style={{ width: 58, color: '#64748b' }}>{p.province || p.exam}</span>
                  <span style={{ flex: 1 }}>{p.subject + ' · ' + p.paperType}</span>
                  <span style={{ color: '#64748b', fontSize: 11.5 }}>{p.questionCount + ' 题'}</span>
                  {p.verified ? <span style={{ ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{'已核验'}</span> : null}
                </div>)}
            </div> : null}
          </Card>
        </div>
      )
    }


    /** 专题 → 练习枢纽 */
    /**
     * 专题练习枢纽（cycle-13 升级，组件名与 props 契约不变）：
     * 导航精简后「刷题 / 图形推理 / 深度题库 / 申论」四个一级入口全部收敛到本页分区 tab。
     * 分区结构：🧭 总览（v1.7.1 既有专题树，行为零变化）｜✏️ 行测刷题｜🔷 图形推理｜🧠 深度题库｜✍️ 申论｜📖 方法论。
     * 子视图懒挂载（visited 标记，首次进入才挂载）+ 常驻（display:none 隐藏）+ 固定 key：
     * 切换分区不重挂载、不丢状态、不重复请求（R9：子视图一律 h() 挂载，父 hook 数恒定）。
     */
    const TOPIC_HUB_TABS = [
      { id: 'overview', label: '🧭 总览' },
      { id: 'practice', label: '✏️ 行测刷题' },
      { id: 'tuxing', label: '🔷 图形推理' },
      { id: 'deepbank', label: '🧠 深度题库' },
      { id: 'essay', label: '✍️ 申论' },
      { id: 'method', label: '📖 方法论' },
    ]

    interface NativeTopicsViewProps { api: any; onGo: any; initialModule?: any }
    export function NativeTopicsView({ api, onGo, initialModule = '' }: NativeTopicsViewProps) {
      const [tree, setTree] = React.useState(null)
      const [channel, setChannel] = React.useState('xingce')
      // 深链（setView('topics', { module })）直达刷题分区并预选模块；常规进入默认总览
      const [sec, setSec] = React.useState(initialModule ? 'practice' : 'overview')
      const [visited, setVisited] = React.useState(() => (initialModule ? { overview: true, practice: true } : { overview: true }))

      React.useEffect(() => { api('/topics').then(setTree).catch(() => setTree(null)) }, [api])

      const visit = (id: string) => {
        setSec(id)
        setVisited(v => (v[id] ? v : { ...v, [id]: true }))
      }

      // 胶囊分区 tab 条（选中渐变；data-kg-hub-tab 供测试/脚本锚定）
      const tabRow = (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14, padding: 4, background: 'rgba(148,163,184,.09)', borderRadius: 12 }}>
          {TOPIC_HUB_TABS.map(tb =>
            <button
              key={tb.id}
              data-kg-hub-tab={tb.id}
              style={{ ...KV_BTN, border: 0, padding: '7px 15px', fontSize: 12.5, fontWeight: 700, borderRadius: 9, ...(sec === tb.id ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' } : {}) }}
              onClick={() => visit(tb.id)}
            >{tb.label}</button>)}
        </div>
      )

      // ── 总览分区：既有专题树（行测/申论频道 + 练习入口），内部行为零变化 ──
      const chs = tree ? (tree.channels || []) : []
      const cur = chs.find(c => c.id === channel) || chs[0]
      const go = (entry) => { if (entry && onGo) onGo(entry.view, entry.params || {}) }
      const st = tree ? (tree.stats || {}) : {}

      // 频道切换 + 统计
      const head = (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {chs.map(c =>
              <button
                key={c.id}
                data-kg-channel={c.id}
                style={{ ...KV_BTN, padding: '8px 18px', fontSize: 13, ...(c.id === channel ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }}
                onClick={() => setChannel(c.id)}
              >{c.icon + ' ' + c.name + '频道'}</button>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 }}>
            <Stat v={st.paperTotal} l="真题卷总数" color="#6366f1" />
            <Stat v={st.xingcePapers} l="行测套卷" color="#0ea5e9" />
            <Stat v={st.essayPapers} l="申论套卷" color="#8b5cf6" />
            <Stat v={st.naokuTotal} l="深度标注题" color="#10b981" />
          </div>
        </div>
      )

      // 频道内的练习入口（cur 缺席时降级为提示，绝不抛错）
      const entriesCard = cur ? <Card title={'🚀 ' + cur.name + '练习入口'}>
        <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>{cur.desc}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
          {(cur.entries || []).map((e, i) =>
            <div
              key={i}
              style={{ border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 14, cursor: 'pointer', textAlign: 'center', background: 'rgba(148,163,184,.04)' }}
              onClick={() => go({ view: e.view, params: e.params })}
            >
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>{e.label}</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>{'点击进入'}</div>
            </div>)}
        </div>
      </Card>
        : <Card title="🚀 练习入口"><div style={{ fontSize: 12, color: '#64748b' }}>{'专题数据暂不可用 — 可直接使用上方分区练习'}</div></Card>

      // 专题列表（按 kind 分组）
      const topics = cur ? (cur.topics || []) : []
      const groups: any = {}
      for (const t2 of topics) (groups[t2.kind] = groups[t2.kind] || []).push(t2)
      const KIND_LABEL = { module: '六大模块', category: '细分题型', 'essay-type': '申论题型' }

      const topicCards = entries(groups).map(([kind, list]) =>
        <Card {...{ key: kind }} title={(KIND_LABEL[kind] || kind) + '（' + list.length + '）'}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            {list.map(t2 =>
              <div
                key={t2.id}
                style={{ border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 13, cursor: 'pointer' }}
                onClick={() => go(t2.entry)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontWeight: 800, fontSize: 13.5 }}>{t2.title}</span>
                  {t2.questionCount ? <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{t2.questionCount + ' 题'}</span> : null}
                  {t2.papers ? <span style={{ ...KV_TAG, fontSize: 10 }}>{t2.papers + ' 套'}</span> : null}
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.6 }}>{t2.desc || ''}</div>
                <div style={{ fontSize: 10.5, color: '#6366f1', marginTop: 6, fontWeight: 600 }}>{'开始练习 →'}</div>
              </div>)}
          </div>
        </Card>)

      const overview = !tree
        ? <div className="kg-load"><div className="kg-spin" />{'加载专题…'}</div>
        : <div>{head}{entriesCard}{...topicCards}</div>

      // 分区包裹：非当前分区 display:none 隐藏（保持挂载 → 状态不丢）
      const wrap = (id: string, node) => <div key={id} style={sec === id ? undefined : { display: 'none' }}>{node}</div>

      return (
        <div>
          {tabRow}
          {visited.overview ? wrap('overview', overview) : null}
          {visited.practice ? wrap('practice', <NativePracticeView {...{ key: 'topic-practice' }} api={api} initialModule={initialModule || ''} onGoWrongbook={onGo ? () => onGo('wrongbook', {}) : undefined} />) : null}
          {visited.tuxing ? wrap('tuxing', <NativeTuxingView {...{ key: 'topic-tuxing' }} api={api} />) : null}
          {visited.deepbank ? wrap('deepbank', <NativeDeepBankView {...{ key: 'topic-deepbank' }} api={api} initialModule="" initialCategory="" />) : null}
          {visited.essay ? wrap('essay', <NativeEssayView {...{ key: 'topic-essay' }} api={api} initialType="" />) : null}
          {visited.method ? wrap('method', <TopicMethodHub {...{ key: 'topic-method-hub' }} api={api} />) : null}
        </div>
      )
    }

    /**
     * 方法论技巧分区（cycle-13 新增，用户点名缺失）：两部分数据全部来自既有端点（只消费不新增）——
     * ① kaogong-skill 十主题方法论：/api/methods（目录）+ /api/method?topic=（markdown 正文）；
     * ② naoku 母题思维 / 易错点精选：/api/naoku/questions?count=20&random=0（ORDER BY id，确定性）
     *    过滤出带 mother/pitfalls 标注的题，取前 6 条做卡片。
     * 字段全部可选降级：目录缺失 / 题库未就绪 → 友好空态 + 静态引导卡，绝不抛错、绝不臆造字段。
     * R9：真组件（useState×6 + useEffect×2，hook 数恒定），由 NativeTopicsView 经 h() 挂载。
     */
    interface TopicMethodViewProps { api: any }
    export function TopicMethodView({ api }: TopicMethodViewProps) {
      const [topics, setTopics] = React.useState(null)          // 方法论目录（10 主题）
      const [open, setOpen] = React.useState('')                // 当前展开的方法论主题
      const [contents, setContents] = React.useState({})        // 主题正文缓存 { [topic]: content }
      const [busy, setBusy] = React.useState(false)
      const [picks, setPicks] = React.useState(null)            // 母题/易错点精选
      const [pickOpen, setPickOpen] = React.useState(-1)

      React.useEffect(() => {
        let cancelled = false
        api('/methods').then((d: any) => { if (!cancelled) setTopics(d && Array.isArray(d.topics) ? d.topics : []) }).catch(() => { if (!cancelled) setTopics([]) })
        return () => { cancelled = true }
      }, [api])

      React.useEffect(() => {
        let cancelled = false
        api('/naoku/questions?count=20&random=0')
          .then((d: any) => {
            if (cancelled) return
            const qs = (d && d.questions) || []
            setPicks(qs.filter((x: any) => x && (x.mother || x.pitfalls)).slice(0, 6))
          })
          .catch(() => { if (!cancelled) setPicks([]) })
        return () => { cancelled = true }
      }, [api])

      const openTopic = async (label: string) => {
        if (open === label) { setOpen(''); return }
        setOpen(label)
        if (contents[label]) return
        setBusy(true)
        try {
          const d = await api('/method?topic=' + encodeURIComponent(label))
          setContents(c => ({ ...c, [label]: (d && d.content) || '内容暂缺' }))
        } catch {
          setContents(c => ({ ...c, [label]: '内容加载失败，请稍后重试' }))
        } finally { setBusy(false) }
      }

      // ① 方法论目录卡（网格）
      const methodGrid = topics === null
        ? <div style={{ fontSize: 12, color: '#64748b' }}>{'加载方法论目录…'}</div>
        : topics.length === 0
          ? <div style={{ fontSize: 12, color: '#f59e0b' }}>{'⚠️ 方法论目录暂不可用（kaogong-skill 参考文件缺失）'}</div>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
              {topics.map((tp: any) =>
                <div
                  key={tp.id || tp.label}
                  style={{ border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 13, cursor: 'pointer', textAlign: 'center', background: open === tp.label ? 'rgba(99,102,241,.07)' : 'rgba(148,163,184,.04)' }}
                  onClick={() => openTopic(String(tp.label))}
                >
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{'📖 ' + tp.label}</div>
                  <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>{open === tp.label ? '点击收起' : '点击展开全文'}</div>
                </div>)}
            </div>

      // 展开的方法论正文（RichText 渲染 markdown）
      const methodDetail = open && contents[open]
        ? <Card title={'📖 ' + open + ' · 方法论全文'}>
            <RichText text={String(contents[open])} fontSize={12.5} maxHeight={'48vh' as any} />
          </Card>
        : open ? <Card title={'📖 ' + open}><div style={{ fontSize: 12, color: '#64748b' }}>{busy ? '加载正文…' : '正文暂缺'}</div></Card> : null

      // ② 母题思维 / 易错点精选卡
      const pickCards = picks === null
        ? <div style={{ fontSize: 12, color: '#64748b' }}>{'加载母题精选…'}</div>
        : picks.length === 0
          ? <Card title="🧩 母题思维 / 易错点精选">
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.8 }}>
                {'深度题库未就绪（需 Node ≥ 22.19 内置 node:sqlite 且 GongkaoNaoku 分片存在），母题精选暂缺。'}
                <div style={{ marginTop: 6, color: '#4f46e5' }}>{'可先阅读上方方法论；或在左栏面板「深度题库」分区练习（那里有未掌握时的回落方案）。'}</div>
              </div>
            </Card>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
              {picks.map((q: any, i: number) =>
                <div key={q.id || i}>
                  <div
                    style={{ border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 13, cursor: 'pointer', background: pickOpen === i ? 'rgba(139,92,246,.06)' : 'rgba(148,163,184,.04)' }}
                    onClick={() => setPickOpen(pickOpen === i ? -1 : i)}
                  >
                    <div style={{ display: 'flex', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={KV_TAG}>{q.module || '深度标注'}</span>
                      {q.type ? <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}>{q.type}</span> : null}
                      {q.mother ? <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}>{'🧩 母题'}</span> : null}
                      {q.pitfalls ? <span style={{ ...KV_TAG, fontSize: 10, background: 'rgba(239,68,68,.12)', color: '#ef4444' }}>{'⚠️ 易错'}</span> : null}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.6 }}>{String(q.kadian || q.stem || '').slice(0, 56) + (String(q.kadian || q.stem || '').length > 56 ? '…' : '')}</div>
                    <div style={{ fontSize: 10.5, color: '#6366f1', marginTop: 6, fontWeight: 600 }}>{pickOpen === i ? '收起 ▲' : '展开详情 ▼'}</div>
                  </div>
                  {pickOpen === i ? <div style={{ border: '1.5px solid rgba(139,92,246,.35)', borderTop: 0, borderRadius: '0 0 12px 12px', padding: 12, background: 'rgba(139,92,246,.04)' }}>
                    {q.stem ? <div style={{ marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 11.5, color: '#64748b', marginBottom: 3 }}>{'题干'}</div><RichText text={String(q.stem).slice(0, 400)} fontSize={11.5} maxHeight={160} /></div> : null}
                    {q.mother ? <div style={{ marginBottom: 8 }}><div style={{ fontWeight: 700, fontSize: 11.5, color: '#8b5cf6', marginBottom: 3 }}>{'🧩 母题思维'}</div><RichText text={q.mother} fontSize={11.5} maxHeight={200} /></div> : null}
                    {q.pitfalls ? <div><div style={{ fontWeight: 700, fontSize: 11.5, color: '#ef4444', marginBottom: 3 }}>{'⚠️ 易错点'}</div><RichText text={q.pitfalls} fontSize={11.5} maxHeight={200} /></div> : null}
                  </div> : null}
                </div>)}
            </div>

      return (
        <div>
          <Card title="📖 方法论技巧（kaogong-skill 十主题）">
            <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>
              {'行测 / 申论 / 职测 / 综应 / 公基 / 公文 / 面试 / 时政 / 报考 / 复盘 十大主题备考方法论，点击主题展开全文。'}
            </div>
            {methodGrid}
          </Card>
          {methodDetail}
          <Card title="🧩 母题思维 / 易错点精选（深度题库标注）">
            <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>
              {'从 GongkaoNaoku 27506 题的五维标注中精选带「母题思维 / 易错点」的真题，点击卡片展开题干与标注全文。'}
            </div>
            {pickCards}
          </Card>
        </div>
      )
    }

    /**
     * 专题枢纽「📖 方法论」分区容器（cycle-18，用户明确要求）：
     * 「不要单独弄一个导航入口，放在专题下的方法论下即可」。
     *
     * 结构 = 主区 + 折叠附区：
     *  - 主区 = NativeHuasheng13View（花生十三体系，内置 25 篇语料，**零题库数据亦可用的底座**）
     *  - 附区 = TopicMethodView（kaogong-skill 十主题 + 深度题库母题精选，**依赖外部仓库安装**）
     *
     * 为什么保留附区而不直接删：后者是既有已交付能力，删掉等于悄悄移除功能；
     * 但两者数据域不同（huasheng13 六模块体系 vs 外部十主题仓库），混排会让读者以为是一套东西，
     * 因此用默认折叠的「另见」区隔开，并标明各自的数据依赖。
     *
     * R9：真组件，hook 数恒定（1 个 useState 管折叠态），子视图经 h() 挂载。
     */
    interface TopicMethodHubProps { api: any }
    export function TopicMethodHub({ api }: TopicMethodHubProps) {
      const [showLegacy, setShowLegacy] = React.useState(false)
      return (
        <div>
          <NativeHuasheng13View key="hs13-in-hub" api={api} initialSection="overview" />
          <div style={{ marginTop: 14, borderTop: '1px dashed rgba(148,163,184,.35)', paddingTop: 12 }}>
            <button
              key="legacy-toggle"
              className="kg-navbtn"
              data-kg-hub-legacy="1"
              onClick={() => setShowLegacy(v => !v)}
            >{(showLegacy ? '▾ ' : '▸ ') + '另见：kaogong-skill 十主题方法论 + 深度题库母题精选'}</button>
            <div style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
              {'（这一部分是外部仓库内容：kaogong-skill 十主题 + GongkaoNaoku 母题精选；'}
              {'上方花生十三体系同样需要先在「📦 题库管理」安装必选包 huasheng13，未装时上方会显示安装引导）'}
            </div>
            {showLegacy ? <TopicMethodView {...{ key: 'topic-method-legacy' }} api={api} /> : null}
          </div>
        </div>
      )
    }

    /** 申论练习 + 离线评改 */
    interface NativeEssayViewProps { api: any; initialType?: any }
    export function NativeEssayView({ api, initialType = '' }: NativeEssayViewProps) {
      const [type, setType] = React.useState(initialType || '')
      const [list, setList] = React.useState(null)
      const [cur, setCur] = React.useState(null)
      const [answer, setAnswer] = React.useState('')
      const [result, setResult] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [paperDetail, setPaperDetail] = React.useState(null)   // v1.7：材料区
      const [showMaterials, setShowMaterials] = React.useState(true)
      // cycle-14 体验：申论草稿本地暂存（localStorage，按 paperId:no 键）——误关/切题不丢作答
      const essayDraftKey = (q: any) => 'kg-essay-draft:' + (q && (q.id || (q.paperId + ':' + q.no)) || 'unknown')
      const readDraft = (q: any) => { try { return localStorage.getItem(essayDraftKey(q)) || '' } catch { return '' } }
      const writeDraft = (q: any, v: any) => { try { v ? localStorage.setItem(essayDraftKey(q), v) : localStorage.removeItem(essayDraftKey(q)) } catch { /* 隐私模式等场景静默 */ } }
      // cycle-14：材料逐份折叠（用户诉求：全局折叠保留之外，材料 1/2/3/4 可单独折叠展开）
      const [collapsedMats, setCollapsedMats] = React.useState({})
      const toggleMat = (no) => setCollapsedMats(m => ({ ...m, [no]: !m[no] }))
      // T-021：材料-题目联动（点关联段号 → 滚动并高亮；若目标材料处于折叠态先自动展开）
      const [hlNo, setHlNo] = React.useState(0)
      const matRefs = React.useRef({})
      const jumpToMaterial = (no: number) => {
        setShowMaterials(true)
        setCollapsedMats(m => (m[no] ? { ...m, [no]: false } : m))   // 折叠中的关联材料自动展开，否则滚过去看不到正文
        setHlNo(no)
        setTimeout(() => {
          const el = matRefs.current[no]
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 160)
      }
      /** 把「材料 1、材料 3」解析成段号数组 */
      const parseMatNos = (txt: string): number[] => {
        const out: number[] = []
        for (const m of String(txt || '').matchAll(/材料\s*(\d+)/g)) out.push(+m[1])
        return out
      }

      const load = React.useCallback((t) => {
        setType(t); setList(null); setCur(null); setResult(null)
        api('/essay/list?limit=40' + (t ? '&type=' + encodeURIComponent(t) : '')).then(setList).catch(() => setList({ questions: [] }))
      }, [api])
      React.useEffect(() => { load(initialType || '') }, [load])

      const submit = async () => {
        if (!answer.trim() || !cur) return
        setBusy(true)
        try {
          // 大作文（分值≥35 或题干含「文章/议论文/自拟标题」）走结构论证制评分
          const isArticle = (cur.score || 0) >= 35 || /文章|议论文|自拟标题|联系实际/.test(cur.stem || '')
          const r = await api(isArticle ? '/essay/article' : '/essay/grade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paperId: cur.paperId, no: cur.no, answer, requirement: cur.requirement }),
          })
          setResult({ ...r, isArticle })
          // cycle-14：提交评分成功 → 清掉该题草稿（评分结果页已留存内容，重答从零开始）
          if (!r || !r.error) { try { localStorage.removeItem(essayDraftKey(cur)) } catch { /* 隐私模式等场景静默 */ } }
        } finally { setBusy(false) }
      }

      if (result && !result.error) {
        const pct = result.max ? Math.round(result.score / result.max * 100) : 0
        const color = pct >= 75 ? '#10b981' : pct >= 50 ? '#6366f1' : '#f59e0b'
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button style={KV_BTN} onClick={() => { setResult(null); setAnswer(''); if (cur) writeDraft(cur, '') }}>{'← 重新作答'}</button>
              <button style={KV_BTN} onClick={() => { if (cur) writeDraft(cur, ''); setCur(null); setResult(null); setAnswer('') }}>{'换一题'}</button>
            </div>
            <Card title="📊 评分结果">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 40, fontWeight: 800, color }}>{result.score}</span>
                <span style={{ fontSize: 16, color: '#64748b' }}>{'/ ' + result.max}</span>
                <span style={{ fontSize: 13, color: '#64748b' }}>{'(' + pct + '% · ' + result.chars + ' 字' + (result.limit ? ' / 限 ' + result.limit : '') + ')'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 14 }}>
                {[['要点覆盖', result.dims.coverage, '权重50%'], ['结构条理', result.dims.structure, '权重20%'], ['字数合规', result.dims.length, '权重15%'], ['语言规范', result.dims.language, '权重15%']].map(([k, v, w]) =>
                  <div key={k} style={{ background: 'rgba(148,163,184,.08)', borderRadius: 10, padding: 10 }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{k + ' ' + w}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{v}</div>
                    <Bar pct={v} color={v >= 70 ? 'linear-gradient(135deg,#10b981,#34d399)' : v >= 40 ? undefined : 'linear-gradient(135deg,#f59e0b,#fbbf24)'} />
                  </div>)}
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{'💬 批改建议'}</div>
                {(result.feedback || []).map((f, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.7 }}>{'• ' + f}</div>)}
              </div>
              {(result.hitTerms || []).length > 0 ? <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5 }}>{'✅ 已覆盖采分点'}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{result.hitTerms.map((t, i) => <span key={i} style={{ ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{t}</span>)}</div>
              </div> : null}
              {(result.missingTerms || []).length > 0 ? <div>
                <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5 }}>{'⚠️ 可能遗漏的要点'}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{result.missingTerms.map((t, i) => <span key={i} style={{ ...KV_TAG, background: 'rgba(245,158,11,.12)', color: '#f59e0b' }}>{t}</span>)}</div>
              </div> : null}
            </Card>
          </div>
        )
      }

      if (cur) {
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button style={KV_BTN} onClick={() => { setCur(null); setAnswer('') }}>{'← 返回题目列表'}</button>
              <span style={KV_TAG}>{cur.year + ' ' + cur.exam + ' ' + cur.paperType}</span>
              {cur.score ? <span style={{ ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{cur.score + ' 分'}</span> : null}
            </div>
            <Card title={'第 ' + cur.no + ' 题'}>
              {/* cycle-25：题干/作答要求接入统一组件域（QwQuestionCard browse 只读） */}
              <QwQuestionCard
                mode="browse"
                q={{ no: cur.no, score: cur.score, stem: cur.stem, requirement: cur.requirement }}
              />
              {cur.relatedMaterials ? <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: '#64748b', marginTop: 4 }}>
                <span>{'关联材料：'}</span>
                {parseMatNos(cur.relatedMaterials).length
                  ? parseMatNos(cur.relatedMaterials).map(n =>
                      <button
                        key={n}
                        style={{ ...KV_BTN, padding: '1px 8px', fontSize: 11, borderColor: '#6366f1', color: '#6366f1' }}
                        onClick={() => jumpToMaterial(n)}
                      >{'材料 ' + n}</button>)
                  : <span>{cur.relatedMaterials}</span>}
              </div> : null}
            </Card>
            {/* v1.7 给定材料阅读区（可折叠；考场必须先读材料）；cycle-14：逐份折叠——材料 N 标题可点击单独折叠/展开 */}
            <Card title={'📄 给定材料' + (paperDetail && paperDetail.materials ? '（' + paperDetail.materials.length + ' 段）' : '')}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button style={KV_BTN} onClick={() => setShowMaterials(v => !v)}>{showMaterials ? '▲ 收起材料' : '▼ 展开材料（' + ((paperDetail && paperDetail.materials) || []).length + ' 段）'}</button>
                {showMaterials && paperDetail && paperDetail.materials && paperDetail.materials.length > 0 ? (() => {
                  const mats = paperDetail.materials
                  const allCollapsed = mats.every(mm => collapsedMats[mm.no])
                  return <button
                    style={KV_BTN}
                    onClick={() => setCollapsedMats(() => {
                      const next = {}
                      for (const mm of mats) next[mm.no] = !allCollapsed
                      return next
                    })}
                  >{allCollapsed ? '▼ 全部展开' : '▲ 全部收起'}</button>
                })() : null}
                {paperDetail && paperDetail.materials && paperDetail.materials.length > 0 ? <span style={{ fontSize: 11, color: '#94a3b8' }}>{'点击「材料 N」标题可单独折叠 · 阅读材料后在下方作答区作答'}</span> : null}
              </div>
              {!paperDetail ? <div style={{ fontSize: 12, color: '#64748b' }}>{'加载材料…'}</div> : null}
              {paperDetail && (!paperDetail.materials || paperDetail.materials.length === 0) ? <div style={{ fontSize: 12, color: '#f59e0b' }}>{'该卷未附带材料（部分年份采集稿缺材料）'}</div> : null}
              {showMaterials && paperDetail && (paperDetail.materials || []).map(mm => {
                const isCollapsed = !!collapsedMats[mm.no]
                const wordCount = String(mm.text || '').replace(/\s/g, '').length
                return (
                  <div
                    key={mm.no}
                    ref={(el: any) => { matRefs.current[mm.no] = el }}
                    style={{
                      marginBottom: 14, paddingBottom: isCollapsed ? 6 : 12, paddingTop: hlNo === mm.no ? 8 : 0,
                      paddingLeft: hlNo === mm.no ? 10 : 0,
                      borderBottom: '1px dashed rgba(148,163,184,.2)',
                      borderLeft: hlNo === mm.no ? '3px solid #6366f1' : '3px solid transparent',
                      background: hlNo === mm.no ? 'rgba(99,102,241,.06)' : 'transparent',
                      borderRadius: hlNo === mm.no ? 8 : 0,
                      transition: 'all .25s',
                    }}
                  >
                    <div
                      style={{ fontWeight: 700, fontSize: 11.5, color: '#6366f1', marginBottom: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
                      onClick={() => toggleMat(mm.no)}
                      title={isCollapsed ? '展开材料 ' + mm.no : '折叠材料 ' + mm.no}
                    >
                      <span style={{ display: 'inline-block', transition: 'transform .2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>{'▸'}</span>
                      <span>{'材料 ' + mm.no}</span>
                      <span style={{ fontWeight: 400, fontSize: 10.5, color: '#94a3b8' }}>{'约 ' + wordCount + ' 字' + (isCollapsed ? ' · 已折叠' : '')}</span>
                    </div>
                    {!isCollapsed ? <RichText text={mm.text} maxHeight={300} fontSize={12.5} /> : null}
                  </div>
                )
              })}
            </Card>
            <Card title="✍️ 你的作答（离线评分，无需模型）">
              <textarea
                value={answer} onChange={e => { setAnswer(e.target.value); writeDraft(cur, e.target.value) }}
                placeholder="在此作答…建议分条（一、二、三 或 1. 2. 3.），要点覆盖权重最高（50%）"
                style={{ width: '100%', minHeight: 200, padding: 12, borderRadius: 10, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 13, lineHeight: 1.75, fontFamily: 'inherit', resize: 'vertical', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <button style={{ ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 20px', fontSize: 13, fontWeight: 700 }} disabled={busy || !answer.trim()} onClick={submit}>{busy ? '评分中…' : '提交评分'}</button>
                <span style={{ fontSize: 11.5, color: '#64748b' }}>{answer.replace(/\s/g, '').length + ' 字'}</span>
                <span style={{ fontSize: 10.5, color: '#94a3b8' }} title="作答内容已自动暂存在本机浏览器，误关页面或切换题目不会丢失">{'💾 草稿已本地暂存，误关不丢'}</span>
              </div>
            </Card>
          </div>
        )
      }

      return (
        <div>
          <Card title={'✍️ 申论练习' + (list ? '（' + (list.questions || []).length + ' 题）' : '')}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {['', '概括', '分析', '对策', '应用文', '大作文'].map(t =>
                <button
                  key={t || 'all'}
                  style={{ ...KV_BTN, ...(type === t ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }}
                  onClick={() => load(t)}
                >{t || '全部'}</button>)}
            </div>
            {!list ? <div style={{ fontSize: 12, color: '#64748b' }}>{'加载中…'}</div> : null}
            {list ? (list.questions || []).map((q, i) =>
              <div
                key={i}
                style={{ padding: '9px 11px', borderRadius: 9, marginBottom: 5, background: 'rgba(148,163,184,.06)', cursor: 'pointer', fontSize: 12.5, lineHeight: 1.65 }}
                onClick={() => {
                setCur(q); setAnswer(readDraft(q)); setResult(null); setPaperDetail(null); setShowMaterials(true); setCollapsedMats({})
                api('/paper?id=' + encodeURIComponent(q.paperId)).then(d => setPaperDetail(d)).catch(() => setPaperDetail({ materials: [] }))
              }}
              >
                <div style={{ display: 'flex', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={KV_TAG}>{String(q.year)}</span>
                  <span style={{ ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}>{q.paperType}</span>
                  {q.score ? <span style={{ fontSize: 10.5, color: '#64748b' }}>{q.score + '分'}</span> : null}
                </div>
                <div>{(q.stem || '').slice(0, 110) + ((q.stem || '').length > 110 ? '…' : '')}</div>
              </div>) : null}
          </Card>
        </div>
      )
    }
