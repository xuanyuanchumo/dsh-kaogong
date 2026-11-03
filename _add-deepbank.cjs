// v1.7：深度题库视图（Naoku 五维标注）+ 知识点检索 + 按知识点刷题
const fs = require('fs')
const p = 'src/client/client.js'
let s = fs.readFileSync(p, 'utf8')

const anchor = `    /** T-016 整卷模考：计时作答 → 交卷 → 模块得分分布 */`
if (!s.includes(anchor)) { console.error('锚点未找到'); process.exit(1) }

const view = `    /**
     * 深度题库视图（v1.7 · 整合 GongkaoNaoku）：27506 题带五维标注
     * kadian(考什么) / reasoning(怎么推) / fastest(最快解法) / pitfalls(易错) / mother(母题)
     * —— 这是「方法论原生化」的核心：不只给答案，给解题思维链。
     */
    function NativeDeepBankView({ api }) {
      const [status, setStatus] = React.useState(null)
      const [module, setModule] = React.useState('')
      const [q, setQ] = React.useState(null)
      const [sel, setSel] = React.useState(null)
      const [revealed, setRevealed] = React.useState(false)
      const [kw, setKw] = React.useState('')
      const [kadians, setKadians] = React.useState([])
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => { api('/naoku/status').then(setStatus).catch(() => setStatus({ ready: false })) }, [api])

      const draw = async (mod) => {
        setBusy(true)
        try {
          const d = await api('/naoku/questions?count=1' + (mod ? '&module=' + encodeURIComponent(mod) : ''))
          setQ((d.questions || [])[0] || null); setSel(null); setRevealed(false)
        } finally { setBusy(false) }
      }

      const searchK = async () => {
        if (!kw.trim()) return
        const d = await api('/naoku/kadian?q=' + encodeURIComponent(kw.trim()) + '&limit=20')
        setKadians(d.list || [])
      }

      const drawByKadian = async (k) => {
        const d = await api('/naoku/practice?kadian=' + encodeURIComponent(k) + '&count=1')
        setQ((d.questions || [])[0] || null); setSel(null); setRevealed(false); setKadians([])
      }

      if (status && !status.ready) {
        return h(Card, { title: '📚 深度题库' },
          h('div', { style: { fontSize: 13, color: '#f59e0b' } }, '⚠️ ' + (status.hint || '深度题库不可用')),
          h('div', { style: { fontSize: 12, color: '#64748b', marginTop: 8 } }, '需要 Node ≥ 22.19（内置 node:sqlite）且 GongkaoNaoku 分片存在。回落方案：用「✏️ 刷题」或「📚 真题卷」。'))
      }

      const st = status && status.stats
      return h('div', {},
        st ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 } },
          h(Stat, { v: st.total, l: '深度标注题', color: '#6366f1' }),
          h(Stat, { v: st.kadianCoverage + '%', l: '知识点覆盖', color: '#10b981' }),
          h(Stat, { v: st.fastestCoverage + '%', l: '速解覆盖', color: '#f59e0b' }),
          h(Stat, { v: st.withImage, l: '含图题', color: '#8b5cf6' })) : null,

        // 知识点检索（考什么 + 怎么想）
        h(Card, { title: '🔍 知识点检索（考点 → 解题思路）' },
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
            h('input', {
              value: kw, onChange: e => setKw(e.target.value),
              onKeyDown: e => { if (e.key === 'Enter') searchK() },
              placeholder: '输入考点关键词，如「图形推理」「模态命题」「增长率」',
              style: { flex: 1, padding: '8px 12px', borderRadius: 9, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' },
            }),
            h('button', { style: { ...KV_BTN, padding: '8px 16px' }, onClick: searchK }, '搜索')),
          kadians.length > 0 ? h('div', { style: { maxHeight: 260, overflowY: 'auto' } },
            kadians.map((k, i) => h('div', {
              key: i, style: { padding: '8px 10px', borderRadius: 9, marginBottom: 4, background: 'rgba(148,163,184,.06)', cursor: 'pointer', fontSize: 12.5 },
              onClick: () => drawByKadian(k.kadian),
            },
              h('div', { style: { display: 'flex', gap: 6, marginBottom: 3, flexWrap: 'wrap' } },
                h('span', { style: KV_TAG }, k.module),
                k.category ? h('span', { style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, k.category) : null,
                h('span', { style: { fontSize: 10.5, color: '#64748b' } }, k.count + ' 题')),
              h('div', null, k.kadian))))) : null),

        // 按模块抽深度标注题
        h(Card, { title: '🎯 深度刷题（带解题思维链）' },
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' } },
            ['判断推理', '言语理解与表达', '数量关系', '资料分析', '常识判断'].map(m2 =>
              h('button', {
                key: m2,
                style: { ...KV_BTN, ...(module === m2 ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) },
                onClick: () => { setModule(m2); draw(m2) },
              }, m2))),
          busy ? h('div', { style: { fontSize: 12, color: '#64748b' } }, '抽题中…') : null,
          q ? h('div', {},
            h('div', { style: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
              q.module ? h('span', { style: KV_TAG }, q.module) : null,
              q.type ? h('span', { style: { ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' } }, q.type) : null,
              q.year ? h('span', { style: KV_TAG }, q.year) : null,
              q.region ? h('span', { style: KV_TAG }, q.region) : null),
            h(RichText, { text: q.stem, fontSize: 13.5, maxHeight: '30vh' }),
            Object.entries(q.options || {}).map(([L, txt]) => {
              let border = 'rgba(148,163,184,.3)', bg = 'transparent'
              if (revealed) { if (L === q.correctAnswer) { border = '#10b981'; bg = 'rgba(16,185,129,.09)' } else if (L === sel) { border = '#ef4444'; bg = 'rgba(239,68,68,.08)' } }
              else if (L === sel) { border = '#6366f1'; bg = 'rgba(99,102,241,.08)' }
              return h('div', {
                key: L, style: { display: 'flex', gap: 10, padding: '10px 12px', border: '2px solid ' + border, background: bg, borderRadius: 10, marginTop: 8, cursor: revealed ? 'default' : 'pointer', fontSize: 13, lineHeight: 1.6 },
                onClick: () => { if (!revealed) setSel(L) },
              },
                h('div', { style: { width: 24, height: 24, borderRadius: '50%', background: L === sel || (revealed && L === q.correctAnswer) ? (revealed && L === q.correctAnswer ? '#10b981' : '#6366f1') : 'rgba(148,163,184,.15)', color: (L === sel || (revealed && L === q.correctAnswer)) ? '#fff' : 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 } }, L),
                h('div', { style: { flex: 1 } }, txt))
            }),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
              !revealed ? h('button', { style: { ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '7px 18px' }, disabled: !sel, onClick: () => setRevealed(true) }, '查看答案与解题链')
                : h('button', { style: { ...KV_BTN, padding: '7px 18px' }, onClick: () => draw(module) }, '下一题 →')),

            // 五维标注（方法论原生化的价值所在）
            revealed ? h('div', { style: { marginTop: 14 } },
              q.analysis ? h('div', { style: { marginBottom: 10, padding: 12, background: 'rgba(148,163,184,.07)', borderRadius: 10 } },
                h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5 } }, '📖 解析'),
                h(RichText, { text: q.analysis })) : null,
              q.kadian ? h('div', { style: { marginBottom: 10, padding: 12, background: 'rgba(99,102,241,.07)', borderRadius: 10, borderLeft: '3px solid #6366f1' } },
                h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#6366f1' } }, '🎯 考点定位'),
                h('div', { style: { fontSize: 12.5, lineHeight: 1.75 } }, q.kadian)) : null,
              q.reasoning ? h('div', { style: { marginBottom: 10, padding: 12, background: 'rgba(14,165,233,.07)', borderRadius: 10, borderLeft: '3px solid #0ea5e9' } },
                h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#0ea5e9' } }, '🧠 解题推理链'),
                h(RichText, { text: q.reasoning })) : null,
              q.fastest ? h('div', { style: { marginBottom: 10, padding: 12, background: 'rgba(245,158,11,.08)', borderRadius: 10, borderLeft: '3px solid #f59e0b' } },
                h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#f59e0b' } }, '⚡ 最快解法（考场用）'),
                h(RichText, { text: q.fastest })) : null,
              q.pitfalls ? h('div', { style: { marginBottom: 10, padding: 12, background: 'rgba(239,68,68,.07)', borderRadius: 10, borderLeft: '3px solid #ef4444' } },
                h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#ef4444' } }, '⚠️ 易错点'),
                h(RichText, { text: q.pitfalls })) : null,
              q.mother ? h('div', { style: { padding: 12, background: 'rgba(139,92,246,.07)', borderRadius: 10, borderLeft: '3px solid #8b5cf6' } },
                h('div', { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#8b5cf6' } }, '🧩 母题思维'),
                h(RichText, { text: q.mother })) : null) : null)
            : h('div', { style: { fontSize: 11.5, color: '#94a3b8' } }, '答完可查看「考点定位 / 推理链 / 最快解法 / 易错点 / 母题」五维标注'))
          : null))
    }

`

s = s.replace(anchor, view + anchor)
fs.writeFileSync(p, s)
console.log('✅ 深度题库视图已插入')
