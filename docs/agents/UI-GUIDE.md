---
title: 前端 UI 规范（cycle-48 固化 · 守卫随测试演进）
status: current
updated: 2026-11-26
---
# 前端 UI 规范（cycle-48 固化 · 守卫随测试演进）

> 适用范围：`src/client/**`（ui-kit.tsx + views/*.tsx + question/*.tsx）。
> 原则：**视觉层级靠 token、交互反馈靠全局规则、降级语义靠卡片级**——三者都不许每处手写。

## 一、颜色 token（单一事实源 = client.tsx 注入的 `:root` 变量）

| token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--surface-card` | `#fff` | `#232324` | 卡片/面板底（dsw alias 派生） |
| `--text-primary` | `#0f172a` | `#e2e8f0` | 主文字（标题/正文强调） |
| `--text-secondary` | `#475569` | `#cbd5e1` | 次级文字（正文默认） |
| `--text-muted` | `#64748b` | `#94a3b8` | 弱化文字（说明/标签） |
| `--text-faint` | `#94a3b8` | `#64748b` | 极弱文字（辅助/占位） |

**纪律**：
1. **视图层文字色禁止硬编码 slate 灰阶**（`#0f172a/#334155/#475569/#64748b/#94a3b8`）——一律消费
   `var(--text-*)`（cycle-48 已完成 253 处 token 化；新增代码直接用变量）。
2. **brand 语义色允许硬编码**（indigo `#6366f1` / emerald `#10b981` / amber `#f59e0b` / red `#ef4444` /
   violet `#8b5cf6` 等）——它们是「语义色板」而非「主题色」，暗底可读，且与图分析色板
   （NODE_META/EDGE_META）同源。
3. **SVG 图元 fallback 灰可用 `var(--text-faint)`**（CSS 变量在 SVG fill/stroke 上下文可解析）。

## 二、交互反馈（全局规则，零状态化）

React 内联样式体系无法用 `:hover`——**不自管 onMouseEnter 状态**，统一走 client.tsx 注入的
全局规则（cycle-48 落地）：

```css
[style*="cursor: pointer"]:hover { filter: brightness(1.06) }
[style*="cursor: pointer"]:active { filter: brightness(.94) }
```

**纪律**：可点元素只需 `cursor: 'pointer'` 即自动获得 hover/active 反馈；不要为单元素
手写 onMouseEnter 状态机（既有 1 处保留，新增禁止）。导航按钮用 `.kg-navbtn` 类（有
专属 hover/选中态）。

## 三、降级语义（卡片级，绝不白屏）

1. 接口字段一律视为可选——缺失即**卡片级降级**（隐藏该卡/显示占位），绝不 `role="alert"`。
2. `role="alert"` 只属于 ErrorBoundary 兜底态——任何正常分支不许渲染它（render 旅程全量断言）。
3. 诚实降级必须回答「用户下一步怎么走」（C32 教训：降级≠死路，配跳过/重试入口）。

## 四、组件复用

1. **卡片**：优先 `<Card>`（ui-kit，surface-card 底 + radius 14 + shadow）；紧凑形态可用
   `var(--surface-card)` 内联（差异属设计自由度，不强制统一）。
2. **三态**：加载/错误/空一律 `KgLoad/KgErr/KgEmpty`（C44 守卫：视图层禁止手写 kg-load）。
3. **徽章行**：`KgChips`；出处标注：`SourceBadge`；五维标注：`DimBlock`。
4. **新增重复样式 ≥3 处时必须提为 ui-kit 组件**（先查 ui-kit 是否已有——16 组件清单见
   ui-kit.tsx 导出）。

## 五、守卫状态

| 规范条目 | 守卫 | 状态 |
|---|---|---|
| 文字 token 化 | 无字面守卫（机械替换已清零，回归靠 review） | ✅ 253 处完成 |
| 全局 hover 反馈 | 无字面守卫（CSS 注入一次性落地） | ✅ 完成 |
| 卡片级降级 | render 旅程全量 role="alert" 断言 | ✅ 长期守卫 |
| KgLoad 禁手写 | C44-02 静态守卫 | ✅ 长期守卫 |
| 组件消费 ≥4 视图 | C44-03 静态守卫 | ✅ 长期守卫 |

## 六、取数 hooks（cycle-48 · client/hooks.ts）

视图取数优先消费 （单端点）/ （多端点并行，条目可声明 
弱依赖）——内置 cancelled 防御 +  收敛 + loading 生命周期。**现有视图不强制回改**，
新增代码与新拆子组件必须消费（不再手写 cancelled 模式）。

**纪律**：
1. hooks/ 目录属 client/ 基建层（C24-03 白名单已含目录）；React 经  获取（C24-06 单 require 纪律）；
2. 依赖数组必须含路径变化源与刷新令牌（教训「永久 spinner」）；
3. 主源错误进 、弱依赖失败静默降级（fallbackNull）——不阻塞整页；
4. 早退 return（loading/err）仍放在全部 hooks 之后（R9）。

**迁移进度**：plan-view 已迁（示范）；其余 9 处 cancelled 模式逐视图迁移，每批 test:all 兜底。
**⚠️ barrel 形态纪律（cycle-48 实测新增）**：hooks/index.ts **禁用 `export { x } from '...'`**（export-from 带源形态）——bundler 的 collectExports 只认 function/class/const/let/var 声明，该形态被剥成孤立 `from '...';` 残行且重导出函数体不进依赖图 → 组件 undefined → render 旅程全 skipped（C29 教训的 export-from 变体复现）。正解 = import + 独立 export 两行式。守卫 = tests/smoke/client-arch.test.mjs C24-03（barrel 形态断言）。

## 七、TS 严格化渐进路线（cycle-48 盘点 · 分三档）

| 档位 | 选项 | 当前错误数 | 结论 |
|---|---|---|---|
| ① | noUnusedLocals | 69（32 文件）| **可清**——单文件 ≤10 处，逐文件清理（防删副作用依赖），清完即开启 |
| ② | strictNullChecks | 218 | 分域渐进（先 server/ 后 client/，逐域开） |
| ③ | noImplicitAny | 2306 | 长期档（Props/参数类型化随重构逐步收敛，不设 deadline） |

**React 客户端规范现状（cycle-48 核对）**：29 组件 Props 类型化 25/29（4 缺口已补齐）·
事件驼峰违规 0（R6 纪律稳固）· map 渲染 key 缺失 0（ObsFlowChart 已修）·
hooks 单 require 纪律稳固（C24-06 守卫）。

**新增纪律**：新组件必须声明 Props interface（render/smoke 守卫已在 C24 族，
TS 编译层 strict 渐进开启后自然强制）。
## 八、strictNullChecks 渐进（档②进行中）

**分布实测（218 错误）**：server/ 7 文件 55 错（paperApi 35 / http 11 / methodologyApi 3 /
poolApi 2 / ws 2 / historyApi 1 / repoManager 1）· client/ 6 文件 56 错 · shared 107。
**依赖闭包警告**：tsconfig files 单文件探测会牵连全依赖链编译（实测 ws.ts 探测暴露
全部 218）——分域渐进必须以「错误清单归档 + 逐批清零 + 全局开启」路径走，不能按域开。

**批 1 已修 3 处**：ws.ts filter(Boolean) → 类型谓词（sort 比较器 possibly null）；
host/index myServer/myAdopted null 初始化 → any 标注；client.tsx mq null 初始化 → any。
**剩余 215 错误主体**：progress/state 变量 null 初始化缺类型标注（let x = null → any/类型）、
.map/.filter(Boolean) 链 never 收窄、可选字段访问。修法统一：null 初始化补类型标注。

**推进节奏**：每批修 20-50 处 + test:all 全量兜底；全清后全局开启 strictNullChecks。
## 九、noImplicitAny 长期档评估（cycle-48 · 目标③完成）

**现状实测**：开启后 2306 错误（视图层 props 解构隐式 any / server 域函数参数隐式 any /
第三方形状 any 断言缺失）。
**评估结论**：分两轨收敛——① 新代码零隐式 any（Props interface 强制已有 C24 族守卫）；
② 存量代码随重构逐步标注（不设 deadline——一次标注 2306 处会引入大范围回归风险，
与渐进纪律冲突）。
**严格化现状**：noUnusedLocals ✅ 开启（档①）· strictNullChecks ✅ 开启（档②）·
noImplicitAny ⏳ 长期档 · strict 全档 ⏳ 随②③收敛后自然达成。
## 十、TS 严格化收官（cycle-48 · strict 全档达成）

**里程碑**： 全档开启——noUnusedLocals + strictNullChecks + noImplicitAny
（+ strict 附带的 noImplicitThis/useUnknownInCatchVariables 等全子项）全部零错误达成。

**档③关键根因**：TS7026 1723 处 = require('react') 无类型（react 18 无内置 types +
@types/react 未装 + tsconfig types:['node'] 排除）→ 装 @types/react@18（devDep，
不进运行时零依赖面）+ types 加 'react' → 一键清零。

**codemod 三批纪律**（2230→0）：① 逐参数显式 any 标注（箭头单参数必须括号 (n: any) =>）；
② 解构 Binding element 闭合后标类型；③ 字面量词典 Record<string, any> 断言。
**形态守卫跟锚点**：改形态必须同波次改 smoke 形态锚点断言（教训④推广实证）。

**新代码纪律**：新代码零隐式 any（Props interface 强制）+ 显式 any 仅限 catch 断言与
宿主注入面（api: any）——显式优于隐式，any 是降级出口不是常态。