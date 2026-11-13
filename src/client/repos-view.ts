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

/** cycle-20 G6：健康巡检徽章（与 server repoState.health 词表同源；字段缺失降级为「未知」） */
const RP2_HEALTH: any = {
  ok:         { text: '健康', color: '#059669', bg: 'rgba(16,185,129,.12)' },
  empty:      { text: '空仓库', color: '#b45309', bg: 'rgba(245,158,11,.14)' },
  'half-clone': { text: '半成品', color: '#b45309', bg: 'rgba(245,158,11,.14)' },
  'no-git':   { text: '缺 .git', color: '#dc2626', bg: 'rgba(239,68,68,.12)' },
  absent:     { text: '未安装', color: '#64748b', bg: 'rgba(148,163,184,.12)' },
}
/** 最近更新时间人读化（lastCommitAt 毫秒；缺失/无效 → 空串由调用方降级） */
function rp2Ago(ms: any): string {
  const v = Number(ms)
  if (!isFinite(v) || v <= 0) return ''
  const d = Math.floor((Date.now() - v) / 86400000)
  if (d <= 0) return '今天更新'
  if (d === 1) return '昨天更新'
  if (d < 30) return d + ' 天前更新'
  if (d < 365) return Math.floor(d / 30) + ' 个月前更新'
  return Math.floor(d / 365) + ' 年前更新'
}
/** 字节数人读化（磁盘可用空间；null 降级） */
function rp2Size(mb: any): string {
  const v = Number(mb)
  if (!isFinite(v) || v < 0) return ''
  return v >= 1024 ? (v / 1024).toFixed(1) + ' GB' : Math.round(v) + ' MB'
}

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

/** 外链小按钮（target=_blank + rel 安全；字段缺失即不渲染该项） */
function rpLinkBtn(url: any, label: any, title: any) {
  if (!url || typeof url !== 'string') return null
  return h('a', {
    href: url, target: '_blank', rel: 'noreferrer noopener', title: title || url,
    style: { ...KV_BTN, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' },
  }, label + ' ↗')
}

/** 「关于本项目」卡：本插件 GitHub 仓库/Release/Issue/npm 跳转 + 版本徽章（self 元数据缺失整卡隐藏） */
function RpAboutProject({ self }: any) {
  if (!self || typeof self !== 'object' || !self.repo) return null
  return h('div', {
    style: {
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
      marginBottom: 14, padding: '10px 14px', borderRadius: 12,
      background: 'linear-gradient(135deg,rgba(99,102,241,.08),rgba(20,184,166,.06))',
      border: '1px solid rgba(99,102,241,.22)',
    },
  },
    h('span', { style: { fontWeight: 800, fontSize: 12.5, color: '#334155' } }, '🧭 关于本项目 · ' + (self.name || 'dsh-kaogong')),
    self.version ? h('span', { style: { ...KV_TAG, background: 'rgba(16,185,129,.12)', color: '#059669' } }, 'v' + self.version) : null,
    self.desc ? h('span', { style: { fontSize: 11, color: '#64748b', flex: '1 1 200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: self.desc }, self.desc) : null,
    h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' } },
      rpLinkBtn(self.repo, 'GitHub 仓库', '项目主页与源码'),
      rpLinkBtn(self.releases, 'Release', '版本发布记录（含更新说明）'),
      rpLinkBtn(self.issues, '反馈 Issue', '问题反馈与功能建议'),
      rpLinkBtn(self.npm, 'npm', 'npm 包页面'),
      rpLinkBtn(self.repo ? self.repo + '#-致敬上游全部数据与成果归原作者' : '', '上游致谢', '15 个数据仓库与原作者列表')))
}

export function NativeReposView({ api }: any) {
  /* ── hooks 顶部恒定：state×5 + effect×2 + callback×4 ── */
  const [data, setData] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [busyKey, setBusyKey] = React.useState('')
  const [browse, setBrowse] = React.useState(null)   // { key, sub, items, total, truncated, error? }
  const [cfgDraft, setCfgDraft] = React.useState({ root: '', mirror: '' })
  const [batch, setBatch] = React.useState(null)     // cycle-20 G2：一键批量安装进度 { id,state,items,done,total }
  const [jobsOpen, setJobsOpen] = React.useState(false) // cycle-20 G3：最近作业折叠开关
  const aliveRef = React.useRef(true)
  const pollRef = React.useRef(null)
  const batchRef = React.useRef(null)

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

  /** cycle-20 G2：批次进度轮询（仅批次运行时；读到 done 即停） */
  const pollBatch = React.useCallback(async (id: string) => {
    try {
      const d = await api('/repos/batch?id=' + encodeURIComponent(id))
      if (!aliveRef.current || !d || !d.batch) return
      setBatch(d.batch)
      if (d.batch.state !== 'running') { batchRef.current = null; load() }
    } catch { /* 批次查询失败不打断主面板 */ }
  }, [api, load])

  // 轮询：存在 running 作业或未完成批次 → 2s 刷新一次；全部结束自动清表（省电）
  React.useEffect(() => {
    const running = (data && data.summary && data.summary.running > 0) || (batch && batch.state === 'running')
    if (!running) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } return }
    if (pollRef.current) return
    pollRef.current = setInterval(() => { load(); if (batchRef.current) pollBatch(batchRef.current) }, 2000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [data, batch, load])

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
  /** cycle-20 G2：一键批量安装必选——单次请求交给服务端队列，UI 只跟踪 batchId 进度 */
  const doInstallBatch = async () => {
    setErr('')
    try {
      const r = await api('/repos/install-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (r && r.error) { setErr(r.error); return }
      if (r && r.batch) { setBatch(r.batch); batchRef.current = r.batchId }
      await load()
    } catch (e: any) { setErr(String((e && e.message) || e)) }
  }
  const doCancel = (key: string) => post('/repos/cancel', { key })
  /** cycle-20 G4：一键切回旧数据根（消解「换根后数据消失」恐慌） */
  const doSwitchBack = (root: string) => post('/repos/config', { root })
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

    /* ⓪ 关于本项目（GitHub/Release/Issue/npm 跳转 + 版本徽章） */
    h(RpAboutProject, { self: data.self }),

    /* ① 总览（cycle-20：健康汇总 + 可用空间如实呈现，null 即降级不臆造） */
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 } },
      h(Stat, { v: (sum.present || 0) + '/' + (sum.total || 0), l: '仓库就绪', color: requiredReady ? '#10b981' : '#ef4444' }),
      h(Stat, { v: sum.requiredMissing && sum.requiredMissing.length ? sum.requiredMissing.length : 0, l: '必选缺失', color: sum.requiredMissing && sum.requiredMissing.length ? '#ef4444' : '#10b981' }),
      h(Stat, { v: sum.running || 0, l: '进行中作业', color: (sum.running || 0) ? '#6366f1' : undefined }),
      sum.health ? h(Stat, { v: (sum.health.ok || 0) + '/' + (sum.present || 0), l: '健康仓库', color: (sum.health['no-git'] || sum.health['half-clone'] || sum.health.empty) ? '#f59e0b' : '#10b981' }) : null,
      data.diskFreeMB != null ? h(Stat, { v: rp2Size(data.diskFreeMB), l: '可用空间', color: data.diskFreeMB < 1024 ? '#f59e0b' : undefined }) : null,
      data.git === false ? h(Stat, { v: '✗', l: 'git 不可用', color: '#ef4444' }) : h(Stat, { v: '✓', l: 'git 可用', color: '#10b981' })),

    /* ①b cycle-20 G4：旧根提示——换根后旧数据仍在原处，一键切回 */
    data.previousRoot && data.previousRootRepos > 0
      ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, padding: '8px 12px', borderRadius: 10, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)' } },
          h('span', { style: { fontSize: 11.5, color: '#92400e' } },
            'ℹ 上一个数据根 ' + String(data.previousRoot) + ' 仍有 ' + data.previousRootRepos + ' 个仓库（数据未删除，只是当前根不指向它）'),
          btn('↩ 切回旧根', false, () => doSwitchBack(String(data.previousRoot))))
      : null,

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

    /* ③ 一键必选（cycle-20 G2：真·一键——单次请求交给服务端队列，UI 显示批次进度） */
    !requiredReady
      ? h(Card, { title: '🚀 一键安装必选包' },
          h('div', { style: { fontSize: 12, color: '#64748b', marginBottom: 8 } },
            '缺失必选：' + (sum.requiredMissing || []).join('、') + ' —— 装完即可用刷题 / 方法论 / 图推三大核心视图'),
          // cycle-18：不再写死「合计约 363MB」——必选集随版本会变（本轮新增 huasheng13，
          // 且 kaogong-skill 已降为推荐），硬编码体积必然漂移成谎报（R22 陈旧文案教训）。
          // 各仓库体积已在下方分级卡片逐条显示，总览这里只给可执行指引。
          h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginBottom: 8 } },
            '国内网络建议先在上方「镜像代理」填 https://gh-proxy.com/ 再安装；各仓库体积见下方分级列表。'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            btn('🚀 一键安装全部必选', false, doInstallBatch,
              { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, padding: '7px 16px', fontWeight: 700 }),
            h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, '服务端队列化（并发 2），无需逐个点击')),
          // 批次进度条（仅批次存在时显示；字段缺失即降级）
          batch ? h('div', { style: { marginTop: 10, padding: '8px 10px', borderRadius: 9, background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.18)' } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, fontWeight: 700, color: '#4338ca', marginBottom: 6 } },
              '📦 批次 ' + String(batch.id || '').slice(0, 12) + ' · ' + (batch.state === 'running' ? '进行中' : '已结束') + ' · ' + (batch.done || 0) + '/' + (batch.total || 0)),
            h('div', { style: { height: 6, borderRadius: 3, background: 'rgba(148,163,184,.25)', overflow: 'hidden' } },
              h('i', { style: { display: 'block', height: '100%', width: (batch.total ? Math.round((batch.done || 0) / batch.total * 100) : 0) + '%', background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', borderRadius: 3 } })),
            h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 } },
              (batch.items || []).map((it: any) => h('span', { key: it.key, style: { ...KV_TAG, fontSize: 9.5, background: it.state === 'done' ? 'rgba(16,185,129,.12)' : it.state === 'failed' || it.state === 'skipped' ? 'rgba(239,68,68,.12)' : 'rgba(148,163,184,.14)', color: it.state === 'done' ? '#059669' : it.state === 'failed' || it.state === 'skipped' ? '#dc2626' : '#475569' }, title: it.error || '' }, it.key + ' ' + it.state))))
          : null)
      : null,

    /* ③b cycle-20 G3：最近作业归档（失败原因/耗时可追溯，折叠省空间） */
    Array.isArray(data.recentJobs) && data.recentJobs.length
      ? h(Card, { title: '🕘 最近作业 · ' + data.recentJobs.length + ' 条' },
          h('button', { style: KV_BTN, onClick: () => setJobsOpen(v => !v) }, jobsOpen ? '▾ 收起' : '▸ 展开历史'),
          jobsOpen ? h('div', { style: { marginTop: 6 } },
            data.recentJobs.map((j: any, i: number) => h('div', { key: 'rj' + i, style: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0', borderBottom: '1px dashed rgba(148,163,184,.15)', fontSize: 10.5, color: '#64748b' } },
              h('span', { style: { fontFamily: 'monospace', minWidth: 130 } }, String(j.key || '?')),
              h('span', { style: { color: j.state === 'done' ? '#059669' : j.state === 'failed' ? '#dc2626' : '#475569', fontWeight: 700 } }, j.state + ' · ' + String(j.action || '')),
              h('span', null, (j.elapsedSec || 0) + 's'),
              j.error ? h('span', { style: { color: '#b45309' }, title: j.error }, '⚠ ' + String(j.error).slice(0, 60)) : null))) : null)
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
          // cycle-20 G6：健康徽章（非 ok 态才显示，避免视觉噪音）+ 最近更新时间
          r.health && r.health !== 'ok' && r.present
            ? h('span', { style: { ...KV_TAG, fontSize: 9.5, background: (RP2_HEALTH[r.health] || RP2_HEALTH.absent).bg, color: (RP2_HEALTH[r.health] || RP2_HEALTH.absent).color } }, (RP2_HEALTH[r.health] || RP2_HEALTH.absent).text)
            : null,
          rp2Ago(r.lastCommitAt) ? h('span', { style: { fontSize: 9.5, color: '#94a3b8' } }, rp2Ago(r.lastCommitAt)) : null,
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
          // cycle-20 G7：渲染服务端返回的 items 全量（limit 由服务端控制），
          // 文案由 truncated + 真实 total/items.length 派生——杜绝「前 120 项（共 X）」口径矛盾。
          (browse.items || []).map((it: any) => h('div', {
            key: it.name,
            style: { display: 'flex', gap: 8, alignItems: 'center', padding: '3px 2px', borderBottom: '1px solid rgba(148,163,184,.1)', fontSize: 11.5, cursor: it.dir ? 'pointer' : 'default' },
            onClick: it.dir ? () => doBrowse(browse.key, (browse.sub ? browse.sub + '/' : '') + it.name) : undefined,
          },
            h('span', { style: { width: 18, textAlign: 'center' } }, it.dir ? '📁' : '·'),
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.name),
            !it.dir && it.size != null ? h('span', { style: { color: '#94a3b8', fontSize: 10 } }, it.size > 1048576 ? (it.size / 1048576).toFixed(1) + 'MB' : it.size > 1024 ? (it.size / 1024).toFixed(1) + 'KB' : it.size + 'B') : null)),
          browse.truncated ? h('div', { style: { fontSize: 10.5, color: '#94a3b8', marginTop: 4 } }, '仅显示 ' + (browse.items || []).length + ' / ' + (browse.total || 0) + ' 项（服务端上限 ' + (browse.limit || (browse.items || []).length) + '）') : null,
          h('div', { style: { marginTop: 6 } }, btn('✕ 关闭', false, () => setBrowse(null))))
      : null,

    /* ⑥ 口径说明 */
    h('div', { style: { fontSize: 10.5, color: '#94a3b8', lineHeight: 1.8 } },
      '口径：安装=git clone --depth 1（浅克隆省流量）· 已装仓库再点=git pull --ff-only 更新 · 一键必选走服务端队列（并发 2）· ',
      '删除仅清本地数据目录（学习进度在 data/progress 不受影响）· clone 失败的半成品自动清理可重装 · ',
      '健康巡检：空仓库/缺 .git/半成品显式标记 · 非 git 的用户数据目录受保护拒绝覆盖 · ',
      '全部数据归上游仓库作者所有（点 ↗ 致敬原作者）。'))
}
