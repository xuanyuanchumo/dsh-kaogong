/**
 * client/view-registry.ts — 视图元数据注册表（cycle-61 v9 前端统一架构）
 *
 * ── 收敛前的问题（三处漂移源）──
 *   ① 导航分组 `NAV_GROUPS` 里写了一份「哪些视图在哪个组、什么图标」；
 *   ② `VIEW_ROUTES` 里写了一份「视图 id → 组件」；
 *   ③ manifest 的 `CAPABILITIES.views` 又写了一份「视图 id + label」。
 *   三者靠人肉保持一致：新增视图要改三处，漏一处就是「声明漂移」（历史事故簿里
 *   幽灵视图 / 同名异键两族问题都源于此）。
 *
 * ── v9 的正解：一份元数据，三处派生 ──
 *   本文件声明每个视图的**全部展示属性**（id/label/icon/group/order/domain/desc），
 *   · 导航：`buildNavGroups()` 派生（按 group 分组、按 order 排序）；
 *   · 路由：组件映射仍在 client.tsx（组件是运行时引用，不适合放纯数据文件），
 *     但**视图 id 集合**由本文件派生，路由表少登记即被守卫发现；
 *   · 白盒/文档：`viewMeta()` 供面板与守卫读取。
 *
 * ── 页面融合决策（v9 评审结论）──
 *   · `search`（知识检索）保留：它是跨语料的唯一检索入口，与 pool 检索是**不同数据面**
 *     （知识正文 vs 题目），融合会丢失「查方法论」的场景。
 *   · `method`（方法参考）保留但**降级为查阅型子页**：主方法论入口是专题枢纽的
 *     「📖 方法论」（花生十三体系），method 只承载 kaogong-skill 十主题参考文档。
 *   · `plan`（学习计划）保留：30 天日历是独立交付物，与 dashboard 摘要不重叠。
 *   · 不新增一级导航：新业务一律先进「专题枢纽」分区（纪律㉛）。
 */
import type { DomainId } from '../shared/domains.js'

/** 导航分组 id（顺序即渲染顺序） */
export const NAV_GROUPS_META: Array<{ id: string, label: string }> = [
  { id: 'learn', label: '学习' },
  { id: 'bank', label: '题库' },
  { id: 'review', label: '复盘' },
  { id: 'ref', label: '查阅' },
]

/** 视图元数据（**唯一事实源**：新增视图只改这里 + 路由表一行） */
export interface ViewMeta {
  /** 视图 id（= VIEW_ROUTES 的 key = 导航 key） */
  id: string
  label: string
  icon: string
  /** 所属导航分组（null = 不在一级导航，仅深链可达） */
  group: string | null
  /** 组内排序（越小越前） */
  order: number
  /** 归属数据域（与 shared/domains 对齐；供白盒「这个视图的数据域是否就绪」） */
  domain: DomainId
  /** 一句话职责（文档/白盒直接渲染，禁止第二处文案） */
  desc: string
  /** 是否经专题枢纽进入（true = 不在导航、由枢纽分区触达） */
  viaHub?: boolean
}

export const VIEW_META: ViewMeta[] = [
  // ── 学习 ──
  { id: 'dashboard', label: '仪表盘', icon: '📊', group: 'learn', order: 10, domain: 'question', desc: '学习概览：累计答题/正确率/计划进度/待消灭错题/近期趋势' },
  { id: 'plan', label: '计划', icon: '🗓', group: 'learn', order: 20, domain: 'question', desc: '30 天学习计划日历 + 智能排程侧重（弱点×积压画像）' },
  { id: 'exam', label: '模考', icon: '⏱', group: 'learn', order: 30, domain: 'paper', desc: '整卷模考（papers 的 answer 深链别名：选卷→计时→交卷→报告）' },
  // ── 题库 ──
  { id: 'papers', label: '真题卷', icon: '📚', group: 'bank', order: 10, domain: 'paper', desc: '1683 套真题卷：三模式（答题/学习/全卷）+ 材料 + 参考答案' },
  { id: 'topics', label: '专题', icon: '🎯', group: 'bank', order: 20, domain: 'paper', desc: '趋势枢纽：行测/申论专题 + 练习/图推/深度题库/方法论分区入口' },
  { id: 'pool', label: '统一题库', icon: '🗄', group: 'bank', order: 30, domain: 'pool', desc: '跨源统一库：健康快照 + 检索 + 重建（数据层的可见面）' },
  // ── 复盘 ──
  { id: 'wrongbook', label: '错题本', icon: '📕', group: 'review', order: 10, domain: 'pool', desc: '错题工作台：筛选/SRS 回炉/补录/诊断分桶' },
  { id: 'graph', label: '图谱', icon: '🕸', group: 'review', order: 20, domain: 'pool', desc: '知识图谱：考点关系力导向布局 + 子图下钻 + 最短路' },
  { id: 'observability', label: '可观测', icon: '📡', group: 'review', order: 30, domain: 'pool', desc: '白盒：能力对账/遥测/数据域矩阵/缓存命中率/生命周期' },
  // ── 查阅 ──
  { id: 'search', label: '检索', icon: '🔎', group: 'ref', order: 10, domain: 'method', desc: '跨语料检索：md 三库 / 花生十三 BM25 / 统一池 FTS5' },
  { id: 'method', label: '方法参考', icon: '📖', group: 'ref', order: 20, domain: 'method', desc: 'kaogong-skill 十主题参考文档（主方法论入口在专题·方法论分区）' },
  { id: 'repos', label: '题库管理', icon: '📦', group: 'ref', order: 30, domain: 'pool', desc: '一键式题库管理：必选/推荐/可选分级 + 镜像 + 数据根 + 作业队列' },
  // ── 经专题枢纽进入（不进一级导航，纪律㉛）──
  { id: 'practice', label: '刷题', icon: '✏️', group: null, order: 10, domain: 'question', desc: '模块练习（SRS 回炉 / 弱点加权抽题）', viaHub: true },
  { id: 'tuxing', label: '图形推理', icon: '🔷', group: null, order: 30, domain: 'tuxing', desc: '354 题图形推理专项（13 类规律 + 配图 + 原创思路）', viaHub: true },
  { id: 'essay', label: '申论', icon: '✍️', group: null, order: 40, domain: 'paper', desc: '申论小题采分点评分 + 大作文分档评估', viaHub: true },
  { id: 'huasheng13', label: '方法论', icon: '📐', group: null, order: 50, domain: 'method', desc: '花生十三六模块体系（目录/检索/练习/覆盖/链路五分区）', viaHub: true },
  { id: 'imgsearch', label: '图片搜题', icon: '🖼', group: null, order: 25, domain: 'paper', desc: '上传题目图片→模型读图抽取→统一检索匹配原题（资料分析图表/图形推理）', viaHub: true },
]

/** 视图 id → 元数据（O(1) 查询；构建一次） */
const VIEW_META_MAP: Map<string, ViewMeta> = new Map(VIEW_META.map(v => [v.id, v]))

/** 取单个视图元数据（未知视图返回 null——调用方按缺省降级，不崩） */
export function viewMeta(id: string): ViewMeta | null {
  return VIEW_META_MAP.get(String(id || '')) || null
}

/** 全部视图 id（路由表登记完整性由守卫据此对账） */
export function viewIds(): string[] {
  return VIEW_META.map(v => v.id)
}

/** 派生导航分组（顺序：NAV_GROUPS_META 声明序 → 组内 order 升序） */
export function buildNavGroups(): Array<{ id: string, label: string, items: Array<[string, string]> }> {
  return NAV_GROUPS_META.map(g => ({
    id: g.id,
    label: g.label,
    items: VIEW_META
      .filter(v => v.group === g.id)
      .sort((a, b) => a.order - b.order)
      .map(v => [v.id, v.icon + ' ' + v.label] as [string, string]),
  })).filter(g => g.items.length > 0)
}

/** 视图 → 数据域（白盒「这个视图的数据域就绪了吗」） */
export function domainOfViewMeta(id: string): DomainId | null {
  const m = VIEW_META_MAP.get(String(id || ''))
  return m ? m.domain : null
}

/**
 * 注册表自检（守卫 + 白盒共用）：返回结构性问题清单（空 = 健康）。
 * 判据：id 唯一、group 必须是已声明分组、order 组内不重复（重复会让排序不稳定）。
 */
export function auditViewMeta(): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const groups = new Set(NAV_GROUPS_META.map(g => g.id))
  const orderKeys = new Set<string>()
  for (const v of VIEW_META) {
    if (ids.has(v.id)) problems.push(`视图 id 重复: ${v.id}`)
    ids.add(v.id)
    if (v.group && !groups.has(v.group)) problems.push(`视图 ${v.id} 归属未声明分组 ${v.group}`)
    if (!v.label || !v.desc) problems.push(`视图 ${v.id} 缺 label/desc（文案必须单一事实源）`)
    if (v.group) {
      const key = v.group + '#' + v.order
      if (orderKeys.has(key)) problems.push(`分组 ${v.group} 内 order 重复: ${v.order}（排序不稳定）`)
      orderKeys.add(key)
    }
  }
  return problems
}
