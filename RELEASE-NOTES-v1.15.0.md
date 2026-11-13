# RELEASE-NOTES v1.15.0 — cycle-20：题库管理流程优化迭代

> 发布日期：2026-11-13（北京时间） · 类型：minor · 证据：smoke 293/293 · render 51/51 · 沙箱真机题库流程 9 项实证 · G0-G3 + H1-H4 全 PASS

## 题库管理流程优化（8 项缺口全部落地）

| # | 能力 | 说明 |
|---|---|---|
| G1 | **半成品死锁解除** | clone 中断留下的空目录（无 `.git`）自动清理并可重装——修复前 install 返回「目录已存在拒绝覆盖」，用户无法自恢复。判据严格：本次新建 ∧ 无 `.git` ∧ ≤2 项；用户既有非空数据仍受保护 |
| G2 | **真·一键** | `/api/repos/install-batch` 服务端队列化（并发 2 + 完成即补位），UI 单按钮 + 批次进度条。旧实现逐个按钮且并发上限会拒第 3 个 |
| G3 | **作业历史** | 完成/失败作业入环形 20 归档（失败原因 + 耗时 + 日志尾），`/api/repos/jobs` + UI「🕘 最近作业」折叠区 |
| G4 | **旧根提示** | 切换数据根后记录旧根快照并统计其仓库数，UI 明示「旧根仍有 N 个仓库（数据未删除）」+ 一键切回 |
| G5 | **配置校验** | 数据根须为绝对路径 + 可写探测；镜像须为 http(s) URL；非法输入返回 error 且不落盘 |
| G6 | **健康巡检** | `health` 词表（ok / empty / half-clone / no-git / absent）+ `lastCommitAt`，UI 徽章 + 总览「健康仓库」计数 |
| G7 | **浏览口径统一** | `total` 恒为真实总数，`truncated` 由「总数 > 返回数」派生，`limit` 可传——消除「共 X / 前 120」自相矛盾 |
| G8 | **安装预检** | 数据根可写探测 + 上游地址形状校验 + 面板显示可用磁盘空间（不可探测 → `null` 降级，绝不臆造 0） |

## P0 根治：R11 第三次复发

门禁的 G3 曾在 `.cycles/config.yml` 里直接跑裸 `npx tsc`（绕过 npm scripts），把 `dist/client/client.js` 从 combo factory 重写回裸 ESM → 宿主组合加载器 `SyntaxError` → 插件启动失败、可能拖垮宿主。

- `.cycles/config.yml` 的 `build_cmd` / `G3.build_commands` 全部改为 `npm run build`
- 新增 `scripts/assert-combo.mjs` 产物形态硬守卫（行首 import/export + load 头 + `return {inject,apply}`），挂到 build/prepack/prepare/test/test:render/test:all 末尾与 `postbuild`——**只判不修，构建期发现污染必须响亮失败**
- smoke 新增 5 条守卫（`R11-GUARD-01..04 + 03b`），禁止裸 tsc 回归、要求全部产物脚本接 bundler+守卫、`scripts/` 进 `files` 白名单

## 其它

- 端点 57 → **60**（`/api/repos/install-batch`、`/api/repos/batch`、`/api/repos/jobs`），manifest 单一事实源同步
- README 新增「面板自带的故障恢复能力」表；ROADMAP 当前状态更新至 v1.15.0；CONVENTIONS 新增 7 条题库管理纪律
- `docs/research/` 10 篇数学模型研究文档随包分发
