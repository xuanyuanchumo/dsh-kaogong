// T-020：图谱加「考点掌握热力」、可观测加「学习质量」—— 让用户看到自己的画像
const fs = require('fs')
const p = 'src/client/client.ts'
let s = fs.readFileSync(p, 'utf8')

// 1) 父 effect：graph 分支补 stats，obs 分支补 essay/exam 历史
const oldGraph = `            } else if (view === 'graph') {
              const g = await api('/graph')
              if (!cancelled) setData({ kind: 'graph', g })`
const newGraph = `            } else if (view === 'graph') {
              const [g, statsI] = await Promise.all([api('/graph'), api('/stats').catch(() => null)])
              if (!cancelled) setData({ kind: 'graph', g, stats: statsI })`
if (!s.includes(oldGraph)) { console.error('graph 分支锚点未找到'); process.exit(1) }
s = s.replace(oldGraph, newGraph)

const oldObs = `            } else if (view === 'obs') {
              const [tel, caps] = await Promise.all([api('/telemetry'), api('/capabilities')])
              if (!cancelled) setData({ kind: 'obs', tel, caps })`
const newObs = `            } else if (view === 'obs') {
              const [tel, caps, eh, xh] = await Promise.all([
                api('/telemetry'), api('/capabilities'),
                api('/essay/history').catch(() => null),
                api('/paper/exam/history').catch(() => null),
              ])
              if (!cancelled) setData({ kind: 'obs', tel, caps, insight: { essay: eh, exam: xh } })`
if (!s.includes(oldObs)) { console.error('obs 分支锚点未找到'); process.exit(1) }
s = s.replace(oldObs, newObs)

// 2) 图谱视图：props 加 stats，顶部插入考点掌握热力卡
const oldGraphRender = `    function NativeGraphView(props) {
      const { metrics: M, health: H, rank } = props.data`
const newGraphRender = `    function NativeGraphView(props) {
      const { metrics: M, health: H, rank } = props.data
      // T-020：考点掌握热力（来自学习进度，反映"我"的薄弱点而非系统结构）
      const mastery = (props.stats && props.stats.mastery) || {}
      const mRows = entries(mastery)
        .map(([m, v]: any) => ({ m, answered: v.answered || 0, correct: v.correct || 0, rate: v.answered ? Math.round(v.correct / v.answered * 100) : 0 }))
        .filter((r: any) => r.answered > 0)
        .sort((a: any, b: any) => a.rate - b.rate)`
if (!s.includes(oldGraphRender)) { console.error('graphView 锚点未找到'); process.exit(1) }
s = s.replace(oldGraphRender, newGraphRender)

// 3) 图谱视图：在 return 的最前面插入热力卡
const oldGraphReturn = `      return h('div', {},
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 14 } },
          h(Stat, { v: M.V, l: '节点', color: '#6366f1' }),`
const newGraphReturn = `      return h('div', {},
        // T-020 考点掌握热力：直接回答"我哪个模块最弱"
        h(Card, { title: '🔥 我的考点掌握（弱 → 强）' },
          mRows.length === 0
            ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '暂无作答数据 —— 去「刷题」或「模考」积累后再看')
            : mRows.map((r: any) => h('div', { key: r.m, style: { marginBottom: 9 } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 } },
                  h('span', null, r.m),
                  h('span', { style: { color: '#64748b' } }, r.correct + '/' + r.answered + ' · ' + r.rate + '%')),
                h(Bar, { pct: r.rate, color: r.rate >= 75 ? 'linear-gradient(135deg,#10b981,#34d399)' : r.rate >= 50 ? undefined : 'linear-gradient(135deg,#ef4444,#f87171)' })))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 14 } },
          h(Stat, { v: M.V, l: '节点', color: '#6366f1' }),`
if (!s.includes(oldGraphReturn)) { console.error('graph return 锚点未找到'); process.exit(1) }
s = s.replace(oldGraphReturn, newGraphReturn)

// 4) 可观测视图：插入学习质量卡
const oldObsRender = `    function NativeObsView(props) {
      const { tel, caps } = props.data
      const consumed = new Set(Object.keys(tel.endpoints))`
const newObsRender = `    function NativeObsView(props) {
      const { tel, caps } = props.data
      const consumed = new Set(Object.keys(tel.endpoints))
      // T-020：学习质量（申论均分率 / 模考均分率 / 做题趋势）
      const ins = props.insight || {}
      const essayAvg = (ins.essay && ins.essay.avgRatio) || 0
      const examAvg = (ins.exam && ins.exam.avgRate) || 0
      const essayN = (ins.essay && ins.essay.total) || 0
      const examN = (ins.exam && ins.exam.total) || 0`
if (!s.includes(oldObsRender)) { console.error('obsView 锚点未找到'); process.exit(1) }
s = s.replace(oldObsRender, newObsRender)

const oldObsReturn = `      return h('div', {},
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 14 } },
          h(Stat, { v: tel.uptimeSec + 's', l: '运行时长' }), h(Stat, { v: tel.totalRequests, l: '总请求' }),`
const newObsReturn = `      return h('div', {},
        // T-020 学习质量（个人视角，与技术指标并列）
        h(Card, { title: '📈 我的学习质量' },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 } },
            h(Stat, { v: essayN ? essayAvg + '%' : '—', l: '申论均分率 · ' + essayN + ' 次', color: essayAvg >= 60 ? '#10b981' : '#f59e0b' }),
            h(Stat, { v: examN ? examAvg + '%' : '—', l: '模考均分率 · ' + examN + ' 场', color: examAvg >= 60 ? '#10b981' : '#f59e0b' }),
            h(Stat, { v: (ins.essay && ins.essay.recent && ins.essay.recent.length) || 0, l: '近期申论记录' }),
            h(Stat, { v: (ins.exam && ins.exam.recent && ins.exam.recent.length) || 0, l: '近期模考记录' }))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 14 } },
          h(Stat, { v: tel.uptimeSec + 's', l: '运行时长' }), h(Stat, { v: tel.totalRequests, l: '总请求' }),`
if (!s.includes(oldObsReturn)) { console.error('obs return 锚点未找到'); process.exit(1) }
s = s.replace(oldObsReturn, newObsReturn)

fs.writeFileSync(p, s)
console.log('✅ T-020 学习洞察完成')
