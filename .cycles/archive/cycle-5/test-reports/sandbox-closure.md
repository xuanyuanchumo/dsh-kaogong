# 测试报告

## 1. 头部

| 字段 | 值 |
|---|---|
| 报告时间 | 20261103_093000 |
| 用途 | 循环验证（v1.5.1 沙箱闭环 · 宿主级真机验证） |
| 执行者 | AI (lead, ANIC L4) |
| 目标 | 沙箱 profile 内真机验证插件在 DSH 宿主中零崩溃加载与渲染 |
| 数据基线 | 15 仓库实数据 / v1.5.0(→1.5.1) manifest |
| 环境 | Windows / Node v24.14.0 / dsh 0.2.1-rc.5（独立工具目录 `_dshcli`）/ 沙箱 `sb-kaogong` / 端口 3181 |

## 2. 汇总

| 指标 | 数量 |
|---|---|
| 通过 | 68（smoke 49 + render 8 + 沙箱 11 端点） |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |
| 未覆盖 | 1 |
| 耗时 | ~8s 自动化 + 沙箱真机若干 |

> 旅程覆盖：**J7(新) 宿主真机加载**——沙箱首启 → host apply → client combo 激活 → GUI 内左栏图标出现 → 点开原生面板 → 5 视图实机切换零崩溃 ✅。
> 覆盖缺口：T-014（主力 profile 回装待用户决定）。
> 混沌覆盖：ErrorBoundary 实测生效（R12 bug 时面板降级而宿主 GUI 完好）；变异测试证明守卫有效。

## 3. 沙箱闭环取证链（本轮核心）

| 阶段 | 现象 | 根因 | 修复 |
|---|---|---|---|
| ① 首启 | Host 日志正常但 `/kaogong/*` **404** | R10：`ctx.get('webServer')` 首启拿不到；`ctx.on('webServer')` 非事件永不触发 | 改 `ctx.inject(['webServer'], cb)`（服务就绪才跑，disposer 归框架） |
| ② GUI 打开 | `Failed to load plugins` + `Unexpected token 'export'` | R11：client 半是裸 ESM，宿主要求 combo factory 格式 | 全量改写为 `window.__ModuleLoader__.load({id, factory(require){ return {inject, apply} }})` |
| ③ 再打开 | `invalid plugin … received undefined` | factory 未 `return {inject, apply}`（重写时丢失） | 补回注册块 |
| ④ 再打开 | `1 entry did not activate` | R11b：`dsh.client.inject` 声明了 boot 图不存在的 `dsh-client-ui-slots` | 收敛到 `dsh-client-locale` + `dsh-client-ui-sidebar-right` |
| ⑤ 成功 | 左栏「考公学习」图标出现，🏠宿主原生面板渲染 | — | — |
| ⑥ 压测 | 切图谱时面板降级 | R12：`h(NativeGraphView,{data})` 传整包，组件解构 `props.data.metrics` 读 undefined | 改 `data: data.g` |

## 4. 用例明细

### smoke.test.mjs（49/49）
1-43 前轮保留 · **44 禁组件直调（R9）· 45 h/createElement 挂载 · 46 ErrorBoundary · 47 combo 格式（无顶层 export）· 48 factory 返回 {inject,apply} · 49 peerDeps/engines + R8 双防线**

### render.test.mjs（8/8，真实 React 18 + 真实 client.js）
| # | 断言 | 结果 |
|---|------|------|
| 1 | v1.4 条件直调 → 如预期抛 "Rendered more hooks" | 通过 |
| 2 | v1.5 组件挂载同序列零崩溃 | 通过 |
| 3 | **combo 格式：`__ModuleLoader__.load` 注册 + factory 返回 {inject,apply}** | 通过 |
| 4 | apply() 注册 main/tab 席位 | 通过 |
| 5 | 主面板渲染（同源通道 + 仪表盘） | 通过 |
| 6 | dashboard→practice 切换渲染题目（v1.4 白屏点） | 通过 |
| 7 | 选项→提交→重挂载→再抽题全链 | 通过 |
| 8 | **7 连视图切换（含图谱 prop 形状）零降级** | 通过 |

**变异验证**：将 `data: data.g` 回退为 `data` → 测试报 `视图「图谱」触发渲染降级: ⚠️ 面板渲染降级… Cannot read properties of undefined (reading 'V')` 并失败（7/8）；恢复后 8/8。**证明守卫真能抓此类回归。**

### 沙箱真机（11/11 端点 200）
status / stats / banks / modules / plan / methods / graph / telemetry / capabilities / workspaces / wrong 全部 200；宿主 PID 12576 持续监听 336s 稳定。

### 宿主 GUI 实机（浏览器取证）
5 视图逐一实测：`{"图谱":"✅","可观测":"✅","错题本":"✅","刷题":"✅","仪表盘":"✅"}`；面板文本含「🏠 宿主原生 · default」「15/15 资源仓库」。
