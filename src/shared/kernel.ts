/**
 * shared/kernel.ts — L4 内核层纯函数（cycle-49 统一内核第一步）
 *
 * ── 定位（四层依赖最上层，见 docs/agents/STORAGE-LAYER.md §1）──
 *   内核层只放**确定性纯算法**：同一输入必然同一输出，不碰 fs / db / 网络 / 时间。
 *   server 与 client 双方共用，是「同一业务语义只有一个事实源」的物理载体。
 *
 * ── 为什么必须有这个模块 ──
 *   收敛前实测漂移（cycle-49 三域调研）：
 *     · percentile 在 telemetry.ts:67 与 methodologyApi.ts:84 逐字重复（注释自称同口径却各写一份）；
 *     · PageRank 服务端 manifest.ts:424 iter=40、客户端 graph-analytics.ts:80 iter=24
 *       → 同一张图两侧中心性不同（白盒 pagerank 着色与图算法快照对不上）。
 *   本模块收口这些算法，调用方一律 import，禁止再写第二份。
 *
 * ── 铁律 ──
 *   ① 零 IO（禁一切文件读写 / 时钟 / 随机源）——tests/smoke/kernel.test.mjs I1/I2 机器化守卫；
 *      注：守卫按源码字面匹配，故注释中亦不写文件读写函数名，避免假阳性；
 *   ② 确定性：遍历顺序固定（索引序 + 字典序），不依赖对象插入序的语义差异；
 *   ③ 客户端消费走 bundler 递归发现（cycle-24）：本文件可被 client/graph/*.ts import type 之外的
 *      值导入——bundler 会把模块 id 解析为 posix 相对路径（shared/kernel），顶层名须全局唯一；
 *   ④ 本文件只导出带 kgKernel 前缀或通用纯名（percentile/pageRank 等），不引入任何 DOM/Node 类型。
 */

/** 数值归一：任何非法输入收敛为 0（避免 NaN 污染 JSON 响应） */
export function kgNum(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 覆盖率归一：强制落到 [0,1] */
export function kgClamp01(v: any): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** 定点小数（2 位）——遥测/评分展示口径统一 */
export function kgRound2(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

/** 定点小数（4 位）——BM25 score 口径统一 */
export function kgRound4(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0
}

/**
 * 有序样本百分位（p∈[0,100]，最近秩法）。
 * 唯一事实源：原 telemetry.ts:67 与 methodologyApi.ts:84 两份逐字重复实现收敛于此。
 * 输入须已排序；空样本返回 0（不臆造、不抛错）。
 */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/**
 * PageRank 幂迭代（d 阻尼系数，iter 迭代次数）。
 * 唯一事实源：服务端 manifest.ts:424（iter=40）与客户端 graph-analytics.ts:80（iter=24）
 * 参数漂移收敛于此——调用方若需不同迭代数须显式传参并在调用处注明理由，
 * 默认口径为 iter=40（服务端权威基线）。
 *
 * 确定性：初始化 1/n，遍历按 nodes 数组顺序；dangling 质量均分；过程无随机。
 */
export function pageRank(nodes: any, edges: any, opts: { d?: number; iter?: number } = {}): Record<string, number> {
  const d = opts.d == null ? 0.85 : opts.d
  const iter = opts.iter == null ? 40 : opts.iter
  const list: any[] = Array.isArray(nodes) ? nodes : []
  const es: any[] = Array.isArray(edges) ? edges : []
  const n = list.length
  const out: Record<string, number> = {}
  if (!n) return out
  const adj: Record<string, any[]> = {}
  for (const x of list) { out[x.id] = 1 / n; adj[x.id] = [] }
  for (const e of es) {
    if (adj[e.source] && out[e.target] !== undefined) adj[e.source].push(e.target)
  }
  for (let it = 0; it < iter; it++) {
    let dangling = 0
    for (const x of list) if (adj[x.id].length === 0) dangling += out[x.id]
    const next: Record<string, number> = {}
    for (const x of list) next[x.id] = (1 - d) / n + d * (dangling / n)
    for (const x of list) {
      const share = out[x.id] / (adj[x.id].length || 1)
      for (const t of adj[x.id]) if (next[t] !== undefined) next[t] += d * share
    }
    for (const x of list) out[x.id] = next[x.id]
  }
  return out
}

/** 页面名次默认迭代数（单一事实源——服务端/客户端/守卫三方共用） */
export const KG_PAGERANK_ITER = 40

/**
 * 弱点权重公式 1/(rate+0.15)（SRS 抽题 / 智能排程 / 池抽题三处同源模型的纯公式）。
 *
 * 收敛纪律（cycle-50）：公式本身是唯一事实源，但「无数据先验」是**业务语义差异**，
 * 由各调用方自行决定并显式传 rate——本函数不做默认先验，避免把差异藏进内核：
 *   · srs.ts:107       无数据 rate=0.5 → 中性权重 1.538（抽题不偏爱新模块）；
 *   · planSchedule.ts  无数据 rate=0   → 最高权重 6.67（排程优先接触新模块）；
 *   · poolApi.ts       无数据 rate=0   → 同排程（moduleRate 返回 0）。
 * rate 统一 clamp 到 [0,1]；非法输入收敛为 0（与调用方必传数值的契约一致）。
 */
export function weaknessWeight(rate: any): number {
  const n = Number(rate)
  const r = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
  return 1 / (r + 0.15)
}

/**
 * 环形缓冲裁剪（cycle-60：telemetry LAT_RING 与 methodologyApi RECENT_RING 同语义统一）。
 * 语义：就地保留数组末 max 项，返回同一数组引用（调用方无感，零拷贝）。
 * 确定性：纯数组操作，无时钟/随机；max<=0 清空。
 * 用法：`ringPush(arr, item, max)` 等价于 `arr.push(item); ringTrim(arr, max)`。
 */
export function ringTrim<T>(arr: T[], max: number): T[] {
  const m = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0
  if (arr.length > m) arr.splice(0, arr.length - m)
  return arr
}

/** 环形写入糖：push + trim，返回被裁剪后的数组（同一引用） */
export function ringPush<T>(arr: T[], item: T, max: number): T[] {
  arr.push(item)
  return ringTrim(arr, max)
}

/* ══ cycle-61 v9：统一取题层内核（配额 / 加权 / 抽样）══
 *
 * 收敛前「抽题」逻辑散在两处且各自实现：
 *   · poolApi.sampleQuestions  —— L0 材料组 / L1 带图 / L2 五维 / L3 兜底 四层配额
 *   · srs.ts srsQuestions      —— 错题优先 + 模块弱点加权随机
 * 两者的**配额让渡规则**与**加权抽样**是同一种数学结构的不同投影，
 * 却各写一份（改一处必忘另一处）。v9 把纯算法提到内核，两处只做「取数 + 调内核」。
 *
 * 关键纪律（来自两个真实事故，勿删）：
 *   ① 配额必须**守恒**：Σ 每层名额 ≤ n，否则 count=1 返回 2 题（「抽题成功」假红）；
 *   ② 配额必须**确定性**：层内可随机，层间名额由公式算出——概率性补捞会让
 *      「带图必有」这类断言间歇性假红（IMG-04 曾 2/8 轮失败）；
 *   ③ 让渡规则：高优先层占满就没名额给低优先层（L0 曾占满全配额 → 五维层零名额）。
 */

/** 配额层（按优先级排列；name 仅供白盒归因） */
export interface QuotaLayer {
  /** 层标识（材料组/带图/五维/兜底） */
  name: string
  /** 该层最多能拿多少名额（绝对上限，可被剩余名额再压一次） */
  cap: number
}

/**
 * 计算多层配额的**确定性命中名额**（守恒 + 让渡）。
 *
 * @param total  本次要抽的总题数 n
 * @param layers 按优先级排列的层（前面的层先吃名额）
 * @returns 每层应取的条数（Σ ≤ total，且每项 ≥ 0）
 *
 * 语义：`cap` 是「这层最多吃多少」，剩余名额是硬约束——两者取小。
 * 只在最后一层（兜底）允许「不足」：上游查询可能真的没那么多题。
 */
export function quotaPlan(total: number, layers: QuotaLayer[]): number[] {
  const n = Math.max(0, Math.floor(kgNum(total)))
  let left = n
  return (Array.isArray(layers) ? layers : []).map(l => {
    const cap = Math.max(0, Math.floor(kgNum(l.cap)))
    const take = Math.min(cap, left)
    left -= take
    return take
  })
}

/**
 * 加权随机抽样（无放回，确定性可注入 rand）。
 *
 * @param weights 每项权重（非负；全 0 时退化为均匀）
 * @param n       抽几个
 * @param rand    随机源（默认 Math.random；测试注入固定序列以获得确定性）
 * @returns 选中项的下标数组（按抽取顺序）
 *
 * 语义：权重正比于「越弱越密」（weaknessWeight 的输出直接喂进来）。
 * 抽完一项后该位置权重置 0（无放回），避免重复。
 */
export function weightedPickIndex(weights: number[], n: number, rand: () => number = Math.random): number[] {
  const w = (Array.isArray(weights) ? weights : []).map(x => Math.max(0, kgNum(x)))
  const want = Math.max(0, Math.min(Math.floor(kgNum(n)), w.length))
  const picked: number[] = []
  const used = new Array(w.length).fill(false)
  for (let k = 0; k < want; k++) {
    const total = w.reduce((s, x, i) => (used[i] ? s : s + x), 0)
    if (total <= 0) {
      // 全 0/抽空 → 退化为「取第一个未用的」（保证一定能抽满，不返回短数组）
      const idx = used.findIndex(u => !u)
      if (idx < 0) break
      picked.push(idx); used[idx] = true
      continue
    }
    let r = rand() * total
    let chosen = -1
    for (let i = 0; i < w.length; i++) {
      if (used[i]) continue
      r -= w[i]
      if (r <= 0) { chosen = i; break }
    }
    if (chosen < 0) chosen = w.findIndex((_, i) => !used[i])   // 浮点兜底
    if (chosen < 0) break
    picked.push(chosen); used[chosen] = true
  }
  return picked
}

/**
 * 模块弱点权重向量（SRS 抽题 / 池抽题 / 智能排程共用）。
 *
 * @param modules 模块名数组（顺序即返回顺序）
 * @param byModule 进度里的模块统计 `{ [module]: {answered, correct} }`
 * @param emptyRate 「无作答数据」时的中性/激进先验（**业务语义差异由调用方声明**：
 *                  SRS 用 0.5 中性、排程与池抽题用 0 优先新模块）
 *
 * 为什么把 emptyRate 做成参数而不是常量：cycle-50 的教训——公式是单一事实源，
 * 但「无数据意味着什么」是业务判断，必须留在调用侧显式可见，不能藏进内核默认值。
 */
export function moduleWeakness(modules: string[], byModule: Record<string, any>, emptyRate = 0.5): number[] {
  return (Array.isArray(modules) ? modules : []).map(m => {
    const s = byModule && byModule[m]
    const rate = s && kgNum(s.answered) > 0 ? kgNum(s.correct) / kgNum(s.answered) : emptyRate
    return weaknessWeight(rate)
  })
}
