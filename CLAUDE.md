# dsh-kaogong — 项目事实基线（ANIC 自举真源）

考公备考整合插件：15 个开源仓库 → 离线可视化学习平台，DSH Web GUI **双入口**：左栏「考公学习」全屏沉浸面板 + 右侧 Sidebar 并排标签（引导页亦有入口）。

## Commands
- Build/类型门: `npm run build`（**tsc + scripts/bundle-client.mjs**：类型错误阻断 + 多文件产物拓扑序合并为宿主要求的单 combo）。**改完 .ts 必须 build（宿主编织的是 dist），改完任何 src/client/*.ts 也必须 build（client 产物是 bundler 合并的，裸 tsc 会把 dist/client/client.js 重写回裸 ESM → 宿主拒绝加载）**
- Test 全量: `npm run test:all` = `node smoke.test.mjs`（**164 断言**，独立端口段 8495，publishRuntime=false，含 combo 格式/R9/R11/R8/兼容声明静态守卫 + v1.6/v1.7 真题卷·申论评改·配图·模考·大作文·深度题库端到端 + **cycle-13 省份维度运行时断言 R-P-01..03/R-N-01**）+ `node render.test.mjs`（**35 断言**，真实 React 18 + 真实 client.js 集成渲染，含变异验证、**专题枢纽六分区/省份 chips/白盒流动图/图谱升级包断言与键盘命令行为验证**）。**两者都已接线 bundler**（scripts 先 tsc 再合并）
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
