# cycle-24 测试报告（v1.19.0 客户端组件化 TSX 重构）

## 执行环境
- 日期：2026-11-14（北京时间）
- Node v24.14.0 / Windows x64
- 变更面：20.7% 源文件（eval-runner Merkle 抽样判定 full）

## 2. 汇总

| 指标 | 值 |
|---|---|
| 通过 | 389 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |

> 旅程覆盖：render 套件含专题枢纽→刷题→判分→错题本→图谱→白盒全用户旅程，正反向 100% 通过无跳过。
> 混沌覆盖：smoke 崩溃安全段（§12 端口占用/半成品清理）全过。

| 套件 | 结果 | 说明 |
|---|---|---|
| `npx tsc --noEmit` | 0 错误 | 类型门全绿（新增 25+ Props interface 编译通过） |
| `npm run build` | PASS | tsc → bundle-client（14 模块拓扑合并，含 views/ graph/ 子目录）→ assert-combo（combo 形态 OK） |
| `node smoke.test.mjs` | **331/331 通过** | 含新增 C24-01..06 组件规范守卫 6 条 |
| `node render.test.mjs` | **58/58 通过** | 真实 React 18 + 真实 client.js 集成渲染 |
| band-detector | report 模式 exit 0 | 无新增 OVER_BUDGET（graph-view 191 为既有热点） |

## 关键回归证据（修复过程留痕）

1. **C24-1 channel 守卫误删**：render 主面板断言抓到 `Cannot read properties of null (reading 'kind')` → 补回 `if (!channel)` 加载态守卫 → 修复后 8/9 → 全绿。
2. **C24-2 早退在 hooks 前**：obs-view 自治化后 `Rendered more hooks` → 早退移到全部 hooks（含 2×useMemo）之后 → 修复。
3. **C24-3 派生计算先于守卫**：`ins.essay` null 解引用 → `insSafe` 防御读取 + hs13 透传改自治状态 → 修复。
4. **C24-4 守卫锚定旧形态**：smoke 3 条断言锚定三元分发/`data.g` 旧文本 → 同波次更新为 VIEW_ROUTES 注册表形态；`h(NativePracticeView` 锚点扩展为 `(?:h|React\.createElement)\(`（JSX 产物形态）。

## 4. 失败项详情

无失败项（最终轮全部断言通过；中间轮失败已在上方「关键回归证据」留痕闭环）。

## 结论

**PASS — 门禁证据齐备（G0-Q1/Q5、G2-Q2、G3-Q3/Q4 依赖本报告与评估报告）**

