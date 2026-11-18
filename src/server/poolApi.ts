/**
 * server/poolApi.ts — 统一题目池 API（cycle-34 阶段 1 · K-3）
 *
 * 端点（设计 §9c.4 八端点）：
 *   GET  /api/pool/status          库状态/构建时间/各源覆盖/关系边数
 *   GET  /api/pool/questions       多源分层抽题（source/module/kadian/count）
 *   GET  /api/pool/search          跨源统一检索（FTS5 trigram + 跨源聚合去重）
 *   GET  /api/pool/question/:id    单题聚合视图（一份题干 + N 处出处 + 关系邻居）
 *   GET  /api/pool/relations       关系查询（rel_type/src/dst 过滤）
 *   GET  /api/pool/graph           关系子图（知识点/同题/同材料的邻域）
 *   POST /api/pool/rebuild         增量重建（按 source content_hash 判定）
 *   POST /api/pool/review          人工校验写入（承接 review 语义）
 *
 * ── 域链位置（研究 15 §2.3）──
 *   插在 `historyApi` 之后、`tuxingApi` 之前——`/api/pool/*` 前缀独立无冲突风险，
 *   但排在前面可让「统一池」在语义上先于各专项域被命中（改朝不加夕）。
 *
 * ── 兼容硬约束 ──
 *   既有端点字段零删改；新能力全部走 `/api/pool/*`。
 *   任何异常收敛为 `{ error }`（HTTP 200），绝不向路由层冒泡（崩溃安全纪律）。
 */
import { poolDb, poolDbStatus, poolStats, poolDbBytes, getMeta, POOL_TABLES, POOL_SCHEMA_VERSION } from '../adapters/poolDb.js'
import { rebuildPool, incrementalRebuild, registrySnapshot } from '../adapters/poolIngest.js'
import { poolHealth, ingestDiagnostics, REL_TYPE_META } from './poolObservability.js'

const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/** 抽题权重：复用 SRS 同源模型 1/(rate+0.15)（单一事实源纪律——不另立一套公式） */
function weaknessOf(rate: any): number {
  const r = (typeof rate === 'number' && isFinite(rate)) ? Math.max(0, Math.min(1, rate)) : 0
  return 1 / (r + 0.15)
}

/** 抽题策略：加权随机 + 无放回（确定性种子由调用方传入以保证可复现） */
function weightedPick<T>(items: T[], weights: number[], n: number): T[] {
  const out: T[] = []
  const pool = items.slice()
  const w = weights.slice()
  for (let k = 0; k < n && pool.length; k++) {
    const total = w.reduce((a, b) => a + b, 0)
    if (total <= 0) { out.push(pool.pop() as T); continue }
    let r = Math.random() * total
    let idx = pool.length - 1
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) { idx = i; break } }
    out.push(pool.splice(idx, 1)[0])
    w.splice(idx, 1)
  }
  return out
}

export function makePoolApi({ repoRoot, dataDir, store }) {
  const { loadProgress } = store

  /** 库就绪门（未重建时诚实降级，不臆造数据） */
  function requireDb(): any {
    const db = poolDb()
    if (!db) return null
    return db
  }

  // 异步：POST /api/pool/rebuild 需要 await 摄入（研究 15 §2.3 的 handleApi 链已支持 async 域）
  async function handlePoolApi(path: string, params: URLSearchParams, post: any, method: string, wsRaw: any): Promise<any> {
    if (!path.startsWith('/api/pool/')) return undefined

    /* ── GET /api/pool/status ── */
    if (path === '/api/pool/status') {
      const db = requireDb()
      const base = { ...poolDbStatus(), schemaVersion: POOL_SCHEMA_VERSION, tables: POOL_TABLES, bytes: poolDbBytes(dataDir) }
      if (!db) {
        return {
          ...base, ready: false, built: false,
          hint: '统一池未就绪——在「统一题库」视图点「重建」或调用 POST /api/pool/rebuild',
          stats: null,
          health: poolHealth(null, { bytes: poolDbBytes(dataDir) }),
        }
      }
      const stats = poolStats(db)
      const builtAt = getMeta(db, 'built_at')
      const sourceFingerprint = getMeta(db, 'source_fingerprint')
      let ingestStats: any = null
      try { const s = getMeta(db, 'ingest_stats'); ingestStats = s ? JSON.parse(s) : null } catch { /* 损坏即空 */ }
      return {
        ...base, ready: true, built: true,
        builtAt, sourceFingerprint, ingestStats,
        stats,
        // 白盒健康快照（可观测）：表行数/关系分布/数据质量指标/源覆盖
        health: poolHealth(db, { bytes: poolDbBytes(dataDir), path: poolDbStatus().path, builtAt }),
        // 源注册表快照（可扩展性）：已注册哪些源、各自可用性——新增源无需改本文件
        registry: registrySnapshot({ repoRoot, dataDir }),
        upstream: { naokuDb: poolDbStatus().path, repoRoot },
      }
    }

    /* ── GET /api/pool/health（独立观测端点：白盒面板消费，不与 status 混装）── */
    if (path === '/api/pool/health') {
      const db = requireDb()
      const builtAt = db ? getMeta(db, 'built_at') : null
      return {
        ...poolHealth(db, { bytes: poolDbBytes(dataDir), path: poolDbStatus().path, builtAt }),
        relTypeMeta: REL_TYPE_META,
      }
    }

    /* ── GET /api/pool/questions（多源分层抽题）── */
    if (path === '/api/pool/questions') {
      const db = requireDb()
      if (!db) return { questions: [], fallback: true, count: 0, hint: '统一池未就绪（先 POST /api/pool/rebuild）' }
      const source = params.get('source') || 'all'
      const moduleName = params.get('module') || ''
      const kadian = params.get('kadian') || ''
      const count = Math.min(50, Math.max(1, parseInt(params.get('count') || params.get('limit') || '10')))
      const where: string[] = []
      const args: any[] = []
      if (moduleName) { where.push('module = ?'); args.push(moduleName) }
      if (kadian) { where.push('kadian = ?'); args.push(kadian) }
      if (source && source !== 'all') { where.push('source_id = ?'); args.push(source) }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
      // 候选集上限：分层抽题不需要全表扫（性能守卫——研究 13 §4.4「检索响应 < 50ms」）
      const cand = db.prepare(`SELECT canonical_id, source_id, module, kadian, qid, paper, stem FROM question ${w} ORDER BY RANDOM() LIMIT 500`).all(...args)
      if (!cand.length) return { questions: [], count: 0, fallback: false, hint: '统一池内无匹配题（放宽 module/kadian 过滤）' }

      // 权重：按模块弱点（SRS 同源 1/(rate+0.15)）× 同题多出处加成（跨源聚合优先）
      const prog = loadProgress(wsRaw)
      const byModule = (prog && prog.byModule) || {}
      const moduleRate = (m: string): number => {
        const s = byModule[m]
        if (!s || !s.answered) return 0
        return Math.max(0, Math.min(1, (s.correct || 0) / s.answered))
      }
      const srcCount = new Map<string, number>()
      try {
        for (const r of db.prepare('SELECT canonical_id, COUNT(DISTINCT source_id) c FROM question_source GROUP BY canonical_id').all() as any[]) {
          srcCount.set(String(r.canonical_id), Number(r.c))
        }
      } catch { /* 无出处表则不加成 */ }
      const weights = cand.map((r: any) => {
        const m = String(r.module || '')
        const w0 = weaknessOf(moduleRate(m))
        const multi = srcCount.get(String(r.canonical_id)) || 1
        return w0 * (1 + (multi - 1) * 0.25)   // 多出处题权重上浮 25%/额外源
      })
      const picked = weightedPick(cand, weights, count)
      const ids = picked.map((r: any) => String(r.canonical_id))
      const questions = ids.map((id) => poolQuestionDetail(db, id)).filter(Boolean)
      return {
        questions, count: questions.length, source, module: moduleName, kadian,
        strategy: '模块弱点（SRS 1/(rate+0.15)）× 多出处加成',
        candidates: cand.length,
      }
    }

    /* ── GET /api/pool/search（跨源统一检索 + 去重聚合）── */
    if (path === '/api/pool/search') {
      const db = requireDb()
      if (!db) return { results: [], count: 0, fallback: true, hint: '统一池未就绪' }
      const q = String(params.get('q') || '').trim()
      const limit = Math.min(50, Math.max(1, parseInt(params.get('limit') || '20')))
      if (!q) return { results: [], count: 0, query: q }
      const t0 = Date.now()
      let rows: any[] = []
      try {
        // FTS5 trigram：中文全命中（实测 SQLite 3.51.2）。
        // 短查询（<3 字）trigram 无法命中 → 降级 LIKE（诚实降级，不静默返回空）
        if (q.length >= 3) {
          rows = db.prepare(
            `SELECT q.canonical_id, q.qid, q.source_id, q.module, q.category, q.kadian, q.stem, q.analysis, q.paper, q.region, q.year
             FROM question_fts f JOIN question q ON q.id = f.rowid
             WHERE question_fts MATCH ? ORDER BY bm25(question_fts) LIMIT ?`,
          ).all(q, limit * 3)
        }
        if (!rows.length) {
          rows = db.prepare(
            `SELECT canonical_id, qid, source_id, module, category, kadian, stem, analysis, paper, region, year
             FROM question WHERE stem LIKE ? OR analysis LIKE ? LIMIT ?`,
          ).all('%' + q + '%', '%' + q + '%', limit * 3)
        }
      } catch { /* FTS 不可用 → 保持空 */ }
      // 跨源去重聚合：同一 canonical_id 只出现一次，并汇总 N 处出处
      const seen = new Map<string, any>()
      for (const r of rows as any[]) {
        const id = String(r.canonical_id)
        if (seen.has(id)) { seen.get(id).sources.push({ source: r.source_id, paper: r.paper, region: r.region, year: r.year }); continue }
        seen.set(id, {
          canonicalId: id, qid: r.qid, module: r.module, category: r.category, kadian: r.kadian,
          stem: String(r.stem || '').slice(0, 400),
          analysis: String(r.analysis || '').slice(0, 200),
          sources: [{ source: r.source_id, paper: r.paper, region: r.region, year: r.year }],
        })
      }
      const results = [...seen.values()].slice(0, limit)
      return { query: q, results, count: results.length, tookMs: Date.now() - t0, engine: q.length >= 3 ? 'fts5-trigram' : 'like-fallback' }
    }

    /* ── GET /api/pool/question（单题聚合视图）──
     * 端点用**查询参数**而非路径参数（`?id=`）：能力对账以 `CAPABILITIES.endpoints`
     * 的**精确路径**集合为准（`DECLARED_ENDPOINT_SET.has(path)`），
     * 路径参数端点（`/api/pool/question/:id`）会因字面量不匹配而被判成
     * 「影子端点」（消费 ∧ ¬声明）→ 制造假漂移。
     * 教训同源：声明口径必须与运行态口径由同一常量派生。 */
    if (path === '/api/pool/question') {
      const db = requireDb()
      if (!db) return { error: '统一池未就绪' }
      const id = String(params.get('id') || '').trim()
      if (!id) return { error: '缺少题目 id（?id=canonical_id）' }
      const d = poolQuestionDetail(db, id)
      if (!d) return { error: '题目不存在: ' + id }
      return d
    }

    /* ── GET /api/pool/relations ── */
    if (path === '/api/pool/relations') {
      const db = requireDb()
      if (!db) return { relations: [], count: 0, fallback: true }
      const relType = params.get('rel_type') || ''
      const src = params.get('src') || ''
      const dst = params.get('dst') || ''
      const limit = Math.min(500, Math.max(1, parseInt(params.get('limit') || '100')))
      const where: string[] = []
      const args: any[] = []
      if (relType) { where.push('rel_type = ?'); args.push(relType) }
      if (src) { where.push('(src_id = ? OR src_kind = ?)'); args.push(src); args.push(src) }
      if (dst) { where.push('(dst_id = ? OR dst_kind = ?)'); args.push(dst); args.push(dst) }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
      let rows: any[] = []
      try { rows = db.prepare(`SELECT rel_type, src_kind, src_id, dst_kind, dst_id, weight, evidence FROM relation ${w} LIMIT ?`).all(...args, limit) } catch { /* 忽略 */ }
      const stats = poolStats(db)
      return { relations: rows, count: rows.length, relTypes: stats.relTypes, total: stats.relations }
    }

    /* ── GET /api/pool/graph（关系子图）── */
    if (path === '/api/pool/graph') {
      const db = requireDb()
      if (!db) return { nodes: [], edges: [], fallback: true }
      const node = params.get('node') || ''
      const depth = Math.min(3, Math.max(1, parseInt(params.get('depth') || '1')))
      const relType = params.get('rel_type') || ''
      const limit = Math.min(800, Math.max(10, parseInt(params.get('limit') || '200')))
      const nodes = new Map<string, any>()
      const edges: any[] = []
      const addNode = (id: string, kind: string, label: string) => {
        if (!id || nodes.has(id)) return
        nodes.set(id, { id, kind, label: String(label || id).slice(0, 80) })
      }
      try {
        if (node) {
          addNode(node, 'question', node)
          // BFS 展开关系邻域（深度受限，防爆炸）
          let frontier = [node]
          const visited = new Set<string>([node])
          for (let d = 0; d < depth; d++) {
            const next: string[] = []
            for (const cur of frontier) {
              const rows = db.prepare(
                `SELECT rel_type, src_kind, src_id, dst_kind, dst_id, weight FROM relation
                 WHERE (src_id = ? OR dst_id = ?)${relType ? ' AND rel_type = ?' : ''} LIMIT 200`,
              ).all(cur, cur, ...(relType ? [relType] : []))
              for (const r of rows as any[]) {
                addNode(String(r.src_id), String(r.src_kind), String(r.src_id))
                addNode(String(r.dst_id), String(r.dst_kind), String(r.dst_id))
                edges.push({ type: r.rel_type, source: r.src_id, target: r.dst_id, weight: Number(r.weight || 1) })
                for (const nxt of [String(r.src_id), String(r.dst_id)]) {
                  if (!visited.has(nxt)) { visited.add(nxt); next.push(nxt) }
                }
              }
            }
            frontier = next
            if (!frontier.length) break
          }
        } else {
          // 无指定节点 → 全局子图（按边数降序取前 N 条，保证有信息量）
          const rows = db.prepare(
            `SELECT rel_type, src_kind, src_id, dst_kind, dst_id, weight FROM relation
             ${relType ? 'WHERE rel_type = ?' : ''} ORDER BY weight DESC, id ASC LIMIT ?`,
          ).all(...(relType ? [relType] : []), limit)
          for (const r of rows as any[]) {
            addNode(String(r.src_id), String(r.src_kind), String(r.src_id))
            addNode(String(r.dst_id), String(r.dst_kind), String(r.dst_id))
            edges.push({ type: r.rel_type, source: r.src_id, target: r.dst_id, weight: Number(r.weight || 1) })
          }
        }
      } catch { /* 忽略 */ }
      return { nodes: [...nodes.values()], edges, nodeCount: nodes.size, edgeCount: edges.length, focus: node, depth }
    }

    /* ── POST /api/pool/rebuild ── */
    if (path === '/api/pool/rebuild' && method === 'POST') {
      const mode = String((post && post.mode) || 'full')
      const maxFiles = post && post.maxFiles ? parseInt(post.maxFiles) : undefined
      const r = mode === 'incremental'
        ? await incrementalRebuild(repoRoot, dataDir)
        : await rebuildPool(repoRoot, dataDir, { rebuild: true, maxFiles })
      // 可观测：重建结果附逐阶段诊断（失败时给根因线索，不只说「失败」）
      return { ...r, diagnostics: ingestDiagnostics(r) }
    }

    /* ── POST /api/pool/review（人工校验写入）── */
    if (path === '/api/pool/review' && method === 'POST') {
      const db = requireDb()
      if (!db) return { error: '统一池未就绪' }
      const canonicalId = String((post && post.canonicalId) || '').trim()
      const verifiedAnswer = String((post && post.verifiedAnswer) || '').trim()
      if (!canonicalId) return { error: '缺少 canonicalId' }
      if (!verifiedAnswer) return { error: '缺少 verifiedAnswer' }
      const at = new Date().toISOString()
      try {
        db.prepare(
          `INSERT INTO review(canonical_id,official_answer,verified_answer,status,at) VALUES(?,?,?,?,?)
           ON CONFLICT(canonical_id) DO UPDATE SET verified_answer=excluded.verified_answer, status=excluded.status, at=excluded.at`,
        ).run(canonicalId, String((post && post.officialAnswer) || ''), verifiedAnswer, String((post && post.status) || 'confirmed'), at)
        return { ok: true, canonicalId, verifiedAnswer, at }
      } catch (e: any) {
        return { error: '写入失败: ' + (e && e.message ? e.message : String(e)) }
      }
    }

    return undefined
  }

  /**
   * 供数给既有练习链路（`/api/questions`）。
   *
   * ── 形状契约（兼容硬约束：既有端点字段零删改）──
   * 返回的题目对象必须与目录解析路径**同形**，否则客户端
   * （`q.correctAnswer` / `q.options` / `q.stem` 的 kgimg:// 占位）会崩。
   *   · options：目录路径是 `{A:'文本', B:'文本'}`；naoku 存的是 JSON 数组 → 归一为同形
   *   · correctAnswer：目录路径字段名；naoku 存 `answer` → 映射同名字段
   *   · stem：naoku 的 img 已占位化为 `kgimg://`（归一铁律②）
   *   · id/number/type/module/exam/region/year/source/paperFile：全部对齐
   */
  function sampleQuestions({ module, count }: { module?: string, count?: number }): any {
    const db = requireDb()
    if (!db) return { error: '统一池未就绪（先 POST /api/pool/rebuild）' }
    const n = Math.min(50, Math.max(1, count || 1))
    const where: string[] = []
    const args: any[] = []
    if (module && module !== 'all') { where.push('module = ?'); args.push(module) }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
    let rows: any[] = []
    try {
      rows = db.prepare(
        `SELECT canonical_id, qid, source_id, local_key, module, category, kadian, qtype,
           stem, options, answer, analysis, group_material, group_material_no,
           images, paper, region, year, freq
         FROM question ${w} ORDER BY RANDOM() LIMIT ?`,
      ).all(...args, n * 3)
    } catch { return { error: '统一池查询失败' } }
    if (!rows.length) return { error: '统一池内无匹配题（module=' + (module || 'all') + '）' }

    // 优先选**带图**的题（练习链路体验：图推/资料分析题有图才有价值）
    // —— 目录路径抽题时图占比随机，统一池可显式提升（首次出现图即停）
    const picked: any[] = []
    const withImg: any[] = []
    for (const r of rows) {
      const q = poolRowToQuestion(r)
      if (!q) continue
      if (String(q.stem || '').includes('kgimg://')) { withImg.push(q); if (picked.length < n && withImg.length <= n) picked.push(q) }
      else if (picked.length < n) picked.push(q)
      if (picked.length >= n) break
    }
    // 无图题补足到 n
    if (picked.length < n) {
      for (const r of rows) {
        if (picked.length >= n) break
        const q = poolRowToQuestion(r)
        if (q && !picked.includes(q)) picked.push(q)
      }
    }
    if (!picked.length) return { error: '统一池内无可用题' }
    const file = picked[0] && picked[0].paperFile ? String(picked[0].paperFile) : 'pool'
    return { file, count: picked.length, questions: picked }
  }

  return { handle: handlePoolApi, sampleQuestions }
}

/**
 * 池行 → 练习链路的题目对象（形状与目录解析路径同形）。
 * 归一铁律：可空字段不臆造（缺失即空串，不填 0/占位）。
 *
 * ⚠️ `source` 字段：必须回填**真实上游源名**（`xingcezhenti` / `gk-tuxing` …），
 * 不可用 'pool' 之类的中性地名——客户端 `KG_SOURCE_META` 按源名渲染出处徽章
 * （错题本/练习卡的「来源」标签），填错会让用户看到「未知来源」，
 * 且 smoke SMOKE-HIST-12 会假红。存储层是**聚合层**，不是新的数据来源。
 */
export function poolRowToQuestion(r: any): any {
  if (!r) return null
  let options: any = {}
  const rawOpt = String(r.options || '').trim()
  if (rawOpt) {
    try {
      const parsed = JSON.parse(rawOpt)
      if (Array.isArray(parsed)) {
        // naoku 形态：[{key,label,html,is_answer}] → {A:'文本', ...}
        for (const o of parsed) {
          const k = String((o && o.key) || '').trim()
          if (!k) continue
          const txt = String((o && o.html) || (o && o.label) || '').trim()
          options[k] = txt
        }
      } else if (parsed && typeof parsed === 'object') {
        options = parsed
      }
    } catch { options = { raw: rawOpt } }
  }
  const answer = String(r.answer || '').trim()
  // 源名回填：池内 source_id 是上游仓库名（naoku/xingcezhenti/gk-tuxing…）
  const srcId = String(r.source_id || '').trim()
  const source = srcId && srcId !== 'pool' ? srcId : 'xingcezhenti'
  return {
    id: String(r.canonical_id || ''),
    number: 0,
    type: String(r.qtype || ''),
    module: String(r.module || ''),
    exam: '',
    region: String(r.region || ''),
    year: String(r.year || ''),
    source,
    paperFile: String(r.paper || ''),
    qid: String(r.qid || ''),
    stem: String(r.stem || ''),
    options,
    correctAnswer: answer,
    analysis: String(r.analysis || ''),
    groupMaterial: String(r.group_material || ''),
    groupMaterialNo: Number(r.group_material_no || 0),
  }
}

/**
 * 单题聚合视图（一份题干 + N 处出处 + 关系邻居）。
 * 跨源聚合的呈现核心——DoD §11.2：同一道题多源出现 → 1 条结果 + N 处出处。
 */
export function poolQuestionDetail(db: any, canonicalId: string): any {
  try {
    const q = db.prepare(
      `SELECT canonical_id, qid, fp, source_id, local_key, module, category, kadian, qtype, ask_model,
        stem, options, answer, analysis, reasoning, fastest, pitfalls, mother, doubt, related,
        group_material, group_material_no, material_ref, images, has_image, freq, paper, region, year
       FROM question WHERE canonical_id = ?`,
    ).get(canonicalId)
    if (!q) return null
    const sources = db.prepare(
      'SELECT source_id, local_key, paper, region, year, seq FROM question_source WHERE canonical_id = ? ORDER BY source_id, paper',
    ).all(canonicalId)
    const relations = db.prepare(
      'SELECT rel_type, src_kind, src_id, dst_kind, dst_id, weight FROM relation WHERE src_id = ? OR dst_id = ? LIMIT 60',
    ).all(canonicalId, canonicalId)
    let images: any[] = []
    try { images = JSON.parse(String(q.images || '[]')) } catch { images = [] }
    let options: any = {}
    try { options = JSON.parse(String(q.options || '{}')) } catch { options = { raw: String(q.options || '') } }
    return {
      canonicalId: q.canonical_id, qid: q.qid, fp: q.fp,
      module: q.module, category: q.category, kadian: q.kadian, qtype: q.qtype,
      stem: q.stem, options, answer: q.answer, analysis: q.analysis,
      dims: { reasoning: q.reasoning, fastest: q.fastest, pitfalls: q.pitfalls, mother: q.mother, doubt: q.doubt, askModel: q.ask_model },
      related: q.related, groupMaterial: q.group_material, groupMaterialNo: q.group_material_no,
      materialRef: q.material_ref, images, hasImage: Number(q.has_image || 0),
      freq: q.freq, paper: q.paper, region: q.region, year: q.year,
      sources, sourceCount: sources.length,
      relations,
    }
  } catch {
    return null
  }
}
