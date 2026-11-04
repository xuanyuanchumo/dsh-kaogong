# 开发规范与技术选型

## 一、为什么是「React + JS 无 JSX」，而不是 TypeScript + JSX？

这是本项目最常被问的问题。答案不是偏好，而是**宿主加载器的硬约束**。

### 1. React **在用**，而且是最新 18

client 半就是 React 18 应用：

```js
const React = require('react')          // 宿主模块表提供，无需打包
const h = React.createElement
// 13 个视图全部是函数组件，用 hooks：
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
| 未定义标识符（如 R15 的 `NativeDeepBankView is not defined`） | `node --check`（语法通过但引用未定义查不出）→ **靠 render.test 真挂载每个视图**（R15 后已覆盖全部 13 视图） |
| prop 形状不匹配（R12 的 `props.data.metrics` 读到 undefined） | **render.test mock 全端点真实形状 + 每次切换断言无 `role="alert"`** |
| 字符串枚举拼错（如 `view === 'deepbank'`） | smoke 静态断言 + 真机点击验证 |
| 后端响应结构漂移 | smoke 端到端断言（80 条，跑真实 server + 真实数据） |

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

### 2.4 适配器纪律

- 只读数据源，绝不写回源仓库。
- 慢操作必须有缓存：磁盘快照（paperData）、进程内 TTL（60s）、目录列表缓存（naokuImage）。
- 大文件/大目录遍历用递归限深 + 目录名过滤（跳 `.git`/`node_modules`/`_` 前缀）。
- 平台依赖能力（`node:sqlite`）必须**动态 import + 优雅降级**，不能顶层 import（否则旧 Node 整插件加载失败）。

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
