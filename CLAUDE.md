# dsh-kaogong — 项目事实基线（ANIC 自举真源）

考公备考整合插件：16 个开源仓库（含 cycle-18 新增方法论语料 huasheng13）→ 离线可视化学习平台，DSH Web GUI **双入口**：左栏「考公学习」全屏沉浸面板 + 右侧 Sidebar 并排标签（引导页亦有入口）。

## Commands
- Build/类型门: `npm run build`（**tsc + scripts/bundle-client.mjs**：类型错误阻断 + 多文件产物拓扑序合并为宿主要求的单 combo）。**改完 .ts 必须 build（宿主编织的是 dist），改完任何 src/client/*.ts 也必须 build（client 产物是 bundler 合并的，裸 tsc 会把 dist/client/client.js 重写回裸 ESM → 宿主拒绝加载）**
- Test 全量: `npm run test:all` = `node smoke.test.mjs`（**262 断言**，独立端口段 8495，publishRuntime=false，含 combo 格式/R9/R11/R8/兼容声明静态守卫 + v1.6/v1.7 真题卷·申论评改·配图·模考·大作文·深度题库端到端 + cycle-13 省份维度 R-P/R-N + cycle-15 记忆 R-MEM/三布局/流动粒子/白盒三件套 + **cycle-16/17 题库管理 R-P-01..06（/api/repos* 控制面+数据根四级解析+崩溃安全静态守卫+跨工作区缓存分槽隔离）**）+ `node render.test.mjs`（**50 断言**，真实 React 18 + 真实 client.js 集成渲染，含专题枢纽/省份 chips/白盒流动图/图谱升级包/记忆跳回/**C16 题库面板「关于本项目」卡与安装请求**/**C18 方法论五分区+检索交互+obs 方法论链路卡**）。**两者都已接线 bundler**（scripts 先 tsc 再合并）
- **沙箱验证（禁主力直测）**: `node ../_dshcli/node_modules/@deepseek-ai/dsh/lib/bin.js --profile sb-kaogong --port 3181 --no-open`（token 行取 URL；插件崩只崩沙箱）
- 热更新重载: `plugin_manager set_plugin include:kaogong enabled=false → true`（fiber 重挂载）
- 安装/重装: `plugin_manager remove_bundle dsh-kaogong → install_bundle <绝对路径>`

## 架构契约（改动前必读）
- **T-022 构建模型**：源码是 `src/**/*.ts`，tsc 镜像编译到 `dist/`；`package.json` main/exports 全指向 dist；`noEmitOnError` 让类型错误阻断构建；`verbatimModuleSyntax` 保证 client 的 `import type` 被完全擦除（产物仍是 combo 纯脚本）。smoke 有「dist 新鲜度门」。
  **Bundler 一段（cycle-13 T-025）**：client 源码是 `src/client/*.ts` 多个真 ESM 模块，tsc 产出 `dist/client/*.js` 多文件后，**必须**经 `scripts/bundle-client.mjs` 按 **DFS 拓扑序**合并回宿主 Web 组合加载器要求的**单文件 combo factory**（`window.__ModuleLoader__.load`）。合并后所有模块体共享 factory 单一作用域 → **全部文件顶层名必须唯一**（重名 = 重复声明 SyntaxError，bundler 有防御）；铁律：不重命名标识符、不压缩、不删注释（中文注释全保留）、绝不产生行首 `export `/`import `。所有先跑 tsc 的 npm scripts（build/test/test:render/test:all/prepack）都接了 bundler——**绕过 bundler 直接 tsc 会把 dist/client/client.js 重写回裸 ESM**（W1 实证 smoke 132/144 事故）。
- `manifest.js` 是能力**单一事实源**：端点/工具/视图/lifecycle 声明；server 与 UI 与可观测面板三方消费。改端点必须同步改 CAPABILITIES.endpoints，否则能力矩阵漂移（孤儿检测会报）。
- `server.js`：数据生产 + 信标（`/api/status.app === 'dsh-kaogong'`）+ ws 命名空间隔离（`data/progress/<slug>-<hash8>.json`）+ 遥测（环形 p50/p95）+ 图谱（PageRank/密度/连通分量/健康度加权模型）。
- `index.js`：Host 半。工具必须声明 `output:{schema,render}`（宿主强制）。启动服务**只能走 async startServer + .catch**。
- `client.js`：双入口。右侧 tab = `sidebarRightTabs.register(定义)` + `sidebar.right.pane.tab` keyed slot **双注册同 id**，guide 函数式；左栏 = `sidebar.panellist` register{id,order,label()} 图标（svg 带 `data-dsh-panel-entry`）+ `main` keyed slot 全屏页（inject 懒声明包裹，shell 缺席优雅缺位）。
- `ui/index.html`：零依赖 SPA；所有 API 走 `?ws=` 传递隔离键；端口经 8400-8404 信标发现；内联脚本受 smoke 语法门（new Function）覆盖。
- 错题本 SRS（v1.3）：`/api/check` 答错自动入 `progress.wrongBook`（sha1(module|stem) 签名去重）；答对且题带 `fromWrongBook` → 升箱，箱≥3 且连对 2 = mastered；`/api/questions?sort=srs` = 未掌握错题最久先回炉 → 无错题则按模块弱点加权 `1/(rate+0.15)`。
- **真题卷/专题/申论（v1.6）**：数据源 `gwy-zhenti`（**1683 套卷**：申论 944 / 行测 739，2008-2026）。`adapters/paperData.js` 索引递归限深 5、只认「科目-卷型.md」，**磁盘快照 data/.paper-index.json**（首建 16s → 之后 61ms）。单卷解析：`## 给定材料`→`### 材料 N`；`## 题目`→`### 第 N 题`（正则必须容数字两侧空格，否则丢题）；参考答案在 `<details>` 内。`server/paperApi.js` 提供端点。申论评分离线规则引擎（覆盖 50%/结构 20%/字数 15%/语言 15%），采分点抽取=分句+6-18 字过滤+70% 子串宽容匹配（碎词会污染诊断，务必保持此形态）。
- **v1.7 扩展**：解析核心拆到 `adapters/paperParse.js`（行测/申论双形态 `parseQuestion` + `guessXingceType` 六模块推断）；配图走 `/api/paper-img`（基准目录是 `dirname(paperId)`，不是 paperId 自身）；模考三端点（start 不下发答案防作弊 / submit 服务端比对 / history）；大作文 `gradeEssayArticle`（字数五档+结构要素+论证标志）。
- **深度题库（v1.7 整合 GongkaoNaoku）**：`adapters/naoku.js` 合并 147MB 分片→`data/.naoku.db`，`node:sqlite` 只读（**必须动态 import**，顶层 import 会让旧 Node 整插件加载失败）→ **27506 题五维标注**（kadian/reasoning/fastest/pitfalls/mother）。SQL 勿用双引号空串（SQLite 视为标识符），用 `LENGTH(x) > 0`。

## v1.8 图谱与白盒面板契约（cycle-12）
- **图分析算法族**（`manifest.ts`）：`NODE_META`/`EDGE_META` 是图语义色板与层级的**单一事实源**（server 输出 → client 渲染 → SPA 共用），新增节点/边类型必须在此登记，否则 UI 落到灰色 fallback。
  九个算法全部**确定性**（初始化用 id 散列，不用 `Math.random`；遍历顺序固定）——同输入两次输出必须深相等，smoke 有断言。
- **端点口径一致**（致命细节）：`/api/graph`、`/api/telemetry`、`/api/capabilities` 三者的「端点路径」必须统一为**相对挂载点的逻辑路径**（`/api/graph`）。曾因遥测记 `mountPath+rel`（`/kaogong/api/graph`）导致能力对账 100% 失配、全部端点误判「未声明」——白盒面板失去意义的**假阳性事故**。
- **前端图谱**（`client.ts` · NativeGraphView）：Canvas 2D + DPR + ResizeObserver；物理为 **Fruchterman-Reingold**（`k=sqrt(area/V)`，斥力 `k²/d`、引力 `d²/k`，理想边长按两端度数加权重）；**离线预收敛 `relax(140)` + `fit()`** 后停止在线 rAF（首次打开即稳定，且省电）；`userAdjusted` 标记保证用户手动缩放后 resize 不改视图；**标签去重叠**用包围盒贪心占位（`labelBoxes`）。
- **白盒管理面板**（`NativeObsView`）：八区块（管理动作 / 告警 / 学习质量 / 运行态 / 生命周期 stepper / 能力对账×性能表 / 慢端点 / 命名空间）。所有接口字段视为可选，缺失即卡片级降级（绝不 `role="alert"`）；表默认 p95 降序；sparkline 用内联 SVG（零依赖无 hook）。
- **视图重入修复**：`setView` 命中同一视图时自增 `tick` 强制重取——此前无条件 `setData(null)` 而 view 未变，effect 不重跑 → 永久 spinner（用户感知「图谱打不开」）。

## Verifying your work
- 报告完成前必须跑 build + smoke 并粘贴输出（`24/24 通过` 是最低证据）。
- 崩溃安全是硬性回归项：外部进程占用端口时 `startServer` 必须换端口或受控 reject，绝不裸抛。

## Conventions
- 全中文注释；ESM；零 npm 依赖（宿主 Node 标准库 only）。
- 数据文件写在 `data/`（progress 命名空间、runtime.json 信标、lifecycle.jsonl 环形 300）。
- 仅绑定 127.0.0.1；UI 只读仓库内容，唯一写路径是判分/进度。

## Things the agent gets wrong（历史事故簿）
- **[v1.8 事故·白盒假阳性] 遥测路径口径与 manifest 不一致**：同源通道把 `mountPath+rel`（`/kaogong/api/graph`）记进遥测，而 `CAPABILITIES.endpoints` 声明的是 `/api/graph` → 能力对账永远匹配不上，43 个端点全被标「未声明」。**教训：凡「声明 vs 运行态」对账，两侧口径必须由同一常量派生，并以 smoke 断言固化**（现已有 `运行态端点路径口径与 manifest 一致`）。
- **[v1.8 事故·图谱不可读] 力学参数与原实现失衡**：原 `LINK=90 / REP=9000 / 向心 0.004` 在 V≈140 时弹簧与向心压过斥力 → 全图塌缩成中心一团、141 个标签 100% 重叠。**教训：力导向图的参数必须按节点数标定（用 `k=sqrt(area/V)` 而非魔数），且布局完成后必须 `fit()` 适配视口**（首帧 wrap 尺寸为 0 时按兜底值算的 fit 会在真实尺寸到达后重算）。
- **[v1.8 事故·永久 spinner] 重复点击同一导航项**：`setView` 无条件 `setData(null)`，但父 effect 依赖 `[channel, view, api, tick]`；重复点同一 tab 时 `view` 未变 → effect 不重跑 → data 永远 null → 卡在 spinner。**教训：任何「清空数据 + 依赖驱动重取」组合，必须有一个显式刷新令牌参与依赖**（本处 `tick`）。

- **[cycle-0 事故] `server.listen()` 的 EADDRINUSE 是异步 'error' 事件，`try/catch` 捕不到 → 未处理异常击杀 DSH 宿主进程。**任何 listen/bind 必须 Promise 化回传。（宿主崩溃代价极高，禁止回退。）
- UI 直接对 `/api/*` 手写契约曾大规模漂移（`q.answer` vs `q.correctAnswer`、`limit` vs `count`、POST check 传 id vs 传整题）。新增/改动端点**必须先改 manifest 声明，再 server 实现，最后 UI 消费**，并以 smoke 断言固化。
- guide/注册字段传字符串而契约要求函数 → 客户端渲染期抛错。照抄 sidebar-right 子系统文档的 shape，不臆测。
- 手动起测试 server 后忘记清理 → 插件装回时 adopt 到旧代码实例，误判"没生效"。热重载前先确认 `runtime.json.pid` 归属。
- app.asar 内模板文件外部 node/rg 读不了（PATH_RESTRICTED）；用 Host 文件工具或知识库检索替代。
- frontmatter/题号是中文键 + CRLF；解析器必须 `[^:]+` + CRLF 归一 + `#{2,3}` 兼容 h3 资料分析。
- **[R4 事故] `el(tag, null, ...)` 系统性崩溃**：JS 默认参数 `p={}` 只对 undefined 生效，显式 null 直达 `Object.entries(null)` 抛错——UI 7 处调用点使图谱/计划/可观测三视图全崩，而 smoke 全绿（服务端测不到浏览器渲染）。修复：`Object.entries(p||{})` 一行守卫 + smoke 静态断言（27/28）防回归。**教训：UI 工具函数必须 null 防御，浏览器级实测不可省略（T-004）。**
- 左栏面板图标**不要自己绑 click/selectPanel**：svg 根携带 `data-dsh-panel-entry=<panelId>`，shell 事件委托接管点击与选中态；main 面板仅选中时挂载（参考 skill-explorer 实测模式）。
- **[R6 事故] React `createElement` 小写 `onclick` 被静默吞掉**（非标准属性，React 不认也不报错）→ v1.2 起 tab 重试/外链按钮实际全部失效，浏览器实测才发现。client 半事件一律 `onClick` 驼峰。
- **[v1.4 架构决策] 界面必须在宿主里**：主通道 = `ctx.webServer.register({kind:'prefix',path:'/kaogong'})` 同源路由 + client 原生 React 面板（同源 fetch）；独立端口 :8400 降级为兜底（Electron/挂载失败）。webServer 是懒到达服务：`ctx.get('webServer')` + `ctx.on('webServer', …)` 双保险。重复 (kind,path) 注册抛错 → catch 后受控降级，不击杀宿主。
- **[R7 事故] 模块级 runtime 跨 fiber 重挂载持久**：热重载时新代 apply 早于旧代 cleanup 运行——旧 cleanup 经共享 `runtime.unmount` 误卸新挂载（路由 404）；且新代若读共享 `runtime.mounted` 会跳过挂载。修复：本代资源（unmount/server/adopted）一律闭包局部变量，cleanup 只清自己那代；重复注册抛错 → 600ms 重试一次（等旧 cleanup 落地）。**教训：任何「模块级可变状态 + effect cleanup」组合都是热重载竞态源。**
- **[R9 事故·宿主 GUI 白屏] v1.4 把含 `useState` 的 Native 子视图当普通函数直调**（`data.kind==='practice' && NativePractice({...})`）——直调时子的 hook 记到父链上，视图切换使父 hook 数跨渲染变化 → React `Rendered more hooks than during the previous render` → **整个 GUI 崩溃**（用户感知"宿主崩溃"）。修复（v1.5）：子视图一律真组件化 `React.createElement(Comp, props)` + key 含刷新令牌保证干净重挂载；外层 ErrorBoundary 防渲染期崩溃扩散。**回归**：`npm run test:render`（真实 React 18 + 真实 client.js 集成 7 断言，dev 依赖在 `../_kgtest/node_modules`，不进运行时零依赖面）+ smoke 静态守卫（禁直调/须挂载/须有边界）。
- **[R8 加固] 独立端口畸形请求防线**：`buildHttpServer` 回调整体 try→400 + `server.on('clientError')` 兜底（独立端口无宿主 webServer 的 400 兜底；Node 24 实测内置兜底，此防线为版本兼容纵深）。
- **[兼容性声明] guardian 曾报「dsh-kaogong 未声明 DSH 版本范围；兼容性未知」**→ 兼容闸门无法保护/隔离本插件。v1.5 补 `peerDependencies{'@deepseek-ai/dsh':'>=0.2.0-rc.2 <0.4.0-0'}` + `engines.dsh` + `dsh.compatibility.dshReleases`（照 dsh-context/dsh-ops 实测模式）。**插件必须声明版本范围，否则闸门形同虚设。**
- **[R10 事故] `ctx.get('webServer')` 首启拿不到 → 同源路由静默 404**：webServer 晚于本 fiber 激活，且 `ctx.on('webServer')` 不是事件永不触发。**正解 `ctx.inject(['webServer'], cb)`**：服务就绪后才运行，变化时框架先跑其 disposer 再重跑——disposer 生命周期归框架，天然无跨代竞态。（沙箱首启才暴露；主力热重载路径曾掩盖此 bug。）
- **[R11 事故·Client 半从未加载] 裸 ESM `export` → `SyntaxError: Unexpected token 'export'`**：宿主 Web 组合加载器要求 **combo factory 格式**（`window.__ModuleLoader__.load({id, factory(require){... return {inject, apply}}})`），不是 ESM。此前「插件已加载」日志全部来自 Host 半，Client 半一直没进 GUI（compat_guardian 早写「加载失败的插件条目：kaogong」= 就是这个）。两处必守：① 无顶层 `export`；② factory 必须 `return {inject, apply}`（缺失 → "invalid plugin, expect function or object with apply, received undefined"）。样式注入也别依赖 `styles` 全局（combo 环境可能无），用 `typeof styles !== 'undefined'` + `<style>` 兜底。
- **[R11b] `dsh.client.inject` 只能声明 boot 图里真实存在的包**：声明不存在的包（如 `@deepseek-ai/dsh-client-ui-slots`——slots 由内核/sidebar-right 内部提供）会让条目**永不激活**且宿主只报 `1 entry did not activate`。查法：浏览器 `window.__DSH_BOOT__.entries` 里逐个核对。
- **[R12 事故] 视图 prop 形状不匹配 → ErrorBoundary 降级**：`h(NativeGraphView, { data })` 传整包而组件解构 `const {metrics} = props.data`（期望已解包的 g 对象）→ `Cannot read properties of undefined (reading 'V')`。**教训：ErrorBoundary 只保证「不白屏宿主」，面板自身正确性必须靠测试**——render.test 现已 mock 全端点真实形状 + 每次视图切换断言不得出现 `role="alert"`；并用变异测试验证（回退该 bug 测试必须失败）。

## cycle-13 事故与教训（v1.9.0）
- **① 复杂度超预算的拆法已成惯例**：`createGraphEngine` 单函数复杂度 260 > 预算 180（W1），W2b 又加回来到 217（W3 再拆）。**模式固定：「只读纯函数外提 + 闭包值同名参数穿线，写引擎原语状态的函数留闭包」**——读取语义「调用时刻实参 ≡ 调用时刻闭包值」，函数体逐字节等价；允许的写入面只有节点/canvas 等堆上共享对象属性。落点：`graph-physics.ts`（物理/渲染/查询原语）、`graph-transition.ts`（过渡动画插值+视口查询+键盘命令纯表+视图过滤态合并）、`graph-canvas.ts`（画布装配原语：测量/尺寸/光标/小地图绑定）。复用此模式，不要发明新拆法。
- **② 先 tsc 的 npm scripts 必须接 bundler**：test/render 脚本若只跑 `tsc`，会把 `dist/client/client.js` 从合并后的 combo **重写回裸 ESM** → 宿主加载器拒绝（R11 形态复发）。W1 实证 smoke 曾 132/144。**规矩：任何新增 npm script 只要产出 dist，就必须 `tsc && node scripts/bundle-client.mjs` 全链。**
- **③ 多工人并行禁跑 build/smoke/render**：dist 会被互相覆盖、测试端口段会冲突。并行自检**只用 `npx tsc --noEmit`**（只读、无产物、无端口）；build 与全量测试留给收口工人独占跑。
- **④ nav 锚点测试必须跟导航重构同步**：W2a 把「刷题/图形推理/深度题库/申论」收敛进专题枢纽分区后，render.test 里 3 处按旧一级导航锚定的断言直接 throw（找到按钮即失败）。**教训：改导航结构必须同一波次改 render 锚点——组件内 tab 用 `data-kg-hub-tab` 属性锚定（非路由），经枢纽触达的视图断言要走「点导航 → 点分区 tab」两步。**
- **⑤（测试基建）smoke 快照门测试的 keep-alive 竞态**：同步重建 1683 套卷索引会阻塞事件循环 ~10s，超过 Node http 默认 keepAliveTimeout(5s)，其后的 fetch 复用已被服务端关闭的连接 → `ECONNRESET` 裸崩。**规矩：长阻塞操作放在 HTTP 断言之后、且其后不再有 fetch；动 `data/.paper-index.json` 必须测前备份、finally 还原。**
- **⑥（测试基建）eval-runner 并行预热 test∥build 的裸 ESM 窗口**：anic eval-runner 会把 test/lint/build 作为并行 detached 子进程跑（Amdahl 加速），build 的 tsc 步先把 `dist/client/client.js` 重写为裸 ESM、bundler 合并前若被 smoke 读取 → 静态守卫假红（ErrorBoundary/图谱文本全在未合并模块里，实测 163/164）。**双层防线已固化**：① bundler 产物**原子写**（tmp+rename，读者只见完整文件）；② smoke 开头 **0a combo 完整性自愈**——判据用「行首 `import `」（裸 ESM 必有、合并 combo 必无；**不能用 combo 头文本判据，entry 源码本身就含 `window.__ModuleLoader__.load({`**），检出即现场重跑 bundler。规矩：凡读合并产物的测试，开头都要做产物形态自检而非假设上游时序。

## cycle-14 事故与教训（v1.9.1）
- **⑦（性能）索引分块预热必须带代际令牌**：`prewarmPaperIndex` 分块构建期间若请求抢先触发同步 `buildPaperIndex`，两路并发扫盘互相争抢 → 首查实测 31.5s（比纯同步基线还差）。**修法：`prewarmRun` 代际令牌——同步路径一经启动即自增，预热批次检测到换代立即退出**。同时记住：预热是「尽力而为」，请求路径永远有同步兜底；smoke harness 必须传 `prewarm:false`（否则预热把缓存热好，R-P-03 的快照耗时断言失真）。本机实测冷同步重建 ~30s（1683 文件 × Windows Defender 实时扫描开销），快照命中后二查 10ms。

## cycle-15 事故与教训（v1.10.0）
- **⑧（测试基建）smoke 运行时断言必须放在 §12 崩溃安全之前**：§12 为了测端口降级会 `server.close()` 主测试实例，此后 `B`（8495）连接一律 ECONNREFUSED **裸崩**（uncaught fetch failed）。本 cycle 的 /api/memory 运行时段最初放在文件尾，实测崩在 MEM-01。**规矩：凡新端点运行时断言，插到「§11 之后、§12 之前」；文件尾只允许纯静态/源码级守卫。**
- **⑨（combo 单作用域）新增顶层名必须全局唯一**：环形布局 `graphCircularLayout`（transition）、粒子边集 `KG_FLOW_RELS`（physics）、布局序列 `KG_LAYOUTS/KG_LAYOUT_LABEL/kgNextLayout`（graph-view）、记忆 `kgMemAgo/useKgMem/KgMemBanner`（study-view）、白盒 `ObsQuantLadder/ObsLifeRing/ObsScatter/supDigits`（obs-view）——本轮刻意走「模块前缀」纪律（graph 系 graph*/KG_*、study 系 kg*/Kg*、obs 系 Obs*/sup*），bundler 重名防御只兜底不豁免。**规矩：新增 client 顶层名 = 前缀 + 语义，禁止裸词（`layout`、`banner` 这种撞名即 SyntaxError）。**
- **⑩（hub 常驻视图的重入断言）**：专题枢纽六分区「懒挂载+常驻，切换不重挂」——render 测试里 practice/tuxing/deepbank 一旦被 N-02 进入过，后续断言面对的是**旧组件状态**（横幅不会因 `__kgMemStore` 后置变化重现）。**修法：记忆 mock 仓库在 fetch mock 定义后立即置位（所有挂载可见）；重入断言前先「← 模块」回选择页（题目页没有横幅——横幅只挂模块选择/未抽题态）。**带 `initialModule` 的专题直入不弹横幅是**有意设计**（显式意图优先于记忆）。
- **⑪（记忆域设计取舍）**：记忆存 **progress.memory[kind]** 而非 localStorage——跟随 `?ws=` 命名空间天然隔离、跨设备（同工作区）一致、且复用既有 saveProgress 原子写；题目**整对象入记忆**（≤8KB 校验）保证「跳回原题」字面成立（SRS 抽题是随机的，靠 kind+重抽无法复现原题）。12-kind LRU 防历史 kind 残留膨胀；kind 白名单防键污染/原型链。

## cycle-16 事故与教训（v1.11.0 一键式题库管理 + 发布）
- **⑫（发布根本问题）npm 包不含题库数据**：16 仓库合计 ~2.2GB 且各有上游版权，绝不能随包分发；原 `REPO_ROOT=上级目录` 是开发态假设，安装态下数据全缺。解法=**数据根四级解析**（env `KG_REPOS_DIR` > `data/repos-config.json` > 开发态上级（含任一登记仓库才识别）> `data/repos` 托管默认）+ 题库管理面板一键克隆。**凡「路径」进运行期，一律做成可配置事实源，禁止模块加载期硬编码位置。**
- **⑬（动态根的重建模式）**：数据根变更不能散落改七个域文件的闭包捕获——采用**域工厂重建**：`buildDomains(root)` 集中装配（各域 makeXxxApi 签名零改动），`rebuildDomains()` 换根 + 三级缓存失效（resetPaperIndex / resetNaoku / graphCache 归零），安装/删除/换根全部走 `onRootChanged` 回调。**新增跨域共享可变前提时，先答「谁持有、谁重建、谁失效」三问再动手。**
- **⑭（spawn 崩溃安全同族）**：git 子进程的 `proc.on('error')`（git 不存在/权限）与 `close` 非零码都必须收敛为 job failed——与 cycle-0 的 listen EADDRINUSE 同族教训：**一切外部异步错误必须挂回受控 Promise/状态，绝不 uncaughtException 击杀宿主**。另 `GIT_TERMINAL_PROMPT=0` 防 git 在无 TTY 环境弹凭据提示永久挂起。
- **⑮（发布卫生）**：`data/.naoku.db`（147MB，GitHub 单文件 100MB 红线）与 progress/runtime/lifecycle 曾入 git 跟踪——发布前 `git rm --cached` + gitignore + **独立干净快照目录**（_publish-kaogong，无 data/.dsh/.cycles/.git）初始化发布仓。npm pack 311KB 是「包卫生」的机器证据。教训：**运行时产物从第一天就 gitignore；发布走干净快照，不在开发仓打 tag 直推。**
- **⑯（异步路由改造检查单）**：`handleApi` 变异步必须同步改**全部调用点**（同源 attachWebRoute + 独立端口 buildHttpServer 两处 `req.on('end')` 都要 async+await），并保留 try/catch 收敛 500。tsc 全绿 + smoke 全绿才算改完。
- **⑰（面板元数据单一事实源）**：「关于本项目」卡的 GitHub/Release/Issue/npm 链接存 `SELF_META`（manifest），server `/api/repos` 透出 `self`，UI 只消费不硬编码；version 引用 `CAPABILITIES.plugin.version` 而非第二处字面量（版本三锚点守卫只认一处）。
- **⑱（沙箱模拟安装态）**：验证「npm 安装后无数据」的正确方法 = 沙箱带 `KG_REPOS_DIR=空目录` 启动（present=0/requiredMissing=3），再走真实一键克隆→功能即时恢复（/api/method 从「参考文件未找到」变真实全文）→pull/browse/remove 全链路。**环境性缺陷用「干净环境复现 + 修复后同环境回归」闭环，不在开发态环境自欺。**

## cycle-17 事故与教训（v1.12.0 隔离与显示修复 + 市场合规）
- **⑲（R20 缓存维度教训）**：图谱缓存全局单槽但响应内嵌 per-ws 的 `progress` → A 项目访问后 B 项目在 TTL 内读到 A 的进度（跨项目污染，用户可感知「我的数据怎么是别人的」）。修法 `Map<wsKey,slot>` + LRU 24。**规矩：给响应加缓存前，先列出响应的全部可变输入维度（ws/root/参数），缓存键必须覆盖其中「租户级」维度。**守卫=smoke R-P-06 静态断言 + 双 ws 运行时实证（X.day=7/Y.day=1）。
- **⑳（R21 windowsHide）**：`spawn('git')` 在 Windows 默认给子进程分配控制台——题库每次 clone/pull/探测都闪黑窗。宿主 GUI 插件的一切子进程 spawn 必须 `windowsHide:true`（probeGit 也不例外）。
- **㉑（R22 工具输出陈旧）**：`kaogong_launch` 手写「7 视图」模板，实际 15 视图——声明与呈现漂移。**面向模型/用户的文案也从事实源渲染**：views/tools/endpoints 计数取 `/api/capabilities`，repoRoot/pid 取 `/api/status`，数据就绪取 `/api/repos`。这是「声明 vs 运行态同源」纪律（v1.8 遥测事故）在呈现层的推论。
- **㉒（市场 peer 预发布陷阱）**：`>=0.2.0-rc.2 <0.4.0-0` 看似宽，node-semver 规则下**静默排除所有 rc**（预发布只匹配同 tuple 且带预发布标签的比较符）→ 用户装 rc 版宿主 ERESOLVE。修法：每段带预发布分支 `|| >=0.2.1-rc.0 <0.3.0-0 ||`。awesome-dsh-plugin 贡献规范明文要求，CI 检查 `dsh.bundle` 声明（只声明 `dsh.client` 不可安装是最常见被拒原因）。
- **㉓（GitHub 推送通道）**：Windows 上 HTTPS 443 直连 github.com 会被重置（`Recv failure: Connection was reset`），SSH 22 端口稳定——发布仓 remote 一律 SSH（`git@github.com:…`）；Contents API 兜底适合单文件热修（注意 API 提交与本地分支会分叉，推送前先 `fetch + rebase origin/main`）。

## cycle-18 契约与教训（v1.13.0 花生十三体系方法论适配库 + 统一题库管理）
- **㉔（语料一律走「题库管理」，禁止内置旁路）**：方法论语料曾先被做成「随 npm 包分发（assets/huasheng13）」，被用户明确否决——**本插件不内置任何题库/语料数据**，一切数据由「📦 题库管理」统一下载到数据根。语料位 = `<数据根>/huasheng13/{references,examples}`（上游 `WangJunqing-coder/huasheng13-skill`，336KB，`REPOS_META.huasheng13` tier=required）。判据守卫：smoke 断言 `assets/` 下不得存在 huasheng13、`package.json files` 不得列语料。**凡「某类数据要不要进包」的问题，答案恒为「不进」，否则更新/卸载语义分裂。**
- **㉕（HUASHENG13_META 是目录单一事实源）**：六模块/策略层/示例 + `root`（相对数据根）+ `dims`（维度适用性）全部只在此登记；adapter 解析、server 端点、UI 渲染三方消费。**新增语料四步**：放文件到数据根 → 登记 META → 索引快照 fixtureHash 自动失效 → 加 smoke 断言。
- **㉖（R23 覆盖矩阵假阴性）**：早期统一按「文档/表格/公式/示例」四维打分，致常识判断 0.33、申论 0.67——**这两个模块本来就不考公式**。修法 `dims:{formula,table,example}` 按模块声明适用维度，不适用维度**不进分母、不产生 gap 文案**。教训：**度量口径必须先问「这个维度对该对象是否成立」，否则面板会对健康模块持续告警**（与 v1.8 遥测假阳性同族）。`yanyu 0.889` 是真实缺口，如实保留不凑绿。
- **㉗（R24 影子端点污染遥测对账）**：任何未声明路径被 `recordRequest` 记成运行态端点后会永久驻留成「影子端点」，让 `/api/capabilities` 对账与 smoke 口径守卫误判。修法：`isDeclaredEndpoint()` 派生自 CAPABILITIES，未声明路径只进 `__unmatched__` 聚合桶（另开 `telemetry.unmatched` 保留可观测余量）。教训：**测试里靠「调整断言顺序」规避污染 = 掩盖而非根治**；顺序可以掩盖，机制才能保证。
- **㉘（R25 陈旧文案是用户可见缺陷）**：架构变更后「合计约 363MB」「方法论无需安装」「内置语料」「15 仓库」「4 个 AI 工具」等表述残留——白盒面板与工具输出会把它当真。**规矩：任何架构变更必须同一波次全仓 grep 检查文案（含 manifest 内的中文 desc/lifecycle），并把体积类数字改成「由事实源动态渲染」而非写死。**
- **㉙（R26 拆分脚本禁做括号平衡推断）**：把 markdown 链外提时用「朴素花括号计数」定位函数边界，被正则字面量里的 `{}`（`/{1,6}/`、`/[.*+?^${}()|[\]\\]/`）骗过 → 函数被截断、源文件语法损坏。**规矩：拆分脚本必须以「顶层声明行号」为切点（列 0 的 `function`/`const` 行），禁止用括号/引号平衡推断；重构前先确认可恢复路径（本次靠 `dist/` 上一版产物无损恢复，且 `strict:false` + `removeComments:false` 让产物可回填）。**
- **㉚（R27 编辑器的 EOL 会污染历史）**：Windows 上 `open(p,'w')` 把 LF 文件写成 CRLF，导致 `manifest.ts` 整文件 1644 行「全改」。**规矩：脚本改文件用 `newline=''`/二进制模式保持原 EOL；提交前用 `git diff --numstat` 查「整文件改写」型异常（增删都接近文件总行数即 EOL 翻转）。**
- **㉛（入口纪律·用户明确要求）**：方法论**不设独立一级导航**，入口 = 「🎯 专题 → 📖 方法论」分区（`data-kg-hub-tab=method`），该分区内主视图即花生十三体系（`data-kg-hs13-root`）；原 kaogong-skill 十主题降为默认折叠「另见」区。**新增业务视图一律先问「该不该进一级导航」，本插件倾向收敛进专题枢纽**；render 断言按属性锚定（`data-kg-hs13-tab` / `data-kg-hub-tab`），禁按文本匹配（「花生十三体系」与「方法论」标签会撞名）。
- **㉜（检索噪声的正确处理）**：中文 bigram 下任何中文串都会产生命中，实测**噪声分数反而高于真实短查询**（「数量」1.68 vs「不存在的词」4.79）→ 阈值过滤会误杀真实查询。正解 = **只裁尾**（`score < max(1.0, top×0.15)` 且**永留首条**）+ 三档 `confidence`/`phraseHit` 提示，**低置信度结果不丢弃**。教训：**给「相关性」建模前先实测分数分布，别用直觉阈值。**
- **㉝（R28 打包卫生：声明的文件必须在包里）**：awesome-dsh-plugin 维护者实测 tarball 发现 `cordis.patch.yml` **不在** 1.11.0/1.12.0/1.13.0 的 npm 包里，而 `package.json` 的 `dsh.bundle.patch` 指向它 —— 按市场条目 npm 安装会拿到**缺 patch 的 bundle**（装了等于没装）。根因：`files` 白名单漏列。修法：把 `cordis.patch.yml` 与随包模板 `data/study-plan.md` 加入 `files`，并加 `prepare` 脚本让**源码安装**也能构建（此前只有 `prepack`，且 `.gitignore` 排除 `dist/` → GitHub 装法不可用）。**机器守卫（R28 族）**：smoke 直接跑 `npm pack --dry-run --json --ignore-scripts` 核对「声明 → 实体」零断链，并**反向**断言「语料/本地调试 overlay 不得入包」（`cordis.local.yml` 含绝对路径，入包会污染他人环境）。**规矩：凡 `package.json` 里被其他字段引用的文件（patch/模板/icon），一律同时进 `files` 并以 pack 实测断言守卫；「声明 vs 实体」必须同源可核——扩展名换了，v1.8 白盒假阳性的同一条纪律仍然成立。**

## cycle-19 事故与教训（v1.14.0 研究文档体系 + 白盒量化增强）
- **㉞（对账假漂移第三例·UI 壳混入对账）**：沙箱旅程实测 `/api/capabilities.reconciliation.missingProducers=["/"]`——同源通道把 UI 页面壳（rel="/"）记进遥测端点表，被「消费 ∧ ¬声明」判成漂移。与 v1.8 遥测口径、cycle-18 影子端点同族。根修双层：`isDeclaredEndpoint` 排除 `/` 与 `/index.html`；`/api/capabilities` 对账消费集再过滤壳路径与 `__unmatched__` 桶。守卫=smoke R-OBS-03。**教训：遥测「记什么」与「对账什么」是两个口径——前者可宽（观测余量），后者必须严（判定语义）；漏斗每一层都要显式声明自己过滤什么。**
- **㉟（工具输出标记行）**：六工具输出统一尾部 `kgMarkTail` 标记行（`[kaogong vX.Y.Z · 服务:up|down · ws:<ns>]`，dsh-ops host-contract 卡片模式）——版本锚/服务态/隔离键三要素让「数据来自哪代服务」一眼可辨，是㉑「呈现层同源」纪律的推论。守卫=smoke R-OUT-01/02（tail 调用数 ≥ 工具注册数）。
- **㊱（生命周期量化口径）**：lifecycle.jsonl 只记事件时间戳，无显式 duration——`cumMs` 用「阶段 at − 进程首事件 ts」计算（自启动累计耗时），`bootMs` 用「最近 server-listen − 首事件」；字段可选缺失即 UI 徽章降级，绝不臆造 0 值。**教训：给既有数据「补量化」时先声明口径（从什么基准起算），面板数字才可解释。**
- **㊲（文档引用也是声明·断言也要对准事实）**：smoke RDOC 抽验文档引用的代码符号（R14 事实基座）；R-GRAPH-01 首跑失败因断言字符串与实际函数签名不符——**断言与源码签名漂移和「文档与代码漂移」同罪**，守卫自己也要被验证。
- **㊳（npm publish 的 cwd 陷阱）**：`npm publish` 在错误 cwd（如宿主 profile 根）执行会读到别的 package.json（version 无 version 字段 → semver.parse(null).prerelease 抛 TypeError）。修法：发布脚本显式 `process.chdir(发布仓根)` 再 spawn npm。**教训：子进程工具的「当前目录」是隐式参数，必须显式固定并写进脚本，不能依赖调用环境的 cwd。**
- **㊴（研究文档落地纪律）**：docs/research/ 每篇五段式（数学定义→代码落地文件:行号→中文场景启发→工程价值→可运行验证）；「只写有落地的」是硬门槛——smoke RDOC-01/02 守卫存在性与引用真实性，杜绝空谈型文档。

## cycle-20 P0 事故（v1.14.0 后热修：R11 第三次复发）
- **㊵（门禁裸 tsc 覆写 combo → 插件启动失败/宿主崩溃）**：cycle-19 收口时 `gate-check --record` 的 G3 执行 `.cycles/config.yml` 里 `build_commands: ["npx tsc"]`，**绕过 npm scripts** 把 `dist/client/client.js` 从 combo factory 重写回裸 ESM（7 处行首 `import`）；主力 profile 是 `link:` 到开发仓，宿主下次启动（13:44）读到裸 ESM → 组合加载器 `SyntaxError: Unexpected token 'export'` → Client 半不激活（"插件启动失败"），异常未隔离时可能拖垮宿主。**这是 R11 的第三次复发（v1.4 裸 ESM、cycle-13 eval-runner 预热竞态、本次门禁），教训②「先 tsc 的 npm scripts 必须接 bundler」只覆盖了 npm scripts，没覆盖「任何直接调 tsc 的外部工具」。**
  **根治三层**：① `.cycles/config.yml` 的 `build_cmd`/`G3.build_commands` 全部改 `npm run build`（门禁不再裸 tsc），smoke `R11-GUARD-01` 静态守卫禁裸 tsc 回归；② 新增 `scripts/assert-combo.mjs` 产物形态硬守卫（行首 import/export + load 头 + return{inject,apply}），挂到 build/prepack/prepare/test/test:render/test:all 末尾与 `postbuild`——**只判不修，构建期发现污染必须响亮失败**；`prepare` 带 `--fix`（安装期可自愈）；③ smoke `R11-GUARD-02/03/04` 守卫「所有产出脚本接 bundler+守卫 / 守卫存在 / 当前 combo 形态」。
  **发布物影响面取证**：npm tarball `dsh-kaogong@1.14.0` 的 `dist/client/client.js` 行首 import=0（prepack/prepare 接了 bundler）——**已发布包是好的，无需回滚**；坏产物只在本地开发仓，link: 才让它进宿主。
  **规矩（写入硬性纪律）**：**凡「构建命令」写进任何配置（门禁/CI/Makefile/编辑器任务），必须与 package.json 的 npm scripts 同源，禁止复制裸编译命令**；宿主用 `link:` 的开发仓时，产物形态就是宿主启动的先验条件——构建污染 = 启动事故。`smoke.test.mjs` 的 `readClientBundle()` 自愈只保护测试读取窗口，不保护宿主启动窗口，两者不可互替。

## cycle-21 事故与教训（v1.16.0 数据安全 + 用户旅程修复）
- **㊽（R27 数据外置）**：市场/npm 升级=包目录整目录替换，包内用户数据（progress/repos-config/学习计划）必然丢失（issue #2 实证 0/16）。修法：用户数据根 `~/.dsh/kaogong/`（KG_DATA_DIR/DSH_HOME 感知）+ 启动时原子迁移（跨卷 cp 回退删源 / lifecycle 环形日志保留新根 / 失败绝不删源）+ `/api/data-location` 白盒。**规矩：新增写路径先答「升级替换包目录后它还在吗」；「可配置」≠「默认安全」，README 承诺必须与默认实现一致。**
- **㊾（R28b 图片三重丢失）**：练习链路无图三层根因——parseQuestions 剥 img / 材料块图未归属题 / 上游 2728 题选项即纯字母。修法：`kgimg://` 中立占位（落盘与挂载/端口无关，RichText 渲染时才改写为 `/api/kg-img?p=`）+ 材料图按「题块前最近有图材料段」偏移归属 + 诚实降级提示。**规矩：渲染层剥 HTML 必须先枚举业务标签语义；多级结构字段归属按「读取时刻引用关系」建模。**
- **㊿（迁移语义=搬家不是复制）**：跨卷 rename 失败走 cp 回退后忘删源 → 包内残留与白盒「包内无用户数据」矛盾（实测抓住）。且 dst 已存在时若只 skip 不收敛，半途迁移永久残留。**规矩：迁移必须收敛（同字面内容删源 / 目录逐文件补搬 / 环形日志特例显式声明）；迁移报告必须以「包内实际残留」为判据，不以「执行了动作」为判据。**
- **（补录统计隔离）**：历史补录（source=import）不进今日新刷/趋势/打卡（整批历史算今天=打卡造假），错题照常进 wrongBook 回炉；幂等靠 importedSigs 台账 + 批次撤销窗口 30。**规矩：两种时间语义（作答时刻 vs 录入时刻）的数据必须显式分桶，统计口径排除项要在端点响应里可观测（importedTotal）。**
- **（smoke 清理段跟随数据位置）**：progress 外置后 smoke 的清理段还指包内 data/progress → 测试残留永远清不掉、MEM-01 假红（本轮实证）。**规矩：改数据位置必须同波次 grep 所有「写路径引用点」（含测试清理段），不是只改生产代码。**

## cycle-20 事故与教训（v1.15.0 题库管理流程优化）
- **㊶（半成品死锁·用户无法自恢复）**：clone 中途失败会留下无 `.git` 的残目录，下次 install 命中「目录已存在但不是 git 仓库」保护逻辑 → 拒绝覆盖 → **用户既不能重装也不能用，只能手删目录**。修法：作业记录 `createdDir`（本次新建）+ `isHalfClone`（无 .git ∧ ≤2 项）双判据，失败时自动清理；用户既有非空数据目录仍受保护。**教训：任何「保护用户数据」的拒绝逻辑都必须配套一条「可自恢复路径」——否则保护变成了死锁。删除判据必须同时满足「本次新建」+「无 .git」+「近乎空」三条，缺一不可。**
- **㊷（名不副实的「一键」）**：旧 UI 把 3 个必选包做成 3 个按钮，且服务端并发上限 2 → 点第三个必被拒，用户体验割裂。修法：`/api/repos/install-batch` 服务端队列化（并发内自动补位，无定时器、靠作业 close 钩子推进）。**教训：「一键」不是文案，是「一次请求 + 队列 + 进度可见」三件事的合体；客户端逐个按钮 = 名不副实。**
- **㊸（失败原因随作业消失）**：`Map<key, job>` 完成即被新作业覆盖，用户看不到「上次为什么失败」。修法：归档环形 20（key/action/state/error/elapsedSec/logTail）。**教训：作业表只存「进行中」，完成态必须另存归档——运维视角的问题（「上次失败是什么」）在只存当前态的系统里永远无法回答。**
- **㊹（换根导致「数据凭空消失」）**：切数据根后已装仓库全部「消失」，用户不知道数据还在旧根。修法：切根时记录 `previousRoot` 快照 + 统计其仓库数，UI 明示「旧根仍有 N 个仓库（数据未删除）」+ 一键切回。**教训：任何「切换作用域」的操作都要回答「旧作用域的东西去哪了」——不回答就是制造恐慌。**
- **㊺（配置无校验=静默失效）**：root 可写任意路径、mirror 无 URL 校验 → 写错后全部功能静默降级，用户查不到原因。修法：绝对路径校验 + 可写探测 + http(s) 协议校验，非法一律不落盘。**教训：配置写入必须校验到「写下去能生效」，否则一次手误就变成无声的功能丧失。**
- **㊻（健康态被布尔吞掉）**：`present`/`isGit` 两个布尔让「装了但不可用」（空仓库/缺 .git/半成品）混在「已安装」里。修法：独立 `health` 词表（ok/empty/half-clone/no-git/absent）+ `lastCommitAt`。**教训：布尔字段表达不了状态机——多态状态必须用词表，且不可探测的量用 null（降级）而非 0（撒谎）。**
- **㊼（截断口径两侧各写一个数字）**：服务端截 300、UI 只渲染 120、文案写「前 120 项（共 X）」→ 用户看到自相矛盾的数字。修法：`total` 恒为真实总数、`truncated` 由「总数 > 返回数」派生、文案从服务端字段渲染。**教训：分页/截断的「共多少」只能有一个事实源；客户端不得二次裁剪后再自报数字。**

## cycle-24 客户端组件化契约（v1.19.0 TSX 重构）

- **目录分层**：`src/client/{client,ui-kit}.tsx`（entry+基建）+ `src/client/views/*.tsx`（7 视图组件层）+ `src/client/graph/*.ts`（图谱引擎纯逻辑族，零 JSX）。视图文件**禁止**放回 client/ 根。
- **TSX 编译配置**：tsconfig `jsx:"react"`（classic runtime → 产出 `React.createElement`）+ `include` 含 `**/*.tsx`。**禁止 `jsx:"react-jsx"`**（会产出行首 `import { jsx } from 'react/jsx-runtime'` → R11 第四次复发）。
- **React 引入纪律**：全组合唯一一份 `require('react')` 在 ui-kit.tsx 发生（bundle 内闭包可见）；所有 .tsx **禁止** `import React from 'react'`（verbatimModuleSyntax 保留 → 行首 import → assert-combo 响亮失败）。
- **bundler 子目录**：`bundle-client.mjs` 递归扫 `dist/client/**`，模块 id 为 posix 相对路径（`client/views/graph-view`）；相对导入 `./x.js`/`../graph/x.js` 经 `resolveSpec` 解析。新增子目录无需改 bundler，但**模块发现、拓扑序、重名防御三段对子目录均生效**。
- **注册表路由（P0-2）**：client.tsx 的 `VIEW_ROUTES` 是视图分发**唯一事实源**——每视图一行 `{ comp, key(t), props() }`；新增视图=一行登记，分发点只有 `routeEl` 一处。禁止回退到三元链分发（重复布尔排除串已消灭）。
- **取数下沉（P0-1）**：**全部视图自治 fetch**，父层不下发 data。窄 props 口径 `{ api, wsKey?, onGo?/onReload?, initial*? }`。组件内取数遵守：取数 useEffect 顶部声明；**早退 return（loading/err）必须放在全部 hooks 之后**（R9：hook 数跨渲染恒定）；派生计算对 null 态防御式读取。
- **Props 类型化**：每个组件声明 `interface XxxProps`；`api: (p: string, opts?: any) => Promise<any>` 是视图标准接口（R12 形状漂移的编译期防线）。
- **组件规范（smoke C24 守卫）**：client.tsx 必须含 `VIEW_ROUTES` 注册表 + `h(route.comp,` 单点挂载；client/ 根不得新增视图级 .tsx（views/ 之外只允许 entry+ui-kit）。

## cycle-24 事故与教训（v1.19.0 重构）
- **（C24-1 channel 守卫误删）**：改造 useEffect 时把 `if (!channel) return 加载态` 一起删了 → `channel.kind` null 崩溃进 ErrorBoundary，render.test 主面板断言抓住。**教训：删「父层取数 effect」时逐段核对同函数内其它早退守卫；render 测试是这类回归的唯一捕获面（smoke 静态守卫测不到）。**
- **（C24-2 早退在 hooks 前 = R9 自伤）**：obs-view 自治化后 loading 早退 return 放在两个 useMemo 之前 → `Rendered more hooks`。**教训：新增早退 return 前先数该函数下方还有几个 hook 调用；规则固化为「早退必须在最后一个 hook 之后」，写进组件规范。**
- **（C24-3 派生计算先于守卫执行）**：`ins.essay` 在 ins=null（loading 态）时被 useMemo 前的派生段解引用。**教训：取数下沉的组件，派生段一律 `insSafe` 式防御读取，不假设「守卫已兜住」。**
- **（C24-4 守卫断言锚定旧形态）**：smoke 三个断言锚定三元分发/`data.g` 旧文本 → 重构后假红。**教训：改架构形态时同波次 grep smoke/render 的形态锚点断言（教训④的推广：不止 nav 锚点，所有「形态守卫」都要跟）。


## cycle-22 事故与教训（v1.17.0 专题-判断推理图片全链路修复）



- **（同族链路修复必须全字段枚举·㊾ 半修复态复发）**：cycle-21 修复了 parseQuestions（练习链路）与题干 img_refs（深度题库），但**同一适配器内** options/analysis/reasoning/fastest/pitfalls/mother 六字段仍走旧 stripHtml → 专题-判断推理选项/解析继续无图（用户二报）。修法：naoku.ts `stripHtmlKeepImg`（neutralizeImages 先占位化再剥标签）全字段替换 + `/api/kg-img` 扩展名探测回退（DB 记 .webp 磁盘 .png）+ 客户端 OptionRow/深度题库选项行/模考选项行 RichText 出图。**规矩：修「剥 HTML」类缺陷时，先 grep 该文件全部 `<[^>]+>` 剥除调用点，逐一判定业务语义（img=必须占位保留），修复面按「字段」枚举而非按「链路」划分——同文件不留幸存者。**
- **（端点「实现+消费」齐备 ≠ 已声明）**：`/api/kg-img` v1.16.0 服务端已实现、RichText 已消费，但 manifest 漏登记 → 能力对账面板与 smoke 口径守卫看不到它（假漂移第三形态：不是路径口径、不是影子端点，是**漏声明**）。修法：manifest 补登记（consumers=practice/deepbank/topics）+ smoke SMOKE-IMG22-02 固化。**规矩：新增端点四步纪律（manifest→server→UI→smoke）中，manifest 是唯一事实源——「能跑通」不等于「已声明」，对账面板只认声明。**

## cycle-28 事故与教训（v1.24.0 材料泄露 + 专题四区）
- **（C28-材料段终止条件）**：`parseGroupMaterials` 原终止条件只看下一个 H2——浙江 2026 A 类卷「材料 1」后**无 H2**，段文本吞到文末（20000 字截断），把**后续全部题干 + `<details>` 答案解析**吞进组材料（用户报「44 题材料过度+答案出来了」）。修法：终止条件取「下一个 H2 ∪ 下一个题头（`### 第 N 题`）」更近者。**教训：凡「段边界」解析，终止集必须含同级标题、更深层标题、题头三类；只认同级=默认尾部无界。守卫 C28-01 固化。**
- **（C28-专题四区复用）**：专题刷题（practice）对齐模考四区没有新造组件——QwPaperMode 扩展 `mode:'practice'`（题目区=判分交互，材料/切换/答题卡三区同构）；practice 的抽题队列即「整卷」（同卷资料分析题组连续抽取）。**教训：新模式先问「与既有 mode 差异是什么」——practice 与 exam 只差判分态来源（selected/right/revealed 由宿主持有 vs answers[q.no]），容器层零分支。**
- **（C28-组归属引用链）**：位置扫描只能定「组起点」不能定「组终点」——浙江卷 MAT1（篇章材料，真实 44-45 两题）与 MAT2 间隔 60 题普通题，材料 1 被误划给 44-105。**引用链判据**：材料指纹（滑窗 2-4 字 n-gram top24，均匀贪心切分会把「良渚古城遗址」切成不相交块导致子词匹配失败）逐题匹配题干+解析（首题命中≥2 开组、后续≥1 维持、命中 0 断链）。双卷对照固化：篇章 2 题组、资料分析 5 题组均精确。**教训：文本段→对象的归属不能只看位置邻近，「内容引用」才是语义边界；指纹必须滑窗覆盖子词。**

## cycle-29 事故与教训（v1.26.0 工具展示契约 + 子图按需加载）
- **（C29-bundler 的 export 剥皮不认 `export async function`）**：外提 graph-subgraph.ts 引入 `export async function` 新形态，bundler 的 collectExports/topLevelDecls 正则只认 `function|class|const|let|var` → export 关键字漏剥进 combo → 终检「产物含行首 export」响亮失败（smoke 332/350 假红窗口）。**教训：基建（bundler/守卫）的形态识别白名单 = 它必须认识的所有语法形态；给基建喂新形态前先查它的正则认识不认识。终检守卫这次抓住了（响亮失败而非静默污染），验证了 assert-combo 存在的意义。**
- **（C29-展示契约纯函数纪律）**：presentCall/presentResult 是宿主反复调用的纯投影（live streaming + session-log replay 两路），必须 total（绝不抛错、只依赖入参）；异常一律 catch 收敛 undefined = 保留宿主兜底渲染。守卫 C29-02 固化。
- **（C29-子图引擎换源同构）**：子图模式不造第二套渲染——activeNodes/activeEdges 成为 createGraphEngine 唯一数据源，子图/全图同一装配路径（C28 教训「容器层零分支」的推广）。统计面板/图例保持全图口径（subData 不参与 metrics 计算），面包屑明示口径避免「数字对不上」的假漂移感知。
- **（C29-复杂度预算治理走固定拆法）**：graph-view.tsx 加子图逻辑后 216 > 180 → 外提 graph-subgraph.ts（fetch/normalize/derive 三纯函数，参数穿线）；http.ts 204 → 外提 graphQuery.ts（graphSnapshot 参数注入）。带回 Status: WARNING（无超预算文件）。复用 cycle-13 教训①的固定拆法，不发明新拆法。

## cycle-29 发布段教训（v1.26.0 发布链）
- **（C29-发布仓与开发仓历史分叉治理）**：发布走 _publish-kaogong 独立干净快照（⑮纪律），开发仓 master 含 147MB naoku.db 历史段（cycle-14 入库、cycle-16 已 rm --cached 但历史仍在）→ pre-receive 拒推。**修法：git-filter-repo --invert-paths 剔除三个数据文件（2.17s 全历史重写）**；开发仓完整历史推 dev-history 保档，GitHub main 只留发布仓的干净快照线（单提交一版本）。git filter-branch 在 niugit（2.56.0.windows.4.niugit）下 tempdir 机制全形态失败（`fatal: not a git repository`——cd 到 MSYS 归一 tempdir 后 git 发现机制失效），**不再尝试，直接用 git-filter-repo**。
- **（C29-npm publish 双通道验证）**：vault_run 注入 NPM_TOKEN 后 `npm publish` 成功（+ dsh-kaogong@1.26.0），但随后匿名 curl/npm view 查到 `latest: 1.15.0`（401 或 CDN 缓存陈值）≠ 发布失败——**必须带同一令牌通道复验**（vault_run npm view → latest: 1.26.0）。判定发布成败只用认证通道。

## cycle-30 事故与教训（v1.27.0 真题卷交互回归）
- **（C30-重构降级陷阱：换容器时交互语义静默丢失）**：cycle-27 把真题卷整卷浏览收敛进 QwPaperMode mode="browse" 只读态（interactive=false、onSelect=undefined），v1.17 前的答案选择交互在重构中被**静默降级**——smoke/render 全绿（守卫锚定的是「形态存在」不是「行为等价」），直到用户回归才暴露。**修法「自答对照」**：browse 选项可点记录自选（宿主 browseSel/browseReveal 双 useState）→ 主动「对照答案」揭示卷面 correctAnswer（绿/红判色 + 解析段展开）→ 重做入口；答题卡四态经 browseAnswers 同步。守卫 C30-01..05 + RENDER-PP-30 全旅程（点选→揭示→解析→重做）固化。**教训：重构「收敛只读视图」时必须对照旧实现枚举行为面（交互/数据/快捷键），行为回归测试（render 真点击断言）不能只测渲染形态；用户可感知的交互丢失与功能损坏同罪。**
- **（C30-卷面答案双源兜底）**：真题卷行测题答案在 `correctAnswer`（parseQuestion 从 `<details>` 提取），申论/个别卷在 `answer` 字段——消费方双源判定（correctAnswer 优先 + answer 字母形态兜底 `/^[A-D]$/`），数据形状差异在 UI 层防御。沙箱实证浙江 A 类卷 120/120 题带答案。
