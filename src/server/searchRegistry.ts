/**
 * server/searchRegistry.ts — 统一检索层（cycle-60 架构收敛）
 *
 * ── 定位 ──
 *   收敛前五套检索（/api/search · /api/pool/search · /api/huasheng13/search ·
 *   /api/naoku/kadian · /api/history/search）算法各异、输出形状各异：
 *     · FTS5 trigram+bm25 / BM25 字段加权 / 无打分子串 / SQL LIKE 聚合 / 三通道串联
 *   强行合并算法会丢信息（BASELINE §2.2），故本层只做两件事：
 *     ① **运行时注册表**：provider id/label 从 manifest 端点声明派生（单一事实源）；
 *     ② **统一信封**：{query,results,total,took?,confidence?} + 外壳 {id,source,title,snippet,score?,meta?}。
 *
 * ── 兼容纪律 ──
 *   旧五端点零删改（STORAGE-LAYER §8 兼容硬约束）；本层是新增薄层，
 *   每 provider 只做「调既有域函数 → 形状映射」，不复制任何打分逻辑。
 *   源特有字段（confidence/coverage/sources/rotation/kadian/matchSource…）一律进 meta 无损透出。
 */

import type { SearchHit, SearchEnvelope } from '../shared/types.js'

/** provider 实现契约（id 与 manifest 端点一一对应） */
export interface SearchProviderSpec {
  id: string
  /** manifest 声明的端点路径——label 从这里派生，杜绝第二处字面量 */
  endpoint: string
  search(query: string, opts: SearchOpts): Promise<SearchEnvelope>
  /** v9：该 provider 属于哪个数据域（供白盒告诉用户「先装哪个题库」） */
  domain?: string
  /** v9：是否需要统一池就绪（false = 纯派生/语料库，池不可用也能查） */
  requiresPool?: boolean
}

export interface SearchOpts {
  limit?: number
  repo?: string
  module?: string
  /** 统一池上下文（sample/search 需要）；由 buildDomains 注入 */
  pool?: any
  /** v9：租户键（检索流水按 ws 隔离；白盒可看「哪个项目在搜什么」） */
  ws?: string
}

/** 安全解析源返回值（任何异常都收敛为空信封，绝不向路由层冒泡——崩溃安全纪律） */
function envelope(query: string, raw: any, map: (r: any) => SearchHit, totalOf?: (raw: any) => number): SearchEnvelope {
  const results = Array.isArray(raw?.results) ? raw.results.map(map)
    : Array.isArray(raw?.list) ? raw.list.map(map) : []
  const total = totalOf ? totalOf(raw) : (raw?.total ?? raw?.count ?? raw?.rawTotal ?? results.length)
  const out: SearchEnvelope = { query, results, total: Number(total) || 0 }
  if (raw?.took != null) out.took = Number(raw.took) || 0
  else if (raw?.tookMs != null) out.took = Number(raw.tookMs) || 0
  if (raw?.confidence) out.confidence = raw.confidence
  return out
}

/** 题干摘要（无 title 源用） */
function snippetOf(v: any): string | undefined {
  return v && typeof v === 'string' ? v : undefined
}

/**
 * 创建检索注册表（实例由 buildDomains 持有，随换根重建——R7 无跨代共享可变状态）。
 * @param declaredEndpoints manifest 端点声明（唯一事实源）
 */
export function createSearchRegistry(declaredEndpoints: Array<{ path: string; label: string }>, ctx: { pool?: any; dataApi?: any; historyApi?: any; methodologyApi?: any; naokuApi?: any }) {
  const providers = new Map<string, SearchProviderSpec>()

  /** 注册：label 由 manifest 端点声明派生，未声明端点拒绝注册（对账只认声明——v1.8 教训） */
  function register(p: SearchProviderSpec): void {
    const decl = declaredEndpoints.find(e => e.path === p.endpoint)
    if (!decl) throw new Error(`检索 provider ${p.id} 的端点 ${p.endpoint} 未在 manifest 声明`)
    providers.set(p.id, { ...p, label: decl.label } as SearchProviderSpec)
  }

  /** 内置五 provider：全部委托既有域函数，零算法复制 */
  function registerBuiltins(): void {
    /**
     * 统一池域句柄解析（**唯一取值点**）。
     *
     * ⚠️ 事故教训（v9 实测）：装配期传入的 ctx 是域对象 `d`，它的池句柄键名是 `poolApi`，
     * 而本文件早期写的是 `ctx.pool` —— 于是 pool provider 每次都拿到 undefined，
     * `handle` 抛错被 catch 收敛成空信封 → `/api/search/unified?provider=pool` 永远 total=0，
     * 而 `/api/pool/search` 直连却完全正常。**「同一数据两条路，一条恒空」正是本层要防的漂移**。
     * 正解：一个显式解析函数，兼容两种键名，并在都取不到时**响亮记录**（不再静默空）。
     */
    const poolOf = (): any => (ctx as any).poolApi || (ctx as any).pool

    // ① 统一池（收敛点：FTS5 trigram + 跨源去重 + 源轮转）
    register({
      id: 'pool', endpoint: '/api/pool/search', domain: 'pool', requiresPool: true,
      search: async (q, o) => {
        const pool = poolOf()
        if (!pool || typeof pool.handle !== 'function') return { query: q, results: [], total: 0 }
        const out: any = await pool.handle('/api/pool/search', new URLSearchParams({ q, limit: String(o.limit || 20) }), null, 'GET', 'search-registry')
        return envelope(q, out, (r: any) => ({
          id: String(r.canonicalId || r.qid || r.file || ''), source: r.source || (r.sources?.[0] || 'pool'),
          title: snippetOf(r.stem)?.slice(0, 80), snippet: r.snippet || r.analysis, score: r.score,
          meta: { module: r.module, kadian: r.kadian, sources: r.sources, rotation: out?.rotation },
        }))
      },
    })
    // ② 花生十三体系方法论（BM25 字段加权 + 三档 confidence）
    register({
      id: 'huasheng13', endpoint: '/api/huasheng13/search', domain: 'method', requiresPool: true,
      search: async (q, o) => {
        const raw = await ctx.methodologyApi.handle('/api/huasheng13/search', new URLSearchParams({ q, limit: String(o.limit || 20) }), null, 'GET', 'search-registry')
        return envelope(q, raw, (r: any) => ({
          id: String(r.file || r.title || ''), source: 'huasheng13', title: r.title || r.file,
          snippet: r.highlight || r.snippets?.join(' '), score: r.score,
          meta: { moduleId: r.moduleId, kind: r.kind, coverage: raw?.coverage, phraseHit: r.phraseHit },
        }))
      },
    })
    // ③ md 三仓子串检索（无打分；id=文件，score 缺席）
    register({
      id: 'docs', endpoint: '/api/search', domain: 'method', requiresPool: true,
      search: async (q, o) => {
        const raw = await ctx.dataApi('/api/search', new URLSearchParams({ q, ...(o.repo ? { repo: o.repo } : {}) }), null, 'GET')
        return envelope(q, raw, (r: any) => ({
          id: String(r.file || ''), source: r.repo || 'docs', title: r.file, snippet: r.snippet,
          meta: { file: r.file },
        }))
      },
    })
    // ④ 考点聚合（SQL LIKE 聚合；score=count 语义，不同源不可比 → 放 meta）
    // cycle-62：端点从 /api/naoku/kadian → /api/pool/kadians（naoku 六端点退役）。
    // provider id 保留 'kadian'（对外检索源标识，改 id 会破坏既有消费/守卫对账）。
    register({
      id: 'kadian', endpoint: '/api/pool/kadians', domain: 'pool', requiresPool: true,
      search: async (q, o) => {
        // ctx.pool 是 domains.poolApi（域工厂注入名见 createSearchRegistry 的类型声明）
        const raw = await ctx.pool.handle('/api/pool/kadians', new URLSearchParams({ q, limit: String(o.limit || 20) }), null, 'GET', 'search-registry')
        return envelope(q, raw, (r: any) => ({
          id: String(r.kadian || r.k || ''), source: 'naoku', title: String(r.kadian || r.k || ''),
          meta: { count: r.count, category: r.category, module: r.module },
        }), (x: any) => Array.isArray(x?.list) ? x.list.length : 0)
      },
    })
    // ⑤ 补录搜索三通道（含 matchSource 溯源——原样进 meta）
    register({
      id: 'history', endpoint: '/api/history/search', domain: 'pool', requiresPool: true,
      search: async (q, o) => {
        const raw = await ctx.historyApi.handle('/api/history/search', new URLSearchParams({ q, ...(o.module ? { module: o.module } : {}), limit: String(o.limit || 20) }), null, 'GET', 'search-registry')
        return envelope(q, raw, (r: any) => ({
          id: String(r.contentSig || r.id || r.qid || ''), source: r.source || r.matchSource || 'history',
          title: snippetOf(r.stem)?.slice(0, 80), snippet: r.analysis,
          meta: { matchSource: r.matchSource, module: r.module, paperId: r.paperId, year: r.year, no: r.no },
        }))
      },
    })
  }

  /** 统一查询：未知 provider 返回空信封（不抛错、不 500） */
  async function search(id: string, query: string, opts: SearchOpts = {}): Promise<SearchEnvelope> {
    const p = providers.get(id)
    if (!p) return { query, results: [], total: 0 }
    try {
      const env = await p.search(String(query || ''), opts)
      // 每条命中带 provider 标注（与聚合检索同形——单查/聚合的消费方可以共用一套渲染）
      return { ...env, results: (env.results || []).map(h => ({ ...h, provider: id }) as any) }
    } catch { return { query, results: [], total: 0, confidence: undefined } }
  }

  /**
   * v9：**聚合检索**——一次查询多个 provider，把结果按来源分组并去重合并。
   *
   * 为什么不合并打分：各源打分语义不同（FTS5 bm25 / BM25 字段加权 / 无打分），
   * 跨源比分数是无意义的（研究 26 §2.3）。正确做法是**保留每组原序**、
   * 只在组间交替取样（round-robin）以兼顾各源，且每条命中都带 `provider` 标注——
   * 让用户看得见「这条来自哪套语料」，而不是被一个假的总分排序糊住。
   *
   * @param ids   要查的 provider（缺省 = 全部已注册）
   * @param limit 每组最多取多少条（总上限 = limit × provider 数，另由 total 透出真实值）
   */
  async function searchMany(ids: string[], query: string, opts: SearchOpts = {}): Promise<any> {
    const all = ids && ids.length ? ids : providerIds()
    const valid = all.filter(id => providers.has(id))
    const t0 = Date.now()
    // 并发查询（各 provider 内部都是只读查询，互不依赖）
    const settled = await Promise.all(valid.map(async id => {
      const env = await search(id, query, opts)
      return { id, env }
    }))
    const groups = settled.map(({ id, env }) => ({
      provider: id,
      label: (providers.get(id) as any)?.label || id,
      total: env.total,
      took: env.took,
      confidence: env.confidence,
      hits: (env.results || []).map(h => ({ ...h, provider: id })),
    }))
    // 交替合并（round-robin）：保证各源都有曝光位，不被单一源霸屏
    const merged: any[] = []
    const seen = new Set<string>()
    const maxLen = Math.max(0, ...groups.map(g => g.hits.length))
    for (let i = 0; i < maxLen; i++) {
      for (const g of groups) {
        const h = g.hits[i]
        if (!h) continue
        // 去重键：provider + id（跨源同 id 不算重复——它们是不同来源的证据）
        const key = g.provider + '|' + String(h.id || '')
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(h)
      }
    }
    return {
      query: String(query || ''),
      results: merged,
      total: groups.reduce((s, g) => s + g.total, 0),
      took: Date.now() - t0,
      groups,
      providers: valid,
      // 未注册的 provider 显式报出（不静默忽略——「你写了 provider 但不存在」必须可见）
      unknown: all.filter(id => !providers.has(id)),
    }
  }

  /** provider 清单（含域归属与依赖信息，白盒/选择器直接用） */
  function list(): any[] {
    return [...providers.values()].map(p => ({
      id: p.id, label: (p as any).label, endpoint: p.endpoint,
      domain: p.domain || null, requiresPool: p.requiresPool !== false,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }

  /** 是否有该 provider */
  function has(id: string): boolean { return providers.has(id) }

  function providerIds(): string[] { return [...providers.keys()].sort() }

  /** 列表（白盒/测试：registry ids 必须与 manifest 声明检索端点集合一致） */
  function ids(): string[] { return providerIds() }

  return { register, registerBuiltins, search, searchMany, list, has, ids }
}

export type SearchRegistry = ReturnType<typeof createSearchRegistry>
