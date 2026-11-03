# DSH 宿主能力盘点

> 目的：明确「宿主给了什么」，已用哪些、还能用哪些。新增功能前先查本表，避免重复造轮子或误判平台限制。
> 依据：`dsh-plugin-dev-kb` 知识库（`site/reference/subsystems/*`）+ 本项目真机实测。

## 一、已使用的能力

| 能力 | 入口 | 本项目用法 | 关键约束（踩过的坑） |
|---|---|---|---|
| **同源 HTTP 路由** | `ctx.inject(['webServer'], cb)` → `ws.register({kind:'prefix', path:'/kaogong', handler})` | 面板内所有 API 走同源 `/kaogong/api/*`，无 CORS | webServer 是**懒到达**服务；`ctx.get()` 首启拿不到，`ctx.on('webServer')` 不是事件 → 必须 `ctx.inject`（R10） |
| **工具注册** | `ctx.tools.register({name, description, parameters, output, execute})` | 5 个工具：`kaogong_launch` / `ai_tutor` / `ai_plan` / `ai_shenlun` / `ai_essay_review` | `output: {schema, render}` 是宿主强制项，缺了注册失败 |
| **左栏面板席位** | `sidebar.panellist.register({id, order, label()})` + `main` keyed slot | 左栏「📚 考公学习」全屏面板 | 图标 svg 根必须带 `data-dsh-panel-entry=<panelId>`；**不要自己绑 click**（shell 事件委托，自绑会双触发） |
| **右侧标签席位** | `sidebarRightTabs.register({id,kind,priority,keepMounted,title,guide})` + `sidebar.right.pane.tab` keyed slot | 右侧「考公学习」并排标签 | 双注册必须**同 id**；`guide` 字段必须是函数不是字符串 |
| **Client Slots** | `ctx.slots.register()` | 上述两种席位的落点 | slot 是类型化 React 组合；功能插件**不得 import 其他插件的组件** |
| **Cordis 服务注入** | `inject: [...]` / `ctx.inject(deps, cb)` / `ctx.get(name)` | client 侧 `['slots','locale']`；host 侧 `['webServer']` | client 的 `dsh.client.inject` **只能声明 boot 图里真实存在的包**，声明不存在的包会永不激活（R11b） |
| **样式** | `styles.insert(css)`（可能不存在）→ `<style>` 兜底 | 全部 UI 样式 | combo 环境未必有 `styles` 全局（R11） |
| **本地化** | `ctx.locale.register({...})` | 面板文案 `t()` | 注册必须在 `try/catch` 内，locale 服务缺失时降级为原文 |
| **生命周期/热重载** | `ctx.effect(fn, label)` | 路由挂载、样式注入 | 本代资源一律闭包局部变量；模块级可变状态 + cleanup = 热重载竞态源（R7） |
| **兼容性闸门** | `package.json` 的 `peerDependencies` + `engines.dsh` + `dsh.compatibility.dshReleases` | 三处都声明 | 缺声明时 guardian 报「兼容性未知」，闸门无法保护 |
| **Plugin Manager** | `plugin_manager install_bundle / set_plugin` | 安装与热重载 | 重装前先 `remove_bundle`；`link:` 挂载改源码即刻生效 |
| **Node 内置能力** | `node:sqlite`（22.19+）、`node:crypto`、`node:fs` | 深度题库只读查询、签名、索引 | `node:sqlite` 必须**动态 import**（顶层 import 会让旧 Node 整插件加载失败） |

## 二、尚未使用、但值得接的能力

| 能力 | 潜在用法 | 备注 |
|---|---|---|
| ~~Conversation 视图 target~~ | ~~把题目卡片渲染进会话流~~ | **已用更轻方案实现**：`conversation.input.left`（见上表），不接管会话流 |
| **API Gateway 类型化调用** | 面板调用宿主服务（如 `sessions.scope`）已有，但未用 `ctx.apiGateway` 做类型化 RPC | 当前用 `fetch` 同源，够用；跨进程场景才需要 |
| **Toast / 通知** | 答题正确/升级提示用宿主统一 toast 而非自绘 | 需查 `ui-notifications` 类型 |
| **设置页** | 把「每日目标 / 模块权重 / 主题」放进宿主设置面板 | 需 `ui-settings` 扩展点 |
| **文件上传/工作区** | 导入用户自己的错题集 | 需 `workspace-files` 或 `file-upload` 能力 |
| **Terminal / Job** | 批量导入题库（后台任务 + 进度） | 大文件解析已够快，暂不需要 |

## 三、能力边界（不要指望的）

| 想法 | 现实 |
|---|---|
| 在 client 里 `import('./utils.js')` | ❌ combo `require` 只解析**包级**模块，无相对路径 |
| client 里用 JSX / TS | ❌ 无构建步骤，源码直接加载 |
| 用 `ctx.on('webServer', …)` 等服务 | ❌ 不是事件，永不触发 |
| 在 `apply` 外保存状态跨热重载 | ❌ 会导致新代拿到旧代状态（R7） |
| 直接 `server.listen` 不 handle error | ❌ EADDRINUSE 异步报错会击杀宿主（cycle-0） |
| 依赖宿主 GUI 一定存在 | ❌ 必须有独立端口兜底（Electron / 挂载失败） |

## 四、能力使用检查清单（新增功能前）

1. 这个功能是「模型要调」还是「人要操作」？
   - 模型调 → `ctx.tools.register`
   - 人操作 → slot 席位（左栏/右栏/会话）
2. 需要服务端能力吗？→ 同源路由 + 独立端口双通道
3. 需要跨会话状态吗？→ `?ws=` 命名空间 + `data/progress/`
4. 需要长期数据吗？→ 适配器只读 + 磁盘快照
5. 会崩溃宿主吗？→ 先沙箱（`sb-kaogong`）验证，再动主力
