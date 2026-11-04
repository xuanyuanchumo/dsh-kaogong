/**
 * adapters/naokuImage.js — 深度题库配图解析（v1.7.1）
 *
 * 问题：DB 的 img_refs 记录 `.webp`（如 /90-图片/题目图/18e4831202a066e.webp），
 * 但磁盘真实文件是 `.png`（xingcezhenti/90-图片/ 下 39051 个 png，0 个 webp）。
 *
 * 解法：按「去扩展名的 basename」在候选扩展名中探测真实文件；
 * 找到后返回可供 /api/naoku-img 服务的相对路径。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename, extname, resolve, sep } from 'node:path'

const IMG_ROOT_NAME = 'xingcezhenti'
const IMG_SUBDIR = '90-图片'
const TRY_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']

// 目录扫描缓存（同一目录只列一次；39051 文件全扫太慢）
const dirCache = new Map()

function listDir(dir) {
  if (dirCache.has(dir)) return dirCache.get(dir)
  let names = []
  try { names = readdirSync(dir) } catch { names = [] }
  dirCache.set(dir, names)
  return names
}

/**
 * 把 img_refs（形如 `/90-图片/题目图/xxx.webp`）解析成真实可服务的相对路径。
 * @returns 相对 xingcezhenti 的路径（如 `90-图片/题目图/xxx.png`）或 null
 */
export function resolveNaokuImage(repoRoot, imgRef) {
  const raw = String(imgRef || '').trim()
  if (!raw) return null
  // 去掉开头斜杠，统一分隔符
  const rel = raw.replace(/^[\\/]+/, '').replace(/\\/g, '/')
  const root = join(repoRoot, IMG_ROOT_NAME)
  // 1) 原样命中
  const direct = join(root, rel)
  if (existsSync(direct) && statSync(direct).isFile()) return rel
  // 2) 换扩展名探测（DB 说 webp，磁盘是 png）
  const dir = dirname(rel)
  const stem = basename(rel, extname(rel))
  const names = listDir(join(root, dir))
  for (const ext of TRY_EXTS) {
    const candidate = stem + ext
    if (names.includes(candidate)) return (dir === '.' ? candidate : dir + '/' + candidate)
  }
  // 3) 兜底：目录内前缀匹配（防 hash 截断）
  const hit = names.find(n => n.startsWith(stem))
  if (hit) return (dir === '.' ? hit : dir + '/' + hit)
  return null
}

/** 供 API 层安全读取：解析后必须仍在 xingcezhenti 内 */
export function safeImagePath(repoRoot, relPath) {
  const root = resolve(repoRoot, IMG_ROOT_NAME)
  const target = resolve(root, relPath)
  const prefix = root + sep
  if (!(target === root || target.startsWith(prefix))) return null
  const ext = extname(target).toLowerCase()
  if (!TRY_EXTS.includes(ext)) return null
  try {
    if (!existsSync(target) || !statSync(target).isFile()) return null
  } catch { return null }
  return target
}

/** 把题目 img_refs 转成 markdown 图片（供 RichText 渲染 → 走 /api/naoku-img） */
export function imageMarkdown(repoRoot, imgRefs, mountPath = '/kaogong') {
  const list = String(imgRefs || '').split(/[,;\s]+/).filter(Boolean)
  const out = []
  for (const ref of list) {
    const rel = resolveNaokuImage(repoRoot, ref)
    if (!rel) continue
    out.push('![' + basename(rel) + '](' + mountPath + '/api/naoku-img?p=' + encodeURIComponent(rel) + ')')
  }
  return out.join('\n')
}
