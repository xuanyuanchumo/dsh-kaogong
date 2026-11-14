# 事故簿（R1–R25）

> 每条都含：现象 → 根因 → 修复 → **守卫**（防止再次发生）。
> 新增事故请追加，并在 `smoke.test.mjs` / `render.test.mjs` 落对应断言。

## 平台/崩溃类

### R1 · cycle-0：EADDRINUSE 击杀宿主
- **现象**：外部进程占用 8400，插件启动时宿主进程直接消失。
- **根因**：`server.listen()` 的 `EADDRINUSE` 是**异步 error 事件**，`try/catch` 捕不到 → 未捕获异常击穿进程。
- **修复**：所有 `listen/bind` Promise 化，`.catch` 后换端口（8400–8404）。
- **守卫**：smoke「崩溃安全：外部占用 → 自动换端口而非裸抛」。

### R4 · `el(tag, null, ...)` 系统性崩溃
- **现象**：图谱/计划/可观测三视图全崩，smoke 全绿。
- **根因**：JS 默认参数 `p = {}` 只对 `undefined` 生效，显式传 `null` 直达 `Object.entries(null)` 抛错。
- **修复**：`Object.entries(p || {})`。
- **守卫**：smoke 静态断言「UI el() 含 null 守卫」「无裸 Object.entries(p)」。

### R6 · 小写 `onclick` 被静默吞掉
- **现象**：v1.2 起 tab 重试/外链按钮全部失效，无报错。
- **根因**：React 认 `onClick`（camelCase），`onclick` 既非标准属性也不报错。
- **守卫**：约定 + 真机点击验证。

### R7 · 模块级 runtime 跨热重载竞态
- **现象**：热重载后路由 404；或新代跳过挂载。
- **根因**：新代 `apply` 早于旧代 cleanup 运行，旧 cleanup 通过共享 `runtime.unmount` 误卸新挂载；新代读共享 `runtime.mounted` 直接跳过。
- **修复**：本代资源全部闭包局部变量；cleanup 只清自己那代；重复注册抛错 → 600ms 重试一次。
- **教训**：**任何「模块级可变状态 + effect cleanup」组合都是热重载竞态源**。

### R9 · 宿主 GUI 白屏（最严重）
- **现象**：切视图 → 整个 Host Web GUI 崩溃，用户感知「宿主崩了」。
- **根因**：把含 `useState` 的 Native 子视图**当普通函数直调**（`data.kind==='practice' && NativePractice({...})`）→ 子的 hook 记到父链上，视图切换使父 hook 数变化 → `Rendered more hooks than during the previous render`。
- **修复**：子视图一律 `h(Comp, props)` 真组件挂载 + `key={view+tick}`；外层 `KaogongErrorBoundary` 兜底。
- **守卫**：render.test 复现 v1.4 抛错 + 断言 v1.5 零崩溃；smoke 静态守卫（禁直调 / 须挂载 / 须有边界）。

### R8 · 独立端口畸形请求
- **根因**：独立端口没有宿主 webServer 的 400 兜底。
- **修复**：`buildHttpServer` 回调整体 `try → 400` + `server.on('clientError')`。

## 兼容/加载类

### R10 · 同源路由静默 404
- **现象**：Host 日志一切正常（"路由已挂载"），但 `/kaogong/*` 全 404。
- **根因**：`webServer` 是**懒到达**服务，首启 `ctx.get('webServer')` 拿不到；`ctx.on('webServer', …)` 不是事件，永不触发。
- **修复**：`ctx.inject(['webServer'], (injected) => { ...; return unmount })`——服务就绪才跑，disposer 归框架。
- **教训**：沙箱首启才暴露；主力热重载路径曾长期掩盖此 bug。

### R11 · Client 半从未加载（裸 ESM）
- **现象**：GUI 顶部 `Failed to load plugins` + `Unexpected token 'export'`。
- **根因**：client 半写成裸 ESM；宿主组合加载器要求 **combo factory 格式**。此前所有「插件已加载」日志都来自 Host 半，Client 半从没进过 GUI。
- **修复**：`window.__ModuleLoader__.load({ id, factory(require) { ... return { inject, apply } } })`；样式不依赖 `styles` 全局。
- **守卫**：smoke「client 为 combo 格式（无顶层 export）」「combo factory 返回 {inject, apply}」。

### R11b · 条目永不激活
- **现象**：`web boot: 1 entry did not activate`，无更多信息。
- **根因**：`dsh.client.inject` 声明了 boot 图里**不存在**的包（`@deepseek-ai/dsh-client-ui-slots`——slots 由内核提供）。
- **修复**：只声明实存包。排查法：浏览器 `window.__DSH_BOOT__.entries` 逐个核对。

### R13 · 深嵌套三元括号错配
- **现象**：改视图后 `node --check` 报 `Unexpected token ')'`，反复修括号修不完。
- **根因**：视图内 5 层嵌套三元 `a ? (b ? (c ? …) : …) : …`，人工维护括号不可靠。
- **修复/规范**：改「**提前 return + 分块构造**」——分支用 `if (...) return ...`，内容先构造 `const blocks = []` 再拼装。

## 渲染/数据类

### R12 · prop 形状不匹配 → 面板降级
- **现象**：点「图谱」→ `⚠️ 面板渲染降级: Cannot read properties of undefined (reading 'V')`。
- **根因**：`h(NativeGraphView, { data })` 传整包 `{kind, g}`，组件解构 `const { metrics } = props.data`（期望已解包的 `g`）。
- **修复**：`data: data.g`。
- **守护**：render.test mock 全端点**真实形状** + 每次切换断言无 `role="alert"`；已做变异验证（回退该 bug 测试必失败）。
- **教训**：ErrorBoundary 只保证「不白屏宿主」，**面板自身正确性必须靠测试**。

### R14 · 视图覆盖不全（教训，非独立事故）
- render.test 最初只点 真题卷/专题/申论，导致 R15 未被发现。
- **规范**：**新增/重建任何视图，必须同时加 render 断言**。

### R15 · 组件定义被脚本误删
- **现象**：宿主内一点面板就降级：`NativeDeepBankView is not defined`。
- **根因**：用 `indexOf` 切片重写专题视图时，把位于其间的 `NativeExamView` / `NativeDeepBankView` 定义一并删掉；引用还在。语法检查通过、smoke 通过、render 当时未覆盖这两个视图 → 真机才发现。
- **修复**：重建两组件（改用分块构造写法）+ render 补「模考/深度题库零降级」断言。
- **守卫**：render.test「模考/深度题库视图零降级（R15 守卫）」；已做变异验证。
- **教训**：
  1. **禁止用 `indexOf` 切片做结构性改写**——改用 AST 或精确定位块边界 + 改完立即 grep 关键符号计数。
  2. 结构性改动后必须核对「引用数 vs 定义数」。

## 数据类

### D1 · 试卷索引只覆盖国考
- **根因**：固定两层遍历，实际 3–4 层。
- **修复**：递归限深 5 + 文件名形态过滤（`^(申论|行测)-`）。

### D2 · 材料解析为 0
- **根因**：前瞻 `(?=\n##\s*[^给])` 在第一个 `###` 前误截断。
- **修复**：改为「截到下一个 H2」。

### D3 · 4 题只解析出 3 题
- **根因**：`第 1 题` 数字两侧有空格，正则未容。
- **修复**：`第\s*(\d+)\s*题`。

### D4 · 采分点是碎词
- **根因**：正则取 2–6 字任意片段（「产量」「发展」）。
- **修复**：分句 + 6–18 字长度过滤 + 长句取首短语 + 70% 子串宽容匹配。

### D5 · 配图 404（两处）
- **原因 A**：`paperId` 形如 `国考/2008/行测-统考`（目录+文件名），基准目录应取 `dirname(paperId)`，误用 `paperId` 自身。
- **原因 B**：深度题库 DB 记 `.webp`，磁盘实为 `.png`。
- **修复**：`dirname` 基准 + 扩展名探测（`naokuImage.resolveNaokuImage`）。
- **另**：`writeHead` 一旦发出不得再写（原 catch 里二次 `writeHead(500)` 破坏响应）。

### D6 · 模考答案泄露
- **现象**：`exam/start` 返回体含 `answer` 字段 = 可作弊。
- **修复**：不出答案，`submit` 时服务端比对。
- **守卫**：smoke「模考开始返回整卷(不泄露答案)」断言 `answer === undefined`。

### D7 · SQLite 双引号
- **现象**：`no such column: ""`。
- **根因**：SQLite 把 `""` 当标识符，不是空串。
- **修复**：用 `LENGTH(x) > 0` 判断。

### D8 · `gradeEssayArticle` 丢失
- **现象**：smoke 报 `does not provide an export named 'gradeEssayArticle'`。
- **根因**：拆 `paperParse.js` 时删除正则匹配范围过宽，误删该函数。
- **修复**：重建；教训同 R15（结构性删除要点名核对导出清单）。

## cycle-15/16/17 新增

### R16 · 图谱「打不开」假象（永久 spinner）
- **现象**：重复点同一导航项后卡 spinner。
- **根因**：`setView` 无条件 `setData(null)`，但父 effect 依赖 `[channel, view, api, tick]`——view 未变则不重跑，data 永远 null。
- **修复**：命中同一视图时自增 `tick` 强制重取。
- **守卫**：「视图重入」契约（CLAUDE.md v1.8）；教训：**清空数据 + 依赖驱动重取组合必须有显式刷新令牌参与依赖**。

### R17 · 力学参数失衡致图谱塌缩
- **现象**：141 节点全图挤成中心一团，标签 100% 重叠。
- **根因**：魔数 `LINK=90/REP=9000` 在 V≈140 时弹簧+向心压过斥力。
- **修复**：Fruchterman-Reingold 按节点数标定（`k=sqrt(area/V)`）+ 预收敛 `relax(140)` + `fit()`。
- **教训**：力导向参数必须随规模归一，布局后必须适配视口。

### R18 · 预热与同步重建双路争抢（性能倒退）
- **现象**：冷启动首查 31.5s，比纯同步基线还差。
- **根因**：分块预热与请求触发的同步 `buildPaperIndex` 并发扫盘互相争抢。
- **修复**：`prewarmRun` 代际令牌——同步路径启动即作废在途预热；smoke harness 传 `prewarm:false`。
- **教训**：预热是「尽力而为」，请求路径永远有同步兜底。

### R19 · 安装态数据全缺（发布根本问题）
- **现象**：npm/GitHub 单独安装后 15 仓库全部 absent，功能空转。
- **根因**：`REPO_ROOT=上级目录` 是开发态假设；题库 ~2.2GB 且各有上游版权不能随包分发。
- **修复**：数据根四级解析（dataRoot.ts）+ 域工厂重建（buildDomains/rebuildDomains）+ 题库管理一键克隆（repoManager + repos-view）。
- **守卫**：smoke R-P-05 静态守卫 + 沙箱 `KG_REPOS_DIR=空目录` 端到端（克隆→功能即时恢复→pull/browse/remove）。
- **教训**：**路径是运行期事实，不是加载期常量**。

### R20 · 图谱缓存跨工作区泄漏
- **现象**：A 项目访问 `/api/graph` 后，B 项目在 5s TTL 内命中同一缓存，读到 A 的 `progress`（跨项目污染）。
- **根因**：graphCache 是全局单槽，但快照内嵌 ws 相关字段。
- **修复**：缓存改 `Map<wsKey, {ts,data}>` 分槽 + LRU 上限 24 槽。
- **守卫**：smoke R-P-06 静态守卫 + 运行时双 ws 断言（X.day=7 / Y.day=1）。
- **教训**：**缓存键必须覆盖响应的全部可变输入维度**——凡响应含 per-tenant 字段，缓存必须 per-tenant。

### R21 · Windows 控制台窗口闪现（「命令窗口显示问题」）
- **现象**：题库安装/更新时桌面每次弹出黑色 cmd 窗口。
- **根因**：`spawn('git', …)` 未设 `windowsHide:true`（Node 在 Windows 默认给子进程分配控制台）。
- **修复**：全部 spawn（含 probeGit）加 `windowsHide:true`；配套 `GIT_TERMINAL_PROMPT=0` 防无 TTY 凭据提示挂起。
- **教训**：**宿主 GUI 插件里一切 spawn/exec 默认 windowsHide:true**，这是桌面体验硬约束。

### R22 · 工具输出陈旧（「调用时显示问题」另一半）
- **现象**：`kaogong_launch` 报「7 视图」，实际 15 视图；入口描述停留在「右侧标签」。
- **根因**：工具 execute 里手写文案模板，与 manifest 演进脱钩（声明/呈现漂移）。
- **修复**：输出全部实时取自 `/api/capabilities`（views/tools/endpoints 计数）+ `/api/status`（repoRoot/pid）+ `/api/repos`（数据就绪与缺失引导）。
- **守卫**：「凡声明 vs 运行态对账，两侧口径必须同源」纪律的呈现层推论——**面向用户/模型的文案也从事实源渲染，不手写**。

### R27 · 市场升级整目录替换 → 包内用户数据丢失（issue #2 · v1.16 根治）
- **现象**：用户经 dsh-market 安装 1.13.1 → 升级 1.14.0 遇 `ERR_PNPM_EPERM` 文件占用失败 → 改命令升级成功 → **已下载题库与学习进度全部消失**（0/16）。
- **根因**：默认数据根、repos-config、progress 全在包内 `<pkg>/data/`——市场/npm 升级 = pnpm 把包目录**整目录替换**（占用失败时的恢复也只还原 package.json/lockfile，不保数据）。「有可配置的数据根」≠「默认已与包隔离」，README 承诺与实现不符。
- **修复**：用户数据根外置 `~/.dsh/kaogong/`（KG_DATA_DIR/DSH_HOME 感知；dsh-cookie-guard 实证模式）；启动时一次性原子迁移包内旧数据（跨卷 rename 失败走 cp 回退**删源**；lifecycle 环形日志保留新根删源；失败只读降级绝不删源）；`/api/data-location` + 面板白盒卡透出位置/迁移/残留。
- **守卫**：smoke SMOKE-DX-01..06（白盒端点 + DATA_DIR=USER_DATA_ROOT 静态守卫 + 迁移器幂等判据）；沙箱实测包内 data/ 零用户数据残留。
- **教训**：**凡写进「包目录」的数据都会在升级时被替换掉**——新增写路径先答「升级替换包目录后它还在吗」；README 承诺必须与默认实现一致（「可配置」不等于「默认安全」）。

### R28b · 练习链路图片三重丢失（issue #1 · v1.16 根治）
- **现象**：专题行测练习带图题目图片不显示；「根据上图」题干根本无图；图形推理选项只有字母 A/B/C/D。
- **根因**（三层）：① `parseQuestions` 的 `<[^>]+>→''` 把 `<img>` 全剥掉（题干图/公式图丢失）；② 资料分析的图在**材料块**（`## 材料 N`），切题块时从未归属到题（1479 个含图材料块）；③ 上游数据 2728 道图形推理题选项本就是纯字母（选项图未随上游收录——数据源限制）。
- **修复**：① img → `kgimg://` 中立占位（落盘与端口/挂载无关）+ `/api/kg-img` 二进制端点 + RichText 渲染改写；② 材料图按「题块前最近的有图材料段」偏移归属附给题干；③ 选项纯字母 ∧ 题干带图 → 诚实降级提示条。
- **守卫**：smoke SMOKE-IMG-01..06（占位化静态守卫 + 真实题库跨模块抽题含图 + kg-img 200/MIME + 越级 403）；沙箱 Playwright 端到端（img 加载 naturalWidth=678）。
- **教训**：**「渲染层剥 HTML」必须先枚举业务标签的语义**（图片≠噪声）；多级文档结构（材料→题）的字段归属要按「读取时刻的引用关系」建模，不是按解析便利性。

## cycle-18 新增（方法论语料与检索）

### R23 · 语料「随包内置」方案被用户否决（数据架构纠正）
- **现象**：早期任务书按「25 篇语料放 `assets/huasheng13` 随 npm 包分发」设计；用户明确纠正为**统一走数据根**。
- **根因**：为方法论单独开「内置」旁路会让数据来源分裂——同一类内容两套安装/更新/卸载语义；且与 v1.11「包不含题库数据」的发布契约冲突。
- **修复**：`HUASHENG13_META.root='huasheng13'`（相对数据根），`REPOS_META.huasheng13` 登记为 **required/336KB**，由「📦 题库管理」统一下载；`assets/` 只留图标与截图；无 `builtin` 字段。
- **守卫**：smoke `SMOKE-RP-01c`（16 仓库登记 + tier=required + 无 builtin）、`HS13-10`（数据根 25 文件、包内无 `assets/huasheng13`）；反向旅程 `_tmp/journey-notinstalled.mjs`（未装降级 → 装后自愈）。
- **教训**：**数据来源必须单一化**——新内容先问「它属于哪个数据根仓库」，不要发明随包旁路。

### R24 · 覆盖矩阵统一三维 → 常识/申论假阴性
- **现象**：初版按「文档 × 表格/公式/示例」统一三维打分，常识判断被判 33%、申论 67%，白盒面板对健康模块持续告警。
- **根因**：这两个模块本来就不考公式（申论是写作科目），「没有公式」不是缺口；统一分母制造假阴性（与 v1.8 遥测假阳性同族）。
- **修复**：`HUASHENG13_META.modules[].dims` 声明维度适用性（常识 `formula:false, example:false`；申论 `formula:false`），`coverageMatrix` 按适用维度算分母；`overall = Σpresent/Σexpected`（40/41=0.9756，**不凑绿到 1.0**）。
- **守卫**：smoke `HS13-06`（`dims.formula=false` 透传 + overall 真实值 ≠1 + `gaps` 如实列 `yanyu-zhuanxiang 缺公式`）。
- **教训**：**覆盖率的分母必须按「该模块实际考核维度」定义**；缺口清单是诚实度量的一部分，不是故障。

### R25 · 中文 bigram 检索的噪声不能靠硬过滤解决
- **现象**：`不存在的词` 也返回 10 条（bigram 拆成「不存/存在/在的/的词」命中高频双字），观感像假阳性；但真实短查询（`数量` 1.68、`判断` 2.11）分数反而低于噪声（4.79），**原始分数不能当判据**。
- **修复**：服务端只做尾部裁剪（`score < max(1.0, top×0.15)`，永远保留首条，不改 BM25 排序）+ 三档 `confidence`（`phraseHit`=整串真实命中 → high；全 token 共现 → medium；部分命中 → low）+ `note` 提示；**低置信度结果不丢弃**，把判断权交给 UI/调用方。
- **守卫**：smoke `HS13-03`（裁剪口径 `rawTotal ≡ results + filtered`、high/phraseHit/coverage=1）、`HS13-04`（生造词 low 仍返回 + note；空查询不计 miss）。
- **教训**：**检索的「相关性」是提示信号，不是删除开关**——零依赖中文检索宁可标注置信度，也不要静默杀结果。
