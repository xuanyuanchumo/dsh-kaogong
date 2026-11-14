/**
 * server/dataRoot.ts — 题库数据根目录解析与持久化（cycle-16 一键式安装核心）
 *                       + 用户数据目录外置与迁移（cycle-21 · issue #2 根治）
 *
 * ── 背景（题库）──
 * npm/GitHub 单独发布 dsh-kaogong 时**不携带题库数据**（16 仓库合计 GB 级，
 * 且各有独立上游）。原 REPO_ROOT=上级目录 是开发态假设，安装态下数据全缺。
 * 题库根解析优先级（高→低）：
 *   1. 环境变量 KG_REPOS_DIR（CI/高级用户）
 *   2. 持久化配置 repos-config.json（题库管理面板写入）
 *   3. 开发态兼容：上级目录（存在任一已登记题库仓库时）
 *   4. 默认托管目录 <用户数据根>/repos/（npm 安装态，配合 repoManager 一键克隆）
 *
 * ── 背景（用户数据 · cycle-21 R26）──
 * issue #2 实证：市场升级 = pnpm 把包目录**整目录替换**，包内一切用户数据
 * （进度/错题本/配置/索引快照）必然丢失。修复 = 用户数据与代码包彻底解耦：
 *   用户数据根 = KG_DATA_DIR（env，最高优先）> `${DSH_HOME||~/.dsh}/kaogong/`
 *   （cookie-guard 实证模式：DSH 主目录下插件命名空间目录，与安装位置零耦合）。
 * 启动时一次性迁移：包内 data/ 的旧数据原子搬迁到用户数据根（tmp+rename），
 * 成功留 `.migrated` 标记；失败只读降级**绝不删除**源数据。
 * 零依赖；全部函数无副作用（写盘仅 persist 显式调用）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync, cpSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..', '..')
/** 包内 data/（历史位置；迁移后仅作残留探测源，新数据永不写入） */
const PKG_DATA_DIR = join(PKG_ROOT, 'data')

/** 用户数据根下的插件命名空间目录名（dsh-cookie-guard 实证模式） */
export const DATA_NS = 'kaogong'

/** 解析用户数据根（env KG_DATA_DIR > $DSH_HOME/kaogong > ~/.dsh/kaogong） */
export function resolveUserDataRoot(): string {
  const env = process.env.KG_DATA_DIR
  if (env && String(env).trim()) return resolve(String(env).trim())
  const home = process.env.DSH_HOME
  if (home && String(home).trim()) return join(resolve(String(home).trim()), DATA_NS)
  return join(resolve(process.env.USERPROFILE || process.env.HOME || PKG_ROOT), '.dsh', DATA_NS)
}

/** 用户数据根（模块加载期确定一次；同进程内恒定） */
export const USER_DATA_ROOT = resolveUserDataRoot()
/** 默认托管题库目录 = <用户数据根>/repos（外置，升级零影响） */
export const DEFAULT_MANAGED = join(USER_DATA_ROOT, 'repos')
/** 命名空间进度目录 = <用户数据根>/progress（外置，升级零影响） */
export const PROGRESS_DIR_USER = join(USER_DATA_ROOT, 'progress')
/** 迁移完成标记（原子搬迁成功后写入；再次启动见此标记直接跳过） */
const MIGRATED_MARK = join(USER_DATA_ROOT, '.migrated')

/** 判定某目录是否「像一个题库根」：含任一已登记仓库目录即算 */
export function looksLikeReposRoot(dir: string, repoKeys: string[]): boolean {
  try { return repoKeys.some(k => existsSync(join(dir, k))) } catch { return false }
}

/* ══ 配置读写（repos-config.json 现居于用户数据根；读写均向新位置收敛）══ */

const CONFIG_FILE_USER = () => join(USER_DATA_ROOT, 'repos-config.json')
const CONFIG_FILE_PKG = PKG_DATA_DIR ? join(PKG_DATA_DIR, 'repos-config.json') : ''

/** 读持久化配置（先新位置后旧包内——未迁移前旧配置仍可读；损坏/缺失 → 空对象，绝不抛） */
export function readReposConfig(): any {
  for (const f of [CONFIG_FILE_USER(), CONFIG_FILE_PKG]) {
    if (!f) continue
    try {
      const j = JSON.parse(readFileSync(f, 'utf-8'))
      if (j && typeof j === 'object' && !Array.isArray(j)) return j
    } catch { /* 下一个 */ }
  }
  return {}
}

/** 写持久化配置（原子写 tmp+rename；失败静默——配置写不进不影响读侧降级） */
export function writeReposConfig(patch: any): any {
  const next = { ...readReposConfig(), ...patch }
  try {
    mkdirSync(USER_DATA_ROOT, { recursive: true })
    const target = CONFIG_FILE_USER()
    const tmp = target + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, target)
  } catch { /* 静默 */ }
  return next
}

/** 解析当前生效题库数据根（纯计算，无缓存——调用即真相；调用方自行缓存） */
export function resolveReposRoot(repoKeys: string[]): { root: string, source: string } {
  const env = process.env.KG_REPOS_DIR
  if (env && String(env).trim()) return { root: resolve(String(env).trim()), source: 'env:KG_REPOS_DIR' }
  const cfg = readReposConfig()
  if (cfg.root && typeof cfg.root === 'string') return { root: resolve(cfg.root), source: 'config' }
  const parent = resolve(PKG_ROOT, '..')
  if (looksLikeReposRoot(parent, repoKeys)) return { root: parent, source: 'dev-parent' }
  return { root: DEFAULT_MANAGED, source: 'managed-default' }
}

/** 路径安全：candidate 必须落在 base 内（防穿越；resolve 归一后前缀比较） */
export function isInside(base: string, candidate: string): boolean {
  const b = resolve(base), c = resolve(candidate)
  return c === b || c.startsWith(b + '/') || c.startsWith(b + '\\\\')
}

/* ══ cycle-21 · 包内旧数据一次性迁移（issue #2 根治）══
 * 迁移对象（有用户价值的运行时数据）：progress/（进度+错题本）、repos-config.json、
 * study-plan.md、lifecycle.jsonl（审计链）。**不含** .naoku.db / .paper-index.json /
 * .huasheng13-index.json —— 三者是缓存快照（可再生），rebuild 后自然重建；
 * 但 repos-config.root 指向旧包内 data/repos 时一并改写为迁移后的新 repos 目录。
 * 策略：原子搬迁（tmp 目录组装 → rename）；任何一步失败 → 全量回滚 + 只读降级，
 * 绝不删除包内源数据（宁可重复迁移，不可丢数据）。 */

/** 迁移结果（白盒透出：/api/data-location 消费） */
export interface MigrationReport {
  performed: boolean       // 本次进程是否执行了迁移动作
  status: 'not-needed' | 'migrated' | 'already-migrated' | 'failed'
  movedCount: number       // 搬迁条目数（目录/文件）
  failedItem?: string      // 首个失败项（降级排查线索）
  pkgResidual: string[]    // 包内仍残留的用户数据条目（迁移失败时非空）
}

/** 列出包内 data/ 中「有用户价值、应迁移」的条目。
 *  lifecycle.jsonl 特殊：它是环形审计日志（300 行滚动），**新根侧会被运行时持续改写**，
 *  源/目标字面一致判定永远失败（纯日志非用户数据）。迁移语义=保留新根（已在写）+ 删源。
 *  进度/错题本/配置（progress/repos-config/study-plan）才是真用户数据：字面不一致绝不覆盖。 */
function pkgMigrateEntries(): string[] {
  try {
    if (!existsSync(PKG_DATA_DIR)) return []
    return readdirSync(PKG_DATA_DIR).filter(n =>
      n === 'progress' || n === 'repos-config.json' || n === 'study-plan.md' || n === 'lifecycle.jsonl')
  } catch { return [] }
}

/** 单条目原子搬迁：文件直接 rename；跨卷（EXDEV）走 tmp 组装复制——**成功后必须删源**，
 *  否则「迁移」退化为「复制」，包内残留会让白盒报告与实际状态矛盾（cycle-21 实测 D:→C:）。 */
function moveEntry(src: string, dst: string): void {
  try { renameSync(src, dst); return } catch { /* rename 失败（跨卷/占用）→ 走 cp 回退 */ }
  const st = statSync(src)
  const tmp = dst + '.migrating-tmp'
  try {
    if (st.isDirectory()) cpSync(src, tmp, { recursive: true })
    else { mkdirSync(dirname(tmp), { recursive: true }); cpSync(src, tmp) }
    renameSync(tmp, dst)
    // 回退路径成功 → 删除包内源（迁移语义=搬家，不是复制；失败绝不删源）
    rmSync(src, { recursive: true, force: true })
  } catch (e) {
    try { rmSync(tmp, { recursive: true, force: true }) } catch {}
    throw e
  }
}

/**
 * 执行包内旧数据迁移（幂等；启动时调用一次）。
 * 决策树：标记存在 → already-migrated；包内无迁移对象 → not-needed；
 * 否则逐条 moveEntry 到用户数据根 → 成功写标记（failed 状态保留源数据）。
 */
export function migratePkgData(): MigrationReport {
  const report: MigrationReport = { performed: false, status: 'not-needed', movedCount: 0, pkgResidual: [] }
  try {
    if (existsSync(MIGRATED_MARK)) { report.status = 'already-migrated'; return report }
    const entries = pkgMigrateEntries()
    if (!entries.length) { report.status = 'not-needed'; return report }
    mkdirSync(USER_DATA_ROOT, { recursive: true })
    report.performed = true
    for (const name of entries) {
      const src = join(PKG_DATA_DIR, name)
      const dst = join(USER_DATA_ROOT, name)
      try {
        if (existsSync(dst)) {
          // 目标已存在（上次迁移半途/复制退化遗留）→ 保守收敛：目录逐文件补搬缺失项，
          // 文件仅在**字面一致**时删源（内容不同绝不覆盖——用户数据宁多勿丢）。
          const stSrc = statSync(src)
          if (stSrc.isDirectory()) {
            for (const f of readdirSync(src)) {
              const sf = join(src, f), df = join(dst, f)
              if (existsSync(df)) {
                try { if (readFileSync(sf) .equals(readFileSync(df))) rmSync(sf) } catch {}
              } else { try { moveEntry(sf, df); report.movedCount++ } catch {} }
            }
            // 目录内全部收敛后（空目录 = 逐文件已搬/已核对）删除源目录壳
            try { if (!readdirSync(src).length) rmSync(src, { recursive: true }) } catch {}
          } else {
            // lifecycle.jsonl 是环形审计日志（新根侧被运行时持续改写，字面永不一致）：
            // 非用户数据，保留新根、删源；其余文件（真用户数据）不一致时**保留源**（宁多勿丢）。
            if (name === 'lifecycle.jsonl') { try { rmSync(src) } catch {} }
            else { try { if (readFileSync(src).equals(readFileSync(dst))) rmSync(src) } catch {} }
          }          continue
        }
        moveEntry(src, dst)
        report.movedCount++
      } catch (e: any) {
        report.status = 'failed'
        report.failedItem = name + ': ' + (e && e.message ? e.message : String(e))
        break                                   // 失败即停——剩余条目保持原位（只读降级）
      }
    }
    if (report.status !== 'failed') {
      // 配置内 root 指向旧包内 repos → 改写为迁移后的新目录（旧根数据已随 progress 语义搬迁）
      const cfg = readReposConfig()
      const legacyRepos = join(PKG_DATA_DIR, 'repos')
      if (cfg.root && resolve(String(cfg.root)) === resolve(legacyRepos)) {
        writeReposConfig({ root: DEFAULT_MANAGED, _migratedFromPkg: true })
      }
      try { writeFileSync(MIGRATED_MARK, JSON.stringify({ at: new Date().toISOString(), moved: report.movedCount }, null, 2)) } catch {}
      report.status = 'migrated'
    }
  } catch (e: any) {
    report.status = 'failed'
    report.failedItem = (e && e.message) || String(e)
  }
  try { report.pkgResidual = pkgMigrateEntries() } catch {}
  return report
}

/** 迁移状态快照（/api/data-location 白盒透出；无副作用） */
export function dataLocationReport(): any {
  const migratedMark = existsSync(MIGRATED_MARK)
  let mark: any = null
  try { if (migratedMark) mark = JSON.parse(readFileSync(MIGRATED_MARK, 'utf-8')) } catch {}
  return {
    userDataRoot: USER_DATA_ROOT,
    source: process.env.KG_DATA_DIR ? 'env:KG_DATA_DIR' : (process.env.DSH_HOME ? 'env:DSH_HOME' : 'user-home'),
    reposRoot: resolveReposRoot([]),
    migratedMark: mark,
    pkgResidual: pkgMigrateEntries(),
    pkgDataDir: PKG_DATA_DIR,
  }
}
