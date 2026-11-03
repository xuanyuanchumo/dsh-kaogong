# Spec: dsh-kaogong v1.1
Status: approved (owner: product_owner, consult: tech_lead — 授权人: 会话人类指令 2026-11-02「右侧/左侧侧边栏入口 + 现代化交互界面 + L4 全自主」)。
派生自 intent.md；符合性检查 = smoke.test.mjs 断言 ↔ 本节条款一一对应。

## S1 信标与发现（崩溃安全）
- S1.1 `/api/status` 必须含 `app==='dsh-kaogong'`、`port`、`pid`、`uptimeSec`。【smoke: 信标字段/含pid】
- S1.2 `startServer(port)` 为 async；listen 失败一律 Promise reject；EADDRINUSE 自动降级到下一候选端口；同应用实例存在时 adopt（不重复绑定、不覆盖 runtime.json）。【smoke: adopt复用/不裸抛】
- S1.3 Host `apply()` 内启动路径全程 `.catch`，宿主进程免疫插件端口事故。

## S2 工作区隔离
- S2.1 所有读写端点接受 `?ws=<key>`；服务端 `slug+sha1前8位` 双段命名空间文件名。
- S2.2 PROJ_A 判分不得改变 PROJ_B 的任何字节。【smoke: 未污染断言】
- S2.3 client.js 以会话→工作区路径解析 ws key，兜底 `session/<id>` → `default`。

## S3 数据生产
- S3.1 题库解析兼容 CRLF、中文 frontmatter 键、`##/### 第N题` 双级标题。【smoke: 抽题成功】
- S3.2 计划结构化：恰 4 阶段、30 天、天含 title+tasks。【smoke: 计划断言×3】
- S3.3 方法论 10 主题目录端点 `/api/methods`；`/api/method?topic=` 返回 content。【smoke: ×2】
- S3.4 知识检索 `/api/search` 默认三库，命中 >0。【smoke: 检索命中】

## S4 可观测（白盒量化）
- S4.1 `/api/telemetry`：每端点 count/errors/p50/p95/series(环形100)、QPS 60s 滑窗、coverage。【smoke: ×3】
- S4.2 `/api/graph`：节点>30 边>30；metrics{V,E,density,components,orphans}；PageRank top12；health 0-100 加权分解。【smoke: ×3】
- S4.3 `/api/capabilities`：manifest 声明 + runtime.consumed + orphans 实时对账。【smoke: 能力矩阵×2】
- S4.4 `/api/workspaces`：命名空间清单含进度/正确率/活跃时间。【smoke: PROJ_A 可见】

## S5 宿主能力接入（sidebar-right 契约）
- S5.1 tab 双注册同 id：`sidebarRightTabs.register({id:'dsh-kaogong',kind:'kaogong',title,keepMounted,priority:'extension',guide:[{order,title(),description()}]})` + `sidebar.right.pane.tab` keyed slot。
- S5.2 guide 字段必须函数式；iframe 源经端口发现协议构造；服务缺席时渲染降级卡而非崩溃。
- S5.3 CSP 兜底：提供 `openTab('browser',{params:{url}})` 出口按钮。
- S5.4 4 个 AI 工具全部声明 `output:{schema,render}`（宿主硬约束）。

## S6 非功能
- N1 零依赖；N2 仅回环监听；N3 p95<400ms（performance_baselines 自证）；N4 全中文注释；N5 响应式 ≤640px 断点；N6 lifecycle.jsonl 环形 300 防膨胀；N7 smoke 自清理测试命名空间。

## S7 错题本 SRS（v1.3）
- S7.1 答错自动入 `progress.wrongBook`：`sha1(module|stem前120)` 签名去重，容量 300 环形（先淘汰已掌握再淘汰最旧）。【smoke 29】
- S7.2 五箱调度：答错降箱、回炉答对升箱、box≥3 且连对 2 = mastered。【smoke 31/32】
- S7.3 `?sort=srs`：未掌握错题最久先回炉；无错题按弱点权重 `1/(rate+0.15)` 选模块。【smoke 30】
- S7.4 `/api/stats`：日序列/streak/掌握度(正确率×min(1,n/20) 置信)/错题概况。【smoke 34】

## S8 宿主同源通道（v1.4 · 用户核心指令「界面应该在 dsh 宿主里」）
- S8.1 Host 经 `ctx.webServer.register({kind:'prefix', path:'/kaogong'})` 挂载同源路由；UI 与 API 全部可经宿主 GUI 端口访问（零 CORS、无端口依赖）。【smoke 36-39 + GUI 实测】
- S8.2 独立端口 server 降级为兜底通道（webServer 缺席/挂载失败自动回退，双通道并行无害）。
- S8.3 Client 左栏 main 席位渲染**宿主原生 React 面板**（同源 fetch + 宿主主题变量），非 iframe；仅端口兜底时退回 iframe。
- S8.4 React 事件属性必须驼峰 `onClick`（createElement 吞小写 onclick 且不报错——R6 事故）。
- S8.5 通道探测顺序：`/kaogong/api/status` 同源 → 8400-8404 端口；信标 `app` 字段自证。

## S9 渲染与兼容安全（v1.5 · 用户报告「会导致dsh宿主崩溃」的根治契约）
- S9.1 **禁止条件直调含 hook 的函数**：子视图一律 `React.createElement(Comp, props)` 挂载；切换/刷新经 key 重挂载（R9：直调 → "Rendered more hooks" → GUI 整树白屏）。【render.test 1-2 模式反证 + 5-7 真实代码集成；smoke 静态守卫】
- S9.2 宿主可见面板外层必须有 ErrorBoundary：渲染期异常降级为提示条，绝不扩散。【smoke 46】
- S9.3 独立端口 HTTP：回调整体 try→400 + `server.on('clientError')` 兜底（R8 纵深）。【smoke 47 双断言】
- S9.4 包必须声明兼容范围：`peerDependencies['@deepseek-ai/dsh']` + `engines.dsh` + `dsh.compatibility.dshReleases`——否则 guardian 报「兼容性未知」，闸门无法保护。【smoke 44-45】
- S9.5 主力 profile 回装须用户决定（T-013 沙箱闭环前，agent 不自动 install_bundle 回主力）。
