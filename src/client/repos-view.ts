/**
 * repos-view.ts — NativeReposView 原始题库管理面板（cycle-16 一键式安装）
 *
 * 背景：npm/GitHub 单独发布时插件不含题库数据（15 仓库 GB 级）。本视图把
 * 「装数据」变成宿主内一键操作：必选/推荐/可选分级卡片 + 克隆/更新/删除 +
 * 实时作业日志 + 目录浏览 + 数据根与镜像代理自定义。
 * 设计纪律（继承 obs-view）：
 *  ① 所有接口字段视为可选，缺失即卡片级降级，绝不 role="alert"；
 *  ② hook 全部在组件顶部、数量恒定（R9）；事件一律 onClick 驼峰（R6）；
 *  ③ 顶层名全部 Rp* 前缀（combo 单作用域防重名，教训⑨）；
 *  ④ 作业轮询：有 running 作业时 2s 一次，无作业自动停表（省电停帧同构理念）。
 */
import { h, React, entries, Stat, Card, KV_TAG, KV_BTN } from './ui-kit.js'

/** tier 元数据（颜色/文案/排序；与 server REPOS_META.tier 词表同源） */
const RP_TIERS: any = {
  required:    { label: '必选', color: '#ef4444', tip: '核心视图硬依赖：行测刷题/方法论/图形推理（约 363MB）' },
  recommended: { label: '推荐', color: '#f59e0b', tip: '真题卷/整卷模考/申论评改/深度题库依赖（约 746MB）' },
  optional:    { label: '可选', color: '#6366f1', tip: '增强素材，按需拉取避免一次下载过大' },
}
const RP_TIER_ORDER = ['required', 'recommended', 'optional']

/** 状态徽章（present/isGit/job 三源合成） */
function rpBadge(r: any) {
  if (r.job && r.job.state === 'running') return { text: r.job.action === 'clone' ? '⬇ 下载中…' : '🔄 更新中…', bg: 'rgba(99,102,241,.14)', fg: '#4f46e5' }
  if (r.job && r.job.state === 'failed') return { text: '❌ 失败', bg: 'rgba(239,68,68,.12)', fg: '#dc2626' }
  if (r.job && r.job.state === 'canceled') return { text: '⏹ 已取消', bg: 'rgba(148,163,184,.15)', fg: '#64748b' }
  if (r.present && r.isGit) return { text: '✅ 已安装', bg: 'rgba(16,185,129,.12)', fg: '#059669' }
  if (r.present && !r.isGit) return { text: '⚠ 非 git 目录', bg: 'rgba(245,158,11,.14)', fg: '#b45309' }
  return { text: '○ 未安装', bg: 'rgba(148,163,184,.12)', fg: '#64748b' }
}

/** 作业日志尾部折叠块 */
function RpJobLog({ job }: any) {
  const [open, setOpen] = React.useState(false)
  if (!job || (!job.log || !job.log.length) && !job.error) return null
  return h('div', { style: { marginTop: 6 } },
    h('button', { style: KV_BTN, onClick: () => setOpen((v: any) => !v) }, open ? '▾ 收起日志' : '▸ 查看日志'),
    open ? h('div', { style: { marginTop: 4, maxHeight: 140, overflowY: 'auto', background: 'rgba(15,23,42,.05)', borderRadius: 8, padding: '6px 9px', fontFamily: 'monospace', fontSize: 10, lineHeight: 1.6, color: '#475569', whiteSpace: 'pre-wrap' } },
      job.error ? '错误: ' + job.error + '\n' : '', (job.log || []).join('\n')) : null)
}

export function NativeReposView({ api }: any) {
  /* ── hooks 顶部恒定：state×5 + effect×2 + callback×4 ── */
  const [data, setData] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [busyKey, setBusyKey] = React.useState('')
  const [browse, setBrowse] = React.useState(null)   // { key, sub, items, total, truncated, error? }
  const [cfgDraft, setCfgDraft] = React.useState({ root: '', mirror: '' })
  const aliveRef = React.useRef(true)
  const pollRef = React.useRef(null)

  const load = React.useCallback(async () => {
    try {
      const d = await api('/repos')
      if (!aliveRef.current) return
      setData(d)
      setErr('')
      setCfgDraft({ root: (d && d.root) || '', mirror: (d && d.mirror) || '' })
    } catch (e: any) { if (aliveRef.current) setErr(String((e && e.message) || e)) }
  }, [api])

  React.useEffect(() => {
    aliveRef.current = true
    load()
    return () => { aliveRef.current = false; try { if (pollRef.current) clearInterval(pollRef.current) } catch {} }
  }, [load])

  // 轮询：存在 running 作业 → 2s 刷新一次；全部结束自动清表（省电）
  React.useEffect(() => {
    const running = data && data.summary && data.summary.running > 0
    if (!running) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } return }
    if (pollRef.current) return
    pollRef.current = setInterval(() => { load() }, 2000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [data, load])

  const post = React.useCallback(async (path: string, body: any) => {
    setBusyKey('')
    try {
      const r = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r && r.error) setErr(r.error)
      await load()
      return r
    } catch (e: any) { setErr(String((e && e.message) || e)); return null }
  }, [api, load])

  const doInstall = (key: string) => { setBusyKey(key); post('/repos/install', { key }) }
  const doCancel = (key: string) => post('/repos/cancel', { key })
  const doRemove = (key: string) => {
    if (!window.confirm('确定删除本地目录 ' + key + '？（仅删除已下载数据，不影响学习进度）')) return
    post('/repos/remove', { key })
  }
  const doBrowse = async (key: string, sub: string) => {
    try {
      const d = await api('/repos/browse?key=' + encodeURIComponent(key) + (sub ? '&sub=' + encodeURIComponent(sub) : ''))
      setBrowse(Object.assign({ key, sub }, d))
    } catch (e: any) { setBrowse({ key, sub, error: String((e && e.message) || e), items: [] }) }
  }

  /* ── 数据未达/空态骨架（先过完全部 hooks 再降级返回） ── */
  if (!data) {
    return h('div', {}, err
      ? h(Card, { title: '📦 原始题库管理' }, h('div', { style: { fontSize: 12, color: '#b45309' } }, '状态端点未就绪：' + err + '（服务可用时自动恢复）'))
      : h('div', { className: 'kg-load', style: { padding: 40 } }, h('div', { className: 'kg-spin' }), '读取题库状态…'))
  }

  const repos: any[] = Array.isArray(data.repos) ? data.repos : []
  const sum: any = data.summary || {}
  const grouped: any = {}
  for (const t of RP_TIER_ORDER) grouped[t] = repos.filter(r => r.tier === t)
  const requiredReady = (sum.requiredMissing || []).length === 0

  const btn = (label: any, on: any, fn: any, style?: any) => h('button', {
    key: String(label), onClick: fn, style: Object.assign({}, KV_BTN, style || {}),
  }, label)

  return h('div', {},
    err ? h('div', { style: { fontSize: 11.5, color: '#b45309', marginBottom: 8 } }, '⚠ ' + err) : null,

    /* ① 总览 */
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 } },
      h(Stat, { v: (sum.present || 0) + '/' + (sum.total || 0), l: '仓库就绪', color: requiredReady ? '#10b981' : '#ef4444' }),
      h(Stat, { v: sum.requiredMissing && sum.requiredMissing.length ? sum.requiredMissing.length : 0, l: '必选缺失', color: sum.requiredMissing && sum.requiredMissing.length ? '#ef4444' : '#10b981' }),
      h(Stat, { v: sum.running || 0, l: '进行中作业', color: (sum.running || 0) ? '#6366f1' : undefined }),
      data.git === false ? h(Stat, { v: '✗', l: 'git 不可用', color: '#ef4444' }) : h(Stat, { v: '✓', l: 'git 可用', color: '#10b981' })),

    /* ② 数据根与镜像配置 */
    h(Card, { title: '🗂 数据根与镜像代理' },
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 } },
        h('span', { style: KV_TAG }, '生效根: ' + String(data.root || '—')),
        data.rootSource ? h('span', { style: KV_TAG }, '来源: ' + data.rootSource) : null),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
        h('input', { value: cfgDraft.root, placeholder: '自定义数据根目录（绝对路径，留空=自动）', onChange: (e: any) => setCfgDraft((c: any) => Object.assign({}, c, { root: e.target.value })), style: { flex: '1 1 240px', padding: '6px 10px', borderRadius: 8, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 12, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' } }),
        btn('保存根目录', false, () => post('/repos/config', { root: cfgDraft.root }))),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        h('input', { value: cfgDraft.mirror, placeholder: '镜像前缀（如 https://gh-proxy.com/），留空=直连', onChange: (e: any) => setCfgDraft((c: any) => Object.assign({}, c, { mirror: e.target.value })), style: { flex: '1 1 240px', padding: '6px 10px', borderRadius: 8, border: '1.5px solid rgba(148,163,184,.35)', fontSize: 12, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'var(--text-primary,#0f172a)' } }),
        btn('保存镜像', false, () => post('/repos/config', { mirror: cfgDraft.mirror }))),
      h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 6 } }, '镜像前缀对 clone/pull 同时生效；国内网络建议 https://gh-proxy.com/')),

    /* ③ 一键必选 */
    !requiredReady
      ? h(Card, { title: '🚀 一键安装必选包' },
          h('div', { style: { fontSize: 12, color: '#64748b', marginBottom: 8 } }, '缺失必选：' + (sum.requiredMissing || []).join('、') + ' —— 合计约 363MB，装完即可用刷题/方法论/图推三大核心视图'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            (sum.requiredMissing || []).map((k: string) => btn('⬇ ' + k, false, () => doInstall(k), { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '7px 16px' }))))
      : null,

    /* ④ 分级仓库卡片 */
    RP_TIER_ORDER.map(tier => h(Card, { key: 'tier-' + tier, title: (RP_TIERS[tier].label) + ' · ' + grouped[tier].length + ' 个（' + tier + '）' },
      h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginBottom: 8 } }, RP_TIERS[tier].tip),
      grouped[tier].map((r: any) => {
        const b = rpBadge(r)
        const running = r.job && r.job.state === 'running'
        return h('div', { key: r.key, style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '7px 0', borderBottom: '1px dashed rgba(148,163,184,.18)' } },
          h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: RP_TIERS[tier].color, flexShrink: 0 } }),
          h('span', { title: r.desc, style: { fontWeight: 700, fontSize: 12, minWidth: 150 } }, r.key),
          h('span', { style: { ...KV_TAG, background: b.bg, color: b.fg } }, b.text),
          r.size ? h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, r.size) : null,
          r.present ? h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, r.files + ' 项') : null,
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 5, flexWrap: 'wrap' } },
            running ? btn('⏹ 取消', false, () => doCancel(r.key)) : null,
            !running ? btn(busyKey === r.key ? '…' : (r.present && r.isGit ? '🔄 更新' : '⬇ 安装'), false, () => doInstall(r.key),
              r.present && r.isGit ? {} : { background: 'rgba(99,102,241,.1)', color: '#4f46e5', borderColor: 'rgba(99,102,241,.4)', fontWeight: 700 }) : null,
            r.present ? btn('👁 浏览', false, () => doBrowse(r.key, '')) : null,
            r.present ? btn('🗑 删除', false, () => doRemove(r.key)) : null,
            r.upstream ? h('a', { href: r.upstream, target: '_blank', rel: 'noreferrer', title: '上游仓库（致敬原作者）', style: { fontSize: 11, color: '#6366f1', textDecoration: 'none', alignSelf: 'center' } }, '↗') : null),
          h(RpJobLog, { job: r.job }))
      }))),

    /* ⑤ 浏览抽屉 */
    browse
      ? h(Card, { title: '👁 浏览 · ' + browse.key + (browse.sub ? ' / ' + browse.sub : '') },
          browse.error ? h('div', { style: { fontSize: 12, color: '#b45309' } }, browse.error) : null,
          browse.sub ? h('div', { style: { marginBottom: 6 } }, btn('← 上级', false, () => doBrowse(browse.key, browse.sub.split('/').slice(0, -1).join('/')))) : null,
          (browse.items || []).slice(0, 120).map((it: any) => h('div', {
            key: it.name,
            style: { display: 'flex', gap: 8, alignItems: 'center', padding: '3px 2px', borderBottom: '1px solid rgba(148,163,184,.1)', fontSize: 11.5, cursor: it.dir ? 'pointer' : 'default' },
            onClick: it.dir ? () => doBrowse(browse.key, (browse.sub ? browse.sub + '/' : '') + it.name) : undefined,
          },
            h('span', { style: { width: 18, textAlign: 'center' } }, it.dir ? '📁' : '·'),
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.name),
            !it.dir && it.size != null ? h('span', { style: { color: '#94a3b8', fontSize: 10 } }, it.size > 1048576 ? (it.size / 1048576).toFixed(1) + 'MB' : it.size > 1024 ? (it.size / 1024).toFixed(1) + 'KB' : it.size + 'B') : null)),
          browse.truncated ? h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 4 } }, '仅显示前 120 项（共 ' + browse.total + '）') : null,
          h('div', { style: { marginTop: 6 } }, btn('✕ 关闭', false, () => setBrowse(null))))
      : null,

    /* ⑥ 口径说明 */
    h('div', { style: { fontSize: 10.5, color: '#94a3b8', lineHeight: 1.8 } },
      '口径：安装=git clone --depth 1（浅克隆省流量）· 已装仓库再点=git pull --ff-only 更新 · 删除仅清本地数据目录（学习进度在 data/progress 不受影响）· ',
      '非 git 目录受保护拒绝覆盖 · 并发上限 2 · 全部数据归上游仓库作者所有（点 ↗ 致敬原作者）。'))
}
