/**
 * study-view.ts — 学习类视图族（cycle-13 T-025 从 client.ts 拆出）
 * 仪表盘 / 刷题 / 错题本 / 图形推理 / 深度题库。
 * cycle-13 对话窗口瘦身：会话练题控件已整体删除，
 * 练题流程收敛到左栏「考公学习」面板（对话窗口回归纯对话）。
 */

import { h, React, entries, Stat, Bar, Card, RichText, KV_TAG, KV_BTN, OptionRow, SourceBadge } from './ui-kit.js'

/* ════════════ cycle-15 专项刷题记忆（/api/memory · 按工作区命名空间隔离）════════════
   三端同步契约：manifest 声明 /api/memory → server/srs.js memoryApi 实现 → 本视图族消费。
   语义：进入专项视图时读「上次练到 xx 的 xx 题」，翻题/换题时静默回写；
   恢复 = 一键把该视图恢复到上次的模块 + 原题对象（题目整对象入记忆，保证「跳回原题」）。 */

/** 相对时间文案（确定性：同输入同输出；无效/未来时间戳回退为空 → 横幅自动隐藏该段） */
function kgMemAgo(ts: any): string {
  const t = Number(ts)
  if (!isFinite(t) || t <= 0) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}

/** 记忆钩子：GET /api/memory 载入指定 kind + save() 静默 POST 回写。
 *  字段全部可选降级：端点未就绪/网络失败一律 loaded=true + data=null（不阻塞视图）；
 *  save 永不抛错（学习路径不因记忆失败中断）。hook 数恒定：useState×2 + useEffect×1 + useCallback×1。 */
function useKgMem(api: any, kind: string) {
  const [data, setData] = React.useState(null)
  const [loaded, setLoaded] = React.useState(false)
  React.useEffect(() => {
    let dead = false
    setLoaded(false)
    try {
      Promise.resolve(api('/memory')).then((d: any) => {
        if (dead) return
        const m = d && d.memory && d.memory[kind]
        setData(m && typeof m === 'object' ? m : null)
        setLoaded(true)
      }).catch(() => { if (!dead) setLoaded(true) })
    } catch { if (!dead) setLoaded(true) }
    return () => { dead = true }
  }, [api, kind])
  const save = React.useCallback((patch: any) => {
    try {
      Promise.resolve(api('/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, data: patch }),
      })).catch(() => {})
    } catch { /* 记忆失败静默 */ }
  }, [api, kind])
  return { data, loaded, save }
}

/** 记忆恢复横幅（无 hook 纯组件）：渐变玻璃条 + 「上次练到 …」+ 相对时间 + 继续跳回/从头开始。
 *  data 为空或调用方判定不展示时返回 null（卡片级降级，绝不 role="alert"）。 */
function KgMemBanner(props: any) {
  const d = props && props.data
  if (!d) return null
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      marginBottom: 12, padding: '9px 13px', borderRadius: 12,
      background: 'linear-gradient(135deg,rgba(99,102,241,.10),rgba(139,92,246,.08))',
      border: '1px solid rgba(99,102,241,.28)',
    },
  },
    h('span', { style: { fontSize: 12.5, fontWeight: 700, color: '#4f46e5' } }, '💾 ' + String(props.text || '上次练到这里')),
    d.at ? h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, kgMemAgo(d.at)) : null,
    h('button', {
      style: { marginLeft: 'auto', border: 0, cursor: 'pointer', fontFamily: 'inherit', padding: '6px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' },
      onClick: props.onResume,
    }, '▶ 继续上次'),
    h('button', {
      style: { border: '1px solid rgba(148,163,184,.4)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', padding: '6px 12px', borderRadius: 9, fontSize: 12, color: '#64748b' },
      onClick: props.onDismiss,
    }, '从头开始'))
}

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
      // cycle-15：专项刷题记忆（上次练到 xx 的 xx 题；hook 数恒定，R9）
      const { data: memData, loaded: memLoaded, save: memSave } = useKgMem(api, 'practice')
      const [memOff, setMemOff] = React.useState(false)
      const remember = (question: any, mod: any) => { if (question) memSave({ module: mod || module || '', question }) }

      const queueRef = React.useRef([])   // 单一数据源：剩余题队列
      const [queueLen, setQueueLen] = React.useState(0)

      const takeNext = () => {
        const rest = queueRef.current.slice(1)
        queueRef.current = rest
        setQueueLen(rest.length)
        setQ(rest[0] || null)
        setSel(null)
        setResult(null)
        remember(rest[0], module)   // cycle-15：翻题即记忆（写「上次练到」）
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
        remember(list[0], mod)   // cycle-15：抽题即记忆
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
          // cycle-15：记忆恢复横幅（带 initialModule 的专题直入不弹——显式意图优先）
          (!initialModule && memLoaded && memData && memData.question && !memOff)
            ? h(KgMemBanner, {
                key: 'kgmem-practice',
                data: memData,
                text: '上次练到「' + (memData.module || '未记录模块') + '」· ' + String((memData.question && memData.question.stem) || '').slice(0, 26) + '…',
                onResume: () => {
                  const mq = memData.question
                  setModule(memData.module || '判断推理')
                  queueRef.current = [mq]   // 恢复队列=只含上次那题，「下一题」走正常抽题
                  setQueueLen(0)
                  setQ(mq)
                  setSel(null)
                  setResult(null)
                },
                onDismiss: () => setMemOff(true),
              })
            : null,
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
      // cycle-21（issue #1 用户旅程）：上游数据形态限制——2728 道图形推理题的选项
      // 在数据源里就是纯字母 A/B/C/D（选项图未随上游收录）。选项为纯字母时：
      // · 题干带图 或 题型是图形推理 → 选项图缺失提示（图形推理选项必然是图，不依赖 stem 占位）
      // · 旧错题回炉（图片修复前入库，stem 已被旧解析剥图）→ 历史数据提示
      // cycle-22：选项占位计数——含 kgimg:// 的选项不算「纯字母」（选项配图已恢复，不再误报降级提示）
      const optsVals = entries(q.options || {}).map(([L, t]) => String(t || '').trim())
      const optImgCount = optsVals.filter(v => v.includes('kgimg://')).length
      const lettersOnly = optsVals.length >= 4 && optsVals.every(v => /^[A-D]$/.test(v))
      const stemHasImg = String(q.stem || '').includes('kgimg://')
      const isTuxingType = /图形推理/.test(String(q.type || '')) && lettersOnly
      const legacyNoImg = !stemHasImg && /上图|如图|统计图|所示/.test(String(q.stem || ''))
      return h('div', { style: { maxWidth: 780 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' } },
          h('button', { style: KV_BTN, onClick: () => setModule('') }, '← 模块'),
          h('span', { style: KV_TAG }, q.module || module),
          q.type ? h('span', { style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, q.type) : null,
          q.fromWrongBook ? h('span', { style: { ...KV_TAG, background: 'rgba(239,68,68,.12)', color: '#ef4444' } }, '📕 错题回炉·箱' + q.box) : null,
          h('span', { style: { marginLeft: 'auto', fontSize: 11.5, color: '#64748b' } }, '本次 ' + stat.done + ' 题 · 对 ' + stat.right),
          h('span', { style: { fontSize: 11.5, color: '#94a3b8' } }, '队列 ' + (queueLen + 1))),
        h(Card, null,
          // cycle-21：每题标明题库出处（xingcezhenti/naoku/SRS 回炉继承原出处）
          h(SourceBadge, { source: q.source, exam: q.exam, year: q.year, region: q.region, paperFile: q.paperFile,
            extra: q.fromWrongBook ? h('span', { style: { ...KV_TAG, background: 'rgba(239,68,68,.12)', color: '#ef4444' } }, '📕 错题回炉') : null }),
          h(RichText, { text: q.stem, fontSize: 14.5, maxHeight: '34vh' })),
        // cycle-21：上游数据缺选项图的诚实降级提示（2728 题图形推理选项在源数据=A/B/C/D 字母）
        // + 旧错题回炉的历史数据提示（修复前入库的 stem 已被旧解析剥图，无法凭空恢复）
        (lettersOnly && (stemHasImg || isTuxingType))
          ? h('div', { style: { fontSize: 11.5, color: '#b45309', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 9, padding: '7px 10px', marginTop: 8 } },
              optImgCount > 0
                ? 'ℹ 该题选项配图已在题库数据源中收录 ' + optImgCount + ' 个，其余选项为纯字母——请结合题干图与解析推理作答。'
                : 'ℹ 该题四个选项在题库数据源中为纯字母（选项配图未随上游收录）——请结合题干图与解析推理作答。')
          : null,
        legacyNoImg && !lettersOnly
          ? h('div', { style: { fontSize: 11.5, color: '#64748b', background: 'rgba(148,163,184,.08)', border: '1px dashed rgba(148,163,184,.3)', borderRadius: 9, padding: '7px 10px', marginTop: 8 } },
              'ℹ 该题引用了图表但题干未携带配图（修复前入库的历史错题，或原文即文字题）——可到「📚 真题卷」查看原卷完整配图。')
          : null,
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
            // cycle-21：错题条目也标出处（入库时快照的题库来源/卷名；旧数据无则不渲染）
            (w.source || w.exam) ? h('span', { style: { ...tagStyle, background: 'rgba(99,102,241,.1)', color: '#4338ca' } }, '📌 ' + [w.exam || w.paperFile, w.year].filter(Boolean).join(' · ') || w.module) : null,
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
      // cycle-15：图形推理记忆（规律类型 + 题号 + idx；hook 数恒定，R9）
      const { data: memData, loaded: memLoaded, save: memSave } = useKgMem(api, 'tuxing')
      const [memOff, setMemOff] = React.useState(false)

      React.useEffect(() => {
        api('/tuxing/cats').then((d: any) => setCats(d)).catch(() => setCats({ ready: false, cats: [] }))
      }, [api])

      const load = React.useCallback(async (c: string, resumeIdx?: number) => {
        setBusy(true)
        try {
          const d = await api('/tuxing/list?limit=20' + (c ? '&cat=' + encodeURIComponent(c) : ''))
          setList(d)
          // cycle-15：记忆恢复路径——按上次的 idx 落位（clamp 到列表长度内；非恢复路径 idx=0）
          const ri = Number(resumeIdx) > 0 ? Math.min(Math.floor(Number(resumeIdx)), ((d && d.questions) || []).length - 1) : 0
          setIdx(ri < 0 ? 0 : ri)
          setSel('')
          setRevealed(false)
        } finally { setBusy(false) }
      }, [api])

      // cycle-15：翻题即记忆（写「上次练到 xx 类 · 第 N 题」；save 稳定引用，不引发循环）
      React.useEffect(() => {
        const cur = list && list.questions ? list.questions[idx] : null
        if (cur) memSave({ cat, catName: cur.catName || '', no: cur.no || 0, idx })
      }, [idx, list, cat, memSave])

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
          // cycle-15：记忆恢复横幅（一键回到「上次的规律类型 · 上次的题」）
          (memLoaded && memData && memData.cat !== undefined && !memOff)
            ? h(KgMemBanner, {
                key: 'kgmem-tuxing',
                data: memData,
                text: '上次练到「' + (memData.catName || memData.cat || '未记录规律') + '」' + (memData.no ? ' · 第 ' + memData.no + ' 题' : ''),
                onResume: () => { setCat(memData.cat || ''); load(memData.cat || '', Number(memData.idx) || 0) },
                onDismiss: () => setMemOff(true),
              })
            : null,
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
          // cycle-21：图形推理题出处（gk-tuxing + 上游原始出处 src）
          h(SourceBadge, { source: q.source || 'gk-tuxing', exam: q.src, paperFile: q.src ? String(q.src).replace(/\.md$/, '') : null }),
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
      // cycle-15：深度题库记忆（module + 原题对象整存，恢复即回到原题；hook 数恒定，R9）
      const { data: memData, loaded: memLoaded, save: memSave } = useKgMem(api, 'deep')
      const [memOff, setMemOff] = React.useState(false)
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
          const dq = (d.questions || [])[0] || null
          setQ(dq)
          setSel(null)
          setRevealed(false)
          if (dq) memSave({ module: mod || module || '', question: dq })   // cycle-15：抽题即记忆
        } finally { setBusy(false) }
      }, [api, initialCategory, memSave])

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
        const dq = (d.questions || [])[0] || null
        setQ(dq)
        setSel(null)
        setRevealed(false)
        setKadians([])
        if (dq) memSave({ module: module || '判断推理', question: dq })   // cycle-15：按考点抽题同样记忆
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
            // cycle-22：选项含图占位 → RichText 渲染出图（公式图/选项图不再剥掉）
            String(txt || '').includes('kgimg://') ? h('div', { style: { flex: 1, minWidth: 0 } }, h(RichText, { text: txt, fontSize: 13 })) : h('div', { style: { flex: 1 } }, txt))
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
          // cycle-21：深度题库题也标出处（naoku + 卷名/年份/考点）
          h(SourceBadge, { source: q.source || 'naoku', exam: q.exam, year: q.year, region: q.region,
            extra: q.kadian ? h('span', { style: { ...KV_TAG, background: 'rgba(99,102,241,.12)', color: '#6366f1' } }, '🎯 ' + String(q.kadian).slice(0, 18)) : null }),
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
        // cycle-21 H5（issue #3）：纸质补录四步旅程（搜索→核对→补录→批次撤销）
        h(KgHistoryImport, { api }),
        // cycle-15：记忆恢复横幅（未抽题时展示；恢复 = 直接回到上次的模块 + 原题）
        (!q && memLoaded && memData && memData.question && !memOff)
          ? h(KgMemBanner, {
              key: 'kgmem-deep',
              data: memData,
              text: '上次练到「' + (memData.module || '未记录模块') + '」· ' + String((memData.question && memData.question.stem) || '').slice(0, 26) + '…',
              onResume: () => { setModule(memData.module || ''); setQ(memData.question); setSel(null); setRevealed(false) },
              onDismiss: () => setMemOff(true),
            })
          : null,
        h(Card, { title: '🎯 深度刷题（带解题思维链）' },
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' } }, moduleBtns),
          busy ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '抽题中…') : null,
          questionCard))
    }

    /**
     * 纸质刷题记录补录（cycle-21 H5 · issue #3 第一阶段）
     * 四步旅程：① 题干关键词搜候选 → ② 展示题干/选项/来源供核对 →
     * ③ 补录 对/错/结果未知（可选书名页码/原始日期）→ ④ 批次撤销（环形 30）。
     * 纪律：历史补录不进「今日新刷」（服务端统计隔离）；重复补录=冲突提示；可整批撤销。
     */
    function KgHistoryImport({ api }) {
      const [kw, setHikw] = React.useState('')
      const [results, setHiResults] = React.useState(null)     // 搜索结果
      const [picks, setHiPicks] = React.useState({})           // sig → {question, result}
      const [srcNote, setHiSrc] = React.useState('')           // 书名/页码（可选）
      const [happenedAt, setHiDate] = React.useState('')       // 原始作答日期（可选）
      const [msg, setHiMsg] = React.useState(null)             // {ok, text}
      const [batches, setHiBatches] = React.useState(null)
      const [busy, setHiBusy] = React.useState(false)

      const loadBatches = React.useCallback(() => {
        api('/history/batches').then((d: any) => setHiBatches(d)).catch(() => setHiBatches(null))
      }, [api])
      React.useEffect(() => { loadBatches() }, [loadBatches])

      const doSearch = async () => {
        if (!kw.trim()) return
        setHiBusy(true)
        try {
          const d = await api('/history/search?q=' + encodeURIComponent(kw.trim()) + '&limit=12')
          setHiResults(d && d.list ? d : { list: [] })
          setHiPicks({})
        } catch (e: any) { setHiMsg({ ok: false, text: '搜索失败: ' + ((e && e.message) || e) }) }
        finally { setHiBusy(false) }
      }

      const pick = (item: any, result: string) => {
        setHiPicks((p: any) => {
          const next = Object.assign({}, p)
          if (result === 'none') delete next[item.contentSig]
          else next[item.contentSig] = { question: item, result, contentSig: item.contentSig }
          return next
        })
      }

      const submit = async () => {
        const list = Object.values(picks)
        if (!list.length) { setHiMsg({ ok: false, text: '先在候选里标记对/错' }); return }
        setHiBusy(true)
        try {
          const entries = list.map((x: any) => ({
            contentSig: x.contentSig, question: x.question, result: x.result,
            source: srcNote.trim() || null, happenedAt: happenedAt || null,
          }))
          const r = await api('/history/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries, source: srcNote.trim() || null }) })
          if (r && r.error) { setHiMsg({ ok: false, text: r.error }) }
          else {
            setHiMsg({ ok: true, text: '已补录 ' + r.accepted + ' 题（批次 ' + String(r.batchId || '').slice(0, 12) + '）'
              + (r.conflicts && r.conflicts.length ? ' · 冲突跳过 ' + r.conflicts.length + ' 题' : '')
              + (r.rejected && r.rejected.length ? ' · 无效 ' + r.rejected.length + ' 题' : '')
              + ' · 错题已进错题本（历史练习不计入今日新刷）' })
            setHiPicks({}); setHiResults(null); setHikw(''); setHiSrc(''); setHiDate('')
            loadBatches()
          }
        } catch (e: any) { setHiMsg({ ok: false, text: '补录失败: ' + ((e && e.message) || e) }) }
        finally { setHiBusy(false) }
      }

      const undoBatch = async (id: string) => {
        setHiBusy(true)
        try {
          const r = await api('/history/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: id }) })
          setHiMsg(r && r.error ? { ok: false, text: r.error } : { ok: true, text: '已撤销批次：移除 ' + (r.removedHistory || 0) + ' 条历史 + ' + (r.removedWrong || 0) + ' 条错题' })
          loadBatches()
        } catch (e: any) { setHiMsg({ ok: false, text: '撤销失败: ' + ((e && e.message) || e) }) }
        finally { setHiBusy(false) }
      }

      const pickList = Object.values(picks)
      return h(Card, { title: '📥 纸质刷题补录（把纸上的对错记进系统）' },
        h('div', { style: { fontSize: 11, color: '#64748b', marginBottom: 8 } },
          '① 输入题干关键词搜现有题库 → ② 核对候选（题干/选项/来源）→ ③ 标记 已做对/已做错/结果未知 → ④ 保存（错题自动进错题本，同批次可撤销）。原始日期未知可留空。'),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
          h('input', {
            value: kw, onChange: (e: any) => setHikw(e.target.value), onKeyDown: (e: any) => { if (e.key === 'Enter') doSearch() },
            placeholder: '题干关键词，如「林产品出口」「模态命题」',
            style: { flex: '1 1 260px', padding: '7px 11px', borderRadius: 9, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 12, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' } }),
          h('button', { style: { ...KV_BTN, padding: '7px 14px' }, onClick: doSearch, disabled: busy }, busy ? '…' : '🔍 搜索候选')),
        // ② 核对候选
        results ? h('div', { style: { marginBottom: 8 } },
          results.list && results.list.length
            ? results.list.map((it: any) => {
                const picked = picks[it.contentSig]
                const stemPlain = String(it.stem || '').slice(0, 110)
                return h('div', { key: it.contentSig, style: { border: '1.5px solid ' + (picked ? '#6366f1' : 'rgba(148,163,184,.25)'), borderRadius: 10, padding: '9px 11px', marginBottom: 6, background: picked ? 'rgba(99,102,241,.05)' : 'transparent' } },
                  h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 } },
                    h('span', { style: KV_TAG }, it.module || ''),
                    it.matchSource ? h('span', { style: { ...KV_TAG, fontSize: 9.5 } }, it.matchSource === 'naoku' ? '深度题库' : '真题库') : null,
                    it.year ? h('span', { style: { ...KV_TAG, fontSize: 9.5 } }, String(it.year)) : null,
                    picked ? h('span', { style: { ...KV_TAG, background: 'rgba(99,102,241,.12)', color: '#4338ca', fontSize: 9.5 } }, '已标记: ' + (picked.result === 'right' ? '做对' : picked.result === 'wrong' ? '做错' : '结果未知')) : null),
                  h('div', { style: { fontSize: 12, lineHeight: 1.6 } }, stemPlain + (String(it.stem || '').length > 110 ? '…' : '')),
                  h('div', { style: { display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' } },
                    h('button', { style: { ...KV_BTN, fontSize: 10.5, ...(picked && picked.result === 'right' ? { background: 'rgba(16,185,129,.14)', color: '#059669', borderColor: '#10b981' } : {}) }, onClick: () => pick(it, 'right') }, '✓ 已做对'),
                    h('button', { style: { ...KV_BTN, fontSize: 10.5, ...(picked && picked.result === 'wrong' ? { background: 'rgba(239,68,68,.14)', color: '#dc2626', borderColor: '#ef4444' } : {}) }, onClick: () => pick(it, 'wrong') }, '✗ 已做错'),
                    h('button', { style: { ...KV_BTN, fontSize: 10.5, ...(picked && picked.result === 'unknown' ? { background: 'rgba(245,158,11,.14)', color: '#b45309', borderColor: '#f59e0b' } : {}) }, onClick: () => pick(it, 'unknown') }, '? 结果未知')))
              })
            : h('div', { style: { fontSize: 12, color: '#94a3b8', padding: '10px 0' } }, '未找到含该关键词的题目——换个更短的关键词试试'))
          : null,
        // ③ 补录附加信息 + 提交
        pickList.length ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.18)' } },
          h('span', { style: { fontSize: 11.5, fontWeight: 700, color: '#4338ca' } }, '待补录 ' + pickList.length + ' 题'),
          h('input', { value: srcNote, onChange: (e: any) => setHiSrc(e.target.value), placeholder: '纸质来源（书名·页码，可选）', style: { flex: '1 1 180px', padding: '5px 9px', borderRadius: 8, border: '1px solid rgba(148,163,184,.3)', fontSize: 11, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' } }),
          h('input', { value: happenedAt, onChange: (e: any) => setHiDate(e.target.value), placeholder: '原始作答日期 YYYY-MM-DD（可选）', style: { flex: '1 1 180px', padding: '5px 9px', borderRadius: 8, border: '1px solid rgba(148,163,184,.3)', fontSize: 11, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' } }),
          h('button', { style: { ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, fontWeight: 700, padding: '6px 14px' }, onClick: submit, disabled: busy }, busy ? '保存中…' : '💾 保存补录'))
          : null,
        msg ? h('div', { style: { fontSize: 11.5, marginTop: 8, color: msg.ok ? '#059669' : '#dc2626' } }, (msg.ok ? '✓ ' : '⚠ ') + msg.text) : null,
        // ④ 批次台账 + 撤销
        batches && batches.importedTotal > 0
          ? h('div', { style: { marginTop: 10, borderTop: '1px dashed rgba(148,163,184,.2)', paddingTop: 8 } },
              h('div', { style: { fontSize: 11, color: '#64748b', marginBottom: 5 } }, '累计补录 ' + batches.importedTotal + ' 题 · 近 ' + (batches.batches || []).length + ' 批（可撤销窗口 30 批）'),
              (batches.batches || []).slice(0, 5).map((b: any) => h('div', { key: b.batchId, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 10.5, color: '#64748b', padding: '2px 0' } },
                h('span', { style: { fontFamily: 'monospace' } }, String(b.batchId).slice(0, 14)),
                h('span', null, b.count + ' 题'),
                b.source ? h('span', null, '· ' + String(b.source).slice(0, 24)) : null,
                h('button', { style: { ...KV_BTN, fontSize: 9.5, marginLeft: 'auto', color: '#dc2626', borderColor: 'rgba(239,68,68,.4)' }, onClick: () => undoBatch(b.batchId), disabled: busy }, '↩ 撤销此批'))))
          : null)
    }