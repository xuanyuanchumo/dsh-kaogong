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
import { poolDb, poolDbStatus, poolStats, poolDbBytes, getMeta, getCachedStats, invalidateStatsCache, studyEventStats, POOL_TABLES, POOL_SCHEMA_VERSION } from '../adapters/poolDb.js'
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

  // ── T-032 重建作业状态（repoManager 同构：进行中单槽 + 归档环形 10）──
  // 教训㊸：作业表只存「进行中」，完成态必须另存归档——「上次重建是什么结果」
  // 在只存当前态的系统里永远无法回答。单槽（同一时刻至多一个重建）防并发重建互相清库。
  const rebuildJobs = new Map<string, any>()
  const rebuildHistory: any[] = []

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
      // cycle-36 O1：统计走快照缓存（重建/写入时失效；二次查询 <5ms）
      const statsSnap = getCachedStats('poolStats', () => poolStats(db))
      const stats = statsSnap.data
      const builtAt = getMeta(db, 'built_at')
      const sourceFingerprint = getMeta(db, 'source_fingerprint')
      let ingestStats: any = null
      try { const s = getMeta(db, 'ingest_stats'); ingestStats = s ? JSON.parse(s) : null } catch { /* 损坏即空 */ }
      return {
        ...base, ready: true, built: true,
        builtAt, sourceFingerprint, ingestStats,
        stats,
        // 白盒健康快照（可观测）：表行数/关系分布/数据质量指标/源覆盖
        health: getCachedStats('poolHealth', () => poolHealth(db, { bytes: poolDbBytes(dataDir), path: poolDbStatus().path, builtAt })).data,
        // 源注册表快照（可扩展性）：已注册哪些源、各自可用性——新增源无需改本文件
        registry: registrySnapshot({ repoRoot, dataDir }),
        // cycle-38 阶段 2：学习事件流水概览（双写期白盒观测——读侧尚未切，透明）
        studyEvents: studyEventStats(db),
        upstream: { naokuDb: poolDbStatus().path, repoRoot },
      }
    }

    /* ── GET /api/pool/health（独立观测端点：白盒面板消费，不与 status 混装）── */
    if (path === '/api/pool/health') {
      const db = requireDb()
      const builtAt = db ? getMeta(db, 'built_at') : null
      // cycle-36 O1：健康快照缓存（与 status 共享同一失效钩子）
      const healthSnap = getCachedStats('poolHealth', () => poolHealth(db, { bytes: poolDbBytes(dataDir), path: poolDbStatus().path, builtAt }))
      return {
        ...healthSnap.data,
        cached: healthSnap.cached,
        snapshotBuiltAt: healthSnap.builtAt,
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
      // 候选集上限：分层抽题不需要全表扫（性能守卫——研究 13 §4.4「检索响应 < 50ms」）。
      //
      // cycle-36 O3c（研究 17）：无过滤条件时 `ORDER BY RANDOM()` 需为全表 51211 行
      // 生成随机键再排序 = 实测 **215ms**（questions 端点 p50 203ms 的主体）。
      // 正解 = **随机 rowid 采样**：先取 id 区间，均匀撒 N 个随机点逐点取行
      // （索引 seek，实测 22ms，10 倍）。分布近似均匀（id 空洞由三倍尝试兜底）。
      // 带过滤条件（module/kadian/source）时结果集小，保留 RANDOM()（~23ms，简单可靠）。
      // cycle-42 IMG-04 性能护栏：带图 id 缓存（has_image 无索引，全表 LIKE 450ms/次
      // 会击穿 PERF-04 <300ms 基线）——首次全表扫建缓存（一次性 ~490ms，与 srcCount
      // 同一失效钩子 invalidateStatsCache('rebuild')），后续随机取 O(1)（实测 <1ms）。
      const imgPool = getCachedStats('imgPool', () => {
        try {
          // cycle-43（评审修复）：补 source_id/kadian——原只缓存 module，导致带图补足
          // 忽略 source/kadian 过滤（实测 source=qiuzhao 10 条里 5 条主源是 xingce-app）。
          return db.prepare('SELECT canonical_id, module, source_id, kadian FROM question WHERE has_image = 1').all() as any[]
        } catch { return [] as any[] }
      }).data
      // 过滤谓词（SSOT）：module/source/kadian 三者都 honour —— 候选补足与结果层补足共用
      const imgPoolFilter = (r: any): boolean =>
        (!moduleName || String(r.module) === moduleName) &&
        (!source || source === 'all' || String(r.source_id) === source) &&
        (!kadian || String(r.kadian) === kadian)
      let cand: any[]
      if (where.length === 0) {
        const span = db.prepare('SELECT COUNT(*) c, MIN(id) mn, MAX(id) mx FROM question').get() as any
        const want = 500
        const seen = new Set<number>()
        const pick = db.prepare('SELECT canonical_id, source_id, module, kadian, qid, paper, stem, LENGTH(reasoning) AS dim_len FROM question WHERE id >= ? LIMIT 1')
        cand = []
        let attempts = 0
        while (cand.length < want && attempts < want * 3) {
          attempts++
          const rid = Math.floor(Number(span.mn) + Math.random() * (Number(span.mx) - Number(span.mn) + 1))
          if (seen.has(rid)) continue
          seen.add(rid)
          const r = pick.get(rid)
          if (r) cand.push(r)
        }
      } else {
        cand = db.prepare(`SELECT canonical_id, source_id, module, kadian, qid, paper, stem, LENGTH(reasoning) AS dim_len FROM question ${w} ORDER BY RANDOM() LIMIT 500`).all(...args)
      }
      // cycle-42（IMG-04 同族根治 /api/pool/questions）：随机候选窗口内带图占比低
      // （判断推理 15%）→ weightedPick 可能全无图题。与 sampleQuestions 同修：
      // **带图定向补捞**——候选中带图行不足 count/4 时追加一批（候选域内多样性保留，
      // 带图题以**候选资格**进入加权池而非硬配额——抽题策略语义不变）。
      // cycle-42 确定性配额（与 sampleQuestions 同族）：候选窗口内带图题不足时，
      // **定向补足到 ⌈count/2⌉**——带图层直接查（池内 1442 条判断推理带图 ≥ 配额必有），
      // 以候选资格进加权池（抽题策略语义不变：弱点权重仍生效）。
      const imgCount = cand.filter((r: any) => String(r.stem || '').includes('kgimg://')).length
      const imgQuota = Math.ceil(count / 2)
      if (imgCount < imgQuota && imgPool.length) {
        // 从缓存随机取（honour module/source/kadian——防越界补足）
        const pool = imgPool.filter(imgPoolFilter)
        const ids = new Set(cand.map((r: any) => String(r.canonical_id)))
        let added = 0
        for (let i = 0; i < pool.length && added < imgQuota * 2; i++) {
          const r = pool[Math.floor(Math.random() * pool.length)]
          const cid = String(r.canonical_id)
          if (!ids.has(cid)) { cand.push({ canonical_id: cid, module: r.module, stem: '' }); ids.add(cid); added++ }
        }
      }
      if (!cand.length) return { questions: [], count: 0, fallback: false, hint: '统一池内无匹配题（放宽 module/kadian 过滤）' }

      // 权重：按模块弱点（SRS 同源 1/(rate+0.15)）× 同题多出处加成（跨源聚合优先）
      const prog = loadProgress(wsRaw)
      const byModule = (prog && prog.byModule) || {}
      const moduleRate = (m: string): number => {
        const s = byModule[m]
        if (!s || !s.answered) return 0
        return Math.max(0, Math.min(1, (s.correct || 0) / s.answered))
      }
      // cycle-36 O2：srcCount 预聚合走进程内缓存（原每请求 87ms 全表 GROUP BY → 命中 <0.1ms；
      // 与 O1 同一失效钩子——rebuild 后首查重算）
      const srcCount = getCachedStats('srcCount', () => {
        const m = new Map<string, number>()
        try {
          for (const r of db.prepare('SELECT canonical_id, COUNT(DISTINCT source_id) c FROM question_source GROUP BY canonical_id').all() as any[]) {
            m.set(String(r.canonical_id), Number(r.c))
          }
        } catch { /* 无出处表则不加成 */ }
        return m
      }).data
      const weights = cand.map((r: any) => {
        const m = String(r.module || '')
        const w0 = weaknessOf(moduleRate(m))
        const multi = srcCount.get(String(r.canonical_id)) || 1
        // cycle-43（真机测试发现）：同题多源时若无差别抽题，可能抽到无五维的贫源版本
        // （实测同题 naoku 版有五维 598/116/165/144，xingce-app 版全空）→ 练习卡看不到
        // 解题推理链。富源优先：带五维题权重 ×1.5（与 sampleQuestions 的 rich 优选同族语义）。
        const dimBoost = Number(r.dim_len || 0) > 0 ? 1.5 : 1
        return w0 * (1 + (multi - 1) * 0.25) * dimBoost
      })
      const picked = weightedPick(cand, weights, count)
      const ids = picked.map((r: any) => String(r.canonical_id))
      const questions = ids.map((id) => poolQuestionDetail(db, id)).filter(Boolean)
      // cycle-42 结果层确定性配额（IMG-04 根治第二步）：加权池稀释使带图行实际命中
      // 不可控（补捞 10 行进 510 池期望命中 0.2）——**结果层补足**：带图题不足 ⌈count/2⌉
      // 时从带图层直查 poolQuestionDetail 补入头部（与 sampleQuestions L1 同构；
      // 加权抽题策略语义不变——补足只发生在结果层，抽题多样性完整保留）。
      const imgInResult = questions.filter((q: any) => String(q.stem || '').includes('kgimg://')).length
      let imgNeed = Math.ceil(count / 2) - imgInResult
      if (imgNeed > 0 && imgPool.length) {
        try {
          const have = new Set(questions.map((q: any) => String(q.canonicalId || q.id || '')))
          const pool = imgPool.filter(imgPoolFilter)
          // 确定性保证（IMG-04 断言 ≥⌈count/2⌉）：**顺序扫池**而非随机——随机取样有
          // 重复命中 have 集合的浪费，扫不满 imgNeed（实测 4/5 概率缺口）。带图池 1794
          // 条顺序取前 N 条（池本身重建时行序固定 → 轮换语义用层内已去重的 have 过滤）。
          // 每次调用从随机起点开始顺序扫（保持层内多样性的同时扫必达 imgNeed）。
          if (pool.length) {
            const start = Math.floor(Math.random() * pool.length)
            for (let i = 0; i < pool.length && imgNeed > 0; i++) {
              const er = pool[(start + i) % pool.length]
              const cid = String(er.canonical_id)
              if (have.has(cid)) continue
              const q = poolQuestionDetail(db, cid)
              if (q && String(q.stem || '').includes('kgimg://')) { questions.unshift(q); have.add(cid); imgNeed-- }
            }
          }
          // 截断语义修正（R49）：带图补足 unshift 在头部，但截断「保前 count」会把
          // 原 weightedPick 中位于尾部的带图题切掉（实测 5→4 缺口）。正解：**带图稳定分区**
          // ——补足后先按 stem 含 kgimg 分区（带图在前、原相对序不变），再截 count。
          if (questions.length > count) {
            const withImg = questions.filter((q: any) => String(q.stem || '').includes('kgimg://'))
            const without = questions.filter((q: any) => !String(q.stem || '').includes('kgimg://'))
            const merged = [...withImg, ...without].slice(0, count)
            questions.length = 0
            questions.push(...merged)
          }
        } catch { /* 结果层补足失败 → 保留原结果 */ }
      }
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
          // cycle-37 T-033（研究 17 遗留检索质量信号）：纯图源（gk-tuxing）的合成题干
          // 「【图形推理 · cat】出处：…」精确命中查询词 → BM25 排满前列，真实带图题干
          // 被挤出（实测 0/20 带图）。正解 = **合成 stem 排序降级**（CASE 置后，非过滤——
          // 低置信结果不丢弃纪律㉜的推广）；真实题干回归前列（实测 20/20 带图，18.9ms）。
          rows = db.prepare(
            `SELECT q.canonical_id, q.qid, q.source_id, q.module, q.category, q.kadian, q.stem, q.analysis, q.paper, q.region, q.year
             FROM question_fts f JOIN question q ON q.id = f.rowid
             WHERE question_fts MATCH ?
             ORDER BY CASE WHEN q.stem LIKE '【%' THEN 1 ELSE 0 END, bm25(question_fts)
             LIMIT ?`,
          ).all(q, limit * 3)
        }
        if (!rows.length) {
          // cycle-39：LIKE 降级同样要**跨源**——裸 LIMIT 会按 rowid 序被单源占满
          // （实测「和谐」30/30 全 naoku；gwy-zhenti 的 322 条命中在更高 rowid 区间被截断）。
          // 正解：按源 LIMIT 子查询轮转（每源 limit/源数 条），UNION 后仍保相关序不可得
          // （LIKE 无 bm25）——按源序拼接（轮转层会再配额，此处只需保证各源都有候选）。
          try {
            const srcRows = db.prepare('SELECT DISTINCT source_id FROM question').all()
            const per = Math.max(1, Math.ceil((limit * 3) / Math.max(1, srcRows.length)))
            rows = []
            for (const sr of srcRows) {
              const srcId = String(sr.source_id)
              try {
                const part = db.prepare(
                  `SELECT canonical_id, qid, source_id, module, category, kadian, stem, analysis, paper, region, year
                   FROM question WHERE source_id = ? AND (stem LIKE ? OR analysis LIKE ?) LIMIT ?`,
                ).all(srcId, '%' + q + '%', '%' + q + '%', per)
                rows.push(...part)
              } catch { /* 单源失败不阻塞 */ }
            }
          } catch { /* 逐源失败 → 保持空（诚实降级） */ }
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
      // cycle-39（研究 20 §1）：**源多样性轮转**——验收 §11.1「一次查询命中 ≥3 源」。
      // 裸 bm25 会让同卷近似题干霸榜（实测「同比增长」前 10 全 xingce-app，naoku 941 条
      // 命中被挤出）。正解：先按源轮转保底（每源最多 ceil(limit/源数) 条），再把剩余
      // 名额按相关度序填满——跨源对比是统一检索的核心价值，不是副产品。
      const all = [...seen.values()]
      const bySource = new Map<string, any[]>()
      for (const r of all) {
        const k = String((r.sources && r.sources[0] && r.sources[0].source) || 'unknown')
        if (!bySource.has(k)) bySource.set(k, [])
        bySource.get(k)!.push(r)
      }
      const srcKeys = [...bySource.keys()].sort()   // 稳定序（字典序，避免 Map 插入序抖动）
      const quota = Math.max(1, Math.ceil(limit / Math.max(1, srcKeys.length)))
      const pickedIds = new Set<string>()
      const results: any[] = []
      // 第一轮：每源保底 quota 条（源内按相关度原序）
      for (const k of srcKeys) {
        for (const r of bySource.get(k)!.slice(0, quota)) {
          if (results.length >= limit) break
          results.push(r); pickedIds.add(r.canonicalId)
        }
        if (results.length >= limit) break
      }
      // 第二轮：相关度序填满剩余名额
      for (const r of all) {
        if (results.length >= limit) break
        if (!pickedIds.has(r.canonicalId)) { results.push(r); pickedIds.add(r.canonicalId) }
      }
      return { query: q, results, count: results.length, tookMs: Date.now() - t0, engine: q.length >= 3 ? 'fts5-trigram' : 'like-fallback',
        sources: srcKeys,   // 白盒：本次命中的源清单（面板可显示「命中 N 个源」）
        rotation: srcKeys.length > 1 ? 'source-round-robin' : 'single-source' }
    }

    // cycle-40：解析多版本查询（研究 21 纪律③「解析差异必须保留」的可查化）
    if (path === '/api/pool/analysis-versions') {
      const id = params.get('id') || ''
      if (!id) return { error: '缺 id 参数（canonical_id）' }
      const db = requireDb()
      if (!db) return { error: '统一池未就绪（先 POST /api/pool/rebuild）' }
      try {
        const rows = db.prepare(
          `SELECT source_id AS sourceId, local_key AS localKey, analysis, answer, at
           FROM question_analysis WHERE canonical_id = ? ORDER BY at DESC`,
        ).all(id)
        // 展示聚合：同 source+analysis 内容只保留一行（同源不同卷出处的重复解析合并展示，
        // localKeys[] 汇总全部出处——研究 21 纪律②来源全标记在展示层不丢）
        const byContent = new Map<string, any>()
        for (const r of rows) {
          const key = String(r.sourceId) + '|' + String(r.analysis || '')
          if (byContent.has(key)) {
            byContent.get(key).localKeys.push(r.localKey)
          } else {
            byContent.set(key, { sourceId: r.sourceId, localKey: r.localKey, localKeys: [r.localKey], analysis: r.analysis, answer: r.answer, at: r.at })
          }
        }
        const versions = [...byContent.values()]
        return { id, versions, count: versions.length, rawCount: rows.length }
      } catch (e: any) {
        return { error: '查询失败: ' + (e && e.message) }
      }
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
      // cycle-36 O1：relations 的 relTypes/total 与 status 共享同一快照（不再三处重复全算）
      const stats = getCachedStats('poolStats', () => poolStats(db)).data
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
    /* ── POST /api/pool/rebuild（T-032 异步作业化）──
     * 研究 17 O4：全量重建 220-326s 同步阻塞 HTTP——超时风险 + 遥测 p95 被单次长任务
     * 污染（全局 p95=220850ms 全来自它）。正解 = **作业化**（repoManager 同构模式）：
     * 立即返回 jobId，重建在后台跑，`/api/pool/rebuild/status?jobId=` 轮询。
     * 兼容硬约束：`{ async: false }` 保留同步路径（旧客户端/一次性脚本零改动）。 */
    if (path === '/api/pool/rebuild' && method === 'POST') {
      const mode = String((post && post.mode) || 'full')
      const maxFiles = post && post.maxFiles ? parseInt(post.maxFiles) : undefined
      const maxPapers = post && post.maxPapers ? parseInt(post.maxPapers) : undefined
      const asyncMode = !(post && post.async === false)
      if (asyncMode) {
        const jobId = 'pool-rb-' + Date.now().toString(36)
        if (rebuildJobs.has('running') && rebuildJobs.get('running').state === 'running') {
          return { error: '已有重建作业在运行（' + rebuildJobs.get('running').jobId + '），请等待完成或稍后再试' }
        }
        const job: any = { jobId, state: 'running', mode, maxFiles: maxFiles ?? null, maxPapers: maxPapers ?? null, startedAt: Date.now(), finishedAt: 0, result: null, error: null }
        rebuildJobs.set('running', job)
        // 后台执行（fire-and-forget 但内部全捕获——作业状态机是唯一出口，绝不冒泡）
        ;(async () => {
          try {
            const r = mode === 'incremental'
              ? await incrementalRebuild(repoRoot, dataDir)
              : await rebuildPool(repoRoot, dataDir, { rebuild: true, maxFiles, maxPapers })
            job.result = r
            job.state = r && r.ok ? 'done' : 'failed'
            if (r && r.error) job.error = r.error
          } catch (e: any) {
            job.state = 'failed'
            job.error = '重建异常: ' + (e && e.message ? e.message : String(e))
          } finally {
            job.finishedAt = Date.now()
            // 归档（环形 10）——「上次重建是什么结果」在只存当前态的系统里无法回答（教训㊸）
            rebuildHistory.push(job)
            if (rebuildHistory.length > 10) rebuildHistory.shift()
            if (rebuildJobs.get('running') === job) rebuildJobs.delete('running')
          }
        })().catch(() => { /* 双保险：async 内已全捕获，此处永不触发 */ })
        return { ok: true, jobId, state: 'running', mode, poll: '/api/pool/rebuild/status?jobId=' + jobId }
      }
      // 同步路径（兼容保留：{async:false}）
      const r = mode === 'incremental'
        ? await incrementalRebuild(repoRoot, dataDir)
        : await rebuildPool(repoRoot, dataDir, { rebuild: true, maxFiles, maxPapers })
      // 可观测：重建结果附逐阶段诊断（失败时给根因线索，不只说「失败」）
      return { ...r, diagnostics: ingestDiagnostics(r) }
    }

    /* ── GET /api/pool/rebuild/status（作业轮询 + 归档历史）── */
    if (path === '/api/pool/rebuild/status') {
      const jobId = String(params.get('jobId') || '')
      const running = rebuildJobs.get('running')
      if (running && (!jobId || running.jobId === jobId)) {
        return { jobId: running.jobId, state: running.state, mode: running.mode, startedAt: running.startedAt, elapsedMs: Date.now() - running.startedAt }
      }
      if (jobId) {
        const done = rebuildHistory.find(j => j.jobId === jobId)
        if (done) {
          return {
            jobId: done.jobId, state: done.state, mode: done.mode,
            startedAt: done.startedAt, elapsedMs: done.finishedAt - done.startedAt,
            error: done.error,
            // 完成态附摘要（不回带全量 result——诊断走 done.result 的 stats/diagnostics）
            summary: done.result ? { ok: done.result.ok, elapsedMs: done.result.elapsedMs, stats: done.result.stats, diagnostics: ingestDiagnostics(done.result) } : null,
          }
        }
        return { error: '作业不存在或已过归档窗口: ' + jobId, jobs: rebuildHistory.map(j => ({ jobId: j.jobId, state: j.state, mode: j.mode, startedAt: j.startedAt })) }
      }
      // 无参数：返回当前作业 + 归档清单（运维视角：「上次重建是什么结果」）
      return {
        running: running ? { jobId: running.jobId, state: running.state, mode: running.mode, startedAt: running.startedAt, elapsedMs: Date.now() - running.startedAt } : null,
        history: rebuildHistory.map(j => ({ jobId: j.jobId, state: j.state, mode: j.mode, startedAt: j.startedAt, elapsedMs: j.finishedAt - j.startedAt, error: j.error })),
      }
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
        // cycle-36 O1：review 写入也变更数据 → 统计快照失效（口径新鲜）
        invalidateStatsCache('review-write')
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
    const joinWhere = (extra: string): string => {
      // 条件拼接 SSOT：w 与 extra 统一处理（w 空时不能出现 'FROM question AND ...' 语法错）
      if (!extra) return w
      return where.length ? w + ' AND (' + extra + ')' : 'WHERE (' + extra + ')'
    }
    let rows: any[] = []
    try {
      // cycle-38 阶段 2（研究 15 阶段 2）：SELECT 补五维列——练习卡片要贯通
      // 「解题思路/最快解法/易错陷阱/母题思维」（ROADMAP 阶段 2 缺口 ①）
      rows = db.prepare(
        `SELECT canonical_id, qid, source_id, local_key, module, category, kadian, qtype,
           stem, options, answer, analysis, reasoning, fastest, pitfalls, mother, doubt, ask_model,
           group_material, group_material_no,
           images, has_image, paper, region, year, freq
         FROM question ${w} ORDER BY RANDOM() LIMIT ?`,
      ).all(...args, n * 3)
    } catch { return { error: '统一池查询失败' } }
    if (!rows.length) return { error: '统一池内无匹配题（module=' + (module || 'all') + '）' }

    // 优选排序（练习链路体验）：带图 / 带五维标注的题优先——图推与资料分析的
    // 「有图才可作答」「有思路链才有深度」是内容价值，统一池可显式提升。
    // 分层：候选按 (rich=带图∨带五维) → 顺序填充，rich 不足时普通题补足到 n。
    const richScore = (r: any): number => {
      const stem = String(r.stem || '')
      const hasImg = stem.includes('kgimg://') || Number(r.has_image || 0) === 1
      const hasDims = !!(String(r.reasoning || '').trim() || String(r.fastest || '').trim() || String(r.pitfalls || '').trim())
      return (hasImg ? 2 : 0) + (hasDims ? 1 : 0)
    }
    // ── cycle-42 根治（研究 22 §1）：两级**确定性**配额，替代概率性候选窗口 ──
    // 旧设计两层随机漏空：① 候选池 ORDER BY RANDOM() n*3 行——带图 15% 时 18 行候选
    // 可能 0 带图；② 补捞条件 richCount < n/2 又被「带五维但无图」题（5599 条，69%）
    // 占满 rich 名额而跳过——两层概率叠加 = IMG-04 假红 2/8 轮。
    // 正解 = **配额分层直接查**，不经随机窗口：
    //   L1 带图层：stem LIKE kgimg 定向捞 ⌈n/2⌉ 条（池内 1442 条判断推理带图，≥n/2 必有）
    //   L2 五维层：带五维定向捞补足 ⌈n/2⌉ 条
    //   L3 普通层：任意行补足到 n（题量充足）
    // 三层各自 ORDER BY RANDOM()（层内多样性），层间**确定性配额**——抽题结果分布
    // 可预期（带图必有），随机性保留在层内。
    const SELECT_COLS = `canonical_id, qid, source_id, local_key, module, category, kadian, qtype,
      stem, options, answer, analysis, reasoning, fastest, pitfalls, mother, doubt, ask_model,
      group_material, group_material_no,
      images, has_image, paper, region, year, freq`
    const picked: any[] = []
    const seen = new Set<string>()
    const layerQuery = (extraWhere: string, limitN: number): any[] => {
      if (limitN <= 0) return []
      try {
        return db.prepare(
          `SELECT ${SELECT_COLS} FROM question ${joinWhere(extraWhere)} ORDER BY RANDOM() LIMIT ?`,
        ).all(...args, limitN)
      } catch (e: any) {
        console.error('[pool-layer] 层查询失败:', (e && e.message || '').slice(0, 80))
        return []
      }
    }
    const half = Math.ceil(n / 2)
    // L1 带图层（带图题必有配额——IMG-04 断言的确定性保证）
    // ⚠️ R48：去重判据必须用**原始行的 canonical_id**——poolRowToQuestion 返回对象
    // 的字段名是 `id`（练习链路契约），没有 canonicalId 字段；用 q.canonicalId 判重
    // 全是 undefined → seen 集合把不同题当同一题 → L1 只留 1 条（实测 12 轮恒 1）。
    for (const r of layerQuery("stem LIKE '%kgimg://%'", half)) {
      const cid = String(r.canonical_id || '')
      const q = poolRowToQuestion(r)
      if (q && cid && !seen.has(cid)) { picked.push(q); seen.add(cid) }
    }
    // L2 五维层（补足到 n；与 L1 去重）
    const l2Need = n - picked.length
    for (const r of layerQuery('LENGTH(reasoning) > 0', l2Need)) {
      const cid = String(r.canonical_id || '')
      const q = poolRowToQuestion(r)
      if (q && cid && !seen.has(cid) && picked.length < n) { picked.push(q); seen.add(cid) }
    }
    // L3 普通层（兜底到 n；与 L1/L2 去重）
    const l3Need = n - picked.length
    for (const r of layerQuery('', l3Need)) {
      const cid = String(r.canonical_id || '')
      const q = poolRowToQuestion(r)
      if (q && cid && !seen.has(cid) && picked.length < n) { picked.push(q); seen.add(cid) }
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
  // cycle-38 阶段 2：五维标注注入 dims（形状对齐客户端 QwAnswerDims 契约——
  // study-view 的 QwQuestionCard 已消费 q.dims，零客户端改动即贯通）
  const dims: any = {}
  const reasoning = String(r.reasoning || '').trim()
  const fastest = String(r.fastest || '').trim()
  const pitfalls = String(r.pitfalls || '').trim()
  const mother = String(r.mother || '').trim()
  const kadian = String(r.kadian || '').trim()
  const doubt = String(r.doubt || '').trim()
  if (reasoning) dims.reasoning = reasoning
  if (fastest) dims.fastest = fastest
  if (pitfalls) dims.pitfalls = pitfalls
  if (mother) dims.mother = mother
  if (kadian) dims.kadian = kadian
  if (doubt) dims.doubt = doubt
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
    dims: Object.keys(dims).length ? dims : undefined,
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
