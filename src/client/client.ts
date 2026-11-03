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

    /* ════════════════════════════════════════════════════════════════════
     * cycle-12 · 原生交互式图谱（Canvas 2D 力导向）
     * 契约 §3：真交互（缩放/平移/拖节点 pin/hover/选中详情/搜索/类型过滤/
     * 布局切换/路径分析/自适应/降级）。R9：本视图仍是 props.data 驱动的真组件，
     * 全部 hook 写在组件顶部、数量跨渲染恒定；事件一律 onClick 驼峰。
     *
     * 【与服务端并行开发的兼容策略】task-1 追加的 nodeMeta / edgeMeta /
     * analytics / layout 字段在本文件里**全部按可选消费**：
     *   · 无 nodeMeta / edgeMeta → 用下方 GRAPH_NODE_META / GRAPH_EDGE_META 降级常量；
     *   · 无 analytics → 本地算 degree / 连通分量 / 标签传播社区 / 集聚系数 / PageRank；
     *   · 无 layout → 确定性圆环初始化（hash(id) 抖动，绝不用 Math.random，保证可复现）；
     *   · 无 nodes / edges（旧路由或 render mock）→ 友好空态，且不渲染 role="alert"。
     * ════════════════════════════════════════════════════════════════════ */

    /** 节点类型元数据降级副本（与服务端 NODE_META 同构；服务端下发时以服务端为准） */
    const GRAPH_NODE_META: any = {
      plugin: { label: '插件', color: '#6366f1', icon: '📦', layer: 0 },
      lifecycle: { label: '生命周期', color: '#0ea5e9', icon: '🔁', layer: 1 },
      entry: { label: '入口', color: '#8b5cf6', icon: '🚪', layer: 1 },
      channel: { label: '通道', color: '#14b8a6', icon: '🔌', layer: 1 },
      view: { label: '视图', color: '#f59e0b', icon: '🖥', layer: 2 },
      endpoint: { label: '端点', color: '#3b82f6', icon: '🔗', layer: 2 },
      tool: { label: '工具', color: '#ec4899', icon: '🧰', layer: 2 },
      domain: { label: '数据域', color: '#10b981', icon: '🗂', layer: 3 },
      repo: { label: '仓库', color: '#64748b', icon: '📚', layer: 4 },
      module: { label: '模块', color: '#84cc16', icon: '🧩', layer: 5 },
      method: { label: '方法论', color: '#a855f7', icon: '📖', layer: 5 },
      phase: { label: '阶段', color: '#f97316', icon: '📅', layer: 5 },
      day: { label: '日', color: '#94a3b8', icon: '·', layer: 6 },
    }
    /** 边类型元数据降级副本（与服务端 EDGE_META 同构） */
    const GRAPH_EDGE_META: any = {
      contains: { label: '包含', color: '#94a3b8' },
      produces: { label: '生产', color: '#3b82f6' },
      consumes: { label: '消费', color: '#10b981' },
      registers: { label: '注册', color: '#6366f1' },
      serves: { label: '服务', color: '#14b8a6' },
      hosts: { label: '承载', color: '#8b5cf6' },
      next: { label: '下一阶段', color: '#0ea5e9' },
      'consumed-by': { label: '被消费', color: '#f59e0b' },
      feeds: { label: '喂给', color: '#84cc16' },
    }
    /** 图谱区通用样式（纯对象，无 hook） */
    const G_BTN = { border: '1px solid rgba(148,163,184,.35)', background: 'transparent', color: 'var(--text-muted,#64748b)', borderRadius: 8, padding: '3px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
    const G_BTN_ON = { background: 'rgba(99,102,241,.12)', borderColor: 'rgba(99,102,241,.5)', color: '#4f46e5', fontWeight: 700 }
    const G_TAG = { background: 'rgba(148,163,184,.15)', color: '#475569', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }
    const G_CHIP = { border: '1px solid rgba(148,163,184,.35)', background: 'transparent', color: '#64748b', borderRadius: 20, padding: '2px 9px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.6 }

    /** 字符串 → [0,1) 的确定性散列（FNV-1a；替代 Math.random，保证布局可复现） */
    function graphHash(s: any) {
      const str = String(s == null ? '' : s)
      let hv = 2166136261 >>> 0
      for (let i = 0; i < str.length; i++) { hv ^= str.charCodeAt(i); hv = Math.imul(hv, 16777619) }
      return ((hv >>> 0) % 100000) / 100000
    }
    function graphClamp(v: any, lo: any, hi: any) { return v < lo ? lo : v > hi ? hi : v }

    /** 模糊匹配：先子串，再子序列；命中返回权重（越小越靠前），未命中 -1 */
    function graphFuzzyIndex(hay: string, needle: string) {
      if (!needle) return -1
      const direct = hay.indexOf(needle)
      if (direct >= 0) return direct
      let pos = 0
      for (let i = 0; i < needle.length; i++) {
        const at = hay.indexOf(needle[i], pos)
        if (at < 0) return -1
        pos = at + 1
      }
      return 999
    }

    /** 本地 PageRank（幂迭代 d=0.85）：服务端 rank 只有 top12，抽屉需要任意节点值 */
    function graphLocalPageRank(nodes: any[], edges: any[]): any {
      const out: any = {}
      try {
        const n = nodes.length
        if (!n) return out
        const D = 0.85
        const pr: any = {}, adj: any = {}
        for (const x of nodes) { pr[x.id] = 1 / n; adj[x.id] = [] }
        for (const e of edges) { if (adj[e.source] && pr[e.target] !== undefined) adj[e.source].push(e.target) }
        for (let it = 0; it < 24; it++) {
          let dangling = 0
          for (const x of nodes) if (!adj[x.id].length) dangling += pr[x.id]
          const next: any = {}
          for (const x of nodes) next[x.id] = (1 - D) / n + D * (dangling / n)
          for (const x of nodes) {
            const share = pr[x.id] / (adj[x.id].length || 1)
            for (const t of adj[x.id]) if (next[t] !== undefined) next[t] += D * share
          }
          for (const x of nodes) pr[x.id] = next[x.id]
        }
        return pr
      } catch { return out }
    }

    /**
     * 本地图分析降级实现（analytics 缺失时使用）：
     * degree / 连通分量（迭代并查集，无递归）/ 孤儿 / 标签传播社区 / 平均集聚系数 / PageRank。
     * 全部确定性（索引序 + 字典序），同输入两次输出深相等。
     */
    function graphLocalAnalytics(nodes: any[], edges: any[]): any {
      const empty = { degree: {}, density: 0, components: 0, orphans: [] as any[], communities: [] as any[], clustering: { avg: 0 }, pagerank: {} }
      try {
        const list = (Array.isArray(nodes) ? nodes : []).filter(x => x && x.id)
        const es = (Array.isArray(edges) ? edges : []).filter(e => e && e.source && e.target)
        const degree: any = {}, adj: any = {}
        for (const n of list) { degree[n.id] = { in: 0, out: 0, total: 0 }; adj[n.id] = new Set() }
        for (const e of es) {
          if (!degree[e.source] || !degree[e.target]) continue
          degree[e.source].out++; degree[e.target].in++
          adj[e.source].add(e.target); adj[e.target].add(e.source)
        }
        for (const id of Object.keys(degree)) degree[id].total = degree[id].in + degree[id].out
        const V = list.length, E = es.length
        // 连通分量
        const parent: any = {}
        for (const n of list) parent[n.id] = n.id
        const find = (x: any) => { let r = x; while (parent[r] !== r) r = parent[r]; while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx } return r }
        for (const e of es) {
          if (parent[e.source] === undefined || parent[e.target] === undefined) continue
          const a = find(e.source), b = find(e.target)
          if (a !== b) parent[a] = b
        }
        const roots = new Set()
        for (const n of list) roots.add(find(n.id))
        // 孤儿（度 0）
        const orphans = list.filter(n => (degree[n.id] || {}).total === 0).map(n => n.id)
        // 社区：标签传播（索引序 + 平票取字典序最小标签，确定性）
        const label: any = {}
        for (const n of list) label[n.id] = String(n.id)
        for (let it = 0; it < 20; it++) {
          let changed = false
          for (const n of list) {
            const cnt: any = {}
            adj[n.id].forEach((nb: any) => { const l = label[nb]; cnt[l] = (cnt[l] || 0) + 1 })
            let best = label[n.id], bestC = 0
            const keys = Object.keys(cnt).sort()
            for (const k of keys) if (cnt[k] > bestC) { best = k; bestC = cnt[k] }
            if (best !== label[n.id]) { label[n.id] = best; changed = true }
          }
          if (!changed) break
        }
        const groups: any = {}
        for (const n of list) { const l = label[n.id]; (groups[l] = groups[l] || []).push(n.id) }
        const communities = Object.keys(groups).sort().map(id => ({ id, size: groups[id].length, members: groups[id] }))
          .sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1))
        // 平均集聚系数（无向；度 <2 记 0）
        let sum = 0
        for (const n of list) {
          const nb = Array.from(adj[n.id]) as any[]
          const k = nb.length
          if (k < 2) continue
          let links = 0
          for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if (adj[nb[i]].has(nb[j])) links++
          sum += (2 * links) / (k * (k - 1))
        }
        return {
          degree,
          density: V > 1 ? +(E / (V * (V - 1))).toFixed(4) : 0,
          components: roots.size,
          orphans,
          communities,
          clustering: { avg: V ? +(sum / V).toFixed(4) : 0 },
          pagerank: graphLocalPageRank(list, es),
        }
      } catch { return empty }
    }

    /** 读取服务端预置布局：兼容 {id:{x,y}} / {nodes:{...}} / {id:{...}} 三种形态 */
    function graphReadPresetLayout(raw: any) {
      try {
        const l = raw && raw.layout
        if (!l || typeof l !== 'object') return null
        if (l.nodes && typeof l.nodes === 'object') return l.nodes
        let found = false
        for (const k of Object.keys(l)) {
          const v = l[k]
          if (v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number') { found = true; break }
        }
        return found ? l : null
      } catch { return null }
    }
    /** 读取服务端分层结果：analytics.layers.layer（id→层号） */
    function graphReadLayers(raw: any) {
      try {
        const an = raw && raw.analytics
        const l = an && an.layers
        if (l && l.layer && typeof l.layer === 'object') return l.layer
        return null
      } catch { return null }
    }

    /** 空引擎（画布不可用 / 2D 上下文缺失时的静默降级桩，方法齐全便于组件无脑调用） */
    function graphEngineStub(): any {
      return {
        ok: false,
        kick() {}, requestDraw() {}, destroy() {}, setLayout() {}, setView() {},
        setPath() {}, setFocus() {}, fit() {}, reset() {}, focusNode() {}, resize() {},
      }
    }

    /**
     * 力导向图引擎（纯函数式闭包，内部无 hook；由组件在 useEffect 里创建与销毁）。
     * 物理模型：斥力（O(V²)，V>600 时按步长抽样保帧预算）+ 弹簧 + 向心 + 阻尼；
     * alpha 从 1 衰减到 0.02，稳定后停 rAF（省电），交互再 kick 重启。
     */
    function createGraphEngine(cfg: any): any {
      const canvas = cfg && cfg.canvas
      const wrap = cfg && cfg.wrap
      let ctx: any = null
      try { if (canvas && typeof canvas.getContext === 'function') ctx = canvas.getContext('2d') } catch { ctx = null }
      if (!canvas || !ctx) return graphEngineStub()

      const nodesIn: any[] = Array.isArray(cfg.nodes) ? cfg.nodes : []
      const edgesIn: any[] = Array.isArray(cfg.edges) ? cfg.edges : []
      const nodeMeta: any = cfg.nodeMeta || GRAPH_NODE_META
      const edgeMeta: any = cfg.edgeMeta || GRAPH_EDGE_META
      const presetLayout: any = cfg.presetLayout || null
      const layers: any = cfg.layers || null
      const onSelect = typeof cfg.onSelect === 'function' ? cfg.onSelect : () => {}
      const onRequestPath = typeof cfg.onRequestPath === 'function' ? cfg.onRequestPath : () => {}

      const dpr = graphClamp((typeof globalThis !== 'undefined' && (globalThis as any).devicePixelRatio) || 1, 1, 3)
      const rafFn: any = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: any) => setTimeout(cb, 16)
      const cafFn: any = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id: any) => clearTimeout(id)

      let W = 640, H = 420
      let zoom = 1, panX = 0, panY = 0
      let alpha = 1, raf: any = null, sized = false, autoFitted = false
      let userAdjusted = false   // 用户是否手动缩放过/平移过（决定了 resize 时要不要重新 fit）
      let layoutMode = 'force'
      let hoverId: any = null, selectedId: any = null
      let drag: any = null, pan: any = null, pinch: any = null, downPt: any = null
      let hoverPos: any = null
      let focusSet: any = null
      let pathNodeSet: any = null
      let pathEdgeSet: any = null
      let view = { hiddenTypes: new Set(), hiddenEdges: new Set(), showOrphans: true, showLabels: true }
      const pointers = new Map()

      /* ── 节点/边模型（服务端边缺失端点时直接跳过该边，不抛错） ── */
      const simNodes: any[] = []
      const byId: any = {}
      const indexById: any = {}
      // 力学参数（v1.8.0 重标定）：原 LINK=90/REP=9000/向心 0.004 在 V≈140 时
      // 弹簧与向心压过斥力 → 全图塌缩成中心一团（标签 100% 重叠、不可读）。
      // 现按「节点数自适应」标定：斥力随 V 放大、弹簧随 V 拉长、向心减半。
      const BASE_R = 300, BASE_W = 520, BASE_H = 380
      const VN = Math.max(1, nodesIn.length)
      const LINK = Math.round(110 + Math.min(70, VN * 0.5))          // 140 节点 → 180
      const REP = Math.round(9000 * Math.max(1, VN / 60))            // 140 节点 → 21000
      const GRAVITY = 0.0016                                          // 向心：0.004 → 0.0016
      for (let i = 0; i < nodesIn.length; i++) {
        const n = nodesIn[i] || {}
        const id = String(n.id == null ? 'n' + i : n.id)
        if (byId[id]) continue
        const lp = presetLayout && presetLayout[id]
        let x: number, y: number
        if (lp && isFinite(lp.x) && isFinite(lp.y)) {
          // 服务端归一化 0..1 → 世界坐标（确定性，无随机）
          x = (Number(lp.x) - 0.5) * 2 * BASE_W
          y = (Number(lp.y) - 0.5) * 2 * BASE_H
        } else {
          // 降级初始化：圆环 + id 散列抖动（可复现；不用 Math.random）
          const ang = (i / Math.max(1, nodesIn.length)) * Math.PI * 2 + graphHash(id + '#a') * 0.7
          const rad = BASE_R * (0.7 + graphHash(id + '#r') * 0.55)
          x = Math.cos(ang) * rad * 1.3
          y = Math.sin(ang) * rad
        }
        const node = { id, type: String(n.type || 'unknown'), label: String(n.label == null ? id : n.label), x, y, vx: 0, vy: 0, pinned: false, deg: 0, idx: simNodes.length }
        byId[id] = node
        indexById[id] = node.idx
        simNodes.push(node)
      }
      const simEdges: any[] = []
      for (const e of edgesIn) {
        if (!e || !e.source || !e.target) continue
        const a = byId[String(e.source)], b = byId[String(e.target)]
        if (!a || !b || a === b) continue
        simEdges.push({ a: a.idx, b: b.idx, rel: String(e.rel || ''), w: Number(e.w) || 1 })
      }
      for (const e of simEdges) { simNodes[e.a].deg++; simNodes[e.b].deg++ }

      function metaOf(type: any) {
        return (nodeMeta && nodeMeta[type]) || GRAPH_NODE_META[type] || { label: String(type || '未知'), color: '#94a3b8', icon: '•', layer: 0 }
      }
      function colorOfEdge(rel: any) {
        const m = (edgeMeta && edgeMeta[rel]) || GRAPH_EDGE_META[rel]
        return (m && m.color) || '#94a3b8'
      }
      function screenRadius(n: any) {
        const world = 5 + Math.min(9, Math.sqrt(Math.max(0, n.deg)) * 2.4)
        return graphClamp(world * zoom, 3, 30)
      }
      function nodeVisible(n: any) {
        if (!n) return false
        if (view.hiddenTypes.has(n.type)) return false
        if (!view.showOrphans && n.deg === 0) return false
        if (focusSet && !focusSet.has(n.id)) return false
        return true
      }
      function neighborSetOf(id: any) {
        const set = new Set()
        if (!id) return set
        for (const e of simEdges) {
          const a = simNodes[e.a], b = simNodes[e.b]
          if (!a || !b) continue
          if (a.id === id) set.add(b.id)
          else if (b.id === id) set.add(a.id)
        }
        return set
      }
      function edgeKey(e: any) { return Math.min(e.a, e.b) + '-' + Math.max(e.a, e.b) }

      /* ── 画布尺寸（DPR 感知） ── */
      function resize() {
        try {
          let w = 0, hh = 0
          if (wrap && typeof wrap.getBoundingClientRect === 'function') {
            const r = wrap.getBoundingClientRect()
            w = r && r.width ? r.width : 0
            hh = r && r.height ? r.height : 0
          }
          if (!w) w = canvas.clientWidth || 640
          if (!hh) hh = canvas.clientHeight || 420
          W = Math.max(120, Math.round(w))
          H = Math.max(120, Math.round(hh))
          const prevW = W, prevH = H
          canvas.width = Math.round(W * dpr)
          canvas.height = Math.round(H * dpr)
          if (canvas.style) { canvas.style.width = '100%'; canvas.style.height = '100%' }
          if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          if (!sized) {
            sized = true
            // 首次拿到尺寸：预收敛到稳态 → 适配视口 → 停止在线物理（省电且不抖）
            relax(140)
          }
          // 视口尺寸变化：用户没有手动缩放/平移过时，重新适配（否则图会溢出画布）
          // 修复点：首帧 wrap 尺寸可能为 0（按 640×420 兜底算 fit），真实尺寸到达后必须重算。
          if (!userAdjusted) fit()
          alpha = 0
          autoFitted = true
        } catch { W = 640; H = 420 }
      }

      /* ── 坐标换算 ── */
      function worldOf(sx: any, sy: any) { return { x: (sx - panX) / zoom, y: (sy - panY) / zoom } }
      function localPt(ev: any) {
        let sx = 0, sy = 0
        try {
          const r = canvas.getBoundingClientRect()
          sx = ev.clientX - r.left
          sy = ev.clientY - r.top
        } catch {}
        return { x: sx, y: sy }
      }
      function hitTest(sx: any, sy: any) {
        let best = null, bestD = Infinity
        for (let i = simNodes.length - 1; i >= 0; i--) {
          const n = simNodes[i]
          if (!nodeVisible(n)) continue
          const px = n.x * zoom + panX, py = n.y * zoom + panY
          const d = Math.sqrt((px - sx) * (px - sx) + (py - sy) * (py - sy))
          if (d <= screenRadius(n) + 4 && d < bestD) { best = n; bestD = d }
        }
        return best
      }

      /**
       * 预收敛（v1.8.0）：同步跑若干 FR 迭代把图先收敛到一个稳定、适合画布的形状，
       * 再 fit() 适配视口。理由：纯在线 rAF 力模拟会在几十帧里持续膨胀，
       * 用户打开图谱时先看到「糊成一团」再看到「飞出画布」，体验与可读性都差。
       * 这里用「较少迭代 + 温度调度（位移随迭代衰减）」得到与在线模拟相同的稳态，
       * 却在一帧内完成（141 节点 × 120 迭代 ≈ 数万次运算，实测 < 30ms）。
       * 确定性：初始化用 id 散列（无 Math.random），迭代顺序固定 → 每次打开位置一致。
       */
      function relax(iterations: any, temperature?: any) {
        try {
          const n = simNodes.length
          if (!n) return
          const T0 = typeof temperature === 'number' ? temperature : Math.max(W, H) * 0.16
          const savedAlpha = alpha
          for (let it = 0; it < iterations; it++) {
            alpha = Math.max(0.02, 1 - it / Math.max(1, iterations))
            step()
            // 温度调度：限制单步位移，避免早期炸开、后期震荡
            const T = T0 * (1 - it / Math.max(1, iterations)) + 1
            for (const a of simNodes) {
              const sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
              if (sp > T) { a.vx = a.vx / sp * T; a.vy = a.vy / sp * T }
            }
            for (const a of simNodes) { a.x += a.vx; a.y += a.vy; a.vx = 0; a.vy = 0 }
          }
          alpha = savedAlpha
        } catch {}
      }

      /* ── 物理步进（v1.8.0 重写：Fruchterman-Reingold 风格）──
         原实现是「凭空斥力 + 定长弹簧」，两个缺陷：
         ① 斥力对全部点对同权，中心枢纽（度 60+）与其 60 个邻居被同量推开，
            但弹簧又把它们全部拉回 LINK 处 → 邻居在中心半径 ~LINK 的环上挤成一圈；
         ② 没有「理想边长」概念，节点度数差异无法反映到几何（deg 61 与 deg 1 同样距离）。
         现改用 FR 经典形式：
           k = sqrt(area / V)              —— 理想边长（由画布面积与节点数导出）
           fa(d) = k²/d                     —— 斥力（与距离成反比，近处急剧增大）
           fr(d) = d²/k                     —— 引力（远处强，近处弱）
         并按度加权理想边长 k_ij = k·(1 + log2(1+min(deg_i,deg_j))/4)：
         高度节点拥有更长的边 → 枢纽自然撑开，叶子紧密成簇。 */

      /* ── 物理步进 ── */
      function step() {
        const n = simNodes.length
        if (!n) return
        const a0 = Math.max(0.02, alpha)
        const stride = n > 600 ? Math.ceil(n / 600) : 1
        // 理想边长 k：由「可视区域面积 / 节点数」导出（视野随缩放变化，k 只在力模拟用世界坐标）
        const areaW = Math.max(900, W / Math.max(0.2, zoom))
        const areaH = Math.max(700, H / Math.max(0.2, zoom))
        const K = Math.sqrt((areaW * areaH) / Math.max(1, n))
        // ① FR 斥力 fa(d)=k²/d（O(V²)；>600 节点抽样，保持帧预算）
        for (let i = 0; i < n; i++) {
          const a = simNodes[i]
          if (a.pinned) continue
          let fx = 0, fy = 0
          for (let j = 0; j < n; j += stride) {
            if (i === j) continue
            const b = simNodes[j]
            let dx = a.x - b.x, dy = a.y - b.y
            let d2 = dx * dx + dy * dy
            if (d2 < 0.01) {
              // 重合点用确定性散列错开，避免除零
              dx = (graphHash(a.id + '#x') - 0.5) * 0.3 + 0.05
              dy = (graphHash(b.id + '#y') - 0.5) * 0.3 + 0.05
              d2 = dx * dx + dy * dy
            }
            const d = Math.sqrt(d2)
            // fa 与 k²/d 成正比；上限防止极端贴近时数值爆炸
            const f = Math.min((K * K) / d, K * 3)
            fx += (dx / d) * f
            fy += (dy / d) * f
          }
          a.vx += fx * 0.012 * a0
          a.vy += fy * 0.012 * a0
        }
        // ② FR 引力 fr(d)=d²/k，理想边长按两端度加权（枢纽→更长边）
        for (const e of simEdges) {
          const a = simNodes[e.a], b = simNodes[e.b]
          if (!a || !b || a === b) continue
          const dx = b.x - a.x, dy = b.y - a.y
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01
          const dmin = Math.min(a.deg, b.deg)
          const kij = K * (1 + Math.log2(1 + Math.min(60, dmin)) / 5)
          const f = (d * d / kij) * 0.012 * a0
          const ux = dx / d, uy = dy / d
          if (!a.pinned) { a.vx += ux * f; a.vy += uy * f }
          if (!b.pinned) { b.vx -= ux * f; b.vy -= uy * f }
        }
        // 向心 + 阻尼 + 位移
        for (const a of simNodes) {
          if (a.pinned) { a.vx = 0; a.vy = 0; continue }
          // 向心：把整体收在 K*sqrt(V) 量级的盘内（避免孤立簇飘远）
          a.vx += -a.x * (0.0012 * a0)
          a.vy += -a.y * (0.0012 * a0)
          a.vx *= 0.86
          a.vy *= 0.86
          const sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
          if (sp > 40) { a.vx = a.vx / sp * 40; a.vy = a.vy / sp * 40 }
          a.x += a.vx
          a.y += a.vy
        }
      }

      /* ── 渲染 ── */
      function draw() {
        if (!ctx) return
        try {
          if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, W, H)
          ctx.fillStyle = '#f8fafc'
          ctx.fillRect(0, 0, W, H)
          // 背景点阵（随平移/缩放轻微跟随，提供空间参考）
          const gap = graphClamp(30 * zoom, 18, 64)
          ctx.fillStyle = 'rgba(148,163,184,.28)'
          const ox = ((panX % gap) + gap) % gap
          const oy = ((panY % gap) + gap) % gap
          for (let gx = ox; gx < W; gx += gap) for (let gy = oy; gy < H; gy += gap) ctx.fillRect(gx, gy, 1.1, 1.1)

          const active = hoverId || selectedId
          const nbs = active ? neighborSetOf(active) : null

          // 边
          for (const e of simEdges) {
            const a = simNodes[e.a], b = simNodes[e.b]
            if (!a || !b || !nodeVisible(a) || !nodeVisible(b)) continue
            if (view.hiddenEdges.has(e.rel)) continue
            const onPath = !!(pathEdgeSet && pathEdgeSet.has(edgeKey(e)))
            let color = colorOfEdge(e.rel), lw = 1 / zoom, ea = 0.34
            if (onPath) { color = '#f59e0b'; lw = 3 / zoom; ea = 1 }
            else if (active) {
              if (a.id === active || b.id === active) ea = 0.85
              else if (nbs && (nbs.has(a.id) || nbs.has(b.id))) ea = 0.45
              else ea = pathNodeSet ? 0.16 : 0.1
            }
            ctx.globalAlpha = ea
            ctx.strokeStyle = color
            ctx.lineWidth = lw
            ctx.beginPath()
            ctx.moveTo(a.x * zoom + panX, a.y * zoom + panY)
            ctx.lineTo(b.x * zoom + panX, b.y * zoom + panY)
            ctx.stroke()
          }
          ctx.globalAlpha = 1

          /* 标签去重叠（贪心占位）：v1.8.0 修复「141 个标签 100% 重叠不可读」。
             策略：先画节点，再按优先级（选中>路径>hover>高度数>其余）尝试放置标签，
             与已放置标签的包围盒冲突则跳过；缩放小(<0.55)时进一步收紧只留重点节点。 */
          const labelBoxes: any[] = []
          const labelCands: any[] = []
          // 节点
          for (const n of simNodes) {
            if (!nodeVisible(n)) continue
            const sx = n.x * zoom + panX, sy = n.y * zoom + panY
            if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue
            const m = metaOf(n.type)
            const r = screenRadius(n)
            // 压暗强度：普通 hover/选中 0.34；有路径高亮时其余节点保留 0.5
            // （原 0.22 让整张图在「路径分析」态几乎不可见，失去上下文）
            const dim = active && active !== n.id && !(nbs && nbs.has(n.id)) && !(pathNodeSet && pathNodeSet.has(n.id))
            ctx.globalAlpha = dim ? (pathNodeSet ? 0.5 : 0.34) : 1
            // 高亮光环：选中 > 路径 > hover
            if (n.id === selectedId) { ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2.4; ctx.stroke() }
            else if (pathNodeSet && pathNodeSet.has(n.id)) { ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2.2; ctx.stroke() }
            else if (n.id === hoverId) { ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(99,102,241,.75)'; ctx.lineWidth = 1.8; ctx.stroke() }
            ctx.beginPath()
            ctx.arc(sx, sy, r, 0, Math.PI * 2)
            ctx.fillStyle = m.color || '#94a3b8'
            ctx.fill()
            ctx.lineWidth = 1.4
            ctx.strokeStyle = '#ffffff'
            ctx.stroke()
            // 钉住标记（右上角小方块）
            if (n.pinned) {
              ctx.fillStyle = '#0f172a'
              ctx.fillRect(sx + r * 0.55, sy - r * 1.05, 4, 4)
            }
            // 标签候选（延后统一绘制，做去重叠）
            const mustLabel = n.id === active || (pathNodeSet && pathNodeSet.has(n.id))
            if (mustLabel || view.showLabels) {
              labelCands.push({
                n, sx, sy, r, dim,
                pri: mustLabel ? 4 : (n.deg >= 6 ? 3 : n.deg >= 3 ? 2 : 1),
                text: String(n.label || n.id),
              })
            }
          }
          // 优先级：选中/路径 > 高度数 > 低度数；同优先级按 deg 降序、id 字典序（确定性）
          labelCands.sort((a, b) =>
            (b.pri - a.pri) || (b.n.deg - a.n.deg) || (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0))
          for (const c of labelCands) {
            if (c.n.id !== active && !(pathNodeSet && pathNodeSet.has(c.n.id)) && zoom < 0.55 && c.pri < 3) continue
            const text = c.text
            const short = text.length > 14 ? text.slice(0, 13) + '…' : text
            const fs = graphClamp(10.5 / zoom, 7, 18)
            ctx.font = '600 ' + fs.toFixed(1) + 'px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
            const tw = ctx.measureText(short).width
            const bx0 = c.sx - tw / 2 - 2, by0 = c.sy + c.r + 1, bw = tw + 4, bh = fs * 1.25
            // 与已放置标签冲突 → 跳过（这就是「标签去重叠」的全部成本：O(k²)，k 为候选数）
            let clash = false
            for (const b of labelBoxes) {
              if (bx0 < b.x + b.w && bx0 + bw > b.x && by0 < b.y + b.h && by0 + bh > b.y) { clash = true; break }
            }
            if (clash) continue
            labelBoxes.push({ x: bx0, y: by0, w: bw, h: bh })
            ctx.globalAlpha = c.dim ? (pathNodeSet ? 0.62 : 0.44) : 1
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.lineWidth = 3 / zoom
            ctx.strokeStyle = 'rgba(248,250,252,.92)'
            ctx.strokeText(short, c.sx, c.sy + c.r + 2)
            ctx.fillStyle = c.dim ? 'rgba(51,65,85,.45)' : '#334155'
            ctx.fillText(short, c.sx, c.sy + c.r + 2)
          }
          ctx.globalAlpha = 1

          // 悬停工具提示（屏幕坐标系，避免随缩放变形）
          if (hoverId && hoverPos) {
            const n = byId[hoverId]
            if (n) {
              const m = metaOf(n.type)
              const line1 = String(n.label || n.id)
              const line2 = (m.icon || '•') + ' ' + (m.label || n.type) + ' · 度 ' + n.deg + (n.pinned ? ' · 已钉住' : '')
              ctx.font = '700 11.5px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              const w1 = ctx.measureText(line1).width
              ctx.font = '11px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              const w2 = ctx.measureText(line2).width
              const bw = Math.min(W - 12, Math.max(w1, w2) + 18)
              const bh = 38
              let bx = hoverPos.x + 12, by = hoverPos.y + 12
              if (bx + bw > W - 6) bx = Math.max(6, hoverPos.x - bw - 12)
              if (by + bh > H - 6) by = Math.max(6, hoverPos.y - bh - 12)
              ctx.fillStyle = 'rgba(15,23,42,.92)'
              ctx.fillRect(bx, by, bw, bh)
              ctx.fillStyle = '#f8fafc'
              ctx.textAlign = 'left'
              ctx.textBaseline = 'top'
              ctx.font = '700 11.5px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              ctx.fillText(line1.length > 30 ? line1.slice(0, 29) + '…' : line1, bx + 9, by + 6)
              ctx.fillStyle = 'rgba(203,213,225,.95)'
              ctx.font = '11px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
              ctx.fillText(line2, bx + 9, by + 21)
            }
          }
        } catch { /* 渲染期任何异常都不得扩散到 React 树 */ }
      }

      /* ── 帧循环：alpha 稳定后自动停 rAF（省电） ── */
      function frame() {
        raf = null
        try {
          if (alpha > 0.02) {
            step()
            alpha *= 0.986
            if (alpha <= 0.02) alpha = 0
          }
          draw()
          // FR 力模型跑开后图会扩张到远超初始视口；冷却结束时自动适配一次
          // （只在「自然冷却到 0」时触发，用户交互 kick 不会反复抖动视图）
          if (alpha === 0 && !autoFitted) { autoFitted = true; fit() }
        } catch {}
        if (alpha > 0.02) schedule()
      }
      function schedule() { if (!raf) { try { raf = rafFn(frame) } catch { raf = null } } }
      function kick(boost: any) { autoFitted = false; alpha = Math.max(alpha, typeof boost === 'number' ? boost : 0.6); schedule() }
      function requestDraw() { kick(0) }

      /* ── 视图适配/聚焦 ── */
      function fit() {
        try {
          userAdjusted = false
          const list = simNodes.filter(nodeVisible)
          if (!list.length) { zoom = 1; panX = W / 2; panY = H / 2; requestDraw(); return }
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const n of list) {
            if (n.x < minX) minX = n.x
            if (n.y < minY) minY = n.y
            if (n.x > maxX) maxX = n.x
            if (n.y > maxY) maxY = n.y
          }
          // 标签画在节点圆心下方（半径 + 字号），所以「真实可视占用」是
          // [minY, maxY + 标签高度]。两个修正必须同时做，否则贴边：
          //   ① 高度按「节点 bbox + 下方标签余量」放大
          //   ② 纵向中心按下移后的区间中心平移（否则底部仍溢出）
          const LABEL_PAD = 26
          const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY + LABEL_PAD)
          zoom = graphClamp(Math.min((W - 96) / bw, (H - 48) / bh), 0.1, 4)
          panX = W / 2 - ((minX + maxX) / 2) * zoom
          panY = H / 2 - ((minY + maxY + LABEL_PAD) / 2) * zoom
          requestDraw()
        } catch {}
      }
      function reset() {
        try {
          for (const n of simNodes) { n.pinned = false; n.vx = 0; n.vy = 0 }
          // 重置 = 回到确定性初值再预收敛（不是把力模拟重新烧一遍）
          for (let i = 0; i < simNodes.length; i++) {
            const n = simNodes[i]
            const ang = (i / Math.max(1, simNodes.length)) * Math.PI * 2 + graphHash(n.id + '#a') * 0.7
            const rad = BASE_R * (0.7 + graphHash(n.id + '#r') * 0.55)
            n.x = Math.cos(ang) * rad * 1.3
            n.y = Math.sin(ang) * rad
          }
          relax(140)
          fit()
          alpha = 0
          autoFitted = true
          requestDraw()
        } catch {}
      }
      function focusNode(id: any) {
        try {
          const n = byId[id]
          if (!n) return
          zoom = Math.max(zoom, 0.9)
          panX = W / 2 - n.x * zoom
          panY = H / 2 - n.y * zoom
          requestDraw()
        } catch {}
      }

      /* ── 分层布局（优先服务端 layers，否则用类型层级兜底；确定性） ── */
      function applyLayered() {
        try {
          const groups: any = {}
          for (const n of simNodes) {
            let L = layers ? Number(layers[n.id]) : NaN
            if (!isFinite(L)) {
              const m = metaOf(n.type)
              L = (m && typeof m.layer === 'number') ? m.layer : 0
            }
            ;(groups[L] = groups[L] || []).push(n)
          }
          const ls = Object.keys(groups).map(Number).sort((a, b) => a - b)
          if (!ls.length) return
          let maxRow = 1
          for (const L of ls) maxRow = Math.max(maxRow, groups[L].length)
          const gapX = graphClamp(900 / maxRow, 46, 190)
          const gapY = 150
          for (let li = 0; li < ls.length; li++) {
            const arr = groups[ls[li]]
            const cy = (li - (ls.length - 1) / 2) * gapY
            for (let i = 0; i < arr.length; i++) {
              const n = arr[i]
              n.x = (i - (arr.length - 1) / 2) * gapX
              n.y = cy + (graphHash(n.id + '#ly') - 0.5) * 26
              n.vx = 0
              n.vy = 0
            }
          }
        } catch {}
      }

      /* ── 对外 API ── */
      function setLayout(mode: any) {
        try {
          layoutMode = mode === 'layered' ? 'layered' : 'force'
          if (layoutMode === 'layered') { applyLayered(); alpha = 0; fit() }
          else {
            // 力导向：从当前位置松弛到稳态后适配（不启动长时间在线模拟）
            relax(90)
            fit()
            alpha = 0
            autoFitted = true
          }
          requestDraw()
        } catch {}
      }
      function setView(v: any) {
        try {
          if (!v) return
          view.hiddenTypes = (v.hiddenTypes instanceof Set) ? v.hiddenTypes : new Set(v.hiddenTypes || [])
          view.hiddenEdges = (v.hiddenEdges instanceof Set) ? v.hiddenEdges : new Set(v.hiddenEdges || [])
          view.showOrphans = v.showOrphans !== false
          view.showLabels = v.showLabels !== false
          selectedId = v.selected || null
          requestDraw()
        } catch {}
      }
      function setPath(ids: any) {
        try {
          if (!ids || !ids.length) { pathNodeSet = null; pathEdgeSet = null; requestDraw(); return }
          pathNodeSet = new Set(ids)
          pathEdgeSet = new Set()
          for (let i = 0; i < ids.length - 1; i++) {
            const a = indexById[String(ids[i])], b = indexById[String(ids[i + 1])]
            if (a != null && b != null) pathEdgeSet.add(Math.min(a, b) + '-' + Math.max(a, b))
          }
          requestDraw()
          kick(0.25)
        } catch {}
      }
      function setFocus(id: any) {
        try {
          if (!id) { focusSet = null; requestDraw(); return }
          const set = new Set([String(id)])
          for (const e of simEdges) {
            const a = simNodes[e.a], b = simNodes[e.b]
            if (!a || !b) continue
            if (a.id === id) set.add(b.id)
            else if (b.id === id) set.add(a.id)
          }
          focusSet = set
          selectedId = String(id)
          fit()
          requestDraw()
        } catch {}
      }

      /* ── 事件（原生监听：wheel 必须 passive:false 才能 preventDefault） ── */
      function applyZoomAt(nextZoom: any, sx: any, sy: any) {
        const z = graphClamp(nextZoom, 0.1, 4)
        if (!isFinite(z) || z === zoom) return
        panX = sx - (sx - panX) * (z / zoom)
        panY = sy - (sy - panY) * (z / zoom)
        zoom = z
        userAdjusted = true      // 用户接管视图后，resize 不再强制 fit
        requestDraw()
      }
      function onWheel(ev: any) {
        try {
          if (ev.preventDefault) ev.preventDefault()
          const p = localPt(ev)
          applyZoomAt(zoom * Math.exp(-(ev.deltaY || 0) * 0.0015), p.x, p.y)
        } catch {}
      }
      function onDown(ev: any) {
        try {
          if (ev.button !== undefined && ev.button > 0) return
          const p = localPt(ev)
          pointers.set(ev.pointerId, p)
          try { if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId) } catch {}
          if (pointers.size === 2) {
            const arr = Array.from(pointers.values()) as any[]
            const p1 = arr[0], p2 = arr[1]
            pinch = { dist: Math.sqrt((p1.x - p2.x) * (p1.x - p2.x) + (p1.y - p2.y) * (p1.y - p2.y)) || 1 }
            drag = null
            pan = null
            return
          }
          if (pointers.size > 2) return
          downPt = p
          const hit = hitTest(p.x, p.y)
          if (hit) drag = { id: hit.id, moved: false }
          else pan = { x: p.x, y: p.y, panX, panY, moved: false }
        } catch {}
      }
      function onMove(ev: any) {
        try {
          const p = localPt(ev)
          hoverPos = p
          if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p)
          if (pinch && pointers.size === 2) {
            const arr = Array.from(pointers.values()) as any[]
            const p1 = arr[0], p2 = arr[1]
            const d = Math.sqrt((p1.x - p2.x) * (p1.x - p2.x) + (p1.y - p2.y) * (p1.y - p2.y)) || 1
            applyZoomAt(zoom * (d / pinch.dist), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
            pinch.dist = d
            return
          }
          if (drag) {
            const node = byId[drag.id]
            if (!node) return
            const moved = Math.abs(p.x - downPt.x) + Math.abs(p.y - downPt.y) > 3
            if (moved) drag.moved = true
            if (drag.moved) {
              const w = worldOf(p.x, p.y)
              node.x = w.x
              node.y = w.y
              node.vx = 0
              node.vy = 0
              node.pinned = true          // 拖拽即钉住（pin），重置视图可解钉
              alpha = Math.max(alpha, 0.25)
              kick(0.25)
              return
            }
          }
          if (pan) {
            pan.moved = Math.abs(p.x - pan.x) + Math.abs(p.y - pan.y) > 3
            if (pan.moved) userAdjusted = true
            panX = pan.panX + (p.x - pan.x)
            panY = pan.panY + (p.y - pan.y)
            if (canvas.style) canvas.style.cursor = 'grabbing'
            requestDraw()
            return
          }
          const hit = hitTest(p.x, p.y)
          const hId = hit ? hit.id : null
          if (canvas.style) canvas.style.cursor = hId ? 'pointer' : 'grab'
          if (hId !== hoverId) { hoverId = hId; requestDraw() }
          else if (hId) requestDraw()
        } catch {}
      }
      function onUp(ev: any) {
        try {
          const p = localPt(ev)
          pointers.delete(ev.pointerId)
          if (pointers.size < 2) pinch = null
          if (drag) {
            if (drag.moved) kick(0.35)
            else {
              // 单击：选中；Shift+点击 = 路径分析（A→B）
              const node = byId[drag.id]
              if (node) {
                if (ev.shiftKey && selectedId && selectedId !== node.id) onRequestPath(selectedId, node.id)
                else onSelect(node.id)
              }
            }
            drag = null
          } else if (pan) {
            if (!pan.moved) onSelect(null)   // 点空白 = 关闭详情
            pan = null
          }
          downPt = null
          if (canvas.style) canvas.style.cursor = hoverId ? 'pointer' : 'grab'
        } catch {}
      }
      function onLeave() {
        try { hoverId = null; hoverPos = null; requestDraw() } catch {}
      }
      function onDblClick(ev: any) {
        try {
          const p = localPt(ev)
          const hit = hitTest(p.x, p.y)
          if (hit) { setFocus(hit.id); onSelect(hit.id) }   // 双击节点 = 聚焦 1 跳邻域
          else reset()                                       // 双击空白 = 重置视图
        } catch {}
      }

      /* ── 装配 / 销毁 ── */
      let ro: any = null
      try {
        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onUp)
        canvas.addEventListener('pointerleave', onLeave)
        canvas.addEventListener('wheel', onWheel, { passive: false })
        canvas.addEventListener('dblclick', onDblClick)
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => { try { resize(); requestDraw() } catch {} })
          ro.observe(wrap || canvas)
        } else if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener('resize', resize)
        }
      } catch {}

      resize()
      schedule()

      return {
        ok: true,
        kick: kick,
        requestDraw: requestDraw,
        destroy() {
          try {
            if (raf != null) cafFn(raf)
            raf = null
            canvas.removeEventListener('pointerdown', onDown)
            canvas.removeEventListener('pointermove', onMove)
            canvas.removeEventListener('pointerup', onUp)
            canvas.removeEventListener('pointercancel', onUp)
            canvas.removeEventListener('pointerleave', onLeave)
            canvas.removeEventListener('wheel', onWheel)
            canvas.removeEventListener('dblclick', onDblClick)
            if (ro && ro.disconnect) ro.disconnect()
            if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', resize)
          } catch {}
        },
        setLayout: setLayout,
        setView: setView,
        setPath: setPath,
        setFocus: setFocus,
        fit: fit,
        reset: reset,
        focusNode: focusNode,
        resize: resize,
        layoutMode: () => layoutMode,
      }
    }

    /**
     * NativeGraphView — 契约 §3 的原生交互图谱（真组件；hook 数量恒定）。
     * props: { data: /api/graph 响应, stats?: /api/stats, api?: (p,opts)=>Promise }
     * api 是可选的（父层若未传，路径分析降级为同源直接 fetch，失败静默）。
     */
    function NativeGraphView(props) {
      const liveRef = React.useRef({})
      liveRef.current = { api: props && props.api, wsKey: props && props.wsKey }   // 每次渲染刷新最新 props（供异步回调用）

      const raw: any = (props && props.data) || {}
      const nodes: any[] = Array.isArray(raw.nodes) ? raw.nodes : []
      const edges: any[] = Array.isArray(raw.edges) ? raw.edges : []
      const nodeMeta: any = (raw.nodeMeta && typeof raw.nodeMeta === 'object') ? raw.nodeMeta : GRAPH_NODE_META
      const edgeMeta: any = (raw.edgeMeta && typeof raw.edgeMeta === 'object') ? raw.edgeMeta : GRAPH_EDGE_META

      /* ── hooks：全部在组件顶部，跨渲染数量恒定（R9） ── */
      const canvasRef = React.useRef(null)
      const wrapRef = React.useRef(null)
      const engineRef = React.useRef(null)
      const searchRef = React.useRef(null)
      const aliveRef = React.useRef(true)
      const pathRequestRef = React.useRef(null)

      const [selected, setSelected] = React.useState(null)
      const [layout, setLayout] = React.useState('force')
      const [showLabels, setShowLabels] = React.useState(true)
      const [hiddenTypes, setHiddenTypes] = React.useState(() => new Set())
      const [hiddenEdges, setHiddenEdges] = React.useState(() => new Set())
      const [showOrphans, setShowOrphans] = React.useState(true)
      const [searchQ, setSearchQ] = React.useState('')
      const [searchHit, setSearchHit] = React.useState(0)
      const [pathState, setPathState] = React.useState({ from: null, to: null, path: null, loading: false, error: null })
      const [narrow, setNarrow] = React.useState(false)
      const [canvasOk, setCanvasOk] = React.useState(true)
      const [focusId, setFocusId] = React.useState(null)

      // 本地降级分析（analytics 缺失时作为唯一事实源；也用于抽屉的任意节点 PageRank）
      const local: any = React.useMemo(() => graphLocalAnalytics(nodes, edges), [nodes, edges])
      const nodeIndex: any = React.useMemo(() => {
        const m: any = {}
        for (const n of nodes) if (n && n.id != null) m[String(n.id)] = n
        return m
      }, [nodes])
      const typeChips: any[] = React.useMemo(() => {
        const seen: any = {}
        for (const n of nodes) if (n && n.type) seen[String(n.type)] = true
        return Object.keys(seen).map(t => ({ type: t, meta: nodeMeta[t] || GRAPH_NODE_META[t] || { label: t, color: '#94a3b8', icon: '•', layer: 0 } }))
          .sort((a, b) => (a.meta.layer || 0) - (b.meta.layer || 0) || String(a.meta.label).localeCompare(String(b.meta.label)))
      }, [nodes, nodeMeta])
      const edgeChips: any[] = React.useMemo(() => {
        const seen: any = {}
        for (const e of edges) if (e && e.rel) seen[String(e.rel)] = true
        return Object.keys(seen).map(r => ({ rel: r, meta: edgeMeta[r] || GRAPH_EDGE_META[r] || { label: r, color: '#94a3b8' } }))
      }, [edges, edgeMeta])
      const searchMatches: any[] = React.useMemo(() => {
        const q = String(searchQ || '').trim().toLowerCase()
        if (!q) return []
        const out: any[] = []
        for (const n of nodes) {
          if (!n) continue
          const label = String(n.label == null ? n.id : n.label)
          const hay = (label + ' ' + String(n.id == null ? '' : n.id)).toLowerCase()
          const score = graphFuzzyIndex(hay, q)
          if (score < 0) continue
          out.push({ id: String(n.id), label, score })
        }
        out.sort((a, b) => a.score - b.score || (a.label < b.label ? -1 : 1))
        return out.slice(0, 8)
      }, [searchQ, nodes])
      const metrics: any = React.useMemo(() => {
        try {
          const gm = raw.metrics || {}
          const an = raw.analytics || {}
          const num = (v: any, d: any) => (typeof v === 'number' && isFinite(v)) ? v : d
          return {
            V: num(gm.V, nodes.length),
            E: num(gm.E, edges.length),
            density: num(gm.density, local.density),
            components: num(gm.components, local.components),
            orphans: Array.isArray(gm.orphans) ? gm.orphans.length : local.orphans.length,
            health: (raw.health && typeof raw.health.total === 'number') ? raw.health.total : null,
            communities: Array.isArray(an.communities) ? an.communities.length : local.communities.length,
            clustering: (an.clustering && typeof an.clustering.avg === 'number') ? an.clustering.avg : local.clustering.avg,
          }
        } catch { return { V: nodes.length, E: edges.length, density: 0, components: 0, orphans: 0, health: null, communities: 0, clustering: 0 } }
      }, [raw, nodes, edges, local])

      /* ── 异步回调（组件卸载后不再 setState） ── */
      const requestPath = React.useCallback(async (from: any, to: any) => {
        if (!from || !to || from === to) return
        setPathState({ from, to, path: null, loading: true, error: null })
        try {
          let d: any = null
          const api = liveRef.current && liveRef.current.api
          const qs = '?from=' + encodeURIComponent(String(from)) + '&to=' + encodeURIComponent(String(to))
          if (typeof api === 'function') d = await api('/graph/path' + qs)
          else if (typeof fetch === 'function') {
            const ws = liveRef.current && liveRef.current.wsKey
            const r = await fetch(MOUNT_PATH + '/api/graph/path' + qs + (ws ? '&ws=' + encodeURIComponent(String(ws)) : ''))
            d = await r.json()
          }
          if (!aliveRef.current) return
          if (d && d.found && Array.isArray(d.path) && d.path.length) setPathState({ from, to, path: d.path, loading: false, error: null })
          else setPathState({ from, to, path: null, loading: false, error: '两节点之间暂无无向可达路径' })
        } catch {
          // 静默降级：端点未就绪/网络失败不抛到渲染期，仅给一行灰字提示
          if (aliveRef.current) setPathState({ from, to, path: null, loading: false, error: '路径服务未就绪（已静默降级）' })
        }
      }, [])
      pathRequestRef.current = requestPath

      const locate = React.useCallback((id: any) => {
        setSelected(id == null ? null : String(id))
        try {
          const e = engineRef.current
          if (e && e.ok) e.focusNode(String(id))
        } catch {}
      }, [])

      /* ── 引擎装配（数据变化即重建；canvas/wrap 缺失时静默降级） ── */
      React.useEffect(() => {
        aliveRef.current = true
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        let eng: any = null
        try {
          eng = createGraphEngine({
            canvas, wrap, nodes, edges,
            presetLayout: graphReadPresetLayout(raw),
            layers: graphReadLayers(raw),
            nodeMeta, edgeMeta,
            onSelect: (id: any) => { try { setSelected(id == null ? null : String(id)) } catch {} },
            onRequestPath: (from: any, to: any) => { try { pathRequestRef.current && pathRequestRef.current(from, to) } catch {} },
          })
        } catch (e) {
          try { console.warn('[kaogong] 图谱引擎初始化失败（已降级为统计视图）:', e) } catch {}
          eng = graphEngineStub()
        }
        engineRef.current = eng
        setCanvasOk(!!(eng && eng.ok))
        return () => {
          aliveRef.current = false
          try { if (eng && eng.destroy) eng.destroy() } catch {}
          engineRef.current = null
        }
      }, [raw, nodes, edges])

      // 布局模式同步
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setLayout(layout) } catch {}
      }, [layout])

      // 过滤/标签/选中同步
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setView({ hiddenTypes, hiddenEdges, showOrphans, showLabels, selected }) } catch {}
      }, [hiddenTypes, hiddenEdges, showOrphans, showLabels, selected])

      // 路径高亮同步
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setPath(pathState.path || null) } catch {}
      }, [pathState.path])

      // 聚焦（1 跳邻域子图）同步
      React.useEffect(() => {
        const e = engineRef.current
        if (!e || !e.ok) return
        try { e.setFocus(focusId || null) } catch {}
      }, [focusId])

      // 窄屏检测（<520px：详情抽屉改底部面板，容器高度降到 320）
      React.useEffect(() => {
        const wrap = wrapRef.current
        if (!wrap) return
        let ro: any = null
        const measure = () => {
          try {
            const w = wrap.getBoundingClientRect ? wrap.getBoundingClientRect().width : (wrap.clientWidth || 0)
            if (w > 0) setNarrow(w < 520)
          } catch {}
        }
        try {
          if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(wrap) }
          else if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', measure)
          measure()
        } catch {}
        return () => {
          try { if (ro && ro.disconnect) ro.disconnect() } catch {}
          try { if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', measure) } catch {}
        }
      }, [])

      /* ── 交互处理器（普通函数，非组件，无 hook） ── */
      function toggleType(type: any) {
        setHiddenTypes((prev: any) => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next })
      }
      function toggleEdge(rel: any) {
        setHiddenEdges((prev: any) => { const next = new Set(prev); if (next.has(rel)) next.delete(rel); else next.add(rel); return next })
      }
      function pickSearchResult(id: any) {
        setSearchQ('')
        setSearchHit(0)
        locate(id)
      }
      function onSearchKey(ev: any) {
        const k = ev && ev.key
        if (k === 'Enter') {
          if (ev.preventDefault) ev.preventDefault()
          const hit = searchMatches[searchHit] || searchMatches[0]
          if (hit) pickSearchResult(hit.id)
        } else if (k === 'ArrowDown') {
          if (ev.preventDefault) ev.preventDefault()
          setSearchHit((i: any) => Math.min(searchMatches.length - 1, i + 1))
        } else if (k === 'ArrowUp') {
          if (ev.preventDefault) ev.preventDefault()
          setSearchHit((i: any) => Math.max(0, i - 1))
        } else if (k === 'Escape') {
          setSearchQ('')
          setSearchHit(0)
        }
      }
      function degreeOf(id: any) {
        try {
          const an = raw.analytics
          const d = an && an.degree && an.degree[id]
          if (d && typeof d.in === 'number') return { in: d.in, out: d.out, total: typeof d.total === 'number' ? d.total : d.in + d.out }
          return local.degree[id] || { in: 0, out: 0, total: 0 }
        } catch { return { in: 0, out: 0, total: 0 } }
      }
      function prOf(id: any) {
        try {
          const an = raw.analytics
          const fromAn = an && an.pagerank && an.pagerank[id]
          if (typeof fromAn === 'number') return fromAn.toFixed(4)
          const rk = Array.isArray(raw.rank) ? raw.rank.find((r: any) => r && r.id === id) : null
          if (rk && typeof rk.pr === 'number') return rk.pr.toFixed(4)
          const lv = local.pagerank[id]
          return typeof lv === 'number' ? lv.toFixed(4) : '—'
        } catch { return '—' }
      }
      function communityOf(id: any) {
        try {
          const an = raw.analytics
          const list = (an && Array.isArray(an.communities)) ? an.communities : local.communities
          for (let i = 0; i < list.length; i++) {
            const c = list[i] || {}
            if (Array.isArray(c.members) && c.members.indexOf(id) >= 0) return '#' + (i + 1) + '（' + (c.size || c.members.length) + ' 节点）'
          }
          return '—'
        } catch { return '—' }
      }
      function neighborRows(id: any) {
        const rows: any[] = []
        try {
          const seen: any = {}
          for (const e of edges) {
            if (!e) continue
            let other: any = null, dir = ''
            if (String(e.source) === String(id)) { other = e.target; dir = '→出' }
            else if (String(e.target) === String(id)) { other = e.source; dir = '←入' }
            if (other == null) continue
            const key = String(other) + '|' + String(e.rel || '')
            if (seen[key]) continue
            seen[key] = true
            const om = nodeIndex[String(other)]
            rows.push({
              key,
              other: String(other),
              label: om ? String(om.label == null ? om.id : om.label) : String(other),
              rel: String(e.rel || ''),
              relLabel: (edgeMeta[e.rel] && edgeMeta[e.rel].label) || (GRAPH_EDGE_META[e.rel] && GRAPH_EDGE_META[e.rel].label) || String(e.rel || ''),
              dir,
            })
            if (rows.length >= 16) break
          }
        } catch {}
        return rows
      }

      // 考点掌握（既有 T-020 卡片，移到图谱下方；逻辑保持不变）
      const mastery: any = (props && props.stats && props.stats.mastery) || {}
      const mRows: any[] = entries(mastery)
        .map(([m, v]: any) => ({ m, answered: v.answered || 0, correct: v.correct || 0, rate: v.answered ? Math.round(v.correct / v.answered * 100) : 0 }))
        .filter((r: any) => r.answered > 0)
        .sort((a: any, b: any) => a.rate - b.rate)

      const hasNodes = nodes.length > 0
      // 画布高度响应式：窄屏 320 / 常规 520 / 宽屏（≥1100px）600
      // 桌面端全屏面板可用高度充裕，460 会让 141 节点图过度拥挤。
      const wide = typeof window !== 'undefined' && (window as any).innerWidth >= 1100
      const graphH = narrow ? 320 : (wide ? 600 : 520)
      const selectedNode: any = selected ? nodeIndex[selected] : null
      const gbtn = (label: string, on: boolean, fn: any) => h('button', { key: label, style: Object.assign({}, G_BTN, on ? G_BTN_ON : {}), onClick: fn }, label)
      const shortId = (id: any) => {
        const s = String(id == null ? '' : id)
        return s.length > 22 ? '…' + s.slice(-21) : s
      }

      /** 详情抽屉（宽屏右栏 / 窄屏底部面板同一份内容） */
      function renderDrawer() {
        const n = selectedNode
        if (!n) return null
        const m = nodeMeta[n.type] || GRAPH_NODE_META[n.type] || { label: String(n.type || '未知'), color: '#94a3b8', icon: '•' }
        const deg = degreeOf(String(n.id))
        const rows = neighborRows(String(n.id))
        return h('div', {
          key: 'g-drawer',
          style: {
            width: narrow ? '100%' : 292, flexShrink: 0, boxSizing: 'border-box',
            background: 'var(--surface-card,#fff)', border: '1px solid rgba(148,163,184,.25)',
            borderRadius: 12, padding: 12, fontSize: 12,
            maxHeight: narrow ? 260 : graphH, overflowY: 'auto',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
            h('i', { style: { width: 10, height: 10, borderRadius: '50%', background: m.color, display: 'inline-block', flexShrink: 0 } }),
            h('span', { style: { fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(n.label == null ? n.id : n.label)),
            h('button', { style: Object.assign({}, G_BTN, { padding: '0 6px', fontSize: 14, lineHeight: 1.2 }), onClick: () => setSelected(null), 'aria-label': '关闭详情抽屉' }, '×')),
          h('div', { style: { fontFamily: 'monospace', fontSize: 10, color: '#94a3b8', wordBreak: 'break-all', marginBottom: 8 } }, String(n.id)),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
            h('span', { style: Object.assign({}, G_TAG, { background: m.color + '1a', color: m.color }) }, (m.icon || '•') + ' ' + (m.label || n.type)),
            h('span', { style: G_TAG }, '入 ' + deg.in + ' · 出 ' + deg.out),
            h('span', { style: G_TAG }, 'PageRank ' + prOf(String(n.id))),
            h('span', { style: G_TAG }, '社区 ' + communityOf(String(n.id)))),
          h('div', { style: { fontWeight: 700, fontSize: 11.5, margin: '4px 0 4px' } }, '邻接关系（' + rows.length + (rows.length >= 16 ? '+' : '') + '）'),
          rows.length
            ? rows.map(r => h('div', {
                key: r.key,
                style: { display: 'flex', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(148,163,184,.12)', cursor: 'pointer', alignItems: 'baseline' },
                onClick: () => locate(r.other),
                title: r.other,
              },
                h('span', { style: { color: '#94a3b8', fontSize: 10, width: 30, flexShrink: 0 } }, r.dir),
                h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.label),
                h('span', { style: { fontSize: 10, color: '#94a3b8', flexShrink: 0 } }, r.relLabel)))
            : h('div', { style: { fontSize: 11, color: '#94a3b8' } }, '无邻接边（可能是孤儿节点）'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 } },
            h('button', { style: G_BTN, onClick: () => setPathState({ from: String(n.id), to: pathState.to || null, path: null, loading: false, error: null }) }, '设为起点'),
            h('button', {
              style: G_BTN,
              onClick: () => {
                if (pathState.from && pathState.from !== String(n.id)) requestPath(pathState.from, String(n.id))
                else setPathState((s: any) => Object.assign({}, s, { to: String(n.id), path: null, error: null }))
              },
            }, pathState.from ? '设为终点并分析' : '设为终点'),
            h('button', { style: G_BTN, onClick: () => locate(String(n.id)) }, '居中'),
            h('button', { style: G_BTN, onClick: () => setFocusId(focusId ? null : String(n.id)) }, focusId ? '退出聚焦' : '聚焦 1 跳')),
          h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 8, lineHeight: 1.6 } },
            '提示：Shift+点击另一节点可直接做路径分析'))
      }

      return h('div', {},
        // ① 工具条
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
          h('span', { style: { fontSize: 12.5, fontWeight: 800, marginRight: 2 } }, '🕸️ 交互图谱'),
          gbtn('重置视图', false, () => { setFocusId(null); try { if (engineRef.current && engineRef.current.ok) engineRef.current.reset() } catch {} }),
          gbtn('适配画布', false, () => { try { if (engineRef.current && engineRef.current.ok) engineRef.current.fit() } catch {} }),
          gbtn(layout === 'force' ? '布局：力导向' : '布局：分层', true, () => setLayout((v: any) => (v === 'force' ? 'layered' : 'force'))),
          gbtn(showLabels ? '标签：开' : '标签：关', !!showLabels, () => setShowLabels((v: any) => !v)),
          gbtn(focusId ? '退出聚焦' : '聚焦选中', !!focusId, () => { if (selected) setFocusId(focusId ? null : selected) }),
          h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: '#94a3b8' } },
            '滚轮缩放 · 拖空白平移 · 拖节点钉住 · 双击节点聚焦 · Shift+点击做路径分析')),
        // ② 搜索
        h('div', { style: { position: 'relative', marginBottom: 8, maxWidth: 420 } },
          h('input', {
            ref: searchRef,
            value: searchQ,
            placeholder: '🔍 搜索节点标签（回车定位并选中）',
            onChange: (ev: any) => { setSearchQ(ev.target.value); setSearchHit(0) },
            onKeyDown: onSearchKey,
            style: { width: '100%', boxSizing: 'border-box', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'inherit', outline: 'none' },
          }),
          searchQ && searchMatches.length
            ? h('div', {
                style: { position: 'absolute', zIndex: 8, top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--surface-card,#fff)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, boxShadow: '0 10px 26px rgba(15,23,42,.14)', maxHeight: 236, overflowY: 'auto' },
              },
                searchMatches.map((mm: any, i: number) => h('div', {
                  key: mm.id,
                  style: { padding: '6px 10px', fontSize: 11.5, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline', background: i === searchHit ? 'rgba(99,102,241,.1)' : 'transparent' },
                  onClick: () => pickSearchResult(mm.id),
                },
                  h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, mm.label),
                  h('span', { style: { fontFamily: 'monospace', fontSize: 9.5, color: '#94a3b8' } }, shortId(mm.id)))))
            : searchQ ? h('div', { style: { fontSize: 11, color: '#94a3b8', marginTop: 4 } }, '无匹配节点') : null),
        // ③ 节点类型 chips + 孤儿开关
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 7 } },
          h('span', { style: { fontSize: 10, color: '#94a3b8', marginRight: 2 } }, '节点类型'),
          typeChips.map((c: any) => h('button', {
            key: c.type,
            onClick: () => toggleType(c.type),
            title: '点击显示/隐藏「' + (c.meta.label || c.type) + '」节点',
            style: Object.assign({}, G_CHIP, {
              borderColor: c.meta.color + '66',
              background: hiddenTypes.has(c.type) ? 'transparent' : c.meta.color + '1f',
              color: hiddenTypes.has(c.type) ? '#94a3b8' : c.meta.color,
              opacity: hiddenTypes.has(c.type) ? 0.55 : 1,
            }),
          }, (c.meta.icon || '•') + ' ' + (c.meta.label || c.type))),
          h('button', {
            onClick: () => setShowOrphans((v: any) => !v),
            title: '孤儿 = 度数为 0 的节点',
            style: Object.assign({}, G_CHIP, { opacity: showOrphans ? 1 : 0.55 }),
          }, '孤儿：' + (showOrphans ? '显示' : '隐藏'))),
        // ④ 边类型图例（可点击切换显隐）
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8, fontSize: 10.5, color: '#64748b' } },
          h('span', { style: { fontSize: 10, color: '#94a3b8' } }, '边类型'),
          edgeChips.map((ec: any) => h('span', {
            key: ec.rel,
            title: '点击显示/隐藏「' + (ec.meta.label || ec.rel) + '」边',
            onClick: () => toggleEdge(ec.rel),
            style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', opacity: hiddenEdges.has(ec.rel) ? 0.35 : 1, whiteSpace: 'nowrap' },
          },
            h('i', { style: { width: 14, height: 2, background: ec.meta.color, display: 'inline-block', borderRadius: 2 } }),
            ec.meta.label || ec.rel))),
        // ⑤ 画布 + 详情抽屉
        h('div', { style: { display: 'flex', gap: 10, flexDirection: 'row', alignItems: 'stretch' } },
          h('div', {
            ref: wrapRef,
            style: { position: 'relative', flex: '1 1 420px', minWidth: 0, height: graphH, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(148,163,184,.25)', background: '#f8fafc' },
          },
            h('canvas', {
              ref: canvasRef,
              role: 'img',
              'aria-label': '知识图谱交互画布：' + nodes.length + ' 个节点、' + edges.length + ' 条边',
              style: { display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: hasNodes ? 'grab' : 'default' },
            }),
            !hasNodes
              ? h('div', { style: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#64748b', fontSize: 12.5, textAlign: 'center', padding: 16, pointerEvents: 'none' } },
                  h('div', { style: { fontSize: 24 } }, '🕸️'),
                  h('div', null, '图谱暂无节点数据'),
                  h('div', { style: { fontSize: 11, color: '#94a3b8' } }, '数据层降级：/api/graph 未返回 nodes（不是渲染错误，其他视图不受影响）'))
              : null,
            !canvasOk && hasNodes
              ? h('div', { style: { position: 'absolute', left: 10, bottom: 10, fontSize: 10.5, color: '#b45309', background: 'rgba(255,255,255,.92)', padding: '3px 8px', borderRadius: 8 } },
                  'Canvas 2D 不可用 · 已降级为只读统计')
              : null),
          !narrow && selectedNode
            ? h('div', { style: { flex: '0 0 auto' } }, renderDrawer())
            : null),
        // ⑥ 窄屏底部抽屉（<520px）
        narrow && selectedNode ? h('div', { style: { marginTop: 8 } }, renderDrawer()) : null,
        // ⑦ 路径分析状态行（失败只给灰字，不 role=alert）
        pathState.path
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: '#b45309' } },
              h('span', null, '🛤 路径 ' + shortId(pathState.from) + ' → ' + shortId(pathState.to) + ' · ' + Math.max(0, pathState.path.length - 1) + ' 跳：' + pathState.path.map((x: any) => shortId(x)).join(' → ')),
              h('button', { style: G_BTN, onClick: () => setPathState({ from: null, to: null, path: null, loading: false, error: null }) }, '清除路径'))
          : pathState.loading
            ? h('div', { style: { marginTop: 8, fontSize: 11, color: '#64748b' } }, '路径分析中…')
            : pathState.error
              ? h('div', { style: { marginTop: 8, fontSize: 10.5, color: '#94a3b8' } }, '⚠ ' + pathState.error)
              : pathState.from
                ? h('div', { style: { marginTop: 8, fontSize: 10.5, color: '#94a3b8' } }, '路径起点：' + shortId(pathState.from) + ' —— 按住 Shift 点击终点节点，或到详情抽屉点「设为终点并分析」')
                : null,
        // ⑧ 指标条
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8, marginTop: 12, marginBottom: 12 } },
          h(Stat, { v: metrics.V, l: '节点 |V|', color: '#6366f1' }),
          h(Stat, { v: metrics.E, l: '边 |E|', color: '#8b5cf6' }),
          h(Stat, { v: metrics.density, l: '密度 ρ' }),
          h(Stat, { v: metrics.components, l: '连通分量' }),
          h(Stat, { v: metrics.orphans, l: '孤儿', color: metrics.orphans ? '#ef4444' : '#10b981' }),
          h(Stat, { v: metrics.health == null ? '—' : metrics.health, l: '健康度', color: metrics.health == null ? '#64748b' : (metrics.health >= 80 ? '#10b981' : '#f59e0b') }),
          h(Stat, { v: metrics.communities, l: '社区数', color: '#8b5cf6' }),
          h(Stat, { v: metrics.clustering, l: '平均集聚系数' })),
        // ⑨ 保留：PageRank 中心节点（服务端 rank 缺失时用本地幂迭代兜底）
        h(Card, { title: '⭐ 中心节点 top8（PageRank 幂迭代 d=0.85）' },
          (() => {
            const rk: any[] = Array.isArray(raw.rank) && raw.rank.length
              ? raw.rank.slice(0, 8)
              : entries(local.pagerank).sort((a: any, b: any) => b[1] - a[1]).slice(0, 8).map(([id, v]: any) => ({ id, pr: v }))
            const maxPr = rk.reduce((mx: number, r: any) => Math.max(mx, Number(r.pr) || 0), 0) || 1
            return rk.length
              ? rk.map((r: any) => h('div', { key: r.id, style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 12 } },
                  h('span', { title: String(r.id), style: { width: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 10.5, cursor: 'pointer' }, onClick: () => locate(String(r.id)) }, String(r.id)),
                  h('div', { style: { flex: 1 } }, h(Bar, { pct: Math.min(100, (Number(r.pr) || 0) / maxPr * 100) })),
                  h('span', { style: { width: 62, textAlign: 'right', color: '#64748b' } }, Number(r.pr || 0).toFixed(4))))
              : h('div', { style: { fontSize: 11.5, color: '#64748b' } }, '暂无中心性数据')
          })()),
        // ⑩ 既有「我的考点掌握」卡片（数据来自 props.stats.mastery，逻辑保持原样）
        h(Card, { title: '🔥 我的考点掌握（弱 → 强）' },
          mRows.length === 0
            ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '暂无作答数据 —— 去「刷题」或「模考」后再看')
            : mRows.map((r: any) => h('div', { key: r.m, style: { marginBottom: 9 } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 } },
                  h('span', null, r.m),
                  h('span', { style: { color: '#64748b' } }, r.correct + '/' + r.answered + ' · ' + r.rate + '%')),
                h(Bar, { pct: r.rate, color: r.rate >= 75 ? 'linear-gradient(135deg,#10b981,#34d399)' : r.rate >= 50 ? undefined : 'linear-gradient(135deg,#ef4444,#f87171)' })))))
    }

    /* ═══════════════════════════════════════════════════════════════════════
       NativeObsView — 白盒管理/可观测面板（v1.8.0 重做）
       契约 §4 覆盖：A 学习质量 · B 运行态 · C 生命周期 stepper · D 能力对账
                    · E 慢端点 TOP · F 告警 · G 命名空间 · H 管理动作
       设计原则：
       ① 所有接口字段都视为「可选」——端点未就绪/字段缺失一律降级为空态，绝不抛错；
       ② 表格默认 p95 降序（性能问题第一屏可见），可点表头切换排序方向；
       ③ sparkline 用内联 SVG polyline（零依赖、无 hook、无副作用）；
       ④ 事件一律 onClick 驼峰（R6 事故）；hook 全部在组件顶部、数量恒定（R9）。
       ═══════════════════════════════════════════════════════════════════════ */

    /** 迷你折线（纯 SVG，无 canvas/无 hook；样本不足 2 个返回占位） */
    function Sparkline({ series, color, width = 84, height: hh = 20 }) {
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
    function stageColor(state) {
      if (state === 'done') return { bg: 'rgba(16,185,129,.12)', fg: '#059669', dot: '#10b981' }
      if (state === 'current') return { bg: 'rgba(99,102,241,.14)', fg: '#4f46e5', dot: '#6366f1' }
      return { bg: 'rgba(148,163,184,.14)', fg: '#94a3b8', dot: '#cbd5e1' }
    }
    /** 告警分级配色 */
    function alertColor(level) {
      if (level === 'error') return { bg: 'rgba(239,68,68,.1)', fg: '#dc2626', border: 'rgba(239,68,68,.35)', icon: '⛔' }
      if (level === 'warn') return { bg: 'rgba(245,158,11,.1)', fg: '#b45309', border: 'rgba(245,158,11,.35)', icon: '⚠️' }
      return { bg: 'rgba(148,163,184,.1)', fg: '#64748b', border: 'rgba(148,163,184,.3)', icon: 'ℹ️' }
    }

    function NativeObsView(props) {
      const data: any = (props && props.data) || {}
      const tel: any = data.tel || {}
      const caps: any = data.caps || {}
      const life: any = data.life || null
      const wsList: any[] = Array.isArray(data.workspaces) ? data.workspaces : (Array.isArray(data.wsList) ? data.wsList : [])

      /* ── hooks：全部在顶部声明，跨渲染数量恒定（R9） ── */
      const [sortKey, setSortKey] = React.useState('p95')     // p95 | count | p50 | errRate | path
      const [sortAsc, setSortAsc] = React.useState(false)
      const [filter, setFilter] = React.useState('')
      const [onlyProblems, setOnlyProblems] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [lastAt, setLastAt] = React.useState(null)

      const ins: any = (props && props.insight) || {}
      const eps: any = tel.endpoints || {}
      const consumed = new Set(Object.keys(eps))
      const declared: any[] = Array.isArray(caps.endpoints) ? caps.endpoints : []
      const recon: any = caps.reconciliation || {}
      const orphanEndpoints = new Set(Array.isArray(recon.orphanEndpoints) ? recon.orphanEndpoints : [])
      const unconsumedEndpoints = new Set(Array.isArray(recon.unconsumedEndpoints) ? recon.unconsumedEndpoints : [])

      /* ── 行数据：声明端点 ∪ 运行态端点（并集，暴露「未声明」影子端点） ── */
      const rows: any[] = React.useMemo(() => {
        const out: any[] = []
        for (const d of declared) {
          const p = String(d.path || '')
          const r: any = eps[p] || {}
          out.push({
            path: p, label: String(d.label || ''), consumers: Array.isArray(d.consumers) ? d.consumers : [],
            count: r.count || 0, errors: r.errors || 0,
            errRate: typeof r.errRate === 'number' ? r.errRate : 0,
            p50: r.p50 || 0, p95: r.p95 || 0, series: r.series || [],
            active: consumed.has(p), orphan: orphanEndpoints.has(p), undeclared: false,
          })
        }
        // 运行态出现但 manifest 未登记的端点 = 绕过单一事实源的调用（白盒断裂证据）
        for (const p of Object.keys(eps)) {
          if (declared.some(d => String(d.path) === p)) continue
          const r: any = eps[p] || {}
          out.push({
            path: p, label: '未在 manifest 声明', consumers: [],
            count: r.count || 0, errors: r.errors || 0, errRate: r.errRate || 0,
            p50: r.p50 || 0, p95: r.p95 || 0, series: r.series || [],
            active: true, orphan: false, undeclared: true,
          })
        }
        return out
      }, [declared, eps, orphanEndpoints, consumed])

      /* ── 过滤 + 排序（表格视图） ── */
      const viewRows: any[] = React.useMemo(() => {
        let list = rows
        const q = String(filter || '').trim().toLowerCase()
        if (q) list = list.filter(r => (r.path + ' ' + r.label).toLowerCase().includes(q))
        // 「问题」= 真实被调用过且慢/有错误，或绕过 manifest 的未声明端点。
        // 从未被调用的端点 p95=0 属于「未触达」，不是性能问题（否则 40+ 端点全算问题）。
        if (onlyProblems) list = list.filter(r => r.undeclared || (r.count > 0 && (r.p95 > 200 || r.errRate > 0.01)))
        const dir = sortAsc ? 1 : -1
        const copy = [...list]
        copy.sort((a, b) => {
          if (sortKey === 'path') return (sortAsc ? 1 : 1) * (a.path < b.path ? 1 : a.path > b.path ? -1 : 0)
          return dir * (((a[sortKey] || 0) - (b[sortKey] || 0)) || 0)
        })
        return copy
      }, [rows, filter, onlyProblems, sortKey, sortAsc])

      const hist: any = tel.histogram || {}
      const alertsRows: any[] = Array.isArray(tel.alerts) ? tel.alerts : []
      const topSlow: any[] = Array.isArray(tel.topSlow) ? tel.topSlow : []
      const stages: any[] = Array.isArray(life && life.stages) ? life.stages : []
      const lifeEvents: any[] = Array.isArray(life && life.events) ? life.events.slice(-12).reverse() : []

      const essayAvg = (ins.essay && ins.essay.avgRatio) || 0
      const examAvg = (ins.exam && ins.exam.avgRate) || 0
      const essayN = (ins.essay && ins.essay.total) || 0
      const examN = (ins.exam && ins.exam.total) || 0

      const coverage = typeof tel.coverage === 'number' ? tel.coverage : (declared.length ? Object.keys(eps).length / declared.length : 0)
      const problemCount = rows.filter(r => r.undeclared || (r.count > 0 && (r.p95 > 200 || r.errRate > 0.01))).length
      const maxP95 = Math.max.apply(null, [1].concat(rows.map(r => r.p95 || 0)))

      const th: any = { textAlign: 'left', padding: '7px 8px', fontSize: 11, color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(148,163,184,.3)' }
      const thSort: any = { ...th, cursor: 'pointer', userSelect: 'none' }
      const td: any = { padding: '6px 8px', fontSize: 11.5, borderBottom: '1px solid rgba(148,163,184,.12)', verticalAlign: 'middle' }
      const doSort = (key: any) => {
        if (sortKey === key) setSortAsc(a => !a)
        else { setSortKey(key); setSortAsc(false) }
      }
      const sortHead = (key: any, label: any) => h('th', {
        style: Object.assign({}, thSort, { color: sortKey === key ? '#4f46e5' : '#64748b' }),
        onClick: () => doSort(key),
        title: '点击按「' + label + '」排序',
      }, label + (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''))

      /* ── 管理动作：刷新 / 导出诊断 / 复制摘要 ── */
      const doRefresh = () => {
        if (busy) return
        setBusy(true)
        try { if (typeof props.onReload === 'function') props.onReload() } catch {}
        setTimeout(() => { setBusy(false); setLastAt(new Date()) }, 500)
      }
      const doExport = () => {
        try {
          const payload = {
            exportedAt: new Date().toISOString(),
            plugin: { id: (caps.plugin && caps.plugin.id) || 'kaogong', version: (caps.plugin && caps.plugin.version) || '?' },
            telemetry: {
              uptimeSec: tel.uptimeSec || 0, totalRequests: tel.totalRequests || 0,
              qpsWindow: tel.qpsWindow || 0, coverage, histogram: hist, alerts: alertsRows,
            },
            endpoints: rows.map(r => ({
              path: r.path, label: r.label, count: r.count, errors: r.errors,
              errRate: r.errRate, p50: r.p50, p95: r.p95, active: r.active, orphan: r.orphan, undeclared: r.undeclared,
            })),
            reconciliation: recon,
            lifecycle: life,
            workspaces: wsList,
            insight: ins,
          }
          const text = JSON.stringify(payload, null, 2)
          if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
            const blob = new Blob([text], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'dsh-kaogong-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 800)
          }
        } catch {}
      }
      const doCopy = () => {
        try {
          const summary = rows
            .map(r => [r.path, r.count, 'p50=' + r.p50 + 'ms', 'p95=' + r.p95 + 'ms', 'err=' + (r.errRate * 100).toFixed(1) + '%', r.undeclared ? '未声明' : r.orphan ? '孤儿' : r.active ? '活跃' : '未触达'].join('\t'))
            .join('\n')
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(summary)
        } catch {}
      }
      const mgBtn = (label: any, fn: any, title: any) => h('button', {
        key: label, onClick: fn, title: title || label,
        style: { border: '1px solid rgba(148,163,184,.4)', background: 'rgba(255,255,255,.7)', color: '#475569', borderRadius: 9, padding: '5px 11px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' },
      }, label)

      return h('div', {},
        /* ── H 管理动作条 ── */
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: '8px 12px', borderRadius: 12, background: 'rgba(148,163,184,.08)', border: '1px solid rgba(148,163,184,.2)' } },
          h('span', { style: { fontWeight: 800, fontSize: 12.5, color: '#334155' } }, '📡 白盒管理面板'),
          h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, '覆盖 ' + (coverage * 100).toFixed(0) + '% · ' + (lastAt ? '刷新于 ' + lastAt.toLocaleTimeString() : '实时')),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' } },
            mgBtn(busy ? '刷新中…' : '↻ 刷新', doRefresh, '重新拉取遥测/能力/生命周期'),
            mgBtn('⤓ 导出诊断', doExport, '下载完整诊断 JSON（仅本机数据，无凭据）'),
            mgBtn('⧉ 复制摘要', doCopy, '复制端点性能表为 TSV，便于贴给模型分析'))),

        /* ── F 告警区（有告警才出现，避免视觉噪音）── */
        alertsRows.length
          ? h(Card, { title: '🚨 运行告警 · ' + alertsRows.length + ' 条' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                alertsRows.slice(0, 8).map((a, i) => {
                  const c = alertColor(a.level)
                  return h('div', { key: 'al' + i, style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', borderRadius: 9, background: c.bg, border: '1px solid ' + c.border } },
                    h('span', null, c.icon),
                    h('span', { style: { fontSize: 11.5, color: c.fg, lineHeight: 1.6 } }, String(a.msg || '')))
                })))
          : null,

        /* ── A 学习质量 ── */
        h(Card, { title: '📈 我的学习质量' },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 } },
            h(Stat, { v: essayN ? essayAvg + '%' : '—', l: '申论均分率 · ' + essayN + ' 次', color: essayAvg >= 60 ? '#10b981' : '#f59e0b' }),
            h(Stat, { v: examN ? examAvg + '%' : '—', l: '模考均分率 · ' + examN + ' 场', color: examAvg >= 60 ? '#10b981' : '#f59e0b' }),
            h(Stat, { v: (ins.essay && ins.essay.recent && ins.essay.recent.length) || 0, l: '近期申论记录' }),
            h(Stat, { v: (ins.exam && ins.exam.recent && ins.exam.recent.length) || 0, l: '近期模考记录' }))),

        /* ── B 运行态 ── */
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8, marginBottom: 14 } },
          h(Stat, { v: (tel.uptimeSec || 0) + 's', l: '运行时长' }),
          h(Stat, { v: tel.totalRequests || 0, l: '总请求' }),
          h(Stat, { v: tel.qpsWindow || 0, l: 'QPS(60s)' }),
          h(Stat, { v: (coverage * 100).toFixed(0) + '%', l: '端点覆盖', color: coverage > .7 ? '#10b981' : '#f59e0b' }),
          h(Stat, { v: (tel.activeEndpoints || Object.keys(eps).length) + '/' + (tel.declaredEndpoints || declared.length), l: '活跃/声明' }),
          h(Stat, { v: problemCount, l: '问题端点', color: problemCount ? '#ef4444' : '#10b981' }),
          h(Stat, { v: (hist.p95 || 0) + 'ms', l: '全局 p95', color: (hist.p95 || 0) > 200 ? '#f59e0b' : '#10b981' }),
          h(Stat, { v: (hist.max || 0) + 'ms', l: '最慢样本' })),

        /* ── C 生命周期状态机 ── */
        h(Card, { title: '🔁 生命周期状态机' },
          stages.length
            ? h('div', null,
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', marginBottom: 12 } },
                  stages.map((s, i) => {
                    const c = stageColor(s.state)
                    return h('div', { key: String(s.stage), style: { display: 'flex', alignItems: 'center' } },
                      h('div', {
                        title: String(s.desc || '') + (s.at ? ' · ' + new Date(s.at).toLocaleTimeString() : ''),
                        style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
                      },
                        h('i', { style: { width: 7, height: 7, borderRadius: '50%', background: c.dot, display: 'inline-block' } }),
                        String(s.stage),
                        s.state === 'done' ? ' ✓' : s.state === 'current' ? ' ●' : ''),
                      i < stages.length - 1 ? h('span', { key: 'ar' + i, style: { color: '#cbd5e1', margin: '0 3px', fontSize: 11 } }, '→') : null)
                  })),
                lifeEvents.length
                  ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 190, overflowY: 'auto' } },
                      lifeEvents.map((e, i) => h('div', { key: 'ev' + i, style: { display: 'flex', gap: 8, fontSize: 10.5, color: '#64748b', padding: '2px 0', borderBottom: '1px dashed rgba(148,163,184,.15)' } },
                        h('span', { style: { fontFamily: 'monospace', color: '#94a3b8', flex: '0 0 62px' } }, String(e.ts || '').slice(11, 19)),
                        h('span', { style: { fontWeight: 700, color: '#475569' } }, String(e.event || '')),
                        e.port ? h('span', null, ':' + e.port) : null,
                        e.pid ? h('span', null, 'pid ' + e.pid) : null)))
                  : null)
            : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '生命周期端点未就绪（/api/lifecycle 未返回 stages）—— 服务可用，仅该卡片降级')),

        /* ── D 能力对账 + E 端点性能表（共用一张表，一屏看全） ── */
        h(Card, { title: '🧩 能力对账 × 端点性能（注册 → 生产 → 消费）' },
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, fontSize: 10.5 } },
            h('span', { style: G_TAG }, '声明 ' + declared.length),
            h('span', { style: G_TAG }, '活跃 ' + consumed.size),
            h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(239,68,68,.12)', color: '#dc2626' }) }, '孤儿 ' + orphanEndpoints.size),
            h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(245,158,11,.12)', color: '#b45309' }) }, '未触达 ' + unconsumedEndpoints.size),
            h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(16,185,129,.12)', color: '#059669' }) }, '无问题 ' + Math.max(0, declared.length - orphanEndpoints.size))),
          rows.length
            ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9, alignItems: 'center' } },
                h('input', {
                  value: filter, placeholder: '过滤端点路径 / 名称…',
                  onChange: (e) => setFilter(e && e.target ? e.target.value : ''),
                  'aria-label': '过滤端点',
                  style: { flex: '1 1 180px', minWidth: 130, padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,.35)', fontSize: 11.5, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'inherit' },
                }),
                h('button', { onClick: () => setOnlyProblems(v => !v), style: Object.assign({}, G_BTN, onlyProblems ? G_BTN_ON : {}) }, onlyProblems ? '✓ 仅问题端点' : '仅问题端点'),
                h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, viewRows.length + ' / ' + rows.length + ' 行'))
            : null,
          rows.length
            ? h('div', { style: { overflowX: 'auto' } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: 620 } },
                  h('thead', null, h('tr', null,
                    sortHead('path', '端点'),
                    sortHead('count', '次数'),
                    sortHead('p50', 'p50'),
                    sortHead('p95', 'p95'),
                    sortHead('errRate', '错误率'),
                    h('th', { key: 'spark', style: th }, '延迟趋势'),
                    h('th', { key: 'st', style: th }, '状态'))),
                  h('tbody', null, viewRows.slice(0, 60).map(r => {
                    const bad = r.p95 > 200 || r.errRate > 0.01
                    const statusBg = r.undeclared ? 'rgba(245,158,11,.15)' : r.orphan ? 'rgba(239,68,68,.15)' : r.active ? 'rgba(16,185,129,.15)' : 'rgba(148,163,184,.15)'
                    const statusFg = r.undeclared ? '#b45309' : r.orphan ? '#dc2626' : r.active ? '#059669' : '#64748b'
                    const statusText = r.undeclared ? '未声明' : r.orphan ? '孤儿' : r.active ? '活跃' : '未触达'
                    return h('tr', { key: r.path, style: { background: bad ? 'rgba(245,158,11,.045)' : 'transparent' } },
                      h('td', { style: Object.assign({}, td, { fontFamily: 'monospace', fontSize: 10.5 }) },
                        h('div', null, r.path),
                        (r.label && r.label !== '未在 manifest 声明')
                          ? h('div', { style: { fontSize: 9.5, color: '#94a3b8', marginTop: 1, fontFamily: 'inherit' } }, r.label + ' · ' + r.consumers.length + ' 消费者')
                          : null),
                      h('td', { style: td }, r.count),
                      h('td', { style: Object.assign({}, td, { color: r.p50 > 100 ? '#b45309' : 'inherit' }) }, r.p50 ? r.p50 + 'ms' : '—'),
                      h('td', { style: Object.assign({}, td, { fontWeight: bad ? 800 : 400, color: bad ? '#dc2626' : 'inherit' }) }, r.p95 ? r.p95 + 'ms' : '—'),
                      h('td', { style: Object.assign({}, td, { color: r.errRate > 0.01 ? '#dc2626' : '#94a3b8' }) }, r.errRate ? (r.errRate * 100).toFixed(1) + '%' : '0%'),
                      h('td', { style: td }, h(Sparkline, { series: r.series, color: bad ? '#ef4444' : '#6366f1' })),
                      h('td', { style: td }, h('span', { style: { background: statusBg, color: statusFg, padding: '2px 8px', borderRadius: 20, fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' } }, statusText)))
                  }))))
            : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '能力矩阵未就绪（/api/capabilities 未返回 endpoints）—— 服务可用，仅该卡片降级')),

        /* ── E 慢端点 TOP（性能优先级直读） ── */
        topSlow.length
          ? h(Card, { title: '🐌 慢端点 TOP（p95 降序）' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                topSlow.slice(0, 6).map(r => h('div', { key: String(r.path), style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 } },
                  h('span', { style: { flex: '0 0 auto', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 10.5 } }, String(r.path)),
                  h('div', { style: { flex: 1 } }, h(Bar, { pct: Math.min(100, Math.round(((r.p95 || 0) / maxP95) * 100)), color: (r.p95 || 0) > 200 ? 'linear-gradient(135deg,#ef4444,#f87171)' : undefined })),
                  h('span', { style: { flex: '0 0 66px', textAlign: 'right', color: '#64748b', fontSize: 10.5 } }, (r.p95 || 0) + 'ms · ' + (r.count || 0) + '次')))))
          : null,

        /* ── G 命名空间清单 ── */
        h(Card, { title: '🗂 工作区命名空间 · ' + wsList.length + ' 个' },
          wsList.length
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 170, overflowY: 'auto' } },
                wsList.slice(0, 40).map((w, i) => h('span', {
                  key: String(w.ns || w.label || i),
                  title: '答题 ' + (w.answered || 0) + ' · 正确率 ' + (w.rate || 0) + '%',
                  style: Object.assign({}, G_TAG, { fontFamily: 'monospace', fontSize: 10 }),
                }, String(w.ns || w.label || '?') + ' · D' + (w.day || 1) + ' · ' + (w.answered || 0) + '题')))
            : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '命名空间端点未就绪（/api/workspaces）—— 服务可用，仅该卡片降级')),

        /* ── 白盒口径说明 ── */
        h('div', { style: { fontSize: 10.5, color: '#94a3b8', lineHeight: 1.8, marginTop: 4 } },
          '口径：p50/p95 = 每端点最近 100 次请求的环形样本百分位；覆盖 = 运行态被触达端点数 / 声明端点数；',
          '孤儿 = 声明了但能力图上无人消费（矩阵断裂点）；「未声明」= 运行态出现但 manifest 未登记（绕过单一事实源的证据）。'))
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

      /**
       * 视图切换（v1.8.0 修复「重复点击同一视图永久 loading」）：
       * 原实现无条件 setData(null)，但父 effect 依赖 [channel, view, api, tick] ——
       * 重复点同一 tab 时 view 未变、effect 不重跑，于是 data 永远为 null，
       * 界面卡在 spinner（用户感知「图谱打不开」）。现在用 tick 强制重取：
       * 命中同一视图时自增 tick（effect 依赖含 tick，必然重新拉数据）。
       */
      const setView = React.useCallback((v: any, params?: any) => {
        localStorage.setItem('kg-native-view', v)
        setData(null)
        setViewParams(params || {})
        setViewRaw(prev => {
          if (prev === v) setTick(t => t + 1)   // 同一视图重入 → 强制刷新
          return v
        })
      }, [])

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
              // v1.8.0：并行拉齐白盒面板所需全部数据源，任一失败单独降级不影响其余卡片
              const [tel, caps, eh, xh, life, wss] = await Promise.all([
                api('/telemetry'),
                api('/capabilities'),
                api('/essay/history').catch(() => null),
                api('/paper/exam/history').catch(() => null),
                api('/lifecycle').catch(() => null),
                api('/workspaces').catch(() => null),
              ])
              if (!cancelled) setData({
                kind: 'obs', tel, caps,
                life: life || (caps && caps.lifecycle) || null,
                workspaces: (wss && wss.workspaces) || [],
                insight: { essay: eh, exam: xh },
              })
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
          data && data.kind === 'graph' ? h(NativeGraphView, { key: 'g' + tick, data: data.g, stats: data.stats, api, wsKey }) : null,
          data && data.kind === 'obs' ? h(NativeObsView, { key: 'o' + tick, data, insight: data.insight, onReload: () => setTick(t => t + 1) }) : null,
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
