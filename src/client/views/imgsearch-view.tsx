/**
 * imgsearch-view.tsx — NativeImgSearchView 图片搜题视图（issue #4 阶段 4 · v1.36）
 *
 * ── 职责 ──
 * 上传题目图片 → 宿主 LLM 结构化抽取（题干/图表数据/图形特征/模块）→ 统一检索层匹配原题。
 * 服务端三端点（/api/img-search/models|analyze|match）已实现；本视图只做 UI 与诚实降级。
 *
 * ── 纪律（违反会崩宿主）──
 * ① 本文件只放 src/client/views/，不回 client/ 根（cycle-24 目录分层）。
 * ② 禁止从 react 包直接导入：全组合唯一的 React 实例化发生在 ui-kit，
 *    本文件从 ../ui-kit.js 取 { h, React, ... }（R11 combo 行首 import 事故）。
 * ③ 全部顶层标识符带 KgImg/imgsearch 前缀（combo 单作用域，重名 = SyntaxError·教训⑨）。
 * ④ 子视图一律真组件化 h(KgImg..., props)，禁止函数直调（R9 hook 漂移白屏）。
 * ⑤ hook 恒定在顶部；早退 return 必须在全部 hooks 之后（C24-2）——本组件无中途早退。
 * ⑥ 事件一律 onClick 驼峰（R6）；取数 useEffect 带 cancelled 守卫。
 * ⑦ 图片 base64 只在内存态 useState，绝不写 localStorage（隐私/体积）。
 *
 * ── 诚实降级四态 ──
 * 无模型 / 识别失败 / 无匹配 / 题库未装，各有明确文案与下一步出口，绝不假装有结果。
 * 「加入错题本」不是假按钮：先用 /api/history/search 按原题题干定位完整题对象（含 contentSig），
 * 再按补录形状 POST /api/history/entries；定位不到就明说并给「查看原题」跳转，绝不造半题。
 */
import { h, React, Card, KV_TAG, KV_BTN, KgLoad, KgErr, KgEmpty } from '../ui-kit.js'

/** props（窄口径；api 已由父层拼好 ${channel.base}/api，故此处路径不带 /api 前缀） */
interface ImgSearchProps {
  api: (p: string, opts?: any) => Promise<any>
  onGo?: (v: string, params?: any) => void
}

/** 题型词表（与服务端 KINDS 对齐；UI 文案单一事实源在本文件，服务端只认枚举值） */
const KG_IMG_KINDS: Array<{ id: 'auto' | 'ziliao' | 'tuxing'; label: string; hint: string }> = [
  { id: 'auto', label: '🔄 自动判断', hint: '由模型从图片判断题型' },
  { id: 'ziliao', label: '📊 资料分析图表', hint: '侧重读表格/柱状/折线数据与同比增长等' },
  { id: 'tuxing', label: '🔷 图形推理', hint: '侧重规律特征（位置/数量/属性/样式…）' },
]

/** 题型显示名（未知值降级为「自动」） */
function imgsearchKindLabel(kind: any): string {
  const k = KG_IMG_KINDS.find(x => x.id === kind)
  return k ? k.label : '🔄 自动判断'
}

/**
 * 抽取结果结构化展示（零 hook 纯组件；字段一律防御读取，缺字段即显示「—」）。
 * tookMs 与 kind 由服务端给，UI 不臆造数字/题型。
 */
function KgImgExtractionBlock({ ex, tookMs }: { ex: any; tookMs?: any }) {
  if (!ex) return null
  const rows: Array<[string, any]> = [
    ['题型', imgsearchKindLabel(ex.kind)],
    ['所属模块', ex.module || '—'],
    ['题干', ex.stem || '—'],
    ['图表数据', ex.chartData || '—'],
    ['图形特征', ex.figureFeatures || '—'],
  ]
  return (
    <Card title="🧠 模型结构化抽取">
      {tookMs != null ? <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 6 }}><span style={KV_TAG}>{String(tookMs)}ms</span></div> : null}
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(148,163,184,.14)' }}>
          <span style={{ flex: '0 0 72px', fontSize: 11, color: 'var(--text-muted,#64748b)' }}>{label}</span>
          <span style={{ flex: 1, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{String(value)}</span>
        </div>
      ))}
    </Card>
  )
}

/**
 * 单条命中题（零 hook 纯组件）。
 * 「加入错题本」走两步：按 title 向 /api/history/search 取完整题 → POST /api/history/entries；
 * 「查看原题」走真实深链 onGo('pool', {q})，两者都不造题。
 */
function KgImgHitRow({ hit, index, busy, onAdd, onView }: {
  hit: any; index: number; busy: boolean; onAdd: (h: any) => void; onView: (h: any) => void
}) {
  const score = hit && hit.score != null && isFinite(Number(hit.score)) ? Number(hit.score) : null
  return (
    <div style={{ padding: '9px 0', borderBottom: '1px solid rgba(148,163,184,.16)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
        <span style={KV_TAG}>#{index + 1}</span>
        {hit && hit.source ? <span style={{ ...KV_TAG, fontSize: 9.5 }}>{String(hit.source)}</span> : null}
        {hit && hit.provider ? <span style={{ ...KV_TAG, fontSize: 9.5, background: 'rgba(16,185,129,.12)', color: '#059669' }}>{String(hit.provider)}</span> : null}
        {score !== null ? <span style={{ ...KV_TAG, fontSize: 9.5 }}>相关度 {score.toFixed(2)}</span> : null}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.6 }}>{String((hit && hit.title) || '（无标题）')}</div>
      {hit && hit.snippet ? <div style={{ fontSize: 11, color: 'var(--text-muted,#64748b)', lineHeight: 1.7, marginTop: 3 }}>{String(hit.snippet).slice(0, 220)}</div> : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
        <button style={{ ...KV_BTN, fontSize: 10.5 }} disabled={busy} onClick={() => onView(hit)}>🔍 查看原题</button>
        <button style={{ ...KV_BTN, fontSize: 10.5 }} disabled={busy} onClick={() => onAdd(hit)}>📕 加入错题本</button>
      </div>
    </div>
  )
}

/**
 * NativeImgSearchView — 图片搜题主视图（自治取数，父层只给 api / onGo）。
 * hook 顺序固定：providers → providersErr → provider → models → modelsLoading → modelsErr
 * → model → kind → image → fileErr → phase → extraction → analyzeErr → hits → matchInfo
 * → matchErr → addMsg → addBusy → aliveRef。全组件仅末尾一个 return（无 C24-2 早退）。
 */
export function NativeImgSearchView({ api, onGo }: ImgSearchProps) {
  // React 经 combo 为 any 形态，泛型调用会触发 TS2347（plan-view 同款）——非泛型调用即返回 any
  const [providers, setProviders] = React.useState(null)          // GET /img-search/models 信封；null=加载中
  const [providersErr, setProvidersErr] = React.useState(null)
  const [provider, setProvider] = React.useState('')                // 选中的 provider id
  const [models, setModels] = React.useState(null)                  // POST /img-search/models 信封；null=未加载
  const [modelsLoading, setModelsLoading] = React.useState(false)
  const [modelsErr, setModelsErr] = React.useState(null)
  const [model, setModel] = React.useState('')                      // 选中的 model id
  const [kind, setKind] = React.useState('auto')                    // 'auto'|'ziliao'|'tuxing'
  const [image, setImage] = React.useState(null)                    // {data,mediaType,name}；base64 只在内存
  const [fileErr, setFileErr] = React.useState('')
  const [phase, setPhase] = React.useState('idle')                  // 'idle'|'analyzing'|'matching'|'done'
  const [extraction, setExtraction] = React.useState(null)
  const [analyzeTookMs, setAnalyzeTookMs] = React.useState(null)       // analyze 响应同级的 tookMs（不在 extraction 内）
  const [analyzeErr, setAnalyzeErr] = React.useState(null)
  const [hits, setHits] = React.useState(null)                      // any[]|null
  const [matchInfo, setMatchInfo] = React.useState(null)            // {query,total,groups}
  const [matchErr, setMatchErr] = React.useState(null)
  const [addMsg, setAddMsg] = React.useState(null)                   // {ok,text}
  const [addBusy, setAddBusy] = React.useState(false)
  const aliveRef = React.useRef(true)

  /** 挂载取 provider 清单（GET）；无模型时服务端回 {ok:false,providers:[]}，诚实展示非崩溃 */
  React.useEffect(() => {
    aliveRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const d = await api('/img-search/models')
        if (cancelled) return
        setProviders(d || { ok: false, providers: [] })
        const first = (d && Array.isArray(d.providers) && d.providers[0] && d.providers[0].id) || ''
        if (first) setProvider(first)
      } catch (e: any) {
        if (!cancelled) setProvidersErr(String((e && e.message) || e))
      }
    })()
    return () => { cancelled = true; aliveRef.current = false }
  }, [api])

  /** provider 变更 → 拉该 provider 的模型清单（POST）；优先自动选 vision 模型 */
  React.useEffect(() => {
    let cancelled = false
    if (!provider) { setModels(null); setModel(''); return () => { cancelled = true } }
    setModelsLoading(true)
    setModelsErr(null)
    setModels(null)
    setModel('')
    ;(async () => {
      try {
        const d = await api('/img-search/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) })
        if (cancelled) return
        setModels(d || { ok: false, models: [] })
        const list = (d && Array.isArray(d.models)) ? d.models : []
        const pick = list.find((m: any) => m && m.vision) || list[0]
        if (pick && pick.id) setModel(pick.id)
      } catch (e: any) {
        if (!cancelled) setModelsErr(String((e && e.message) || e))
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [provider, api])

  /** 文件 → FileReader → base64（去 data: 前缀）；只存内存，绝不 localStorage */
  const onFile = (e: any) => {
    const f = e && e.target && e.target.files && e.target.files[0]
    setFileErr('')
    if (!f) { setImage(null); return }
    if (!/^image\//.test(String(f.type || ''))) { setFileErr('请选择图片文件（image/*）'); setImage(null); return }
    if (Number(f.size || 0) > 8 * 1024 * 1024) { setFileErr('图片超过 8MB 上限，请压缩后重试'); setImage(null); return }
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      const comma = raw.indexOf(',')
      const data = comma >= 0 ? raw.slice(comma + 1) : raw   // 去 data:<mime>;base64, 前缀
      if (!data) { setFileErr('图片读取失败（空数据）'); setImage(null); return }
      setImage({ data, mediaType: String(f.type), name: String(f.name || '题目图片') })
      setExtraction(null); setAnalyzeTookMs(null); setHits(null); setAnalyzeErr(null); setMatchErr(null); setMatchInfo(null); setPhase('idle')
    }
    reader.onerror = () => { setFileErr('图片读取失败，请重试'); setImage(null) }
    reader.readAsDataURL(f)
  }

  /** 识别并搜题：POST analyze → 结构化抽取 → POST match（同一 cancelled 守卫链） */
  const doSearch = async () => {
    if (!image) { setAnalyzeErr('请先上传题目图片'); return }
    if (!provider || !model) { setAnalyzeErr('请先选择 provider 与模型（无模型请到 DSH 设置配置）'); return }
    setAnalyzeErr(null); setMatchErr(null); setExtraction(null); setAnalyzeTookMs(null); setHits(null); setMatchInfo(null); setAddMsg(null)
    setPhase('analyzing')
    try {
      const a = await api('/img-search/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: image.data, mediaType: image.mediaType, kind, provider, model }),
      })
      if (!aliveRef.current) return
      if (!a || a.ok === false) {
        setAnalyzeErr((a && a.error) || (a && a.hint) || '识别失败（模型或图片格式问题）')
        setPhase('idle')
        return
      }
      setExtraction(a.extraction || null)
      setAnalyzeTookMs(a.tookMs != null ? a.tookMs : null)
      setPhase('matching')
      const m = await api('/img-search/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extraction: a.extraction, limit: 10, provider }),
      })
      if (!aliveRef.current) return
      if (!m || m.ok === false) {
        setMatchErr((m && m.error) || '匹配失败（统一检索层不可用）')
        setPhase('done')
        return
      }
      const list = Array.isArray(m.hits) ? m.hits : []
      setHits(list)
      setMatchInfo({ query: m.query || '', total: m.total, groups: m.groups || [] })
      setPhase('done')
    } catch (e: any) {
      if (!aliveRef.current) return
      setAnalyzeErr(String((e && e.message) || e))
      setPhase('idle')
    }
  }

  /** 查看原题：真实深链到统一题库并带题干关键词（该视图支持 initialQuery 挂载即检索） */
  const viewOriginal = (hit: any) => {
    const q = String((hit && hit.title) || '').slice(0, 120)
    if (!q || !onGo) { setAddMsg({ ok: false, text: '该命中无可用题干，无法跳转原题' }); return }
    onGo('pool', { q })
  }

  /**
   * 加入错题本（真实补录，不是假按钮）：
   * ① 用命中标题走 /api/history/search 取完整题对象（含 contentSig）；
   * ② 按补录形状 POST /api/history/entries {entries:[{contentSig,question,result:'wrong'}],source}；
   * ③ 定位不到就明说「需先打开原题」，并给查看原题按钮（不伪造缺 stem 的半题）。
   */
  const addToWrongbook = async (hit: any) => {
    const q = String((hit && hit.title) || '').trim().slice(0, 120)
    if (!q) { setAddMsg({ ok: false, text: '该命中无题干，无法补录' }); return }
    setAddBusy(true); setAddMsg(null)
    try {
      const s = await api('/history/search?q=' + encodeURIComponent(q) + '&limit=5')
      if (!aliveRef.current) return
      const list = (s && Array.isArray(s.list)) ? s.list : []
      const candidate = list[0]
      if (!candidate || !candidate.stem) {
        setAddMsg({ ok: false, text: '未能按题干定位原题，暂无法补录；请先「查看原题」确认后，在错题本里补录。' })
        return
      }
      const r = await api('/history/entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [{ contentSig: candidate.contentSig, question: candidate, result: 'wrong', source: '图片搜题' }],
          source: '图片搜题',
        }),
      })
      if (!aliveRef.current) return
      if (!r || r.error) { setAddMsg({ ok: false, text: (r && r.error) || '补录失败' }); return }
      const conflicts = Array.isArray(r.conflicts) ? r.conflicts.length : 0
      const rejected = Array.isArray(r.rejected) ? r.rejected.length : 0
      setAddMsg({
        ok: true,
        text: '已补录 ' + String(r.accepted || 0) + ' 题（错题已进错题本；历史练习不计入今日新刷）'
          + (conflicts ? ' · 已存在跳过 ' + conflicts : '') + (rejected ? ' · 无效 ' + rejected : ''),
      })
    } catch (e: any) {
      if (!aliveRef.current) return
      setAddMsg({ ok: false, text: '补录失败: ' + String((e && e.message) || e) })
    } finally {
      if (aliveRef.current) setAddBusy(false)
    }
  }

  /* ── 以下为渲染派生（防御读取，不假设守卫已兜住）── */
  const providerList = (providers && Array.isArray(providers.providers)) ? providers.providers : []
  const noModel = !!(providers && providers.ok === false && !providerList.length)
  const modelList = (models && Array.isArray(models.models)) ? models.models : []
  const busy = phase === 'analyzing' || phase === 'matching'
  const groupTotals = (matchInfo && Array.isArray(matchInfo.groups))
    ? matchInfo.groups.map((g: any) => Number((g && g.total) || 0)) : []
  const bankMissing = !!(hits && hits.length === 0 && phase === 'done' && !matchErr
    && (matchInfo && Number(matchInfo.total) === 0)
    && groupTotals.length > 0 && groupTotals.every((n: number) => n === 0))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card title="🖼 图片搜题">
        <div style={{ fontSize: 11.5, color: 'var(--text-muted,#64748b)', lineHeight: 1.8 }}>
          {'上传题目截图 → 宿主模型读图抽取（题干 / 图表数据 / 图形特征 / 模块）→ 统一检索层跨源匹配原题。'}
          {'图片仅在浏览器内存里流转，不写入本地存储；无模型 / 识别失败 / 无匹配 / 题库未装都会明确提示，不会假装有结果。'}
        </div>
      </Card>

      {/* ① provider / model 选择（挂载 GET providers；选中 provider 再 POST models） */}
      <Card title="🤖 模型选择">
        {providersErr ? <KgErr msg={providersErr} label="模型清单加载失败" onRetry={() => { setProvidersErr(null); setProviders(null) }} /> : null}
        {providers === null && !providersErr ? <KgLoad label=" 正在读取模型服务…" /> : null}
        {noModel ? (
          <KgEmpty text="⚠ 宿主未配置可用的视觉模型，图片搜题暂不可用。请先在 DSH 设置中配置模型后重试；其余离线功能不受影响。" />
        ) : null}
        {providerList.length ? (
          <>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted,#64748b)', marginBottom: 5 }}>服务商</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {providerList.map((p: any) => (
                <button key={p.id} style={{ ...KV_BTN, ...(provider === p.id ? { borderColor: '#6366f1', color: '#4f46e5', fontWeight: 700, background: 'rgba(99,102,241,.08)' } : {}) }}
                  onClick={() => setProvider(p.id)}>{String(p.name || p.id)}</button>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted,#64748b)', marginBottom: 5 }}>模型</div>
            {modelsLoading ? <KgLoad label=" 正在读取模型列表…" /> : null}
            {modelsErr ? <KgErr msg={modelsErr} label="模型列表加载失败" /> : null}
            {models && models.ok === false && !modelList.length ? (
              <KgEmpty text="该服务商下没有可用模型；请先在 DSH 设置配置模型。" />
            ) : null}
            {modelList.length ? (
              <select value={model} onChange={(e: any) => setModel(e.target.value)}
                style={{ padding: '6px 9px', borderRadius: 8, border: '1px solid rgba(148,163,184,.35)', fontSize: 11.5, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' }}>
                {modelList.map((m: any) => (
                  <option key={m.id} value={m.id}>{String(m.name || m.id) + (m.vision ? '（支持图片）' : '')}</option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}
      </Card>

      {/* ② 图片上传 + 预览（base64 只在内存） */}
      <Card title="📎 上传题目图片">
        <input type="file" accept="image/*" onChange={onFile}
          style={{ fontSize: 11.5, fontFamily: 'inherit', maxWidth: '100%' }} />
        {fileErr ? <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>⚠ {fileErr}</div> : null}
        {image ? (
          <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <img src={'data:' + image.mediaType + ';base64,' + image.data} alt="题目预览"
              style={{ maxWidth: 260, maxHeight: 200, borderRadius: 8, border: '1px solid rgba(148,163,184,.3)' }} />
            <div style={{ fontSize: 10.5, color: 'var(--text-muted,#64748b)', lineHeight: 1.7 }}>
              <div>{String(image.name)}</div>
              <div>{String(image.mediaType)}</div>
              <button style={{ ...KV_BTN, marginTop: 6 }} onClick={() => { setImage(null); setHits(null); setExtraction(null); setAnalyzeTookMs(null); setPhase('idle') }}>移除图片</button>
            </div>
          </div>
        ) : <KgEmpty text="选择一张题目截图（PNG / JPG / WebP，≤8MB）。图片不会保存到本地。" />}
      </Card>

      {/* ③ 题型选择 + 识别按钮 */}
      <Card title="🏷 题型与识别">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {KG_IMG_KINDS.map(k => (
            <button key={k.id} title={k.hint}
              style={{ ...KV_BTN, ...(kind === k.id ? { borderColor: '#6366f1', color: '#4f46e5', fontWeight: 700, background: 'rgba(99,102,241,.08)' } : {}) }}
              onClick={() => setKind(k.id)}>{k.label}</button>
          ))}
        </div>
        <button style={{ ...KV_BTN, padding: '7px 16px', background: busy ? undefined : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: busy ? undefined : '#fff', border: busy ? undefined : 0, fontWeight: 700 }}
          disabled={busy || !image || !provider || !model} onClick={doSearch}>
          {phase === 'analyzing' ? '⏳ 模型读图中…' : phase === 'matching' ? '⏳ 匹配原题中…' : '🔍 识别并搜题'}
        </button>
        {!image ? <span style={{ fontSize: 10.5, color: '#94a3b8', marginLeft: 8 }}>请先上传图片</span> : null}
      </Card>

      {/* ④ 识别/匹配状态：loading / 错误 / 抽取结果四态 */}
      {phase === 'analyzing' ? <KgLoad label=" 模型正在读图并结构化抽取…" /> : null}
      {phase === 'matching' ? <KgLoad label=" 正在跨源匹配原题…" /> : null}
      {analyzeErr ? <Card title="⚠ 识别失败"><KgErr msg={analyzeErr} label="识别失败" />
        <KgEmpty text="常见原因：未配置视觉模型、图片模糊/非题目、模型输出格式不符。可换图或到 DSH 设置检查模型后重试。" />
      </Card> : null}
      {extraction ? h(KgImgExtractionBlock, { ex: extraction, tookMs: analyzeTookMs }) : null}

      {/* ⑤ 匹配结果 */}
      {matchErr ? <Card title="⚠ 匹配失败"><KgErr msg={matchErr} label="匹配失败" />
        <KgEmpty text="统一检索层不可用或题库未就绪；可先到「📦 题库管理」确认数据已安装。" />
      </Card> : null}
      {hits && hits.length ? (
        <Card title={'🎯 匹配原题（' + hits.length + ' 条' + (matchInfo && matchInfo.total != null ? ' / 共 ' + String(matchInfo.total) : '') + '）'}>
          {matchInfo && matchInfo.query ? <div style={{ fontSize: 10.5, color: 'var(--text-faint,#94a3b8)', marginBottom: 6, lineHeight: 1.6 }}>检索式：{String(matchInfo.query).slice(0, 240)}</div> : null}
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {hits.map((hit: any, i: number) => h(KgImgHitRow, { key: String((hit && hit.id) || i), hit, index: i, busy: addBusy, onAdd: addToWrongbook, onView: viewOriginal }))}
          </div>
        </Card>
      ) : null}
      {phase === 'done' && !matchErr && hits && !hits.length ? (
        <Card title="🎯 匹配原题">
          {bankMissing ? (
            <KgEmpty text="各检索源均无数据，统一题库可能尚未安装。请到「📦 题库管理」安装题库后再试。" />
          ) : (
            <KgEmpty text="未匹配到原题——模型抽取的特征可能区分度不足。可换更清晰的图片，或改用「资料分析图表 / 图形推理」指定题型后重试。" />
          )}
        </Card>
      ) : null}
      {addMsg ? <div style={{ fontSize: 11.5, color: addMsg.ok ? '#059669' : '#b45309', background: addMsg.ok ? 'rgba(16,185,129,.08)' : 'rgba(245,158,11,.09)', padding: '8px 11px', borderRadius: 8, lineHeight: 1.7 }}>
        {(addMsg.ok ? '✓ ' : '⚠ ') + String(addMsg.text || '')}
      </div> : null}
      {hits && hits.length ? (
        <div style={{ fontSize: 9.5, color: 'var(--text-faint,#94a3b8)', lineHeight: 1.7 }}>
          {'「加入错题本」按题干向题库定位完整题对象后走正式补录端点（历史练习不计入今日新刷）；「查看原题」跳转统一题库按题干检索。'}
        </div>
      ) : null}
    </div>
  )
}
