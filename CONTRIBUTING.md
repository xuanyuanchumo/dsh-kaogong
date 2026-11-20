# 贡献指南 · dsh-kaogong

> 本文件是贡献行为的**规范契约**；所有贡献者（含 AI 自主迭代）必须遵守。
> 分支模型详见 [docs/agents/BRANCHING-STRATEGY.md](./docs/agents/BRANCHING-STRATEGY.md)。

## 一、分支模型（gitflow 双线）

| 分支 | 角色 | 来源 → 去向 |
|---|---|---|
| `main` | **发布线**（远端默认分支，tag 锚点 v1.x.0） | 只接收来自 `develop`/`release/*` 的合并；每次发布打 tag |
| `develop` | **统一开发主线**（本项目唯一集成分支） | 所有 `feature/*` 合并到这里；本分支是日常开发起点 |
| `feature/*` | 功能/修复分支 | 从 `develop` 切出 → 完成后 PR 回 `develop` |
| `hotfix/*` | 线上紧急修复 | 从 `main` 切出 → 同时 PR 回 `main` 与 `develop` |

**硬规则**
1. 禁止直接向 `main` push 功能提交；禁止向 `develop` force-push。
2. 每个 PR 一个主题；feature 分支生命周期随 PR 关闭而结束（可删除）。
3. 合并前 `develop` 必须绿（smoke + render + ANIC 门禁 G0-G3 + HITL）。

## 二、提交规范（Conventional Commits）

```
<type>(<scope>): <subject>
```

- `type`：`feat` / `fix` / `docs` / `refactor` / `perf` / `test` / `chore` / `cycle`
- `scope`：模块名（pool / graph / ui / server / smoke / docs …）
- `subject`：祈使句、≤72 字符、中文或英文均可（本项目以中文为主）

示例：
```
fix(server): isInside 改用 path.relative 根治 Windows 安装越界（issue #6）
cycle(41): IMG-04 确定性配额 + 门禁闭环（eval 16/16 · G0-G3 全绿）
```

**正文**：解释 WHY 而非 WHAT；关联 issue 用 `Closes #6` / `Refs #5`。
**原子性**：一个提交一件事；先提交再切下一个主题。

## 三、PR 规范

1. 目标分支：`feature/*` → `develop`（默认）；hotfix → `main` + `develop`。
2. 标题遵循提交规范；描述使用 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md)，逐项填写不删节。
3. 合并前置：类型门 + 构建门 + `npm run test:all` 全绿；ANIC 16 维评估与门禁 PASS（本项目质量基线）。
4.  **合并方式**：feature PR（feature/* → develop）用 **squash**（develop 线性可读）；release PR（develop → main）
    用 **merge commit（--no-ff）**——squash release 会让 main 产生 develop 不含的提交，导致下次 PR 血缘断裂。
    若坚持 squash release，**发布后必须把 main 回灌 develop**（详见 BRANCHING-STRATEGY §6）。
5. 自合并 PR 也需走完整清单——机器人不是免检理由。

## 四、本地开发纪律

- 开发前 `git switch develop && git pull --ff-only origin develop`（无本地 develop 时从 `origin/develop` 建）。
- 每轮迭代：`init-cycle → eval-runner → gate-check --quality --record → hitl-audit → archive-cycle`，循环工件随提交入库。
- 出新端点必须同步 `src/shared/manifest.ts`（SSOT）——声明形态 `{method,path,label,consumers,desc}` 一份不能少，否则图谱 `buildGraph` 崩（R47 教训）。
- 测试命名空间隔离：新增测试用独立 `PROJ_*` 前缀，防跨段污染（教训⑨）。
- 禁止把凭据/token 写入工作区；第三方仓库只读，不写上游（I5 约束）。

## 五、遵守承诺

本规范的修订同样走 PR（目标 `develop`，描述说明变更原因）。任何提交若违反上述规则， maintainer 有权要求重做。
