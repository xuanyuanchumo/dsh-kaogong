/**
 * adapters/poolSources.ts — 摄入源注册表（可扩展性）
 *
 * ── 为什么单独成文件（可扩展性 + 可维护性）──
 *   研究 14 §4.1：「新增一个题库只需写一个 adapter，不改任何内核逻辑」。
 *   ���注册表把「源清单」从摄入主流程里**抽出来**：
 *   新增一个源 = 往注册表加一条 + 写一个 ingest 函数，**主流程零改动**。
 *
 *   若把源清单写死在 poolIngest.ts 的 if/else 里，每加一个源都要改主流程
 *   → 改一个地方 = 十个地方可能漏（可维护性反模式）。
 *
 * ── 源契约（SourceSpec）──
 *   每个源声明：
 *   · id/tier/label —— 身份与展示（面板据此渲染，不硬编码）
 *   · available(ctx) —— 是否可用（探针；不可用**降级**不报错）
 *   · ingest(ctx)    —— 执行摄入（返回计数）
 *
 * ── 边界纪律 ──
 *   源实现**只允许**认识上游格式（适配层职责）；
 *   存储层与内核层不认识任何具体上游。
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ingestNaokuSource, ingestXingceSource, ingestGwyZhentiSource } from './poolSourceImpls.js'
import { ingestXingceAppSource, ingestTuxingSource, ingestQiuzhaoSource, ingestCeaSource } from './poolSourceJson.js'
import { ingestMethodologySource, ingestKadianNodes, ingestDocAssetsSource } from './poolSourceKnowledge.js'

/** 源上下文（注入给每个源实现；源不应自己去找路径） */
export interface SourceContext {
  /** 题库数据根（上游仓库的父目录） */
  repoRoot: string
  /** 用户数据根（`.naoku.db` 等派生库所在处） */
  dataDir: string
  /** 目标库连接 */
  db: any
  /** 本源摄入选项（maxFiles / maxPapers 等） */
  opts: { maxFiles?: number, maxPapers?: number }
}

/** 源计数（各源统一返回形状——面板可按同一模板渲染） */
export interface SourceCounts {
  questions: number
  relations: number
  files?: number
  materials?: number
  appearances?: number
  reviews?: number
  skipped?: boolean
  reason?: string
  lastError?: string
}

/** 源规格（注册表条目） */
export interface SourceSpec {
  /** 源 id（存储层 source_id / question.source_id 的取值） */
  id: string
  /** 分级：required（必选）/ recommended（推荐）/ optional（可选） */
  tier: 'required' | 'recommended' | 'optional'
  /** 面板展示名 */
  label: string
  /** 上游地址（白盒透出，用户可溯源） */
  upstream?: string
  /**
   * qid 命名空间（cycle-35 研究 16 §2.2）。
   * · **不填**（共享命名空间）：qid 跨仓一致（粉笔系 naoku/xingcezhenti/kaogongzhentizhengliu
   *   共享一个命名空间——这正是合并键）→ canonical_id = `q:<qid>`。
   * · **填 sourceId 自身**（独立命名空间）：id 只在本源唯一 → canonical_id = `q:<sourceId>:<qid>`，
   *   永不与其它源撞库；跨源等价走 SAME_AS 边（合并靠认亲，不靠重名）。
   */
  qidNamespace?: string
  /**
   * cycle-61 v9-b：**源指纹**（增量重建的判据）。
   *
   * 语义：同一次内容对应同一个字符串；内容变了指纹必变。默认实现 = 源根目录的
   * mtimeMs（目录项变更会刷新目录 mtime；子文件内容编辑不一定刷新——对本题库集合
   * 足够，因为上游仓库更新以「新增/替换文件」为主）。需要更精确的源可自行覆盖
   * （如 naoku 用 `.naoku.db` 文件 mtime）。
   *
   * 为什么放在注册表而不是编排器：增量判据与「这个源长什么样」强相关，
   * 属于源自己的知识；编排器只负责比对（可扩展性枢纽纪律）。
   */
  fingerprint?(ctx: SourceContext): string
  /** 是否可用（探针；返回 false 时主流程记 skipped 并继续——**不中断整轮**） */
  available(ctx: SourceContext): boolean
  /** 执行摄入（可同步或异步——naoku 需 await import('node:sqlite')） */
  ingest(ctx: SourceContext): SourceCounts | Promise<SourceCounts>
}

/** 源指纹计算（纯读；失败返回 '' = 不可判定，调用方按「需重建」保守处理） */
export function fingerprintOf(spec: SourceSpec, ctx: SourceContext): string {
  try {
    if (typeof spec.fingerprint === 'function') return String(spec.fingerprint(ctx) || '')
  } catch { return '' }
  // 默认：源根目录 mtime（目录项增删会刷新；子文件内容编辑不一定——见 SourceSpec.fingerprint 注释）
  try { return String(statSync(join(ctx.repoRoot, spec.id)).mtimeMs) } catch { return '' }
}

/** 全部源的指纹快照（增量重建判据；不可用源不计入） */
export function sourceFingerprints(ctx: SourceContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const spec of SOURCE_REGISTRY) {
    try {
      if (!spec.available(ctx)) continue
      out[spec.id] = fingerprintOf(spec, ctx)
    } catch { /* 单个源探测失败不影响其它 */ }
  }
  return out
}

/** 进度事件（重建可观测性：worker → 主线程 → /api/pool/rebuild/status） */
export interface IngestProgress {
  phase: 'ingest'
  source: string
  index: number
  total: number
  state: 'start' | 'skip' | 'done' | 'error'
  questions?: number
}

/**
 * 源注册表（单一事实源）。
 *
 * 新增源的唯一步骤：
 *   ① 在 `poolSourceImpls.ts` 写 `ingestXxxSource(ctx)`
 *   ② 在此数组加一条 { id, tier, label, available, ingest }
 *   —— 摄入主流程、面板、统计、守卫**全部零改动**。
 */
export const SOURCE_REGISTRY: SourceSpec[] = [
  {
    id: 'naoku',
    tier: 'required',
    label: '深度题库（GongkaoNaoku）',
    upstream: 'https://github.com/Hongyy177/GongkaoNaoku',
    available: (ctx) => existsSync(join(ctx.dataDir, '.naoku.db')),
    ingest: (ctx) => ingestNaokuSource(ctx),
  },
  {
    id: 'xingcezhenti',
    tier: 'required',
    label: '行测真题库（xingcezhenti）',
    upstream: 'https://github.com/HuangJunJie/xingcezhenti',
    available: (ctx) => existsSync(join(ctx.repoRoot, 'xingcezhenti')),
    ingest: (ctx) => ingestXingceSource(ctx),
  },
  // ── cycle-35 新增源（研究 16 摄入矩阵 P1-P5）——全部独立 id 命名空间 ──
  {
    id: 'xingce-app',
    tier: 'recommended',
    label: '离线行测刷题 App 题库（xingce-app）',
    upstream: 'xiaogaostu（数据根 xingce-app/web/public/data）',
    qidNamespace: 'xingce-app',
    available: (ctx) => existsSync(join(ctx.repoRoot, 'xingce-app', 'web', 'public', 'data', 'manifest.json')),
    ingest: (ctx) => ingestXingceAppSource(ctx),
  },
  {
    id: 'gk-tuxing',
    tier: 'required',
    label: '图形推理专项（gk-tuxing）',
    upstream: 'gk-tuxing（数据根 assets/data.js）',
    qidNamespace: 'gk-tuxing',
    available: (ctx) => existsSync(join(ctx.repoRoot, 'gk-tuxing', 'assets', 'data.js')),
    ingest: (ctx) => ingestTuxingSource(ctx),
  },
  {
    id: 'qiuzhao-epi-bank',
    tier: 'optional',
    label: '秋招 EPI 题库（qiuzhao-epi-bank）',
    upstream: 'qiuzhao-epi-bank（数据根 data/*.json）',
    qidNamespace: 'qiuzhao',
    available: (ctx) => existsSync(join(ctx.repoRoot, 'qiuzhao-epi-bank', 'data', 'generated.json')),
    ingest: (ctx) => ingestQiuzhaoSource(ctx),
  },
  {
    id: 'civil-exam-agent',
    tier: 'optional',
    label: '公考督导题库（civil-exam-agent）',
    upstream: 'civil-exam-agent（数据根 data/official_85_questions.json）',
    qidNamespace: 'cea',
    available: (ctx) => existsSync(join(ctx.repoRoot, 'civil-exam-agent', 'data', 'official_85_questions.json')),
    ingest: (ctx) => ingestCeaSource(ctx),
  },
  // ── cycle-39：真题卷 md 全量入池（研究 20 §1 端到端缺口——最后一个「直读目录」源收敛）──
  {
    id: 'gwy-zhenti',
    tier: 'recommended',
    label: '真题卷库（gwy-zhenti · 1683 卷 md）',
    upstream: 'gwy-zhenti（粉笔题库整理版）',
    qidNamespace: 'gwy-zhenti',
    available: (ctx) => existsSync(join(ctx.repoRoot, 'gwy-zhenti')),
    ingest: (ctx) => ingestGwyZhentiSource(ctx),
  },
  // ── cycle-35 知识层（回答「方法论/skill 要不要入库」：要——knowledge 表 + USES_METHOD 边）──
  {
    id: 'huasheng13',
    tier: 'required',
    label: '花生十三体系方法论（25 篇 · knowledge 节点）',
    upstream: 'WangJunqing-coder/huasheng13-skill',
    available: (ctx) => existsSync(join(ctx.repoRoot, 'huasheng13')),
    ingest: (ctx) => ingestMethodologySource(ctx),
  },
  {
    id: 'kadian',
    tier: 'recommended',
    label: '考点知识节点（kadian 去重 → 考点↔方法论连接）',
    available: () => true,   // 依赖库内已有 BELONGS_TO 边，探针恒真；实现内自查
    ingest: (ctx) => ingestKadianNodes(ctx),
  },
  {
    id: 'doc-assets',
    tier: 'optional',
    label: '纯文档仓资产账本（sakib/developer2gwy/Exam_Database/NovaForge/yunduanqiqu）',
    available: () => true,
    ingest: (ctx) => ingestDocAssetsSource(ctx),
  },
]

/** 按 id 取源规格 */
export function findSource(id: string): SourceSpec | null {
  return SOURCE_REGISTRY.find(s => s.id === id) || null
}

/**
 * 源结果分类（cycle-61 v9-b·关键设计）：
 * 「这个源没数据」有两种语义，**绝不能混为一谈**：
 *   · `unavailable` —— 用户没装这个源（available=false）：跳过是正常语义，该源数据本就不该存在；
 *   · `failed`      —— 源实现抛错（bug/上游格式变了/权限/IO）：这是**故障**，
 *     全量重建时若继续提交，就会把该源原有数据删掉且不恢复（真实事故：
 *     故障注入后重建仍 ok=true，question 从 11649 掉到 11295 = gk-tuxing 354 题被删）。
 *
 * 因此 `ingestAll` 除了计数，还返回 `failures[]`；由编排器按模式决定处置：
 *   全量重建（清空过）= 有 failed 必须整体回滚（要么完整成功、要么完全不动）；
 *   增量重建（未清空）= 失败源跳过即可（其原有数据仍在，安全）。
 */
export interface IngestFailure {
  source: string
  kind: 'exception' | 'unavailable'
  reason: string
}

export async function ingestAll(
  ctx: SourceContext,
  only?: string[],
  opts: { skip?: Set<string>, onProgress?: (p: IngestProgress) => void, failures?: IngestFailure[] } = {},
): Promise<any> {
  const out: Record<string, any> = {}
  const wanted = only && only.length ? new Set(only) : null
  const list = SOURCE_REGISTRY.filter(spec => !wanted || wanted.has(spec.id))
  const total = list.length
  let index = 0
  for (const spec of list) {
    index++
    const report = (state: IngestProgress['state'], extra: any = {}) => {
      try { opts.onProgress && opts.onProgress({ phase: 'ingest', source: spec.id, index, total, state, ...extra }) } catch { /* 进度回调失败不影响摄入 */ }
    }
    // 增量跳过：指纹未变的源不重跑（真增量——旧实现名为增量、实为全量重灌）
    if (opts.skip && opts.skip.has(spec.id)) {
      out[spec.id] = { source: spec.id, questions: 0, relations: 0, skipped: true, reason: '指纹未变（增量跳过）' }
      report('skip')
      continue
    }
    try {
      if (!spec.available(ctx)) {
        out[spec.id] = { source: spec.id, questions: 0, relations: 0, skipped: true, reason: '源不可用（数据缺失）' }
        try { opts.failures && opts.failures.push({ source: spec.id, kind: 'unavailable', reason: '数据缺失（未安装）' }) } catch { /* ignore */ }
        report('skip')
        continue
      }
      report('start')
      // ⚠️ 必须 await：源实现可能是同步也可能是异步（naoku 需 await import('node:sqlite')）。
      //   若漏 await，展开 Promise 对象只会得到 `{source:'naoku'}` —— 计数全丢、**静默少摄入**。
      //   （cycle-34 实测踩坑：症状是「摄入完成但题数为 0」。）
      const r = await spec.ingest(ctx)
      out[spec.id] = { source: spec.id, ...r }
      // 源自己报告跳过（如 huasheng13 未安装）也不算异常
      if (r && r.skipped && r.lastError) {
        try { opts.failures && opts.failures.push({ source: spec.id, kind: 'unavailable', reason: String(r.lastError).slice(0, 200) }) } catch { /* ignore */ }
      }
      report('done', { questions: Number((r && r.questions) || 0) })
    } catch (e: any) {
      const reason = '摄入异常: ' + (e && e.message ? e.message : String(e))
      out[spec.id] = { source: spec.id, questions: 0, relations: 0, skipped: true, reason }
      try { opts.failures && opts.failures.push({ source: spec.id, kind: 'exception', reason: reason.slice(0, 200) }) } catch { /* ignore */ }
      report('error')
    }
  }
  return out
}

/** 注册表快照（白盒透出：面板显示「已注册哪些源、各自状态」） */
export function registrySnapshot(ctx: { repoRoot: string, dataDir: string }): any[] {
  return SOURCE_REGISTRY.map(s => ({
    id: s.id, tier: s.tier, label: s.label, upstream: s.upstream || null,
    available: (() => { try { return !!s.available({ repoRoot: ctx.repoRoot, dataDir: ctx.dataDir } as any) } catch { return false } })(),
  }))
}
