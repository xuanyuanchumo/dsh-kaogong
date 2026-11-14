/**
 * graph-subgraph.ts — 子图取数与归一化纯函数族（cycle-29 P1 从 graph-view 外提）
 *
 * 契约（cycle-13 教训①固定的拆法）：「只读纯函数外提 + 闭包值同名参数穿线」——
 * 本文件零 React 依赖、零写入面，组件闭包的 setState 留在视图层；
 * 读取语义 =「调用时刻实参 ≡ 调用时刻闭包值」，行为逐字节等价。
 *
 * 服务端契约（src/server/http.ts graphQuery）：
 * - /api/graph/neighborhood?node=&depth= → {center,depth,nodes[],edges[],stats}（error 时 200 + {error}）
 * - /api/graph/impact?node=              → {node,dependents[],count}（只有 id 集 → 客户端在全图快照上派生子图）
 *
 * 命名纪律（cycle-15 教训⑨）：combo 单作用域，本文件顶层名一律 graph* 前缀。
 */

/** 取数双通道（api 注入优先、fetch 兜底；ws 隔离键贯穿）——与 pathRequest 同构 */
export async function graphFetchSubgraph(kind: string, id: string, depth: number, api: any, wsKey: any): Promise<any> {
  const qs = (kind === 'impact')
    ? '?node=' + encodeURIComponent(id)
    : '?node=' + encodeURIComponent(id) + '&depth=' + depth
  const rel = (kind === 'impact') ? '/graph/impact' : '/graph/neighborhood'
  if (typeof api === 'function') return api(rel + qs)
  if (typeof fetch === 'function') {
    const wsSuffix = wsKey ? '&ws=' + encodeURIComponent(String(wsKey)) : ''
    const r = await fetch('/kaogong/api' + rel + qs + wsSuffix)
    return r.json()
  }
  throw new Error('api 通道未注入')
}

/** neighborhood 响应归一化：error 响亮抛出；节点缺 label 时从全图 nodeIndex 补齐（绝不臆造） */
export function graphNormalizeNeighborhood(d: any, nodeIndex: any, depth: number): any {
  if (d && d.error) throw new Error(String(d.error))
  const ns: any[] = (d && Array.isArray(d.nodes)) ? d.nodes : []
  const es: any[] = (d && Array.isArray(d.edges)) ? d.edges : []
  const fixed = ns.map((n: any) => (n && n.label != null)
    ? n
    : Object.assign({}, n, { label: (nodeIndex[String(n && n.id)] && nodeIndex[String(n && n.id)].label) || (n && n.id) }))
  return {
    kind: 'neighborhood',
    center: (d && d.center) || '',
    depth: (d && d.depth) || depth,
    label: depth + ' 跳邻域 · ' + ((d && d.center) || ''),
    nodes: fixed,
    edges: es,
    idSet: new Set(ns.map((n: any) => String(n && n.id))),
    count: ((d && d.stats && d.stats.nodes) || ns.length),
  }
}

/** impact 响应派生子图：dependents 只有 id 集 → 在全图快照上过滤出节点/边（纯表操作 O(V+E)） */
export function graphDeriveImpact(d: any, nodeIndex: any, edges: any[]): any {
  const ids: any[] = (d && Array.isArray(d.dependents)) ? d.dependents : []
  const idSet = new Set(ids.map(String))
  const center = String((d && d.node) || '')
  return {
    kind: 'impact',
    center,
    depth: null,
    label: '影响面 · ' + center,
    nodes: ids.map((x: any) => nodeIndex[String(x)]).filter(Boolean),
    edges: edges.filter((e: any) => e && idSet.has(String(e.source)) && idSet.has(String(e.target))),
    idSet,
    count: (d && d.count) || ids.length,
  }
}
