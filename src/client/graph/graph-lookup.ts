/**
 * client/graph/graph-lookup.ts — 图谱只读查询原语（cycle-60 R13 复杂度治理）
 *
 * ── 为什么外提 ──
 *   `graph-view.tsx` 的 `NativeGraphView` 复杂度 208 > 预算 180（band-detector 唯一超标文件）。
 *   沿用 cycle-13 教训① 的固定拆法：**只读纯函数外提 + 闭包值同名参数穿线**——
 *   本文件只承载「从快照里查某个节点的度/PageRank/社区/邻居」四类纯投影，
 *   函数体逐语义等价（不做行为改动），写引擎原语状态的逻辑仍留在组件闭包。
 *
 * ── 纪律 ──
 *   ① 零 IO / 零 DOM / 零 hook：同一输入必然同一输出；
 *   ② combo 单作用域：顶层名统一 graph* 前缀（教训⑨，禁裸词）；
 *   ③ 组件侧以同名参数传入（raw/local/edges/nodeIndex/edgeMeta），读取语义等价。
 */
import { GRAPH_EDGE_META } from './graph-analytics.js'

/** 节点度（服务端 analytics.degree 优先，缺失回落本地度） */
export function graphDegreeOf(id: any, raw: any, local: any): any {
  try {
    const an = raw.analytics
    const d = an && an.degree && an.degree[id]
    if (d && typeof d.in === 'number') return { in: d.in, out: d.out, total: typeof d.total === 'number' ? d.total : d.in + d.out }
    return local.degree[id] || { in: 0, out: 0, total: 0 }
  } catch { return { in: 0, out: 0, total: 0 } }
}

/** 节点 PageRank 显示值（analytics.pagerank → raw.rank top12 → 本地值 → '—'） */
export function graphPrOf(id: any, raw: any, local: any): string {
  try {
    const an = raw.analytics
    const fromAn = an && an.pagerank && an.pagerank[id]
    if (typeof fromAn === 'number') return fromAn.toFixed(4)
    const rk = Array.isArray(raw.rank) ? raw.rank.find((r: any) => r && r.id === id) : null
    if (rk && typeof rk.pr === 'number') return rk.pr.toFixed(4)
    const lv = local.pagerank[id]
    return typeof lv === 'number' ? lv.toFixed(4) : '—'
  } catch { return '—' }
}

/** 节点所属社区显示串（服务端 communities 优先，回落本地） */
export function graphCommunityOf(id: any, raw: any, local: any): string {
  try {
    const an = raw.analytics
    const list = (an && Array.isArray(an.communities)) ? an.communities : local.communities
    for (let i = 0; i < list.length; i++) {
      const c = list[i] || {}
      if (Array.isArray(c.members) && c.members.indexOf(id) >= 0) return '#' + (i + 1) + '（' + (c.size || c.members.length) + ' 节点）'
    }
    return '—'
  } catch { return '—' }
}

/** 节点邻居行（去重 (other|rel)、方向标注、上限 16 条） */
export function graphNeighborRows(id: any, edges: any[], nodeIndex: any, edgeMeta: any): any[] {
  const rows: any[] = []
  try {
    const seen: any = {}
    for (const e of edges) {
      if (!e) continue
      let other: any = null, dir = ''
      if (String(e.source) === String(id)) { other = e.target; dir = '→出' }
      else if (String(e.target) === String(id)) { other = e.source; dir = '←入' }
      if (other == null) continue
      const key = String(other) + '|' + String(e.rel || '')
      if (seen[key]) continue
      seen[key] = true
      const om = nodeIndex[String(other)]
      rows.push({
        key,
        other: String(other),
        label: om ? String(om.label == null ? om.id : om.label) : String(other),
        rel: String(e.rel || ''),
        relLabel: (edgeMeta[e.rel] && edgeMeta[e.rel].label) || (GRAPH_EDGE_META[e.rel] && GRAPH_EDGE_META[e.rel].label) || String(e.rel || ''),
        dir,
      })
      if (rows.length >= 16) break
    }
  } catch { /* 畸形图数据 → 空行，不抛 */ }
  return rows
}

/**
 * 搜索框键盘导航纯决策表（cycle-60 R13 复杂度治理）。
 * 输入：按键 + 当前命中索引 + 命中总数；输出：{ kind, nextIdx? }
 *   'locate'  回车 → 循环推进并定位
 *   'down'/'up'  方向键 → 夹紧索引
 *   'clear'  Esc → 清空检索
 *   'none'   其它键 → 不处理
 * 纯函数：调用方据此执行副作用（setState/locate），决策与副作用分离。
 */
export function graphSearchKeyPlan(key: any, hitIdx: number, matchCount: number): { kind: 'locate' | 'down' | 'up' | 'clear' | 'none', nextIdx?: number } {
  const k = String(key || '')
  if (k === 'Enter') {
    if (!matchCount) return { kind: 'none' }
    return { kind: 'locate', nextIdx: hitIdx < matchCount - 1 ? hitIdx + 1 : 0 }
  }
  if (k === 'ArrowDown') return { kind: 'down', nextIdx: Math.min(matchCount - 1, hitIdx + 1) }
  if (k === 'ArrowUp') return { kind: 'up', nextIdx: Math.max(0, hitIdx - 1) }
  if (k === 'Escape') return { kind: 'clear', nextIdx: 0 }
  return { kind: 'none' }
}

/**
 * 图例数值格式化（cycle-60 R13）：绝对值 ≥100 取整，否则 3 位小数去尾零。
 * 纯函数，图例卡/抽屉共用同一口径（原本地 fmt 内联在 renderColorLegend）。
 */
export function graphLegendFmt(v: any): string {
  if (typeof v !== 'number') return String(v)
  if (Math.abs(v) >= 100) return v.toFixed(0)
  return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

/** 着色模式中文标签（纯查表；缺失返回空串，不抛） */
export function graphColorModeLabel(modes: any[], id: any): string {
  const m = (modes || []).find((x: any) => x && x.id === id)
  return m && m.label ? String(m.label) : ''
}
