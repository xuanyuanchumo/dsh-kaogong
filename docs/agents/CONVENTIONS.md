# 开发规范与技术选型

## 一、为什么是「React + JS 无 JSX」，而不是 TypeScript + JSX？

这是本项目最常被问的问题。答案不是偏好，而是**宿主加载器的硬约束**。

### 1. React **在用**，而且是最新 18

client 半就是 React 18 应用：

```js
const React = require('react')          // 宿主模块表提供，无需打包
const h = React.createElement
// 16 个视图全部是函数组件，用 hooks：
const [view, setView] = React.useState('dashboard')
React.useEffect(() => { /* fetch */ }, [view])
React.useCallback(...) / React.useRef(...) / React.useMemo(...)
```

组件复用、状态、副作用、Ref、错误边界（class 组件）一样不少。**没有的是 JSX 语法糖和 TS 类型标注**。

### 2. 没有 JSX 的原因

宿主加载器直接加载**未编译的源码文件**（`package.json` 的 `exports['./client']` 指向 `src/client/client.js`，就是磁盘上的原文件）。没有任何构建步骤介入。

- JSX 需要构建期转译（babel/esbuild/swc）→ 需要引入构建步骤
- TS 同样需要编译 → 同一问题

而 DSH 插件生态的部署模型是「源码即产物」：`install_bundle` 用 `link:` 挂目录，改完源码热重载即生效。引入构建步骤会破坏这个模型（改完要重新 build、dist 与 src 可能不一致、热重载要等编译）。

### 3. 没有 TS 的原因

除上述构建问题外，还有一条组合约束：

- **Host 半**是标准 Node ESM，理论上可以 `import` 本地 `.ts`（Node 22+ 有实验性 type stripping）——但 `node --check` 语法门与 `engines` 声明都会变得挑剔，且 `import` 类型擦除在部分语法下不成立。
- **Client 半**完全不行：combo factory 里只能 `require` **包级模块**，`require('./types.ts')` 直接失败。

### 4. 代价与补偿措施

失去类型系统，我们用什么兜？

| TS 能拦住的问题 | 本项目的替代防线 |
|---|---|
| 未定义标识符（如 R15 的 `NativeDeepBankView is not defined`） | `node --check`（语法通过但引用未定义查不出）→ **靠 render.test 真挂载每个视图**（R15 后已覆盖全部 16 视图） |
| prop 形状不匹配（R12 的 `props.data.metrics` 读到 undefined） | **render.test mock 全端点真实形状 + 每次切换断言无 `role="alert"`** |
| 字符串枚举拼错（如 `view === 'deepbank'`） | smoke 静态断言 + 真机点击验证 |
| 后端响应结构漂移 | smoke 端到端断言（262 条，跑真实 server + 真实数据） |

这些防线**能覆盖大部分类型错误**，但确实不如编译器早——R15 就是漏到了真机才发现（因为 render 测试当时只点了 3 个视图）。

### 5. T-022 已实施：TS 迁移完成（v1.7.3）

```
src/client/client.ts  --(esbuild, 零配置)-->  dist/client.js
src/host/*.ts         --(esbuild)-------->  dist/host.js
package.json exports 指向 dist/*，并加 prepublish build
smoke 增加「dist 时间戳 >= src 时间戳」新鲜度门
沙箱验证 dist 产物
```

- **收益**：编译期拦截未定义标识符与 prop 形状错误（R12/R15 那两类的根治）。
- **成本**：部署模型从「源码即产物」变为「构建产物」；热重载需先 build；CI 需加一步；`_dshcli` 沙箱需装 esbuild。
- **结论（2026-11-03 已执行）**：T-022 完成。详见下方 §6「构建与部署模型」。

## 二、编码规范

### 2.1 通用

- **全中文注释**（面向中文母语维护者）；标识符英文。
- **ESM**（host/server/adapters/test）；client 半是 factory 闭包（非 ESM）。
- **零 npm 运行时依赖**：只用 Node 标准库（`node:fs`/`node:path`/`node:crypto`/`node:sqlite`）+ 宿主提供的 `react`。
- **仅绑定 127.0.0.1**；唯一写路径是 `data/`（进度、信标、快照）。
- 单文件复杂度预算 **180**（`.cycles/config.yml`），超限先拆分或记录理由。

### 2.2 客户端纪律（client.js）

| 条款 | 说明 |
|---|---|
| 无顶层 `export` | 必须是 `window.__ModuleLoader__.load({...})` |
| factory 尾部 `return { inject, apply }` | 缺了会 `invalid plugin` |
| 事件用 camelCase | `onClick` 不是 `onclick`（R6：小写被 React 静默丢弃） |
| 子视图必须 `h(Comp, props)` | 禁止 `NativeXxx({...})` 直调（R9：hook 记到父链 → 白屏） |
| 每个挂载带 `key={view + tick}` | 切换即干净重挂载 |
| 工具函数 null 防御 | `Object.entries(p \|\| {})`（R4） |
| 深嵌套三元禁止 | 用「提前 return + 分块构造」（R13 括号错配事故） |
| 新增视图必须加 render 断言 | R14/R15：漏测即漏检 |
| **顶层名必须带模块前缀** | combo 合并后共享单一作用域，裸词撞名 = 重复声明 SyntaxError（教训⑨）。已用前缀：graph 系 `graph*/KG_*`、study 系 `kg*/Kg*`、obs 系 `Obs*/sup*`、repos 系 `rp*/Rp*/RP_*`、**方法论系 `hs13*/Hs13*`**（`hs13Num/hs13FmtPct/Hs13CatalogCard/HS13_SECTIONS` 等） |
| **导航不得新增一级入口** | 用户明确要求：新功能收敛进 `🎯 专题` 枢纽分区（分区按钮用 `data-kg-hub-tab` 锚定），不往一级导航加项。方法论 = 专题 → `📖 方法论`（`data-kg-hub-tab="method"`）；视图 id 可保留深链 |

**推荐写法（分块构造）**：

```js
function MyView({ api }) {
  const [q, setQ] = React.useState(null)
  // 分支用提前 return，不写三元链
  if (!q) return h('div', { className: 'kg-load' }, '加载中…')
  // 内容分块构造，最后拼装
  const tags = []
  if (q.module) tags.push(h('span', { key: 'm', style: KV_TAG }, q.module))
  const options = Object.entries(q.options || {}).map(([L, t]) => h(OptionRow, { key: L, label: L, text: t }))
  return h('div', {}, h(TagRow, { items: tags }), options)
}
```

### 2.3 服务端纪律

- 域模块统一签名 `(path, params, post, method, wsRaw) => object | undefined`。
- 返回 `undefined` = 不归我管；返回对象 = 响应体（自动 JSON 序列化）。
- **二进制端点**必须注册在 JSON 链路之前，并做：路径穿越防护（`resolve` 后必须仍在根内）+ 扩展名白名单 + `writeHead` 失败保护（头已发出不得二次写）。
- 新端点三件套：**manifest 声明 → server 实现 → UI 消费**，缺一 drift。
- **路径是运行期事实**（R19）：数据根一律经 `dataRoot.resolveReposRoot()` 解析；变更走 `rebuildDomains()`（域重建 + resetPaperIndex/resetNaoku/graphCache 三失效），禁止新增加载期硬编码路径。
- **缓存键覆盖响应的全部可变输入维度**（R20）：响应含 per-ws 字段（如 progress）时，缓存必须按 wsKey 分槽并设上限（graphCache Map + LRU 24）。
- **子进程纪律**（R21/cycle-0 同族）：`spawn` 一律 `windowsHide: true`（Windows 控制台闪现）+ `GIT_TERMINAL_PROMPT=0` 类无交互开关 + `on('error')` 与 close 非零码全部收敛为作业状态；外部异步错误绝不冒泡。
- **面向模型/用户的文案从事实源渲染**（R22）：工具输出、引导文案一律取自 `/api/capabilities` 等实时端点，不手写模板（防声明/呈现漂移）。
- 业务性失败返回 `{error}` + HTTP 200（UI 卡片级降级）；仅基础设施异常才 5xx。

### 2.3b 市场与发布纪律（v1.12 新增）

- peer/engines 范围必须带**显式预发布分支**（`>=A <B-0 || >=B-rc.0 <C-0 || …`）——无预发布分支的宽范围静默排除所有 rc（node-semver 规则），用户 ERESOLVE。
- 发布走**独立干净快照目录**（无 `data/`、`.dsh/`、`.cycles/`、开发仓 git 历史）；`npm pack --dry-run` 是包卫生的机器证据。
- GitHub 推送优先 **SSH**（Windows 下 HTTPS 443 易被重置，22 端口稳定）。
- 市场投稿 = 一个 YAML 文件（`data/plugins/<owner>__<repo>.yml`）；仓库需 topic `dsh-plugin`、`dsh.bundle` 声明、真实代码、描述数字与代码核对属实。
- 条目字段只用 `url/name/category/description{en,zh}/icon/tarball`；**不得手写 `npm:` 键**（registry 自动关联，写了会被校验拒绝）；`description.en` 必填，含 `: ` 时必须加引号；category 选贴合功能的（本项目 `tools`）。
- 截图声明在**本仓** `screenshots.json`（1–8 张、相对路径、不跳出插件目录）；`icon` 必须是 GitHub 托管的位图（SVG/第三方图床会被拒）。

### 2.4 适配器纪律

- 只读数据源，绝不写回源仓库。
- 慢操作必须有缓存：磁盘快照（paperData）、进程内 TTL（60s）、目录列表缓存（naokuImage）。
- 大文件/大目录遍历用递归限深 + 目录名过滤（跳 `.git`/`node_modules`/`_` 前缀）。
- 平台依赖能力（`node:sqlite`）必须**动态 import + 优雅降级**，不能顶层 import（否则旧 Node 整插件加载失败）。
- **语料一律走数据根，不随包**：方法论语料在 `<数据根>/huasheng13`（`repoRoot/META.root`），与其它 15 仓库同一条安装/更新/删除链路；包内 `assets/` 只放图标与截图。新增语料的四步法（放文件 → 登记 `HUASHENG13_META` → fixtureHash 快照失效 → 加 smoke 断言）见 [METHODOLOGY.md](./METHODOLOGY.md) §5。

## 三、数据契约纪律

UI 曾大规模手写 `/api/*` 导致漂移（`q.answer` vs `q.correctAnswer`、`limit` vs `count`）。现固定：

1. **`manifest.js` 是唯一事实源**，声明端点/工具/视图/lifecycle。
2. 端点返回字段名以 server 实现为准，UI 只消费 manifest 声明的端点。
3. 字段改名必须同时在：manifest 描述、server、client、smoke 断言、本文档 API-REFERENCE。

## 四、Git/文件纪律

- 生成物（`data/.paper-index.json`、`data/.naoku.db`、`.cycles/.eval-cache.json`）不入提交。
- 临时脚本用完即删（`_*.cjs`），不要留在仓库。
- 事故修复必须同时更新 [INCIDENTS.md](./INCIDENTS.md) 与对应守卫测试。

## 六、构建与部署模型（T-022 后）

```
src/**/*.ts  --(tsc, noEmitOnError)-->  dist/**/*.js  --(宿主加载)-->  运行
```

| 项 | 值 |
|---|---|
| 编译器 | TypeScript 5.9（**devDependency**，零运行时依赖不变） |
| 输出 | `dist/` 镜像 `src/` 结构（非 bundle，import 路径原样保留） |
| 入口 | `package.json` main/exports 全部指向 `dist/` |
| 类型阻断 | `noEmitOnError: true` —— 有类型错误则构建失败 |
| 擦除保证 | `verbatimModuleSyntax` —— `import type` 完全擦除，client 产物仍是纯脚本 combo |

### 三条必守纪律

1. **改完 .ts 必须 `npm run build`**：宿主编织的是 dist，不是 src。
2. **dist 新鲜度门**：smoke 断言「dist mtime >= src mtime」，过期即失败（防止忘构建）。
3. **client.ts 只能用 `import type`**：任何值导入都会在产物里留下 import 语句，破坏 combo 脚本语义。

### 为什么 mirror 输出而不是 bundle

- 保持 import 路径与源一致（`./x.js` 在 dist 里同样成立）
- `await import('node:sqlite')` 这类动态导入原样保留，不被静态化
- 单文件定位与源码一一对应，便于排查

### 失败案例（真实踩过）

- `Object.entries` 在动态对象上退化为 `unknown` → 引入 `entries()` 辅助；**但替换把辅助自身也替换成自调用**，产物变成无限递归。教训：批量文本替换后必须检查产物首行与自引用。
- 改 `package.json` main 后主力热重载失败 → 宿主**自动移除** patch 条目（API 全 404 且 `set_plugin` 报 unknown-plugin）。恢复：`remove_bundle` → `install_bundle`。

## cycle-19 追加纪律（v1.14.0）

- **工具输出标记行**：所有面向模型/用户的工具输出，尾部统一 `kgMarkTail` 标记行（版本锚/服务态/ws 隔离键）——呈现层也走「声明 vs 运行态同源」（㉑纪律的推论）。
- **遥测双口径**：`recordRequest` 可以记宽（观测余量），`/api/capabilities` 对账必须严（UI 壳 `/`、`/index.html`、`__unmatched__` 一律不进对账集）——沙箱旅程实证 missingProducers 假漂移后固化为 smoke R-OBS-03。
- **生命周期量化**：lifecycleSnapshot 每阶段带可选 `cumMs`（启动后到达耗时），服务端算、客户端渲染，字段缺失即徽章降级——「何时发生+多久」的白盒量化。
- **研究文档纪律**：docs/research/ 每篇五段式（数学定义→代码落地文件:行号→场景启发→工程价值→验证命令）；smoke RDOC-01/02 守卫存在性与引用真实性。

## cycle-20 追加纪律（v1.15.0 题库管理）

- **失败作业必须留下可恢复的现场**：clone/pull 失败时，若目标目录是「本次新建且无 .git 的半成品」，自动清理以解除「非 git 目录拒绝覆盖」死锁；用户既有非空数据目录一律受保护。**删除的判据必须同时满足「本次新建」+「无 .git」+「近乎空」三条，缺一不可。**
- **「一键」必须是真一键**：批量动作走服务端队列（并发上限内自动补位），UI 只跟踪批次进度；客户端逐个按钮 + 并发拒绝 = 名不副实的一键。
- **失败原因不随作业消失**：作业完成后归档到环形历史（key/action/state/error/elapsedSec/logTail），UI 可查「上次为什么失败」。
- **配置写入必须校验**：路径类配置校验「绝对路径 + 可写探测」，URL 类校验协议；非法输入返回 error 且不落盘。
- **健康态显式化**：把「装了但不可用」（空仓库/缺 .git/半成品）从 present 布尔里拆出独立 health 词表，UI 用徽章呈现；「可用空间」等无法探测的量用 null + 降级，绝不臆造 0。
- **换根不删数据**：切根时记录旧根快照并统计其仓库数，UI 明示「旧根仍有 N 个仓库（数据未删除）」+ 一键切回——消解「数据凭空消失」的恐慌。
- **截断口径单一事实源**：分页/截断的 total 恒为真实总数，truncated 由「真实总数 > 实际返回数」派生，客户端文案从服务端字段渲染，禁止两侧各写一个数字。

## cycle-29~32 新增纪律（v1.26~v1.29.1）

### 工具 UI 展示契约（v1.26）
- 新增宿主工具必须声明 `presentCall`/`presentResult`（`kgToolCard` 工厂复用）——纯函数投影（must be total），异常收敛 undefined 保留宿主兜底；workspace 隔离键不进卡片正文。守卫 C29-01..03。

### 复杂度预算与固定拆法（v1.26 持续生效）
- 任何文件加逻辑后先跑 band-detector；超 180 走 cycle-13 教训①固定拆法（只读纯函数外提+参数穿线），落点新模块文件（如 graph-subgraph/graphQuery/planSchedule）。

### 排程/分配类算法纪律（v1.27）
- 复用 SRS 同源弱度模型 `1/(rate+0.15)`（同一业务语义全仓单一事实源）；确定性（无 Math.random/Date.now）；分配类算法必须有守恒断言（Σ=30，SMOKE-SCHED-04）。

### 共享组件 mode × reveal 语义矩阵（v1.29.1）
- `QwAnswerDims.hideBeforeAnswer = (mode === 'practice' || mode === 'exam')`——practice/exam 作答场景未揭示占位防偷看；browse/single 浏览场景解析完整显示。**改共享组件显示条件必须枚举全部消费 mode 的语义**，回归测试覆盖「所有 mode × 所有 reveal 态」矩阵（RENDER-PP-30/31/31b/32）。

### 真题卷三模式（v1.29）
- 新增学习/答题类功能先问「与既有 exam/practice/browse 域差异是什么」——三模式全部由既有域组合（零新端点零新判分器）。状态各自 useState、换卷统一重置（openId effect）。诚实降级必配「下一步」出路（主观题跳题按钮，降级≠死路）。
