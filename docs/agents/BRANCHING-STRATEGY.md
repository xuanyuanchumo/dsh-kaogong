# 分支管理与合并策略

> 规范契约见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。本文记录**本项目实际分支拓扑与合并方案**。

## 1. 远端现状（2026-11-20 取证）

| 远端分支 | SHA | 角色 |
|---|---|---|
| `main`（默认） | `256b70f` | 发布线，tag v1.13~v1.30，15 个 squash 版本提交 |
| `dev-history` | `d08bf18` | 历史开发线（= 本地 `master`） |

本地 `develop`（建立在 cycle-41 归档点 `21509d5`）是逐 cycle 开发提交的集成分支。
**历史事实**：develop 与 origin/main 原先无共同祖先（发布线用 squash release commit，开发线用
逐 cycle commit）；已于 `ab63952`（2026-11-20）把 origin/main 合并入 develop 完成**一次性血缘嫁接**，
此后共同祖先 = `256b70f`（v1.30.0）。这是历史形成的双线结构，不是错误。

## 2. 统一开发分支决策

**确立 `develop` 为唯一开发主线**（本地已建立）：
- 所有未来功能/修复从 `develop` 切 `feature/*`，PR 回 `develop`
- `main` 只接收 `develop` 的 release 合并（squash + tag）
- 旧的 9 个 `feature/*` 分支都是 `develop` 的**线性祖先**（已逐条 `merge-base --is-ancestor` 验证），
  其工作已全部包含在 `develop` 中——**无需逐个合并，可保留作历史或清理**

## 3. 双线合并方案（develop → main）

由于无共同祖先，直接 `git merge` 会报 `refusing to merge unrelated histories`。两种方案：

### 采用方案：gitflow 血缘修复 + develop → main 直连 PR（2026-11-20 实践）

研究真实 git/GitHub 规范后发现：GitHub **拒绝无共同祖先的两分支 PR**
（`PullRequest (custom): The develop branch has no history in common with main`）。
虽然本地 `--allow-unrelated-histories --squash` 可合成发布 commit，但那会绕过 PR 评审流程——
不符合「合理使用 git/GitHub 编写规范」的要求。

正解（gitflow 标准实践）：
1. `develop` 从当前工作线建立后，**先把 `origin/main` 合并进 develop**
   （`git merge --allow-unrelated-histories origin/main`，冲突取 develop 版本——cycle 内容是
   main 的功能超集）。这一步让 develop 获得 main 作为祖先，建立血缘。
2. `git push origin develop`（远端 develop 从第一次推送就存在并保持更新）。
3. 创建 PR **`develop` → `main`**（直连，标题遵循 Conventional Commits），
   按 PR 模板逐项填写验收清单。
4. 合并后 `main` 打 tag `v1.31.0`；develop 继续作为下一轮开发主线。

**已落地**：PR #7（develop → main）于 2026-11-20 创建；合并前复测 smoke 429/429 + render 66/66。

**为何不用 release bridge**：虽能从 main 建 `release/*` 合并 develop 后再提 PR（也有共同祖先），
但那引入额外中间分支且偏离「develop 是唯一开发主线」的约定。直接让 develop 合并 main
更符合 gitflow——develop 本来就该定期吸收 main 的发布变更。

## 4. 冲突预期与验证

- 实测：`git diff --stat ab63952^1 ab63952` 为**空**——即「冲突全取 develop」后合并对 develop
  树零改动（main 内容一条未进）。代价是 main 独有的 `.gitignore` 治理规则（`.cycles/*`）丢失，
  已在本轮单独恢复（见 P0 卫生修复）。
- 安全性已双向核对：`git log develop..origin/main` 为空（无 main 独有提交遗漏）；
  v1.29.1（hideBeforeAnswer）/ v1.30.0（historyApi 补录）文件与 main 逐字节等价。
- 合并后必须重跑 `npm run test:all` + ANIC 门禁，确认发布线功能未回退。

## 5. 清理策略

合并完成且 CI 绿后：
- 删除已并入 develop 的 9 个旧 `feature/*` 分支（本地 + 远端，若有）
- `dev-history` 保留为历史存档（指向 cycle-33），不再更新
- README 贡献段链接 CONTRIBUTING.md

## 6. 发布与回滚 runbook（cycle-43 评审补）

### 6.1 release 合并方式（修正：release 用 merge，不用 squash）

- **feature PR（feature/* → develop）**：squash 合并（保持 develop 线性可读）。
- **release PR（develop → main）**：**用 merge commit（`--no-ff`）**，而非 squash——否则每次 release
  都会在 main 上生成 develop 不含的新提交，导致下次 PR 再次「血缘断裂」。
- 若坚持 squash：**发布后必须强制 `main → develop` 回灌**（把 main 的发布提交合并回 develop），
  否则 develop 会永久落后 main 一个发布提交。

### 6.2 发布步骤

1. develop 上完成全部工作 + 门禁绿（smoke / render / eval / G0-G3 / HITL）。
2. develop 上 `npm run version:bump <x.y.z>`（三锚点原子同步）+ 更新 `CHANGELOG.md`，提交推送。
3. 创建 release PR（develop → main），按 PR 模板逐项勾选（含实测数字）。
4. 合并（merge commit）；`git tag vX.Y.Z && git push origin vX.Y.Z`。
5. `npm publish`；确认 `npm view dsh-kaogong version` 与 tag 一致。

### 6.3 回滚 runbook

| 场景 | 操作 |
|---|---|
| 合并后 main 功能异常 | `git revert -m 1 <merge_commit_sha>`（merge 方式）或 `git revert <squash_sha>`（squash 方式）；main 回退到 `v1.30.0`(=`256b70f`) 的 tag 仍在远端 |
| npm 已发布坏版本 | `npm dist-tag add dsh-kaogong@<上一版> latest` 指回上一稳定版；坏版本用 `npm deprecate` 标记 |
| 需要恢复 develop | develop 分支不回退（功能全部保留）；仅 main 回退 |
| 回滚后 | **必须把 main 回灌 develop**（`git merge origin/main`），避免下次 release 再次血缘断裂 |

> 回滚锚点：`v1.30.0` → `256b70f`（本地 + 远端 tag 均在）；develop 在 `origin/develop` 完整保留。
