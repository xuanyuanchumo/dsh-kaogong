/**
 * server/repoManager.ts — 原始题库管理器（cycle-16 一键式安装核心）
 *
 * 职责：npm/GitHub 安装态下题库数据不在包内（15 仓库 GB 级、各有上游），
 * 本模块提供「注册表 → 下载/更新/删除/浏览/自定义根/镜像代理」的完整闭环：
 *  - install(key)：目标目录无 → git clone --depth 1；有 .git → git pull --ff-only（更新）；
 *    有目录无 .git → 受控报错（提示先删除，绝不覆盖用户数据）
 *  - 镜像代理：mirrorPrefix 前缀拼接（如 https://gh-proxy.com/），对 clone/pull 同时生效
 *  - 作业模型：内存 Map<key, job>，spawn git 子进程流式收集日志（环形 80 行），
 *    全局并发上限 2（防带宽/进程爆炸），支持 cancel（kill 进程组）
 *  - 崩溃安全：spawn 'error' 事件必须接住（git 不存在/网络异常 → job failed，绝不冒泡）；
 *    任何校验失败返回 {error} + HTTP 200（与图查询端点同口径）
 *  - 安全：key 白名单（REPOS_META）；路径 isInside 防穿越；只执行固定 git 子命令
 * 零依赖（node:child_process/node:fs/node:path）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, rmSync, mkdirSync, writeFileSync, renameSync, statfsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { REPOS_META, SELF_META } from '../shared/manifest.js'
import { readReposConfig, writeReposConfig, isInside, looksLikeReposRoot } from './dataRoot.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

const MAX_CONCURRENT = 2       // 同时最多 2 个 git 作业（带宽/进程护栏）
const LOG_RING = 80            // 每作业保留尾部 80 行输出
const BROWSE_LIMIT = 300       // 浏览单目录最多条目
const JOB_HISTORY_MAX = 20     // cycle-20 G3：作业归档环形上限（跨重建保留失败原因/耗时）
/** cycle-20 G1：未完成 clone 的判定——目录存在、无 .git、且顶层文件数 ≤2（半成品/空壳）。
 *  只有这类目录才允许 install 安全清理重建；用户放数据的非空目录仍受保护拒绝覆盖。 */
function isHalfClone(dir: string): boolean {
  if (!existsSync(dir) || existsSync(join(dir, '.git'))) return false
  try { return readdirSync(dir).length <= 2 } catch { return false }
}
/** 目标根可写探测（G8）：写探针文件后立即删除；不产生持久副作用 */
function probeWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const p = join(dir, '.kg-write-probe')
    writeFileSync(p, 'ok')
    rmSync(p, { force: true })
    return true
  } catch { return false }
}
/** 可用磁盘空间（MB）；statfsSync 在旧 Node 缺席时诚实返回 null（绝不臆造 0） */
function diskFreeMB(dir: string): number | null {
  try {
    if (typeof statfsSync !== 'function') return null
    let d = resolve(dir)
    for (let i = 0; i < 4 && !existsSync(d); i++) d = dirname(d)
    const st: any = statfsSync(d)
    const bsize = Number(st.bsize) || 4096, bavail = Number(st.bavail) || 0
    return Math.round(bsize * bavail / 1048576)
  } catch { return null }
}

/** git 可用性探测（进程内一次；异步不阻塞启动） */
let gitProbe: Promise<boolean> | null = null
function probeGit(): Promise<boolean> {
  if (gitProbe) return gitProbe
  gitProbe = new Promise((res) => {
    try {
      const p = spawn('git', ['--version'], { stdio: 'ignore', windowsHide: true })
      p.on('error', () => res(false))
      p.on('close', (code) => res(code === 0))
    } catch { res(false) }
  })
  return gitProbe
}

/**
 * 装配题库管理域。
 * @param cfg.getRoot 当前生效数据根（动态读取——数据根热变更后安装目标随之变化）
 * @param cfg.onRootChanged 安装/删除/换根成功后的回调（失效上层缓存：paperIndex/naoku）
 */
export function makeRepoManager({ getRoot, onRootChanged }: any) {
  /** 作业表：repoKey → { state, action, startedAt, finishedAt, log[], error, proc } */
  const jobs = new Map<string, any>()
  /** cycle-20 G3：作业归档（环形 20）——完成/失败的作业从 jobs 移出后仍可查失败原因与耗时 */
  const jobHistory: any[] = []
  /** cycle-20 G4：上一次生效数据根快照（切根时记录，供 UI 提示「旧根仍有 N 个仓库」） */
  let previousRoot: string | null = null

  /** 归档一条作业（在 close/error 收敛后调用；幂等靠 job.archived 标记） */
  function archiveJob(key: string, j: any) {
    if (!j || j.archived) return
    j.archived = true
    jobHistory.push({
      key, action: j.action, state: j.state, error: j.error || null,
      startedAt: j.startedAt, finishedAt: j.finishedAt || Date.now(),
      elapsedSec: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000),
      logTail: Array.isArray(j.log) ? j.log.slice(-5) : [],
    })
    while (jobHistory.length > JOB_HISTORY_MAX) jobHistory.shift()
  }

  const runningCount = () => [...jobs.values()].filter((j: any) => j.state === 'running').length

  /** 镜像前缀应用：mirror 存在且 url 未被镜像前缀包裹时拼接 */
  function applyMirror(url: string, mirror: string): string {
    if (!mirror) return url
    if (url.startsWith(mirror)) return url
    return mirror.replace(/\/+$/, '') + '/' + url
  }

  /** cycle-20 G1：clone 失败后自动清理本次新建的半成品目录，解除「非 git 目录拒绝覆盖」死锁。
   *  安全边界：仅当 createdDir=true（作业前不存在）且 isHalfClone（无 .git、≤2 项）才删；
   *  用户既有目录/非空数据绝不触碰。删除失败不影响作业结论（诚实留在日志）。 */
  function cleanupHalfClone(j: any) {
    if (!j || !j.createdDir || !j.target) return
    try {
      if (!isHalfClone(j.target)) return
      rmSync(j.target, { recursive: true, force: true })
      j.cleaned = true
    } catch { /* 清理失败：保留现场，用户可从「浏览」查看或手动删除 */ }
  }

  /** 启动一个 git 作业（clone/pull）；同 key 在跑则拒绝；全局并发护栏 */
  function startJob(key: string, action: string, url: string, target: string) {
    if (jobs.has(key) && jobs.get(key).state === 'running') {
      return { error: `仓库 ${key} 已有作业在运行（${jobs.get(key).action}），请等待或取消` }
    }
    if (runningCount() >= MAX_CONCURRENT) {
      return { error: `并发作业已满（${MAX_CONCURRENT}），请稍后再试或取消进行中的作业` }
    }
    const cfg = readReposConfig()
    const mirror = String(cfg.mirror || '')
    const useUrl = applyMirror(url, mirror)
    const args = action === 'clone'
      ? ['clone', '--depth', '1', '--single-branch', useUrl, target]
      : ['-C', target, 'pull', '--ff-only']
    const job: any = { state: 'running', action, url: useUrl, target, startedAt: Date.now(), finishedAt: 0, log: [] as string[], error: null, proc: null, createdDir: false }
    jobs.set(key, job)
    // cycle-20 G1：记录「本次作业前目标目录是否存在」——只有本次新建的半成品才允许失败后自动清理
    job.createdDir = action === 'clone' && !existsSync(target)
    let proc: any = null
    try {
      // windowsHide: true —— Windows 关键项：不加则每次 clone/pull 闪现黑色控制台窗口
      // （「调用插件时命令窗口闪烁」问题的根因；宿主 GUI 环境必须静默执行子进程）
      proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', 'GIT_CONFIG_NOSYSTEM': '1' } })
    } catch (e: any) {
      job.state = 'failed'; job.error = 'spawn 失败: ' + (e && e.message); job.finishedAt = Date.now()
      cleanupHalfClone(job)
      archiveJob(key, job)
      return { ok: true, key, job: jobView(key) }
    }
    job.proc = proc
    const push = (buf: any) => {
      const lines = String(buf).split(/\r?\n/).filter(Boolean)
      for (const l of lines) { job.log.push(l.slice(0, 300)); if (job.log.length > LOG_RING) job.log.shift() }
    }
    if (proc.stdout) proc.stdout.on('data', push)
    if (proc.stderr) proc.stderr.on('data', push)   // git 进度输出走 stderr
    proc.on('error', (e: any) => {
      // 崩溃安全核心：git 不存在/权限问题等全部收敛为 job failed，绝不 uncaughtException
      job.state = 'failed'; job.error = e && e.message ? e.message : String(e); job.finishedAt = Date.now(); job.proc = null
      cleanupHalfClone(job)
      archiveJob(key, job)
    })
    proc.on('close', (code: any) => {
      job.proc = null
      if (job.state === 'canceled') { job.finishedAt = Date.now(); archiveJob(key, job); return }
      if (code === 0) {
        job.state = 'done'; job.finishedAt = Date.now()
        try { if (onRootChanged) onRootChanged() } catch { /* 回调失败不影响作业结论 */ }
      } else {
        job.state = 'failed'; job.error = `git 退出码 ${code}`; job.finishedAt = Date.now()
        cleanupHalfClone(job)
      }
      archiveJob(key, job)
      try { onJobSettled(key) } catch { /* 队列补位失败不影响作业结论 */ }
    })
    return { ok: true, key, job: jobView(key) }
  }

  /** 作业视图（去掉 proc 引用，可 JSON 化） */
  function jobView(key: string) {
    const j = jobs.get(key)
    if (!j) return null
    return { state: j.state, action: j.action, url: j.url, startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error, log: j.log.slice(-30), elapsedSec: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000) }
  }

  /**
   * 单仓库状态（纯文件系统探测，无 spawn——status 端点必须快）。
   * cycle-18 决策：**不设内置/随包旁路**——一切题库数据（含方法论语料）都是
   * 数据根下的外部克隆仓库，统一由本管理器安装/更新/删除。数据来源单一化，
   * 才不会出现「有的能更新、有的不能删」这类语义分裂。
   */
  function repoState(key: string, meta: any, root: string) {
    const dir = join(root, key)
    const present = existsSync(dir)
    const isGit = present && existsSync(join(dir, '.git'))
    let files = 0
    if (present) { try { files = readdirSync(dir).filter(f => f !== '.git').length } catch { /* 损坏目录 */ } }
    // cycle-20 G6：健康巡检——把「装了但不可用」显式化（此前只有 present/isGit 两个布尔，
    // .git 丢失/空壳/陈旧都混在「已安装」里，用户无从察觉）。
    let health = 'absent'
    if (present && isGit) health = files > 0 ? 'ok' : 'empty'
    else if (present && isHalfClone(dir)) health = 'half-clone'
    else if (present) health = 'no-git'
    let lastCommitAt: number | null = null
    if (isGit) {
      try {
        const fh = join(dir, '.git', 'FETCH_HEAD')
        const hp = join(dir, '.git', 'HEAD')
        const p = existsSync(fh) ? fh : hp
        lastCommitAt = statSync(p).mtimeMs || null
      } catch { /* 元数据不可读：保持 null，UI 降级 */ }
    }
    return {
      key, tier: meta.tier, size: meta.size, desc: meta.desc, upstream: meta.upstream,
      present, isGit, files, health, lastCommitAt, job: jobView(key),
    }
  }

  function statusSnapshot() {
    const root = getRoot()
    const cfg = readReposConfig()
    const list = entries(REPOS_META).map(([k, m]: any) => repoState(k, m, root))
    const byTier = { required: 0, recommended: 0, optional: 0 } as any
    const healthSummary: any = { ok: 0, empty: 0, 'half-clone': 0, 'no-git': 0, absent: 0 }
    let presentN = 0
    for (const r of list) {
      byTier[r.tier] = (byTier[r.tier] || 0) + 1
      if (r.present) presentN++
      if (healthSummary[r.health] !== undefined) healthSummary[r.health]++
    }
    const requiredMissing = list.filter(r => r.tier === 'required' && !r.present).map(r => r.key)
    // cycle-20 G4：旧根快照——切根后告诉用户「旧根仍有 N 个仓库」，消解「数据凭空消失」恐慌
    let previousRootRepos = 0
    if (previousRoot && previousRoot !== root) {
      try { previousRootRepos = Object.keys(REPOS_META).filter(k => existsSync(join(previousRoot as string, k))).length } catch { /* 旧根不可读：0 即诚实 */ }
    }
    return {
      root, rootSource: cfg.root ? 'config' : 'auto', mirror: cfg.mirror || '',
      previousRoot: previousRoot && previousRoot !== root ? previousRoot : null,
      previousRootRepos,
      self: SELF_META,   // 本插件自身元数据（面板「关于本项目」卡片消费；单一事实源在 manifest）
      git: null, // 异步探测结果单独字段（见下）
      diskFreeMB: diskFreeMB(root),       // cycle-20 G8：安装前可用空间（null=无法探测，UI 降级）
      repos: list,
      recentJobs: jobHistory.slice(-5).reverse(),
      summary: {
        total: list.length, present: presentN, requiredMissing, running: runningCount(),
        tiers: { required: byTier.required || 0, recommended: byTier.recommended || 0, optional: byTier.optional || 0 },
        health: healthSummary,
      },
    }
  }

  /** cycle-20：单仓库安装前置检查（install 与 batch 共用；返回 {error} 或 {action,target,url}）。
   *  G1 半成品死锁解除：本次 clone 残留的「无 .git 且 ≤2 项」空壳允许清理后重装，
   *  用户既有非空数据目录仍受保护拒绝覆盖。G8：根可写 + 上游形状预检。 */
  function prepareInstall(key: string): any {
    const meta: any = (REPOS_META as any)[key]
    if (!meta) return { error: `未知仓库 key: ${key || '(空)'}` }
    const root = getRoot()
    const target = join(root, key)
    if (!isInside(root, target)) return { error: '安装路径越界' }
    if (!probeWritable(root)) return { error: `数据根不可写：${root}（请检查目录权限或在上方更换数据根）` }
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(String(meta.upstream || ''))) {
      return { error: `${key} 上游地址形状异常：${meta.upstream}` }
    }
    const hasGit = existsSync(join(target, '.git'))
    if (existsSync(target) && !hasGit) {
      if (isHalfClone(target)) {
        try { rmSync(target, { recursive: true, force: true }) } catch (e: any) {
          return { error: `残留半成品目录清理失败：${e && e.message}（请手动删除 ${target} 后重试）` }
        }
      } else {
        return { error: `${key} 目录已存在但不是 git 仓库——为保护既有数据拒绝覆盖；如需重装请先删除` }
      }
    }
    const action = hasGit ? 'pull' : 'clone'
    try { mkdirSync(root, { recursive: true }) } catch { /* 根目录创建失败交给 spawn 报错 */ }
    return { action, target, url: meta.upstream + '.git', meta }
  }

  /** cycle-20 G2：批处理队列（一键安装全部必选）。
   *  调度模型：依次启动直到并发满（MAX_CONCURRENT），每个作业 close 后从 pending 取下一个补位；
   *  batch 状态由各 job 派生（无独立定时器，零轮询成本）。返回 batchId 供 UI 轮询 /api/repos/batch。 */
  const batches = new Map<string, any>()
  let batchSeq = 0
  function startBatch(keys: string[]): any {
    const batchId = 'b' + (++batchSeq) + '-' + Date.now().toString(36)
    const batch: any = { id: batchId, keys: keys.slice(), pending: keys.slice(), started: [] as string[], skipped: [] as any[], startedAt: Date.now(), state: 'running' }
    batches.set(batchId, batch)
    pumpBatch(batch)
    return { ok: true, batchId, batch: batchView(batch) }
  }
  function pumpBatch(batch: any) {
    while (batch.pending.length && runningCount() < MAX_CONCURRENT) {
      const key = batch.pending.shift()
      const p = prepareInstall(key)
      if (p.error) { batch.skipped.push({ key, error: p.error }); continue }
      const r = startJob(key, p.action, p.url, p.target)
      if (r && r.error) { batch.skipped.push({ key, error: r.error }); continue }
      batch.started.push(key)
    }
    // batch 完成判定：全部已启动且无 running，或 pending 因错误耗尽
    if (!batch.pending.length && !batch.keys.some((k: string) => { const j = jobs.get(k); return j && j.state === 'running' })) {
      batch.state = 'done'; batch.finishedAt = Date.now()
    }
  }
  function batchView(batch: any) {
    const items = batch.keys.map((key: string) => {
      const j = jobs.get(key)
      const skip = batch.skipped.find((s: any) => s.key === key)
      return { key, state: skip ? 'skipped' : j ? j.state : 'queued', error: skip ? skip.error : j ? j.error : null }
    })
    return { id: batch.id, state: batch.state, items, startedAt: batch.startedAt, finishedAt: batch.finishedAt || 0,
      total: batch.keys.length, done: items.filter((i: any) => i.state === 'done').length }
  }
  /** 作业结束后补位下一项（close 钩子调用，保持失败也推进队列） */
  function onJobSettled(key: string) {
    for (const batch of batches.values()) {
      if (batch.state !== 'running') continue
      if (batch.keys.indexOf(key) < 0) continue
      pumpBatch(batch)
    }
    while (batches.size > 10) batches.delete(batches.keys().next().value as string)
  }

  /** 路由：/api/repos*；未命中返回 undefined */
  async function handle(path: string, params: any, post: any, method: string) {
    if (path === '/api/repos' && method === 'GET') {
      const snap = statusSnapshot()
      snap.git = await probeGit()
      return snap
    }
    // cycle-20 G3：作业归档查询（失败原因/耗时可追溯）
    if (path === '/api/repos/jobs' && method === 'GET') {
      const limit = Math.min(50, Math.max(1, Number(params.get('limit')) || 20))
      return { total: jobHistory.length, jobs: jobHistory.slice(-limit).reverse() }
    }
    // cycle-20 G2：一键安装全部必选（队列化，绕开「逐个按钮 + 并发上限拒第 3 个」的割裂体验）
    if (path === '/api/repos/install-batch' && method === 'POST') {
      const keys = post && Array.isArray(post.keys) ? post.keys.map(String) : null
      const list = keys || statusSnapshot().summary.requiredMissing
      const valid = list.filter((k: string) => (REPOS_META as any)[k])
      const invalid = list.filter((k: string) => !(REPOS_META as any)[k])
      if (!valid.length) return { error: '没有可安装的仓库' + (invalid.length ? '（未知 key: ' + invalid.join(',') + '）' : '') }
      if (!await probeGit()) return { error: 'git 不可用，无法批量安装（请先确认宿主机可执行 git --version）' }
      return startBatch(valid)
    }
    if (path === '/api/repos/batch' && method === 'GET') {
      const id = String(params.get('id') || '')
      const b = batches.get(id)
      if (!b) return { error: '批次不存在或已清理' }
      if (b.state === 'running') pumpBatch(b)   // 读时补位（无定时器兜底）
      return { batch: batchView(b) }
    }
    if (path === '/api/repos/install' && method === 'POST') {
      const key = String((post && post.key) || '')
      const p = prepareInstall(key)
      if (p.error) return { error: p.error }
      return startJob(key, p.action, p.url, p.target)
    }
    if (path === '/api/repos/job' && method === 'GET') {
      const key = String(params.get('key') || '')
      if (!(REPOS_META as any)[key]) return { error: '未知仓库 key' }
      return { key, job: jobView(key) }
    }
    if (path === '/api/repos/cancel' && method === 'POST') {
      const key = String((post && post.key) || '')
      const j = jobs.get(key)
      if (!j || j.state !== 'running') return { error: '无进行中的作业' }
      j.state = 'canceled'
      try { if (j.proc && j.proc.kill) j.proc.kill('SIGTERM') } catch { /* 已退出 */ }
      return { ok: true, key }
    }
    if (path === '/api/repos/remove' && method === 'POST') {
      const key = String((post && post.key) || '')
      const meta: any = (REPOS_META as any)[key]
      if (!meta) return { error: '未知仓库 key' }
      const j = jobs.get(key)
      if (j && j.state === 'running') return { error: '作业进行中，请先取消' }
      const target = join(getRoot(), key)
      if (!isInside(getRoot(), target)) return { error: '删除路径越界' }
      if (!existsSync(target)) return { error: `${key} 不存在，无需删除` }
      try {
        rmSync(target, { recursive: true, force: true })
        jobs.delete(key)
        try { if (onRootChanged) onRootChanged() } catch {}
        return { ok: true, key, removed: true }
      } catch (e: any) { return { error: '删除失败: ' + (e && e.message) } }
    }
    if (path === '/api/repos/browse' && method === 'GET') {
      const key = String(params.get('key') || '')
      const sub = String(params.get('sub') || '')
      const meta: any = (REPOS_META as any)[key]
      if (!meta) return { error: '未知仓库 key' }
      const root = getRoot()
      const base = join(root, key)
      const dir = sub ? resolve(base, sub) : base
      if (!isInside(base, dir)) return { error: '浏览路径越界' }
      if (!existsSync(dir)) return { error: '目录不存在（可能未安装）' }
      let names: string[] = []
      try { names = readdirSync(dir) } catch (e: any) { return { error: '读取失败: ' + (e && e.message) } }
      // cycle-20 G7：limit 可由 UI 指定（1..BROWSE_LIMIT），total 恒为真实总数，
      // truncated 由「真实总数 > 实际返回数」派生——服务端与 UI 文案口径一致，杜绝「共 X/前 120」自相矛盾。
      const limit = Math.min(BROWSE_LIMIT, Math.max(1, Number(params.get('limit')) || BROWSE_LIMIT))
      const items = names.slice(0, limit).map((n: string) => {
        try {
          const st = statSync(join(dir, n))
          return { name: n, dir: st.isDirectory(), size: st.isDirectory() ? null : st.size }
        } catch { return { name: n, dir: false, size: null } }
      })
      items.sort((a: any, b: any) => (a.dir === b.dir ? (a.name < b.name ? -1 : 1) : a.dir ? -1 : 1))
      return { key, sub, total: names.length, limit, items, truncated: names.length > items.length }
    }
    if (path === '/api/repos/config' && method === 'POST') {
      // cycle-20 G5：配置校验——root 绝对路径 + 可写探测；mirror 仅 http(s)；非法一律不落盘
      const patch: any = {}
      if (post && typeof post.root === 'string' && post.root.trim()) {
        const raw = post.root.trim()
        if (!/^[A-Za-z]:[\\/]|^\\{2}|^\//.test(raw) && !resolve(raw).startsWith('/')) {
          return { error: '数据根须为绝对路径（如 D:/repos 或 /home/me/repos）' }
        }
        const nr = resolve(raw)
        if (!probeWritable(nr)) return { error: `数据根不可写：${nr}（请检查目录权限）` }
        patch.root = nr
      } else if (post && post.root === '') {
        patch.root = null   // 清除自定义 → 回到自动解析
      }
      if (post && typeof post.mirror === 'string') {
        const m = post.mirror.trim().slice(0, 200)
        if (m && !/^https?:\/\/[^\s]+$/.test(m)) return { error: '镜像前缀须为 http(s) URL（如 https://gh-proxy.com/），留空=直连' }
        patch.mirror = m
      }
      if (!Object.keys(patch).length) return { error: '缺少 root/mirror 字段' }
      // cycle-20 G4：切根前记录旧根快照（供 status 提示「旧根仍有 N 个仓库」）
      if (patch.root !== undefined) previousRoot = getRoot()
      const saved = writeReposConfig(patch)
      try { if (onRootChanged) onRootChanged() } catch {}
      return { ok: true, config: saved, root: getRoot() }
    }
    return undefined
  }

  return { handle, statusSnapshot, jobView }
}
