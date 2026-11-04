/**
 * server/dataRoot.ts — 题库数据根目录解析与持久化（cycle-16 一键式安装核心）
 *
 * 背景：npm/GitHub 单独发布 dsh-kaogong 时**不携带题库数据**（15 仓库合计 GB 级，
 * 且各有独立上游）。原 REPO_ROOT=上级目录 是开发态假设，安装态下数据全缺。
 * 本模块把「数据在哪」变成运行期可配置事实，解析优先级（高→低）：
 *   1. 环境变量 KG_REPOS_DIR（CI/高级用户）
 *   2. 持久化配置 data/repos-config.json（题库管理面板写入）
 *   3. 开发态兼容：上级目录（存在任一已登记题库仓库时）
 *   4. 默认托管目录 data/repos/（npm 安装态，配合 repoManager 一键克隆）
 * 零依赖；全部函数无副作用（写盘仅 persist 显式调用）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..', '..')
const DATA_DIR = join(PKG_ROOT, 'data')
const CONFIG_FILE = join(DATA_DIR, 'repos-config.json')
export const DEFAULT_MANAGED = join(DATA_DIR, 'repos')

/** 判定某目录是否「像一个题库根」：含任一已登记仓库目录即算 */
export function looksLikeReposRoot(dir: string, repoKeys: string[]): boolean {
  try { return repoKeys.some(k => existsSync(join(dir, k))) } catch { return false }
}

/** 读持久化配置（损坏/缺失 → 空对象，绝不抛） */
export function readReposConfig(): any {
  try {
    const j = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}
  } catch { return {} }
}

/** 写持久化配置（原子写 tmp+rename；失败静默——配置写不进不影响读侧降级） */
export function writeReposConfig(patch: any): any {
  const next = { ...readReposConfig(), ...patch }
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = CONFIG_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, CONFIG_FILE)
  } catch { /* 静默 */ }
  return next
}

/** 解析当前生效数据根（纯计算，无缓存——调用即真相；调用方自行缓存） */
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
  return c === b || c.startsWith(b + '/') || c.startsWith(b + '\\')
}
