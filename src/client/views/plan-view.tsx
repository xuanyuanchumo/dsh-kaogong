/**
 * client/views/plan-view.tsx — cycle-46 幽灵视图补齐（用户确认项①）
 *
 * manifest 声明了 plan/search/method 三个视图、服务端端点全部存活
 * （/api/plan + /api/plan/schedule · /api/search · /api/method + /api/methods），
 * 但无路由无页面——「声明漂移第四形态」。本文件补齐三个轻量页面：
 *   · NativePlanView  学习计划：30 天静态日历 + 智能排程侧重（cycle-30b 域首获页面）
 *   · NativeSearchView 知识检索：sakib/kaogong-skill 全文搜索（DFS 限深 3）
 *   · NativeMethodView 方法参考：kaogong-skill 十主题参考文档
 *
 * 组件规范（cycle-24/C44）：自治 fetch · 早退在全部 hooks 后 · KgLoad/KgErr/KgEmpty 三态基建 ·
 * Props 类型化 · 全中文注释 · R9 零直调。
 */
import { h, React, Stat, Card, KV_TAG, KV_BTN, KgLoad, KgErr, KgEmpty, Bar } from '../ui-kit.js'

/* ══════════════ NativePlanView · 学习计划 ══════════════ */

interface PlanViewProps { api: (p: string, opts?: any) => Promise<any> }

/** 阶段配色（phase 序号 → 色板；确定性无随机） */
function planPhaseColor(i: number): string {
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b']
  return palette[i % palette.length]
}

export function NativePlanView({ api }: PlanViewProps) {
  const [plan, setPlan] = React.useState(null)
  const [sched, setSched] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [p, s] = await Promise.all([
          api('/plan').catch(() => null),
          api('/plan/schedule').catch(() => null),
        ])
        if (cancelled) return
        if (!p || p.error) { setErr(String((p && p.error) || '计划数据不可用')); return }
        setPlan(p)
        if (s && !s.error) setSched(s)
      } catch (e: any) {
        if (!cancelled) setErr(String((e && e.message) || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [api])

  if (loading) return <KgLoad flex />
  if (err || !plan) return <KgErr msg={err || '无数据'} label="学习计划加载失败" />

  const days: any[] = Array.isArray(plan.days) ? plan.days : []
  const phases: any[] = Array.isArray(plan.phases) ? plan.phases : []
  const schedDays: any[] = (sched && Array.isArray(sched.schedule)) ? sched.schedule : []
  const schedByDay = new Map<number, any>()
  for (const d of schedDays) schedByDay.set(Number(d.day), d)
  const profile = sched && sched.profile
  const curDay = (plan.day != null && plan.day >= 1 && plan.day <= 30) ? Number(plan.day) : 1

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>🗓 学习计划</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {phases.length + ' 阶段 · ' + days.length + ' 天模板（study-plan.md 事实源）'}
          {sched ? ' · 智能排程已按画像重排侧重' : ''}
        </span>
      </div>
      {/* 画像摘要（排程域透出的可解释字段；缺则整卡隐藏） */}
      {profile ? (
        <Card title="🎯 画像侧重（弱点 × 积压，1/(rate+0.15) 同源模型）">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
            {(profile.focus || []).slice(0, 6).map((f: any, i: number) => (
              <div key={String(f.module) + i} style={{ background: 'var(--surface-card,#fff)', border: '1px solid rgba(148,163,184,.15)', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{f.module}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                  {typeof f.primaryRate === 'number' ? '正确率 ' + Math.round(f.primaryRate * 100) + '%' : '无作答数据'}
                  {typeof f.backlog === 'number' && f.backlog > 0 ? ' · 积压 ' + f.backlog : ''}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {/* 30 天日历：静态任务 + 排程侧重标注 + 建议题量 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
        {days.map((d, i) => {
          const s = schedByDay.get(Number(d.day))
          const phaseIdx = phases.findIndex((p: any) => Number(d.day) >= p.startDay && Number(d.day) <= p.endDay)
          const c = planPhaseColor(phaseIdx >= 0 ? phaseIdx : i)
          const isToday = Number(d.day) === curDay
          return (
            <div key={String(d.day)} style={{
              background: 'var(--surface-card,#fff)', borderRadius: 12, padding: 12,
              border: isToday ? '2px solid #6366f1' : '1px solid rgba(148,163,184,.15)',
              boxShadow: isToday ? '0 0 0 3px rgba(99,102,241,.12)' : undefined,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ ...KV_TAG, background: c + '18', color: c }}>{'D' + d.day}</span>
                <span style={{ fontWeight: 700, fontSize: 12.5, flex: 1, minWidth: 0 }}>{d.title}</span>
                {isToday ? <span style={{ ...KV_TAG, background: 'rgba(99,102,241,.14)', color: '#4338ca' }}>今天</span> : null}
              </div>
              {(d.tasks || []).slice(0, 3).map((t: string, ti: number) => (
                <div key={ti} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 2 }}>{'· ' + t}</div>
              ))}
              {s && Array.isArray(s.focus) && s.focus.length ? (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed rgba(148,163,184,.25)' }}>
                  {s.focus.slice(0, 3).map((f: any, fi: number) => (
                    <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>{f.module}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: fi === 0 ? '#4338ca' : 'var(--text-muted)' }}>{(f.suggested || 0) + ' 题'}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <Bar pct={(s.focus.reduce((t: number, f: any) => t + (f.weight || 0), 0) * 100) || 0} />
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ══════════════ NativeSearchView · 知识检索 ══════════════ */

interface SearchViewProps { api: (p: string, opts?: any) => Promise<any> }

export function NativeSearchView({ api }: SearchViewProps) {
  const [q, setQ] = React.useState('')
  const [results, setResults] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')

  const run = React.useCallback(async (kw: string) => {
    const k = String(kw || '').trim()
    if (!k) return
    setBusy(true); setErr('')
    try {
      const r = await api('/search?q=' + encodeURIComponent(k))
      setResults(Array.isArray(r.results) ? r.results : [])
    } catch (e: any) {
      setErr(String((e && e.message) || e)); setResults([])
    } finally { setBusy(false) }
  }, [api])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>🔎 知识检索</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>sakib / kaogong-skill / developer2gwy 三库全文（DFS 限深 3 · 命中上限 15）</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          value={q}
          onChange={(e: any) => setQ(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === 'Enter') run(q) }}
          placeholder="输入关键词，如：图形推理 / 截位直除 / 常识判断…"
          style={{ flex: 1, minWidth: 0, padding: '9px 13px', borderRadius: 10, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 13, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'inherit' }}
        />
        <button className="kg-navbtn" style={{ padding: '9px 18px', fontWeight: 700 }} disabled={busy || !q.trim()} onClick={() => run(q)}>
          {busy ? '检索中…' : '检索'}
        </button>
      </div>
      {busy ? <KgLoad label="全文扫描中…" /> : null}
      {!busy && err ? <KgErr msg={err} label="检索失败" /> : null}
      {!busy && results !== null && !err ? (
        (results as any[]).length
          ? <div>{(results as any[]).map((r, i) => (
              <div key={String(i)}>
                <Card>
                  <div style={{ fontSize: 11, color: '#6366f1', marginBottom: 6, fontWeight: 600 }}>{r.file}</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.75, whiteSpace: 'pre-wrap', color: 'var(--text-secondary,#334155)' }}>{r.snippet}</div>
                </Card>
              </div>
            ))}</div>
          : <KgEmpty text={'「' + q + '」无命中 —— 换个关键词试试（仅匹配 md/txt 文件内容）'} pad={30} />
      ) : null}
      {!busy && results === null && !err ? <KgEmpty text="输入关键词后回车或点「检索」" pad={30} /> : null}
    </div>
  )
}

/* ══════════════ NativeMethodView · 方法参考 ══════════════ */

interface MethodViewProps { api: (p: string, opts?: any) => Promise<any> }

export function NativeMethodView({ api }: MethodViewProps) {
  const [topics, setTopics] = React.useState(null)
  const [cur, setCur] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    api('/methods').then((r: any) => {
      if (cancelled) return
      setTopics(Array.isArray(r.topics) ? r.topics.filter((t: any) => t && t.exists) : [])
      setLoading(false)
    }).catch((e: any) => { if (!cancelled) { setErr(String((e && e.message) || e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [api])

  const open = React.useCallback(async (t: any) => {
    setErr('')
    try {
      const r = await api('/method?topic=' + encodeURIComponent(t.id))
      if (r && r.error) setErr(String(r.error))
      else setCur(r)
    } catch (e: any) { setErr(String((e && e.message) || e)) }
  }, [api])

  if (loading) return <KgLoad flex />
  if (err && !topics) return <KgErr msg={err} label="方法参考加载失败" />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>📖 方法参考</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>kaogong-skill 十主题参考文档（行测/申论/职测/公基…）</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {(topics || []).map((t: any) => (
          <button key={t.id} className="kg-navbtn" style={cur && cur.topic === t.id ? { background: 'rgba(99,102,241,.14)', borderColor: '#6366f1', color: '#4338ca', fontWeight: 700 } : undefined}
            onClick={() => open(t)}>{t.label}</button>
        ))}
      </div>
      {err ? <KgErr msg={err} label="读取失败" /> : null}
      {!cur && !err ? <KgEmpty text="点上方主题标签读取对应参考文档" pad={20} /> : null}
      {cur ? (
        <Card title={(cur.file || '') + '（' + String(cur.content || '').length + ' 字符）'}>
          <div style={{ fontSize: 12.5, lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>{cur.content}</div>
        </Card>
      ) : null}
    </div>
  )
}
