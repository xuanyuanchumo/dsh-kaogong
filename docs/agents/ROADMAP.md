# 路线图与技术债

> 债务清单同步 `.cycles/tech-debt/backlog.md`。每轮迭代收口时更新状态。

## 当前状态（v1.15.0 / cycle-20）

| 维度 | 数据 |
|---|---|
| 真题卷 | 1683 套（申论 944 / 行测 739，2008–2026） |
| 深度题库 | 27506 题（知识点覆盖 100%，速解 41%，含图 10647） |
| 本地图片 | 11 万+（试卷配图 + 354 张图推题图） |
| 方法论语料 | 25 篇（20 references + 5 examples，336KB），位于数据根，**不随包** |
| 方法论覆盖 | 六模块 overall **0.9756**（40/41；yanyu 0.889 为真实缺公式缺口） |
| 方法论练习 | 74 题（32 题字母答案可自动判分 / 42 题文字作答走自评） |
| 仓库 | 16（必选 3：huasheng13 / xingcezhenti / gk-tuxing；推荐 3：kaogong-skill / gwy-zhenti / GongkaoNaoku；可选 10） |
| 视图 | 16 个原生 React 视图（含 huasheng13；方法论入口在专题枢纽内，不占一级导航） |
| 端点 | **60 个**（cycle-18 加 `/api/huasheng13/*` 6；cycle-20 加 `/api/repos/{install-batch,batch,jobs}` 3） |
| 工具 | 6 个（1 离线 + 5 可选 AI，含 `kaogong_ai_method`；输出全部实时取自能力矩阵） |
| 断言 | smoke **293** + render **51** |
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

## 待办（按价值排序）

### T-030 · awesome-dsh-plugin 收录 PR
- 现状：合规项已全部就绪；条目 YAML 草案已写入 `docs/agents/MARKETPLACE-ENTRY.md`（category `tools`，无 `npm:` 键）。
- 目标：向 awesome-dsh-plugin 提 `data/plugins/xuanyuanchumo__dsh-kaogong.yml`（一个 PR 一个文件；描述数字与 57 端点/6 工具/16 视图/16 仓库核对一致）。
- 前置：仓库创建满 1 天（CI 自动查）、GitHub topic `dsh-plugin`、按 PR 当日复核。

### T-026 · 图谱「学习画像」叠加层
- 现状：图谱反映插件结构（模块/端点/视图），学习洞察只在仪表盘卡片。
- 目标：把「考点掌握」按 PageRank/社区着色叠加到图谱（用户画像与系统画像合一），支持「弱区高亮」模式。

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