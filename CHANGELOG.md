# 变更日志

本文件记录 dsh-kaogong 的版本级变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.36.0] - 2026-11-28

**图片搜题（issue #4 阶段 4）** —— 从「手打关键词搜」升级为「上传题目图片 → 模型读图 → 匹配原题」。

### 新增（功能四件套）
- **上传图片 → 结构化抽取**：`POST /api/img-search/analyze` 把 base64 图片经 `ctx.attachments.admitPromptContent()` 持久化为不可变引用，构造 ImageBlock 交 `ctx.llm.stream()` 做结构化抽取（题干 / 图表数据 / 图形规律特征 / 模块 / 题型），JSON-only 提示词 + 容错解析（教训㉜ 只裁尾不臆造）。
- **统一检索匹配原题**：`POST /api/img-search/match` 把抽取结果拼成检索词（资料分析优先图表数据、图推优先规律特征），复用 `/api/search/unified` 的 `searchMany` 跨源 round-robin，零算法复制。
- **模型自选 UI**：`GET/POST /api/img-search/models` 从 `ctx.llm.listProviders()/listModels()` 派生 provider/model 下拉，走宿主路由零自建凭据；`imgsearch` 视图（专题枢纽入口，viaHub）提供上传/预览/识别/命中列表/加入错题本全流程，四态诚实降级（无模型/识别失败/无匹配/题库未装）。
- **加入错题本非假按钮**：命中题经 `/api/history/search` 定位完整题对象（含 contentSig）→ `POST /api/history/entries` 按补录形状入库；定位不到给「查看原题」出口，绝不造半题。
- **前置门（PR #15）**：`inject` 扩 `['tools','llm']`，R11b 三重验证（boot 图 dump + Loader 18/18 + 独立沙箱实测）。

### 架构（低耦合高内聚）
- 新增 `src/host/ai-bridge.ts`（唯一触碰宿主 AI 服务处，duck typing 零宿主包 import）+ `src/server/imageSearchApi.ts`（独立域，AI 能力经 options 注入，依赖反转）——server 层不 import 任何宿主包，保持零 npm 运行时依赖。
- provider/model 白名单校验（兑现安全契约）；finish 错误兼容 `reason` 权威形状 + 旧 `kind` 形态（不吞错）；不回显 OCR 原文防泄露。

### 守卫与验证
- 新增 `IMGSEARCH-01..05`（smoke）+ `IMGAPI-01..07`（单测）+ `BRIDGE-01..05`（单测）；combo 26 模块 assert-combo OK。
- `npm run build` + `npm run test:all` 全绿（**57 文件 / 459 断言** + Loader 18/18）；`docs:check` / `facts:check` 绿。
- **验证边界（诚实登记）**：链路端到端已测（沙箱 models 返回真实 provider `deepseek-official`/`deepseek-account`、analyze 走 attachments 真实校验），但**真实模型图片识别准确率未测**（沙箱无用户模型凭据）——需用户用真实截图验收。

### 关联
`BL-API-03` / `BL-PROC-11` · Closes #4

## [1.35.0] - 2026-11-27

**架构漂移治理（低耦合高内聚）** —— 消灭「声明 vs 运行态」不一致的三类漂移面，并修复 develop 血缘断裂。

### 重构（单一事实源）
- **图片 MIME 白名单收敛**：新增 `src/shared/media.ts`（`IMAGE_MIME` / `imageMime`，冻结常量 + 幂等归一），
  四处逐字重复的本地表（`server/http.ts` `KG_IMG_MIME`、`server/paperApi.ts`、`server/naokuApi.ts`、
  `adapters/tuxing.ts` 的 `MIME`）全部删除改为 import。杜绝「同一张图这个端点 200、那个端点 415」的分裂。
  行为等价：六键映射逐字一致、`toLowerCase` 幂等、403/404/415/500 判据与 Content-Type 值均未变。
- **能力对账 consumer 词表**：`manifest.ts` `/api/repos/jobs` 的 consumer `ui:obs` → `ui:observability`
  （全仓真实视图 id），消除对账恒判「消费方不存在」的假漂移（v1.8 遥测事故同族）。

### 修复（流程与文档）
- **develop 血缘回灌**：develop 曾落后 origin/main 4 个提交（v1.34.4 发布 bump 未回灌），违反
  `BRANCHING-STRATEGY §6.3`「发布后必须回灌」→ 下次 release PR 会再断裂。回灌冲突取 develop 功能超集，
  保留 tag 推送识别与 SEC-DIST-01 守卫。
- **文档历史快照标注**：`ARCH-CONVERGENCE-BASELINE.md` 的 cycle-49「现状」段与同文件 ✅ 完成记录自相矛盾，
  `ROADMAP.md` 表头仍写 v1.30.0 当前状态，README 自检示例写死 `1.34.0` → 均标注「历史快照 + 当前事实源指针」，
  版本号不再写死。

### 守卫与验证
- 新增 smoke `C70-CONS-01`（禁 `ui:obs` 复辟）/ `C70-MIME-01`（MIME 单一事实源，四端点必走 imageMime）；
  两者均做负向验证（注入违规 → 准确变红 → 恢复绿）。
- `typecheck` / `build`（25 模块 combo）/ `test:all`（55 文件 / 447 断言 + Loader 17/17）全绿。
- 四员评审 PASS（无 blocker/major），报告见 `docs/agents/reviews/2026-11-27-架构漂移治理.md`。

### 关联
- `BL-DOC-05` / `BL-API-02` / `BL-PROC-10`；issue #4（仅进度同步，未改 inject）/ issue #5（事实更正，待关闭）。

## [1.34.4] - 2026-11-27

**深度题库视图退役收尾 + 市场评审指出的安全缺陷修复。**

### 安全（市场评审反馈 · 真实缺陷）

上游 awesome-dsh-plugin 条目维护者追加评语：

> Its HTTP routes have no DSH access check, so a web page open in your browser could call them.

核实属实：独立端口（宿主 `webServer` 缺席时的兜底通道）无条件使用
`Access-Control-Allow-Origin: *` —— 配合「只绑 127.0.0.1」，看似仅本机可访问，
实际**用户浏览器里打开的任意网页**都能 `fetch('http://127.0.0.1:8400/api/…')`
读到本地题库数据、甚至 `POST /api/check` 写学习进度。

修法：

- **CORS 改为回环来源白名单**（`127.0.0.1` / `localhost` / `[::1]`），
  回显具体 Origin 而非 `*`（`*` 会让任何站点都能读响应）。
- **变更类请求（非 GET/HEAD/OPTIONS）来源非法直接 403** ——
  CORS 只防「读响应」，防不住「写副作用」，必须服务端拒绝。
- 宿主同源通道（主通道）不受影响：它本就继承宿主认证、无 CORS。

实测：跨站 GET 无 `Access-Control-Allow-Origin` 头（浏览器读不到）；跨站 POST 403；
同源读写正常。守卫 `SEC-CORS-01` 固化。

### 修复（深度题库视图退役后的残留）

- **细分题型落点改回刷题页**（用户报「点击没有跳转到对应细分题型的刷题页面」）：
  上一版落点误设为 `pool`（统一题库的检索/查看页）——用户点「片段阅读」被丢进数据浏览器。
  现落点 = `practice` + `category`，挂载即开一张该题型的卷；
  并补 `CAT_MODULE` 映射回填 module（否则会停在「选择练习模块」页）。
- **细分题型出题准确性**（用户报「细分题型有问题」）：
  ① 曾用 `pool/search?q=题型名` 全文检索 → 实测「定义判断」5 条仅 1 条真属该题型；
  ② 改按 `category` 等值后又漏 `qtype`（5.9 万题 `category` 为空）→ 题量腰斩；
  ③ 带图补足未 honour 题型过滤 → 插队杂题。
  现按 **`category` ∪ `qtype`** 精确过滤，带图补足谓词同步，实测 10/10 准确、
  题量回到真实值（逻辑判断 2478→5220、片段阅读 3319→6396）。
- **删除死代码** `src/server/topicTree.ts`（v9 迁池后零引用）。
- **manifest**：补登记 `pool` 视图（一级导航有它但声明缺失 → 能力对账假漂移）；
  清理 15 处指向已删视图的 `ui:deepbank` 消费者声明与 `deepbank` 视图登记。
- **README 文案校准**：5 处仍把深度题库当独立功能 → 改为「五维标注刷题（已并入统一题库）」。

### 变更（答题卷）

- **SRS 与随机抽题统一为「每次固定 10 题一张卷」**（用户要求）：
  进度显示 `第 x/N 题`；答完最后一题 → 「✅ 本卷已答完 · 再来一张」+ 完成横幅
  （`🎉 本卷（10 题）已完成：答对 7/10 题`）。不再答完一题自动续抽
  ——否则用户永远不知道这一轮有多少题、何时结束。

### 测试

- **55 文件 / 443 断言全绿**；`facts:check` + `docs:check` 绿。
- 新增守卫：`SEC-CORS-01`（禁通配 CORS + 写请求拦截）、
  `TC-01..03`（细分题型渲染与跳转刷题页）、`v1.34.4`（题型出题准确性）、
  `v1.34.4b`（落点静态守卫 —— render 用 mock 测不到服务端落点变化）。

## [1.34.3] - 2026-11-26

**深度题库收敛进统一池（端点 82 → 79）** —— 消除「同一能力两套端点」的漂移面。

### 背景（为什么退役）

深度题库视图原消费 `/api/naoku/*` 六个端点。v9 统一数据层改造后，这些端点的
**数据层已经完全是统一池**（`poolNaoku` 读层，源码级「只有一条读路径，绝不直读 `.naoku.db`」），
于是形成双端点冗余：能力对账要维护两份声明、消费方无从判断该走哪一套、
白盒面板出现两套同源指标的假漂移风险。

### 新增（3 个池端点 · 补齐池原本缺失的语义）

- **`GET /api/pool/kadians`**：考点清单 / 关键词检索
  （`?q=` 按词检索 → `{kadian,category,module,count}`；无 q → 分类清单，`k` 与 `kadian` 双写兼容旧形状）
- **`GET /api/pool/by-kadian`**：按考点反查题目（`?kadian=&count=`，支持模糊匹配）
- **`GET /api/pool/papers-by-kadian`**：考点→试卷反查（`?category=&limit=`）
- **`GET /api/pool/questions` 新增 `?has=` 过滤**：`mother|pitfalls|reasoning|fastest|analysis|kadian`
  逗号分隔表示「任一非空」（`LENGTH(col)>0`），列名走白名单防注入。
  替代原「取 20 题再客户端过滤」的浪费路径。

### 退役（6 个 `/api/naoku/*` 端点）

`status` / `questions` / `kadian` / `practice` / `papers` / `categories` 全部移除——
抽题与状态原语本就由 `/api/pool/questions`、`/api/pool/status` 覆盖，不重复造。

**保留 `/api/naoku-img`**：图片是**媒体引用**（L3 不做 BLOB 的既定决策，按 `rel_path` 取流），
不属于「题目事实直读」，与 I-DB-1（题目事实只走池）不冲突。

### 修复（顺带）

- **`poolRowToNaoku` 缺题号与材料字段**：原映射无 `no`/`number`/`groupMaterial`——
  深度题库/按考点刷题的题因此题号显示 `?`、材料整段丢失（与 cycle-62 七段修复同源）。
  补 `no`/`number`（取卷内 `seq`）、`groupMaterial`/`groupMaterialNo`。
- **`searchRegistry` 的 kadian provider** 端点改指 `/api/pool/kadians`
  （provider id 保留 `kadian`——对外检索源标识，改 id 会破坏既有消费与对账）。

### 消费面改动（客户端 8 处）

`study-view`（5 处）与 `papers-view`（3 处）全部改走池端点；UI 零功能变化
（`k`/`kadian` 双写 + `has` 过滤使改动对渲染层透明）。

### 守卫同步（7 处）

端点计数（82→79）、`C60-FRESH-03` 重写为「收敛后形态」（断言 handler 已删、
3 个下沉端点存在、图片服务保留）、`C60-02`/`C60-RT-01`/`SEARCH-04` 端点清单对齐、
`R-N-01` 改池端点口径、render harness mock（naoku mock 平移为 `pool?source=naoku` + `by-kadian`）。

### 测试

- **54 文件 / 435 断言全绿**；`facts:check` + `docs:check` 绿。

## [1.34.2] - 2026-11-26

**题目七段渲染字段错配根治（用户报「来源/题型/题号/材料/题干/选项/答案/解析 组件化显示有问题」）**

### 修复（三处字段名错配 · 同时静默生效）

服务端 `/api/questions`、`/api/pool/questions` 出站用的是**池原生字段名**，
而渲染层读的是另一套名字 —— 三处读错同时生效，每一处都让整段内容消失：

- **题号恒 `?`**：`QwNumberBadge`/`QwQuestionCard` 读 `q.no`，服务端出站发 `number`
  （且硬编码为 0）。修法 = 服务端出站 `no` 与 `number` **同取卷内序号**（`seq`，
  76,240 题有值）；**专题/模考/整卷一律用答题卡位置号 `current + 1`**（用户确认口径：
  以答题卡显示列表为准，避免与答题卡格子序号自相矛盾）；组件侧 0/空不臆造编号。
- **答案永不显示**：`QwAnswerDims` 读 `q.answer`，服务端发 `correctAnswer`。
  修法 = `correctAnswer` 优先 + `answer` 回落（兼容真题卷/旧快照），
  且 `hasPlain` 与答案行**同源判据**（`answerText` 收敛），避免「答案在但守卫说没有」。
- **材料永不显示**：`QwQuestionCard` 读 `q.material`，服务端发 `groupMaterial`。
  修法 = `groupMaterial` 优先 + `material` 回落。

### 修复（真题卷单卷七段）

- `QwPaperMode` 题目卡**只透传 `answer`** → 卷内答题（专题/模考同源路径）答案行不显示。
  修法 = `answer` 与 `correctAnswer` 双写透传。
- 真题卷单卷页原只给 `QwQuestionCard` 传 4 个字段（no/score/stem/requirement）
  → 选项/答案/解析/材料全不渲染；修法 = 传七段全集。
- 「你的作答」申论文本域原先**对行测选择题也显示**（误导用户「这题要写作文」）→
  新增 `hasEssayForm` 判据（有作答要求 或 无 A–D 选项才是主观题）。

### 修复（服务端字段完整性）

- `poolQuestionDetail`：SELECT 补 `seq`；`dims` 补 `analysis` 槽位（五维「解析」卡片
  与其它五维样式同构，不再走裸回落分支）。
- `sampleQuestions` 的 `SELECT_COLS` 补 `seq` 与 `material_ref`（题号/材料副标题的前置物）。
- 三条出站投影路径（toLegacyShape / 带图补足 / poolQuestionDetail 映射）全部发 `no + number`。

### 新增守卫（均经变异测试验证「回退修复必红」）

- `tests/smoke/question-render-fields.test.mjs`（8 断言）：服务端出站字段完整性、
  禁硬编码 `number: 0`、`SELECT_COLS` 必取 seq、`QwQuestion` 类型覆盖七段全字段、
  组件禁读未声明字段、答案/材料双写法兜底。**`QwQuestion` 类型补齐**是本次根治关键——
  类型没声明的字段，`strict` 编译期发现不了「读不存在的字段」。
- `tests/render/qw-seven-segments.test.mjs`（7 断言）：专题练习七段逐段断言（含防偷看图语义）。
- `tests/render/paper-single-question.test.mjs`（3 断言）：真题卷选卷 → 翻第 2 题 →
  编号/题型/题干/选项/答案/解析齐全。
- render harness 的 `/api/questions` 与 `/api/pool/questions` mock **升级为服务端出站同形**
  （七段全集）——原 mock 字段名恰好与组件读的一致，导致这类缺陷测试全绿。

### 测试

- **54 文件 / 435 断言全绿**（新增 3 守卫文件 / 18 断言）。

## [1.34.1] - 2026-11-26

**CI 长期红根治 + 2 个生产缺陷修复（BL-TEST-05）**：CI 自 2026-11-21 起持续红（25 个文件 /
54 个断言），根因是**测试断言的是环境而非被测行为**——CI runner 上没有题库数据。

### 修复（生产代码 · 影响运行时）

- **naoku 源可用判定自锁**：统一池摄入需要上游投影库 `.naoku.db`，但该库**只由
  `ensureNaokuDb` 合并分片产生**，而合并在 **ingest 阶段**才触发——`available` 探针只认
  投影库 → 「从未访问过深度题库端点」的用户/CI 在探测阶段就判定源不可用 → 压根走不到
  ingest → 永远合不出来（池少 27,506 题五维标注 + kadian 边）。
  修法 = 可用判定改为「投影库 **或** 上游分片任一存在」+ 摄入阶段自动合并
  （`ensureNaokuDb` 对外可见）。**实测**：池五维 0 → 27,497，kadian 边恢复。
- **数据根绝对路径判定跨平台错误**：`/api/repos/config` 的 root 校验原用
  `resolve(raw).startsWith('/')` 兜底——在 **Linux 上 `resolve('relative/path')` 返回
  cwd 下的绝对路径且以 `/` 开头** → 相对路径被误判为合法 → 配置落盘后数据根指向意外位置。
  修法 = 改用 `path.isAbsolute`（跨平台正确）。**守卫**：SMOKE-RM-05（CI 实测红）。

### 修复（测试基建 · 不改运行时行为）

- **render harness 硬编码开发机路径**：React 依赖原写死 `../_kgtest/node_modules` →
  CI runner 上不存在 → 7 个 render 旅程文件整体失败。修法 = React / react-test-renderer 进
  **devDependencies**（**不进运行时依赖面**，`dependencies` 仍为空），harness 改
  「本仓 node_modules 优先 · 开发机路径回退」。
- **rebuild-safety 测试离线自足**：原依赖开发机上级目录的真实题库仓 → CI 上基线库为空 →
  断言红。修法 = 测试自建 fixture 源（恒可用 + 自己写入题/边）注入 SOURCE_REGISTRY，
  走**生产的 `rebuildPool` 全路径**（含故障闸 + `rolledBack` 标记）——完全离线自足，
  且本地覆盖一字不减。
- **npm pack JSON 解析**：`npm pack --dry-run --json` 的输出前缀随 npm 版本变化
  （Node 22 + npm 10 与本机不同），原 `indexOf('[')` 截断会截到警告行里的方括号 →
  JSON.parse 失败 → 打包卫生断言假红。修法 = 定位**顶层数组起点**（`[` 后紧跟 `{`）。
- **占位图 403 判读**：服务端对绝对路径 / 越级引用返回 403 是**安全模型正确生效**，
  但测试随机抽题 → CI 与本机抽样不同 → 偶发假红。修法 = 区分 403（安全拒绝，降级）/
  404（实体缺失，降级）/ 200（实质断言）。

### CI（从「长期红」到「首次全绿」）

- **CI 装全量题库 + 一次性建池**：`scripts/ci/question-banks.txt`（题库清单单一事实源）
  + `scripts/ci/build-pool.mjs`（建池，须在 Build 之后跑——`dist/` 由 build 产出且不入库）。
  **测试代码零改动**（对比方案「给 12 个测试文件加环境降级守卫」被弃用：漏一处 CI 就红，
  且本地覆盖被悄悄削弱）。
- **并发克隆 + 稳定 cache key**：9 个题库仓并发克隆（串行数分钟 → 约 1 分钟）；
  cache key 用**题库清单文件哈希**（改 workflow 不会让 1.9GB 缓存失效）。
- **CI 实跑全绿**：建池 68.2s（题 87,768 · 关系 583,993 · 出处 230,871 · 五维 27,497 ·
  带图 5,960），**51 文件 / 417 断言全过**（此前 25 文件 / 54 断言红）。

### 新增

- `tests/smoke/market-entry.test.mjs`（6 断言）：市场条目规范守卫（字段集合 / 禁 `npm:` 键 /
  `description.en` 单行句号结尾 / icon GitHub 位图 / category 词表 / **描述数字与 manifest
  事实源一致**）——此前 `MARKETPLACE-ENTRY.md` 声称有守卫但实际没有（文档漂移）。
- `scripts/ci/question-banks.txt`（题库清单单一事实源）、`scripts/ci/build-pool.mjs`（CI 建池）。
  两者**均不进 npm 包**（`package.json files` 只白名单 3 个 scripts 文件）。

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
