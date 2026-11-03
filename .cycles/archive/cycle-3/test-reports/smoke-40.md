# 测试报告

## 1. 头部

| 字段 | 值 |
|---|---|
| 报告时间 | 20261102_233500 |
| 用途 | 循环验证（v1.4 宿主原生面板 + 同源路由） |
| 执行者 | AI (lead, ANIC L4) |
| 目标 | smoke 40 断言 + 宿主 GUI 端口同源实测 |
| 数据基线 | 15 仓库实数据 / v1.4.0 manifest |
| 环境 | Windows / Node v24.14.0 / 宿主 GUI :65396 / 兜底 :8400 |

## 2. 汇总

| 指标 | 数量 |
|---|---|
| 通过 | 40 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |
| 未覆盖 | 3 |
| 耗时 | ~4s |

> 旅程覆盖：J5(新) 同源路由（attachWebRoute 注册→handler→disposer 全链）✅；J1 刷题（原生面板同源 fetch 判分）✅；J2 双入口 ✅；J3 崩溃安全 ✅。
> 覆盖缺口：T-001/T-004/T-011（tech-debt 登记）。
> 混沌覆盖：重复挂载抛错受控降级 ✅；webServer 缺席（Electron）优雅走独立端口 ✅。

## 3. 用例明细（新增 36-40）

| # | 断言 | 结果 |
|---|------|------|
| 36 | attachWebRoute 注册 prefix 路由 (kind=prefix, path=/kaogong) | 通过 |
| 37 | attachWebRoute 返回 disposer 函数 | 通过 |
| 38 | 路由 handler 为函数 | 通过 |
| 39 | disposer 可注销 | 通过 |
| 40 | manifest 双通道声明（same-origin preferred=true） | 通过 |

## 4. 宿主级实测（本轮核心证据）

| 项 | 结果 |
|---|------|
| `GET http://127.0.0.1:65396/kaogong/api/status?ws=v14check` | ✅ 200 · app=dsh-kaogong · ws 隔离生效（宿主 GUI 端口直接响应，零 CORS） |
| `GET http://127.0.0.1:65396/kaogong/` | ✅ 同源完整 SPA 页（宿主内 iframe/全屏可用） |
| 独立端口 :8400 兜底 | ✅ 双通道并行在线（Electron 兼容） |
| 热重载（set_plugin toggle） | ✅ uptime 重置 + 路由重挂载成功（无重复注册抛错） |
| R6 事故修复 | React createElement 小写 onclick 吞函数 ×6 → onClick；v1.2 起潜伏的 tab 重试/外链失效根治 |
