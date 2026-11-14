# cycle-26b 测试报告（v1.22.0 二报修复：专题组材料 + ref 保留 prop 根因）

## 2. 汇总

| 指标 | 值 |
|---|---|
| 通过 | 398 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |

> 旅程覆盖：render 全用户旅程 100% 通过；真题卷详情分支经集成复现（B 卷形态 130 题/组材料 80 题）验证零降级。
> 混沌覆盖：smoke 崩溃安全段全过。

| 套件 | 结果 | 说明 |
|---|---|---|
| `npx tsc --noEmit` | 0 错误 | repoData 组材料表 + QwMaterial matRef 改名编译通过 |
| `npm run build` | PASS | 16 模块 513KB + assert-combo OK |
| `node smoke.test.mjs` | **340/340 通过** | 全量含 C24/C25/C26 守卫 |
| `node render.test.mjs` | **58/58 通过** | 全链路零降级 |
| 解析器直测 | 10/10 题带组材料 | 专题刷题链路（parseQuestions）样例材料含 kgimg:// 图占位 |
| 集成复现 | 降级消除 | react-test-renderer 完整链路：导航→卷行→详情，组材料段渲染、无 ErrorBoundary |

## 二报缺陷闭环（R08）

| ID | 现象 | 根因 | 修复 | 回归 |
|---|---|---|---|---|
| D-1b 专题资料分析无材料 | 专题刷题链路材料正文从不进题目对象（repoData 只附材料图） | parseQuestions 无组材料注入 | matTextTable 位置表 + 「最近前置材料段」归属 + groupMaterial 入题目对象 | 直测 10/10 |
| D-4 整卷面板渲染降级 | `React.createElement(QwMaterial, { ref: ... })` —— ref 是 React 保留 prop，字符串 ref 在 DOM 提交期抛错 → 整卡进 ErrorBoundary | cycle-25 QwMaterialProps 用了 `ref?: string` | 改名 `matRef`（interface + 调用点同步） | 集成复现降级消除 |

## 4. 失败项详情

无失败项。

## 结论

**PASS — 门禁证据齐备**
