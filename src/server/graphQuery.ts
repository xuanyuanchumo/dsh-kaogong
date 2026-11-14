/**
 * graphQuery.ts — /api/graph/{neighborhood,path,impact} 三查询域（cycle-29 从 http.ts 外提）
 *
 * 契约（cycle-13 教训①拆法）：「只读纯函数外提 + 闭包值同名参数穿线」——
 * graphSnapshot 是 http.ts 的闭包函数（持有 graphCache），经参数注入；
 * neighborhood/shortestPath/reverseReach 来自 manifest.ts（确定性纯函数，直接 import）。
 * 复用 /api/graph 的 5s 缓存（不重复 buildGraph），在快照上做纯函数查询。
 * 崩溃安全：未知/缺失节点返回 {error} 且 HTTP 200；任何异常都收敛为 {error}，
 * 绝不向路由层冒泡（路由层 catch 会退化成 500）。
 */
import { neighborhood, shortestPath, reverseReach } from '../shared/manifest.js'

export function graphQuery(path, params, wsRaw, graphSnapshot) {
  try {
    const g = graphSnapshot(wsRaw)
    const nodes = g.nodes || []
    const edges = g.edges || []
    const known = new Set(nodes.map((n: any) => n.id))

    if (path === '/api/graph/neighborhood') {
      const node = params.get('node') || ''
      const depth = Math.max(1, Math.min(3, parseInt(params.get('depth') || '1', 10) || 1))
      if (!node || !known.has(node)) {
        return { error: `未知节点: ${node || '(空)'}`, center: node, depth, nodes: [], edges: [], stats: { nodes: 0, edges: 0 } }
      }
      const r: any = neighborhood(nodes, edges, node, depth)
      return { ...r, stats: { nodes: r.nodes.length, edges: r.edges.length } }
    }

    if (path === '/api/graph/path') {
      const from = params.get('from') || ''
      const to = params.get('to') || ''
      if (!from || !to) return { error: '缺少 from/to 参数', found: false, path: [], length: 0 }
      if (!known.has(from) || !known.has(to)) {
        const bad = !known.has(from) ? from : to
        return { error: `未知节点: ${bad}`, found: false, path: [], length: 0 }
      }
      return shortestPath(nodes, edges, from, to)
    }

    // /api/graph/impact
    const node = params.get('node') || ''
    if (!node || !known.has(node)) {
      return { error: `未知节点: ${node || '(空)'}`, node, dependents: [], count: 0 }
    }
    return reverseReach(nodes, edges, node)
  } catch (e: any) {
    return { error: `图查询失败: ${e && e.message ? e.message : String(e)}` }
  }
}
