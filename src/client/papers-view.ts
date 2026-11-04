/**
 * papers-view.ts — 真题卷族视图（cycle-13 T-025 从 client.ts 拆出）
 * 模考 / 真题卷库 / 专题 / 申论评改。
 */

import { h, React, entries, Stat, Bar, Card, RichText, KV_TAG, KV_BTN } from './ui-kit.js'
// cycle-13 专题枢纽：行测刷题 / 图形推理 / 深度题库 三个既有视图嵌入本页分区（R9：h() 挂载）
import { NativePracticeView, NativeTuxingView, NativeDeepBankView } from './study-view.js'

    /* ══ v1.6 新增：真题卷 / 专题 / 申论评改（全部宿主原生渲染，组件自管数据）══ */

    /** T-016 整卷模考：计时作答 → 交卷 → 模块得分分布 */
    export function NativeExamView({ api }) {
      const [papers, setPapers] = React.useState(null)
      const [exam, setExam] = React.useState(null)
      const [answers, setAnswers] = React.useState({})
      const [idx, setIdx] = React.useState(0)
      const [left, setLeft] = React.useState(0)
      const [report, setReport] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

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
        const wrongRows = wrongList.slice(0, 30).map(d => h('div', {
          key: d.no,
          style: { display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(148,163,184,.12)' },
        },
          h('span', { style: { ...KV_TAG, minWidth: 52 } }, '第' + d.no + '题'),
          h('span', { style: { flex: 1, color: '#64748b' } }, d.type || ''),
          h('span', { style: { color: '#ef4444' } }, '你 ' + (d.mine || '—')),
          h('span', { style: { color: '#10b981' } }, '对 ' + (d.right || '?'))))
        return h('div', {},
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } },
            h('button', { style: KV_BTN, onClick: () => { setExam(null); setReport(null) } }, '← 换一套卷')),
          h(Card, { title: '📊 模考报告 · ' + report.subject + ' ' + report.year },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 38, fontWeight: 800, color } }, pct + '%'),
              h('span', { style: { fontSize: 14, color: '#64748b' } }, '答 ' + report.answered + ' 题 · 对 ' + report.correct + ' 题 · 正确率 ' + report.rate + '%'),
              h('span', { style: { fontSize: 12, color: '#94a3b8' } }, '用时 ' + fmt(report.elapsedSec || 0))),
            h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 8 } }, '🎯 模块得分分布（弱→强）'),
            (report.modules || []).map(m => h('div', { key: m.type, style: { marginBottom: 9 } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 } },
                h('span', null, m.type + (m.total ? '（' + m.total + ' 题）' : '')),
                h('span', { style: { color: '#64748b' } }, m.correct + '/' + m.answered + ' · ' + m.rate + '%')),
              h(Bar, { pct: m.rate, color: m.rate >= 75 ? 'linear-gradient(135deg,#10b981,#34d399)' : m.rate >= 50 ? undefined : 'linear-gradient(135deg,#f59e0b,#fbbf24)' })))),
          h(Card, { title: '❌ 错题清单（' + wrongList.length + ' 题）' },
            wrongRows,
            wrongList.length === 0 ? h('div', { style: { fontSize: 12, color: '#10b981' } }, '🎉 全对！') : null))
      }

      // ── 分支 2：考试中 ──
      if (exam) {
        const q = exam.questions[idx]
        if (!q) return h('div', { className: 'kg-load' }, '题目加载异常')
        const answeredCount = Object.keys(answers).length
        const optRows = entries(q.options || {}).map(([L, txt]) => {
          const chosen = answers[q.no] === L
          return h('div', {
            key: L,
            style: {
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px',
              border: '2px solid ' + (chosen ? '#6366f1' : 'rgba(148,163,184,.3)'),
              background: chosen ? 'rgba(99,102,241,.08)' : 'transparent',
              borderRadius: 10, marginTop: 8, cursor: 'pointer', fontSize: 13, lineHeight: 1.6,
            },
            onClick: () => setAnswers(a => ({ ...a, [q.no]: L })),
          },
            h('div', { style: { width: 24, height: 24, borderRadius: '50%', background: chosen ? '#6366f1' : 'rgba(148,163,184,.15)', color: chosen ? '#fff' : 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 } }, L),
            h('div', { style: { flex: 1 } }, txt))
        })
        return h('div', {},
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' } },
            h('span', { style: { fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: left < 300 ? '#ef4444' : 'var(--text-primary,#0f172a)' } }, '⏱ ' + fmt(left)),
            h('span', { style: KV_TAG }, exam.subject + ' ' + exam.year),
            h('span', { style: { fontSize: 12, color: '#64748b' } }, '已答 ' + answeredCount + '/' + exam.questionCount),
            h('button', {
              style: { ...KV_BTN, marginLeft: 'auto', background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', border: 0, padding: '6px 16px' },
              disabled: busy, onClick: doSubmit,
            }, busy ? '交卷中…' : '交卷')),
          h(Card, { title: '第 ' + q.no + ' 题 · ' + (q.type || '') },
            h(RichText, { text: q.stem, fontSize: 13 }),
            optRows),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' } },
            h('button', { style: KV_BTN, disabled: idx === 0, onClick: () => setIdx(i => Math.max(0, i - 1)) }, '← 上一题'),
            h('button', { style: KV_BTN, disabled: idx >= exam.questions.length - 1, onClick: () => setIdx(i => Math.min(exam.questions.length - 1, i + 1)) }, '下一题 →'),
            h('span', { style: { marginLeft: 'auto', fontSize: 11.5, color: '#64748b' } }, (idx + 1) + ' / ' + exam.questions.length)))
      }

      // ── 分支 3：选题 ──
      const listRows = papers
        ? papers.papers.slice(0, 60).map(pp => h('div', {
            key: pp.id,
            style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, marginBottom: 4, background: 'rgba(148,163,184,.06)', fontSize: 12.5 },
          },
            h('span', { style: { width: 46, fontWeight: 700, color: '#6366f1' } }, pp.year),
            h('span', { style: { flex: 1 } }, pp.exam + ' · ' + pp.paperType),
            h('span', { style: { color: '#64748b', fontSize: 11.5, marginRight: 8 } }, pp.questionCount + ' 题'),
            h('button', { style: { ...KV_BTN, padding: '3px 12px' }, disabled: busy, onClick: () => start(pp.id) }, '开始模考')))
        : null

      return h('div', {},
        h(Card, { title: '⏱ 行测整卷模考（真实考场计时）' },
          h('div', { style: { fontSize: 11.5, color: '#64748b', marginBottom: 10 } }, '选一套卷 → 限时作答（行测 120 分钟）→ 交卷得模块得分分布与错题清单'),
          !papers ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '加载卷库…') : null,
          listRows ? h('div', { style: { maxHeight: '56vh', overflowY: 'auto' } }, listRows) : null))
    }

    /** 真题卷库 */
    export function NativePapersView({ api, initialSubject = '' }) {
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
        if (!detail) return h('div', { className: 'kg-load' }, h('div', { className: 'kg-spin' }), '加载试卷…')
        return h('div', {},
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' } },
            h('button', { style: KV_BTN, onClick: () => { setOpenId(null); setDetail(null) } }, '← 返回列表'),
            detail.exam ? h('span', { style: KV_TAG }, detail.exam + ' ' + detail.year) : null,
            detail.subject ? h('span', { style: KV_TAG }, detail.subject) : null,
            detail.paperType ? h('span', { style: KV_TAG }, detail.paperType) : null,
            h('span', { style: { fontSize: 11.5, color: '#64748b' } }, ((detail.materials || []).length) + ' 材料 · ' + ((detail.questions || []).length) + ' 题')),
          detail.error ? h('div', { style: { color: '#ef4444' } }, detail.error) : null,
          // cycle-14：给定材料逐份折叠——每份材料头部可点击折叠/展开（含字数提示），另有「全部展开/收起」总开关
          (detail.materials || []).length > 0 ? h(Card, { title: '📄 给定材料' },
            h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' } },
              h('button', {
                style: KV_BTN,
                onClick: () => setCollapsedMats(() => {
                  const next = {}
                  for (const m of mats) next[m.no] = !allCollapsed
                  return next
                }),
              }, allCollapsed ? '▼ 展开全部材料（' + mats.length + ' 份）' : '▲ 收起全部材料'),
              h('span', { style: { fontSize: 11, color: '#94a3b8' } }, '点击「材料 N」标题可单独折叠/展开该份材料')),
            detail.materials.map(m => {
              const wordCount = String(m.text || '').replace(/\s/g, '').length
              const isCollapsed = !!collapsedMats[m.no]
              return h('div', { key: m.no, style: { marginBottom: 14, paddingBottom: isCollapsed ? 0 : 10, borderBottom: '1px dashed rgba(148,163,184,.18)' } },
                h('div', {
                  style: { fontWeight: 700, fontSize: 12, color: '#6366f1', marginBottom: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' },
                  onClick: () => toggleMat(m.no),
                  title: isCollapsed ? '展开材料 ' + m.no : '折叠材料 ' + m.no,
                },
                  h('span', { style: { display: 'inline-block', transition: 'transform .2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' } }, '▸'),
                  h('span', null, '材料 ' + m.no),
                  h('span', { style: { fontWeight: 400, fontSize: 10.5, color: '#94a3b8' } }, '约 ' + wordCount + ' 字' + (isCollapsed ? ' · 已折叠' : ''))),
                !isCollapsed ? h(RichText, { text: m.text, maxHeight: 240 }) : null)
            })) : null,
          h(Card, { title: '📝 题目与参考答案' },
            (detail.questions || []).map(q => h('div', { key: q.no, style: { borderBottom: '1px solid rgba(148,163,184,.18)', paddingBottom: 12, marginBottom: 12 } },
              h('div', { style: { display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' } },
                h('span', { style: KV_TAG }, '第 ' + q.no + ' 题'),
                q.score ? h('span', { style: { ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' } }, q.score + ' 分') : null),
              h('div', { style: { marginBottom: 6, fontWeight: 500 } }, h(RichText, { text: q.stem, fontSize: 13 })),
              q.requirement ? h('div', { style: { fontSize: 11.5, color: '#f59e0b', marginBottom: 6 } }, '作答要求：' + q.requirement) : null,
              q.relatedMaterials ? h('div', { style: { fontSize: 11, color: '#64748b', marginBottom: 6 } }, '关联：' + q.relatedMaterials) : null,
              q.reference ? h('details', { style: { fontSize: 12, lineHeight: 1.75 } },
                h('summary', { style: { cursor: 'pointer', color: '#6366f1', fontWeight: 600, fontSize: 12 } }, '▸ 参考答案（粉笔题库）'),
                h('div', { style: { marginTop: 8, padding: 10, background: 'rgba(148,163,184,.08)', borderRadius: 8 } }, h(RichText, { text: q.reference }))) : null))))
      }

      return h('div', {},
        h(Card, { title: '📚 真题卷库' + (list ? '（' + list.total + ' 套）' : '') },
          // T-019 浏览模式：按科目/年份 或 按考点反查
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, '浏览'),
            h('button', { style: { ...KV_BTN, ...(mode === 'year' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }, onClick: () => setMode('year') }, '按科目/年份'),
            h('button', { style: { ...KV_BTN, ...(mode === 'topic' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }, onClick: () => setMode('topic') }, '按考点'),
            cat ? h('span', { style: { ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' } }, '考点：' + cat) : null),
          mode === 'topic' ? h('div', { style: { marginBottom: 12 } },
            h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 } },
              cats.slice(0, 18).map((c: any) => h('button', {
                key: c.k,
                style: { ...KV_BTN, fontSize: 11, ...(cat === c.k ? { background: 'rgba(99,102,241,.15)', color: '#6366f1', borderColor: '#6366f1' } : {}) },
                onClick: () => setCat(cat === c.k ? '' : c.k),
              }, c.k + ' ' + c.c))),
            !cats.length ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '加载考点…') : null,
            cat && catPapers === null ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '查询含「' + cat + '」的卷…') : null,
            cat && catPapers ? h('div', { style: { maxHeight: '46vh', overflowY: 'auto' } },
              h('div', { style: { fontSize: 11, color: '#64748b', marginBottom: 6 } }, '共 ' + catPapers.length + ' 套卷含该考点（按题量排序）'),
              catPapers.map((cp: any, i: number) => h('div', {
                key: i,
                style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, marginBottom: 4, background: 'rgba(148,163,184,.06)', fontSize: 12 },
              },
                h('span', { style: { width: 44, fontWeight: 700, color: '#6366f1' } }, String(cp.year || '—')),
                h('span', { style: { width: 50, color: '#64748b' } }, cp.region || ''),
                h('span', { style: { flex: 1 } }, String(cp.paper || '').replace(/（网友回忆版）|《行测》题|《申论》题/g, '')),
                h('span', { style: { ...KV_TAG, fontSize: 10, background: 'rgba(16,185,129,.12)', color: '#10b981' } }, cp.count + ' 题')))) : null) : null,
          list && list.subjects ? h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
            h('button', { style: { ...KV_BTN, ...(filters.subject === '' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }, onClick: () => setFilters({ subject: '', year: '', province: '' }) }, '全部'),
            list.subjects.map(sc => h('button', {
              key: sc.subject,
              style: { ...KV_BTN, ...(filters.subject === sc.subject ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
              onClick: () => setFilters({ subject: sc.subject, year: '', province: '' }),
            }, sc.subject + ' ' + sc.count))) : null,
          // cycle-13 省份维度 chips：provinces facet 驱动（索引 v2 起可用；旧数据无 facet 时整行隐藏）
          list && Array.isArray(list.provinces) && list.provinces.length ? h('div', { style: { display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, '省份'),
            h('button', {
              style: { ...KV_BTN, ...(filters.province === '' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
              onClick: () => setFilters({ ...filters, province: '' }),
            }, '全部'),
            list.provinces.map((p: any) => h('button', {
              key: p.name,
              title: p.subjects ? entries(p.subjects).map(([s, n]) => s + ' ' + n).join(' · ') + `（${p.minYear || '?'}-${p.maxYear || '?'}）` : p.name,
              style: { ...KV_BTN, ...(filters.province === p.name ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
              onClick: () => setFilters({ ...filters, province: filters.province === p.name ? '' : p.name }),
            }, p.name + ' ' + p.total))) : null,
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
            ['2026', '2025', '2024', '2023', '2022', '2021', '2020'].map(y => h('button', {
              key: y,
              style: { ...KV_BTN, ...(filters.year === y ? { background: 'rgba(99,102,241,.15)', color: '#6366f1', borderColor: '#6366f1' } : {}) },
              onClick: () => setFilters({ ...filters, year: filters.year === y ? '' : y }),
            }, y))),
          !list ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '加载中…') : null,
          list ? h('div', { style: { maxHeight: '52vh', overflowY: 'auto' } },
            list.papers.map(p => h('div', {
              key: p.id,
              style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, marginBottom: 4, cursor: 'pointer', background: 'rgba(148,163,184,.06)', fontSize: 12.5 },
              onClick: () => { setOpenId(p.id); setDetail(null) },
            },
              h('span', { style: { width: 46, fontWeight: 700, color: '#6366f1' } }, p.year || '—'),
              h('span', { style: { width: 58, color: '#64748b' } }, p.province || p.exam),
              h('span', { style: { flex: 1 } }, p.subject + ' · ' + p.paperType),
              h('span', { style: { color: '#64748b', fontSize: 11.5 } }, p.questionCount + ' 题'),
              p.verified ? h('span', { style: { ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' } }, '已核验') : null))) : null))
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

    export function NativeTopicsView({ api, onGo, initialModule = '' }) {
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
      const tabRow = h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14, padding: 4, background: 'rgba(148,163,184,.09)', borderRadius: 12 } },
        TOPIC_HUB_TABS.map(tb => h('button', {
          key: tb.id,
          'data-kg-hub-tab': tb.id,
          style: { ...KV_BTN, border: 0, padding: '7px 15px', fontSize: 12.5, fontWeight: 700, borderRadius: 9, ...(sec === tb.id ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' } : {}) },
          onClick: () => visit(tb.id),
        }, tb.label)))

      // ── 总览分区：既有专题树（行测/申论频道 + 练习入口），内部行为零变化 ──
      const chs = tree ? (tree.channels || []) : []
      const cur = chs.find(c => c.id === channel) || chs[0]
      const go = (entry) => { if (entry && onGo) onGo(entry.view, entry.params || {}) }
      const st = tree ? (tree.stats || {}) : {}

      // 频道切换 + 统计
      const head = h('div', {},
        h('div', { style: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
          chs.map(c => h('button', {
            key: c.id,
            'data-kg-channel': c.id,
            style: { ...KV_BTN, padding: '8px 18px', fontSize: 13, ...(c.id === channel ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
            onClick: () => setChannel(c.id),
          }, c.icon + ' ' + c.name + '频道'))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 } },
          h(Stat, { v: st.paperTotal, l: '真题卷总数', color: '#6366f1' }),
          h(Stat, { v: st.xingcePapers, l: '行测套卷', color: '#0ea5e9' }),
          h(Stat, { v: st.essayPapers, l: '申论套卷', color: '#8b5cf6' }),
          h(Stat, { v: st.naokuTotal, l: '深度标注题', color: '#10b981' })))

      // 频道内的练习入口（cur 缺席时降级为提示，绝不抛错）
      const entriesCard = cur ? h(Card, { title: '🚀 ' + cur.name + '练习入口' },
        h('div', { style: { fontSize: 11.5, color: '#64748b', marginBottom: 10 } }, cur.desc),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 } },
          (cur.entries || []).map((e, i) => h('div', {
            key: i,
            style: { border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 14, cursor: 'pointer', textAlign: 'center', background: 'rgba(148,163,184,.04)' },
            onClick: () => go({ view: e.view, params: e.params }),
          },
            h('div', { style: { fontWeight: 800, fontSize: 13.5 } }, e.label),
            h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 4 } }, '点击进入')))))
        : h(Card, { title: '🚀 练习入口' }, h('div', { style: { fontSize: 12, color: '#64748b' } }, '专题数据暂不可用 — 可直接使用上方分区练习'))

      // 专题列表（按 kind 分组）
      const topics = cur ? (cur.topics || []) : []
      const groups: any = {}
      for (const t2 of topics) (groups[t2.kind] = groups[t2.kind] || []).push(t2)
      const KIND_LABEL = { module: '六大模块', category: '细分题型', 'essay-type': '申论题型' }

      const topicCards = entries(groups).map(([kind, list]) =>
        h(Card, { key: kind, title: (KIND_LABEL[kind] || kind) + '（' + list.length + '）' },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 } },
            list.map(t2 => h('div', {
              key: t2.id,
              style: { border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 13, cursor: 'pointer' },
              onClick: () => go(t2.entry),
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
                h('span', { style: { fontWeight: 800, fontSize: 13.5 } }, t2.title),
                t2.questionCount ? h('span', { style: { ...KV_TAG, fontSize: 10, background: 'rgba(16,185,129,.12)', color: '#10b981' } }, t2.questionCount + ' 题') : null,
                t2.papers ? h('span', { style: { ...KV_TAG, fontSize: 10 } }, t2.papers + ' 套') : null),
              h('div', { style: { fontSize: 11.5, color: '#64748b', lineHeight: 1.6 } }, t2.desc || ''),
              h('div', { style: { fontSize: 10.5, color: '#6366f1', marginTop: 6, fontWeight: 600 } }, '开始练习 →'))))))

      const overview = !tree
        ? h('div', { className: 'kg-load' }, h('div', { className: 'kg-spin' }), '加载专题…')
        : h('div', {}, head, entriesCard, ...topicCards)

      // 分区包裹：非当前分区 display:none 隐藏（保持挂载 → 状态不丢）
      const wrap = (id: string, node) => h('div', { key: id, style: sec === id ? undefined : { display: 'none' } }, node)

      return h('div', {},
        tabRow,
        visited.overview ? wrap('overview', overview) : null,
        visited.practice ? wrap('practice', h(NativePracticeView, { key: 'topic-practice', api, initialModule: initialModule || '', onGoWrongbook: onGo ? () => onGo('wrongbook', {}) : undefined })) : null,
        visited.tuxing ? wrap('tuxing', h(NativeTuxingView, { key: 'topic-tuxing', api })) : null,
        visited.deepbank ? wrap('deepbank', h(NativeDeepBankView, { key: 'topic-deepbank', api, initialModule: '', initialCategory: '' })) : null,
        visited.essay ? wrap('essay', h(NativeEssayView, { key: 'topic-essay', api, initialType: '' })) : null,
        visited.method ? wrap('method', h(TopicMethodView, { key: 'topic-method', api })) : null)
    }

    /**
     * 方法论技巧分区（cycle-13 新增，用户点名缺失）：两部分数据全部来自既有端点（只消费不新增）——
     * ① kaogong-skill 十主题方法论：/api/methods（目录）+ /api/method?topic=（markdown 正文）；
     * ② naoku 母题思维 / 易错点精选：/api/naoku/questions?count=20&random=0（ORDER BY id，确定性）
     *    过滤出带 mother/pitfalls 标注的题，取前 6 条做卡片。
     * 字段全部可选降级：目录缺失 / 题库未就绪 → 友好空态 + 静态引导卡，绝不抛错、绝不臆造字段。
     * R9：真组件（useState×6 + useEffect×2，hook 数恒定），由 NativeTopicsView 经 h() 挂载。
     */
    export function TopicMethodView({ api }) {
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
        ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '加载方法论目录…')
        : topics.length === 0
          ? h('div', { style: { fontSize: 12, color: '#f59e0b' } }, '⚠️ 方法论目录暂不可用（kaogong-skill 参考文件缺失）')
          : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 } },
              topics.map((tp: any) => h('div', {
                key: tp.id || tp.label,
                style: { border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 13, cursor: 'pointer', textAlign: 'center', background: open === tp.label ? 'rgba(99,102,241,.07)' : 'rgba(148,163,184,.04)' },
                onClick: () => openTopic(String(tp.label)),
              },
                h('div', { style: { fontWeight: 800, fontSize: 13 } }, '📖 ' + tp.label),
                h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 4 } }, open === tp.label ? '点击收起' : '点击展开全文'))))

      // 展开的方法论正文（RichText 渲染 markdown）
      const methodDetail = open && contents[open]
        ? h(Card, { title: '📖 ' + open + ' · 方法论全文' },
            h(RichText, { text: String(contents[open]), fontSize: 12.5, maxHeight: '48vh' }))
        : open ? h(Card, { title: '📖 ' + open }, h('div', { style: { fontSize: 12, color: '#64748b' } }, busy ? '加载正文…' : '正文暂缺')) : null

      // ② 母题思维 / 易错点精选卡
      const pickCards = picks === null
        ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '加载母题精选…')
        : picks.length === 0
          ? h(Card, { title: '🧩 母题思维 / 易错点精选' },
              h('div', { style: { fontSize: 12, color: '#64748b', lineHeight: 1.8 } },
                '深度题库未就绪（需 Node ≥ 22.19 内置 node:sqlite 且 GongkaoNaoku 分片存在），母题精选暂缺。',
                h('div', { style: { marginTop: 6, color: '#4f46e5' } }, '可先阅读上方方法论；或在左栏面板「深度题库」分区练习（那里有未掌握时的回落方案）。')))
          : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 } },
              picks.map((q: any, i: number) => h('div', { key: q.id || i },
                h('div', {
                  style: { border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 13, cursor: 'pointer', background: pickOpen === i ? 'rgba(139,92,246,.06)' : 'rgba(148,163,184,.04)' },
                  onClick: () => setPickOpen(pickOpen === i ? -1 : i),
                },
                  h('div', { style: { display: 'flex', gap: 5, marginBottom: 5, flexWrap: 'wrap' } },
                    h('span', { style: KV_TAG }, q.module || '深度标注'),
                    q.type ? h('span', { style: { ...KV_TAG, fontSize: 10, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, q.type) : null,
                    q.mother ? h('span', { style: { ...KV_TAG, fontSize: 10, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, '🧩 母题') : null,
                    q.pitfalls ? h('span', { style: { ...KV_TAG, fontSize: 10, background: 'rgba(239,68,68,.12)', color: '#ef4444' } }, '⚠️ 易错') : null),
                  h('div', { style: { fontSize: 12, fontWeight: 600, lineHeight: 1.6 } }, String(q.kadian || q.stem || '').slice(0, 56) + (String(q.kadian || q.stem || '').length > 56 ? '…' : '')),
                  h('div', { style: { fontSize: 10.5, color: '#6366f1', marginTop: 6, fontWeight: 600 } }, pickOpen === i ? '收起 ▲' : '展开详情 ▼')),
                pickOpen === i ? h('div', { style: { border: '1.5px solid rgba(139,92,246,.35)', borderTop: 0, borderRadius: '0 0 12px 12px', padding: 12, background: 'rgba(139,92,246,.04)' } },
                  q.stem ? h('div', { style: { marginBottom: 8 } }, h('div', { style: { fontWeight: 700, fontSize: 11.5, color: '#64748b', marginBottom: 3 } }, '题干'), h(RichText, { text: String(q.stem).slice(0, 400), fontSize: 11.5, maxHeight: 160 })) : null,
                  q.mother ? h('div', { style: { marginBottom: 8 } }, h('div', { style: { fontWeight: 700, fontSize: 11.5, color: '#8b5cf6', marginBottom: 3 } }, '🧩 母题思维'), h(RichText, { text: q.mother, fontSize: 11.5, maxHeight: 200 })) : null,
                  q.pitfalls ? h('div', null, h('div', { style: { fontWeight: 700, fontSize: 11.5, color: '#ef4444', marginBottom: 3 } }, '⚠️ 易错点'), h(RichText, { text: q.pitfalls, fontSize: 11.5, maxHeight: 200 })) : null) : null)))

      return h('div', {},
        h(Card, { title: '📖 方法论技巧（kaogong-skill 十主题）' },
          h('div', { style: { fontSize: 11.5, color: '#64748b', marginBottom: 10 } },
            '行测 / 申论 / 职测 / 综应 / 公基 / 公文 / 面试 / 时政 / 报考 / 复盘 十大主题备考方法论，点击主题展开全文。'),
          methodGrid),
        methodDetail,
        h(Card, { title: '🧩 母题思维 / 易错点精选（深度题库标注）' },
          h('div', { style: { fontSize: 11.5, color: '#64748b', marginBottom: 10 } },
            '从 GongkaoNaoku 27506 题的五维标注中精选带「母题思维 / 易错点」的真题，点击卡片展开题干与标注全文。'),
          pickCards))
    }

    /** 申论练习 + 离线评改 */
    export function NativeEssayView({ api, initialType = '' }) {
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
        return h('div', {},
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } },
            h('button', { style: KV_BTN, onClick: () => { setResult(null); setAnswer(''); if (cur) writeDraft(cur, '') } }, '← 重新作答'),
            h('button', { style: KV_BTN, onClick: () => { if (cur) writeDraft(cur, ''); setCur(null); setResult(null); setAnswer('') } }, '换一题')),
          h(Card, { title: '📊 评分结果' },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 } },
              h('span', { style: { fontSize: 40, fontWeight: 800, color } }, result.score),
              h('span', { style: { fontSize: 16, color: '#64748b' } }, '/ ' + result.max),
              h('span', { style: { fontSize: 13, color: '#64748b' } }, '(' + pct + '% · ' + result.chars + ' 字' + (result.limit ? ' / 限 ' + result.limit : '') + ')')),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 14 } },
              [['要点覆盖', result.dims.coverage, '权重50%'], ['结构条理', result.dims.structure, '权重20%'], ['字数合规', result.dims.length, '权重15%'], ['语言规范', result.dims.language, '权重15%']].map(([k, v, w]) =>
                h('div', { key: k, style: { background: 'rgba(148,163,184,.08)', borderRadius: 10, padding: 10 } },
                  h('div', { style: { fontSize: 11, color: '#64748b' } }, k + ' ' + w),
                  h('div', { style: { fontSize: 18, fontWeight: 800, marginBottom: 4 } }, v),
                  h(Bar, { pct: v, color: v >= 70 ? 'linear-gradient(135deg,#10b981,#34d399)' : v >= 40 ? undefined : 'linear-gradient(135deg,#f59e0b,#fbbf24)' })))),
            h('div', { style: { marginBottom: 12 } },
              h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 6 } }, '💬 批改建议'),
              (result.feedback || []).map((f, i) => h('div', { key: i, style: { fontSize: 12.5, lineHeight: 1.7 } }, '• ' + f))),
            (result.hitTerms || []).length > 0 ? h('div', { style: { marginBottom: 10 } },
              h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5 } }, '✅ 已覆盖采分点'),
              h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } }, result.hitTerms.map((t, i) => h('span', { key: i, style: { ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' } }, t)))) : null,
            (result.missingTerms || []).length > 0 ? h('div', {},
              h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5 } }, '⚠️ 可能遗漏的要点'),
              h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } }, result.missingTerms.map((t, i) => h('span', { key: i, style: { ...KV_TAG, background: 'rgba(245,158,11,.12)', color: '#f59e0b' } }, t)))) : null))
      }

      if (cur) {
        return h('div', {},
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
            h('button', { style: KV_BTN, onClick: () => { setCur(null); setAnswer('') } }, '← 返回题目列表'),
            h('span', { style: KV_TAG }, cur.year + ' ' + cur.exam + ' ' + cur.paperType),
            cur.score ? h('span', { style: { ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' } }, cur.score + ' 分') : null),
          h(Card, { title: '第 ' + cur.no + ' 题' },
            h('div', { style: { marginBottom: 8, fontWeight: 500 } }, h(RichText, { text: cur.stem, fontSize: 13.5 })),
            cur.requirement ? h('div', { style: { fontSize: 11.5, color: '#f59e0b', marginBottom: 6 } }, '作答要求：' + cur.requirement) : null,
            cur.relatedMaterials ? h('div', { style: { display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: '#64748b', marginTop: 4 } },
              h('span', null, '关联材料：'),
              parseMatNos(cur.relatedMaterials).length
                ? parseMatNos(cur.relatedMaterials).map(n => h('button', {
                    key: n,
                    style: { ...KV_BTN, padding: '1px 8px', fontSize: 11, borderColor: '#6366f1', color: '#6366f1' },
                    onClick: () => jumpToMaterial(n),
                  }, '材料 ' + n))
                : h('span', null, cur.relatedMaterials)) : null),
          // v1.7 给定材料阅读区（可折叠；考场必须先读材料）；cycle-14：逐份折叠——材料 N 标题可点击单独折叠/展开
          h(Card, { title: '📄 给定材料' + (paperDetail && paperDetail.materials ? '（' + paperDetail.materials.length + ' 段）' : '') },
            h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' } },
              h('button', { style: KV_BTN, onClick: () => setShowMaterials(v => !v) }, showMaterials ? '▲ 收起材料' : '▼ 展开材料（' + ((paperDetail && paperDetail.materials) || []).length + ' 段）'),
              showMaterials && paperDetail && paperDetail.materials && paperDetail.materials.length > 0 ? (() => {
                const mats = paperDetail.materials
                const allCollapsed = mats.every(mm => collapsedMats[mm.no])
                return h('button', {
                  style: KV_BTN,
                  onClick: () => setCollapsedMats(() => {
                    const next = {}
                    for (const mm of mats) next[mm.no] = !allCollapsed
                    return next
                  }),
                }, allCollapsed ? '▼ 全部展开' : '▲ 全部收起')
              })() : null,
              paperDetail && paperDetail.materials && paperDetail.materials.length > 0 ? h('span', { style: { fontSize: 11, color: '#94a3b8' } }, '点击「材料 N」标题可单独折叠 · 阅读材料后在下方作答区作答') : null),
            !paperDetail ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '加载材料…') : null,
            paperDetail && (!paperDetail.materials || paperDetail.materials.length === 0) ? h('div', { style: { fontSize: 12, color: '#f59e0b' } }, '该卷未附带材料（部分年份采集稿缺材料）') : null,
            showMaterials && paperDetail && (paperDetail.materials || []).map(mm => {
              const isCollapsed = !!collapsedMats[mm.no]
              const wordCount = String(mm.text || '').replace(/\s/g, '').length
              return h('div', {
                key: mm.no,
                ref: (el: any) => { matRefs.current[mm.no] = el },
                style: {
                  marginBottom: 14, paddingBottom: isCollapsed ? 6 : 12, paddingTop: hlNo === mm.no ? 8 : 0,
                  paddingLeft: hlNo === mm.no ? 10 : 0,
                  borderBottom: '1px dashed rgba(148,163,184,.2)',
                  borderLeft: hlNo === mm.no ? '3px solid #6366f1' : '3px solid transparent',
                  background: hlNo === mm.no ? 'rgba(99,102,241,.06)' : 'transparent',
                  borderRadius: hlNo === mm.no ? 8 : 0,
                  transition: 'all .25s',
                },
              },
                h('div', {
                  style: { fontWeight: 700, fontSize: 11.5, color: '#6366f1', marginBottom: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' },
                  onClick: () => toggleMat(mm.no),
                  title: isCollapsed ? '展开材料 ' + mm.no : '折叠材料 ' + mm.no,
                },
                  h('span', { style: { display: 'inline-block', transition: 'transform .2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' } }, '▸'),
                  h('span', null, '材料 ' + mm.no),
                  h('span', { style: { fontWeight: 400, fontSize: 10.5, color: '#94a3b8' } }, '约 ' + wordCount + ' 字' + (isCollapsed ? ' · 已折叠' : ''))),
                !isCollapsed ? h(RichText, { text: mm.text, maxHeight: 300, fontSize: 12.5 }) : null)
            })),
          h(Card, { title: '✍️ 你的作答（离线评分，无需模型）' },
            h('textarea', {
              value: answer, onChange: e => { setAnswer(e.target.value); writeDraft(cur, e.target.value) },
              placeholder: '在此作答…建议分条（一、二、三 或 1. 2. 3.），要点覆盖权重最高（50%）',
              style: { width: '100%', minHeight: 200, padding: 12, borderRadius: 10, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 13, lineHeight: 1.75, fontFamily: 'inherit', resize: 'vertical', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)', boxSizing: 'border-box' },
            }),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' } },
              h('button', { style: { ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 20px', fontSize: 13, fontWeight: 700 }, disabled: busy || !answer.trim(), onClick: submit }, busy ? '评分中…' : '提交评分'),
              h('span', { style: { fontSize: 11.5, color: '#64748b' } }, answer.replace(/\s/g, '').length + ' 字'),
              h('span', { style: { fontSize: 10.5, color: '#94a3b8' }, title: '作答内容已自动暂存在本机浏览器，误关页面或切换题目不会丢失' }, '💾 草稿已本地暂存，误关不丢'))))
      }

      return h('div', {},
        h(Card, { title: '✍️ 申论练习' + (list ? '（' + (list.questions || []).length + ' 题）' : '') },
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
            ['', '概括', '分析', '对策', '应用文', '大作文'].map(t => h('button', {
              key: t || 'all',
              style: { ...KV_BTN, ...(type === t ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
              onClick: () => load(t),
            }, t || '全部'))),
          !list ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '加载中…') : null,
          list ? (list.questions || []).map((q, i) => h('div', {
            key: i,
            style: { padding: '9px 11px', borderRadius: 9, marginBottom: 5, background: 'rgba(148,163,184,.06)', cursor: 'pointer', fontSize: 12.5, lineHeight: 1.65 },
            onClick: () => {
            setCur(q); setAnswer(readDraft(q)); setResult(null); setPaperDetail(null); setShowMaterials(true); setCollapsedMats({})
            api('/paper?id=' + encodeURIComponent(q.paperId)).then(d => setPaperDetail(d)).catch(() => setPaperDetail({ materials: [] }))
          },
          },
            h('div', { style: { display: 'flex', gap: 6, marginBottom: 3, flexWrap: 'wrap' } },
              h('span', { style: KV_TAG }, String(q.year)),
              h('span', { style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, q.paperType),
              q.score ? h('span', { style: { fontSize: 10.5, color: '#64748b' } }, q.score + '分') : null),
            h('div', {}, (q.stem || '').slice(0, 110) + ((q.stem || '').length > 110 ? '…' : '')))) : null))
    }