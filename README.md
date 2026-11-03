# dsh-kaogong — 考公备考一键式学习平台 · v1.9.1

> 整合 15 个考公开源仓库 → **DSH 宿主内原生界面**：左栏「考公学习」全屏面板 + 右侧 Sidebar 并排标签（引导页亦有入口）。
> 完全离线可用（零模型依赖、零 npm 依赖）；**AI 为可选增强**：5 个工具中 `kaogong_ai_essay_review` 可把「离线基线分 + 方法论」交模型做深度点评。
> **v1.8 新增**：**可交互力导向图谱**（Canvas 2D · 缩放/平移/拖拽/搜索/过滤/布局切换/路径分析/标签去重叠）、
> **白盒管理面板**（生命周期状态机 · 能力对账 · 端点性能表 · 告警 · 诊断导出）、
> **图分析算法族**（度分布/标签传播社区/集聚系数/介数中心性/拓扑分层/最短路/k跳邻域/反向可达）。
> **v1.9 新增（cycle-13）**：**导航七项 + 专题枢纽六分区**（刷题/图形推理/深度题库/申论/方法论收敛为枢纽分区 tab）、
> **真题卷省份维度**（索引 v2 · provinces facet ≥35 省 · `?province=` 过滤 chips）、
> **图谱升级包**（五档着色模式/图例卡/小地图/导出 PNG/键盘快捷键/布局过渡动画）、
> **白盒流动可视化**（能力流三列图 · 量化四卡 · 三态灯对账 · 生命周期事件泳道）。

## 双通道架构（v1.4 核心）

| 通道 | 路径 | 说明 |
|------|------|------|
| 🏠 **宿主同源**（主） | `ctx.webServer` → `/kaogong/*` | UI/API 走 DSH GUI 同源端口：零 CORS、无端口依赖；左栏面板为**原生 React 渲染**（非 iframe） |
| 🔌 独立端口（兜底） | `127.0.0.1:8400-8404` | Electron（无 webServer）/ 挂载失败自动回退；信标发现 + adopt 复用 |

## 快速开始

```bash
# 安装（DSH 宿主内）
plugin_manager install_bundle D:/Projects/TraeProjects/kaogong/dsh-kaogong
```

安装即生效：
1. **Host** 挂载宿主同源路由 `/kaogong/*`（+ 兜底独立端口自动启动）
2. **Client** 注册双入口：左栏面板图标（`sidebar.panellist` + `main`）+ 右侧标签（`sidebarRightTabs` + guide）
3. 刷新 DSH Web GUI → 点左栏 📚 图标 → **原生全屏学习面板**（v1.9 导航七项：仪表盘/模考/真题卷/专题/错题本/图谱/可观测；
   原「刷题/图形推理/深度题库/申论」收敛进「🎯 专题」页的枢纽分区 tab，路由仍可达）

独立运行（无 DSH）：`node -e "import('./src/server/http.js').then(m=>m.startServer(8400))"` → http://127.0.0.1:8400

## 视图能力

| 视图 | 能力 |
|------|------|
| 📊 仪表盘 | 仓库就绪/答题/正确率/模块掌握度（正确率×置信）/14日趋势线/30日热力/🔥streak |
| 🎯 **专题枢纽**（v1.9） | **六分区 tab**：🧭 总览（专题树）｜✏️ 行测刷题｜🔷 图形推理｜🧠 深度题库｜✍️ 申论｜📖 方法论（含母题精选）；懒挂载+常驻，切换不重挂不丢状态 |
| 🧠 **深度题库** | **27506 题五维标注**（考点定位/解题推理链/最快解法/易错点/母题思维）+ 知识点检索 + 含图 10647 题（经专题枢纽分区触达） |
| ⏱ **整卷模考** | 选卷 → 限时倒计时（行测 120min）→ 逐题作答 → 交卷 → **模块得分分布 + 错题清单**（答案不下发防作弊） |
| ✏️ 刷题 | SRS 智能（错题回炉+弱点加权）/键盘流 A-D·Enter·N/单题计时/连击/toast（经专题枢纽分区触达） |
| 📚 **真题卷** | **1683 套卷库**（申论 944 / 行测 739，2008-2026）：科目/**省份**/年份筛选（v1.9 索引 v2：provinces facet ≥35 省，含「全国」，码点升序；点击省份 chip → `?province=` 过滤）→ 详情（给定材料分段 + 题目 + 分值 + 作答要求 + 参考答案折叠 + **题目配图**） |
| 📕 错题本 | 五箱 SRS：答错降箱收集→回炉升箱→箱≥3连对2=掌握；签名去重；300 环形 |
| 📅 计划 | 30 天四阶段日历 + 进度日滑杆 |
| 🔍 检索 | 15 仓库全文检索（DFS 限深早停） |
| 📖 方法论 | 10 主题参考（kaogong-skill 实战方法论） |
| 🕸️ **交互图谱** | **Canvas 2D 力导向**（FR 模型 + 预收敛 + 自适应 + **350ms 布局过渡动画**）：滚轮缩放（光标锚点）/拖空白平移/拖节点钉住/hover 邻域高亮/点击详情抽屉/双击聚焦/搜索定位/类型过滤/力导向↔分层切换/标签去重叠；**v1.9 升级包**：**五档着色模式**（类型/社区/PageRank/中介/度，连续指标五停渐变+半径随指标）· **图例卡**（节点/边类型计数点击显隐）· **小地图**（右下 150×100 点击/拖拽平移视口）· **导出 PNG** · **键盘快捷键**（+/−/0/f/l/Esc）；指标 V·E·密度·连通分量·孤儿·健康度·**社区数**·**集聚系数**；**路径分析**（最短路高亮） |
| 📡 **白盒管理** | 生命周期 stepper（三态+事件时间线）· 能力对账表（声明/活跃/孤儿/未声明 + **v1.9 三态灯列与三态筛选**）· 端点性能表（p50/p95/错误率/sparkline/可排序/可过滤）· **v1.9 能力流三列图**（注册→生产→消费 SVG 贝塞尔链接）· **量化四卡**（SLO 达成率/错误预算/遥测样本/能力健康度）· **生命周期事件泳道**（阶段 × 近 14 天热力）· 分级告警 · 慢端点 TOP · 命名空间清单 · **诊断 JSON 导出** · 摘要复制 |

### 图谱算法族（v1.8，确定性可复现）

| 算法 | 用途 | 复杂度 |
|---|---|---|
| `degreeAnalysis` | 入/出度 + 直方图 | O(V+E) |
| `labelPropagation` | 社区发现（枢纽聚团） | O(iter·E) |
| `clusteringCoefficient` | 局部集聚度（小世界性） | O(Σd²) |
| `brandesBetweenness` | 介数中心性（关键桥节点） | O(V·E) |
| `topoLayers` | Kahn 最长路径分层 | O(V+E) |
| `shortestPath` | 无向 BFS 最短路（路径分析） | O(V+E) |
| `neighborhood` | k 跳邻域（聚焦子图） | O(V+E) |
| `reverseReach` | 反向可达（影响面分析） | O(V+E) |
| `layeredLayout` | 分层布局坐标（归一化） | O(V+E) |

前端图谱采用 **Fruchterman-Reingold** 力模型（斥力 `k²/d` + 引力 `d²/k`，理想边长按两端度数加权），
配合**离线预收敛**（140 次迭代 + 温度调度）与**标签贪心去重叠**（包围盒冲突跳过），
首次打开即稳定可读，无需等在线模拟收敛。

### 申论评改样例（离线，无需模型）
| 作答质量 | 得分（满分20） | 要点覆盖 | 结构 |
|---|---|---|---|
| 全覆盖 + 分条作答 | **18.8** | 100% | 80% |
| 部分要点 | 6.9 | 0% | 59% |
| 口语化敷衍 | 5.3 | 0% | 42% |

## 分层架构（复杂度预算驱动）

```
src/
├── shared/manifest.js    # 能力单一事实源 + 图算法(PageRank/Union-Find/健康度加权)
├── adapters/repoData.js  # 外部数据源适配层（15仓库只读隔离）
├── server/
│   ├── http.js           # 路由分发 + 信标 + 遥测 + 图谱 + 崩溃安全启动 + attachWebRoute
│   ├── ws.js             # 工作区隔离命名空间域（slug+sha1 分文件）
│   ├── srs.js            # 错题本五箱调度 + 统计域
│   └── dataApi.js        # 只读数据查询域（banks/plan/search/method）
├── host/index.js         # Cordis Host 半：webServer 同源挂载(主) + 端口兜底 + 4 AI 工具
├── client/client.js      # Cordis Client 半：双入口 + 宿主原生 React 面板 + 通道探测
│   （v1.9 模块族：client/study-view·papers-view·graph-analytics·graph-physics·
│     graph-transition(过渡动画+键盘命令纯表)·graph-canvas(画布装配原语)·graph-engine·graph-view·obs-view·ui-kit）
└── ui/ (index.html+app.css)  # 零依赖 SPA（同源路由页；服务端内联 CSS）
locale/{zh,en}.json       # DSH 插件规范 i18n 位置
data/                     # progress/<slug>-<hash8>.json · runtime.json · lifecycle.jsonl
```

### 关键机制
- **崩溃安全**（cycle-0）：startServer async；listen 错误 Promise 受控回传；adopt/端口降级。
- **热重载竞态防线**（R7）：本代资源闭包局部持有，cleanup 只清自己那代；重复注册 600ms 重试。
- **信标发现**：`/api/status.app === 'dsh-kaogong'` 自证身份；client 探测顺序 = 同源 → 8400-8404。
- **工作区隔离**：`?ws=<路径>` → `slug+sha1-8` 命名空间分文件；smoke 独立端口段 + publishRuntime=false 自清理。

## AI 增强（可选，需模型）
`kaogong_launch` · `kaogong_ai_tutor` · `kaogong_ai_plan` · `kaogong_ai_shenlun` — 素材供模型加工模式，离线核心与之解耦。

## DSH 宿主能力利用矩阵（cycle-13 登记）

| 缝 | 状态 | 说明 |
|---|---|---|
| `ctx.tools.register` | ✅ 已用 | 5 个 AI 工具，均声明 `output:{schema,render}`（宿主强制） |
| `ctx.webServer`（同源路由） | ✅ 已用 | 主通道 `/kaogong/*`：零 CORS、原生 React 面板 |
| `ctx.inject(['webServer'])` | ✅ 已用 | 懒到达正解（R10 事故固化）：服务就绪才运行，disposer 归框架 |
| `sidebar.panellist` + `main` slot | ✅ 已用 | 左栏「考公学习」全屏沉浸面板（svg 带 `data-dsh-panel-entry`） |
| `sidebarRightTabs` + keyed slot | ✅ 已用 | 右侧并排标签（双注册同 id + guide 函数式；v1.9 瘦身为引导卡+摘要+快捷入口） |
| `ctx.locale.register` | ✅ 已用 | `locale/{zh,en}.json` + factory 内 DICTS 双语 |
| 独立端口兜底 + 信标 adopt | ✅ 已用 | 8400-8404 端口段；`/api/status.app` 自证身份；崩溃安全换端口 |
| `ctx.storage` / `ctx.storageDomain` | ⏸ 未用 | 进度已自管 `data/progress` 命名空间（离线优先、零迁移收益） |
| `ctx.settings`（配置表单） | ⏸ 未用 | 无用户可调配置面；未来加主题/倒计时设置时启用 |
| `ctx.hmr` | ⏸ 未用 | 开发期用 `plugin_manager` 重载（fiber 重挂载），运行时无需自订阅 |
| `ctx.otel` / `productTelemetry` | ⏸ 未用 | 自有环形遥测（p50/p95）已满足白盒面板；外发遥测违背离线隐私设计 |
| `ctx.attachments` / `fileUploads` | ⏸ 未用 | 纯本地只读题库，无二进制上传面 |
| `ctx.userQuestions` / `planMode` | ⏸ 未用 | 学习场景无 HITL 问答/计划协作需求 |

> 登记原则：核心缝（UI/工具/路由/i18n）全用；未用缝均有「离线优先」设计理由，避免盲目追新。新增缝前先在此表登记意图。

## 开发验证

```bash
npm run build        # tsc 类型门 → scripts/bundle-client.mjs 合并单 combo（零错误）
node smoke.test.mjs  # 174 断言 E2E（信标/adopt/隔离/图谱算法族/遥测/崩溃安全/SRS闭环/
                     # 同源路由/UI契约/图算法确定性 + 省份维度运行时断言 R-P-01..03/R-N-01
                     # + cycle-14 材料逐份折叠/申论草稿暂存/索引分块预热守卫）
node render.test.mjs # 35 断言真实 React 18 + 真实 client.js 集成渲染（含专题枢纽六分区/
                     # 省份 chips/白盒流动图/图谱升级包断言与键盘命令行为验证）
node "D:/Projects/TraeProjects/dsh-anic/assets/skill/scripts/band-detector.mjs" .   # 复杂度预算（Status: OK）
```

**cycle-14 性能与体验（v1.9.1）**：① 给定材料**逐份折叠**——真题卷详情与申论材料区均支持「材料 N」标题单独折叠/展开（含字数提示）+「全部展开/收起」总开关；申论题目跳转关联材料时折叠态自动展开。② 申论**草稿本地暂存**（localStorage 按 paperId:no 键，误关/切题不丢，提交自动清除）。③ 真题卷索引**分块预热**（`prewarmPaperIndex`，服务启动后台 setImmediate 分批构建，冷启动不再冻结事件循环；快照命中即毫秒级；同步请求路径兜底 + 代际令牌防双路争抢——教训⑦）。

**bundler 构建链（cycle-13 T-025）**：源码 `src/client/*.ts` 为 11 个真 ESM 模块，tsc 产出
`dist/client/*.js` 后由 `scripts/bundle-client.mjs` 按 **DFS 拓扑序**合并回宿主要求的**单文件
combo factory**（`window.__ModuleLoader__.load`）。铁律：不重命名标识符、不压缩、不删注释；
全部文件顶层名唯一（单一作用域，重名即重复声明 SyntaxError）；**改完任何 src/client/*.ts 必须
`npm run build`**——smoke/render 也已接线 bundler（裸 tsc 会把产物重写回裸 ESM，宿主拒绝加载）。

ANIC 质量流程：`.cycles/`（intent→spec(S1-S8)→plan→门禁 G0-G3 全绿→归档 cycle-1/1-dualentry/2/3；L4 人授权；自举 CONVERGED；举他 sourceUntouched 证明）。技术债：`.cycles/tech-debt/backlog.md`。事故簿：`CLAUDE.md`。

## 数据源（15 仓库，均在上级目录）
xingcezhenti(515套58890题) · kaogongzhentizhengliu(22375篇笔记) · GongkaoNaoku(SM-2引擎) · AdministrativeAptitudeTest · NovaForge · kaogong-skill · sakib · developer2gwy · gwy-zhenti · Exam_Database · qiuzhao-epi-bank · xingce-app · gk-tuxing · civil-exam-agent · yunduanqiqu
