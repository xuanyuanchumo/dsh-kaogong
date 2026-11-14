# cycle-27 测试报告（v1.23.0 模考四区划分 + 真题卷整卷模式）

## 2. 汇总

| 指标 | 值 |
|---|---|
| 通过 | 398 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |

| 套件 | 结果 | 说明 |
|---|---|---|
| `npx tsc --noEmit` | 0 错误 | QwPaperMode 四区容器 + 双视图接入编译通过 |
| `npm run build` | PASS | 16 模块 517KB + assert-combo OK |
| `node smoke.test.mjs` | **340/340 通过** | C26-03 守卫锚点跟改（组材料消费下沉 QwPaperMode） |
| `node render.test.mjs` | **58/58 通过** | 「← 上一题/下一题 →/交卷」锚点保留全过 |

## 交付

| 项 | 内容 |
|---|---|
| QwPaperMode 四区容器 | 区1 材料区（题组材料·无则隐藏·key=材料文本头同组切题不重挂）→ 区2 题目区（QwQuestionCard，material 禁传避免双事实源）→ 区3 切换区（上一题/下一题/位置）→ 区4 答题卡区（可折叠） |
| 模考接入 | exam 做题态一行 `<QwPaperMode mode="exam">`；start 端点补 type+groupMaterial 下发（组材料非答案，answer/analysis 仍剥离） |
| 真题卷整卷模式 | papers 详情 130 题长列表 → `<QwPaperMode mode="browse">`（材料区随题组切换 + 只读答题卡跳转 + 题间导航）；browseIdx 换卷重置 |
| 响应式 | ≥1100px 宽屏材料区左栏 38% + 题目区右栏；窄屏纵向堆叠 |

## 4. 失败项详情

无失败项。

## 结论

**PASS — 门禁证据齐备**
