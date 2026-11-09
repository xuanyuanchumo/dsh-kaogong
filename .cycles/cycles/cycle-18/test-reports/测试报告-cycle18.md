# 测试报告 — cycle-18

## 1. 头部

| 字段 | 值 |
|---|---|
| 循环 | `cycle-18` |
| 日期 | 2026-11-09（北京时间） |
| 执行者 | AI-L4：Lead 编排 + 5 名具名工人（adapter-dev / server-dev / ui-dev / qa-dev / docs-dev） |
| 失败 | **0** |
| 错误 | **0** |
| 阻塞 | 0 |

## 2. 汇总

| 套件 | 命令 | 结果 | 说明 |
|---|---|---|---|
| smoke | `node smoke.test.mjs` | **262/262 通过** | 基线 204 → 262（+58）；含 HS13 断言族 + RP-01c 统一管理守卫 |
| render | `node render.test.mjs` | **50/50 通过** | 基线 42 → 50（+8）；真实 React 18 + 真实 client.js 集成 |
| 全链 | `npm run test:all` | **exit 0** | tsc → bundler → smoke → render |
| 沙箱正向旅程 | `node _tmp/journey-sandbox.mjs` | **34/34 通过** | 打真实 `sb-kaogong`（3181） |
| 反向旅程 | `node _tmp/journey-notinstalled.mjs` | **15/15 通过** | 干净数据根：未安装→诚实降级→装好自愈 |

幂等性实证：smoke 连跑 2 次均 262/262；沙箱旅程连跑 2 次均 34/34（已修「长活服务绝对计数」假红）。

## 3. 本轮新增/关键断言

### 3.1 HS13 族（方法论适配库）
- `HS13-01` catalog 200 且 `meta.docCount === 25`、`declaredByAdapter === 25`
- `HS13-02` 6 端点与 manifest 声明**逐字一致**（防 v1.8 假阳性复发）；未知子路径 HTTP200 + `{error}`
- `HS13-02b` **未声明路径不污染端点对账**（`telemetry.endpoints` 无影子键）+ **仍可观测**（`telemetry.unmatched.count > 0`）
- `HS13-02c` 反面守卫：聚合机制**不得**吞掉已声明端点的计数（否则对账表静默变空）
- `HS13-03` 「截位直除」top=`ziliao-susuan`、score 严格降序为正；`rawTotal ≡ results.length + filtered` 且裁剪真实生效
- `HS13-04` 「假设分配」命中；空查询 `results: []`；无意义拉丁串 0 条
- `HS13-05` doc 含 ABRX；未知 file → `{error, known[25]}`
- `HS13-06` 六模块齐备、`overall ∈ (0,1]`；`yanyu 0.889` **真实缺口不凑绿**
- `HS13-07` practice `total/n/returned/hasMore` 四元组语义（不断言 items===10）
- `HS13-08` trace 6 端点 + hits 单调 + 环形容量 200
- `HS13-09` 跨 ws 分槽隔离（A/B 计数、docs、recent 互不污染；无 ws 走独立 default 槽）
- `HS13-10` 语料位于**数据根**（非包内）；META 25 篇零断链；磁盘 25 篇无孤立；`examples` 恰 5 篇；`zhenti-shili` 按磁盘事实在 references/

### 3.2 C18 族（前端集成渲染）
- `C18-01` 视图挂载 + 五分区 tab（`data-kg-hs13-tab`）；**一级导航不得存在独立「花生十三体系」入口**（用户要求）
- `C18-02` 五分区逐区切换零降级（无 `role="alert"`）
- `C18-03` 总览六模块卡 + 覆盖率 `0.9756 → 97.6%`，且**不得出现 98%**（口径统一反向守卫）
- `C18-04` 检索交互（输入→请求→结果列表 + 置信度提示）
- `C18-05` 练习分区渲染真实题干、零降级
- `C18-06` 白盒链路分区渲染 trace
- `C18-07` 枢纽 `method` 分区可达且零降级（与 hs13 数据域不混用）
- `C18-08` obs「方法论链路」卡（三源齐请求 + 六模块热力条 + 覆盖率/命中率/p95 + 缺口如实 + 零降级）

### 3.3 统一题库管理守卫
- `SMOKE-RP-01` `/api/repos` 16 仓库、`summary.total === 16`
- `SMOKE-RP-01c` `huasheng13` 纳入管理、`tier === 'required'`、**无 `builtin` 旁路字段**、upstream 指上游
- `HS13-10b` **包内不得再携带方法论语料**（防旁路复活）

## 4. 沙箱真机验证（`sb-kaogong`，port 3181）

### 4.1 正向旅程（34 条全过）
J1 发现链（catalog 25 篇/六模块/策略层 3/degraded=false）→ J2 检索链（命中/空查询/无意义词）→ J3 原文阅读（ABRX/31 节/未知 file 受控）→ J4 练习（n=10、hasMore、answerIsLetter）→ J5 白盒（trace 6 端点、命中率、recent、`allDeclared=true`）→ J6 跨 ws 隔离 → J7 影子端点不污染 → J8 能力注册完整性（6 端点/6 工具/视图）。

### 4.2 反向旅程（15 条全过，干净数据根）
- 16 仓库登记、就绪 0、`requiredMissing=[huasheng13, xingcezhenti, gk-tuxing]`
- `huasheng13.present=false` 且**无 builtin 字段**
- catalog `degraded=true` / `available=0` / `declared=25` / error 指向「📦 题库管理」
- doc 返回 error、search 返回空数组、coverage 0（全程不崩）
- **装好后自愈**：复制语料进数据根 → 3.2s 后 `degraded=false` / `available=25` / 检索恢复，**无需重启进程**

### 4.3 真机 GUI
- 左栏「考公学习」→ 专题 → 「📖 方法论」分区，渲染 97.6% 覆盖率环、6 模块卡、354 公式条目、219 表格数、25 篇语料
- 底部「另见：kaogong-skill 十主题 + 母题精选」默认折叠
- 截图：`C:\Users\86156\.dsh\profiles\desktop\hs13-topics.png`
- 沙箱唯一未激活条目 = `@deepseek-ai/dsh-schedule`（存储版本 2≠1），**与本插件无关**

### 4.4 构建/产物形态
- `npm run build`：`已合并 13 个模块 → dist/client/client.js（434.3 KB）`，拓扑序含 `huasheng13-view → papers-view`
- combo 形态守卫：`dist/client/client.js` 行首 `export `/`import ` 计数 **0**；`window.__ModuleLoader__.load` 存在；factory 内含 `inject/apply`

## 5. 缺陷闭环（本轮实测发现并修复）

| # | 缺陷 | 发现方式 | 根因 | 状态 |
|---|---|---|---|---|
| 1 | 3 份练习语料静默解析 0 题（丢 46 题） | Lead 独立重算真值 | parsePractice 只认 `^##`，yanyu/panduan/shenlun 是 h3 形态 | 已修（74/74） |
| 2 | 覆盖矩阵假阴性（changshi 0.33 / shenlun 0.67） | 逐模块核对 | 统一按「公式」扣分，而两模块不考公式 | 已修（dims 适用性） |
| 3 | 影子端点污染遥测对账 | smoke 口径守卫报 `/api/huasheng13/bogus` | 未声明路径被记录为运行态端点 | 已根治（聚合桶 + 观测余量） |
| 4 | 声明 6 工具 / host 实际注册 5 | smoke 能力矩阵计数 | 新增 `kaogong_ai_method` 只改了 manifest | 已修（补实现） |
| 5 | 覆盖率双口径（环心 98% vs 文案 97.6%） | render C18-03 | `Math.round` 与 `hs13FmtPct` 不一致 | 已修（统一格式化） |
| 6 | SMOKE-MEM-01 非幂等 | 上轮崩溃后复跑假红 | 依赖跨轮残留 progress 文件 | 已修（幂等前置清理） |
| 7 | 陈旧文案（363MB / 无需安装 / 内置语料） | 全仓 grep | 架构变更后未同步文案（R22 同族） | 已修 |

## 6. 结论

G2（零失败零错误）+ G3（构建零失败）**满足**。旅程正反向覆盖 100%。
唯一未完成项：P3 图谱可视化现代化（已登记 ROADMAP 后续候选，非本轮验收项）。