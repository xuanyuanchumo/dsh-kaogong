# 变更日志

本文件记录 dsh-kaogong 的版本级变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.34.0] - 2026-11-26

**重建不阻塞宿主 + 真增量 + 原子回滚（cycle-61 v9-b）**：修复用户报告的
「重建时 dsh 宿主功能失效、能力崩溃」，并把「全量/增量重建」做成生产级：
worker 线程执行、整库单事务原子切换、逐源指纹真增量、进度可观测。

### 修复（核心，全部有压测实证）
- **重建冻结宿主 → worker 线程执行**：旧实现把「清库 + 1683 卷 + 27574 题 + 57 万边」
  放在宿主进程的 async 函数里跑，但内部全是**同步** `readFileSync`/`DatabaseSync` ——
  `await` 只让出微任务、让不出已进入的同步调用栈，于是整个 DSH 宿主（所有插件/会话/UI）
  被独占数分钟。改为 worker 线程（`poolRebuildWorker.ts`）+ 主线程只做作业状态机。
  **压测实证**：全量重建 145~155s 期间 1200~1300 次宿主探针**零失败**，
  主线程事件循环最大阻塞 **3ms**（旧实现为分钟级）。
- **半成品库 → 整库原子事务**：旧实现先 `DELETE` 并立即 COMMIT，再逐源各自 COMMIT，
  任一源失败就留下**残缺库**（实测故障注入后 question 从 11649 掉到 11295，gk-tuxing 354 题
  被静默删除且 `ok:true`）。改为「清空 + 全源 + FTS + 元信息」同一事务，失败整体回滚。
  **守卫 `REBUILD-01` 固化：源异常时 `ok:false` + 旧数据一条不少。**
- **源异常被静默吞掉 → 故障分类闸**：`ingestAll` 区分 `exception`（源实现抛错）与
  `unavailable`（未安装）。全量模式（已清表）遇 `exception` **整体回滚**；
  增量模式（未清表）跳过即安全。`failures[]` 随响应透出（「哪些源没进来、为什么」可回答）。
- **名为增量、实为全量 → 逐源指纹真增量**：新增 `SourceSpec.fingerprint` + `sourceFingerprints`，
  重建写入逐源指纹、增量按源比对跳过。实测：无变化时 9/11 源跳过（3.8s，旧实现每次全量
  重灌 ~15s+）；只改一个源时仅重灌该源。
- **重建后缓存/统计不更新 → 跨线程失效重放 + 分片预热**：worker 有独立模块实例，
  `invalidateStatsCache`/`emitDataChanged` 在 worker 里只清 worker 自己的缓存 →
  主线程仍显示重建前旧统计（实测 `q=0` 假象）。改为主线程在收到 done 后重放失效，
  并用**分片预热**代替「一次性清空后让 N 个请求各算一遍」。
- **重建期读被写锁阻塞 → 只读连接（WAL 快照）**：同一连接参与写锁等待，bm25+JOIN 的
  重查询实测被拖到 5086ms。重建期另开 `readOnly:true` 连接服务读请求，结束时关闭；
  首次失败自动回落主连接重试（不让瞬时错误变成 500）。
- **请求路径上的同步 I/O 全部移除**：
  · 用户态写入（错题 upsert / 进度镜像 / 学习流水 / 检索流水）→ **写队列**
    （`enqueueUserWrite`：入队即返回、`setImmediate` 分片执行、单飞、容量上限）；
  · 生命周期日志 → **内存环形 + 2s 节流刷盘**（旧实现每次请求 `appendFileSync` +
    读整文件 + 可能重写 → 重建期实测把 `/api/status` 卡到 2316ms，现 8ms）。
- **事件订阅者未按实体过滤 → 过度失效**：`methodology.idxSlot` 任何广播都清空
  25 篇方法论索引（秒级成本）→ 重建后首次检索现场重建索引。改为声明关心实体
  （仅 `knowledge` 变化才清）。
- **`/api/status` 缺 `version`**：与 `StatusResponse` 类型声明漂移（沙箱实测发现）。
- **测试 harness 会破坏用户数据根**：`ensurePoolReady` 只要 `ready=false` 就 POST
  **截断全量重建**（`maxFiles:30/maxPapers:30`），而测试与主 profile 共用 `~/.dsh/kaogong`
  → 实测跑了测试后生产库从 86534 掉到 84284、`gk-tuxing`=0、`kadian`=0。
  改为「**库里有题就绝不重建**」（ready 是「质量达基线」不是「数据在不在」）。

### 新增
- `adapters/poolRebuildWorker.ts`（worker 入口：进度上报 + 结构化失败收敛 + 动态 import）。
- `poolDb`：`withTxAsync`（异步事务）、**事务嵌套深度感知**（`withTx` 内层不再提交外层——
  旧实现的嵌套 COMMIT 让「整库原子」根本不可能成立）、`clearPoolTables`、
  `enqueueUserWrite`/`writeQueueDepth`、`withReadConnAsync`/`setRebuilding`、`busy_timeout`/`synchronous=NORMAL`。
- `poolSources`：`fingerprintOf`/`sourceFingerprints`/`IngestFailure`/`IngestProgress`。
- `/api/pool/rebuild/status` 透出 `progress{phase,source,index,total}`。
- 检索响应重建期带 `degraded:'busy'` + 可操作提示（诚实降级，非掩盖）。

### 测试
- **50 文件 / 411 断言 + Loader 17/17 全绿**。
- 新增 `tests/unit/rebuild-safety.test.mjs`（5 项：原子回滚/清库位置/真增量/事务嵌套/故障分类）
  + `C61-RB-01..04`（worker 执行/进度透出/只读连接/写队列与生命周期内存环形）。
- 重写 `SMOKE-KERNEL-10`（逐源指纹口径）。

### 沙箱与真机验证
- **沙箱重建压测**（独立 profile @3193，全量 145s）：1208 次宿主探针**零失败**，
  信标 8ms / 能力矩阵 13ms / 数据域 32ms / 缓存 4ms / 取题 618ms / 真题卷 47ms / 专题 733ms。
  逐阶段检索计时：**全程 2–13ms**（证明只读连接生效）。
- **沙箱用户旅程 27/27 通过**（取题/判分/错题本/回炉升箱/真题卷 1683/单卷详情/专题四类/
  申论/图推 354/方法论 25 篇/知识检索/方法参考/补录/统计/计划/排程/图谱/遥测/缓存/数据域/池健康/多版本）。
- **真机热更新**（`plugin_manager` 停用→启用，fiber 重挂载）：回归 **10/10 全通过**
  （信标 v1.34.0 / 数据域 6/6 / 缓存白盒 / 重建作业 / 取题 / 真题卷 1683 / 图推 354 / 统一检索 / 错题本 / 计划）。
- **真机增量重建**（79s）：1362 次探针**零失败**，统一检索最大 576ms，数据完好（87434 题）。

## [1.33.0] - 2026-11-26

**统一架构收敛（cycle-61 · 六层收口）**：把「数据 / 检索 / 缓存 / 取题 / 错题补录 / 前端」六层
写成同一组代数结构的不同投影，每条不变量都有机器守卫。设计与依据：`docs/research/26-统一架构数学模型v9.md`
+ `docs/research/27-数据层库表设计v9.md`。

### 破坏性变更（行为层）
- **运行期外源直读已物理删除**（不再是「门控回落」）：`.naoku.db` / 真题卷 md / 图推 data.js /
  三仓 md / 方法论语料目录**只在摄入期被读取**。域未就绪时由 `dataGate.ensureDomain` 按需摄入后重读，
  仍不可用则返回**结构化未就绪**（含可操作提示），不再回落到外源。
- **错题本权威方向反转**：库为权威读源，`progress` JSON 为兼容镜像（原为 JSON 权威 + 库影子）。
  响应新增 `tier`（db/json/none）标注来源。

### 新增
- **统一数据层（schema v9 / 26 表）**：管理域实体化 —— `practice_session`（刷题会话）/
  `import_batch` + `import_item`（补录台账）/ `ingest_job`（题库作业归档）/ `app_setting` /
  `migration`（迁移台账）/ `entity_attr`（零 DDL 扩展属性）/ `search_event`（检索流水）/
  `snapshot`（派生快照入表）/ `knowledge_fts`（方法论检索零外源直读）；`wrong_book` 补
  `canonical_id/kadian/dims/first_at/lapses/srs_due_at/last_result/origin_batch`（可 SQL 诊断）；
  `source` 补 `health/last_ingest_*/question_count`（状态机而非布尔）。
- **域注册表** `shared/domains.ts`：六域 × 摄入源 × 就绪谓词 × 归属视图 × 等待策略（sync/background）。
- **统一数据门** `server/dataGate.ts`：按域就绪判定 + single-flight 按需摄入 + 60s 冷却；
  重量级域（真题卷实测 149s / naoku 数十秒）走后台模式，前端轮询 `/api/data-domains`。
- **统一缓存层 v2**：快照（昂贵计算物化）+ 失效图（级联）+ 命中率/快照/策略白盒（`/api/cache`）；
  新增 `server/dataEvents.ts` 作为**写入路径的单一失效触发点**。
- **统一检索层 v2**：聚合检索（`providers=a,b,c`，round-robin 交替合并、保留各组原序、不跨源比分数）
  + 检索流水（provider 维度调用数/空命中率/耗时）+ provider 域归属白盒。
- **统一取题层**：`kernel.quotaPlan`（配额守恒 + 让渡）/ `weightedPickIndex`（加权无放回）/
  `moduleWeakness`（先验由调用方声明）；四层抽题配额与 SRS 模块选择全部收敛到内核。
- **统一错题与补录层** `server/reviewStore.ts`：库优先读 + JSON 降级、单条幂等 upsert、诊断分桶
  （按模块/考点）、撤销软删保审计痕迹。
- **前端视图注册表** `client/view-registry.ts`：视图元数据单一事实源（label/icon/group/order/domain/desc），
  导航由 `buildNavGroups()` 派生；白盒新增「数据域就绪矩阵」「统一缓存」两卡。
- 端点：`/api/data-domains`、`/api/cache`。

### 修复（本轮由不变量守卫抓出的真实缺陷）
- **新列索引写进建表脚本 → 整库降级**：`wrong_book` 的 v9 新列索引写在 `SCHEMA_SQL` 里，旧库
  `exec` 抛 `no such column` → `openPoolDb` 降级、所有域读不到数据（tsc/单测全绿也发现不了）。
- **pool provider 恒空**：registry 取 `ctx.pool` 而装配对象键名是 `poolApi` → 异常被 catch 静默收敛成
  空信封（直连 `/api/pool/search` 正常，`/api/search/unified?provider=pool` 恒 0）。
- **空结果被缓存**：数据未入库导致的空命中被缓存 30s → 用户装好题库后仍搜不到。
- **失效图漏两域**：`paperIndex` / `tuxing` 无人清 → 改数据后仍读旧值。
- **单查缺 `provider` 标注**：单查与聚合同形不成立，消费方需写两套渲染。
- **配额不守恒**：逐层手写 `Math.min`，`count=1` 可能返回 2 题。
- **单侧删除**：`/api/wrong/remove`、`/api/history/undo` 只改 JSON → 读路径库优先时「删了又回来」。
- **镜像列清单落后**：`mirrorProgressToDb` 整本替换洗掉 `origin_batch`/`historical` → 补录来源消失。
- **`/api/status` 缺 `version`**：与 `StatusResponse` 类型声明漂移（沙箱实测发现）。
- **`/api/methods` 主题清单漂移**：改由 `METHOD_MAP` 声明 + 库存在性判定（此前直接返回库里
  11 条 `kind='skill'` 节点，其中 `SOURCES.md` 不是主题）。

### 测试
- **49 文件 / 402 断言 + Loader 17/17 全绿**（重构前基线 46/355）。
- 新增：`taking-kernel`（10）、`review-store`（9）、`data-events`（5）、`cache` +4、
  检索运行时 +4、取题运行时 +3、错题补录运行时 +4、视图注册表 +5、渲染 +2、研究文档守卫 +1。
- 重写 9 条锚定「已删除回落分支」的旧断言；回归守卫统一「去注释后判定」，避免注释里的
  历史说明被误判为复辟证据。

### 沙箱验证（独立 profile，主 profile 全程未动）
- 独立 profile `sb-kg-v9`（junction link 到开发仓）+ 独立端口 3191，启动日志无插件错误。
- **用户旅程 27/27 通过**：取题/判分/错题本/回炉升箱/真题卷 1683/单卷详情/专题四类/申论列表/
  图推 354/方法论 25 篇/知识检索/方法参考/补录入账撤销/统计/计划/排程/图谱/遥测/缓存/数据域/池健康/解析多版本。
- 6/6 数据域就绪、82 端点、16 视图、能力对账 `consistent: true`；沙箱已清理，主 profile 8400 正常。

## [1.32.0] - 2026-11-21

### TS 严格化（测试体系与代码质量）
- **noUnusedLocals: true 开启**（档①）——69 死声明清零（未使用 import 36/interface 补注 9/局部变量 22 逐条核对）
- **strictNullChecks: true 开启**（档②）——218 错 13 批清零（null 初始化标注/never 数组 any[]/Map.get 非空断言/safeAll·safeGet·loadPaper 返回类型根因修）
- 两条 TS 控制流根因发现固化：return [] 字面量推断 never[]；params 默认 [] 推断 never[]
- React Props 类型化 29/29 全覆盖；ObsFlowChart key 警告根治；radiusBoost 冗余闭包态治理

### 测试体系（大单文件退役 → 分域体系）
- 4173 行双单文件退役 → tests/ 35 文件分域体系（276 vitest 断言）
- 目录：_harness（server/render 共享设施）/ unit / smoke 27 域 / render 7 旅程 / e2e loader
- strictNullChecks 渐进路线与 barrel 形态纪律固化进 UI-GUIDE.md 第七~九节

### UI 规范
- docs/agents/UI-GUIDE.md 固化（颜色 token/交互反馈/降级语义/组件复用/取数 hooks 六节）
- 文字色 token 化 253 处（暗色主题适配）；全局可点反馈 CSS 规则；取数 hooks（useApiData/useApiMany）

### 修复
- poolSourceKnowledge TS2783 展开顺序语义修正（skipped 覆盖真实 bug）
- ObsView 渲染 key 警告根治；radiusBoost 冗余闭包态治理

## [1.31.0] - 2026-11-20

### 修复

- **issue #6 · Windows 题库管理全功能失效**：`isInside()` 原用 `b + '\\\\'`（两字面反斜杠）判前缀，
  Windows `resolve()` 返回单 `\` → 安装/删除/浏览 100% 报「路径越界」。改用 `path.relative`
  语义判定（`rel === ''` 视为同一路径，兼容大小写不敏感），一处修复覆盖三调用点；
  `SMOKE-ISSUE6` 固化 13 组边界（子路径/自身/穿越/裸../兄弟/跨盘/混合/末尾/大小写/UNC）。
- **IMG-04 间歇假红**：池抽题带图优选从「概率补捞」升级为两级确定性配额（L1 带图层 ⌈n/2⌉ +
  L2 五维 + L3 兜底），`/api/pool/questions` 结果层顺序扫池必达 + 带图稳定分区截断；
  断言升级为「带图 ≥ ⌈n/2⌉」确定性下限（20 轮实测全 5）。
- **`source`/`kadian` 抽题过滤越界**：带图补足路径原只按 module 过滤（实测 `source=qiuzhao`
  10 条中 5 条主源是 xingce-app）。补 `imgPoolFilter` 谓词，三过滤维度统一 honour。
- **练习卡五维标注未透传**：`study-view` 组装练习卡时漏传 `dims` → 五维块不渲染。已补
  `dims: x.dims`（API 与共享卡早已支持，缺的只是这一处映射）。
- **孤儿出处**：cf 归并/覆盖后残留 `question_source` 指向不存在的 canonical（实测 1987 条）。
  rebuild 后自动清理，守卫 `SMOKE-POOL-02b` 保证不变量。

### 新增

- 统一存储主线（cycle-34~42 累积）：SQLite 统一池 `~/.dsh/kaogong/.kaogong.db`——跨源内容级
  去重（140465→86454 题）、出处全标记（229732 行）、解析多版本（141121 行，`/api/pool/analysis-versions`）。
- 端到端：gwy-zhenti 89254 出处入池、跨源检索源多样性轮转、客户端暗色/亮色主题适配。

### 工程 / 规范

- 新增 `CONTRIBUTING.md` / `.github/PULL_REQUEST_TEMPLATE.md` / `docs/agents/BRANCHING-STRATEGY.md`
  —— 确立 `develop` 为统一开发主线，`main` 为发布线。
- 仓库卫生：恢复 `.gitignore` 的 `.cycles/*` 排除规则（`config.yml` 除外）；`cordis.local.yml`
  与 `data/progress.json`（开发态数据）不入库，提供 `.example` 样例。
- 版本三锚点同步 1.30.0 → 1.31.0（`npm run version:bump`）。

## [1.30.0] - 2026-11-14

- issue #3 补录可用性根治（真题卷全文第三通道）+ 错题本工作台。（详见 git tag v1.30.0）
