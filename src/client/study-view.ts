/**
 * study-view.ts — 学习类视图族（cycle-13 T-025 从 client.ts 拆出）
 * 仪表盘 / 刷题 / 错题本 / 图形推理 / 深度题库。
 * cycle-13 对话窗口瘦身：会话练题控件已整体删除，
 * 练题流程收敛到左栏「考公学习」面板（对话窗口回归纯对话）。
 */

import { h, React, entries, Stat, Bar, Card, RichText, KV_TAG, KV_BTN, OptionRow } from './ui-kit.js'

    /* ── 子视图：真组件（R9：一律经 h(Comp, props) 挂载）── */
    export function NativeDashboardView(props) {
      const { st, stats, extra } = props.data
      const rate = stats.rate
      const rc = rate >= 80 ? '#10b981' : rate >= 60 ? '#6366f1' : rate >= 40 ? '#f59e0b' : '#ef4444'
      return h('div', {},
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 14 } },
          h(Stat, { v: `${st.repos.ready}/${st.repos.total}`, l: '资源仓库', color: '#6366f1' }),
          h(Stat, { v: stats.answered, l: '累计答题', color: '#10b981' }),
          h(Stat, { v: rate + '%', l: '总体正确率', color: rc }),
          h(Stat, { v: 'D' + (stats.day || 1), l: '计划进度日', color: '#f59e0b' }),
          stats.streak > 1 ? h(Stat, { v: '🔥×' + stats.streak, l: '连续学习', color: '#ef4444' }) : null),
        h(Card, { title: '🎯 模块掌握度（正确率×置信）' },
          entries(stats.mastery || {}).sort((a, b) => a[1].mastery - b[1].mastery).map(([m, s]) =>
            h('div', { key: m, style: { marginBottom: 10 } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 } },
                h('span', null, m),
                h('span', { style: { color: '#64748b' } }, `${s.answered}题 · ${s.rate}% · 掌握${s.mastery}`)),
              h(Bar, { pct: s.mastery, color: s.mastery >= 80 ? 'linear-gradient(135deg,#10b981,#34d399)' : s.mastery < 50 ? 'linear-gradient(135deg,#f59e0b,#fbbf24)' : undefined }))),
          !Object.keys(stats.mastery || {}).length && h('div', { style: { fontSize: 12, color: '#64748b' } }, '暂无数据 — 去「✏️ 刷题」开练')),
        // v1.7 数据总览：题库规模 + 申论/模考战绩
        extra ? h(Card, { title: '📚 资源总览' },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 } },
            h(Stat, { v: extra.paperTotal || 0, l: '真题卷总数', color: '#6366f1' }),
            h(Stat, { v: extra.essayPapers || 0, l: '申论套卷', color: '#8b5cf6' }),
            h(Stat, { v: extra.xingcePapers || 0, l: '行测套卷', color: '#0ea5e9' }),
            h(Stat, { v: (extra.essayCount || 0), l: '申论已练', color: '#10b981' }),
            h(Stat, { v: (extra.avgEssay || 0) + '%', l: '申论均分率', color: '#f59e0b' }),
            h(Stat, { v: (extra.examCount || 0), l: '模考场次', color: '#ef4444' }),
            h(Stat, { v: (extra.avgExam || 0) + '%', l: '模考均分率', color: '#14b8a6' }),
            h(Stat, { v: (stats.wrong && stats.wrong.open) || 0, l: '待消灭错题', color: '#dc2626' }))) : null)
    }

    /** 刷题视图：useState 在组件自身；父层 key 保证换题干净重挂载（R9 根治点） */
    /**
     * 刷题视图（v1.7 重写）：自管数据 + 完整判分反馈。
     * 修复：v1.6 提交后只 setTick 重挂载，用户看不到对错/解析（「刷题有问题」的根因）。
     * 现流程：选模块 → 抽题 → 作答 → 提交并**就地展示判分+解析** → 下一题。
     */
    export function NativePracticeView({ api, onGoWrongbook, initialModule = '' }) {
      const MODULES = ['判断推理', '言语理解与表达', '数量关系', '资料分析', '常识判断', '政治理论']
      const [module, setModule] = React.useState(initialModule || '')
      const [srs, setSrs] = React.useState(true)
      const [q, setQ] = React.useState(null)
      const [sel, setSel] = React.useState(null)
      const [result, setResult] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [stat, setStat] = React.useState({ done: 0, right: 0 })

      const queueRef = React.useRef([])   // 单一数据源：剩余题队列
      const [queueLen, setQueueLen] = React.useState(0)

      const takeNext = () => {
        const rest = queueRef.current.slice(1)
        queueRef.current = rest
        setQueueLen(rest.length)
        setQ(rest[0] || null)
        setSel(null)
        setResult(null)
      }

      const draw = React.useCallback(async (mod, useSrs) => {
        // 队列还有题 → 直接取下一题（不重复请求）
        if (queueRef.current.length > 1) { takeNext(); return }
        const data = await api('/questions?module=' + encodeURIComponent(mod || '判断推理') + '&count=6' + (useSrs ? '&sort=srs' : ''))
        const list = data.questions || []
        if (!list.length) { queueRef.current = []; setQueueLen(0); setQ(null); return }
        queueRef.current = list
        setQueueLen(list.length - 1)
        setQ(list[0])
        setSel(null)
        setResult(null)
      }, [api])

      // v1.7.1：从专题入口带 initialModule 进来时自动抽题（无需再点模块）
      const bootRef = React.useRef(false)
      React.useEffect(() => {
        if (bootRef.current || !initialModule) return
        bootRef.current = true
        draw(initialModule, true)
      }, [initialModule, draw])

      const submit = async () => {
        if (!q || !sel || busy) return
        setBusy(true)
        try {
          const r = await api('/check', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q, answer: sel }),
          })
          setResult(r)
          setStat(st => ({ done: st.done + 1, right: st.right + (r.isCorrect ? 1 : 0) }))
        } finally { setBusy(false) }
      }

      // 模块选择面板
      if (!module) {
        return h('div', {},
          h(Card, { title: '✏️ 选择练习模块' },
            h('div', { style: { display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' } },
              h('button', { style: { ...KV_BTN, ...(srs ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }, onClick: () => setSrs(true) }, '🧠 SRS 智能（错题回炉优先）'),
              h('button', { style: { ...KV_BTN, ...(!srs ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }, onClick: () => setSrs(false) }, '🎲 随机抽题')),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 } },
              MODULES.map(m2 => h('div', {
                key: m2, style: { border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 14, cursor: 'pointer', textAlign: 'center' },
                onClick: () => { setModule(m2); queueRef.current = []; setQueueLen(0); draw(m2, srs) },
              },
                h('div', { style: { fontWeight: 800, fontSize: 13.5 } }, m2),
                h('div', { style: { fontSize: 11, color: '#64748b', marginTop: 4 } }, '点击开始'))))),
          stat.done > 0 ? h(Card, { title: '本次练习' },
            h('div', { style: { fontSize: 13 } }, '已答 ' + stat.done + ' 题 · 正确 ' + stat.right + ' 题 · 正确率 ' + Math.round(stat.right / stat.done * 100) + '%')) : null)
      }

      // 题目为空
      if (!q) {
        return h('div', {},
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } },
            h('button', { style: KV_BTN, onClick: () => setModule('') }, '← 换模块')),
          h('div', { className: 'kg-load', style: { padding: 40 } }, '该模块暂无题目，试试其他模块'))
      }

      const answered = !!result
      const correct = answered && result.isCorrect
      return h('div', { style: { maxWidth: 780 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' } },
          h('button', { style: KV_BTN, onClick: () => setModule('') }, '← 模块'),
          h('span', { style: KV_TAG }, q.module || module),
          q.type ? h('span', { style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, q.type) : null,
          q.fromWrongBook ? h('span', { style: { ...KV_TAG, background: 'rgba(239,68,68,.12)', color: '#ef4444' } }, '📕 错题回炉·箱' + q.box) : null,
          h('span', { style: { marginLeft: 'auto', fontSize: 11.5, color: '#64748b' } }, '本次 ' + stat.done + ' 题 · 对 ' + stat.right),
          h('span', { style: { fontSize: 11.5, color: '#94a3b8' } }, '队列 ' + (queueLen + 1))),
        h(Card, null, h(RichText, { text: q.stem, fontSize: 14.5, maxHeight: '34vh' })),
        entries(q.options || {}).map(([L, text]) => h(OptionRow, {
          key: L, label: L, text,
          state: !answered ? (L === sel ? 'chosen' : 'idle') : (L === q.correctAnswer ? 'right' : (L === sel ? 'wrong' : 'idle')),
          disabled: answered,
          onClick: () => setSel(L),
        })),
        !answered ? (sel ? h('button', {
          className: 'kg-navbtn on', disabled: busy,
          style: { marginTop: 6, padding: '9px 22px', borderRadius: 10 },
          onClick: submit,
        }, busy ? '判分中…' : '✅ 提交判分') : h('div', { style: { fontSize: 11.5, color: '#94a3b8', marginTop: 6 } }, '选择一个选项后提交')) : null,
        // 判分反馈（v1.7 新增：这是此前缺失的关键环节）
        answered ? h(Card, { title: correct ? '✅ 回答正确' : '❌ 回答错误' },
          h('div', { style: { display: 'flex', gap: 10, marginBottom: 10, fontSize: 12.5, flexWrap: 'wrap' } },
            h('span', { style: { color: correct ? '#10b981' : '#ef4444', fontWeight: 700 } }, '你的答案 ' + sel),
            h('span', { style: { color: '#10b981', fontWeight: 700 } }, '正确答案 ' + q.correctAnswer),
            result.wrongEvent ? h('span', { style: { ...KV_TAG, background: 'rgba(99,102,241,.12)', color: '#6366f1' } },
              result.wrongEvent.type === 'mastered' ? '🎉 错题已掌握' : result.wrongEvent.type === 'promoted' ? '⬆ 升箱至 ' + result.wrongEvent.box : '📕 已入错题本') : null),
          q.analysis ? h('div', { style: { marginTop: 8 } },
            h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 6 } }, '📖 解析'),
            h(RichText, { text: q.analysis, maxHeight: 260 })) : h('div', { style: { fontSize: 12, color: '#64748b' } }, '该题无解析'),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 14 } },
            h('button', { style: { ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 18px' }, onClick: () => draw(module, srs) }, '下一题 →'),
            h('button', { style: KV_BTN, onClick: () => { setSel(null); setResult(null) } }, '重答本题'),
            onGoWrongbook ? h('button', { style: KV_BTN, onClick: onGoWrongbook }, '去错题本') : null)) : null)
    }

    export function NativeWrongbookView(props) {
      const { wrong, summary } = props.data
      const tagStyle = { background: '#eef2ff', color: '#4338ca', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }
      return h('div', {},
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 14 } },
          h(Stat, { v: summary.open, l: '🔥 待消灭', color: '#ef4444' }),
          h(Stat, { v: summary.mastered, l: '✅ 已掌握', color: '#10b981' })),
        !wrong.length && h('div', { style: { textAlign: 'center', padding: 40, color: '#64748b' } }, '🎉 错题本空空如也 — 保持！'),
        wrong.map(w => h('div', { key: w.sig, style: { border: '1.5px solid rgba(148,163,184,.3)', borderRadius: 12, padding: '13px 15px', marginBottom: 9, background: 'var(--surface-card,#fff)', opacity: w.mastered ? .6 : 1 } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' } },
            h('span', { style: tagStyle }, w.module),
            h('span', { style: tagStyle }, '错' + w.wrongCount + '次'),
            h('span', { title: 'SRS 箱位 ' + w.box + '/5', style: { display: 'inline-flex', gap: 3 } }, Array.from({ length: 5 }, (_, i) => h('i', { key: i, style: { width: 7, height: 7, borderRadius: '50%', background: i < w.box ? (w.mastered ? '#10b981' : '#6366f1') : 'rgba(148,163,184,.3)' } }))),
            w.mastered ? h('span', { style: { color: '#10b981', fontSize: 11, fontWeight: 700 } }, '已掌握') : null),
          h('div', { style: { fontSize: 12.5, lineHeight: 1.65, maxHeight: 66, overflow: 'hidden' } }, w.stem))))
    }
    /**
     * 图形推理专项视图（T-023 完整版 · 整合 gk-tuxing 354 题）
     * 每题含：题干图（354 张本地图）/ 规律分类 / 参考答案 / 原创解题思路 / 分析 / 陷阱
     * 交互：选规律 → 看图作答（A-D）→ 对答案 + 读思路 → 下一题
     */
    export function NativeTuxingView({ api }) {
      const [cats, setCats] = React.useState(null)
      const [cat, setCat] = React.useState('')
      const [list, setList] = React.useState(null)
      const [idx, setIdx] = React.useState(0)
      const [sel, setSel] = React.useState('')
      const [revealed, setRevealed] = React.useState(false)
      const [stat, setStat] = React.useState({ done: 0, right: 0 })
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        api('/tuxing/cats').then((d: any) => setCats(d)).catch(() => setCats({ ready: false, cats: [] }))
      }, [api])

      const load = React.useCallback(async (c: string) => {
        setBusy(true)
        try {
          const d = await api('/tuxing/list?limit=20' + (c ? '&cat=' + encodeURIComponent(c) : ''))
          setList(d)
          setIdx(0)
          setSel('')
          setRevealed(false)
        } finally { setBusy(false) }
      }, [api])

      const q = list && list.questions ? list.questions[idx] : null

      if (!cats) return h('div', { className: 'kg-load' }, h('div', { className: 'kg-spin' }), '加载图形推理题库…')

      if (!cats.ready) {
        return h(Card, { title: '🔷 图形推理专项' },
          h('div', { style: { fontSize: 13, color: '#f59e0b' } }, '⚠️ gk-tuxing 数据不可用（assets/data.js 缺失）'),
          h('div', { style: { fontSize: 12, color: '#64748b', marginTop: 8 } }, '回落方案：用「🧠 深度题库 → 图形推理专项」或「✏️ 刷题」。'))
      }

      // ── 分类选择页 ──
      if (!list) {
        return h('div', {},
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 14 } },
            h(Stat, { v: cats.total, l: '图形推理真题', color: '#6366f1' }),
            h(Stat, { v: cats.cats.length, l: '规律类型', color: '#8b5cf6' }),
            h(Stat, { v: '13 类', l: '按规律分类', color: '#10b981' })),
          h(Card, { title: '🔷 选择规律类型（按题量排序）' },
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 } },
              h('button', {
                style: { ...KV_BTN, ...(cat === '' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
                onClick: () => { setCat(''); load('') },
              }, '全部 ' + cats.total)),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 } },
              cats.cats.map((c: any) => h('div', {
                key: c.cat,
                style: { border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 14, cursor: 'pointer', textAlign: 'center' },
                onClick: () => { setCat(c.cat); load(c.cat) },
              },
                h('div', { style: { fontWeight: 800, fontSize: 14 } }, c.name),
                h('div', { style: { fontSize: 11, color: '#64748b', marginTop: 4 } }, c.count + ' 题'))))),
            h('div', { style: { fontSize: 11, color: '#94a3b8' } }, busy ? '加载中…' : '点击规律类型开始专项练习'))
      }

      // ── 答题页 ──
      const total = list.total || 0
      const pct = stat.done ? Math.round(stat.right / stat.done * 100) : 0

      const header = h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' } },
        h('button', { style: KV_BTN, onClick: () => { setList(null); setSel(''); setRevealed(false) } }, '← 换规律'),
        h('span', { style: KV_TAG }, q.catName),
        q.src ? h('span', { style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, q.src) : null,
        h('span', { style: { fontSize: 11.5, color: '#64748b' } }, (idx + 1) + ' / ' + total),
        h('span', { style: { marginLeft: 'auto', fontSize: 11.5, color: '#64748b' } }, '本次 ' + stat.done + ' 题 · 对 ' + stat.right + (stat.done ? ' · ' + pct + '%' : '')))

      // 选项（图片题：选项文字在题干图内，这里只给 A/B/C/D 按钮）
      const optRows = ['A', 'B', 'C', 'D'].map((L) => {
        const isRight = revealed && L === q.ans
        const isWrong = revealed && L === sel && L !== q.ans
        const chosen = !revealed && L === sel
        const border = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.3)'
        const bg = isRight ? 'rgba(16,185,129,.09)' : isWrong ? 'rgba(239,68,68,.08)' : chosen ? 'rgba(99,102,241,.08)' : 'transparent'
        const badge = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.15)'
        return h('div', {
          key: L,
          style: { width: 54, height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid ' + border, background: bg, borderRadius: 12, cursor: revealed ? 'default' : 'pointer', fontWeight: 800, fontSize: 18, color: isRight || isWrong || chosen ? '#fff' : 'inherit' },
          onClick: () => { if (!revealed) setSel(L) },
        }, h('span', { style: { background: badge, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, color: isRight || isWrong || chosen ? '#fff' : 'inherit' } }, L))
      })

      // 解析区（答案 + 思路 + 分析 + 陷阱）
      const dims = []
      if (revealed) {
        dims.push(h('div', { key: 'ans', style: { marginBottom: 10, padding: 12, background: q.ans === sel ? 'rgba(16,185,129,.08)' : 'rgba(239,68,68,.06)', borderRadius: 10 } },
          h('div', { style: { fontWeight: 700, fontSize: 13, marginBottom: 4, color: q.ans === sel ? '#10b981' : '#ef4444' } },
            q.ans === sel ? '✅ 回答正确' : '❌ 回答错误（你选 ' + (sel || '—') + '）'),
          h('div', { style: { fontSize: 12.5 } }, '正确答案：' + q.ans + (q.fmt ? ' · ' + q.fmt : ''))))
        if (q.exp) dims.push(h('div', { key: 'exp', style: { marginBottom: 10, padding: 12, background: 'rgba(14,165,233,.06)', borderRadius: 10, borderLeft: '3px solid #0ea5e9' } },
          h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#0ea5e9' } }, '🧠 解题思路（本站原创）'),
          h(RichText, { text: q.exp })))
        if (q.acc) dims.push(h('div', { key: 'acc', style: { marginBottom: 10, padding: 12, background: 'rgba(139,92,246,.06)', borderRadius: 10, borderLeft: '3px solid #8b5cf6' } },
          h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#8b5cf6' } }, '🔍 图形分析'),
          h(RichText, { text: q.acc })))
        if (q.trap) dims.push(h('div', { key: 'trap', style: { padding: 12, background: 'rgba(245,158,11,.08)', borderRadius: 10, borderLeft: '3px solid #f59e0b' } },
          h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#f59e0b' } }, '⚠️ 易错陷阱'),
          h(RichText, { text: q.trap })))
      }

      const actionRow = revealed
        ? h('div', { style: { display: 'flex', gap: 8, marginTop: 14 } },
            h('button', { style: { ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 20px' }, onClick: () => { if (idx < (list.questions.length - 1)) { setIdx(idx + 1); setSel(''); setRevealed(false) } else { load(cat) } } }, idx < (list.questions.length - 1) ? '下一题 →' : '再来一组 →'),
            h('button', { style: KV_BTN, onClick: () => { setSel(''); setRevealed(false) } }, '重做本题'))
        : h('div', { style: { fontSize: 11.5, color: '#94a3b8', marginTop: 10 } }, sel ? '' : '先选一个答案')

      return h('div', {},
        header,
        h(Card, { title: '第 ' + q.no + ' 题 · ' + q.catName },
          h('img', {
            src: q.imgUrl, alt: '图形推理题',
            style: { maxWidth: '100%', maxHeight: 340, display: 'block', margin: '6px 0 14px', borderRadius: 10, border: '1px solid rgba(148,163,184,.25)', background: '#fff' },
          }),
          h('div', { style: { display: 'flex', gap: 10, marginBottom: 6 } }, optRows),
          !revealed && sel ? h('button', {
            style: { ...KV_BTN, marginTop: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 20px' },
            onClick: () => { setRevealed(true); setStat((st2: any) => ({ done: st2.done + 1, right: st2.right + (sel === q.ans ? 1 : 0) })) },
          }, '提交并看思路') : actionRow),
        dims.length ? h('div', { style: { marginTop: 14 } }, dims) : null)
    }

    /**
     * 深度题库视图（GongkaoNaoku）：27506 题五维标注
     * kadian(考什么) / reasoning(怎么推) / fastest(最快解法) / pitfalls(易错) / mother(母题)
     */
    export function NativeDeepBankView({ api, initialModule = '', initialCategory = '' }) {
      const [status, setStatus] = React.useState(null)
      const [module, setModule] = React.useState(initialModule || '')
      const [q, setQ] = React.useState(null)
      const [sel, setSel] = React.useState(null)
      const [revealed, setRevealed] = React.useState(false)
      const [kw, setKw] = React.useState('')
      const [kadians, setKadians] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      // T-023：图形推理专项（按规律类型细分，gk-tuxing 卷库的归类思路）
      const [tuxing, setTuxing] = React.useState(null)
      const loadTuxing = () => {
        if (tuxing) return
        api('/naoku/kadian?q=' + encodeURIComponent('图形推理') + '&limit=40')
          .then((d: any) => {
            const list = (d.list || []).filter((x: any) => String(x.kadian).includes('规律'))
            setTuxing(list.slice(0, 12))
          })
          .catch(() => setTuxing([]))
      }

      React.useEffect(() => { api('/naoku/status').then(setStatus).catch(() => setStatus({ ready: false })) }, [api])

      const draw = React.useCallback(async (mod) => {
        setBusy(true)
        try {
          const qs = 'count=1'
            + (mod ? '&module=' + encodeURIComponent(mod) : '')
            + (initialCategory && !mod ? '&category=' + encodeURIComponent(initialCategory) : '')
          const d = await api('/naoku/questions?' + qs)
          setQ((d.questions || [])[0] || null)
          setSel(null)
          setRevealed(false)
        } finally { setBusy(false) }
      }, [api, initialCategory])

      // 从专题入口带 module/category 进来时自动抽题
      const bootRef = React.useRef(false)
      React.useEffect(() => {
        if (bootRef.current) return
        if (!initialModule && !initialCategory) return
        bootRef.current = true
        draw(initialModule)
      }, [initialModule, initialCategory, draw])

      const searchK = async () => {
        if (!kw.trim()) return
        const d = await api('/naoku/kadian?q=' + encodeURIComponent(kw.trim()) + '&limit=20')
        setKadians(d.list || [])
      }

      const drawByKadian = async (k) => {
        const d = await api('/naoku/practice?kadian=' + encodeURIComponent(k) + '&count=1')
        setQ((d.questions || [])[0] || null)
        setSel(null)
        setRevealed(false)
        setKadians([])
      }

      // ── 未就绪 ──
      if (status && !status.ready) {
        return h(Card, { title: '📚 深度题库' },
          h('div', { style: { fontSize: 13, color: '#f59e0b' } }, '⚠️ ' + (status.hint || '深度题库不可用')),
          h('div', { style: { fontSize: 12, color: '#64748b', marginTop: 8 } },
            '需要 Node ≥ 22.19（内置 node:sqlite）且 GongkaoNaoku 分片存在。回落方案：用「✏️ 刷题」或「📚 真题卷」。'))
      }

      const st = status && status.stats

      const statsRow = st
        ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 } },
            h(Stat, { v: st.total, l: '深度标注题', color: '#6366f1' }),
            h(Stat, { v: st.kadianCoverage + '%', l: '知识点覆盖', color: '#10b981' }),
            h(Stat, { v: st.fastestCoverage + '%', l: '速解覆盖', color: '#f59e0b' }),
            h(Stat, { v: st.withImage, l: '含图题', color: '#8b5cf6' }))
        : null

      const kadiansBlock = kadians.length > 0
        ? h('div', { style: { maxHeight: 260, overflowY: 'auto' } },
            kadians.map((k, i) => h('div', {
              key: i,
              style: { padding: '8px 10px', borderRadius: 9, marginBottom: 4, background: 'rgba(148,163,184,.06)', cursor: 'pointer', fontSize: 12.5 },
              onClick: () => drawByKadian(k.kadian),
            },
              h('div', { style: { display: 'flex', gap: 6, marginBottom: 3, flexWrap: 'wrap' } },
                h('span', { style: KV_TAG }, k.module || ''),
                k.category ? h('span', { style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, k.category) : null,
                h('span', { style: { fontSize: 10.5, color: '#64748b' } }, k.count + ' 题')),
              h('div', null, k.kadian))))
        : null

      // T-023 图形推理专项卡（懒加载规律分类）
      const tuxingCard = h(Card, { title: '🔷 图形推理专项（按规律类型）' },
        h('div', { style: { fontSize: 11, color: '#64748b', marginBottom: 10 } },
          '图形推理是行测最大失分模块。下面按「数量规律 / 位置规律 / 样式规律 / 属性规律」分类，点即刷该规律。'),
        !tuxing ? h('button', { style: KV_BTN, onClick: loadTuxing }, '展开规律分类') : null,
        tuxing && tuxing.length === 0 ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '暂无规律分类数据') : null,
        tuxing ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          tuxing.map((t2: any, i: number) => h('button', {
            key: i,
            style: { ...KV_BTN, fontSize: 11, textAlign: 'left', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            title: t2.kadian,
            onClick: () => { setModule('判断推理'); drawByKadian(t2.kadian) },
          }, String(t2.kadian).replace('图形推理 / ', '') + '（' + t2.count + '）'))) : null)

      const searchCard = h(Card, { title: '🔍 知识点检索（考点 → 解题思路）' },
        h('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
          h('input', {
            value: kw,
            onChange: e => setKw(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter') searchK() },
            placeholder: '输入考点关键词，如「图形推理」「模态命题」「增长率」',
            style: { flex: 1, padding: '8px 12px', borderRadius: 9, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' },
          }),
          h('button', { style: { ...KV_BTN, padding: '8px 16px' }, onClick: searchK }, '搜索')),
        kadiansBlock)

      // 题目区（分块构造，避免深嵌套三元）
      let questionCard = null
      if (q) {
        const headerTags: any[] = []
        if (q.module) headerTags.push(h('span', { key: 'm', style: KV_TAG }, q.module))
        if (q.type) headerTags.push(h('span', { key: 't', style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, q.type))
        if (q.year) headerTags.push(h('span', { key: 'y', style: KV_TAG }, q.year))
        if (q.region) headerTags.push(h('span', { key: 'r', style: KV_TAG }, q.region))

        const optRows = entries(q.options || {}).map(([L, txt]) => {
          const isRight = revealed && L === q.correctAnswer
          const isWrong = revealed && L === sel && L !== q.correctAnswer
          const chosen = !revealed && L === sel
          const border = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.3)'
          const bg = isRight ? 'rgba(16,185,129,.09)' : isWrong ? 'rgba(239,68,68,.08)' : chosen ? 'rgba(99,102,241,.08)' : 'transparent'
          const badge = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.15)'
          const badgeColor = (isRight || isWrong || chosen) ? '#fff' : 'inherit'
          return h('div', {
            key: L,
            style: { display: 'flex', gap: 10, padding: '10px 12px', border: '2px solid ' + border, background: bg, borderRadius: 10, marginTop: 8, cursor: revealed ? 'default' : 'pointer', fontSize: 13, lineHeight: 1.6 },
            onClick: () => { if (!revealed) setSel(L) },
          },
            h('div', { style: { width: 24, height: 24, borderRadius: '50%', background: badge, color: badgeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 } }, L),
            h('div', { style: { flex: 1 } }, txt))
        })

        const actionBtn = revealed
          ? h('button', { style: { ...KV_BTN, padding: '7px 18px' }, onClick: () => draw(module) }, '下一题 →')
          : h('button', { style: { ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '7px 18px' }, disabled: !sel, onClick: () => setRevealed(true) }, '查看答案与解题链')

        // 五维标注
        const dims: any[] = []
        if (revealed) {
          if (q.analysis) dims.push(h('div', { key: 'an', style: { marginBottom: 10, padding: 12, background: 'rgba(148,163,184,.07)', borderRadius: 10 } },
            h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5 } }, '📖 解析'), h(RichText, { text: q.analysis })))
          if (q.kadian) dims.push(h('div', { key: 'kd', style: { marginBottom: 10, padding: 12, background: 'rgba(99,102,241,.07)', borderRadius: 10, borderLeft: '3px solid #6366f1' } },
            h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#6366f1' } }, '🎯 考点定位'), h(RichText, { text: q.kadian })))
          if (q.reasoning) dims.push(h('div', { key: 'rs', style: { marginBottom: 10, padding: 12, background: 'rgba(14,165,233,.07)', borderRadius: 10, borderLeft: '3px solid #0ea5e9' } },
            h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#0ea5e9' } }, '🧠 解题推理链'), h(RichText, { text: q.reasoning })))
          if (q.fastest) dims.push(h('div', { key: 'fs', style: { marginBottom: 10, padding: 12, background: 'rgba(245,158,11,.08)', borderRadius: 10, borderLeft: '3px solid #f59e0b' } },
            h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#f59e0b' } }, '⚡ 最快解法（考场用）'), h(RichText, { text: q.fastest })))
          if (q.pitfalls) dims.push(h('div', { key: 'pf', style: { marginBottom: 10, padding: 12, background: 'rgba(239,68,68,.07)', borderRadius: 10, borderLeft: '3px solid #ef4444' } },
            h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#ef4444' } }, '⚠️ 易错点'), h(RichText, { text: q.pitfalls })))
          if (q.mother) dims.push(h('div', { key: 'mo', style: { padding: 12, background: 'rgba(139,92,246,.07)', borderRadius: 10, borderLeft: '3px solid #8b5cf6' } },
            h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#8b5cf6' } }, '🧩 母题思维'), h(RichText, { text: q.mother })))
        }

        questionCard = h('div', {},
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } }, headerTags),
          h(RichText, { text: q.stem, fontSize: 13.5, maxHeight: '30vh' }),
          optRows,
          h('div', { style: { display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' } }, actionBtn),
          revealed ? null : h('div', { style: { fontSize: 11.5, color: '#94a3b8', marginTop: 6 } }, '答完可查看「考点定位 / 推理链 / 最快解法 / 易错点 / 母题」五维标注'),
          dims.length > 0 ? h('div', { style: { marginTop: 14 } }, dims) : null)
      }

      const moduleBtns = ['判断推理', '言语理解与表达', '数量关系', '资料分析', '常识判断'].map(m2 =>
        h('button', {
          key: m2,
          style: { ...KV_BTN, ...(module === m2 ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
          onClick: () => { setModule(m2); draw(m2) },
        }, m2))

      return h('div', {},
        statsRow,
        searchCard,
        tuxingCard,
        h(Card, { title: '🎯 深度刷题（带解题思维链）' },
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' } }, moduleBtns),
          busy ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '抽题中…') : null,
          questionCard))
    }