/**
 * study-view.ts — 学习类视图族（cycle-13 T-025 从 client.ts 拆出）
 * 仪表盘 / 刷题 / 错题本 / 图形推理 / 深度题库。
 * cycle-13 对话窗口瘦身：会话练题控件已整体删除，
 * 练题流程收敛到左栏「考公学习」面板（对话窗口回归纯对话）。
 */

import { h, React, entries, Stat, Bar, Card, RichText, KV_TAG, KV_BTN, OptionRow, SourceBadge } from '../ui-kit.js'
// cycle-25：题目七段渲染接入统一组件域 question-kit（QwQuestionCard 组装器 + QwZoomHost 图片放大宿主）
import { QwQuestionCard, QwZoomHost, QwPaperMode } from '../question/question-kit.js'

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
interface KgMemBannerProps { data: any; text?: any; onResume?: any; onDismiss?: any }
function KgMemBanner(props: KgMemBannerProps) {
  const d = props && props.data
  if (!d) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      marginBottom: 12, padding: '9px 13px', borderRadius: 12,
      background: 'linear-gradient(135deg,rgba(99,102,241,.10),rgba(139,92,246,.08))',
      border: '1px solid rgba(99,102,241,.28)',
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4f46e5' }}>{'💾 ' + String(props.text || '上次练到这里')}</span>
      {d.at ? <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{kgMemAgo(d.at)}</span> : null}
      <button
        style={{ marginLeft: 'auto', border: 0, cursor: 'pointer', fontFamily: 'inherit', padding: '6px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }}
        onClick={props.onResume}
      >{'▶ 继续上次'}</button>
      <button
        style={{ border: '1px solid rgba(148,163,184,.4)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', padding: '6px 12px', borderRadius: 9, fontSize: 12, color: '#64748b' }}
        onClick={props.onDismiss}
      >{'从头开始'}</button>
    </div>
  )
}

    /* ── 子视图：真组件（R9：一律经 h(Comp, props) 挂载）── */

    /**
     * cycle-24 P0-1 取数下沉：仪表盘视图自治 fetch（原由父层 Promise.all 拉取整包下发）。
     * 窄 props = { api }；五个数据源并行拉齐，任一失败就地降级（extra 卡隐藏，不拖垮首屏）。
     * hook 链恒定：useState×3 + useEffect×1。
     */
    interface NativeDashboardViewProps { api: any }
    export function NativeDashboardView({ api }: NativeDashboardViewProps) {
      const [payload, setPayload] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        ;(async () => {
          try {
            const [st, stats, papers, eh, xh] = await Promise.all([
              api('/status'), api('/stats'),
              api('/papers?_=1').catch(() => ({ total: 0, subjects: [] })),
              api('/essay/history').catch(() => ({ total: 0, avgRatio: 0 })),
              api('/paper/exam/history').catch(() => ({ total: 0, avgRate: 0 })),
            ])
            const subj = (papers && papers.subjects) || []
            const extra = {
              paperTotal: (papers && papers.total) || 0,
              essayPapers: (subj.find(x => x.subject === '申论') || {}).count || 0,
              xingcePapers: (subj.find(x => x.subject === '行测') || {}).count || 0,
              essayCount: (eh && eh.total) || 0, avgEssay: (eh && eh.avgRatio) || 0,
              examCount: (xh && xh.total) || 0, avgExam: (xh && xh.avgRate) || 0,
            }
            if (!cancelled) { setPayload({ st, stats, extra }); setErr(null) }
          } catch (e) { if (!cancelled) setErr(String((e && e.message) || e)) }
          finally { if (!cancelled) setLoading(false) }
        })()
        return () => { cancelled = true }
      }, [api])
      if (loading) return <div className="kg-load"><div className="kg-spin" /></div>
      if (err || !payload) return <div style={{ color: '#ef4444', fontSize: 13 }}>{'仪表盘加载失败: ' + (err || '无数据')}</div>
      const { st, stats, extra } = payload
      const rate = stats.rate
      const rc = rate >= 80 ? '#10b981' : rate >= 60 ? '#6366f1' : rate >= 40 ? '#f59e0b' : '#ef4444'
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 14 }}>
            <Stat v={`${st.repos.ready}/${st.repos.total}`} l="资源仓库" color="#6366f1" />
            <Stat v={stats.answered} l="累计答题" color="#10b981" />
            <Stat v={rate + '%'} l="总体正确率" color={rc} />
            <Stat v={'D' + (stats.day || 1)} l="计划进度日" color="#f59e0b" />
            {stats.streak > 1 ? <Stat v={'🔥×' + stats.streak} l="连续学习" color="#ef4444" /> : null}
          </div>
          <Card title="🎯 模块掌握度（正确率×置信）">
            {entries(stats.mastery || {}).sort((a, b) => a[1].mastery - b[1].mastery).map(([m, s]) =>
              <div key={m} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>{m}</span>
                  <span style={{ color: '#64748b' }}>{`${s.answered}题 · ${s.rate}% · 掌握${s.mastery}`}</span>
                </div>
                <Bar pct={s.mastery} color={s.mastery >= 80 ? 'linear-gradient(135deg,#10b981,#34d399)' : s.mastery < 50 ? 'linear-gradient(135deg,#f59e0b,#fbbf24)' : undefined} />
              </div>)}
            {!Object.keys(stats.mastery || {}).length && <div style={{ fontSize: 12, color: '#64748b' }}>{'暂无数据 — 去「✏️ 刷题」开练'}</div>}
          </Card>
          {/* v1.7 数据总览：题库规模 + 申论/模考战绩 */}
          {extra ? <Card title="📚 资源总览">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
              <Stat v={extra.paperTotal || 0} l="真题卷总数" color="#6366f1" />
              <Stat v={extra.essayPapers || 0} l="申论套卷" color="#8b5cf6" />
              <Stat v={extra.xingcePapers || 0} l="行测套卷" color="#0ea5e9" />
              <Stat v={(extra.essayCount || 0)} l="申论已练" color="#10b981" />
              <Stat v={(extra.avgEssay || 0) + '%'} l="申论均分率" color="#f59e0b" />
              <Stat v={(extra.examCount || 0)} l="模考场次" color="#ef4444" />
              <Stat v={(extra.avgExam || 0) + '%'} l="模考均分率" color="#14b8a6" />
              <Stat v={(stats.wrong && stats.wrong.open) || 0} l="待消灭错题" color="#dc2626" />
            </div>
          </Card> : null}
        </div>
      )
    }

    /** 刷题视图：useState 在组件自身；父层 key 保证换题干净重挂载（R9 根治点） */
    /**
     * 刷题视图（v1.7 重写）：自管数据 + 完整判分反馈。
     * 修复：v1.6 提交后只 setTick 重挂载，用户看不到对错/解析（「刷题有问题」的根因）。
     * 现流程：选模块 → 抽题 → 作答 → 提交并**就地展示判分+解析** → 下一题。
     */
    interface NativePracticeViewProps { api: any; onGoWrongbook: any; initialModule?: any }
    export function NativePracticeView({ api, onGoWrongbook, initialModule = '' }: NativePracticeViewProps) {
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
        return (
          <div>
            {/* cycle-15：记忆恢复横幅（带 initialModule 的专题直入不弹——显式意图优先） */}
            {(!initialModule && memLoaded && memData && memData.question && !memOff)
              ? <KgMemBanner
                  {...{ key: 'kgmem-practice' }}
                  data={memData}
                  text={'上次练到「' + (memData.module || '未记录模块') + '」· ' + String((memData.question && memData.question.stem) || '').slice(0, 26) + '…'}
                  onResume={() => {
                    const mq = memData.question
                    setModule(memData.module || '判断推理')
                    queueRef.current = [mq]   // 恢复队列=只含上次那题，「下一题」走正常抽题
                    setQueueLen(0)
                    setQ(mq)
                    setSel(null)
                    setResult(null)
                  }}
                  onDismiss={() => setMemOff(true)}
                />
              : null}
            <Card title="✏️ 选择练习模块">
              <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                <button style={{ ...KV_BTN, ...(srs ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }} onClick={() => setSrs(true)}>{'🧠 SRS 智能（错题回炉优先）'}</button>
                <button style={{ ...KV_BTN, ...(!srs ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }} onClick={() => setSrs(false)}>{'🎲 随机抽题'}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                {MODULES.map(m2 => <div
                  key={m2} style={{ border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 14, cursor: 'pointer', textAlign: 'center' }}
                  onClick={() => { setModule(m2); queueRef.current = []; setQueueLen(0); draw(m2, srs) }}
                >
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>{m2}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{'点击开始'}</div>
                </div>)}
              </div>
            </Card>
            {stat.done > 0 ? <Card title="本次练习">
              <div style={{ fontSize: 13 }}>{'已答 ' + stat.done + ' 题 · 正确 ' + stat.right + ' 题 · 正确率 ' + Math.round(stat.right / stat.done * 100) + '%'}</div>
            </Card> : null}
          </div>
        )
      }

      // 题目为空
      if (!q) {
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button style={KV_BTN} onClick={() => setModule('')}>{'← 换模块'}</button>
            </div>
            <div className="kg-load" style={{ padding: 40 }}>{'该模块暂无题目，试试其他模块'}</div>
          </div>
        )
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
      return (
        <div style={{ maxWidth: 780 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <button style={KV_BTN} onClick={() => setModule('')}>{'← 模块'}</button>
            <span style={KV_TAG}>{q.module || module}</span>
            {q.type ? <span style={{ ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}>{q.type}</span> : null}
            {q.fromWrongBook ? <span style={{ ...KV_TAG, background: 'rgba(239,68,68,.12)', color: '#ef4444' }}>{'📕 错题回炉·箱' + q.box}</span> : null}
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#64748b' }}>{'本次 ' + stat.done + ' 题 · 对 ' + stat.right}</span>
            <span style={{ fontSize: 11.5, color: '#94a3b8' }}>{'队列 ' + (queueLen + 1)}</span>
          </div>
          {/* cycle-25：QwZoomHost 整卡图片可放大。本仓 JSX 工厂（classic/preact 签名）不把 JSX children 折叠进
              attrs 类型校验（ui-kit Card 能用是因其 children? 可选），QwZoomHostProps.children 必填 → 显式传参 */}
          {/* cycle-28：四区对齐模考——队列即整卷（同卷资料分析题组连续抽取），材料区/切换区/答题卡区由 QwPaperMode 承担。
              当前题 = queueRef 队列首；判分交互经 selected/right/revealed 下传；提交判分按钮与反馈区留在容器之外（宿主职责）。
              注意：队列剩余题作为 questions 传入（答题卡四态=已答标记），当前题映射为 number→no。 */}
          <QwZoomHost children={
            <QwPaperMode
              mode="practice"
              questions={[
                ...queueRef.current.map((x: any) => ({
                  no: x.number, score: x.score, type: x.type, module: x.module || module,
                  source: x.source, exam: x.exam, year: x.year, region: x.region, paperFile: x.paperFile,
                  stem: x.stem, options: x.options, answer: x.correctAnswer || x.answer, analysis: x.analysis,
                  groupMaterial: x.groupMaterial || '',
                  groupMaterialNo: x.groupMaterialNo || 0,
                })),
              ]}
              current={0}
              onJump={(i) => {
                // 跳转 = 重排队列头（保持既有 takeNext 单一数据源语义；i>0 时把前面的题移到队尾循环）
                const arr = queueRef.current.slice()
                if (i > 0 && i < arr.length) { const head = arr.splice(0, i); arr.push(...head); queueRef.current = arr; setQueueLen(arr.length - 1) }
                const nq = arr[0] || null
                setQ(nq); setSel(null); setResult(null)
                remember(nq, module)
              }}
              paperMeta={{ subject: q.module || module }}
              selected={sel}
              right={result ? (result.correctAnswer || result.answer || (q as any).correctAnswer) : undefined}
              revealed={!!result}
              disabled={!!result}
              onSelect={(L: string) => { if (!result) setSel(L) }}
            />
          } />
          {/* cycle-21：上游数据缺选项图的诚实降级提示（2728 题图形推理选项在源数据=A/B/C/D 字母） */}
          {/* + 旧错题回炉的历史数据提示（修复前入库的 stem 已被旧解析剥图，无法凭空恢复） */}
          {(lettersOnly && (stemHasImg || isTuxingType))
            ? <div style={{ fontSize: 11.5, color: '#b45309', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 9, padding: '7px 10px', marginTop: 8 }}>
                {optImgCount > 0
                  ? 'ℹ 该题选项配图已在题库数据源中收录 ' + optImgCount + ' 个，其余选项为纯字母——请结合题干图与解析推理作答。'
                  : 'ℹ 该题四个选项在题库数据源中为纯字母（选项配图未随上游收录）——请结合题干图与解析推理作答。'}
              </div>
            : null}
          {legacyNoImg && !lettersOnly
            ? <div style={{ fontSize: 11.5, color: '#64748b', background: 'rgba(148,163,184,.08)', border: '1px dashed rgba(148,163,184,.3)', borderRadius: 9, padding: '7px 10px', marginTop: 8 }}>
                {'ℹ 该题引用了图表但题干未携带配图（修复前入库的历史错题，或原文即文字题）——可到「📚 真题卷」查看原卷完整配图。'}
              </div>
            : null}
          {!answered ? (sel ? <button
            className="kg-navbtn on" disabled={busy}
            style={{ marginTop: 6, padding: '9px 22px', borderRadius: 10 }}
            onClick={submit}
          >{busy ? '判分中…' : '✅ 提交判分'}</button> : <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>{'选择一个选项后提交'}</div>) : null}
          {/* 判分反馈（v1.7 新增：这是此前缺失的关键环节；解析改由 QwQuestionCard 第 6 段呈现，此处保留对错结论与导航） */}
          {answered ? <Card title={correct ? '✅ 回答正确' : '❌ 回答错误'}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, fontSize: 12.5, flexWrap: 'wrap' }}>
              <span style={{ color: correct ? '#10b981' : '#ef4444', fontWeight: 700 }}>{'你的答案 ' + sel}</span>
              <span style={{ color: '#10b981', fontWeight: 700 }}>{'正确答案 ' + q.correctAnswer}</span>
              {result.wrongEvent ? <span style={{ ...KV_TAG, background: 'rgba(99,102,241,.12)', color: '#6366f1' }}>
                {result.wrongEvent.type === 'mastered' ? '🎉 错题已掌握' : result.wrongEvent.type === 'promoted' ? '⬆ 升箱至 ' + result.wrongEvent.box : '📕 已入错题本'}</span> : null}
            </div>
            {/* cycle-25：解析改由 QwQuestionCard 第 6 段呈现；无解析题的诚实占位保留（旧文案契约，render 提交后断言锚定） */}
            {!q.analysis ? <div style={{ fontSize: 12, color: '#64748b' }}>{'该题无解析'}</div> : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button style={{ ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 18px' }} onClick={() => draw(module, srs)}>{'下一题 →'}</button>
              <button style={KV_BTN} onClick={() => { setSel(null); setResult(null) }}>{'重答本题'}</button>
              {onGoWrongbook ? <button style={KV_BTN} onClick={onGoWrongbook}>{'去错题本'}</button> : null}
            </div>
          </Card> : null}
        </div>
      )
    }

    /**
     * cycle-24 P0-1 取数下沉：错题本视图自治 fetch（原 props.data.wb 由父层拉取下发）。
     * 窄 props = { api }；单端点 /wrong 自取，hook 链恒定：useState×3 + useEffect×1。
     */
    interface NativeWrongbookViewProps { api: any; onGoPractice?: any }
    /**
     * NativeWrongbookView — 错题本工作台（cycle-33 issue#3 完善重写）
     * 新增：① 模块/状态筛选条 ② 「SRS 回炉」跳刷题（srs=1 直达回炉抽题）
     *       ③ 内嵌纸质补录卡（KgHistoryImport 复用——用户收「错题已进错题本」提示后
     *          回错题本能直接再补录，不再要去深度题库页找入口）④ 条目展开全文。
     * 保留：统计双卡 / SRS 箱位 / 出处标签 / mastered 灰化（cycle-21 形态不变）。
     */
    export function NativeWrongbookView({ api, onGoPractice }: NativeWrongbookViewProps) {
      const [wb, setWb] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [modFilter, setModFilter] = React.useState('')
      const [stateFilter, setStateFilter] = React.useState('all')
      const [expanded, setExpanded] = React.useState({})   // sig → 展开全文
      const [importOpen, setImportOpen] = React.useState(false)
      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        api('/wrong')
          .then((d: any) => { if (!cancelled) { setWb(d); setErr(null) } })
          .catch((e: any) => { if (!cancelled) setErr(String((e && e.message) || e)) })
          .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
      }, [api])
      if (loading) return <div className="kg-load"><div className="kg-spin" /></div>
      if (err || !wb) return <div style={{ color: '#ef4444', fontSize: 13 }}>{'错题本加载失败: ' + (err || '无数据')}</div>
      const { wrong, summary } = wb
      const tagStyle = { background: '#eef2ff', color: '#4338ca', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }
      // cycle-33 筛选：模块 chips（来源=条目里出现过的模块，确定性）+ 状态三态
      const modulesAll = Array.from(new Set((wrong || []).map((w: any) => String(w.module || '未知')))).sort()
      const filtered = (wrong || []).filter((w: any) => {
        if (modFilter && String(w.module || '未知') !== modFilter) return false
        if (stateFilter === 'open' && w.mastered) return false
        if (stateFilter === 'mastered' && !w.mastered) return false
        return true
      })
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 14 }}>
            <Stat v={(summary && summary.open) || 0} l="🔥 待消灭" color="#ef4444" />
            <Stat v={(summary && summary.mastered) || 0} l="✅ 已掌握" color="#10b981" />
          </div>
          {/* cycle-33 工作台操作条：SRS 回炉入口 + 纸质补录折叠开关（错题本=复习工作台，不只展示） */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {onGoPractice ? <button
              style={{ ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, fontWeight: 700 }}
              onClick={() => onGoPractice({ srs: 1 })}
              data-kg-wb-srs="1"
              title="跳到刷题页的 SRS 智能回炉（未掌握错题最久未复习优先）"
            >{'🔁 SRS 回炉复习'}</button> : null}
            <button
              style={{ ...KV_BTN, ...(importOpen ? { background: 'rgba(99,102,241,.12)', borderColor: 'rgba(99,102,241,.5)', color: '#4f46e5', fontWeight: 700 } : {}) }}
              onClick={() => setImportOpen(v => !v)}
              data-kg-wb-import="1"
            >{importOpen ? '▲ 收起纸质补录' : '📥 纸质刷题补录'}</button>
            <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{(filtered || []).length + ' / ' + (wrong || []).length + ' 条'}</span>
          </div>
          {importOpen ? <div style={{ marginBottom: 14 }}><KgHistoryImport api={api} /></div> : null}
          {/* cycle-33 筛选条：模块 chips + 状态三态 */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{'筛选'}</span>
            <button style={{ ...KV_BTN, ...(modFilter === '' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }} onClick={() => setModFilter('')}>{'全部模块'}</button>
            {modulesAll.map(m => <button key={m}
              style={{ ...KV_BTN, ...(modFilter === m ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }}
              onClick={() => setModFilter(m)}>{m}</button>)}
            <span style={{ width: 10 }} />
            {[['all', '全部'], ['open', '🔥 待消灭'], ['mastered', '✅ 已掌握']].map(([k, label]) =>
              <button key={k}
                style={{ ...KV_BTN, ...(stateFilter === k ? { background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#fff', border: 0 } : {}) }}
                onClick={() => setStateFilter(k)}>{label}</button>)}
          </div>
          {!(filtered || []).length && <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
            {!(wrong || []).length ? '🎉 错题本空空如也 — 保持！' : '当前筛选无条目 — 试试放宽模块/状态筛选'}
          </div>}
          {(filtered || []).map(w => <div key={w.sig} style={{ border: '1.5px solid rgba(148,163,184,.3)', borderRadius: 12, padding: '13px 15px', marginBottom: 9, background: 'var(--surface-card,#fff)', opacity: w.mastered ? .6 : 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={tagStyle}>{w.module}</span>
              <span style={tagStyle}>{'错' + w.wrongCount + '次'}</span>
              {(w.source || w.exam) ? <span style={{ ...tagStyle, background: 'rgba(99,102,241,.1)', color: '#4338ca' }}>{'📌 ' + ([w.exam || w.paperFile, w.year].filter(Boolean).join(' · ') || w.module)}</span> : null}
              {w.fromImport ? <span style={{ ...tagStyle, background: 'rgba(16,185,129,.12)', color: '#059669' }}>{'📥 纸质补录'}</span> : null}
              <span title={'SRS 箱位 ' + w.box + '/5'} style={{ display: 'inline-flex', gap: 3 }}>{Array.from({ length: 5 }, (_, i) => <i key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i < w.box ? (w.mastered ? '#10b981' : '#6366f1') : 'rgba(148,163,184,.3)' }} />)}</span>
              {w.mastered ? <span style={{ color: '#10b981', fontSize: 11, fontWeight: 700 }}>{'已掌握'}</span> : null}
            </div>
            {/* cycle-33 条目展开：点题干全文切换（默认 66px 截断，长题干看不全） */}
            <div
              style={{ fontSize: 12.5, lineHeight: 1.65, maxHeight: expanded[w.sig] ? 'none' : 66, overflow: 'hidden', cursor: 'pointer' }}
              onClick={() => setExpanded(m => ({ ...m, [w.sig]: !m[w.sig] }))}
              title={expanded[w.sig] ? '点击收起' : '点击展开全文'}
            >{w.stem}</div>
            {!expanded[w.sig] && String(w.stem || '').length > 90
              ? <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3, cursor: 'pointer' }} onClick={() => setExpanded(m => ({ ...m, [w.sig]: true }))}>{'… 展开全文'}</div>
              : null}
          </div>)}
        </div>
      )
    }
    interface NativeTuxingViewProps { api: any }
    export function NativeTuxingView({ api }: NativeTuxingViewProps) {
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

      if (!cats) return <div className="kg-load"><div className="kg-spin" />{'加载图形推理题库…'}</div>

      if (!cats.ready) {
        return (
          <Card title="🔷 图形推理专项">
            <div style={{ fontSize: 13, color: '#f59e0b' }}>{'⚠️ gk-tuxing 数据不可用（assets/data.js 缺失）'}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>{'回落方案：用「🧠 深度题库 → 图形推理专项」或「✏️ 刷题」。'}</div>
          </Card>
        )
      }

      // ── 分类选择页 ──
      if (!list) {
        return (
          <div>
            {/* cycle-15：记忆恢复横幅（一键回到「上次的规律类型 · 上次的题」） */}
            {(memLoaded && memData && memData.cat !== undefined && !memOff)
              ? <KgMemBanner
                  {...{ key: 'kgmem-tuxing' }}
                  data={memData}
                  text={'上次练到「' + (memData.catName || memData.cat || '未记录规律') + '」' + (memData.no ? ' · 第 ' + memData.no + ' 题' : '')}
                  onResume={() => { setCat(memData.cat || ''); load(memData.cat || '', Number(memData.idx) || 0) }}
                  onDismiss={() => setMemOff(true)}
                />
              : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
              <Stat v={cats.total} l="图形推理真题" color="#6366f1" />
              <Stat v={cats.cats.length} l="规律类型" color="#8b5cf6" />
              <Stat v="13 类" l="按规律分类" color="#10b981" />
            </div>
            <Card title="🔷 选择规律类型（按题量排序）">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <button
                  style={{ ...KV_BTN, ...(cat === '' ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }}
                  onClick={() => { setCat(''); load('') }}
                >{'全部 ' + cats.total}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                {cats.cats.map((c: any) => <div
                  key={c.cat}
                  style={{ border: '1.5px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 14, cursor: 'pointer', textAlign: 'center' }}
                  onClick={() => { setCat(c.cat); load(c.cat) }}
                >
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{c.count + ' 题'}</div>
                </div>)}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{busy ? '加载中…' : '点击规律类型开始专项练习'}</div>
            </Card>
          </div>
        )
      }

      // ── 答题页 ──
      const total = list.total || 0
      const pct = stat.done ? Math.round(stat.right / stat.done * 100) : 0

      const header = (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <button style={KV_BTN} onClick={() => { setList(null); setSel(''); setRevealed(false) }}>{'← 换规律'}</button>
          <span style={KV_TAG}>{q.catName}</span>
          {q.src ? <span style={{ ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}>{q.src}</span> : null}
          <span style={{ fontSize: 11.5, color: '#64748b' }}>{(idx + 1) + ' / ' + total}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#64748b' }}>{'本次 ' + stat.done + ' 题 · 对 ' + stat.right + (stat.done ? ' · ' + pct + '%' : '')}</span>
        </div>
      )

      // 选项（图片题：选项文字在题干图内，这里只给 A/B/C/D 按钮）
      const optRows = ['A', 'B', 'C', 'D'].map((L) => {
        const isRight = revealed && L === q.ans
        const isWrong = revealed && L === sel && L !== q.ans
        const chosen = !revealed && L === sel
        const border = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.3)'
        const bg = isRight ? 'rgba(16,185,129,.09)' : isWrong ? 'rgba(239,68,68,.08)' : chosen ? 'rgba(99,102,241,.08)' : 'transparent'
        const badge = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.15)'
        return (
          <div
            key={L}
            style={{ width: 54, height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid ' + border, background: bg, borderRadius: 12, cursor: revealed ? 'default' : 'pointer', fontWeight: 800, fontSize: 18, color: isRight || isWrong || chosen ? '#fff' : 'inherit' }}
            onClick={() => { if (!revealed) setSel(L) }}
          ><span style={{ background: badge, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, color: isRight || isWrong || chosen ? '#fff' : 'inherit' }}>{L}</span></div>
        )
      })

      // 解析区（答案 + 思路 + 分析 + 陷阱）
      const dims = []
      if (revealed) {
        dims.push(<div key="ans" style={{ marginBottom: 10, padding: 12, background: q.ans === sel ? 'rgba(16,185,129,.08)' : 'rgba(239,68,68,.06)', borderRadius: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: q.ans === sel ? '#10b981' : '#ef4444' }}>
            {q.ans === sel ? '✅ 回答正确' : '❌ 回答错误（你选 ' + (sel || '—') + '）'}
          </div>
          <div style={{ fontSize: 12.5 }}>{'正确答案：' + q.ans + (q.fmt ? ' · ' + q.fmt : '')}</div>
        </div>)
        if (q.exp) dims.push(<div key="exp" style={{ marginBottom: 10, padding: 12, background: 'rgba(14,165,233,.06)', borderRadius: 10, borderLeft: '3px solid #0ea5e9' }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#0ea5e9' }}>{'🧠 解题思路（本站原创）'}</div>
          <RichText text={q.exp} />
        </div>)
        if (q.acc) dims.push(<div key="acc" style={{ marginBottom: 10, padding: 12, background: 'rgba(139,92,246,.06)', borderRadius: 10, borderLeft: '3px solid #8b5cf6' }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#8b5cf6' }}>{'🔍 图形分析'}</div>
          <RichText text={q.acc} />
        </div>)
        if (q.trap) dims.push(<div key="trap" style={{ padding: 12, background: 'rgba(245,158,11,.08)', borderRadius: 10, borderLeft: '3px solid #f59e0b' }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#f59e0b' }}>{'⚠️ 易错陷阱'}</div>
          <RichText text={q.trap} />
        </div>)
      }

      const actionRow = revealed
        ? <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button style={{ ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 20px' }} onClick={() => { if (idx < (list.questions.length - 1)) { setIdx(idx + 1); setSel(''); setRevealed(false) } else { load(cat) } }}>{idx < (list.questions.length - 1) ? '下一题 →' : '再来一组 →'}</button>
            <button style={KV_BTN} onClick={() => { setSel(''); setRevealed(false) }}>{'重做本题'}</button>
          </div>
        : <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 10 }}>{sel ? '' : '先选一个答案'}</div>

      return (
        <div>
          {header}
          <Card title={'第 ' + q.no + ' 题 · ' + q.catName}>
            {/* cycle-21：图形推理题出处（gk-tuxing + 上游原始出处 src） */}
            <SourceBadge {...({ source: q.source || 'gk-tuxing', exam: q.src, paperFile: q.src ? String(q.src).replace(/\.md$/, '') : null } as any)} />
            <img
              src={q.imgUrl} alt="图形推理题"
              style={{ maxWidth: '100%', maxHeight: 340, display: 'block', margin: '6px 0 14px', borderRadius: 10, border: '1px solid rgba(148,163,184,.25)', background: '#fff' }}
            />
            <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>{optRows}</div>
            {!revealed && sel ? <button
              style={{ ...KV_BTN, marginTop: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '8px 20px' }}
              onClick={() => { setRevealed(true); setStat((st2: any) => ({ done: st2.done + 1, right: st2.right + (sel === q.ans ? 1 : 0) })) }}
            >{'提交并看思路'}</button> : actionRow}
          </Card>
          {dims.length ? <div style={{ marginTop: 14 }}>{dims}</div> : null}
        </div>
      )
    }

    /**
     * 深度题库视图（GongkaoNaoku）：27506 题五维标注
     * kadian(考什么) / reasoning(怎么推) / fastest(最快解法) / pitfalls(易错) / mother(母题)
     */
    interface NativeDeepBankViewProps { api: any; initialModule?: any; initialCategory?: any }
    export function NativeDeepBankView({ api, initialModule = '', initialCategory = '' }: NativeDeepBankViewProps) {
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
        return (
          <Card title="📚 深度题库">
            <div style={{ fontSize: 13, color: '#f59e0b' }}>{'⚠️ ' + (status.hint || '深度题库不可用')}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
              {'需要 Node ≥ 22.19（内置 node:sqlite）且 GongkaoNaoku 分片存在。回落方案：用「✏️ 刷题」或「📚 真题卷」。'}
            </div>
          </Card>
        )
      }

      const st = status && status.stats

      const statsRow = st
        ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 }}>
            <Stat v={st.total} l="深度标注题" color="#6366f1" />
            <Stat v={st.kadianCoverage + '%'} l="知识点覆盖" color="#10b981" />
            <Stat v={st.fastestCoverage + '%'} l="速解覆盖" color="#f59e0b" />
            <Stat v={st.withImage} l="含图题" color="#8b5cf6" />
          </div>
        : null

      const kadiansBlock = kadians.length > 0
        ? <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {kadians.map((k, i) => <div
              key={i}
              style={{ padding: '8px 10px', borderRadius: 9, marginBottom: 4, background: 'rgba(148,163,184,.06)', cursor: 'pointer', fontSize: 12.5 }}
              onClick={() => drawByKadian(k.kadian)}
            >
              <div style={{ display: 'flex', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                <span style={KV_TAG}>{k.module || ''}</span>
                {k.category ? <span style={{ ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}>{k.category}</span> : null}
                <span style={{ fontSize: 10.5, color: '#64748b' }}>{k.count + ' 题'}</span>
              </div>
              <div>{k.kadian}</div>
            </div>)}
          </div>
        : null

      // T-023 图形推理专项卡（懒加载规律分类）
      const tuxingCard = <Card title="🔷 图形推理专项（按规律类型）">
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
          {'图形推理是行测最大失分模块。下面按「数量规律 / 位置规律 / 样式规律 / 属性规律」分类，点即刷该规律。'}
        </div>
        {!tuxing ? <button style={KV_BTN} onClick={loadTuxing}>{'展开规律分类'}</button> : null}
        {tuxing && tuxing.length === 0 ? <div style={{ fontSize: 12, color: '#64748b' }}>{'暂无规律分类数据'}</div> : null}
        {tuxing ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tuxing.map((t2: any, i: number) => <button
            key={i}
            style={{ ...KV_BTN, fontSize: 11, textAlign: 'left', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={t2.kadian}
            onClick={() => { setModule('判断推理'); drawByKadian(t2.kadian) }}
          >{String(t2.kadian).replace('图形推理 / ', '') + '（' + t2.count + '）'}</button>)}
        </div> : null}
      </Card>

      const searchCard = <Card title="🔍 知识点检索（考点 → 解题思路）">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            value={kw}
            onChange={e => setKw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') searchK() }}
            placeholder="输入考点关键词，如「图形推理」「模态命题」「增长率」"
            style={{ flex: 1, padding: '8px 12px', borderRadius: 9, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' }}
          />
          <button style={{ ...KV_BTN, padding: '8px 16px' }} onClick={searchK}>{'搜索'}</button>
        </div>
        {kadiansBlock}
      </Card>

      // 题目区（分块构造，避免深嵌套三元）
      let questionCard = null
      if (q) {
        const headerTags: any[] = []
        if (q.module) headerTags.push(<span key="m" style={KV_TAG}>{q.module}</span>)
        if (q.type) headerTags.push(<span key="t" style={{ ...KV_TAG, background: 'rgba(139,92,246,.12)', color: '#8b5cf6' }}>{q.type}</span>)
        if (q.year) headerTags.push(<span key="y" style={KV_TAG}>{q.year}</span>)
        if (q.region) headerTags.push(<span key="r" style={KV_TAG}>{q.region}</span>)

        const optRows = entries(q.options || {}).map(([L, txt]) => {
          const isRight = revealed && L === q.correctAnswer
          const isWrong = revealed && L === sel && L !== q.correctAnswer
          const chosen = !revealed && L === sel
          const border = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.3)'
          const bg = isRight ? 'rgba(16,185,129,.09)' : isWrong ? 'rgba(239,68,68,.08)' : chosen ? 'rgba(99,102,241,.08)' : 'transparent'
          const badge = isRight ? '#10b981' : isWrong ? '#ef4444' : chosen ? '#6366f1' : 'rgba(148,163,184,.15)'
          const badgeColor = (isRight || isWrong || chosen) ? '#fff' : 'inherit'
          return (
            <div
              key={L}
              style={{ display: 'flex', gap: 10, padding: '10px 12px', border: '2px solid ' + border, background: bg, borderRadius: 10, marginTop: 8, cursor: revealed ? 'default' : 'pointer', fontSize: 13, lineHeight: 1.6 }}
              onClick={() => { if (!revealed) setSel(L) }}
            >
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: badge, color: badgeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{L}</div>
              {/* cycle-22：选项含图占位 → RichText 渲染出图（公式图/选项图不再剥掉） */}
              {String(txt || '').includes('kgimg://') ? <div style={{ flex: 1, minWidth: 0 }}><RichText text={txt} fontSize={13} /></div> : <div style={{ flex: 1 }}>{txt}</div>}
            </div>
          )
        })

        const actionBtn = revealed
          ? <button style={{ ...KV_BTN, padding: '7px 18px' }} onClick={() => draw(module)}>{'下一题 →'}</button>
          : <button style={{ ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '7px 18px' }} disabled={!sel} onClick={() => setRevealed(true)}>{'查看答案与解题链'}</button>

        // 五维标注
        const dims: any[] = []
        if (revealed) {
          if (q.analysis) dims.push(<div key="an" style={{ marginBottom: 10, padding: 12, background: 'rgba(148,163,184,.07)', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5 }}>{'📖 解析'}</div><RichText text={q.analysis} /></div>)
          if (q.kadian) dims.push(<div key="kd" style={{ marginBottom: 10, padding: 12, background: 'rgba(99,102,241,.07)', borderRadius: 10, borderLeft: '3px solid #6366f1' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#6366f1' }}>{'🎯 考点定位'}</div><RichText text={q.kadian} /></div>)
          if (q.reasoning) dims.push(<div key="rs" style={{ marginBottom: 10, padding: 12, background: 'rgba(14,165,233,.07)', borderRadius: 10, borderLeft: '3px solid #0ea5e9' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#0ea5e9' }}>{'🧠 解题推理链'}</div><RichText text={q.reasoning} /></div>)
          if (q.fastest) dims.push(<div key="fs" style={{ marginBottom: 10, padding: 12, background: 'rgba(245,158,11,.08)', borderRadius: 10, borderLeft: '3px solid #f59e0b' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#f59e0b' }}>{'⚡ 最快解法（考场用）'}</div><RichText text={q.fastest} /></div>)
          if (q.pitfalls) dims.push(<div key="pf" style={{ marginBottom: 10, padding: 12, background: 'rgba(239,68,68,.07)', borderRadius: 10, borderLeft: '3px solid #ef4444' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#ef4444' }}>{'⚠️ 易错点'}</div><RichText text={q.pitfalls} /></div>)
          if (q.mother) dims.push(<div key="mo" style={{ padding: 12, background: 'rgba(139,92,246,.07)', borderRadius: 10, borderLeft: '3px solid #8b5cf6' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5, color: '#8b5cf6' }}>{'🧩 母题思维'}</div><RichText text={q.mother} /></div>)
        }

        questionCard = (
          <div>
            {/* cycle-21：深度题库题也标出处（naoku + 卷名/年份/考点） */}
            <SourceBadge {...({ source: q.source || 'naoku', exam: q.exam, year: q.year, region: q.region,
              extra: q.kadian ? <span style={{ ...KV_TAG, background: 'rgba(99,102,241,.12)', color: '#6366f1' }}>{'🎯 ' + String(q.kadian).slice(0, 18)}</span> : null } as any)} />
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>{headerTags}</div>
            {/* cycle-23 P0（用户二报）：深度题库材料块——资料分析统计图表/言语理解文段材料 */}
            {/* 由服务端 material 字段单发（与 stem 字段分离），UI 在题干上方组装渲染。 */}
            {q.material ? <div style={{ marginBottom: 10, padding: 12, background: 'rgba(148,163,184,.07)', borderRadius: 10, borderLeft: '3px solid rgba(148,163,184,.5)' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ ...KV_TAG, background: 'rgba(14,165,233,.12)', color: '#0ea5e9' }}>{'📄 材料'}</span>
                {q.materialRef ? <span style={{ fontSize: 10.5, color: '#64748b' }}>{String(q.materialRef).slice(0, 40)}</span> : null}
              </div>
              <RichText text={q.material} fontSize={12.5} maxHeight={'38vh' as any} /></div> : null}
            <RichText text={q.stem} fontSize={13.5} maxHeight={'30vh' as any} />
            {optRows}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>{actionBtn}</div>
            {revealed ? null : <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>{'答完可查看「考点定位 / 推理链 / 最快解法 / 易错点 / 母题」五维标注'}</div>}
            {dims.length > 0 ? <div style={{ marginTop: 14 }}>{dims}</div> : null}
          </div>
        )
      }

      const moduleBtns = ['判断推理', '言语理解与表达', '数量关系', '资料分析', '常识判断'].map(m2 =>
        <button
          key={m2}
          style={{ ...KV_BTN, ...(module === m2 ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0 } : {}) }}
          onClick={() => { setModule(m2); draw(m2) }}
        >{m2}</button>)

      return (
        <div>
          {statsRow}
          {searchCard}
          {tuxingCard}
          {/* cycle-21 H5（issue #3）：纸质补录四步旅程（搜索→核对→补录→批次撤销） */}
          <KgHistoryImport api={api} />
          {/* cycle-15：记忆恢复横幅（未抽题时展示；恢复 = 直接回到上次的模块 + 原题） */}
          {(!q && memLoaded && memData && memData.question && !memOff)
            ? <KgMemBanner
                {...{ key: 'kgmem-deep' }}
                data={memData}
                text={'上次练到「' + (memData.module || '未记录模块') + '」· ' + String((memData.question && memData.question.stem) || '').slice(0, 26) + '…'}
                onResume={() => { setModule(memData.module || ''); setQ(memData.question); setSel(null); setRevealed(false) }}
                onDismiss={() => setMemOff(true)}
              />
            : null}
          <Card title="🎯 深度刷题（带解题思维链）">
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>{moduleBtns}</div>
            {busy ? <div style={{ fontSize: 12, color: '#64748b' }}>{'抽题中…'}</div> : null}
            {questionCard}
          </Card>
        </div>
      )
    }

    /**
     * 纸质刷题记录补录（cycle-21 H5 · issue #3 第一阶段）
     * 四步旅程：① 题干关键词搜候选 → ② 展示题干/选项/来源供核对 →
     * ③ 补录 对/错/结果未知（可选书名页码/原始日期）→ ④ 批次撤销（环形 30）。
     * 纪律：历史补录不进「今日新刷」（服务端统计隔离）；重复补录=冲突提示；可整批撤销。
     */
    interface KgHistoryImportProps { api: any }
    function KgHistoryImport({ api }: KgHistoryImportProps) {
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
      return (
        <Card title="📥 纸质刷题补录（把纸上的对错记进系统）">
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
            {'① 输入题干关键词搜现有题库 → ② 核对候选（题干/选项/来源）→ ③ 标记 已做对/已做错/结果未知 → ④ 保存（错题自动进错题本，同批次可撤销）。原始日期未知可留空。'}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <input
              value={kw} onChange={(e: any) => setHikw(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter') doSearch() }}
              placeholder="题干关键词，如「林产品出口」「模态命题」"
              style={{ flex: '1 1 260px', padding: '7px 11px', borderRadius: 9, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 12, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' }} />
            <button style={{ ...KV_BTN, padding: '7px 14px' }} onClick={doSearch} disabled={busy}>{busy ? '…' : '🔍 搜索候选'}</button>
          </div>
          {/* ② 核对候选 */}
          {results ? <div style={{ marginBottom: 8 }}>
            {results.list && results.list.length
              ? results.list.map((it: any) => {
                  const picked = picks[it.contentSig]
                  const stemPlain = String(it.stem || '').slice(0, 110)
                  return (
                    <div key={it.contentSig} style={{ border: '1.5px solid ' + (picked ? '#6366f1' : 'rgba(148,163,184,.25)'), borderRadius: 10, padding: '9px 11px', marginBottom: 6, background: picked ? 'rgba(99,102,241,.05)' : 'transparent' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={KV_TAG}>{it.module || ''}</span>
                        {it.matchSource ? <span style={{ ...KV_TAG, fontSize: 9.5 }}>{it.matchSource === 'naoku' ? '深度题库' : '真题库'}</span> : null}
                        {it.year ? <span style={{ ...KV_TAG, fontSize: 9.5 }}>{String(it.year)}</span> : null}
                        {picked ? <span style={{ ...KV_TAG, background: 'rgba(99,102,241,.12)', color: '#4338ca', fontSize: 9.5 }}>{'已标记: ' + (picked.result === 'right' ? '做对' : picked.result === 'wrong' ? '做错' : '结果未知')}</span> : null}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>{stemPlain + (String(it.stem || '').length > 110 ? '…' : '')}</div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                        <button style={{ ...KV_BTN, fontSize: 10.5, ...(picked && picked.result === 'right' ? { background: 'rgba(16,185,129,.14)', color: '#059669', borderColor: '#10b981' } : {}) }} onClick={() => pick(it, 'right')}>{'✓ 已做对'}</button>
                        <button style={{ ...KV_BTN, fontSize: 10.5, ...(picked && picked.result === 'wrong' ? { background: 'rgba(239,68,68,.14)', color: '#dc2626', borderColor: '#ef4444' } : {}) }} onClick={() => pick(it, 'wrong')}>{'✗ 已做错'}</button>
                        <button style={{ ...KV_BTN, fontSize: 10.5, ...(picked && picked.result === 'unknown' ? { background: 'rgba(245,158,11,.14)', color: '#b45309', borderColor: '#f59e0b' } : {}) }} onClick={() => pick(it, 'unknown')}>{'? 结果未知'}</button>
                      </div>
                    </div>
                  )
                })
              : <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0' }}>{'未找到含该关键词的题目——换个更短的关键词试试'}</div>}
          </div> : null}
          {/* ③ 补录附加信息 + 提交 */}
          {pickList.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.18)' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#4338ca' }}>{'待补录 ' + pickList.length + ' 题'}</span>
            <input value={srcNote} onChange={(e: any) => setHiSrc(e.target.value)} placeholder="纸质来源（书名·页码，可选）" style={{ flex: '1 1 180px', padding: '5px 9px', borderRadius: 8, border: '1px solid rgba(148,163,184,.3)', fontSize: 11, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' }} />
            <input value={happenedAt} onChange={(e: any) => setHiDate(e.target.value)} placeholder="原始作答日期 YYYY-MM-DD（可选）" style={{ flex: '1 1 180px', padding: '5px 9px', borderRadius: 8, border: '1px solid rgba(148,163,184,.3)', fontSize: 11, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' }} />
            <button style={{ ...KV_BTN, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, fontWeight: 700, padding: '6px 14px' }} onClick={submit} disabled={busy}>{busy ? '保存中…' : '💾 保存补录'}</button>
          </div> : null}
          {msg ? <div style={{ fontSize: 11.5, marginTop: 8, color: msg.ok ? '#059669' : '#dc2626' }}>{(msg.ok ? '✓ ' : '⚠ ') + msg.text}</div> : null}
          {/* ④ 批次台账 + 撤销 */}
          {batches && batches.importedTotal > 0
            ? <div style={{ marginTop: 10, borderTop: '1px dashed rgba(148,163,184,.2)', paddingTop: 8 }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>{'累计补录 ' + batches.importedTotal + ' 题 · 近 ' + (batches.batches || []).length + ' 批（可撤销窗口 30 批）'}</div>
                {(batches.batches || []).slice(0, 5).map((b: any) => <div key={b.batchId} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10.5, color: '#64748b', padding: '2px 0' }}>
                  <span style={{ fontFamily: 'monospace' }}>{String(b.batchId).slice(0, 14)}</span>
                  <span>{b.count + ' 题'}</span>
                  {b.source ? <span>{'· ' + String(b.source).slice(0, 24)}</span> : null}
                  <button style={{ ...KV_BTN, fontSize: 9.5, marginLeft: 'auto', color: '#dc2626', borderColor: 'rgba(239,68,68,.4)' }} onClick={() => undoBatch(b.batchId)} disabled={busy}>{'↩ 撤销此批'}</button>
                </div>)}
              </div>
            : null}
        </Card>
      )
    }
