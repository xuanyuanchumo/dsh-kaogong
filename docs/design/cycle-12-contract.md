# cycle-12 设计契约 — 交互式图谱 + 白盒管理/可观测面板（v1.8.0）

> 本文件是 cycle-12 多方并行开发的**唯一接口契约**。任何实现偏离必须先改本文件并通知 Lead。
> 目标：把「能力注册→生产→消费」的白盒链路做成**可交互、可量化、可观测**的产品面，
> 清理 v1.7 遗留的图谱弱交互（原生面板仅有文字统计）与技术债。

## 1. 版本与兼容

- 版本：`1.7.5` → `1.8.0`（新增能力，向后兼容）。
- **向后兼容硬约束**：`/api/graph`、`/api/telemetry`、`/api/capabilities` 既有字段一个都不能删/改名；
  新增一律**追加**。旧 UI（独立 SPA）不改也能跑。
- 零 npm 运行时依赖；ESM；全中文注释；仅绑定 127.0.0.1。
- 源码 `src/**/*.ts`，`npx tsc` 镜像到 `dist/`；**宿主编织的是 dist**。

## 2. 图数据层（`src/shared/manifest.ts` + `src/server/http.ts`）

### 2.1 节点类型元数据（NODE_META 单一事实源）

```ts
export const NODE_META = {
  plugin:    { label: '插件',   color: '#6366f1', icon: '📦', layer: 0 },
  lifecycle: { label: '生命周期', color: '#0ea5e9', icon: '🔁', layer: 1 },
  entry:     { label: '入口',   color: '#8b5cf6', icon: '🚪', layer: 1 },
  channel:   { label: '通道',   color: '#14b8a6', icon: '🔌', layer: 1 },
  view:      { label: '视图',   color: '#f59e0b', icon: '🖥', layer: 2 },
  endpoint:  { label: '端点',   color: '#3b82f6', icon: '🔗', layer: 2 },
  tool:      { label: '工具',   color: '#ec4899', icon: '🧰', layer: 2 },
  domain:    { label: '数据域', color: '#10b981', icon: '🗂', layer: 3 },
  repo:      { label: '仓库',   color: '#64748b', icon: '📚', layer: 4 },
  module:    { label: '模块',   color: '#84cc16', icon: '🧩', layer: 5 },
  method:    { label: '方法论', color: '#a855f7', icon: '📖', layer: 5 },
  phase:     { label: '阶段',   color: '#f97316', icon: '📅', layer: 5 },
  day:       { label: '日',     color: '#94a3b8', icon: '·',  layer: 6 },
}
```

### 2.2 边类型元数据

```ts
export const EDGE_META = {
  contains:    { label: '包含', color: '#94a3b8' },
  produces:    { label: '生产', color: '#3b82f6' },
  consumes:    { label: '消费', color: '#10b981' },
  registers:   { label: '注册', color: '#6366f1' },
  serves:      { label: '服务', color: '#14b8a6' },
  hosts:       { label: '承载', color: '#8b5cf6' },
  next:        { label: '下一阶段', color: '#0ea5e9' },
  'consumed-by': { label: '被消费', color: '#f59e0b' },
  feeds:       { label: '喂给', color: '#84cc16' },
}
```

### 2.3 图分析算法（manifest.ts 导出，全部确定性：字典序/索引序，测试可复现）

| 函数 | 签名 | 语义 |
|---|---|---|
| `degreeAnalysis(nodes, edges)` | `→ { degree: {id:{in,out,total}}, stats:{max,avg,median,histogram:[{deg,count}]} }` | 入/出度 |
| `labelPropagation(nodes, edges, {maxIter=20})` | `→ [{ id, size, members:[id] }]`（按 size 降序、id 字典序稳定） | 社区发现 |
| `clusteringCoefficient(nodes, edges)` | `→ { avg, top:[{id,c}] }` | 无向集聚系数 |
| `brandesBetweenness(nodes, edges)` | `→ [{id,score}]`（归一化，top 20） | 介数中心性 |
| `topoLayers(nodes, edges)` | `→ { layer:{id:number}, maxLayer }` | Kahn 最长路径分层 |
| `shortestPath(nodes, edges, from, to)` | `→ { found, path:[id], length }` | BFS 最短路（无向） |
| `neighborhood(nodes, edges, id, depth=1)` | `→ { center, depth, nodes:[node], edges:[edge] }` | k 跳邻域 |
| `reverseReach(nodes, edges, id)` | `→ { node, dependents:[id], count }` | 反向可达（影响面） |
| `layeredLayout(nodes, edges)` | `→ { id:{x,y}, width, height }` 归一化 0..1 | 确定性分层布局 |

约束：节点量级 ~300-600，算法必须 < 50ms；不得引入递归爆栈（用迭代/显式栈）。

### 2.4 HTTP 端点（均需同步登记进 `CAPABILITIES.endpoints`）

| 端点 | 返回 | 备注 |
|---|---|---|
| `GET /api/graph` | 既有字段 **+** `nodeMeta`、`edgeMeta`、`analytics{degree,degreeStats,communities,clustering,betweenness,layers}`、`layout` | 5s TTL 缓存保持 |
| `GET /api/graph/neighborhood?node=<id>&depth=1` | `{ center, depth, nodes, edges, stats:{nodes,edges} }` | depth 1..3，越界 clamp；未知 node → `{error}` 且 HTTP 200 |
| `GET /api/graph/path?from=<id>&to=<id>` | `{ found, path, length }` | 无向 BFS |
| `GET /api/graph/impact?node=<id>` | `{ node, dependents, count }` | 反向可达 |
| `GET /api/lifecycle` | `{ stages:[{stage,desc,state:'done'|'current'|'pending',at?}], events:[...最近 50 条], current }` | 由 `data/lifecycle.jsonl` + CAPABILITIES.lifecycle 合成 |
| `GET /api/telemetry` | 既有字段 **+** `histogram:{p50,p90,p95,p99,max}`、`topSlow:[{path,p95,count}]`、`alerts:[{level,msg}]` | 告警阈值：p95>200ms warn、>500 error、errRate>1% warn |
| `GET /api/capabilities` | 既有字段 **+** `reconciliation:{orphanEndpoints,orphanViews,unconsumedEndpoints,missingProducers}`、`lifecycle` | 白盒对账 |

## 3. 原生图谱视图（`src/client/client.ts` · NativeGraphView）

**必须真交互**（Canvas 2D + requestAnimationFrame，DPR 感知，ResizeObserver 自适应）：

1. 力导向布局（斥力 + 弹簧 + 向心 + 阻尼，alpha 衰减）+ 分层布局切换；布局稳定后停止 rAF（省电）。
2. 缩放（滚轮，光标为锚点，0.25x–4x）、平移（拖空白）、拖节点（pin/unpin）。
3. hover 高亮邻域 + 工具提示；click 选中 → 右侧详情抽屉（类型/入出度/PageRank/社区/关系列表）。
4. 搜索框：输入节点标签模糊匹配 → 下拉 → 定位并聚焦（动画平移到中心）。
5. 类型过滤 chips（多选，NODE_META 驱动）、边类型图例、孤儿节点开关。
6. 工具条：重置视图 / 适配画布 / 布局切换 / 显示标签 / 聚焦选中（1 跳邻域子图）。
7. 指标条：V/E/密度/连通分量/孤儿/健康度 + 社区数 + 平均集聚系数。
8. 选中两个节点做「路径分析」→ 调 `/api/graph/path` 高亮路径。
9. 空数据/接口失败：降级文字（不崩溃，不给宿主白屏）；`role="alert"` 只在真错误时出现。
10. 响应式：容器宽 < 520px 时详情抽屉改为底部抽屉；触控：单指拖节点、双指缩放（可简化）。

R9 纪律：本视图是**真组件**（经 `h(NativeGraphView, props)` 挂载），hook 数量恒定；
禁止条件直调子组件；事件一律 `onClick` 驼峰。

## 4. 白盒管理/可观测视图（client.ts · NativeObsView）

模块化分区（每区一张 Card，可折叠）：

- **A 学习质量**（保留既有：申论均分率/模考均分率/记录数）。
- **B 运行态**：uptime、总请求、QPS、端点覆盖、活跃端点/声明端点、p95 直方图。
- **C 生命周期状态机**：7 阶段 stepper（done/current/pending + 时间戳）+ 最近事件时间线（最多 12 条）。
- **D 能力对账表**：端点 → 消费者数 → 运行态活跃/未触达/孤儿（缺失生产者标红）；可搜索过滤。
- **E 端点性能表**：path / count / p50 / p95 / errRate / 迷你 sparkline（series）；默认按 p95 降序，可点表头排序。
- **F 告警区**：来自 telemetry.alerts，分级着色。
- **G 命名空间清单**：workspaces（数量 + 列表）。
- **H 管理动作**：刷新（重新拉取）、导出诊断 JSON（Blob 下载）、复制能力矩阵摘要。
- 响应式：窄屏纵向堆叠；表格横向滚动。

## 5. 独立 SPA（`src/ui/index.html` + `app.css`）

- 图谱视图同样升级为可交互 canvas（过滤/搜索/详情/布局切换），与原生面板共享 NODE_META 语义（客户端常量）。
- 排版现代化：CSS 变量主题、卡片/网格、响应式断点（≤720px 单列）、深色模式跟随 `prefers-color-scheme`。
- 可观测视图补生命周期/对账/告警（消费新端点，做可用性降级）。
- 保持零依赖单文件内联脚本约束（smoke 用 `new Function` 做语法门）。

## 6. 测试与验收（`smoke.test.mjs` / `render.test.mjs`）

新增断言（不得删减既有断言）：

- 图算法：分层覆盖全部节点；社区成员并集 == 全部节点；路径 found/未找到两态；邻域 depth 单调；
  反向可达自反性（node ∈ dependents）；全部函数同输入两次输出深相等（确定性）。
- 新端点：200 + 字段形状 + 未知参数降级。
- 兼容：既有 `/api/graph` 字段仍在。
- 静态守卫：client 含 `getContext('2d')`、含 ResizeObserver、无小写 `onclick`、无直调组件。
- render：graph 视图挂载零 alert 且含 canvas；obs 视图含生命周期 stepper 与对账表；切换压力零降级。

门禁：`npx tsc` 0 错误；smoke 全绿；render 全绿；`node --check src/server/http.js`（coverage_cmd）通过。

## 7. 写入边界（并行防冲突）

| 角色 | 唯一可写文件 |
|---|---|
| graph-data | `src/shared/manifest.ts`, `src/server/http.ts` |
| ui-graph | `src/client/client.ts`（图谱视图区 + 其辅助函数） |
| ui-obs | `src/client/client.ts`（可观测视图区 + 其辅助函数）— **在 ui-graph 完成并提交后开工** |
| spa-ui | `src/ui/index.html`, `src/ui/app.css` |
| verify-tests | `smoke.test.mjs`, `render.test.mjs`, `README.md`, `CLAUDE.md`, `docs/**`（除本文件） |

其他文件（`package.json` 版本号、`.cycles/**`）由 Lead 统一修改。禁止 `git commit`，Lead 统一提交。
