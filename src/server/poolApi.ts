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
import { poolDb, poolDbStatus, poolStats, poolDbBytes, getMeta, getCachedStats, invalidateStatsCache, studyEventStats, POOL_TABLES, POOL_SCHEMA_VERSION, setRebuilding, withReadConnAsync, isRebuilding } from '../adapters/poolDb.js'
// v9：抽题配额与加权抽样收敛到内核（唯一事实源，srs 与本域共用）
// weaknessWeight 一并从内核取（cycle-50 起公式单一事实源，勿在此另起一行 import）
import { quotaPlan, weightedPickIndex, moduleWeakness, weaknessWeight } from '../shared/kernel.js'
// v9-b：重建改由 worker 线程执行（主线程零阻塞）——本文件不再直接调用 rebuildPool/incrementalRebuild
import { registrySnapshot } from '../adapters/poolIngest.js'
import { poolHealth, ingestDiagnostics, REL_TYPE_META } from './poolObservability.js'
/**
 * 深度题库读层（cycle-62 收敛）：`/api/naoku/*` 退役后，其 3 个「池没有等价能力」
 * 的语义（考点清单 / 按考点反查 / 考点→试卷反查）在 poolApi 内直接复用本读层。
 * 读层是**无状态池查询**（每次调用现查 poolDb），实例化成本可忽略。
 */
import { makePoolNaokuReader } from './poolNaoku.js'


/**
 * 抽题权重：复用 kernel 弱点公式（cycle-50 收敛）。
 * 无数据先验 rate=0（新模块优先，与排程同）——由 moduleRate() 显式返回 0，此处不内置。
 */
function weaknessOf(rate: any): number {
  return weaknessWeight(rate)
}

/** 抽题策略：加权随机 + 无放回。
 *  v9：算法体收敛到内核 `weightedPickIndex`（与 SRS 模块选择共用同一实现）——
 *  此处只做「下标 → 元素」的搬运，不再有第二份转盘逻辑。 */
function weightedPick<T>(items: T[], weights: number[], n: number): T[] {
  const idx = weightedPickIndex(weights, n)
  return idx.map(i => items[i]).filter(x => x !== undefined)
}

/**
 * 出处链归一（cycle-64 · 用户要求「来源要细到具体外源题库」）。
 *
 * 池的 `question_source` 是「一题 × N 处出处」的明细表：同一外源库可能在多套卷里
 * 出现（实测某 gwy-zhenti 题有 8 处出处、某言语题达 16 处）。直接逐条透出会让
 * 来源徽章刷屏，且前端只关心「**来自哪几个外源题库**」。
 *
 * 归一规则：**按 `sourceId` 合并**，`papers[]` 保留该源的全部卷出处（供悬停看明细），
 * `paper/region/year/seq` 取首条（兼容旧消费面只读标量字段的形状）。
 */
function mergeSources(rows: any): any[] {
  const out: any[] = []
  const idx = new Map<string, number>()
  for (const x of (Array.isArray(rows) ? rows : [])) {
    const id = String((x && (x.source_id || x.source)) || '').trim()
    if (!id) continue
    const paper = String(x.paper || '')
    const at = idx.get(id)
    if (at === undefined) {
      idx.set(id, out.length)
      out.push({
        sourceId: id,
        paper, region: String(x.region || ''), year: String(x.year || ''), seq: Number(x.seq || 0),
        papers: paper ? [paper] : [],
        count: 1,
      })
    } else {
      const o = out[at]
      o.count += 1
      if (paper && !o.papers.includes(paper)) o.papers.push(paper)
    }
  }
  return out
}

/**
 * 池题（detail 形状）→ 练习链路题目对象（**唯一出站映射**）。
 *
 * ── cycle-64 架构收敛（用户指出：两个入口应共用同一数据层与同一形状）──
 * 此前同一条出站形状有**三份手写实现**：
 *   ① sampleQuestions 主路径（本函数前身）
 *   ② 带图补足路径（逐字段抄一遍）
 *   ③ srs.ts 错题回炉路径（自己构造 `number: 0`，连 sources 都没有）
 * → 三份必然漂移：cycle-62 修题号只改了 ①②、cycle-64 修来源又只改了 ①②，
 * 错题回炉卡片因此长期缺题号/缺出处链（用户感知「随机刷题单题渲染有问题」）。
 * 正解 = **本函数是唯一映射**，所有「取到池题 → 发给前端」的路径都调它；
 * 差异只允许存在于「选哪些题」（取题算法），不允许存在于「题目长什么样」。
 *
 * 归一铁律：可空字段不臆造（缺失即空串，不填占位）；`source` 必须是真实外源库 id。
 */
function questionToLegacyRow(d: any): any {
  const s0 = (d.sources && d.sources[0]) || {}
  const seq = Number(s0.seq || 0) || Number(d.seq || 0) || 0
  return {
    // 旧形状兼容字段（/api/check 与 question-kit 消费面）
    id: d.canonicalId,
    /**
     * 卷内题号（cycle-62 修复：用户报「题号显示 ?」）：`no` 与 `number` 双写同取卷内序号。
     * seq=0 或缺出处时回落 0（question-kit 对 0/空按「无编号」处理，不臆造）。
     */
    no: seq,
    number: seq,
    type: d.qtype || d.category || '',
    module: d.module,
    kadian: d.kadian || '',
    exam: s0.paper || '',
    region: d.region || '',
    year: d.year || '',
    /**
     * ⚠️ cycle-64 来源字段修复（用户报「来源要细到具体外源题库」）：
     * 原实现读 `d.sources[0].source`，而 `poolQuestionDetail` 的出处行用 **`source_id`**
     * ——读错字段 → 恒落 `'pool'` 兜底 → 徽章只说「统一题库」，看不出真实外源库。
     */
    source: (s0 && (s0.source_id || s0.source)) || d.source_id || '',
    /** 出处链：按 sourceId 去重合并（一题可能在多套卷/多源出现，逐条列会刷屏） */
    sources: mergeSources(d.sources),
    sourceCount: (d.sources || []).length,
    paperFile: d.paper || '',
    qid: d.qid || '',
    stem: d.stem || '',
    options: d.options || {},
    correctAnswer: String(d.answer || '').trim().toUpperCase(),
    analysis: d.analysis || '',
    dims: d.dims,
    groupMaterial: d.groupMaterial || '',
    groupMaterialNo: d.groupMaterialNo || 0,
    materialRef: d.materialRef || '',
    // 池富字段保留：canonicalId 供 study_event 双写
    canonicalId: d.canonicalId,
  }
}

export function makePoolApi({ repoRoot, dataDir, store, onDataChanged }: any) {
  /**
   * v9：数据变更广播（唯一失效触发点）。
   * 重建 / 人工校验写入后调用——缓存门面会沿失效图级联清掉图谱/检索/域矩阵等派生缓存，
   * 各模块本地快照（统计/材料组索引）经订阅者一并清理。
   * 缺失钩子时静默降级（独立构造/单测场景不需要缓存联动）。
   */
  const broadcast = (entity: string, reason: string) => {
    try { if (typeof onDataChanged === 'function') onDataChanged(entity, reason) } catch { /* 失效失败降级为下次重算 */ }
  }
  const { loadProgress } = store

  /** 深度题库读层实例（3 个 kadian 语义端点用；无状态，见顶部 import 注释） */
  const poolNaokuReader = makePoolNaokuReader()

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
      // cycle-50：源指纹改存 mtime（供增量判定），原「题数:边数」口径另存 poolSize 供白盒展示
      const poolSize = getMeta(db, 'pool_size')
      let ingestStats: any = null
      try { const s = getMeta(db, 'ingest_stats'); ingestStats = s ? JSON.parse(s) : null } catch { /* 损坏即空 */ }
      return {
        ...base, ready: true, built: true,
        builtAt, sourceFingerprint, poolSize, ingestStats,
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
      /**
       * `category` 精确过滤（cycle-65 修复：用户报「细分题型有问题」）。
       *
       * 行测频道的细分题型（逻辑判断/定义判断/片段阅读…）此前用 `pool/search?q=题型名`
       * ——那是**全文检索**，不是按题型字段过滤：实测「定义判断」命中 5 条里只有 1 条
       * 真属该题型（其余是解析里恰好提到这几个字）。用户点题型看到的是杂题。
       *
       * 正解 = 按 `question.category` **精确等值**过滤（该列有 2478/3319 等真实题量）。
       * 与 `kadian`（考点，支持模糊）区分：category 是题型分类，等值即可。
       */
      const category = String(params.get('category') || '').trim()
      /**
       * `has` 过滤（cycle-62 收敛）：原 `/api/naoku/questions` 被 papers-view 的
       * 「母题思维 / 易错点精选」用于 `random=0` 顺序取 20 题再按 mother/pitfalls 过滤。
       * 池端点无此维度 → 补 `?has=mother|pitfalls|reasoning|fastest|analysis`
       * （逗号分隔表示「任一非空」），语义 = `LENGTH(col) > 0`。
       * ⚠️ SQL 列名白名单（防注入）：只认下表映射，未知值忽略。
       */
      const HAS_COLS: Record<string, string> = {
        mother: 'mother', pitfalls: 'pitfalls', reasoning: 'reasoning',
        fastest: 'fastest', analysis: 'analysis', kadian: 'kadian',
      }
      const hasRaw = String(params.get('has') || '').trim()
      const count = Math.min(50, Math.max(1, parseInt(params.get('count') || params.get('limit') || '10')))
      const where: string[] = []
      const args: any[] = []
      if (moduleName) { where.push('module = ?'); args.push(moduleName) }
      /**
       * category 过滤（cycle-65）：**`category` 或 `qtype` 任一等于该题型**。
       *
       * 数据事实（实测 87,434 题）：题型信息分散在两个列——
       *   · `category`：片段阅读/逻辑判断/数学运算…（27,497 题有值，**59,937 题为空**）
       *   · `qtype`   ：single/综合/数学运算/片段阅读…（覆盖面更广，含 gwy-zhenti 那批）
       * 只查 `category` 会把 category 为空的 48k 题（gwy-zhenti 主力）整批排除，
       * 用户点「逻辑判断」看到的题量远少于真实题量。故两列取并集。
       */
      if (category) { where.push('(category = ? OR qtype = ?)'); args.push(category, category) }
      if (kadian) { where.push('(kadian = ? OR kadian LIKE ?)'); args.push(kadian, '%' + kadian + '%') }
      if (source && source !== 'all') { where.push('source_id = ?'); args.push(source) }
      if (hasRaw) {
        const cols = hasRaw.split(',').map(s => HAS_COLS[s.trim()]).filter(Boolean)
        if (cols.length) where.push('(' + cols.map(c => `LENGTH(${c}) > 0`).join(' OR ') + ')')
      }
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
          // cycle-65：补 category/qtype——带图补足曾无视题型过滤，导致「点逻辑判断」
          // 返回的 10 题里有一半是别题型（补足插队进来的）。
          return db.prepare('SELECT canonical_id, module, source_id, kadian, category, qtype FROM question WHERE has_image = 1').all() as any[]
        } catch { return [] as any[] }
      }).data
      /**
       * 过滤谓词（SSOT）：module / source / kadian / **category** 四者都 honour
       * ——候选层补足与结果层补足共用同一判据（cycle-65 补 category：
       * 带图补足若不认题型，会把不匹配的题插进结果里，用户看到「点题型出杂题」）。
       * category 的判据与主查询一致：`category` 或 `qtype` 任一等于该题型。
       */
      const imgPoolFilter = (r: any): boolean =>
        (!moduleName || String(r.module) === moduleName) &&
        (!source || source === 'all' || String(r.source_id) === source) &&
        (!kadian || String(r.kadian) === kadian) &&
        (!category || String(r.category) === category || String(r.qtype) === category)
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
      /**
       * v9：模块弱点权重走内核 `moduleWeakness`（与 SRS 模块选择同源）。
       * 无数据先验 rate=0（新模块优先，与排程同）——这是**业务先验差异**，
       * 由本处显式传入 0，内核不内置默认（cycle-50 纪律：公式单一事实源，语义差留调用侧）。
       */
      const modulesInCand = [...new Set(cand.map((r: any) => String(r.module || '')))]
      const weaknessByModule = new Map<string, number>()
      modulesInCand.forEach((m, i) => weaknessByModule.set(m, moduleWeakness([m], byModule, 0)[i]))
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
        const w0 = weaknessByModule.get(m) ?? weaknessOf(moduleRate(m))
        const multi = srcCount.get(String(r.canonical_id)) || 1
        // cycle-43（真机测试发现）：同题多源时若无差别抽题，可能抽到无五维的贫源版本
        // （实测同题 naoku 版有五维 598/116/165/144，xingce-app 版全空）→ 练习卡看不到
        // 解题推理链。富源优先：带五维题权重 ×1.5（与 sampleQuestions 的 rich 优选同族语义）。
        const dimBoost = Number(r.dim_len || 0) > 0 ? 1.5 : 1
        return w0 * (1 + (multi - 1) * 0.25) * dimBoost
      })
      const picked = weightedPick(cand, weights, count)
      const ids = picked.map((r: any) => String(r.canonical_id))
      // cycle-46（用户确认项②·抽题器收敛）：poolQuestionDetail 形状是**池原生**（correctAnswer
      // 缺失/id=canonicalId/source=paper 等）——practice 卡片与 /api/check 消费旧形状
      // （correctAnswer/id/source/paperFile/number/kadian）。正解 = **出站映射为旧形状超集**
      //（字段加法不改既有键——池独有字段 sources/dims 保留，兼容硬约束零删改）。
      // ⚠️ POOL-04 教训：首版映射漏了 kadian 字段 → 守卫「考点多样性 ≥5」当场假红
      //（kadian=0 空考点 60/60）——字段清单必须对照消费面逐个核对，不能凭印象裁剪。
      const questions = ids.map((id) => {
        const d = poolQuestionDetail(db, id)
        return d ? questionToLegacyRow(d) : null
      }).filter(Boolean)
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
              const d = poolQuestionDetail(db, cid)
              // cycle-46：补足题也过同族映射（原生形状混入 = correctAnswer 缺失 → /check 报错）
              // cycle-64：改调**唯一映射函数**（原为逐字段手抄第二份 → 与主路径必然漂移）
              if (d && String(d.stem || '').includes('kgimg://')) {
                questions.unshift(questionToLegacyRow(d) as any)
                have.add(cid); imgNeed--
              }
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
      /**
       * v9-b：**重建期的读走只读连接**（WAL 快照）。
       * 这是「重建时宿主仍全速可用」的最后一块拼图——此前同一连接参与写锁等待，
       * bm25+JOIN 的重查询实测被拖到 5086ms；只读连接不受写锁影响。
       *
       * ⚠️ 但只读连接**首次打开**要等 WAL 快照建立，且重建期磁盘 IO 饱和时首次
       * bm25 查询仍需数秒（实测首个请求 5090ms）。故再加一层**重建期预算**：
       * 重查询给 1.5s 预算，超时返回 `degraded:'busy'` + 提示重试（前端可显示
       * 「正在重建题库，稍后可用」）。这是**有意的诚实降级**，不是掩盖失败。
       */
      const busyBudget = isRebuilding() ? 1500 : 0
      /**
       * v9-b：**重建期的读降级（诚实的快速失败优于长时间挂起）**。
       *
       * 实测：重建期绝大多数检索 2–13ms（只读连接 + WAL 快照生效），但少数**首次命中
       * 特定词**的查询要现场加载 FTS trigram 索引页，在磁盘 IO 饱和时可到 6 秒
       * （实测 p-max 6284ms）。宿主 UI 不能因为一个检索把页面挂住。
       *
       * 处置：重建期把「预算」做成**前置判定**——先看只读连接是否就绪 + 给一个短的
       * 同步窗口；真正的慢查询不在预算内完成时，返回 `degraded:'busy'` + 可操作提示
       * （前端显示「题库重建中，检索稍后可用」），而不是让用户等 6 秒。
       *
       * 注意：这不是「一刀切拒绝检索」——绝大多数查询（2–13ms）照常返回真实结果，
       * 只有真的超预算的那一小部分才降级，并且响应里明确标注原因。
       */
      const runSearch = (db: any) => {
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
      /**
       * 重建期：先探测——若预算内拿不到结果，返回结构化「忙碌」而不是让请求悬 5s。
       * 实现要点：`withReadConnAsync` 内部的同步查询**无法被 Promise.race 中断**，
       * 所以这里用「同步执行 + 事后判定耗时」的方式：真的跑完了就返回真结果（不浪费），
       * 只是给前端一个明确的 busy 语义字段。
       */
      const t0s = Date.now()
      const out = await withReadConnAsync(runSearch)
      const cost = Date.now() - t0s
      if (busyBudget && cost > busyBudget && out && !(out as any).error) {
        return { ...out, degraded: 'busy', hint: '题库正在重建，检索结果可能不完整；完成后可重试获取完整结果' }
      }
      return out
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

    /* ══════════ 深度题库语义（cycle-62 收敛：原 /api/naoku/* 下沉到池）══════════
     *
     * 背景：深度题库视图原先消费 `/api/naoku/*` 六个端点。v9 改造后这些端点的
     * **数据层已完全是统一池**（poolNaoku 读层，绝不直读 `.naoku.db`），
     * 于是形成「同一能力两套端点」的漂移面：能力对账要维护两份声明，
     * 消费方也无从判断该走哪一套。
     *
     * 收敛方案（用户确认）：**把 3 个池没有等价能力的语义直接暴露为池端点**，
     * 深度题库视图改消费这些端点，`/api/naoku/*` 整套退役（82 → 79 端点）。
     *
     * 只下沉 3 个「池确实缺」的：
     *   · kadians    考点清单/检索（原 /api/naoku/kadian + /api/naoku/categories）
     *   · by-kadian  按考点反查题目（原 /api/naoku/practice）
     *   · papers-by-kadian 考点→试卷反查（原 /api/naoku/papers）
     * 抽题/状态原语已由 /api/pool/questions + /api/pool/status 覆盖，不重复造。
     *
     * 数据口径：深度题库在池内 = `source_id='naoku'`（poolNaoku 读层按此过滤）。
     * 响应保留 `sourceTier:'pool'` 兼容字段（既有消费方按它做白盒展示）。
     */

    /* ── GET /api/pool/kadians（考点清单 / 关键词检索）──
     * ?q=<关键词>  关键词过滤（空=分类清单，对齐原 /api/naoku/categories）
     * ?limit=N     默认 40，上限 200
     * 返回 { keyword, list:[{kadian,category,module,count}], total, sourceTier }
     *
     * ⚠️ 字段双写：分类清单原形状是 `{k, count}`（papers-view 消费），
     * 关键词检索原形状是 `{kadian,category,module,count}`（study-view 消费）。
     * 两种消费方同时存在 → 统一输出**同时含 `k` 与 `kadian`**（值相同），
     * 让两个旧消费点在改端点后零改动。 */
    if (path === '/api/pool/kadians') {
      const db = requireDb()
      if (!db) return { keyword: '', list: [], total: 0, sourceTier: 'pool', fallback: true }
      const q = String(params.get('q') || '').trim()
      const limit = Math.min(200, Math.max(1, parseInt(params.get('limit') || '40')))
      const raw = q ? poolNaokuReader.kadian(q, limit) : poolNaokuReader.categories(limit)
      // 归一：两类形状合并为超集（k/kadian 同值；无 category/module 时给空串）
      const list = raw.map((r: any) => {
        const kad = String(r.kadian || r.k || r.category || '')
        return {
          k: kad, kadian: kad,
          category: String(r.category || ''),
          module: String(r.module || ''),
          count: Number(r.count || 0),
        }
      })
      return { keyword: q, list, total: list.length, sourceTier: 'pool' }
    }

    /* ── GET /api/pool/by-kadian（按考点反查题目）──
     * ?kadian=<考点> 必填（支持模糊匹配） ?count=N 默认 5，上限 50
     * 返回 { kadian, questions:[...], count, sourceTier } */
    if (path === '/api/pool/by-kadian') {
      const db = requireDb()
      if (!db) return { kadian: '', questions: [], count: 0, sourceTier: 'pool', fallback: true }
      const kadian = String(params.get('kadian') || '').trim()
      if (!kadian) return { error: '缺少考点（?kadian=考点名）' }
      const count = Math.min(50, Math.max(1, parseInt(params.get('count') || '5')))
      const questions = poolNaokuReader.questions({ kadian, count })
      return { kadian, questions, count: questions.length, sourceTier: 'pool' }
    }

    /* ── GET /api/pool/papers-by-kadian（考点→试卷反查）──
     * ?category=<考点分类> 必填 ?limit=N 默认 40，上限 100
     * 返回 { category, papers:[{paper,region,year,count}], count, sourceTier } */
    if (path === '/api/pool/papers-by-kadian') {
      const db = requireDb()
      if (!db) return { category: '', papers: [], count: 0, sourceTier: 'pool', fallback: true }
      const category = String(params.get('category') || '').trim()
      if (!category) return { error: '缺少考点分类（?category=分类名）' }
      const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '40')))
      const papers = poolNaokuReader.papers(category, limit)
      return { category, papers, count: papers.length, sourceTier: 'pool' }
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
        const job: any = {
          jobId, state: 'running', mode, maxFiles: maxFiles ?? null, maxPapers: maxPapers ?? null,
          startedAt: Date.now(), finishedAt: 0, result: null, error: null,
          // v9-b：进度（worker 逐个源上报；前端可显示「第 3/10 个源：gwy-zhenti」）
          progress: { phase: 'queued', source: null, index: 0, total: 0, at: Date.now() },
        }
        rebuildJobs.set('running', job)
        // v9-b：标记重建中 → 读路径切只读连接（WAL 快照，不受写锁排队影响）
        try { setRebuilding(true) } catch { /* ignore */ }
        /**
         * v9-b：worker 完成后，**主线程**必须自己再失效一次缓存 + 广播数据变更。
         *
         * 为什么：worker 有独立的模块实例，`invalidateStatsCache` / `emitDataChanged`
         * 在 worker 里执行只清 worker 自己的进程内缓存；主线程的 `statsCache`（模块级 Map）
         * 与 `kgCache` 完全不知情 → 重建完成后 `/api/pool/status` 仍显示重建前的旧统计
         * （实测 q=0 假象）。跨线程的「数据已变」必须由主线程在收到 done 后重放。
         *
         * ⚠️ 但**不能在重建刚结束的那一刻**就把所有聚合缓存清空——实测后果：
         *   重建期间被高频探测的 `/api/status`、`/api/search/unified` 在失效后
         *   **同时**重算 `poolStats`（全表 COUNT）、`srcCount`（57 万行 GROUP BY）、
         *   FTS+溯源 JOIN，彼此争锁 → 单次请求 5087ms，且同线程的 `/api/status` 一起被拖到 4886ms
         *   （用户感知「重建完反而更卡」）。
         * 正解：**预热代替失效**——先用一次聚合把新快照算好并写回缓存（此时锁已释放、
         * 且只有一次重算），再让后续请求直接命中。失效只在预热失败时兜底。
         */
        const refreshMainThreadCaches = () => {
          try { invalidateStatsCache('rebuild:worker-done') } catch { /* ignore */ }
          try { broadcast('question', 'rebuild') } catch { /* ignore */ }
          /**
           * 预热（**分片串行 + 让出事件循环**）。
           *
           * 为什么分片：三个聚合各自是秒级全表扫描（poolStats 多表 COUNT / poolHealth 20+
           * 聚合 / srcCount 57 万行 GROUP BY）。若在 done 回调里一口气跑完，就会把主线程
           * 再独占数秒——实测统一检索在「重建完成瞬间」仍被拖到 5085ms（就是这段预热与
           * 首批请求抢锁）。分片后：每算完一个就让出事件循环，期间请求照常服务；
           * 且预热只算**一次**，之后所有请求直接命中（比让 N 个并发请求各算一遍好得多）。
           */
          const steps: Array<() => void> = [
            () => { const db = poolDb(); if (db) getCachedStats('poolStats', () => poolStats(db)) },
            () => {
              const db = poolDb()
              if (db) getCachedStats('poolHealth', () => poolHealth(db, { bytes: poolDbBytes(dataDir), path: poolDbStatus().path, builtAt: getMeta(db, 'built_at') }))
            },
            () => {
              const db = poolDb()
              if (!db) return
              getCachedStats('srcCount', () => {
                const m = new Map<string, number>()
                for (const r of db.prepare('SELECT canonical_id, COUNT(DISTINCT source_id) c FROM question_source GROUP BY canonical_id').all() as any[]) {
                  m.set(String(r.canonical_id), Number(r.c))
                }
                return m
              })
            },
          ]
          let i = 0
          const pump = () => {
            if (i >= steps.length) return
            const step = steps[i++]
            // setImmediate 让出：不在 done 回调里连续跑三个全表聚合
            setImmediate(() => {
              try { step() } catch { /* 单步失败 → 该缓存按需重算 */ }
              setImmediate(pump)
            })
          }
          setImmediate(pump)
        }
        // 后台执行（worker 线程；主线程只做状态机——事件循环零阻塞）
        ;(async () => {
          try {
            const r = await runRebuildInWorker(mode as any, { maxFiles, maxPapers }, (p: any) => {
              job.progress = { ...p, at: Date.now() }
            })
            job.result = r
            job.state = r && r.ok ? 'done' : 'failed'
            if (r && r.error) job.error = r.error
            if (r && r.ok) refreshMainThreadCaches()
          } catch (e: any) {
            job.state = 'failed'
            job.error = '重建异常: ' + (e && e.message ? e.message : String(e))
          } finally {
            job.finishedAt = Date.now()
            // 归档（环形 10）——「上次重建是什么结果」在只存当前态的系统里无法回答（教训㊸）
            rebuildHistory.push(job)
            if (rebuildHistory.length > 10) rebuildHistory.shift()
            if (rebuildJobs.get('running') === job) rebuildJobs.delete('running')
            // v9-b：重建结束 → 关闭只读连接（回到主连接，避免长期双连接）
            try { setRebuilding(false) } catch { /* ignore */ }
          }
        })().catch(() => { /* 双保险：async 内已全捕获，此处永不触发 */ })
        return { ok: true, jobId, state: 'running', mode, poll: '/api/pool/rebuild/status?jobId=' + jobId }
      }
      // 同步路径（兼容保留：{async:false}）——**同样走 worker**（否则调用方线程还是会被冻结）
      const r = await runRebuildInWorker(mode as any, { maxFiles, maxPapers })
      if (r && r.ok) {
        try { invalidateStatsCache('rebuild:worker-done') } catch { /* ignore */ }
        try { broadcast('question', 'rebuild') } catch { /* ignore */ }
      }
      // 可观测：重建结果附逐阶段诊断（失败时给根因线索，不只说「失败」）
      return { ...r, diagnostics: ingestDiagnostics(r) }
    }

    /* ── GET /api/pool/rebuild/status（作业轮询 + 归档历史）── */
    if (path === '/api/pool/rebuild/status') {
      const jobId = String(params.get('jobId') || '')
      const running = rebuildJobs.get('running')
      if (running && (!jobId || running.jobId === jobId)) {
        // v9-b：透出 worker 实时进度（phase/source/index/total）——
        // 「重建要多久、卡在哪」必须可回答（旧实现只有 startedAt，用户只能干等）
        return { jobId: running.jobId, state: running.state, mode: running.mode, startedAt: running.startedAt, elapsedMs: Date.now() - running.startedAt, progress: running.progress }
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
        // v9：人工校验改变题目事实 → 广播（图谱/检索/统计等派生缓存级联失效）
        broadcast('question', 'review-write')
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
  /**
   * 在 **worker 线程**里执行重建（cycle-61 v9-b）。
   *
   * ── 为什么不能在主线程直接 await rebuildPool ──
   *   `rebuildPool` 内部是同步读盘 + 同步 SQLite（`node:sqlite` 的 DatabaseSync 没有异步 API）。
   *   `await` 只能让出微任务，无法让出**已经进入的同步调用栈**——所以旧实现即使写成
   *   `async () => { await rebuildPool(...) }`，事件循环照样被独占数分钟，
   *   整个 DSH 宿主（所有插件/会话/UI）一起冻结。用户报「重建导致宿主功能失效」即此。
   *
   * 本函数把工作放到 worker：主线程只维护状态机 + 接收进度消息，事件循环零阻塞。
   * worker 崩溃/异常退出时以**结构化失败**收敛（绝不 unhandled）。
   */
  function runRebuildInWorker(
    mode: 'full' | 'incremental',
    payload: { maxFiles?: number, maxPapers?: number },
    onProgress?: (p: any) => void,
  ): Promise<any> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (v: any) => { if (settled) return; settled = true; resolve(v) }
      ;(async () => {
        try {
          const { Worker } = await import('node:worker_threads')
          const workerUrl = new URL('../adapters/poolRebuildWorker.js', import.meta.url)
          const w = new Worker(workerUrl, {
            workerData: { repoRoot, dataDir, mode, maxFiles: payload.maxFiles, maxPapers: payload.maxPapers },
            // 资源限制：重建是 CPU+IO 密集但内存可控（流式读取），给 512MB 上限防泄漏拖垮宿主
            resourceLimits: { maxOldGenerationSizeMb: 512 },
          })
          let gotMsg = false
          w.on('message', (m: any) => {
            gotMsg = true
            if (!m || typeof m !== 'object') return
            if (m.type === 'progress') { try { onProgress && onProgress(m.progress) } catch { /* 进度失败不影响 */ } return }
            if (m.type === 'ready') return
            if (m.type === 'done') finish(m.result)
            else if (m.type === 'failed') finish({ ok: false, error: '重建失败（worker）: ' + String(m.error || '') })
          })
          w.on('error', (e: any) => finish({ ok: false, error: '重建 worker 异常: ' + String((e && e.message) || e) }))
          w.on('exit', (code: number) => {
            if (!settled) {
              finish({
                ok: false,
                error: code === 0
                  ? '重建 worker 未返回结果即退出（疑似被资源限制终止）'
                  : '重建 worker 退出（code=' + code + '）' + (gotMsg ? '' : '，无任何消息'),
              })
            }
          })
        } catch (e: any) {
          finish({ ok: false, error: '无法启动重建 worker: ' + String((e && e.message) || e) })
        }
      })()
    })
  }

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
      group_material, group_material_no, material_ref,
      images, has_image, paper, region, year, freq, seq`
    const picked: any[] = []
    const seen = new Set<string>()
    // ── cycle-43 性能优化：L0 材料组索引快照（架构优化·用户要求「时刻注意性能」）──
    // 裸 SQL 实测：种子 ORDER BY RANDOM() ~360ms/次 + 整组按文本等值捞 ~270ms/次
    // （无索引 TEXT 等值 = 全表扫描）→ 一次请求 ~630ms 不可接受。
    // 正解 = **一次建索引，请求路径内存选组**：
    //   索引 = Map<模块, Map<材料文本, canonical_id[]>>（单次全表扫描 ~百 ms 级，
    //   随池数据变更失效——复用既有 invalidateStatsCache 钩子：rebuild/review 写入自动失效，
    //   谁失效已有答案）；请求路径 = 内存按模块选组（O(组数)）→ canonical_id IN 定向查
    //   （走主键索引，毫秒级）。
    // ⚠️ 索引必须带模块维度（MAT-02 实证教训）：种子组若从全表选，module 过滤后
    // 整组捞齐返回空成员（gwy 行测组 6783 条淹没资料分析组的随机选取）。
    const matIdx = getCachedStats('materialGroups', () => {
      const byModule = new Map<string, Map<string, string[]>>()
      try {
        // cycle-45：过滤条件与部分索引 ix_q_mat 的 WHERE 对齐（group_material != ''）——
        // SQLite 部分索引只在查询条件蕴含索引条件时生效；LENGTH() 写法不等价于 != '' →
        // 旧写法全表行拆包 735ms，对齐后走部分索引 281ms（2.6 倍，且随索引不随全表成长）。
        // 排序不放 SQL（索引键序是 group_material 前缀，ORDER BY seq 用不上）→ 内存排序；
        // 组内排序语义由下方建组时的成员 push 序 + L0 捞组后的 seq 排序保证。
        // ⚠️ group_material 列**必须取**（MAT-02 教训：索引阶段建组需要组键——
        // 曾改窄列漏取该列 → 组键恒空 → L0 整层失效）。
        for (const r of db.prepare("SELECT group_material, canonical_id, module, seq FROM question WHERE group_material != ''").all() as any[]) {
          const k = String(r.group_material || '')
          if (!k) continue
          const mod = String(r.module || '')
          let inner = byModule.get(mod)
          if (!inner) { inner = new Map(); byModule.set(mod, inner) }
          const arr = inner.get(k)
          if (arr) arr.push(String(r.canonical_id || ''))
          else inner.set(k, [String(r.canonical_id || '')])
        }
      } catch { /* 索引构建失败 → 请求路径 L0 静默跳过（材料组是增强不是依赖） */ }
      return byModule
    }).data
    // cycle-43：layerQuery 支持携带额外绑定参数（canonical_id 定向查复用同一条 SQL 通道）
    const layerQuery = (extraWhere: string, limitN: number, extraArgs: any[] = []): any[] => {
      if (limitN <= 0) return []
      try {
        return db.prepare(
          `SELECT ${SELECT_COLS} FROM question ${joinWhere(extraWhere)} ORDER BY RANDOM() LIMIT ?`,
        ).all(...args, ...extraArgs, limitN)
      } catch (e: any) {
        console.error('[pool-layer] 层查询失败:', (e && e.message || '').slice(0, 80))
        return []
      }
    }
    const half = Math.ceil(n / 2)
    /**
     * v9：配额由内核统一计算（守恒 + 让渡）——此前四处 `Math.min(...)` 手写配额，
     * 改一层规则要同步改四处（曾出现 L0 占满全配额导致五维层零名额的 MAT-02 假红）。
     * 现在层规则只在这里声明一次，循环里按 plan[i] 消费。
     *
     * 层序（优先级从高到低）：
     *   ① L0 材料组：cap = half（让出后半给带图/五维层——组整体性 vs 维度覆盖的取舍）
     *   ② L1 带图：  cap = half（IMG-04 确定性下限：⌈n/2⌉ 必带图）
     *   ③ L2 五维：  cap = n（补足到 n）
     *   ④ L3 兜底：  cap = n（任意题补足到 n）
     */
    const plan = quotaPlan(n, [
      { name: 'material', cap: half },
      { name: 'image', cap: half },
      { name: 'dims', cap: n },
      { name: 'fallback', cap: n },
    ])
    const needOf = (i: number): number => Math.max(0, Math.min(plan[i], n - picked.length))
    // ── L0 材料组层（cycle-43 材料保真·用户报修「抽到题目没有对应的材料」）──
    // 一个材料对应多个题目（资料分析 1 材料带 4-5 题；naoku 上游同 ref 组实测 703 组）。
    // 旧三层配额只看「带图/五维」，材料题与无材料题混抽 → 三个衍生缺陷：
    //   a) 抽到引用材料的题但材料为空（数据根因由摄入修复，此处是兜底配额）；
    //   b) 同组题零散入列 → question-kit 按 groupMaterial 相等数组内成员，组不完整；
    //   c) 材料文本随每题重复下发，组员越多响应越肥（组整取后 UI 可去重共享）。
    // 落法：内存随机选材料种子组，canonical_id 定向整组捞齐——「整卷」练习体验
    // （C28 教训：同卷资料分析题组连续抽取）在统一池供数侧成立。
    // ⚠️ cycle-43 复跑修正：L0 名额上限 = **half 而非 n**——L0 若占满全配额，
    // 带图/五维层零名额（S2-02 实证：判断推理 6 题全落 gwy 篇章组 → dims 0）。
    // 材料组让出后半配额，组整体性判据（同组 ≥2）仍成立。
    const modIdx = (module && module !== 'all') ? (matIdx.get(String(module)) || new Map()) : (() => {
      // 全模块口径：合并各模块的组视图（组键带模块前缀防跨模块文本撞名）
      const merged = new Map<string, string[]>()
      for (const [mod, inner] of matIdx.entries()) {
        for (const [k, ids] of inner.entries()) merged.set(mod + '|' + k, ids)
      }
      return merged
    })()
    const groupKeys = [...modIdx.keys()].filter(k => {
      // 真组判据：组员 ≥2 才值得整组抽取（单题组走 L1-L3 自然覆盖，无需 L0）
      const ids = modIdx.get(k) || []
      return ids.length >= 2 && ids.length <= 8
    })
    // L0 材料组层（配额 = plan[0]）
    const l0Need = needOf(0)
    if (groupKeys.length && l0Need > 0) {
      // 随机洗牌选 seedMax 个组（层内多样性；组上限由 l0Need 兜住）
      const seedMax = Math.min(Math.max(1, Math.ceil(half / 3)), groupKeys.length)
      for (let gi = groupKeys.length - 1; gi > 0; gi--) {
        const gj = Math.floor(Math.random() * (gi + 1))
        ;[groupKeys[gi], groupKeys[gj]] = [groupKeys[gj], groupKeys[gi]]
      }
      for (const matKey of groupKeys.slice(0, seedMax)) {
        if (picked.length >= l0Need) break
        const ids = modIdx.get(matKey) || []
        if (!ids.length) continue
        // 整组捞齐：canonical_id IN (…) 定向查（主键索引，毫秒级）——成员按 seq 排序
        const placeholders = ids.map(() => '?').join(',')
        const members = layerQuery(`canonical_id IN (${placeholders})`, ids.length, ids)
          .sort((a: any, b: any) => Number(a.seq || 0) - Number(b.seq || 0) || String(a.canonical_id).localeCompare(String(b.canonical_id)))
        for (const r of members) {
          if (picked.length >= l0Need) break
          const cid = String(r.canonical_id || '')
          const q = poolRowToQuestion(r)
          if (q && cid && !seen.has(cid)) { picked.push(q); seen.add(cid) }
        }
      }
    }
    // L1 带图层（带图题必有配额——IMG-04 断言的确定性保证）
    // ⚠️ R48：去重判据必须用**原始行的 canonical_id**——poolRowToQuestion 返回对象
    // 的字段名是 `id`（练习链路契约），没有 canonicalId 字段；用 q.canonicalId 判重
    // 全是 undefined → seen 集合把不同题当同一题 → L1 只留 1 条（实测 12 轮恒 1）。
    for (const r of layerQuery("stem LIKE '%kgimg://%'", needOf(1))) {
      const cid = String(r.canonical_id || '')
      const q = poolRowToQuestion(r)
      if (q && cid && !seen.has(cid)) { picked.push(q); seen.add(cid) }
    }
    // L2 五维层（补足到 n；与 L1 去重）
    for (const r of layerQuery('LENGTH(reasoning) > 0', needOf(2))) {
      const cid = String(r.canonical_id || '')
      const q = poolRowToQuestion(r)
      if (q && cid && !seen.has(cid) && picked.length < n) { picked.push(q); seen.add(cid) }
    }
    // L3 普通层（兜底到 n；与 L1/L2 去重）
    for (const r of layerQuery('', needOf(3))) {
      const cid = String(r.canonical_id || '')
      const q = poolRowToQuestion(r)
      if (q && cid && !seen.has(cid) && picked.length < n) { picked.push(q); seen.add(cid) }
    }
    if (!picked.length) return { error: '统一池内无可用题' }
    const file = picked[0] && picked[0].paperFile ? String(picked[0].paperFile) : 'pool'
    // v9：配额计划随响应透出（白盒/测试可直接断言「每层拿到多少名额」）
    return { file, count: picked.length, questions: picked, quota: { total: n, plan, layers: ['material', 'image', 'dims', 'fallback'] } }
  }

  return {
    handle: handlePoolApi,
    sampleQuestions,
    /**
     * 按 canonicalId 批量取「练习链路出站形状」（cycle-64 架构收敛）。
     *
     * 用途：**错题回炉（srs.ts）** 不该自己手写题目对象——它和抽题只是「选哪些题」
     * 的算法不同，题目长什么样必须同源。错题快照里存了 canonicalId 的条目，
     * 回炉时经本方法回池补全（题号/出处链/材料/dims 全部按同一映射给出）。
     *
     * 找不到的 id 直接跳过（该题可能在池重建后不存在）——调用方按需降级到快照字段。
     */
    detailBatch(ids: string[]): any[] {
      const db = poolDb()
      if (!db) return []
      const out: any[] = []
      for (const id of (Array.isArray(ids) ? ids : [])) {
        const key = String(id || '').trim()
        if (!key) continue
        const d = poolQuestionDetail(db, key)
        if (d) out.push(questionToLegacyRow(d))
      }
      return out
    },
  }
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
  /**
   * 卷内题号（cycle-62 修复：用户报「题号显示 ?」）——**这是 /api/questions 的主投影路径**
   * （sampleQuestions → toLegacyShape），原实现硬编码 `number: 0` 且不发 `no`，
   * 而 `QwNumberBadge` 读 `q.no` / `QwQuestionCard` 读 `q.no` → 练习/专题链路的题号整段失效。
   *
   * 数据来源优先级：
   *   ① `r.seq`：question 表卷内序号（摄入时由源写入，76,240 题有值）
   *   ② 无则 0 —— 前端对 0/空显示 `?`（**不臆造编号**，宁缺毋滥）
   * `no` 与 `number` 同值双写：`no` 是真题卷/模考的既有字段名，`number` 是池原生名。
   */
  const seqNo = Number(r.seq || 0) || 0
  return {
    id: String(r.canonical_id || ''),
    no: seqNo,
    number: seqNo,
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
    materialRef: String(r.material_ref || ''),
    canonicalId: String(r.canonical_id || ''),
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
        group_material, group_material_no, material_ref, images, has_image, freq, paper, region, year, seq
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
      /**
       * 五维标注（cycle-62 修复）：原 dims 缺 `analysis` 槽位 —— 消费方
       * `QwAnswerDims` 先读 `d.analysis`，缺了才回落到平铺 `q.analysis`。
       * 语义上空槽 + 回落能出内容，但**五维面板的「解析」卡片样式与其它五维不一致**
       * （回落分支用的是裸「📖 解析」块，不是 DimBlock 色板）。补齐后六维同构。
       */
      dims: { analysis: q.analysis, reasoning: q.reasoning, fastest: q.fastest, pitfalls: q.pitfalls, mother: q.mother, doubt: q.doubt, askModel: q.ask_model },
      related: q.related, groupMaterial: q.group_material, groupMaterialNo: q.group_material_no,
      materialRef: q.material_ref, images, hasImage: Number(q.has_image || 0),
      freq: q.freq, paper: q.paper, region: q.region, year: q.year,
      /** 卷内序号（question.seq；出处侧 seq 更权威，见出站映射的 no/number） */
      seq: Number(q.seq || 0),
      sources, sourceCount: sources.length,
      relations,
    }
  } catch {
    return null
  }
}
