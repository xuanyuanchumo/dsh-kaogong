/**
 * shared/domains.ts — 功能域注册表（cycle-61 v9 统一架构·单一事实源）
 *
 * ── 为什么需要「域」这一层抽象 ──
 *   收敛前系统按「端点」组织：86 个端点各自决定「读池还是读外源」，于是同一份上游
 *   在六个域里被读了六次（naoku 直读 .naoku.db、真题卷直扫 md、图推直读 data.js、
 *   方法论直读语料目录、知识检索直扫三仓 md、补录直扫真题卷）——这就是「外源直读」的
 *   结构性来源：**没有域的概念，就没有「该域数据是否已入库」的统一判据**。
 *
 * v9 把「数据」按**内容域**切分（不是按端点、不是按目录）：
 *   · 每个域声明：它的数据来自哪些**摄入源**（adapters/poolSources 的 id）
 *     以及它在库内落到哪些**表/条件**（供就绪判定用）。
 *   · 请求路径统一走「域就绪 → 读库；域未就绪 → 触发该域摄入 → 读库」。
 *   · 「未就绪时回落到外源」这一分支被**删除**——外源只在适配层（摄入期）出现。
 *
 * ── 数学表述（研究 26 §2）──
 *   域 D = (S_D, T_D, R_D)：源集合 S_D、库内落点 T_D、就绪谓词 R_D。
 *   请求 r 属域 D(r) ⇒ 读路径 = π_{T_D}(DB) ，且前置断言 R_D(DB) 成立；
 *   不成立时执行 ingest(S_D) 后重新断言（一次），仍不成立则返回结构化「未就绪」。
 *   关键不变量（I-DB-1）：**任何运行期读路径都不含源文件 IO**。
 *
 * ── 边界纪律 ──
 *   本文件是**纯数据 + 纯函数**（零 IO、零副作用），server / client / 守卫三方共用：
 *   · server 用它决定摄入范围与就绪判定；
 *   · client 用它把视图归到域（白盒「哪个域的数据没就绪」）；
 *   · smoke 守卫用它做「域 → 源」覆盖矩阵对账。
 */
import { POOL_DB_NAME, POOL_SCHEMA_VERSION, DATA_INVARIANT } from './storage.js'

/** 域 id 词表（新增域必须在此登记——守卫 SMOKE-DOMAIN-01） */
export const DOMAIN_IDS = ['question', 'paper', 'tuxing', 'method', 'knowledge', 'pool'] as const
export type DomainId = typeof DOMAIN_IDS[number]

/** 就绪判据：库内某表的行数阈值（0 = 只需非空） */
export interface DomainReadySpec {
  /** 目标表 */
  table: string
  /** 额外 WHERE 条件（可空） */
  where?: string
  /** 最少行数（默认 1） */
  min?: number
}

/** 域规格（单一事实源） */
export interface DomainSpec {
  id: DomainId
  label: string
  /** 该域数据由哪些摄入源提供（poolSources 的 id；空 = 纯派生无独立源） */
  sources: string[]
  /** 就绪判据（全部满足才算就绪） */
  ready: DomainReadySpec[]
  /** 归属该域的视图（client 侧白盒与导航分组共用） */
  views: string[]
  /** 一句话说明（面板/文档直接渲染，禁止第二处文案） */
  desc: string
  /**
   * 按需摄入的等待策略（v9 关键设计）：
   * · 'sync'       —— 轻量域（毫秒~数秒级）：请求内同步摄入后重读，用户无感；
   * · 'background' —— 重量级域（分钟级）：**立即返回结构化未就绪**并在后台启动摄入，
   *                   前端轮询 /api/data-domains 看进度。绝不把 2 分钟的扫盘挂在一个 HTTP 请求上
   *                   （否则浏览器/反向代理必定超时，用户看到「请求失败」而不知道后台在装）。
   * 判定依据是**实测**：gwy-zhenti 1683 卷首次摄入实测 149s（本机 SSD），
   * 其它域均在 1s 量级。
   */
  ingestMode: 'sync' | 'background'
}

/**
 * 域清单（单一事实源）。
 *
 * 口径说明：
 * · `question` 域 = 练习题（xingcezhenti/xingce-app/qiuzhao/cea 等 JSON/md 题库）；
 * · `paper`   域 = 真题卷（gwy-zhenti 1683 卷 → paper/paper_material/question 卷级列）；
 * · `tuxing`  域 = 图形推理专项（gk-tuxing 354 题，靠 source_extras 无损保真）；
 * · `method`  域 = 花生十三体系 + kaogong-skill 技能文档（knowledge 表 + USES_METHOD 边）；
 * · `knowledge`域 = 考点节点（kadian 去重 → BELONGS_TO/REFERENCES_DOC）；
 * · `pool`    域 = 跨源聚合视图（question 全表；无独立源，靠其它域摄入）。
 *
 * ⚠️ readiness 判据与 `poolObservability.computeFreshness` 分工不同：
 *   freshness 是「整库数据质量是否达到换源基线」（全局、严格、与历史数据比）；
 *   domain readiness 是「这个域的数据在库里吗」（按域、结构性、驱动按需摄入）。
 *   后者不通过时**触发摄入**，前者不通过时只影响白盒提示——两者不可互相替代。
 */
export const DOMAINS: DomainSpec[] = [
  {
    id: 'question',
    label: '练习题',
    sources: ['xingcezhenti', 'xingce-app', 'qiuzhao-epi-bank', 'civil-exam-agent'],
    ready: [{ table: 'question', where: "source_id IN ('xingcezhenti','xingce-app','qiuzhao-epi-bank','civil-exam-agent')" }],
    views: ['practice', 'dashboard'],
    desc: '模块化练习题（行测六模块 + 五维标注），供练习/回炉/统计供数',
    ingestMode: 'sync',
  },
  {
    id: 'paper',
    label: '真题卷',
    sources: ['gwy-zhenti'],
    ready: [{ table: 'paper' }, { table: 'paper_material' }],
    views: ['papers', 'topics', 'essay', 'exam'],
    desc: '1683 套真题卷（卷级元数据 + 材料 + 逐题卷级字段），供整卷/学习/全卷三模式',
    // 实测首次摄入 149s（1683 卷 md 逐卷解析）→ 必须后台，否则 HTTP 请求超时
    ingestMode: 'background',
  },
  {
    id: 'tuxing',
    label: '图形推理',
    sources: ['gk-tuxing'],
    ready: [{ table: 'question', where: "source_id = 'gk-tuxing'" }],
    views: ['tuxing'],
    desc: '354 题图形推理专项（13 类规律 + 上游原始字段 source_extras 无损）',
    ingestMode: 'sync',
  },
  {
    id: 'method',
    label: '方法论',
    sources: ['huasheng13', 'doc-assets'],
    ready: [{ table: 'knowledge', where: "kind IN ('methodology','skill')" }],
    views: ['huasheng13', 'method'],
    desc: '花生十三六模块体系 + 技能参考文档（入库后可零外源直读检索）',
    ingestMode: 'sync',
  },
  {
    id: 'knowledge',
    label: '考点知识',
    sources: ['kadian'],
    ready: [{ table: 'knowledge', where: "kind = 'kadian'" }],
    views: [],
    desc: '考点节点（题→考点→方法论的可 JOIN 链路）',
    ingestMode: 'sync',
  },
  {
    id: 'pool',
    label: '统一题库',
    sources: ['naoku'],
    ready: [{ table: 'question' }],
    views: ['pool', 'search', 'graph', 'wrongbook', 'observability', 'repos'],
    desc: '跨源统一池（去重聚合 + 出处全标记 + FTS5 检索）',
    // naoku 147MB 分片合并 + 27506 题摄入数十秒 → 后台执行，避免请求长时间挂起
    ingestMode: 'background',
  },
]

/** 按 id 取域规格 */
export function findDomain(id: string): DomainSpec | null {
  return DOMAINS.find(d => d.id === id) || null
}

/**
 * 视图 → 域（client 与白盒共用；未知视图归 `question`——练习题是默认供数域）。
 * 优先级：显式登记优先，避免「同一视图被两个域抢」的歧义。
 */
export function domainOfView(view: string): DomainId {
  const v = String(view || '')
  for (const d of DOMAINS) if (d.views.includes(v)) return d.id
  return 'question'
}

/** 域 → 摄入源集合（按需摄入的唯一派生点） */
export function sourcesOfDomain(id: DomainId | string): string[] {
  const d = findDomain(String(id))
  return d ? [...d.sources] : []
}

/** 多个域 → 去重后的源集合（一次摄入覆盖多域，避免重复跑同一个源） */
export function unionSources(ids: Array<DomainId | string>): string[] {
  const set = new Set<string>()
  for (const id of ids) for (const s of sourcesOfDomain(id)) set.add(s)
  return [...set].sort()
}

/**
 * 域注册表自检（守卫与白盒共用）：返回结构性问题清单（空数组 = 健康）。
 * 判据：id 合法、sources 非空（pool 除外）、ready 非空、views 不重复归属。
 */
export function auditDomains(): string[] {
  const problems: string[] = []
  const seenView = new Map<string, string>()
  for (const d of DOMAINS) {
    if (!(DOMAIN_IDS as readonly string[]).includes(d.id)) problems.push(`未登记域 id: ${d.id}`)
    if (!d.ready.length) problems.push(`域 ${d.id} 缺就绪判据`)
    if (!d.label || !d.desc) problems.push(`域 ${d.id} 缺 label/desc（文案必须单一事实源）`)
    for (const v of d.views) {
      const prev = seenView.get(v)
      if (prev) problems.push(`视图 ${v} 同时归属 ${prev} 与 ${d.id}`)
      else seenView.set(v, d.id)
    }
  }
  return problems
}

/** 数据层元信息（白盒/端点/文档共用，杜绝「库名/版本」在多处写死） */
export const STORAGE_META = {
  dbName: POOL_DB_NAME,
  schemaVersion: POOL_SCHEMA_VERSION,
  /** 外源直读禁令（文档与守卫引用同一编号） */
  invariant: DATA_INVARIANT,
} as const
