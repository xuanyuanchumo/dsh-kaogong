# cycle-25 测试报告（v1.20.0 统一题目渲染域）

## 2. 汇总

| 指标 | 值 |
|---|---|
| 通过 | 394 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |

> 旅程覆盖：render 全用户旅程（枢纽→刷题→判分→错题本→图谱→白盒→模考→真题卷→申论）100% 通过无跳过。
> 混沌覆盖：smoke 崩溃安全段全过。

| 套件 | 结果 | 说明 |
|---|---|---|
| `npx tsc --noEmit` | 0 错误 | question/ 组件域 + 3 视图接入编译通过 |
| `npm run build` | PASS | 16 模块拓扑合并（question/* 新增 2 模块入 bundle 512KB）+ assert-combo OK |
| `node smoke.test.mjs` | **336/336 通过** | 新增 C25-01..05 守卫 5 条 |
| `node render.test.mjs` | **58/58 通过** | practice 判分链路/exam 模考/papers 详情/essay 申论全渲染零降级 |
| bundler 幂等 | 三连跑 exit 0 | T-25-06 缺陷根治验证 |

## 关键改造证据

1. **统一七段**：0 编号（QwNumberBadge + 标记旗）/ 1 来源（QwSourceMeta）/ 2 类型（QwTypeTag）/ 3 材料（QwMaterial 受控折叠）/ 4 题干（QwStem）/ 5 选项（QwOptions interactive 三态/browse 描边）/ 6 答案解析（QwAnswerDims 五维 + 参考答案折叠）
2. **答题卡**（QwExamNavigator）：模考首次支持网格跳转，四态（未答灰/已答蓝/标记黄/当前描边）+ 🚩标记旗 + 进度统计
3. **图片放大**（QwLightbox）：滚轮围绕指针缩放 0.5-4x、拖拽平移、双击复位、ESC/遮罩关闭；题干/材料/选项/解析四链路 img 全部可点击
4. **契约保留**：papers-view 材料折叠（collapsedMats/toggleMat/jumpToMaterial）一字未动（C25-05 固化）；render 判分/模考锚点全过
5. **bundler 幂等缺陷根治**：对已合并 combo 二次运行原会尾部锚点失配（被 npm scripts 先 tsc 掩盖），现检测合并形态即跳过并复跑形态验证

## 4. 失败项详情

无失败项。

## 结论

**PASS — 门禁证据齐备**
