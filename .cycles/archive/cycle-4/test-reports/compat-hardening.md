# 测试报告

## 1. 头部

| 字段 | 值 |
|---|---|
| 报告时间 | 20261103_004000 |
| 用途 | 循环验证（v1.5 兼容性硬化 · 宿主 GUI 崩溃修复） |
| 执行者 | AI (lead, ANIC L4) |
| 目标 | smoke 47 断言 + render 7 断言（真实 React 渲染回归） |
| 数据基线 | 15 仓库实数据 / v1.5.0 manifest |
| 环境 | Windows / Node v24.14.0 / react@18.3.1 + react-test-renderer（dev 目录 _kgtest） |

## 2. 汇总

| 指标 | 数量 |
|---|---|
| 通过 | 54 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |
| 未覆盖 | 2 |
| 耗时 | ~5s（smoke 47 + render 7） |

> 旅程覆盖：J6(新) 渲染安全——真实 client.js 经席位注册→主面板渲染→dashboard→practice 切换（v1.4 白屏点）→选项→提交→重挂载→再抽题→6 连视图切换压力，全链零崩溃 ✅。
> 覆盖缺口：T-004/T-013（宿主 GUI 内像素级 + 完整 dsh 加载验证）。
> 混沌覆盖：v1.4 反模式在测试中**主动复现崩溃**（Rendered more hooks）证明回归有效 ✅。

## 3. 用例明细

### smoke.test.mjs（47/47）
1-28 前轮全保留（信标/adopt/隔离/图谱/遥测/能力矩阵/崩溃安全）· 29-34 SRS 闭环 · 36-39 同源路由 mock · 40 通道声明 · 41-43 UI 契约 · **44 禁组件直调（R9 守卫）· 45 须 createElement 挂载 · 46 须 ErrorBoundary · 47 peerDeps/engines 声明 + R8 双防线**

### render.test.mjs（7/7，真实 React 18）
| # | 断言 | 结果 |
|---|------|------|
| 1 | v1.4 条件直调 → 如预期抛 "Rendered more hooks"（反证崩溃真实存在） | 通过 |
| 2 | v1.5 组件挂载 → 同序列零崩溃 | 通过 |
| 3 | 真实 client.js apply() 注册 main/tab 席位 | 通过 |
| 4 | 真实主面板渲染（同源通道 + 仪表盘） | 通过 |
| 5 | **dashboard→practice 切换渲染题目（v1.4 白屏点）** | 通过 |
| 6 | 选项→提交→重挂载→再抽题全链 | 通过 |
| 7 | 6 连视图切换压力（图谱/可观测/错题本/刷题/仪表盘/刷题） | 通过 |

## 4. 崩溃取证记录（本轮根因链）

| 证据 | 内容 |
|---|---|
| 用户报告 | 「有非常大的兼容性问题，会导致dsh宿主崩溃」（v1.4 装于主力 profile 期间） |
| guardian 记录 | 「dsh-kaogong 未声明 DSH 版本范围；兼容性未知」→ 闸门无法保护 |
| crash-repro.mjs | 双代竞态复现（gen1 disposer 误删 gen2 挂载）；clientError 在 Node 24 已内置兜底（R8 为纵深） |
| React 违例诊断 | 渲染回归打出 hook 表：`1.useState / 2.undefined→useState` —— v1.4 直调模式的精确崩溃指纹 |
| 处置 | 主力 profile 已由用户摘除 patch 行 + agent remove_bundle；v1.5 修复后**未回装主力**（等用户决定，沙箱验证 T-013 先行） |
