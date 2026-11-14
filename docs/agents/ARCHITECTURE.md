# 架构

> 目标：16 个考公开源仓库 → DSH 宿主内的原生学习平台。零模型依赖、零 npm 运行时依赖。

## 1. 双半结构

DSH 插件由 **Host 半** 与 **Client 半** 组成，两者运行在不同进程、用不同模块系统：

```
┌──────────────────────── DSH 宿主进程 (Node) ────────────────────────┐
│  src/host/index.js         apply(ctx) —— 注册 6 个工具、挂同源路由    │
│      ├─ ctx.inject(['webServer'], …)  →  /kaogong/* 路由             │
│      ├─ ctx.tools.register × 6        → 模型可见工具                  │
│      └─ startServer()                 → 独立端口 8400（兜底通道）      │
│                                                                      │
│  src/server/*.js           HTTP 服务：http / ws / srs / dataApi /    │
│                             paperApi / naokuApi / methodologyApi /   │
│                             topicTree                                 │
│  src/adapters/*.js         数据适配：repoData / paperData /          │
│                             paperParse / naoku / naokuImage           │
│  src/shared/manifest.js    能力单一事实源（SSOT）                     │
└──────────────────────────────────────────────────────────────────────┘
                                ↕ HTTP (loopback)
┌──────────────────── 浏览器 (Host Web GUI) ───────────────────────────┐
│  src/client/client.js      combo 工厂：注册左栏面板 + 右侧标签        │
│      ├─ sidebar.panellist  → 左栏「📚 考公学习」图标                  │
│      ├─ sidebar.right.pane.tab → 右侧并排标签                         │
│      └─ 16 个原生 React 视图（13 模块合并 combo，见 §4）              │
│                                                                      │
│  src/ui/index.html         零依赖 SPA（独立端口通道的完整界面）        │
└──────────────────────────────────────────────────────────────────────┘
```

### 双通道设计（v1.4 决策）

| 通道 | 触发条件 | 特点 |
|---|---|---|
| **宿主同源**（主） | `ctx.inject(['webServer'])` 就绪 | 面板在宿主 GUI 内原生渲染，`fetch('/kaogong/api/*')` 同源，无 CORS |
| **独立端口**（兜底） | webServer 缺席 / 注册冲突 | `http://127.0.0.1:8400`（8400-8404 自动避让），加载 `ui/index.html` |

`channel.kind` 在 UI 顶部可见：`🏠 宿主原生` 或 `🔌 独立端口`。

## 2. Host 半要点

```js
// src/host/index.js —— 路由挂载必须走 ctx.inject（R10 事故）
ctx.inject(['webServer'], (injected) => {
  const ws = injected.get('webServer')
  const unmount = ws.register({ kind: 'prefix', path: '/kaogong', handler })
  return unmount            // disposer 归框架，热重载无跨代竞态
})
```

- 工具注册必须带 `output: { schema, render }`（宿主强制）。
- 服务启动**只能** `startServer(...).catch(...)`：`listen` 的 EADDRINUSE 是异步事件，`try/catch` 捕不到（cycle-0 曾击杀宿主）。
- 本代资源一律**闭包局部变量**，cleanup 只清自己那代（R7 热重载竞态）。

## 3. Server 层：域链分发 + 数据根重建（v1.11+）

```js
// src/server/http.js —— cycle-16 起 handleApi 异步（repoManager 作业面）
async function handleApi(path, params, post, method, wsRaw, port) {
  if (path.startsWith('/api/repos')) { const r = await repoManager.handle(...); if (r) return r }
  return domains.methodologyApi.handle(...)  // 花生十三体系（cycle-18，同步域，前置）
    ?? domains.srsApi(...)            // 错题本 SRS + 专项记忆
    ?? domains.tuxingApi.handle(...)  // 图形推理
    ?? domains.naokuApi.handle(...)   // 深度题库（27506 题）
    ?? domains.paperApi.handle(...)   // 真题卷/专题/申论评改/模考
    ?? domains.dataApi(...)           // 题库/计划/方法论/检索
    ?? coreApi(...)                   // status/stats/graph/telemetry/capabilities
}
```

- **数据根四级解析**（v1.11 一键式安装的基座）：`buildDomains(root)` 集中装配全部域，
  root 由 `dataRoot.resolveReposRoot()` 解析（env `KG_REPOS_DIR` > `data/repos-config.json`
  > 开发态上级目录 > `<用户数据根>/repos` 托管默认）。安装/删除/换根 → `rebuildDomains()`：
  新 root 重建域 + 三级缓存失效（`resetPaperIndex` / `resetNaoku` / `graphCache.clear`）。
  **纪律：路径是运行期事实，不是加载期常量**（教训⑫⑬）。
- 域模块返回 `undefined` 表示「不是我的路由」，继续下一个；返回对象即响应体。
- **二进制端点**（`/api/paper-img`、`/api/naoku-img`、`/api/tuxing-img`、`/api/kg-img`）在 JSON 链路**之前**分流，直接 `pipe` 文件流。
- 隔离：所有写路径按 `?ws=<workspace>` 哈希命名，落 `<用户数据根>/progress/<slug>-<hash8>.json`；
  **图谱快照缓存按 wsKey 分槽**（v1.12：快照内嵌 progress 是 ws 相关字段，全局单槽缓存会跨工作区泄漏——LRU 上限 24 槽）。
- 崩溃安全：spawn git 子进程 `windowsHide:true` + `on('error')` 全接住 + `GIT_TERMINAL_PROMPT=0`（v1.12 修控制台窗口闪现；一切外部异步错误挂回作业状态，绝不冒泡）。

### 用户数据外置与迁移（v1.16 · issue #2 根治）

```js
// src/server/dataRoot.ts —— 用户数据根解析 + 包内旧数据一次性迁移
export const USER_DATA_ROOT = resolveUserDataRoot()   // KG_DATA_DIR > $DSH_HOME/kaogong > ~/.dsh/kaogong
export function migratePkgData(): MigrationReport     // 启动时执行一次（http.ts 模块加载期）
```

- **为什么必须外置**：市场/npm 升级 = pnpm 把包目录**整目录替换**（`ERR_PNPM_EPERM` 失败恢复也不保数据）——包内一切用户数据（进度/错题本/配置）必然丢失（issue #2 实证）。用户数据根 = `~/.dsh/kaogong/`（dsh-cookie-guard 实证模式：DSH 主目录下插件命名空间，与安装位置零耦合）。
- **迁移器语义**：`progress/`、`repos-config.json`、`study-plan.md` 搬家（原子 rename → 跨卷 cp 回退**删源**）；`lifecycle.jsonl` 是环形审计日志（新根侧被运行时改写），保留新根删源；缓存快照（`.naoku.db`/`.paper-index.json` 等）不迁（可再生，rebuild 自动重建）。幂等标记 `.migrated`；失败只读降级**绝不删源**；`/api/data-location` 白盒透出位置/来源/迁移状态/包内残留。
- **纪律：用户数据永不写进包目录**——新增写路径先问「升级替换包目录后它还在吗」。

### 方法论域（methodologyApi）的装配与边界（v1.13）

```js
// src/server/http.ts:55-68 —— buildDomains(root) 集中装配全部域
domains.methodologyApi = makeMethodologyApi({
  pkgRoot: PKG_ROOT, repoRoot: root, dataDir: DATA_DIR, store,
})
```

- **语料根 = 数据根，不是包根**：`corpusDir = repoRoot/META.root`（`META.root === 'huasheng13'`，`src/server/methodologyApi.ts:224-229`）。换根/安装/删除 → `rebuildDomains()` 重建本域（`src/server/http.ts:79-82`）；安装 huasheng13 后 3s 降级重试窗口内自愈，无需重启。
- **域链位置**：`handleApi` 里**前置**于 `srsApi`（`src/server/http.ts:392-399`）——同步域、只接管 6 条 `/api/huasheng13/*` 路径，其它路径返回 `undefined` 继续下游。
- **端点键口径**：路由表、trace 计数键、manifest 声明对账三者共用同一组字面量常量（`HS13_ENDPOINTS`，`src/server/methodologyApi.ts:38-45`），绝不拼 `/kaogong` 前缀（v1.8 假阳性事故根因）。
- **与 `/api/method`（dataApi / 外部 kaogong-skill）的边界**：

| | `/api/huasheng13/*` | `/api/method`、`/api/methods` |
|---|---|---|
| 归属域 | `methodologyApi`（cycle-18） | `dataApi`（cycle-13） |
| 数据源 | 数据根 `huasheng13`（必选，25 篇） | 数据根 `kaogong-skill`（推荐，10 主题） |
| 未安装 | `degraded:true` + 安装引导；结构仍完整 | 参考文件缺失 → 目录空态/引导 |
| UI | 专题 → 方法论 **主视图**（`data-kg-hs13-root`） | 同分区底部「另见」折叠区 |
| AI 工具 | `kaogong_ai_method` | `kaogong_ai_tutor` / `kaogong_ai_shenlun` 的历史依赖 |

两域**不互相 import、不混用数据**：客户端 `huasheng13-view.ts` 只消费 `/api/huasheng13/*`；`TopicMethodView` 只消费 `/api/method*`。详细语料/检索口径见 [METHODOLOGY.md](./METHODOLOGY.md)。

## 4. Client 半：combo 工厂（关键约束）

宿主 Web 组合加载器要求插件 client 半是**工厂格式**，不是 ESM：

```js
window.__ModuleLoader__.load({
  id: 'dsh-kaogong',
  factory(require) {
    const React = require('react')      // ← 只能 require 宿主模块表中的包
    const h = React.createElement       // ← 无 JSX，用 h()
    // …全部组件定义在此闭包内…
    return {
      inject: ['slots', 'locale'],      // Cordis 服务名
      apply(ctx) { /* 注册面板席位 + 样式 */ },
    }
  },
})
```

三条硬约束：

| 约束 | 后果 | 原因 |
|---|---|---|
| 无顶层 `export` | `SyntaxError: Unexpected token 'export'` | 加载器按脚本执行，非 ESM（R11） |
| factory 必须 `return {inject, apply}` | `invalid plugin, expected apply, received undefined` | 加载器取返回值为插件定义（R11b） |
| **不得 require 本地文件** | 加载失败 | `require` 只解析宿主模块表内的**包**，无相对路径 |

→ 源码是 `src/client/*.ts` **13 个真 ESM 模块**（cycle-13 T-025 拆分：ui-kit / study-view / papers-view / graph-analytics / graph-physics / graph-transition / graph-canvas / graph-engine / graph-view / obs-view / repos-view / client；cycle-18 新增 **huasheng13-view**），
tsc 产出多文件后由 `scripts/bundle-client.mjs` 按 **DFS 拓扑序**合并回单文件 combo。
铁律：不重命名标识符、不压缩、不删注释；合并后共享 factory **单一作用域 → 全部文件顶层名必须唯一**
（前缀纪律：graph 系 `graph*/KG_*`、study 系 `kg*/Kg*`、obs 系 `Obs*`、repos 系 `rp*/Rp*/RP_*`、**methodology 系 `hs13*/Hs13*`**）。
复杂度预算 180（`.cycles/config.yml`），超预算按「只读纯函数外提 + 闭包值同名参数穿线」模式拆分。

### 样式注入

不依赖 `styles` 全局（combo 环境可能没有），用双保险：

```js
ctx.effect(() => {
  if (typeof styles !== 'undefined' && styles && styles.insert) return styles.insert(CSS) || (() => {})
  const el = document.createElement('style'); el.textContent = CSS
  document.head.appendChild(el)
  return () => { try { el.remove() } catch {} }
}, 'kaogong styles')
```

## 5. 视图注册（双入口）

| 入口 | 机制 | 数量 |
|---|---|---|
| 左栏面板 | `sidebar.panellist` 图标（svg 带 `data-dsh-panel-entry`） + `main` keyed slot 全屏页 | 1 个图标 → 16 视图 |
| 右侧标签 | `sidebarRightTabs.register()` + `sidebar.right.pane.tab` keyed slot **双注册同 id** | 1 个标签 → 同一套视图 |

图标**不要自己绑 click**——shell 用 `data-dsh-panel-entry` 做事件委托，自己绑会双重触发。

## 6. 视图数据模式（v1.6+）

| 模式 | 视图 | 说明 |
|---|---|---|
| **父 effect 驱动** | dashboard / wrongbook / graph / obs | 父组件 `useEffect` 按 `view` 拉数据，`setData({kind,...})`，子视图只渲染 |
| **子组件自管** | papers / topics / essay / practice / exam / deepbank / tuxing / repos / **huasheng13** | 子组件内 `useEffect` 自行 fetch；父只负责挂载与传参 |

子组件自管的理由：避免父 effect 的 `data` 状态与「提交后重挂载换题」互相干扰（v1.6 刷题 bug 的根因）。

所有视图挂载都带 `key={view + tick}`，保证切换即**干净重挂载**（R9 修复）。

## 7. 版本演进

| 版本 | 主题 | 关键产出 |
|---|---|---|
| 1.2–1.3 | 双入口 + SRS | 左栏/右栏、错题五箱 |
| 1.4 | 界面进宿主 | 同源路由 + 原生 React 面板（埋下 R9/R10） |
| 1.5 | 崩溃修复 | combo 格式、ErrorBoundary、渲染回归测试 |
| 1.6 | 真题卷 | 1683 套卷、专题、申论离线评改 |
| 1.7 | 深度 + 完整交互 | 27506 题五维标注、整卷模考、大作文分档、配图 |
| 1.7.2 | 回归修复 | R15 组件丢失、R14 视图覆盖补齐、docs/agents |
| 1.8–1.9 | 图谱与白盒 | 交互图谱引擎（FR/预收敛/标签去重叠）、算法族 9 个、白盒面板、专题枢纽、省份维度、环形布局前夜 |
| 1.10 | 专项刷题记忆 | /api/memory（kind 白名单+8KB+LRU）、三专项视图「上次练到」横幅一键跳回原题、图谱第三布局环形 + 边流动粒子、白盒三件套 |
| 1.11 | 一键式题库管理 | 数据根四级解析 + 域工厂重建、repoManager（clone/pull/删除/浏览/作业面/镜像代理）、repos-view 面板 + 关于本项目卡、REPOS_META 分级注册表、发布卫生（GitHub + npm） |
| 1.12 | 隔离与显示修复 | 图谱缓存按 wsKey 分槽（跨项目不互染）、spawn windowsHide（控制台闪现根因）、kaogong_launch 输出全实时化（模板陈旧根因）、peer 预发布分支（市场规范）、市场合规（topic/icon/screenshots） |
| 1.13 | 花生十三体系方法论 | cycle-18：`/api/huasheng13/*` 6 端点（catalog/doc/search/coverage/practice/trace）、BM25 中文 bigram 引擎、六模块覆盖矩阵（overall 0.9756，dims 维度适用性）、74 题配套练习（32 可自动判分/42 自评）、专题→方法论主视图 + 「另见」折叠区、`kaogong_ai_method`、语料统一走数据根（必选 huasheng13 336KB，REPOS_META 16 仓库、kaogong-skill 降 recommended） |
