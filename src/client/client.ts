/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/**
 * client/client.js — DSH Web GUI 双入口 · v1.5.1（combo 格式修复 R11）
 *
 * R11 事故（沙箱闭环取证）：宿主 Web 组合加载器要求 **combo factory 格式**
 * （window.__ModuleLoader__.load + require 取依赖）；裸 ESM `export` 直接
 * `SyntaxError: Unexpected token 'export'` → 插件条目不激活 → GUI 显示
 * "Failed to load plugins"。此前「注册成功」日志全部来自 Host 半，
 * Client 半从未真正加载。格式照实测参考 @wlv-zedd/dsh-chatgpt-web（无构建步骤）。
 *
 * R9 保留：子视图一律组件化挂载（直调含 hook 函数 → hook 漂移 → GUI 白屏）+ ErrorBoundary。
 * R6 保留：React 事件一律 onClick 驼峰。
 *
 * 席位契约：
 *  - 左栏 = sidebar.panellist register{id,order,label()}（svg 带 data-dsh-panel-entry）+ main keyed slot
 *  - 右侧 = sidebarRightTabs.register(定义) + sidebar.right.pane.tab keyed slot（双注册同 id）+ guide 函数式
 *  - 通道 = 同源 /kaogong/*（ctx.webServer 挂载，主）→ 独立端口（兜底）
 */
;(window as any).__ModuleLoader__.load({
  id: 'dsh-kaogong',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'dsh-kaogong'
    const TAB_KIND = 'kaogong'
    const MOUNT_PATH = '/kaogong'
    const PORTS = [8400, 8401, 8402, 8403, 8404]
    const APP_NAME = 'dsh-kaogong'

    let lastWsKey = 'default'

    const DICTS = {
      zh: { title: '考公学习', guideDesc: '离线题库 · 30天计划 · SRS错题本 · 知识图谱 · 可观测仪表盘（15个开源仓库）', loading: '正在连接学习服务…', down: '本地学习服务未运行', downHint: 'Host 插件加载时自动启动；若刚崩溃请执行热重载', openExternal: '↗ 浏览器标签', retry: '↻', probe: '项目', native: '宿主原生', fallback: 'iframe 兜底' },
      en: { title: 'Exam Study', guideDesc: 'Offline bank · 30-day plan · SRS wrong-book · knowledge graph · observability', loading: 'Connecting to study service…', down: 'Local study service not running', downHint: 'It starts when the Host plugin loads; hot-reload if it crashed', openExternal: '↗ Browser tab', retry: '↻', probe: 'project', native: 'native', fallback: 'iframe fallback' },
    }

    /* ── 无状态小组件（零 hook）── */
    function Stat(props) {
      return h('div', { style: { background: 'var(--surface-card,#fff)', borderRadius: 14, padding: '16px 8px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.07)', border: '1px solid rgba(148,163,184,.12)' } },
        h('div', { style: { fontSize: 24, fontWeight: 800, color: props.color || 'var(--text-primary,#0f172a)' } }, props.v),
        h('div', { style: { fontSize: 11.5, color: '#64748b', marginTop: 3 } }, props.l))
    }
    function Bar(props) {
      return h('div', { style: { height: 7, background: 'rgba(148,163,184,.25)', borderRadius: 4, overflow: 'hidden' } },
        h('i', { style: { display: 'block', height: '100%', width: Math.max(0, Math.min(100, props.pct)) + '%', background: props.color || 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: 4, transition: 'width .5s' } }))
    }
    function Card(props) {
      return h('div', { style: { background: 'var(--surface-card,#fff)', borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,.07)', border: '1px solid rgba(148,163,184,.12)' } },
        props.title && h('div', { style: { fontWeight: 700, fontSize: 13.5, marginBottom: 12 } }, props.title),
        props.children)
    }

    /**
     * 富文本渲染：把 markdown 图片引用 ![](url) 转为 <img>，其余按段落保留换行。
     * T-018：行测图形推理题必须看图才能作答（gwy-zhenti 内 11 万张本地图，走 /api/paper-img 服务）。
     */
    function RichText(props) {
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

    /* ── 子视图：真组件（R9：一律经 h(Comp, props) 挂载）── */
    function NativeDashboardView(props) {
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
    function NativePracticeView({ api, onGoWrongbook, initialModule = '' }) {
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

    function NativeWrongbookView(props) {
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

    function NativeGraphView(props) {
      const { metrics: M, health: H, rank } = props.data
      // T-020：考点掌握热力（"我"的薄弱点）
      const mastery = (props.stats && props.stats.mastery) || {}
      const mRows = entries(mastery)
        .map(([m, v]: any) => ({ m, answered: v.answered || 0, correct: v.correct || 0, rate: v.answered ? Math.round(v.correct / v.answered * 100) : 0 }))
        .filter((r: any) => r.answered > 0)
        .sort((a: any, b: any) => a.rate - b.rate)
      return h('div', {},
        h(Card, { title: '🔥 我的考点掌握（弱 → 强）' },
          mRows.length === 0
            ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '暂无作答数据 —— 去「刷题」或「模考」后再看')
            : mRows.map((r: any) => h('div', { key: r.m, style: { marginBottom: 9 } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 } },
                  h('span', null, r.m),
                  h('span', { style: { color: '#64748b' } }, r.correct + '/' + r.answered + ' · ' + r.rate + '%')),
                h(Bar, { pct: r.rate, color: r.rate >= 75 ? 'linear-gradient(135deg,#10b981,#34d399)' : r.rate >= 50 ? undefined : 'linear-gradient(135deg,#ef4444,#f87171)' })))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 14 } },
          h(Stat, { v: M.V, l: '节点 |V|', color: '#6366f1' }), h(Stat, { v: M.E, l: '边 |E|', color: '#8b5cf6' }),
          h(Stat, { v: M.density, l: '密度 ρ' }), h(Stat, { v: M.components, l: '连通分量' }),
          h(Stat, { v: M.orphans.length, l: '孤儿', color: M.orphans.length ? '#ef4444' : '#10b981' }),
          h(Stat, { v: H.total, l: '健康度', color: H.total >= 80 ? '#10b981' : '#f59e0b' })),
        h(Card, { title: '⭐ PageRank 中心节点 top8（幂迭代 d=0.85）' },
          rank.slice(0, 8).map(r => h('div', { key: r.id, style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 12 } },
            h('span', { style: { width: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' } }, r.id),
            h('div', { style: { flex: 1 } }, h(Bar, { pct: Math.min(100, r.pr * 4000) })),
            h('span', { style: { width: 62, textAlign: 'right', color: '#64748b' } }, r.pr.toFixed(4))))),
        h('div', { style: { fontSize: 11.5, color: '#64748b' } }, '💡 完整力导向交互图（拖拽/缩放/拾取）在独立 SPA 视图'))
    }

    function NativeObsView(props) {
      const { tel, caps } = props.data
      const consumed = new Set(Object.keys(tel.endpoints))
      // T-020：学习质量（个人视角）
      const ins = props.insight || {}
      const essayAvg = (ins.essay && ins.essay.avgRatio) || 0
      const examAvg = (ins.exam && ins.exam.avgRate) || 0
      const essayN = (ins.essay && ins.essay.total) || 0
      const examN = (ins.exam && ins.exam.total) || 0
      return h('div', {},
        h(Card, { title: '📈 我的学习质量' },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 } },
            h(Stat, { v: essayN ? essayAvg + '%' : '—', l: '申论均分率 · ' + essayN + ' 次', color: essayAvg >= 60 ? '#10b981' : '#f59e0b' }),
            h(Stat, { v: examN ? examAvg + '%' : '—', l: '模考均分率 · ' + examN + ' 场', color: examAvg >= 60 ? '#10b981' : '#f59e0b' }),
            h(Stat, { v: (ins.essay && ins.essay.recent && ins.essay.recent.length) || 0, l: '近期申论记录' }),
            h(Stat, { v: (ins.exam && ins.exam.recent && ins.exam.recent.length) || 0, l: '近期模考记录' }))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 14 } },
          h(Stat, { v: tel.uptimeSec + 's', l: '运行时长' }), h(Stat, { v: tel.totalRequests, l: '总请求' }),
          h(Stat, { v: tel.qpsWindow, l: 'QPS(60s)' }), h(Stat, { v: (tel.coverage * 100).toFixed(0) + '%', l: '端点覆盖', color: tel.coverage > .7 ? '#10b981' : '#f59e0b' })),
        h(Card, { title: '🧩 能力矩阵（注册→生产→消费 实时对账）' },
          caps.endpoints.map(e => h('div', { key: e.path, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(148,163,184,.15)', fontSize: 12 } },
            h('span', { style: { flex: 1, fontFamily: 'monospace', fontSize: 11 } }, e.path),
            h('span', { style: { color: '#64748b', fontSize: 11 } }, (e.consumers || []).length + ' 消费者'),
            h('span', { style: { background: consumed.has(e.path) ? 'rgba(16,185,129,.15)' : 'rgba(148,163,184,.15)', color: consumed.has(e.path) ? '#10b981' : '#64748b', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 } }, consumed.has(e.path) ? '活跃' : '未触达')))))
    }

    /* ══ v1.6 新增：真题卷 / 专题 / 申论评改（全部宿主原生渲染，组件自管数据）══ */

    const KV_TAG = { background: '#eef2ff', color: '#4338ca', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }
    const KV_BTN = { border: '1px solid rgba(148,163,184,.35)', background: 'transparent', color: 'var(--text-muted,#64748b)', borderRadius: 8, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }
    const KV_TH = { fontWeight: 700, fontSize: 13.5, marginBottom: 12 }

    /**
     * R14：复杂度治理辅助——把「选项渲染 / 标注块 / 标签行」三处高频重复
     * 从各视图内联三元中提出来，既降分支密度也让样式口径统一。
     */
    function optionStyle(state) {
      // state: 'idle' | 'chosen' | 'right' | 'wrong'
      if (state === 'right') return { border: '#10b981', bg: 'rgba(16,185,129,.09)', badge: '#10b981', color: '#fff' }
      if (state === 'wrong') return { border: '#ef4444', bg: 'rgba(239,68,68,.08)', badge: '#ef4444', color: '#fff' }
      if (state === 'chosen') return { border: '#6366f1', bg: 'rgba(99,102,241,.08)', badge: '#6366f1', color: '#fff' }
      return { border: 'rgba(148,163,184,.3)', bg: 'transparent', badge: 'rgba(148,163,184,.15)', color: 'inherit' }
    }
    function OptionRow({ label, text, state, onClick, disabled }) {
      const st = optionStyle(state)
      return h('div', {
        style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '2px solid ' + st.border, background: st.bg, borderRadius: 10, marginTop: 8, cursor: disabled ? 'default' : 'pointer', fontSize: 13, lineHeight: 1.6 },
        onClick: disabled ? undefined : onClick,
      },
        h('div', { style: { width: 24, height: 24, borderRadius: '50%', background: st.badge, color: st.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 } }, label),
        h('div', { style: { flex: 1 } }, text))
    }
    /** 五维标注块：kind ∈ analysis/kadian/reasoning/fastest/pitfalls/mother */
    const DIM_META = {
      analysis: { icon: '📖', title: '解析', color: '#64748b', border: 'rgba(148,163,184,.4)' },
      kadian: { icon: '🎯', title: '考点定位', color: '#6366f1', border: '#6366f1' },
      reasoning: { icon: '🧠', title: '解题推理链', color: '#0ea5e9', border: '#0ea5e9' },
      fastest: { icon: '⚡', title: '最快解法（考场用）', color: '#f59e0b', border: '#f59e0b' },
      pitfalls: { icon: '⚠️', title: '易错点', color: '#ef4444', border: '#ef4444' },
      mother: { icon: '🧩', title: '母题思维', color: '#8b5cf6', border: '#8b5cf6' },
    }
    function DimBlock({ kind, text }) {
      const m = DIM_META[kind]
      if (!m || !text) return null
      return h('div', { style: { marginBottom: 10, padding: 12, background: 'rgba(148,163,184,.07)', borderRadius: 10, borderLeft: '3px solid ' + m.border } },
        h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: m.color } }, m.icon + ' ' + m.title),
        h(RichText, { text }))
    }
    /** 标签行 */
    function TagRow({ items }) {
      const list = (items || []).filter(Boolean)
      if (!list.length) return null
      return h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
        list.map((it, i) => h('span', { key: i, style: { ...KV_TAG, ...(it.style || {}) } }, it.text)))
    }


    /** T-016 整卷模考：计时作答 → 交卷 → 模块得分分布 */
    function NativeExamView({ api }) {
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



    /**
     * T-024 会话内练题（conversation.input.left slot）
     *
     * 设计：输入框左侧一个「📚 练题」按钮，点击向上弹出题目浮层。
     * 完全自管状态（抽题/作答/判分/解析），不订阅会话数据、不改父组件。
     * 风险控制：整个注册包在 try/catch 内；slot 缺席则静默跳过（不影响对话）。
     */
    function KaogongQuickPractice(props: any) {
      const [open, setOpen] = React.useState(false)
      const [q, setQ] = React.useState(null)
      const [sel, setSel] = React.useState('')
      const [result, setResult] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [stat, setStat] = React.useState({ done: 0, right: 0 })

      const apiBase = (props && props.apiBase) || '/kaogong/api'

      const draw = React.useCallback(async () => {
        setBusy(true)
        try {
          const r = await fetch(apiBase + '/questions?module=' + encodeURIComponent('判断推理') + '&count=1&sort=srs')
          const d = await r.json()
          setQ((d.questions || [])[0] || null)
          setSel('')
          setResult(null)
        } catch {
          setQ(null)
        } finally { setBusy(false) }
      }, [apiBase])

      const submit = async () => {
        if (!q || !sel) return
        setBusy(true)
        try {
          const r = await fetch(apiBase + '/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q, answer: sel }),
          })
          const d = await r.json()
          setResult(d)
          setStat((st: any) => ({ done: st.done + 1, right: st.right + (d.isCorrect ? 1 : 0) }))
        } catch { /* 静默 */ } finally { setBusy(false) }
      }

      const toggle = () => {
        const next = !open
        setOpen(next)
        if (next && !q) draw()
      }

      // 按钮（常驻输入栏）
      const btn = h('button', {
        type: 'button',
        title: '考公练题：抽一道行测题在这作答',
        'aria-label': '考公练题',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 9px',
          border: '1px solid rgba(148,163,184,.35)', borderRadius: 8, background: open ? 'rgba(99,102,241,.12)' : 'transparent',
          color: open ? '#6366f1' : 'inherit', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        },
        onClick: toggle,
      }, '📚 练题', stat.done ? h('span', { style: { fontSize: 10.5, opacity: .75 } }, stat.right + '/' + stat.done) : null)

      // 面板（向上弹出）
      let panel = null
      if (open) {
        const options = q && q.options ? entries(q.options).map(([L, txt]: any) => {
          const isRight = result && L === q.correctAnswer
          const isWrong = result && L === sel && L !== q.correctAnswer
          const chosen = !result && L === sel
          const border = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.3)'
          const bg = isRight ? 'rgba(16,185,129,.08)' : isWrong ? 'rgba(239,68,68,.07)' : chosen ? 'rgba(99,102,241,.08)' : 'transparent'
          return h('div', {
            key: L,
            style: { display: 'flex', gap: 8, padding: '7px 9px', border: '2px solid ' + border, background: bg, borderRadius: 8, marginTop: 6, cursor: result ? 'default' : 'pointer', fontSize: 12, lineHeight: 1.55 },
            onClick: () => { if (!result) setSel(L) },
          },
            String(txt).trim().toUpperCase().startsWith(L) ? null : h('b', { style: { flexShrink: 0 } }, L),
            h('span', { style: { flex: 1 } }, String(txt).replace(/^[A-D][.、．:：]s*/, '')))
        }) : null

        const body = !q
          ? h('div', { style: { fontSize: 12, color: '#64748b', padding: 12 } }, busy ? '抽题中…' : '暂无题目（题库服务可能未就绪）')
          : h('div', {},
              h('div', { style: { fontSize: 11, color: '#94a3b8', marginBottom: 6 } }, (q.module || '') + (q.type ? ' · ' + q.type : '') + (q.fromWrongBook ? ' · 错题回炉' : '')),
              h('div', { style: { fontSize: 12.5, lineHeight: 1.7, maxHeight: 140, overflowY: 'auto' } }, q.stem),
              options,
              !result
                ? (sel ? h('button', {
                    style: { marginTop: 10, padding: '6px 14px', border: 0, borderRadius: 8, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: 12, cursor: 'pointer' },
                    onClick: submit,
                  }, busy ? '判分中…' : '提交判分') : null)
                : h('div', {},
                    h('div', { style: { marginTop: 10, fontSize: 12, fontWeight: 700, color: result.isCorrect ? '#10b981' : '#ef4444' } },
                      result.isCorrect ? '✅ 正确' : '❌ 错误（答案 ' + q.correctAnswer + '）'),
                    result.analysis ? h('div', { style: { marginTop: 6, fontSize: 11.5, lineHeight: 1.65, maxHeight: 110, overflowY: 'auto', color: 'var(--text-muted,#64748b)' } }, String(result.analysis).slice(0, 600)) : null,
                    h('button', {
                      style: { marginTop: 8, padding: '5px 12px', border: '1px solid rgba(148,163,184,.35)', borderRadius: 8, background: 'transparent', fontSize: 11.5, cursor: 'pointer' },
                      onClick: draw,
                    }, '下一题 →')))

        panel = h('div', {
          style: {
            position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 60,
            width: 340, maxWidth: '86vw', padding: 12, borderRadius: 12,
            background: 'var(--surface-card,#fff)', border: '1px solid rgba(148,163,184,.3)',
            boxShadow: '0 10px 32px rgba(15,23,42,.16)',
          },
          role: 'dialog', 'aria-label': '考公练题面板',
        },
          h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 6 } },
            h('b', { style: { fontSize: 12.5 } }, '📚 随堂练题'),
            h('button', {
              style: { marginLeft: 'auto', border: 0, background: 'none', cursor: 'pointer', fontSize: 14, color: '#94a3b8', lineHeight: 1 },
              'aria-label': '关闭', onClick: () => setOpen(false),
            }, '×')),
          body)
      }

      return h('div', { style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } }, btn, panel)
    }

    /**
     * 图形推理专项视图（T-023 完整版 · 整合 gk-tuxing 354 题）
     * 每题含：题干图（354 张本地图）/ 规律分类 / 参考答案 / 原创解题思路 / 分析 / 陷阱
     * 交互：选规律 → 看图作答（A-D）→ 对答案 + 读思路 → 下一题
     */
    function NativeTuxingView({ api }) {
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
    function NativeDeepBankView({ api, initialModule = '', initialCategory = '' }) {
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

    /** 真题卷库 */
    function NativePapersView({ api, initialSubject = '' }) {
      const [filters, setFilters] = React.useState({ subject: initialSubject || '', year: '' })
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

      React.useEffect(() => {
        let cancelled = false
        const qs = entries(filters).filter(([, v]) => v).map(([k, v]) => '&' + k + '=' + encodeURIComponent(v)).join('')
        api('/papers?_=1' + qs).then(d => { if (!cancelled) setList(d) }).catch(() => { if (!cancelled) setList({ papers: [], total: 0 }) })
        return () => { cancelled = true }
      }, [filters, api])

      React.useEffect(() => {
        if (!openId || detail) return
        let cancelled = false
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
          (detail.materials || []).length > 0 ? h(Card, { title: '📄 给定材料' },
            detail.materials.map(m => h('div', { key: m.no, style: { marginBottom: 14 } },
              h('div', { style: { fontWeight: 700, fontSize: 12, color: '#6366f1', marginBottom: 4 } }, '材料 ' + m.no),
              h(RichText, { text: m.text, maxHeight: 240 })))) : null,
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
            h('button', { style: { ...KV_BTN, ...(filters.subject === '' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }, onClick: () => setFilters({ subject: '', year: '' }) }, '全部'),
            list.subjects.map(sc => h('button', {
              key: sc.subject,
              style: { ...KV_BTN, ...(filters.subject === sc.subject ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
              onClick: () => setFilters({ subject: sc.subject, year: '' }),
            }, sc.subject + ' ' + sc.count))) : null,
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
              h('span', { style: { width: 58, color: '#64748b' } }, p.exam),
              h('span', { style: { flex: 1 } }, p.subject + ' · ' + p.paperType),
              h('span', { style: { color: '#64748b', fontSize: 11.5 } }, p.questionCount + ' 题'),
              p.verified ? h('span', { style: { ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#10b981' } }, '已核验') : null))) : null))
    }

    /** 专题 */
    /**
     * 专题视图（v1.7.1 重构）：行测 / 申论 两个频道，各自专题 + 练习入口。
     * 用户诉求：申论练习不应单独存在，应并入专题；行测也要有对应练习入口。
     * 每个专题带 entry:{view,params} —— 点击即跳转到对应练习视图（统一路由）。
     */
    function NativeTopicsView({ api, onGo }) {
      const [tree, setTree] = React.useState(null)
      const [channel, setChannel] = React.useState('xingce')

      React.useEffect(() => { api('/topics').then(setTree).catch(() => setTree(null)) }, [api])

      if (!tree) return h('div', { className: 'kg-load' }, h('div', { className: 'kg-spin' }), '加载专题…')

      const chs = tree.channels || []
      const cur = chs.find(c => c.id === channel) || chs[0]
      const go = (entry) => { if (entry && onGo) onGo(entry.view, entry.params || {}) }
      const st = tree.stats || {}

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

      // 频道内的练习入口
      const entriesCard = h(Card, { title: '🚀 ' + cur.name + '练习入口' },
        h('div', { style: { fontSize: 11.5, color: '#64748b', marginBottom: 10 } }, cur.desc),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 } },
          (cur.entries || []).map((e, i) => h('div', {
            key: i,
            style: { border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 14, cursor: 'pointer', textAlign: 'center', background: 'rgba(148,163,184,.04)' },
            onClick: () => go({ view: e.view, params: e.params }),
          },
            h('div', { style: { fontWeight: 800, fontSize: 13.5 } }, e.label),
            h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 4 } }, '点击进入')))))

      // 专题列表（按 kind 分组）
      const topics = cur.topics || []
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

      return h('div', {}, head, entriesCard, ...topicCards)
    }

    /** 申论练习 + 离线评改 */
    function NativeEssayView({ api, initialType = '' }) {
      const [type, setType] = React.useState(initialType || '')
      const [list, setList] = React.useState(null)
      const [cur, setCur] = React.useState(null)
      const [answer, setAnswer] = React.useState('')
      const [result, setResult] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [paperDetail, setPaperDetail] = React.useState(null)   // v1.7：材料区
      const [showMaterials, setShowMaterials] = React.useState(true)
      // T-021：材料-题目联动（点关联段号 → 滚动并高亮）
      const [hlNo, setHlNo] = React.useState(0)
      const matRefs = React.useRef({})
      const jumpToMaterial = (no: number) => {
        setShowMaterials(true)
        setHlNo(no)
        setTimeout(() => {
          const el = matRefs.current[no]
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 120)
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
        } finally { setBusy(false) }
      }

      if (result && !result.error) {
        const pct = result.max ? Math.round(result.score / result.max * 100) : 0
        const color = pct >= 75 ? '#10b981' : pct >= 50 ? '#6366f1' : '#f59e0b'
        return h('div', {},
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } },
            h('button', { style: KV_BTN, onClick: () => { setResult(null); setAnswer('') } }, '← 重新作答'),
            h('button', { style: KV_BTN, onClick: () => { setCur(null); setResult(null); setAnswer('') } }, '换一题')),
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
          // v1.7 给定材料阅读区（可折叠；考场必须先读材料）
          h(Card, { title: '📄 给定材料' + (paperDetail && paperDetail.materials ? '（' + paperDetail.materials.length + ' 段）' : '') },
            h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' } },
              h('button', { style: KV_BTN, onClick: () => setShowMaterials(v => !v) }, showMaterials ? '▲ 收起材料' : '▼ 展开材料（' + ((paperDetail && paperDetail.materials) || []).length + ' 段）'),
              paperDetail && paperDetail.materials && paperDetail.materials.length > 0 ? h('span', { style: { fontSize: 11, color: '#64748b' } }, '阅读材料后在下方向作答区作答') : null),
            !paperDetail ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '加载材料…') : null,
            paperDetail && (!paperDetail.materials || paperDetail.materials.length === 0) ? h('div', { style: { fontSize: 12, color: '#f59e0b' } }, '该卷未附带材料（部分年份采集稿缺材料）') : null,
            showMaterials && paperDetail && (paperDetail.materials || []).map(mm => h('div', {
              key: mm.no,
              ref: (el: any) => { matRefs.current[mm.no] = el },
              style: {
                marginBottom: 14, paddingBottom: 12, paddingTop: hlNo === mm.no ? 8 : 0,
                paddingLeft: hlNo === mm.no ? 10 : 0,
                borderBottom: '1px dashed rgba(148,163,184,.2)',
                borderLeft: hlNo === mm.no ? '3px solid #6366f1' : '3px solid transparent',
                background: hlNo === mm.no ? 'rgba(99,102,241,.06)' : 'transparent',
                borderRadius: hlNo === mm.no ? 8 : 0,
                transition: 'all .25s',
              },
            },
              h('div', { style: { fontWeight: 700, fontSize: 11.5, color: '#6366f1', marginBottom: 5 } }, '材料 ' + mm.no),
              h(RichText, { text: mm.text, maxHeight: 300, fontSize: 12.5 })))),
          h(Card, { title: '✍️ 你的作答（离线评分，无需模型）' },
            h('textarea', {
              value: answer, onChange: e => setAnswer(e.target.value),
              placeholder: '在此作答…建议分条（一、二、三 或 1. 2. 3.），要点覆盖权重最高（50%）',
              style: { width: '100%', minHeight: 200, padding: 12, borderRadius: 10, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 13, lineHeight: 1.75, fontFamily: 'inherit', resize: 'vertical', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)', boxSizing: 'border-box' },
            }),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 } },
              h('button', { style: { ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 20px', fontSize: 13, fontWeight: 700 }, disabled: busy || !answer.trim(), onClick: submit }, busy ? '评分中…' : '提交评分'),
              h('span', { style: { fontSize: 11.5, color: '#64748b' } }, answer.replace(/\s/g, '').length + ' 字'))))
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
            setCur(q); setAnswer(''); setResult(null); setPaperDetail(null); setShowMaterials(true)
            api('/paper?id=' + encodeURIComponent(q.paperId)).then(d => setPaperDetail(d)).catch(() => setPaperDetail({ materials: [] }))
          },
          },
            h('div', { style: { display: 'flex', gap: 6, marginBottom: 3, flexWrap: 'wrap' } },
              h('span', { style: KV_TAG }, String(q.year)),
              h('span', { style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, q.paperType),
              q.score ? h('span', { style: { fontSize: 10.5, color: '#64748b' } }, q.score + '分') : null),
            h('div', {}, (q.stem || '').slice(0, 110) + ((q.stem || '').length > 110 ? '…' : '')))) : null))
    }

    /** 渲染错误边界（R9 纵深）：子树抛错降级提示条，绝不白屏宿主 GUI */
    class KaogongErrorBoundary extends React.Component {
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
    function KaogongMainBounded(props) { return h(KaogongErrorBoundary, null, h(KaogongMainPanel, props)) }
    function KaogongTabBounded(props) { return h(KaogongErrorBoundary, null, h(KaogongTabBody, props)) }

    /** 会话 → 工作区路径（隔离 key）；逐级兜底且永不崩 */
    function resolveWorkspaceKey(ctx, sessionId) {
      try {
        if (!sessionId) return 'default'
        const sessions = ctx.get('sessions')
        const scope = sessions && sessions.scope && sessions.scope(sessionId)
        const wp = scope && (scope.workspacePath || scope.workspace || (scope.binding && scope.binding.workspacePath))
        if (wp && typeof wp === 'string') return wp
        return 'session/' + sessionId
      } catch {
        return 'session/' + (sessionId || 'default')
      }
    }

    /** 通道探测：同源 /kaogong/api/status 优先，独立端口兜底 */
    function useChannel() {
      const [channel, setChannel] = React.useState(null)
      React.useEffect(() => {
        if (channel) return
        let cancelled = false
        ;(async () => {
          while (!cancelled) {
            try {
              const r = await fetch(`${MOUNT_PATH}/api/status`, { signal: AbortSignal.timeout(1200) })
              const j = await r.json()
              if (j && j.app === APP_NAME) { if (!cancelled) setChannel({ kind: 'same-origin', base: MOUNT_PATH }); return }
            } catch {}
            for (const port of PORTS) {
              try {
                const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(900) })
                const j = await r.json()
                if (j && j.app === APP_NAME) { if (!cancelled) setChannel({ kind: 'port', base: `http://127.0.0.1:${port}` }); return }
              } catch {}
            }
            await new Promise(r2 => setTimeout(r2, 3000))
          }
        })()
        return () => { cancelled = true }
      }, [channel])
      return channel
    }

    /** 宿主原生面板：同源 fetch + React 渲染（左栏 main 席位，全屏沉浸） */
    function KaogongMainPanel({ wsKey, t }) {
      const channel = useChannel()
      const [view, setViewRaw] = React.useState(() => localStorage.getItem('kg-native-view') || 'dashboard')
      const [viewParams, setViewParams] = React.useState({})   // v1.7.1：专题 entry 传参（模块/题型/科目）
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [tick, setTick] = React.useState(0)

      const setView = (v: any, params?: any) => { localStorage.setItem('kg-native-view', v); setViewRaw(v); setData(null); setViewParams(params || {}) }

      const api = React.useCallback(async (p: string, opts?: any): Promise<any> => {
        const sep = p.includes('?') ? '&' : '?'
        const r = await fetch(`${channel.base}/api${p}${sep}ws=${encodeURIComponent(wsKey)}`, opts)
        return r.json()
      }, [channel, wsKey])

      React.useEffect(() => {
        if (!channel) return
        // v1.6：自管数据视图（papers/topics/essay）由子组件自行 fetch，父不介入
        if (view === 'papers' || view === 'topics' || view === 'essay' || view === 'exam' || view === 'practice' || view === 'deepbank' || view === 'tuxing') { setData(null); return }
        let cancelled = false
        setErr(null)
        ;(async () => {
          try {
            if (view === 'dashboard') {
              const [st, stats, papers, eh, xh] = await Promise.all([
                api('/status'), api('/stats'),
                api('/papers?_=1').catch(() => ({ total: 0, subjects: [] })),
                api('/essay/history').catch(() => ({ total: 0, avgRatio: 0 })),
                api('/paper/exam/history').catch(() => ({ total: 0, avgRate: 0 })),
              ])
              const subj = (papers && papers.subjects) || []
              const essayPapers = (subj.find(x => x.subject === '申论') || {}).count || 0
              const xingcePapers = (subj.find(x => x.subject === '行测') || {}).count || 0
              const extra = {
                paperTotal: (papers && papers.total) || 0, essayPapers, xingcePapers,
                essayCount: (eh && eh.total) || 0, avgEssay: (eh && eh.avgRatio) || 0,
                examCount: (xh && xh.total) || 0, avgExam: (xh && xh.avgRate) || 0,
              }
              if (!cancelled) setData({ kind: 'dashboard', st, stats, extra })
            } else if (view === 'wrongbook') {
              const wb = await api('/wrong')
              if (!cancelled) setData({ kind: 'wrongbook', wb })
            } else if (view === 'graph') {
              const [g, statsI] = await Promise.all([api('/graph'), api('/stats').catch(() => null)])
              if (!cancelled) setData({ kind: 'graph', g, stats: statsI })
            } else if (view === 'obs') {
              const [tel, caps, eh, xh] = await Promise.all([api('/telemetry'), api('/capabilities'), api('/essay/history').catch(() => null), api('/paper/exam/history').catch(() => null)])
              if (!cancelled) setData({ kind: 'obs', tel, caps, insight: { essay: eh, exam: xh } })
            }
          } catch (e) { if (!cancelled) setErr(String((e && e.message) || e)) }
        })()
        return () => { cancelled = true }
      }, [channel, view, api, tick])

      if (!channel) {
        return h('div', { className: 'kg-page', role: 'main', 'aria-label': t('title') },
          h('div', { className: 'kg-load', style: { flex: 1 } },
            h('div', { className: 'kg-spin', role: 'status' }), t('loading')))
      }

      // v1.7.4 导航分组：学习 / 题库 / 复盘（三组各司其职，减少横向拥挤）
      const NAV_GROUPS: Array<{ id: string; label: string; items: Array<[string, string]> }> = [
        { id: 'learn', label: '学习', items: [['dashboard', '📊 仪表盘'], ['practice', '✏️ 刷题'], ['deepbank', '🧠 深度题库'], ['tuxing', '🔷 图形推理'], ['exam', '⏱ 模考']] },
        { id: 'bank', label: '题库', items: [['papers', '📚 真题卷'], ['topics', '🎯 专题'], ['essay', '✍️ 申论']] },
        { id: 'review', label: '复盘', items: [['wrongbook', '📕 错题本'], ['graph', '🕸️ 图谱'], ['obs', '📡 可观测']] },
      ]
      return h('div', { className: 'kg-page', role: 'main', 'aria-label': t('title') },
        h('div', { className: 'kg-page-head' },
          h('span', { className: 'kg-page-title' }, '📚 ' + t('title')),
          h('span', { style: { fontSize: 11, color: '#64748b' } },
            `${channel.kind === 'same-origin' ? '🏠 ' + t('native') : '🔌 ' + t('fallback')} · ${String(wsKey).split(/[\\/]/).pop() || 'default'}`),
          h('nav', { style: { marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }, role: 'tablist' },
            NAV_GROUPS.map((g, gi) => h('div', {
              key: g.id,
              style: { display: 'flex', alignItems: 'center', gap: 2, paddingRight: 10, borderRight: gi < NAV_GROUPS.length - 1 ? '1px solid rgba(148,163,184,.25)' : 'none' },
            },
              h('span', { style: { fontSize: 9.5, color: '#94a3b8', letterSpacing: 1, marginRight: 3, textTransform: 'uppercase' } }, g.label),
              g.items.map(([id, label]) => h('button', {
                key: id, role: 'tab', 'aria-selected': view === id, className: 'kg-navbtn' + (view === id ? ' on' : ''),
                onClick: () => setView(id),
              }, label)))))),
        h('div', { className: 'kg-page-body', style: { overflowY: 'auto', padding: '16px 20px' } },
          err ? h('div', { style: { color: '#ef4444', fontSize: 13 } }, '加载失败: ' + err) : null,
          // v1.6 自管数据视图（组件内自行 fetch，不经父 effect）
          view === 'papers' ? h(NativePapersView, { key: 'pp' + tick, api, initialSubject: viewParams.subject || '' }) : null,
          view === 'exam' ? h(NativeExamView, { key: 'ex' + tick, api }) : null,
          view === 'practice' ? h(NativePracticeView, { key: 'pr' + tick + JSON.stringify(viewParams), api, initialModule: viewParams.module || '', onGoWrongbook: () => setView('wrongbook') }) : null,
          view === 'deepbank' ? h(NativeDeepBankView, { key: 'dp' + tick, api, initialModule: viewParams.module || '', initialCategory: viewParams.category || '' }) : null,
          view === 'tuxing' ? h(NativeTuxingView, { key: 'tx' + tick, api }) : null,
          view === 'topics' ? h(NativeTopicsView, { key: 'tp' + tick, api, onGo: (v, params) => setView(v, params || {}) }) : null,
          view === 'essay' ? h(NativeEssayView, { key: 'es' + tick + JSON.stringify(viewParams), api, initialType: viewParams.type || '' }) : null,
          // 父 effect 管理数据的视图
          view !== 'papers' && view !== 'topics' && view !== 'essay' && view !== 'exam' && view !== 'practice' && view !== 'deepbank' && view !== 'tuxing' && !data && !err ? h('div', { className: 'kg-load' }, h('div', { className: 'kg-spin' })) : null,
          // R9：子视图经组件挂载，key=view+tick → 切换即干净重挂载，父 hook 链恒定
          data && data.kind === 'dashboard' ? h(NativeDashboardView, { key: 'd' + tick, data }) : null,
          data && data.kind === 'wrongbook' ? h(NativeWrongbookView, { key: 'w' + tick, data: data.wb }) : null,
          data && data.kind === 'graph' ? h(NativeGraphView, { key: 'g' + tick, data: data.g, stats: data.stats }) : null,
          data && data.kind === 'obs' ? h(NativeObsView, { key: 'o' + tick, data, insight: data.insight }) : null,
          ))
    }

    /** 左栏面板图标（shell 事件委托接管点击/选中） */
    function KaogongPanelIcon({ size }) {
      return h('svg', {
        'data-dsh-panel-entry': PANEL_ID,
        viewBox: '0 0 16 16', width: size, height: size,
        fill: 'none', stroke: 'currentColor', strokeWidth: '1.3',
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
        h('path', { d: 'M2 3.2A1.2 1.2 0 0 1 3.2 2H7v12.4H3.2A1.2 1.2 0 0 1 2 13.2z' }),
        h('path', { d: 'M14 3.2A1.2 1.2 0 0 0 12.8 2H9v12.4h3.8A1.2 1.2 0 0 0 14 13.2z' }),
        h('path', { d: 'M5.5 5.5h1M10.5 5.5h1' }))
    }

    /** 右侧 tab 正文：同源优先原生，端口兜底 iframe */
    function KaogongTabBody({ wsKey, sidebarRight, t }) {
      const channel = useChannel()
      const [reloadKey, setReloadKey] = React.useState(0)

      if (!channel) {
        return h('div', { className: 'kg-shell', role: 'region', 'aria-label': t('title') },
          h('div', { className: 'kg-load' },
            h('div', { className: 'kg-spin', role: 'status' }), t('loading')))
      }
      if (channel.kind === 'same-origin') {
        return h('div', { className: 'kg-shell', role: 'region', 'aria-label': t('title') },
          h('div', { className: 'kg-bar' },
            h('span', { className: 'kg-dot', 'aria-hidden': 'true' }),
            h('span', null, '🏠 ' + t('native') + ' · ' + channel.base),
            h('span', { style: { opacity: .6, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${t('probe')} ${String(wsKey).split(/[\\/]/).pop()}`),
            h('button', { 'aria-label': t('retry'), style: { marginLeft: 'auto' }, onClick: () => setReloadKey(k => k + 1) }, t('retry'))),
          h('div', { className: 'kg-frame' },
            h(KaogongMainPanel, { wsKey, t, key: reloadKey })))
      }
      const url = `${channel.base}/?ws=${encodeURIComponent(wsKey)}&embed=1&_r=${reloadKey}`
      return h('div', { className: 'kg-shell', role: 'region', 'aria-label': t('title') },
        h('div', { className: 'kg-bar' },
          h('span', { className: 'kg-dot', 'aria-hidden': 'true' }),
          h('span', null, '🔌 ' + t('fallback') + ' · ' + channel.base.replace('http://', '')),
          h('button', {
            'aria-label': t('openExternal'), style: { marginLeft: 'auto' },
            onClick: () => { try { sidebarRight && sidebarRight.openTab && sidebarRight.openTab('browser', { params: { url } }) } catch { window.open(url, '_blank') } },
          }, t('openExternal')),
          h('button', { 'aria-label': t('retry'), onClick: () => setReloadKey(k => k + 1) }, t('retry'))),
        h('div', { className: 'kg-frame' },
          h('iframe', { src: url, title: t('title'), 'aria-label': t('title'), allow: 'clipboard-write' })))
    }

    /* ══ 插件本体：combo factory 必须返回 {inject, apply}（R11 二次取证：
       缺失 return → 加载器收到 undefined → "invalid plugin"）══ */
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try { ctx.locale.register('dsh-kaogong', { zh: DICTS.zh, en: DICTS.en }) } catch { /* locale 缺席不影响核心 */ }
        const t = (k) => {
          try {
            const tt = ctx.locale.bind('dsh-kaogong')
            const v = tt && tt(k)
            return v && v !== k ? v : DICTS.zh[k] || k
          } catch { return DICTS.zh[k] || k }
        }

        // 样式注入双保险（R11 取证：combo 环境 `styles` 内置全局可能不存在，
        // 直接 styles.insert 抛 ReferenceError → 条目激活失败）
        const CSS = `
          .kg-shell{width:100%;height:100%;display:flex;flex-direction:column}
          .kg-frame{flex:1;min-height:0;display:flex;position:relative}
          .kg-frame iframe{border:0;width:100%;height:100%;background:#fff}
          .kg-bar{display:flex;align-items:center;gap:8px;padding:5px 10px;font-size:11.5px;color:var(--text-muted,#64748b);background:rgba(148,163,184,.08);border-bottom:1px solid rgba(148,163,184,.18);flex-shrink:0}
          .kg-bar button{border:0;background:none;cursor:pointer;font-size:11.5px;color:#6366f1;padding:2px 6px;border-radius:5px}
          .kg-bar button:hover{background:rgba(99,102,241,.1)}
          .kg-dot{width:7px;height:7px;border-radius:50%;background:#10b981;flex-shrink:0}
          .kg-load{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#64748b;font-size:13px}
          .kg-spin{width:26px;height:26px;border:3px solid #e2e8f0;border-top-color:#6366f1;border-radius:50%;animation:kgspin .8s linear infinite}
          @keyframes kgspin{to{transform:rotate(360deg)}}
          .kg-page{display:flex;flex-direction:column;height:100%;overflow:hidden}
          .kg-page-head{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid rgba(148,163,184,.25);flex-shrink:0;flex-wrap:wrap}
          .kg-page-title{font-size:15px;font-weight:800;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
          .kg-page-body{flex:1;min-height:0}
          .kg-navbtn{border:0;cursor:pointer;font-size:12px;font-weight:600;padding:5px 10px;border-radius:8px;font-family:inherit;background:transparent;color:var(--text-muted,#64748b)}
          .kg-navbtn:hover{background:rgba(99,102,241,.08)}
          .kg-navbtn.on{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff}
          @media (max-width:420px){.kg-bar{font-size:10.5px;gap:5px}}
        `
        ctx.effect(() => {
          if (typeof (globalThis as any).styles !== 'undefined' && (globalThis as any).styles && (globalThis as any).styles.insert) {
            return (globalThis as any).styles.insert(CSS) || (() => {})
          }
          try {
            const el = document.createElement('style')
            el.textContent = CSS
            document.head.appendChild(el)
            return () => { try { el.remove() } catch {} }
          } catch { return () => {} }
        }, 'kaogong styles')

        // ── 左栏双席位：面板图标 + main 全屏原生面板 ──
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 120, label: () => t('title') },
            KaogongPanelIcon,
          )
        ), 'kaogong panel icon')

        // T-024：会话输入区「练题」控件（slot 缺席时静默跳过，绝不影响对话）
        ctx.effect(() => {
          try {
            const injectSlot = (ctx.slots as any).inject
            if (typeof injectSlot !== 'function') return
            return injectSlot.call(ctx.slots, 'conversation.input.left', () =>
              (ctx.slots as any).register(
                { name: 'conversation.input.left', id: PANEL_ID, order: 85, inject: () => ({ apiBase: '/kaogong/api' }) },
                KaogongQuickPractice,
              ),
            )
          } catch (e) {
            console.warn('[dsh-kaogong] 会话练题控件注册跳过：', (e as any)?.message || e)
            return
          }
        }, 'kaogong quick practice')

        ctx.effect(() => ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: PANEL_ID, inject: () => ({ wsKey: lastWsKey, t }) },
            KaogongMainBounded,
          )
        ), 'kaogong main panel')

        // ── 右侧边栏 tab（双注册同 id + guide 入口）──
        ctx.inject(['sidebarRightTabs'], (injected) => {
          const tabs = injected.get('sidebarRightTabs')
          if (!tabs) { console.error('sidebarRightTabs 服务缺失，标签注册跳过'); return }
          const disposers: any[] = []
          disposers.push(tabs.register({
            id: PANEL_ID, kind: TAB_KIND, priority: 'extension', keepMounted: true,
            title: () => t('title'),
            guide: [{ order: 200, title: () => t('title'), description: () => t('guideDesc') }],
          }))
          disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab', key: PANEL_ID,
                inject: (sessionId) => {
                  lastWsKey = resolveWorkspaceKey(ctx, sessionId)
                  return { wsKey: lastWsKey, sidebarRight: ctx.get('sidebarRight') || null, t }
                },
              },
              KaogongTabBounded,
            )
          ))
          console.log('kaogong 双入口已注册 (left=panel, right=tab, 宿主原生面板优先)')
          return () => { for (const d of disposers) { try { d() } catch {} } }
        })
      },
    }
  },
})
