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

### 方案 A（推荐）：内容优先的 release squash

1. 在 `develop` 上完成所有工作并通过门禁
2. 切 `release/v1.31` 分支（从 develop）
3. `git checkout main && git merge --allow-unrelated-histories --squash release/v1.31`
4. 解决冲突（若有——两线内容同源只是 commit 粒度不同，预期零冲突）
5. `git commit -m "release: v1.31 ..."` + `git tag v1.31.0`
6. push `main` + tag；PR 描述注明「squash of develop cycle-34~42」

**优点**：main 保持干净的发布历史（与既有 15 个 release commit 同构）；develop 保留完整 cycle 轨迹。

### 方案 B：保留双亲 merge

`git merge --allow-unrelated-histories develop`（不 squash）——main 变成双线合流点。
适合需要审计完整 cycle 轨迹的场景，但会让 main 历史突然膨胀 81 个提交。

**本项目采用方案 A**。

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
