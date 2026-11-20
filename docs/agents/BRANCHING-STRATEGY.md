# 分支管理与合并策略

> 规范契约见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。本文记录**本项目实际分支拓扑与合并方案**。

## 1. 远端现状（2026-11-20 取证）

| 远端分支 | SHA | 角色 |
|---|---|---|
| `main`（默认） | `256b70f` | 发布线，tag v1.13~v1.30，15 个 squash 版本提交 |
| `dev-history` | `d08bf18` | 历史开发线（= 本地 `master`） |

本地 `develop`（建立在 cycle-41 归档点 `21509d5`）含 81 个逐 cycle 开发提交。
**`git merge-base origin/main develop` 为空**——两条线无共同祖先（发布线用 squash release commit，
开发线用逐 cycle commit）。这是历史形成的双线结构，不是错误。

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

- 内容差异 `git diff --stat origin/main develop`：493 文件（develop 新增 pool/graph/研究文档等），
  远端 main 相对本地 master 主要差版本 bump 与发布说明——预期合并冲突集中在
  `package.json`(version) / `README.md` / `src/shared/manifest.ts`。
- 合并后必须重跑 `npm run test:all` + ANIC 门禁，确认发布线功能未回退。

## 5. 清理策略

合并完成且 CI 绿后：
- 删除已并入 develop 的 9 个旧 `feature/*` 分支（本地 + 远端，若有）
- `dev-history` 保留为历史存档（指向 cycle-33），不再更新
- README 贡献段链接 CONTRIBUTING.md
