# RELEASE-NOTES v1.14.0 — cycle-19：研究文档体系 + 白盒量化增强 + 市场物料

> 发布日期：2026-11-13（北京时间） · 类型：minor · 测试证据：smoke 276/276 + render 50/50 + 沙箱旅程 30 项全过

## 新增

- **📐 数学模型研究文档体系 `docs/research/`**（10 篇 + 索引）：PageRank 幂迭代 / BM25 中文双粒度 / 五箱 SRS 遗忘曲线 / FR 力导向 / LRU+环形+代际令牌 / 中介中心性+社区发现 / 内容寻址+原子写+Merkle / 遥测分位数+控制带 / 参考插件技巧实证清单 / 流动语义与桑基思维。每篇五段式：数学定义 → 代码落地（文件:行号）→ 中文语言/学习场景启发 → 工程价值 → 可运行验证。smoke RDOC-01/02 守卫存在性与引用真实性（R14 事实基座纪律）。
- **工具输出标记行（`kgMarkTail`）**：六个 AI 工具输出统一「正文 + 尾部标记行」`[kaogong vX.Y.Z · 服务:up|down · ws:<ns>]`——版本锚/服务态/隔离键三要素（dsh-ops host-contract 卡片模式落地，呈现层同源纪律）。
- **生命周期量化**：`/api/lifecycle` 增每阶段 `cumMs`（启动后到达耗时）与顶层 `bootMs`（本次启动耗时）；白盒生命周期 stepper 每阶段渲染耗时徽章 + 卡头「启动 X」标签（可选字段缺失即降级，绝不臆造）。
- **图谱搜索回车循环**：搜索框连续回车按命中序循环定位（`N/M` 提示行），Esc 收起——多命中场景不再需要逐个点击。
- **市场收录物料**：`docs/marketplace/xuanyuanchumo__dsh-kaogong.yml`（六项结构断言校验）+ MARKETPLACE-ENTRY 更新（category=usage）。

## 修复

- **[对账假漂移] UI 壳路径混入端点对账**：`/api/capabilities.reconciliation.missingProducers` 误报 `["/"]`（同源通道把 UI 页面壳记进遥测端点表）。根修双层：`isDeclaredEndpoint` 排除 `/`、`/index.html`；对账消费集再过滤壳路径与 `__unmatched__` 桶。守卫 smoke R-OBS-03。
- README 陈旧计数（267→276）与「约 363MB」写死体积清除（㉘纪律）。

## 验证证据

| 项 | 结果 |
|---|---|
| `npm run test:all` | smoke 276/276 · render 50/50 |
| 沙箱真机旅程（sb-kaogong） | 正向 17 + 反向/隔离 13，全过 |
| `npm pack` 卫生 | 76 文件 · patch/模板/icon 零断链 · 语料零混入（HS13-10） |
| npm 发布 | `dsh-kaogong@1.14.0`（tarball 954.5KB，shasum 9e6e8659…） |
| GitHub | main ca7d36f + tag v1.14.0（SSH 通道） |
