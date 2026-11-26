/**
 * pool-view.tsx — NativePoolView 统一题库视图（cycle-34 阶段 1 · K-4）
 *
 * 定位（研究 13/14/15 阶段 1）：把「散落各源的题库」收敛成「一张可查询的知识库」的
 * **可见面**。用户在这里看到：库状态（白盒）· 跨源检索（去重聚合）· 分层抽题 · 关系图。
 *
 * ── 三性设计（cycle-34 用户要求：扩展性 / 观测性 / 维护性）──
 * ① **扩展性**：视图只消费 `/api/pool/*` 的**通用契约**，不硬编码任何源名/字段名；
 *     新增源/新增端点时**本文件零改动**（源清单在服务端注册表，关系词表在服务端词表）。
 * ② **观测性**：所有字段视为可选，缺失即**卡片级降级**（绝不 role="alert"）；
 *     数字口径一律服务端给（面板不二次裁剪、不自报数字——cycle-20 教训㊼）。
 * ③ **维护性**：顶层名统一 `Pool*` 前缀（combo 单作用域防重名——教训⑨）；
 *     组件拆分清晰（本文件只做视图，不含算法）；hook 全部在顶部、早退在最后（cycle-24 C24-2）。
 *
 * ── 组件规范（cycle-24 纪律）──
 *   · 视图自治 fetch（父层不下发 data）
 *   · props 窄口径：`{ api, initialModule? }`
 *   · 所有接口字段缺失即降级，绝不抛错进 ErrorBoundary
 */
import { h, React, Stat, Card, KV_TAG, KV_BTN, KgLoad } from '../ui-kit.js'

/** props（窄口径——父层只给 api 与可选初始模块） */
interface NativePoolViewProps {
  api: (p: string, opts?: any) => Promise<any>
  initialModule?: string
  /** cycle-65：「行测频道 → 某题型」深链——挂载即按该题型检索并展示结果 */
  /** cycle-65：行测频道细分题型深链——挂载即按 category 精确过滤取题 */
  initialCategory?: string
  initialQuery?: string
  /** cycle-49：统一跳转出口——未就绪引导去题库管理、单题详情一键开练 */
  onGo?: (v: string, params?: any) => void
}

/** 关系类型标签（服务端 REL_TYPE_META 的**降级副本**——服务端缺失时用它兜底；
 *  服务端给了就以服务端为准（单一事实源在服务端，客户端只做兜底不造事实）） */
const POOL_REL_FALLBACK: any = {
  SAME_AS: '同题', APPEARS_IN: '出处', BELONGS_TO: '知识点', IN_MODULE: '模块',
  HAS_MATERIAL: '材料', RELATED_TO: '相关', HAS_DOUBT: '疑点', DERIVED_FROM: '母题',
  SAME_REGION: '地域', REVIEWED: '已校验',
}

/** 字节数人读化（null 降级为 ''——不臆造 0） */
function poolSize(bytes: any): string {
  const v = Number(bytes)
  if (!isFinite(v) || v <= 0) return ''
  return v >= 1024 * 1024 * 1024 ? (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    : v >= 1024 * 1024 ? (v / 1024 / 1024).toFixed(1) + ' MB'
    : Math.round(v) + ' B'
}

/** 时间戳人读化（ISO → 本地；无效 → ''） */
function poolTime(iso: any): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch { return '' }
}

/** 指标条（value/total；total 缺失时只显 value） */
function PoolMetric({ label, value, total, ok, desc }: any) {
  const pct = (Number(total) > 0) ? Math.round((Number(value) / Number(total)) * 100) : null
  const color = ok === false ? '#dc2626' : '#059669'
  return (
    <div style={{ minWidth: 132 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: ok === false ? '#dc2626' : 'var(--text-primary)' }}>
        {String(value ?? '—')}{Number(total) > 0 ? <span style={{ fontSize: 10, color: 'var(--text-faint,#94a3b8)', fontWeight: 400 }}> / {String(total)}</span> : null}
      </div>
      {pct !== null ? (
        <div style={{ height: 3, background: 'rgba(148,163,184,.25)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
          <div style={{ width: Math.min(100, pct) + '%', height: '100%', background: color }} />
        </div>
      ) : null}
      {desc ? <div style={{ fontSize: 9, color: 'var(--text-faint,#94a3b8)', marginTop: 2 }}>{desc}</div> : null}
    </div>
  )
}

/** 库状态卡（观测性核心：状态 + 健康指标 + 源注册表） */
function PoolStatusCard({ st, onRebuild, busy, onGo }: any) {
  if (!st) return null
  const health = st.health || null
  const stats = st.stats || null
  const registry = st.registry || []
  return (
    <Card title="🗄️ 统一库状态">
      {!st.ready ? (
        <div style={{ fontSize: 11, color: '#b45309', lineHeight: 1.7 }}>
          {st.hint || '统一池未就绪'}
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={KV_BTN} disabled={busy} onClick={onRebuild}>{busy ? '⏳ 重建中…' : '🔨 立即重建'}</button>
            {/* cycle-49：数据链打通——库空的根因常是「仓库未安装」，一键去题库管理而非让用户猜 */}
            {onGo ? <button style={KV_BTN} onClick={() => onGo('repos')}>📦 去题库管理安装数据 ›</button> : null}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
            <Stat l="题目" v={stats ? stats.questions : '—'} />
            <Stat l="关系边" v={stats ? stats.relations : '—'} />
            <Stat l="出处" v={stats ? stats.questionSources : '—'} />
            <Stat l="知识点覆盖" v={stats ? stats.withKadian : '—'} />
            <Stat l="库体积" v={poolSize(st.bytes) || '—'} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint,#94a3b8)', marginBottom: 8 }}>
            构建于 {poolTime(st.builtAt) || '—'} · schema v{st.schemaVersion ?? '—'} · 快照 {health && health.snapshotMs != null ? health.snapshotMs + 'ms' : '—'}
            <button style={{ ...KV_BTN, marginLeft: 8 }} disabled={busy} onClick={onRebuild}>{busy ? '⏳ 重建中…' : '🔨 重建'}</button>
          </div>
          {/* 源注册表（可扩展性的可见面：新增源自动出现，本视图零改动） */}
          {registry.length ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginBottom: 4 }}>已注册源（新增源自动出现在此，无需改前端）</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {registry.map((r: any) => (
                  <span key={r.id} style={{ ...KV_TAG, background: r.available ? 'rgba(16,185,129,.12)' : 'rgba(148,163,184,.14)', color: r.available ? '#059669' : 'var(--text-muted)' }}>
                    {r.available ? '●' : '○'} {r.label || r.id}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {/* 数据质量指标（每条附判据来源——可解释） */}
          {health && health.quality && health.quality.length ? (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginBottom: 5 }}>数据质量（判据来自服务端 SQL，口径唯一）</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {health.quality.map((q: any) => (
                  <PoolMetric key={q.key} label={q.label} value={q.value} total={q.total} ok={q.ok} desc={q.desc} />
                ))}
              </div>
            </div>
          ) : null}
          {/* 关系类型分布（词表在服务端；未登记类型显式标出——可扩展性守卫的可见面） */}
          {health && health.relTypes && health.relTypes.length ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginBottom: 4 }}>关系类型分布</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {health.relTypes.map((r: any) => (
                  <span key={r.type} style={{ ...KV_TAG, background: (r.color || 'var(--text-faint)') + '18', color: r.color || 'var(--text-muted)' }}
                    title={r.desc + (r.known ? '' : '（未在词表登记——新增关系类型请先在服务端 REL_TYPE_META 登记）')}>
                    {r.label || r.type} {r.count}{r.known ? '' : ' ⚠'}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  )
}

/** 搜索结果行（跨源聚合：一条 canonical_id 一行，出处列全） */
function PoolSearchRow({ r, onPick }: any) {
  const sources = r.sources || []
  return (
    <div style={{ padding: '7px 0', borderBottom: '1px solid rgba(148,163,184,.16)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ ...KV_TAG, background: 'rgba(99,102,241,.12)', color: '#4f46e5', flexShrink: 0 }}>{r.module || '未分类'}</span>
        <span style={{ fontSize: 11, lineHeight: 1.6, flex: 1, cursor: 'pointer' }} onClick={() => onPick && onPick(r.canonicalId)}>
          {String(r.stem || '').slice(0, 140)}
        </span>
        <span style={{ ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#059669', flexShrink: 0 }} title="同一道题在多个源/多套卷出现">
          {sources.length} 处出处
        </span>
      </div>
      {r.kadian ? <div style={{ fontSize: 9.5, color: 'var(--text-faint,#94a3b8)', marginTop: 2, marginLeft: 4 }}>知识点：{r.kadian}</div> : null}
      {sources.length ? (
        <div style={{ fontSize: 9, color: 'var(--text-faint,#94a3b8)', marginTop: 2, marginLeft: 4 }}>
          {sources.slice(0, 4).map((s: any, i: number) => (
            <span key={i} style={{ marginRight: 8 }}>{s.source}{s.paper ? ' · ' + String(s.paper).slice(0, 26) : ''}{s.year ? ' · ' + s.year : ''}</span>
          ))}
          {sources.length > 4 ? <span>…共 {sources.length} 处</span> : null}
        </div>
      ) : null}
    </div>
  )
}

/** 单题聚合详情（一份题干 + N 处出处 + 关系邻居 + 五维标注） */
function PoolDetail({ d, onClose, onGo }: any) {
  if (!d) return null
  const dims = d.dims || {}
  const dimRows: any[] = [
    ['解题思路', dims.reasoning], ['最快解法', dims.fastest], ['易错陷阱', dims.pitfalls],
    ['母题规律', dims.mother], ['模型提示', dims.askModel], ['疑点', dims.doubt],
  ].filter((x: any) => x[1])
  return (
    <Card title="🔎 单题聚合视图">
      <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 6, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {/* cycle-49：单题聚合视图不再是死胡同——按知识点/模块一键开练 */}
        {onGo && d.kadian ? <button style={KV_BTN} onClick={() => onGo('practice', { kadian: d.kadian })}>✏️ 练此知识点 ›</button> : null}
        {onGo && d.module ? <button style={KV_BTN} onClick={() => onGo('practice', { module: d.module })}>🎯 练此模块 ›</button> : null}
        <button style={KV_BTN} onClick={onClose}>关闭</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginBottom: 4 }}>
        {d.module || '未分类'} · {d.category || '—'} · {d.qtype || '—'} · {d.sourceCount} 处出处
      </div>
      {d.kadian ? <div style={{ fontSize: 10, color: '#6366f1', marginBottom: 6 }}>知识点：{d.kadian}</div> : null}
      <div style={{ fontSize: 11.5, lineHeight: 1.75, marginBottom: 8 }}>{String(d.stem || '').slice(0, 500)}</div>
      {d.analysis ? (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ fontSize: 10.5, color: '#4f46e5', cursor: 'pointer' }}>官方解析</summary>
          <div style={{ fontSize: 11, lineHeight: 1.7, marginTop: 5, whiteSpace: 'pre-wrap' }}>{String(d.analysis).slice(0, 1200)}</div>
        </details>
      ) : null}
      {dimRows.length ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginBottom: 3 }}>五维标注</div>
          {dimRows.map((r: any, i: number) => (
            <details key={i} style={{ marginBottom: 3 }}>
              <summary style={{ fontSize: 10.5, color: '#059669', cursor: 'pointer' }}>{r[0]}</summary>
              <div style={{ fontSize: 10.5, lineHeight: 1.7, marginTop: 3, whiteSpace: 'pre-wrap', color: 'var(--text-secondary,#475569)' }}>{String(r[1]).slice(0, 800)}</div>
            </details>
          ))}
        </div>
      ) : null}
      {d.sources && d.sources.length ? (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginBottom: 3 }}>出处（{d.sources.length} 处）</div>
          {d.sources.map((s: any, i: number) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary,#475569)', lineHeight: 1.7 }}>
              · {s.source_id}{s.paper ? ' · ' + s.paper : ''}{s.region ? ' · ' + s.region : ''}{s.year ? ' · ' + s.year : ''}
            </div>
          ))}
        </div>
      ) : null}
      {d.relations && d.relations.length ? (
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginBottom: 3 }}>关系邻居（{d.relations.length}）</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {d.relations.slice(0, 24).map((r: any, i: number) => (
              <span key={i} style={KV_TAG} title={String(r.src_id).slice(0, 40)}>
                {POOL_REL_FALLBACK[r.rel_type] || r.rel_type}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  )
}

/**
 * 主视图。
 *
 * ⚠️ hook 纪律（cycle-24 C24-2）：全部 hook 在顶部，**早退 return 必须在最后一个 hook 之后**。
 * ⚠️ 早退守卫用 `st === null`（未加载）而不是 `!st`（未就绪）——未就绪是**合法状态**，
 *    必须在视图内降级展示（卡片级），不能提前 return 把整个视图清空。
 */
export function NativePoolView({ api, initialModule, initialCategory = '', initialQuery = '', onGo }: NativePoolViewProps) {
  /* ── hooks 顶部恒定 ── */
  const [st, setSt] = React.useState(null)          // /api/pool/status
  const [q, setQ] = React.useState('')                // 检索词
  const [results, setResults] = React.useState(null) // 检索结果
  const [searching, setSearching] = React.useState(false)
  const [detail, setDetail] = React.useState(null)   // 单题详情
  const [sampled, setSampled] = React.useState(null) // 抽题结果
  const [module, setModule] = React.useState(initialModule || '')
  const [busy, setBusy] = React.useState(false)       // 重建中
  const [err, setErr] = React.useState('')
  const aliveRef = React.useRef(true)

  const load = React.useCallback(async () => {
    try {
      const d = await api('/pool/status')
      if (!aliveRef.current) return
      setSt(d)
      setErr('')
    } catch (e: any) { if (aliveRef.current) setErr(String((e && e.message) || e)) }
  }, [api])

  React.useEffect(() => {
    aliveRef.current = true
    load()
    return () => { aliveRef.current = false }
  }, [load])

  /**
   * cycle-65：`initialQuery` 深链——从「🎯 专题 → 🧭 总览 → 行测频道」点某个**题型**
   * （片段阅读/逻辑填空/图形推理…）时，直接带该题型名进统一题库并**立即检索出该题型的题**。
   *
   * 背景：行测频道的题型 entry 原指向已删除的 `deepbank` 视图（点进去路由不到）。
   * 落点改为统一题库后，仅传参不自动检索的话用户还得自己再敲一次关键词——
   * 那是「能进去但要手动再操作一遍」的半成品体验。故此处挂载即搜。
   */
  /**
   * cycle-65：`initialCategory` 深链——从「🎯 专题 → 🧭 总览 → 行测频道」点某个**细分题型**
   * （逻辑判断/定义判断/片段阅读…）时，挂载即按该题型**精确过滤**取题并展示。
   *
   * ⚠️ 为什么不用 `pool/search?q=题型名`（我上一版的做法，已证伪）：
   * search 是**全文检索**，不是按题型字段过滤。实测「定义判断」命中 5 条里仅 1 条真属该题型
   * （其余是解析里恰好出现了这几个字）→ 用户点题型看到一堆杂题。
   * 正解 = `pool/questions?category=<题型>` 按 `question.category` **等值**过滤。
   */
  const bootCatRef = React.useRef(false)
  React.useEffect(() => {
    const cat0 = String(initialCategory || '').trim()
    if (bootCatRef.current || !cat0) return
    bootCatRef.current = true
    ;(async () => {
      setBusy(true)
      try {
        const d = await api('/pool/questions?category=' + encodeURIComponent(cat0) + '&count=10')
        if (!aliveRef.current) return
        setSampled(d)
        setErr('')
      } catch (e: any) { if (aliveRef.current) setErr(String((e && e.message) || e)) }
      finally { if (aliveRef.current) setBusy(false) }
    })()
  }, [initialCategory, api])

  const bootQueryRef = React.useRef(false)
  React.useEffect(() => {
    const kw0 = String(initialQuery || '').trim()
    if (bootQueryRef.current || !kw0) return
    bootQueryRef.current = true
    setQ(kw0)
    // 直接发检索（不能只 setQ 等用户点按钮——「点了题型却什么都没出来」= 半成品体验）
    ;(async () => {
      setSearching(true)
      try {
        const d = await api('/pool/search?q=' + encodeURIComponent(kw0) + '&limit=20')
        if (!aliveRef.current) return
        setResults(d)
      } catch (e: any) { if (aliveRef.current) setErr(String((e && e.message) || e)) }
      finally { if (aliveRef.current) setSearching(false) }
    })()
  }, [initialQuery, api])

  const doSearch = React.useCallback(async () => {
    const kw = String(q || '').trim()
    if (!kw) { setResults(null); return }
    setSearching(true)
    try {
      const d = await api('/pool/search?q=' + encodeURIComponent(kw) + '&limit=20')
      if (!aliveRef.current) return
      setResults(d)
      setErr('')
    } catch (e: any) { if (aliveRef.current) setErr(String((e && e.message) || e)) }
    finally { if (aliveRef.current) setSearching(false) }
  }, [api, q])

  const doSample = React.useCallback(async () => {
    setBusy(true)
    try {
      const d = await api('/pool/questions?count=5' + (module ? '&module=' + encodeURIComponent(module) : ''))
      if (!aliveRef.current) return
      setSampled(d)
      setErr('')
    } catch (e: any) { if (aliveRef.current) setErr(String((e && e.message) || e)) }
    finally { if (aliveRef.current) setBusy(false) }
  }, [api, module])

  // cycle-37 T-032：重建改**异步作业**——立即返回 jobId，轮询至终态再刷新。
  // 旧同步模式会阻塞 HTTP 220-326s（研究 17 O4）；服务端保留 {async:false} 兼容路径，
  // 客户端默认走异步（长任务不站柜台）。
  const doRebuild = React.useCallback(async () => {
    setBusy(true)
    try {
      const d = await api('/pool/rebuild', { method: 'POST', body: JSON.stringify({ mode: 'full' }) })
      if (!aliveRef.current) return
      // 兼容：若服务端直接返回同步结果（旧构建），按旧路径处理
      if (d && d.jobId) {
        const jobId = String(d.jobId)
        // 轮询（2s 间隔；终态 done/failed 退出；上限 15 分钟防泄漏）
        for (let i = 0; i < 450; i++) {
          await new Promise(r => setTimeout(r, 2000))
          if (!aliveRef.current) return
          const st = await api('/pool/rebuild/status?jobId=' + encodeURIComponent(jobId)).catch(() => null)
          if (!st) continue
          if (st.state === 'done' || st.state === 'failed') {
            if (st.state === 'failed') setErr('重建失败: ' + (st.error || '未知错误'))
            break
          }
        }
        await load()
      } else if (d && (d.ok !== undefined)) {
        setSt((prev: any) => ({ ...(prev || {}), ...d, health: d.health, stats: d.stats }))
        await load()
      } else if (d && d.error) {
        setErr(String(d.error))
      }
    } catch (e: any) { if (aliveRef.current) setErr(String((e && e.message) || e)) }
    finally { if (aliveRef.current) setBusy(false) }
  }, [api, load])

  const pick = React.useCallback(async (canonicalId: string) => {
    try {
      const d = await api('/pool/question?id=' + encodeURIComponent(canonicalId))
      if (!aliveRef.current) return
      setDetail(d)
    } catch { /* 详情失败不打断主面板 */ }
  }, [api])

  // ⚠️ 早退在所有 hook 之后（cycle-24 C24-2）
  // cycle-44：加载态走 ui-kit 基建组件（早退位置/条件零变化）
  if (st === null && !err) {
    return h(KgLoad, { flex: true })
  }

  const modules = (st && st.health && st.health.modules) ? st.health.modules : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 错误条：字段级降级，绝不 role="alert"（避免误报为致命） */}
      {err ? <div style={{ fontSize: 11, color: '#b45309', background: 'rgba(245,158,11,.1)', borderRadius: 8, padding: '7px 10px' }}>⚠ {err}</div> : null}

      <PoolStatusCard st={st} onRebuild={doRebuild} busy={busy} onGo={onGo} />

      {/* 检索区 */}
      <Card title="🔍 跨源统一检索">
        {results && results.tookMs != null ? <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 6 }}><span style={KV_TAG}>{results.tookMs}ms · {results.engine || '—'}</span></div> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={q}
            onChange={(e: any) => setQ(e.target.value)}
            onKeyDown={(e: any) => { if (e.key === 'Enter') doSearch() }}
            placeholder="输入关键词（≥3 字走 FTS5 trigram，短词自动降级）"
            style={{ flex: 1, minWidth: 200, fontSize: 11.5, padding: '6px 9px', borderRadius: 8, border: '1px solid rgba(148,163,184,.35)' }}
          />
          <button style={KV_BTN} disabled={searching} onClick={doSearch}>{searching ? '⏳ 检索中…' : '检索'}</button>
          <button style={KV_BTN} disabled={busy} onClick={doSample}>🎲 分层抽题</button>
        </div>
        {modules.length ? (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
            <button style={{ ...KV_TAG, cursor: 'pointer', opacity: module ? 1 : 0.6 }} onClick={() => setModule('')}>全部模块</button>
            {modules.slice(0, 12).map((m: any) => (
              <button key={m.module} style={{ ...KV_TAG, cursor: 'pointer', opacity: module === m.module ? 1 : 0.6 }}
                onClick={() => setModule(m.module)}>
                {m.module} <span style={{ opacity: .7 }}>{m.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        {results && results.results && results.results.length ? (
          <div style={{ marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
            {results.results.map((r: any) => <PoolSearchRow key={r.canonicalId} r={r} onPick={pick} />)}
          </div>
        ) : results && results.results && !results.results.length ? (
          <div style={{ fontSize: 11, color: 'var(--text-faint,#94a3b8)', marginTop: 8 }}>未命中「{results.query}」——换用更长的关键词或先重建统一库。</div>
        ) : null}
      </Card>

      {/* 抽题结果 */}
      {sampled && sampled.questions && sampled.questions.length ? (
        <Card title="🎲 分层抽题">
          <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 6 }}><span style={KV_TAG}>{sampled.strategy || '—'}</span></div>
          <div style={{ fontSize: 10, color: 'var(--text-faint,#94a3b8)', marginBottom: 6 }}>
            候选 {sampled.candidates ?? '—'} 题 · 策略：{sampled.strategy || '—'}（权重复用 SRS 的 1/(rate+0.15)，与错题本同源）
          </div>
          {sampled.questions.map((qq: any) => (
            <div key={qq.canonicalId} style={{ padding: '6px 0', borderBottom: '1px solid rgba(148,163,184,.16)' }}>
              <div style={{ fontSize: 11, lineHeight: 1.6, cursor: 'pointer' }} onClick={() => pick(qq.canonicalId)}>
                {String(qq.stem || '').slice(0, 130)}
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--text-faint,#94a3b8)', marginTop: 2 }}>
                {qq.module || '—'} · {qq.sourceCount} 处出处 · 答案 {qq.answer || '—'}
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      {detail ? <PoolDetail d={detail} onClose={() => setDetail(null)} onGo={onGo} /> : null}

      <div style={{ fontSize: 9.5, color: 'var(--text-faint,#94a3b8)', lineHeight: 1.7 }}>
        统一题库是**派生层**：全部内容可从上游重建（上游仓库只读，永不修改）。
        统一身份 = qid 优先 → fp 次之 → 内容哈希兜底；同一道题在多源出现时合并为一条并列出 N 处出处。
      </div>
    </div>
  )
}
