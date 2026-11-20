# 23 · GitHub 开放 issues 分析 + 分支治理落地（gitflow PR #7）

> dsh-kaogong 研究文档 · cycle-42b · 目标驱动（GitHub issues + 分支合并 + 规范文档）
> 状态：**✅ 已实施**

## 1. GitHub 开放 issues 取证（2026-11-20，3 个）

| # | 标题 | 是否仍复现 | 处置 |
|---|---|---|---|
| **#6** | Windows 题库管理安装/删除/浏览全报「路径越界」 | ✅ **仍复现**（本地 6 组边界实测 4/6，子路径与混合分隔符失败） | **已修**（isInside → path.relative）+ SMOKE-ISSUE6 守卫 + issue 留说明，随 PR #7 |
| **#5** | 练习链路单源锁死（xingcezhenti）+ 分布偏斜 | ❌ **不再复现**（cycle-34~40 统一池已解决） | issue 留状态说明（10 题覆盖 4 源、4 题多源聚合），待 maintainer 验收关闭 |
| **#4** | 上传图片搜题（资料分析/图形推理） | ✅ 仍为空白（阶段 4 未做） | 不越界实现；依赖 `ctx.llm` inject + ImageBlock + 图推桥接（ROADMAP 前置缺口 C5 已标注） |

## 2. issue #6 修复要点

根因与 issue 报告完全一致：`isInside()` 用 `b + '\\\\'`（两字面反斜杠）判前缀，
Windows `resolve()` 返回单 `\` → 子路径恒判越界。修法 = `path.relative` 语义判定
（`rel === '..'` / `startsWith('..' + sep)` / `isAbsolute` 三道防线，后两者挡穿越与跨盘）。
一处修复覆盖 `prepareInstall` / `remove` / `browse` 三个调用点。

**守卫升级**：issue 建议的两条关键用例（子路径必须 true / 兄弟同前缀必须 false）
固化进 SMOKE-ISSUE6——旧断言「有过就算过」的写法抓不到本 bug。

## 3. 分支治理（真实 git/GitHub 规范实践）

### 3.1 发现的问题

- 9 个 `feature/*` 分支 + master 全是 HEAD 的**线性祖先**（逐条 `merge-base --is-ancestor` 验证）——
  工作已全部包含在最新开发线，无需逐个合并
- 远端 `main`（v1.30.0，15 个 squash release commit）与本地开发线 `merge-base` 为空
  ——**两条独立历史线**（发布线 vs cycle 开发线）
- 直接 `develop → main` 提 PR 被 GitHub 拒绝：`PullRequest (custom): The develop branch has no history in common with main`

### 3.2 遵循规范的解法（不是权宜）

研究真实 gitflow 后放弃 `--allow-unrelated-histories --squash` 直推（会绕过 PR 评审），
采用标准做法：**develop 合并 origin/main 建立血缘 → push develop → PR develop → main**。
- merge commit `ab63952`，冲突取 develop 版本（cycle 内容是 main 的功能超集）
- 合并后复测：类型门 0 错误、smoke 429/429、render 66/66 —— 零功能回退
- **PR #7**（develop → main，84 commits / 497 files）创建成功，等待评审

### 3.3 用户建议的采纳

用户提出「本地 develop 也要有远程 develop，然后远程 develop 与远程 main PR」——
与真实 gitflow 完全一致，已按此落地：本地 develop 推送到远端（`origin/develop`），
PR 从 `develop` 直连 `main`（非 release bridge 权宜）。

## 4. 规范文档（贡献契约）

| 文件 | 内容 |
|---|---|
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | gitflow 双线模型、Conventional Commits、PR 清单、遵守承诺 |
| [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md) | 变更类型/目标分支/验收清单（8 项不得删节）/破坏性变更/关联 issue |
| [BRANCHING-STRATEGY.md](./BRANCHING-STRATEGY.md) | 本仓库真实拓扑、血缘修复过程、冲突策略、清理策略 |

## 5. 验证

| 验证 | 结果 |
|---|---|
| isInside 6 组边界 | 6/6（修复前 4/6） |
| smoke | 429/429（+SMOKE-ISSUE6） |
| render | 66/66 |
| 远端 develop | 已推送（origin/develop @ 1690097） |
| PR #7 | open（develop → main） |
| issue #6/#5 | 已留处置说明评论 |

## 6. 中文思维

- **「issue 要分辨真伪」**：#6 是真 bug 必须修；#5 是历史 issue（问题已被后续架构解决）——
  只回「已修复」不验证是敷衍，实测过再说。
- **「PR 被拒不是障碍，是信号」**：GitHub 拒绝无共同祖先 PR，是在提示分支模型有历史遗留——
  正解不是找工具绕过（`--allow-unrelated-histories`），而是按 gitflow 补血缘再做直连 PR。
- **「规范要写在仓库里，不是聊天里」**：CONTRIBUTING + PR 模板 + 分支策略入库，
  后续贡献者（含 AI）按图索骥，不靠口口相传。

---

*本文结论基于 2026-11-20 实测：GitHub 3 个开放 issue 逐条分析、isInside 6 组边界、9 分支祖先验证、无共同祖先 PR 拒绝与血缘修复、PR #7 创建。*
