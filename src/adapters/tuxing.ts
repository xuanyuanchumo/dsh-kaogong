/**
 * adapters/tuxing.ts — 图形推理专项题库（T-023 完整版）
 *
 * 数据源：gk-tuxing 静态站的 assets/data.js（window.QDATA 数组）
 * 354 题，每题：{ id, g(组), n(序号), img(图片相对路径), src(来源),
 *                cat(规律分类代码), fmt(格式), ans(答案), exp(解题思路), acc(分析), trap(陷阱) }
 *
 * 13 个规律分类：空间重构 / 位置 / 面 / 对称 / 样式 / 笔画 / 线 / 元素 / 点 / 曲直 / 角 / 特殊 / 综合
 *
 * 设计：只读；首次访问解析并缓存（data.js 是单文件 JSON，几十 KB，解析快）。
 * 图片走 /api/tuxing-img 二进制服务（基准目录 gk-tuxing/）。
 */
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { join, resolve, extname, dirname, sep } from 'node:path'

const REPO = 'gk-tuxing'
const DATA_FILE = 'assets/data.js'

/** 规律分类代码 → 中文名（顺序即展示优先级：高频在前） */
export const CAT_NAMES: Record<string, string> = {
  space: '空间重构',
  position: '位置规律',
  face: '面数量',
  symmetry: '对称性',
  style: '样式规律',
  stroke: '笔画数',
  special: '特殊规律',
  other: '综合规律',
  line: '线条规律',
  element: '元素种类',
  point: '点规律',
  quzhi: '曲直性',
  angle: '角数量',
}

export interface TuxingQuestion {
  id: string
  group: string
  no: number
  img: string
  src: string
  cat: string
  catName: string
  fmt: string
  ans: string
  exp: string
  acc: string
  trap: string
}

let cache: TuxingQuestion[] | null = null
let cacheFailed = false

/** 解析 data.js 里的 QDATA 数组（失败返回空数组，不抛错） */
function loadAll(repoRoot: string): TuxingQuestion[] {
  if (cache) return cache
  if (cacheFailed) return []
  try {
    const file = join(repoRoot, REPO, DATA_FILE)
    if (!existsSync(file)) { cacheFailed = true; return [] }
    const raw = readFileSync(file, 'utf-8')
    const m = raw.match(/window\.QDATA\s*=\s*(\[[\s\S]*\])/)
    if (!m) { cacheFailed = true; return [] }
    const arr = JSON.parse(m[1]) as any[]
    cache = arr.map((q) => ({
      id: String(q.id || ''),
      group: String(q.g || ''),
      no: Number(q.n) || 0,
      img: String(q.img || ''),
      src: String(q.src || ''),
      cat: String(q.cat || 'other'),
      catName: CAT_NAMES[String(q.cat)] || '其他',
      fmt: String(q.fmt || ''),
      ans: String(q.ans || '').toUpperCase(),
      exp: String(q.exp || ''),
      acc: String(q.acc || ''),
      trap: String(q.trap || ''),
    }))
    return cache
  } catch {
    cacheFailed = true
    return []
  }
}

export function tuxingReady(repoRoot: string): boolean {
  return loadAll(repoRoot).length > 0
}

/** 分类清单（按题量降序，带中文名） */
export function tuxingCats(repoRoot: string) {
  const all = loadAll(repoRoot)
  const map = new Map<string, number>()
  for (const q of all) map.set(q.cat, (map.get(q.cat) || 0) + 1)
  return [...map.entries()]
    .map(([cat, count]) => ({ cat, name: CAT_NAMES[cat] || '其他', count }))
    .sort((a, b) => b.count - a.count)
}

/** 按分类抽题（cat 为空则全部）；顺序稳定便于顺序刷 */
export function tuxingQuestions(repoRoot: string, opts: { cat?: string; limit?: number; offset?: number } = {}) {
  const all = loadAll(repoRoot)
  let list = opts.cat ? all.filter((q) => q.cat === opts.cat) : all
  const offset = Math.max(0, opts.offset || 0)
  const limit = Math.min(50, opts.limit || 10)
  const slice = list.slice(offset, offset + limit)
  return {
    total: list.length,
    offset,
    count: slice.length,
    questions: slice.map((q) => ({
      ...q,
      imgUrl: '/kaogong/api/tuxing-img?p=' + encodeURIComponent(q.img),
    })),
  }
}

/** 单题详情（含完整 exp/acc/trap） */
export function tuxingQuestion(repoRoot: string, id: string) {
  const q = loadAll(repoRoot).find((x) => x.id === id)
  if (!q) return { error: '题目不存在: ' + id }
  return { ...q, imgUrl: '/kaogong/api/tuxing-img?p=' + encodeURIComponent(q.img) }
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
}

/** 图片服务：路径必须落在 gk-tuxing 内 */
export function serveTuxingImage(repoRoot: string, relPath: string, res: any): void {
  const root = resolve(repoRoot, REPO)
  const target = resolve(root, relPath)
  const prefix = root + sep
  if (!(target === root || target.startsWith(prefix))) { res.writeHead(403); res.end('forbidden'); return }
  const ext = extname(target).toLowerCase()
  if (!MIME[ext]) { res.writeHead(415); res.end('unsupported'); return }
  let st: any = null
  try { st = existsSync(target) ? statSync(target) : null } catch { st = null }
  if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return }
  try {
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Length': st.size, 'Cache-Control': 'public, max-age=86400' })
  } catch { try { res.destroy() } catch {} ; return }
  const stream = createReadStream(target)
  stream.on('error', () => { try { res.destroy() } catch {} })
  stream.pipe(res)
}
