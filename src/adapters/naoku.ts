/**
 * adapters/naoku.js — GongkaoNaoku 深度标注题库适配（v1.7）
 *
 * 数据：kaogong.db 分片（147MB）合并成 27506 题，含 kadian/reasoning/fastest/pitfalls/mother
 * 五维深度标注——这是「方法论原生化」的核心素材（不只是题，而是解题思维链）。
 *
 * 设计：
 *  - 分片合并到 data/.naoku.db（首次使用时生成，之后复用；不写源仓库）
 *  - Node 内置 node:sqlite（Node ≥22.19）只读打开，惰性连接 + 失败优雅降级
 *  - 所有查询只读；不可用时返回 null 让上层回落到 xingcezhenti 目录解析
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { imageMarkdown } from './naokuImage.js'

const NL = String.fromCharCode(10)
let db = null
let dbFailed = false
let dbPath = null

/** 合并分片（源仓 GongkaoNaoku/kaogong.db.part-*）到本地 data/.naoku.db */
function ensureDb(repoRoot, dataDir) {
  const target = join(dataDir, '.naoku.db')
  if (existsSync(target)) { dbPath = target; return target }
  const srcDir = join(repoRoot, 'GongkaoNaoku')
  if (!existsSync(srcDir)) return null
  let parts
  try {
    parts = readdirSync(srcDir).filter(f => /^kaogong\.db\.part-\d+$/.test(f)).sort()
  } catch { return null }
  // 也支持已合并的单文件
  if (!parts.length) {
    const single = join(srcDir, 'kaogong.db')
    if (existsSync(single)) { dbPath = single; return single }
    return null
  }
  try {
    mkdirSync(dataDir, { recursive: true })
    const bufs = parts.map(p => readFileSync(join(srcDir, p)))
    writeFileSync(target, Buffer.concat(bufs))
    dbPath = target
    return target
  } catch { return null }
}

/** 惰性打开（失败只降级一次，不反复重试拖慢请求） */
function open(repoRoot, dataDir) {
  if (db) return db
  if (dbFailed) return null
  try {
    const p = ensureDb(repoRoot, dataDir)
    if (!p) { dbFailed = true; return null }
    // 动态 import：node:sqlite 在旧 Node 上不存在，不能顶层 import 否则整插件加载失败
    const { createRequire } = require('node:module')
    void createRequire
    return null
  } catch { dbFailed = true; return null }
}

/**
 * 由于 node:sqlite 需动态加载（同步 import 在 ESM 里不便），
 * 这里用 top-level 的延迟初始化：首次调用前由 index 侧 await init()。
 */
export async function initNaoku(repoRoot, dataDir) {
  if (db) return true
  if (dbFailed) return false
  try {
    const p = ensureDb(repoRoot, dataDir)
    if (!p) { dbFailed = true; return false }
    const mod = await import('node:sqlite')
    const DatabaseSync = mod.DatabaseSync || (mod.default && mod.default.DatabaseSync)
    if (!DatabaseSync) { dbFailed = true; return false }
    db = new DatabaseSync(p, { readOnly: true })
    return true
  } catch {
    dbFailed = true
    return false
  }
}

export function naokuReady() { return !!db }
export function naokuStatus() {
  return { ready: !!db, failed: dbFailed, path: dbPath }
}

function safeAll(sql, params = []) {
  if (!db) return []
  try { return db.prepare(sql).all(...params) } catch { return [] }
}
function safeGet(sql, params = []) {
  if (!db) return null
  try { return db.prepare(sql).get(...params) } catch { return null }
}

/** 统计：模块/题型分布 + 标注覆盖率 */
export function naokuStats() {
  if (!db) return null
  const total = (safeGet('SELECT COUNT(*) c FROM questions') || {}).c || 0
  const withKadian = (safeGet('SELECT COUNT(*) c FROM questions WHERE LENGTH(kadian) > 0') || {}).c || 0
  const withFastest = (safeGet('SELECT COUNT(*) c FROM questions WHERE LENGTH(fastest) > 0') || {}).c || 0
  const withPitfalls = (safeGet('SELECT COUNT(*) c FROM questions WHERE LENGTH(pitfalls) > 0') || {}).c || 0
  const withImg = (safeGet('SELECT COUNT(*) c FROM questions WHERE has_image = 1') || {}).c || 0
  const modules = safeAll('SELECT module AS m, COUNT(*) c FROM questions GROUP BY module ORDER BY c DESC')
  const categories = safeAll('SELECT category AS k, COUNT(*) c FROM questions WHERE LENGTH(category) > 0 GROUP BY category ORDER BY c DESC LIMIT 30')
  return {
    total, withKadian, withFastest, withPitfalls, withImage: withImg,
    kadianCoverage: total ? +(withKadian / total * 100).toFixed(1) : 0,
    fastestCoverage: total ? +(withFastest / total * 100).toFixed(1) : 0,
    modules, categories,
  }
}

/** 抽题：按模块/题型/知识点筛选，返回带深度标注的题 */
export function naokuQuestions({ module, category, kadian, count = 1, random = true, repoRoot = null, mountPath = '/kaogong' }: any = {}) {
  if (!db) return []
  const where: any[] = []
  const args: any[] = []
  if (module) { where.push('module = ?'); args.push(module) }
  if (category) { where.push('category = ?'); args.push(category) }
  if (kadian) { where.push('kadian LIKE ?'); args.push('%' + kadian + '%') }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const order = random ? 'ORDER BY RANDOM()' : 'ORDER BY id'
  const rows = safeAll(`SELECT id,qid,module,category,kadian,region,year,paper,stem,options,answer,analysis,reasoning,fastest,pitfalls,mother,has_image,img_refs,qtype FROM questions ${w} ${order} LIMIT ?`, [...args, Math.min(20, count)])
  return rows.map(r => ({
    id: 'naoku-' + r.id,
    number: null,
    module: r.module || '',
    type: r.category || r.qtype || '',
    kadian: r.kadian || '',
    region: r.region || '', year: r.year || '', exam: r.paper || '',
    stem: stripHtml(r.stem || '') + (repoRoot && r.img_refs ? (NL + imageMarkdown(repoRoot, r.img_refs, mountPath)) : ''),
    options: parseOptions(r.options),
    correctAnswer: (r.answer || '').trim().toUpperCase() || null,
    analysis: stripHtml(r.analysis || ''),
    // 深度标注（方法论原生化的核心）
    reasoning: stripHtml(r.reasoning || ''),
    fastest: stripHtml(r.fastest || ''),
    pitfalls: stripHtml(r.pitfalls || ''),
    mother: stripHtml(r.mother || ''),
    hasImage: !!r.has_image,
    imgRefs: r.img_refs || '',
    source: 'naoku',
  }))
}

/** 知识点检索：从 kadian 字段找「考什么 + 怎么想」 */
export function searchKadian(keyword, limit = 20) {
  if (!db) return []
  const rows = safeAll(
    `SELECT kadian, category, module, COUNT(*) c FROM questions
     WHERE kadian LIKE ? GROUP BY kadian ORDER BY c DESC LIMIT ?`,
    ['%' + keyword + '%', Math.min(50, limit)]
  )
  return rows.map(r => ({ kadian: r.kadian, category: r.category, module: r.module, count: r.c }))
}

/** 取某知识点下的题（供「专题」按知识点刷题） */
export function questionsByKadian(kadian: string, limit = 10, repoRoot: any = null) {
  return naokuQuestions({ kadian, count: limit, random: false, repoRoot })
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim()
}

function parseOptions(raw) {
  const out: any = {}
  if (!raw) return out
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) {
      for (const o of arr) {
        const key = (o.key || o.label || '').toString().trim().toUpperCase()
        const text = stripHtml(o.html || o.text || o.label || '')
        if (key && text) out[key] = text
      }
      return out
    }
  } catch { /* 非 JSON，尝试文本解析 */ }
  const t = String(raw)
  for (const m of t.matchAll(/([A-D])[.、．:：]\s*([^A-D]+?)(?=\s*[A-D][.、．:：]|$)/g)) {
    out[m[1]] = stripHtml(m[2])
  }
  return out
}

/**
 * T-019 考点→试卷反查：从深度题库按 category 聚合出「哪些卷含该考点、各几题」。
 * 返回的 paper 是 naoku 的试卷名（含年份/地区/卷类），供 UI 做考点直达。
 */
export function papersByCategory(category: string, limit = 40) {
  if (!db) return []
  const rows = safeAll(
    "SELECT paper, region, year, COUNT(*) c FROM questions WHERE category = ? AND LENGTH(paper) > 0 GROUP BY paper ORDER BY c DESC LIMIT ?",
    [category, Math.min(100, limit)],
  )
  return rows.map((r: any) => ({
    paper: r.paper,
    region: r.region || '',
    year: +r.year || null,
    count: r.c,
  }))
}

/** 全部考点（category）清单及题量 */
export function categoryList(limit = 40) {
  if (!db) return []
  const rows = safeAll(
    "SELECT category k, COUNT(*) c FROM questions WHERE LENGTH(category) > 0 GROUP BY category ORDER BY c DESC LIMIT ?",
    [Math.min(100, limit)],
  )
  return rows.map((r: any) => ({ k: r.k, c: r.c }))
}
