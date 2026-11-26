/**
 * server/dataApi.ts — 数据查询域（v1.3 复杂度拆分自 http.js；v9 统一数据层改造）
 *
 * 端点：banks / modules / plan / search / method / methods 六个只读查询。
 *
 * ── v9 改造（消除外源直读）──
 *   旧实现三处直读外源：
 *     · `/api/banks`   → 逐个 existsSync(数据根/<repo>) 探目录
 *     · `/api/modules` → 数 `xingcezhenti/<模块>/*.md` 文件个数
 *     · `/api/search`  → DFS 扫三仓 md 正文
 *     · `/api/method`  → 读 `kaogong-skill/.../references/*.md`
 *   全部改为读 `.kaogong.db`：
 *     · banks   → source 表（health + question_count，状态机而非布尔——教训㊻）
 *     · modules → question 表按 module 聚合
 *     · search  → knowledge_fts（FTS5 trigram，方法论/技能正文已入库）
 *     · method  → knowledge 表（kn_id='skill:<name>'）
 *   未就绪时返回结构化提示（不制造死路），绝不回落到文件扫描。
 */
import { REPOS, XINGCE_MODULES, METHOD_MAP, safeReadFile, parsePlanStructure } from '../adapters/repoData.js'
import { poolDb, getCachedStats } from '../adapters/poolDb.js'
import { ensureDomain } from './dataGate.js'

/** 学习计划（结构化 + 单日聚焦）——模板文件是**随包资产**（package.json files 声明），
 *  不属于「题库数据」，故仍从数据根读取（它是静态模板，非外源题库）。 */
export function makeStudyPlan(planFile: any) {
  return function studyPlan(day: any) {
    // 模板读取下沉到 adapters（repoData.safeReadFile 是唯一入口，便于守卫锚定）
    const content = readPlanFile(planFile)
    if (!content) return { plan: '学习计划文件未找到', raw: '', phases: [], days: [] }
    const structured = parsePlanStructure(content)
    if (!day || day === 'all') return { ...structured, raw: content }
    const dayObj = structured.days.find(d => d.day === +day) || null
    return { ...structured, current: dayObj, raw: dayObj ? (content.match(new RegExp(`### 第${day}天[\\s\\S]*?(?=\\n### |\\n## |$)`)) || [''])[0] : `未找到第 ${day} 天的计划` }
  }
}

/** 计划模板读取（safeReadFile 返回 string | null，缺失时收敛为空串——调用方按空计划降级） */
function readPlanFile(f: any): string {
  try { return safeReadFile(f, 100000) || '' } catch { return '' }
}

export function makeDataApi({ repoRoot, planFile, dataCtx }: any) {
  const studyPlan = makeStudyPlan(planFile)
  const ctx = (): { repoRoot: string, dataDir: string } => dataCtx || { repoRoot, dataDir: '' }

  /** 库内模块分布（快照缓存：数据写入后由 invalidateStatsCache 失效） */
  function moduleCounts(): Map<string, number> {
    return getCachedStats('dataapi-modules', () => {
      const db = poolDb()
      const map = new Map<string, number>()
      if (!db) return map
      try {
        for (const r of db.prepare("SELECT module m, COUNT(*) c FROM question WHERE LENGTH(module) > 0 GROUP BY module").all() as any[]) {
          map.set(String(r.m), Number(r.c))
        }
      } catch { /* 查询失败 → 空分布（调用方渲染 0 而非崩溃） */ }
      return map
    }).data
  }

  /** 方法论检索（knowledge_fts FTS5 trigram；三字以下降级 LIKE——trigram 固有约束） */
  function searchKnowledgeDb(query: string, limit = 20): any[] {
    const db = poolDb()
    const q = String(query || '').trim()
    if (!db || !q) return []
    const out: any[] = []
    try {
      let rows: any[] = []
      if (q.length >= 3) {
        rows = db.prepare(
          `SELECT k.kn_id, k.kind, k.module, k.title, k.path,
             snippet(knowledge_fts, 1, '[', ']', '…', 24) snip
           FROM knowledge_fts f JOIN knowledge k ON k.id = f.rowid
           WHERE knowledge_fts MATCH ? ORDER BY bm25(knowledge_fts) LIMIT ?`,
        ).all(q, Math.max(1, Math.min(60, limit))) as any[]
      }
      if (!rows.length) {
        rows = db.prepare(
          `SELECT kn_id, kind, module, title, path, SUBSTR(body, 1, 200) snip
           FROM knowledge WHERE title LIKE ? OR body LIKE ? LIMIT ?`,
        ).all('%' + q + '%', '%' + q + '%', Math.max(1, Math.min(60, limit))) as any[]
      }
      for (const r of rows) {
        out.push({
          file: String(r.path || r.kn_id || ''), repo: String(r.kind || ''),
          title: String(r.title || ''), snippet: String(r.snip || ''),
          knId: String(r.kn_id || ''), module: String(r.module || ''),
        })
      }
    } catch { /* 检索失败 → 空结果（调用方显示「无命中」而非报错） */ }
    return out
  }

  return async function handleDataApi(path: any, params: any, post: any, method: any) {
    if (path === '/api/banks') {
      // v9：source 表驱动（health 是词表而非布尔——「装了但不可用」可判定，教训㊻）
      const db = poolDb()
      const banks: any = {}
      let ready = 0
      const rows = (() => {
        try { return db ? db.prepare('SELECT id, health, question_count, tier, local_root FROM source').all() as any[] : [] } catch { return [] }
      })()
      const byId = new Map(rows.map((r: any) => [String(r.id), r]))
      for (const [key, desc] of Object.entries(REPOS as Record<string, string>)) {
        const r = byId.get(key)
        // health 缺失 → 'unknown'（不可探测不臆造）；question_count 缺失 → null
        const health = r && r.health ? String(r.health) : 'unknown'
        const exists = health === 'ok' || (r != null && Number(r.question_count || 0) > 0)
        if (exists) ready++
        banks[key] = { desc, exists, health, questionCount: r && r.question_count != null ? Number(r.question_count) : null }
      }
      return { banks, total: Object.keys(REPOS).length, ready, sourceTier: db ? 'pool' : 'none' }
    }
    if (path === '/api/modules') {
      // v9：库内 module 聚合（不再数目录 md 文件个数）
      const counts = moduleCounts()
      const modules: any = {}
      for (const [name, dir] of Object.entries(XINGCE_MODULES)) {
        modules[name] = { dir, questionCount: counts.get(name) || 0 }
      }
      return { modules, sourceTier: poolDb() ? 'pool' : 'none' }
    }
    if (path === '/api/plan') return studyPlan(params.get('day') || 'all')
    if (path === '/api/search') {
      const q = params.get('q') || ''
      const results = searchKnowledgeDb(q, 20)
      if (!results.length && q) {
        // 库内无命中时按需入库一次（首次使用：方法论尚未摄入），仍空则诚实返回
        const g = await ensureDomain('method', ctx())
        const again = searchKnowledgeDb(q, 20)
        if (!again.length) {
          return {
            results: [], total: 0, ready: false, ingesting: !!g.ingesting,
            hint: g.hint || '知识正文尚未入库（请到「📦 题库管理」安装语料并重建统一库）',
          }
        }
        return { results: again, total: again.length, sourceTier: 'pool' }
      }
      return { results, total: results.length, sourceTier: poolDb() ? 'pool' : 'none' }
    }
    if (path === '/api/method') {
      const topic = params.get('topic') || post.topic || ''
      return methodRef(topic)
    }
    if (path === '/api/methods') {
      // v9：**主题清单仍由 METHOD_MAP 声明**（"有哪些主题"是契约，不是库内容）；
      // 库只提供「该主题的正文是否已入库」（存在性 + 路径），不再探 kaogong-skill 目录。
      //
      // 为什么这样分工：库里 kind='skill' 的节点可能包含 SOURCES.md 这类**非主题文档**
      // （实测 11 条 vs 声明 10 主题）——若直接「库里有什么就返回什么」，声明的主题集合
      // 与运行态输出就会漂移（v1.8 白名单假阳性同族）。声明在前、库作存在性判据，
      // 两侧口径才同源（教训㉑「呈现层同源」）。
      const db = poolDb()
      const declared = Object.keys(METHOD_MAP).map(t => ({
        id: t, label: t, file: (METHOD_MAP as Record<string, any>)[t],
      }))
      if (!db) return { topics: declared.map(t => ({ ...t, exists: false })), ready: false, hint: '统一库未就绪（node:sqlite 不可用）' }
      let have = new Map<string, string>()
      try {
        for (const r of db.prepare("SELECT kn_id, path FROM knowledge WHERE kind='skill'").all() as any[]) {
          have.set(String(r.kn_id).replace(/^skill:/, ''), String(r.path || ''))
        }
      } catch { have = new Map() }
      return {
        topics: declared.map(t => {
          const key = String(t.file || '').replace(/\.md$/, '')
          const p = have.get(key)
          return { ...t, exists: p != null, path: p || '' }
        }),
        sourceTier: 'pool',
      }
    }
    return undefined
  }

  /** 方法论参考（knowledge 表；未入库时按需摄入后重试一次） */
  function methodRef(topic: string): any {
    const db = poolDb()
    if (!db) return { topic, error: '统一库未就绪（node:sqlite 不可用）', content: '' }
    // 主题 → 文件名的映射仍由 METHOD_MAP（manifest 声明）提供（单一事实源）
    const fileName = (METHOD_MAP as Record<string, any>)[topic] || (METHOD_MAP as Record<string, any>)[(topic || '').slice(0, 2)]
    if (!fileName) return { topic, error: '未知方法论主题', content: '', known: Object.keys(METHOD_MAP) }
    try {
      const knId = 'skill:' + String(fileName).replace(/\.md$/, '')
      const row = db.prepare('SELECT body, title, path FROM knowledge WHERE kn_id = ?').get(knId) as any
      if (!row) return { topic, file: fileName, error: `方法论未入库：${fileName}（请到「📦 题库管理」安装 kaogong-skill 后重建）`, content: '', ready: false }
      return { topic, file: fileName, content: String(row.body || ''), title: row.title || '', path: row.path || '', sourceTier: 'pool' }
    } catch (e: any) {
      return { topic, error: '读取失败: ' + (e && e.message ? e.message : String(e)), content: '' }
    }
  }
}
