# 测试报告 — cycle-12（v1.8.0）

## 1. 头部

| 字段 | 值 |
|---|---|
| 循环编号 | cycle-12 |
| 日期 | 2026-11-03 |
| 执行者 | AI-L4 |
| 构建 | `npx tsc` 退出 0（noEmitOnError 阻断类型错误） |
| 环境 | Node v24.14.0 · Windows |

## 2. 结果汇总（契约格式：首列 通过/失败/错误）

| 结果 | 套件 | 数量 | 说明 |
|---|---|---|---|
| 通过 | 冒烟 smoke.test.mjs | 144 | 服务端/算法/静态守卫断言全绿 |
| 失败 | 冒烟 smoke.test.mjs | 0 | — |
| 错误 | 冒烟 smoke.test.mjs | 0 | 无运行期异常 |
| 通过 | 渲染 render.test.mjs | 22 | 真实 React 18 + 真实 client.js |
| 失败 | 渲染 render.test.mjs | 0 | — |
| 错误 | 渲染 render.test.mjs | 0 | 无运行期异常 |

对比基线（cycle-12 起点）：smoke 86 → **144**（+58 断言）；render 11 → **22**（+11 断言）。
构建：`npx tsc` 退出 0（noEmitOnError 阻断类型错误）。

## 3. 新增覆盖（v1.8.0）

### 3.1 图分析算法族不变量（29 断言）
- 度分析入/出度和 == 边数；直方图计数 == |V|
- 标签传播成员并集 == |V| 且无重复、按规模降序
- 集聚系数 ∈ [0,1]；介数中心性非负且降序
- 拓扑分层覆盖全节点、层号非负
- 最短路 found/not-found 两态 + 首尾节点正确
- 邻域 depth 单调（2 跳 ⊇ 1 跳）
- 反向可达自反性 + count 一致
- 分层布局覆盖全节点、坐标归一化 0..1、**两次调用深相等（确定性）**

### 3.2 新端点契约（18 断言）
- `/api/graph` 保留全部既有字段（兼容）+ 新增 nodeMeta/edgeMeta/analytics/layout
- `neighborhood` / `path` / `impact` 形状正确 + 未知节点降级为 `{error}`（HTTP 200）
- `/api/lifecycle` 三态合法、恰有一个 current
- `/api/telemetry` 兼容 + histogram/topSlow/alerts + p95≥p50 单调
- `/api/capabilities` 兼容 + reconciliation + lifecycle
- **运行态端点路径口径与 manifest 一致**（防白盒假阳性回归）

### 3.3 前端静态守卫（14 断言）
Canvas 2D / ResizeObserver / DPR / 标签去重叠 / FR 力模型 / 预收敛 / 路径分析端点 / 搜索定位 / lifecycle+workspaces 消费 / sparkline / 诊断导出 / 学习质量不回归 / 无小写 onclick

### 3.4 真实渲染交互（11 断言，新增）
- 图谱挂载 Canvas 且引擎使用 2D 上下文（含四个核心函数存在性）
- 工具条（重置/适配/标签/布局）齐备；类型 chips 由 NODE_META 驱动
- 指标条含社区数 + 集聚系数；类型过滤交互不降级
- 白盒面板八区块齐备；生命周期 stepper 三态；对账表 state 徽标；sparkline SVG；过滤输入生效（表格范围）；开关交互不降级

## 4. 变异验证（证明断言有检出能力，非自证）

| 变异 | 预期 | 实测 |
|---|---|---|
| 删除 `getContext('2d')`（图谱退化为空壳 canvas） | render FAIL | ✅ 检出 `图谱引擎未取得 2D 上下文` |
| 移除 `labelBoxes` 标签去重叠逻辑 | smoke FAIL | ✅ 检出 `图谱有标签去重叠` |
| 恢复变异后 | 全绿 | ✅ smoke 144/144 · render 22/22 |

## 5. 用户旅程覆盖（J1-J3）

| 旅程 | 正向 | 反向 | 结论 |
|---|---|---|---|
| J1 刷题主链路 | 抽题→作答→判分→入库 | 跨命名空间不污染 | PASS |
| J2 Sidebar 入口链路 | tab 注册→guide→原生面板 | 服务未起降级提示 | PASS |
| J3 崩溃安全链路 | async startServer→adopt/降级 | 外部占用不裸抛 EADDRINUSE | PASS |

## 6. 真机验收（沙箱宿主 sb-kaogong @ 3181）

- 左侧栏「考公学习」入口可见 → 点击打开宿主原生面板（`🏠 宿主原生` 标识）
- 11 个视图逐个切换：**0 处 `role="alert"` 降级、0 处常驻 spinner**
- 图谱 canvas 1413×753（DPR 1.25），内容 bbox 全在画布内，四边留白均匀（左281/右276/上27/下32）
- 路径分析实测：`view:graph → endpoint:/api/graph → plugin:kaogong → channel:same-origin → view:dashboard`（4 跳真实路径高亮）
- 可观测面板：43 个声明端点全部正确对账为「活跃」，0 个误判「未声明」

## 7. 结论

- 失败数：**0**（两套件）
- G2 判定依据：本报告 + `smoke-cycle12.txt` + `render-cycle12.txt` 原始输出
