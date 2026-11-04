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
import { existsSync, readdirSync, statSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { REPOS_META, SELF_META } from '../shared/manifest.js'
import { readReposConfig, writeReposConfig, isInside } from './dataRoot.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

const MAX_CONCURRENT = 2       // 同时最多 2 个 git 作业（带宽/进程护栏）
const LOG_RING = 80            // 每作业保留尾部 80 行输出
const BROWSE_LIMIT = 300       // 浏览单目录最多条目

/** git 可用性探测（进程内一次；异步不阻塞启动） */
let gitProbe: Promise<boolean> | null = null
function probeGit(): Promise<boolean> {
  if (gitProbe) return gitProbe
  gitProbe = new Promise((res) => {
    try {
      const p = spawn('git', ['--version'], { stdio: 'ignore' })
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

  const runningCount = () => [...jobs.values()].filter((j: any) => j.state === 'running').length

  /** 镜像前缀应用：mirror 存在且 url 未被镜像前缀包裹时拼接 */
  function applyMirror(url: string, mirror: string): string {
    if (!mirror) return url
    if (url.startsWith(mirror)) return url
    return mirror.replace(/\/+$/, '') + '/' + url
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
    const job: any = { state: 'running', action, url: useUrl, target, startedAt: Date.now(), finishedAt: 0, log: [] as string[], error: null, proc: null }
    jobs.set(key, job)
    let proc: any = null
    try {
      proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', 'GIT_CONFIG_NOSYSTEM': '1' } })
    } catch (e: any) {
      job.state = 'failed'; job.error = 'spawn 失败: ' + (e && e.message); job.finishedAt = Date.now()
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
    })
    proc.on('close', (code: any) => {
      job.proc = null
      if (job.state === 'canceled') { job.finishedAt = Date.now(); return }
      if (code === 0) {
        job.state = 'done'; job.finishedAt = Date.now()
        try { if (onRootChanged) onRootChanged() } catch { /* 回调失败不影响作业结论 */ }
      } else {
        job.state = 'failed'; job.error = `git 退出码 ${code}`; job.finishedAt = Date.now()
      }
    })
    return { ok: true, key, job: jobView(key) }
  }

  /** 作业视图（去掉 proc 引用，可 JSON 化） */
  function jobView(key: string) {
    const j = jobs.get(key)
    if (!j) return null
    return { state: j.state, action: j.action, url: j.url, startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error, log: j.log.slice(-30), elapsedSec: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000) }
  }

  /** 单仓库状态（纯文件系统探测，无 spawn——status 端点必须快） */
  function repoState(key: string, meta: any, root: string) {
    const dir = join(root, key)
    const present = existsSync(dir)
    const isGit = present && existsSync(join(dir, '.git'))
    let files = 0
    if (present) { try { files = readdirSync(dir).filter(f => f !== '.git').length } catch { /* 损坏目录 */ } }
    return { key, tier: meta.tier, size: meta.size, desc: meta.desc, upstream: meta.upstream, present, isGit, files, job: jobView(key) }
  }

  function statusSnapshot() {
    const root = getRoot()
    const cfg = readReposConfig()
    const list = entries(REPOS_META).map(([k, m]: any) => repoState(k, m, root))
    const byTier = { required: 0, recommended: 0, optional: 0 } as any
    let presentN = 0
    for (const r of list) { byTier[r.tier] = (byTier[r.tier] || 0) + 1; if (r.present) presentN++ }
    const requiredMissing = list.filter(r => r.tier === 'required' && !r.present).map(r => r.key)
    return {
      root, rootSource: cfg.root ? 'config' : 'auto', mirror: cfg.mirror || '',
      self: SELF_META,   // 本插件自身元数据（面板「关于本项目」卡片消费；单一事实源在 manifest）
      git: null, // 异步探测结果单独字段（见下）
      repos: list,
      summary: { total: list.length, present: presentN, requiredMissing, running: runningCount(),
        tiers: { required: byTier.required || 0, recommended: byTier.recommended || 0, optional: byTier.optional || 0 } },
    }
  }

  /** 路由：/api/repos*；未命中返回 undefined */
  async function handle(path: string, params: any, post: any, method: string) {
    if (path === '/api/repos' && method === 'GET') {
      const snap = statusSnapshot()
      snap.git = await probeGit()
      return snap
    }
    if (path === '/api/repos/install' && method === 'POST') {
      const key = String((post && post.key) || '')
      const meta: any = (REPOS_META as any)[key]
      if (!meta) return { error: `未知仓库 key: ${key || '(空)'}` }
      const root = getRoot()
      const target = join(root, key)
      if (!isInside(root, target)) return { error: '安装路径越界' }
      if (existsSync(target) && !existsSync(join(target, '.git'))) {
        return { error: `${key} 目录已存在但不是 git 仓库——为保护既有数据拒绝覆盖；如需重装请先删除` }
      }
      const action = existsSync(join(target, '.git')) ? 'pull' : 'clone'
      try { mkdirSync(root, { recursive: true }) } catch { /* 根目录创建失败交给 spawn 报错 */ }
      return startJob(key, action, meta.upstream + '.git', target)
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
      const items = names.slice(0, BROWSE_LIMIT).map((n: string) => {
        try {
          const st = statSync(join(dir, n))
          return { name: n, dir: st.isDirectory(), size: st.isDirectory() ? null : st.size }
        } catch { return { name: n, dir: false, size: null } }
      })
      items.sort((a: any, b: any) => (a.dir === b.dir ? (a.name < b.name ? -1 : 1) : a.dir ? -1 : 1))
      return { key, sub, total: names.length, items, truncated: names.length > BROWSE_LIMIT }
    }
    if (path === '/api/repos/config' && method === 'POST') {
      const patch: any = {}
      if (post && typeof post.root === 'string' && post.root.trim()) {
        const nr = resolve(post.root.trim())
        patch.root = nr
      } else if (post && post.root === '') {
        patch.root = null   // 清除自定义 → 回到自动解析
      }
      if (post && typeof post.mirror === 'string') patch.mirror = post.mirror.trim().slice(0, 200)
      if (!Object.keys(patch).length) return { error: '缺少 root/mirror 字段' }
      const saved = writeReposConfig(patch)
      try { if (onRootChanged) onRootChanged() } catch {}
      return { ok: true, config: saved, root: getRoot() }
    }
    return undefined
  }

  return { handle, statusSnapshot, jobView }
}
