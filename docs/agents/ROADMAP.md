# 路线图与技术债

> 债务清单同步 `.cycles/tech-debt/backlog.md`。每轮迭代收口时更新状态。

## 当前状态（v1.17.0 / cycle-22）

| 维度 | 数据 |
|---|---|
| 真题卷 | 1683 套（申论 944 / 行测 739，2008–2026） |
| 深度题库 | 27506 题（知识点覆盖 100%，速解 41%，含图 10647；**选项含图 1406 / 解析含图 8294——cycle-22 起全部保留**） |
| 本地图片 | 11 万+（试卷配图 + 354 张图推题图） |
| 方法论语料 | 25 篇（20 references + 5 examples，336KB），位于数据根，**不随包** |
| 方法论覆盖 | 六模块 overall **0.9756**（40/41；yanyu 0.889 为真实缺公式缺口） |
| 方法论练习 | 74 题（32 题字母答案可自动判分 / 42 题文字作答走自评） |
| 仓库 | 16（必选 3：huasheng13 / xingcezhenti / gk-tuxing；推荐 3：kaogong-skill / gwy-zhenti / GongkaoNaoku；可选 10） |
| 视图 | 16 个原生 React 视图（含 huasheng13；方法论入口在专题枢纽内，不占一级导航） |
| 端点 | **66 个**（`/api/kg-img` cycle-22 补 manifest 登记 + 扩展名探测回退） |
| 工具 | 6 个（1 离线 + 5 可选 AI，含 `kaogong_ai_method`；输出全部实时取自能力矩阵） |
| 断言 | smoke **321** + render **57** |
| 数据根 | 四级可配置（env/config/开发态上级/托管默认）+ 一键克隆分级（**cycle-20**：批量队列 / 半成品死锁解除 / 健康巡检 / 旧根提示 / 配置校验） |
| 研究文档 | `docs/research/` 10 篇（PageRank / BM25 / SRS / FR / LRU / Brandes / Merkle / SPC / 参考插件 / 桑基） |
| 发布 | GitHub（SSH）+ npm + 市场合规齐备（条目草案见 [MARKETPLACE-ENTRY.md](./MARKETPLACE-ENTRY.md)） |

## cycle-18 已交付（v1.13.0）

| 交付项 | 证据 |
|---|---|
| 花生十三体系适配引擎（解析/索引快照/BM25/覆盖矩阵/练习解析/信息密度权重） | `src/adapters/huasheng13.ts`（1423 行；`buildIndex` / `search` / `coverageMatrix` / `parsePractice`） |
| 方法论 HTTP 域 6 端点（catalog/doc/search/coverage/practice/trace） | `src/server/methodologyApi.ts`；`src/server/http.ts:392-399` 域链前置 |
| 语料统一走数据根（必选 huasheng13 336KB；无 builtin 旁路） | `src/shared/manifest.ts:279`（REPOS_META 16）；smoke `SMOKE-RP-01c` / `HS13-10` |
| 方法论主视图（五分区） | `src/client/huasheng13-view.ts`（1262 行）；专题枢纽 `src/client/papers-view.ts:553-566` |
| 白盒链路（trace + 覆盖率热力条 + p50/p95） | `src/server/methodologyApi.ts:799-853`；`src/client/obs-view.ts:602-633,985` |
| 覆盖矩阵口径（dims 维度适用性，常识/申论不考公式） | `src/adapters/huasheng13.ts:991-1160`；`src/shared/manifest.ts:220-233` |
| 74 题配套练习 + `answerIsLetter` 自评分支 | `src/server/methodologyApi.ts:712-786`；`src/client/huasheng13-view.ts:16-25` |
| 测试与反向旅程 | `smoke.test.mjs:394-791`（HS13-01..10，55 条）；`render.test.mjs:874-1008`（C18-01..08）；`_tmp/journey-notinstalled.mjs`（15 条） |
| AI 工具 `kaogong_ai_method` | `src/host/index.ts:260-261`；`src/shared/manifest.ts:126` |
| 文档闭环（方法论规范 / API / 架构 / 测试 / 规范 / 路线图 / 市场条目） | `docs/agents/METHODOLOGY.md` + 本目录 9 篇同步 |

## cycle-21 已交付（v1.16.0 数据安全 + 用户旅程修复）

| 交付项 | 证据 |
|---|---|
| 用户数据外置（issue #2 根治）：progress/配置/计划 → `~/.dsh/kaogong/`（KG_DATA_DIR/DSH_HOME 感知），包内旧数据启动时原子迁移（跨卷 cp 回退删源 / lifecycle 环形日志保留新根删源 / 失败只读降级绝不删源） | `src/server/dataRoot.ts`（migratePkgData + dataLocationReport）；`src/server/http.ts`（DATA_DIR=USER_DATA_ROOT） |
| 数据位置白盒端点 + 面板「🛡 数据安全」卡 | `/api/data-location`；`src/client/repos-view.ts`（W1 卡） |
| 练习链路图片修复（issue #1）：`<img>` 剥除 → `kgimg://` 中立占位（落盘与挂载/端口无关）；`/api/kg-img` 二进制端点；RichText 渲染改写 | `src/adapters/repoData.ts`（neutralizeImages）；`src/server/http.ts`（serveKgImage）；`src/client/ui-kit.ts`（RichText kgimg 分支） |
| 材料图归属：「根据上图」题的图在材料块（1479 个含图材料块）→ 按「最近前置材料段」附给题干 | `src/adapters/repoData.ts`（matImgTable + qOffsets 偏移归属） |
| 选项纯字母图形题诚实降级提示（上游数据缺选项图 2728 题） | `src/client/study-view.ts`（lettersOnly 提示条） |
| 纸质补录第一阶段（issue #3）：搜索（naoku DB LIKE 全量 + 目录兜底）/逐题批量补录/幂等/统计隔离/批次撤销 | `src/server/historyApi.ts`；`src/adapters/naoku.ts`（searchQuestionsByStem）；UI KgHistoryImport 四步旅程 |
| 统计隔离：import 条目不进今日新刷/趋势/打卡，错题本照常回炉 | `src/server/srs.ts`（statsSnapshot online 过滤 + importedTotal） |
| 图谱「掌握度」学习画像着色（T-026 前半）：模块正确率弱→强 + 弱区红语义图例 | `src/client/graph-analytics.ts`（mastery 模式）；`src/client/graph-view.ts`（masteryMap + 图例） |
| 沙箱用户旅程：图片端到端渲染（img[kg-img] 200+加载）/补录四步交互/数据安全卡/掌握度图例 全过 | Playwright 实测（3181 沙箱）；smoke SMOKE-DX/IMG/HIST 22 断言 + render C22-01..03 + G-11b |

## cycle-22 已交付（v1.17.0 专题-判断推理图片全链路修复）

| 交付项 | 证据 |
|---|---|
| 深度题库内联图占位化（专题-判断推理无图根治）：选项（1406 题）/解析（8294 题）/五维标注的内联 `<img>` → `kgimg://` 中立占位（与 repoData 同模板；旧 stripHtml 一刀切剥图根因） | `src/adapters/naoku.ts`（stripHtmlKeepImg/neutralizeImages；options/analysis/reasoning/fastest/pitfalls/mother 全字段） |
| `/api/kg-img` 扩展名探测回退：原样未命中 → basename 换扩展名重探（DB 记 .webp 磁盘是 .png） | `src/server/http.ts`（serveKgImage + resolveNaokuImage 兜底） |
| 客户端统一出图：OptionRow / 深度题库内联选项行 / 模考选项行检测占位 → RichText 渲染 | `src/client/ui-kit.ts`；`src/client/study-view.ts`；`src/client/papers-view.ts` |
| manifest 补登记 `/api/kg-img`（cycle-21 漏声明 → 能力对账假漂移缺口闭环） | `src/shared/manifest.ts`；smoke SMOKE-IMG22-02 |
| 图谱直达业务：详情抽屉 view:/module:/method: 三类节点 → setView（打开该视图/去刷该模块/读方法论） | `src/client/graph-view.ts`（goItems）；`src/client/client.ts`（onGo 接线）；render G-17 |
| hover tooltip 掌握率第三行：masteryMap 穿线 engine setView → draw 选项（红黄绿分档，与「掌握度」着色同口径） | `src/client/graph-physics.ts`（tooltip line3）；`src/client/graph-engine.ts`（masteryMap） |
| TDD 断言：SMOKE-IMG22-01..04 + C22-IMG + RENDER-G-17 | `smoke.test.mjs`（321 全绿）；`render.test.mjs`（57 全绿） |

## 待办（按价值排序）

### T-030 · awesome-dsh-plugin 收录 PR
- 现状：合规项已全部就绪；条目 YAML 草案已写入 `docs/agents/MARKETPLACE-ENTRY.md`（category `tools`，无 `npm:` 键）。
- 目标：向 awesome-dsh-plugin 提 `data/plugins/xuanyuanchumo__dsh-kaogong.yml`（一个 PR 一个文件；描述数字与 57 端点/6 工具/16 视图/16 仓库核对一致）。
- 前置：仓库创建满 1 天（CI 自动查）、GitHub topic `dsh-plugin`、按 PR 当日复核。

### T-026 · 图谱「学习画像」叠加层
- 现状：cycle-21 交付掌握度着色；cycle-22 补 hover tooltip 掌握率 + 详情抽屉直达业务（view/module/method → setView）。
- 剩余：弱区高亮开关（一键只显示 rate<50% 的模块子图）与考点级（非模块级）掌握率映射。

### T-027 · 学习计划智能化（原 T-025 延续）
- 现状：30 天四阶段静态日历 + 手动滑杆。
- 目标：按「剩余天数 + 各模块正确率 + 错题积压」自动排程（弱点加权已有 SRS 基础）。

### T-028 · 题库增量更新与断点续传
- 现状：pull --ff-only 全量；大仓库（626MB）弱网失败需手动重来。
- 目标：作业失败自动重试 + `git fetch --depth 1` 增量；镜像不可用自动回落直连。

### T-029 · 设置面板接入宿主 settings
- 现状：主题/倒计时/每日目标等无用户可调面（README 能力矩阵登记为 ⏸）。
- 目标：`ctx.settings` 配置表单（宿主能力矩阵「未用缝」的正当启用场景）。

### T-031 · 方法论语料增量与面板内更新提示（cycle-19 候选）
- 现状：语料由题库管理安装/更新；插件内只读展示缺口（`missing[]` / `dirMismatch` / `orphans`）。
- 目标：在方法论视图内显示「语料版本/更新时间」，并提供跳到题库管理的更新入口（不重复造安装器）。
- 备注：`fixtureHash` 已能自动失效快照，新增语料无需改代码，只需登记 META + 断言。

## 已清偿

| 编号 | 内容 | 完成于 |
|---|---|---|
| T-013 | 宿主级完整加载验证 | cycle-5 |
| T-014 | 主力 profile 回装 | cycle-5 |
| T-016 | 整卷模考 | cycle-7 |
| T-017 | 大作文分档 | cycle-7 |
| T-018 | 题目配图渲染 | cycle-7 |
| T-022 | TypeScript 迁移（tsc 镜像编译 + 新鲜度门） | cycle-9 |
| T-019 | 考点→试卷反查（papersByCategory + 按考点模式） | cycle-10 |
| T-020 | 学习洞察（考点掌握热力 + 学习质量） | cycle-10 |
| T-021 | 材料-题目联动高亮 | cycle-10 |
| T-023 | 图形推理专项（354 题 / 13 规律 / 原创思路，gk-tuxing 全量） | cycle-11 |
| T-024 | 会话内练题（conversation.input.left 控件） | cycle-11 |
| T-025 | client 多模块真 ESM 拆分 + 构建期 bundler（combo 契约不变） | cycle-13 |
| — | 专项刷题记忆 /api/memory + 三视图跳回原题 | cycle-15 |
| — | 图谱环形布局 + 边流动粒子 + 白盒三件套 | cycle-15 |
| — | 一键式题库管理（数据根四级/域重建/分级克隆/镜像代理/管理面板） | cycle-16 |
| — | GitHub + npm 发布；市场合规（topic/icon/screenshots/peer 预发布分支） | cycle-16/17 |
| — | 图谱缓存按 wsKey 分槽（跨项目隔离，R20） | cycle-17 |
| — | spawn windowsHide 控制台闪现修复（R21）+ 工具输出实时化（R22） | cycle-17 |
| — | 花生十三体系方法论适配库（6 端点 / BM25 / 覆盖矩阵 / 74 题 / 专题入口） | cycle-18 |
| — | 方法论语料统一走数据根（必选 huasheng13，REPOS_META 16，kaogong-skill 降推荐） | cycle-18 |
| — | 研究文档体系 docs/research 10 篇 + 工具输出标记行 + 生命周期量化 + UI 壳对账修复 | cycle-19 |
| — | P0 根治：门禁裸 tsc 覆写 combo（R11 第三次复发）+ assert-combo 产物守卫 | cycle-20 |
| — | 题库管理流程优化（半成品死锁解除 / 批量安装队列 / 作业历史 / 健康巡检 / 旧根提示 / 配置校验 / 浏览口径） | cycle-20 |

## 演进原则

1. **数据优先**：先把存量数据吃透（16 仓库里还有 gk-tuxing / qiuzhao-epi-bank 未充分利用），再谈新交互。
2. **离线优先**：规则引擎能做的绝不依赖模型；模型只做「锦上添花」（如 `ai_essay_review`）。
3. **不破坏纪律**：每加一个视图/端点，同步加断言 + 更新 docs/agents。
4. **沙箱先行**：任何宿主交互改动，先沙箱跑通再动主力。
5. **数据/代码分离**：语料与题库一律走数据根，包内不携带内容数据（v1.13 方法论语料同此）。