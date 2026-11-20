# 贡献指南 · dsh-kaogong

> 本文件是贡献行为的**规范契约**；所有贡献者（含 AI 自主迭代）必须遵守。
> 分支模型详见 [docs/agents/BRANCHING-STRATEGY.md](./docs/agents/BRANCHING-STRATEGY.md)。
>
> **元原则（最重要的一条）**：**每条规则必须绑定一个可执行强制点（脚本/钩子/CI），否则不得写入本文件。**
> 能自动化的进 CI/钩子，不能自动化的进 PR 模板自检项，两者都不做的不要写。
> 强制点清单见 [§六](#六强制点登记表)。

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
4. **开 PR 之前必须先过评审**：按 [docs/agents/REVIEW.md](./docs/agents/REVIEW.md) 的四评审员视角自查，
   blocker 全清后才开 PR。评审报告落 `docs/agents/reviews/`。
5. **合并方式**：feature PR（feature/* → develop）用 **squash**（develop 线性可读）；release PR（develop → main）
   用 **merge commit（--no-ff）**——squash release 会让 main 产生 develop 不含的提交，导致下次 PR 血缘断裂。
   若坚持 squash release，**发布后必须把 main 回灌 develop**（详见 BRANCHING-STRATEGY §6）。
6. 自合并 PR 也需走完整清单——机器人不是免检理由。

### 版本时序（容易搞错）

版本 bump **必须在 release PR 之前、在 develop 上完成**，不能在合并后补：

```
develop: 完成功能 → npm run version:bump <x.y.z> → 更新 CHANGELOG → 提交
       → 开 release PR（develop → main）→ merge --no-ff → tag → npm publish
```

理由：三锚点（`package.json` / `src/shared/manifest.ts` / `README.md`）由 `scripts/bump-version.mjs` 原子同步；
若在 main 上补 bump，main 会产生 develop 不含的提交 → 血缘断裂（本项目真实事故，见 BRANCHING-STRATEGY §3）。

## 四、本地开发纪律

- 开发前 `git switch develop && git pull --ff-only origin develop`（无本地 develop 时从 `origin/develop` 建）。
- 每轮迭代：`init-cycle → eval-runner → gate-check --quality --record → hitl-audit → archive-cycle`，循环工件随提交入库。
- 出新端点必须同步 `src/shared/manifest.ts`（SSOT）——声明形态 `{method,path,label,consumers,desc}` 一份不能少，否则图谱 `buildGraph` 崩（R47 教训）。
- 测试命名空间隔离：新增测试用独立 `PROJ_*` 前缀，防跨段污染（教训⑨）。
- 禁止把凭据/token 写入工作区；第三方仓库只读，不写上游（I5 约束）。

## 五、变更连带义务（改 A 必须同步 B）

> 违反连带义务 = 制造文档漂移。历史上「测试断言数在 4 处不一致」「manifest 漏登记端点」都源于此。

| 改动类型 | 必须同步 | 强制点 |
|---|---|---|
| 新增/修改**端点** | `src/shared/manifest.ts`（`CAPABILITIES.endpoints`，含 `method/path/label/desc/consumers`）→ `server/` 实现 → UI 消费 → smoke 断言 | manifest 对账守卫 |
| 新增/修改**工具** | `CAPABILITIES.tools` + `presentCall`/`presentResult` 展示契约 + `kgMarkTail` | smoke R-OUT |
| 新增/修改**视图** | `CAPABILITIES.views` + `VIEW_ROUTES` 注册表 + render 断言（每视图必覆盖） | smoke C24 + render |
| 改**版本** | `npm run version:bump`（三锚点原子同步）+ `CHANGELOG.md` | bump 脚本 + smoke |
| 改**数据根 / 存储层** | `docs/agents/STORAGE-LAYER.md` + 所有「写路径引用点」（**含测试清理段**） | 评审 reviewer-code |
| 改**架构/目录** | `docs/agents/ARCH-LAYOUT.md` + `ARCHITECTURE.md` | 评审 reviewer-git |
| 改**测试基线数字** | `docs/facts.json`（`node scripts/docs/gen-facts.mjs`）+ README badge | `check-facts.mjs` |
| 接入**新数据源** | `REPOS_META` + `docs/agents/DATA-SOURCES.md` + STORAGE-LAYER §5 | 评审 reviewer-issues |
| 任何用户可见**文案/计数** | 从事实源渲染，禁止手写（R22/R25） | smoke 静态守卫 |
| 发现**新事故** | `docs/agents/INCIDENTS.md`（R 编号递增）+ 可固化的加成 smoke 守卫 | 评审 reviewer-code |

## 六、强制点登记表

> 本表的每一行都必须真实可执行。**新增规则时先在此登记强制点，否则规则不得写入本文件。**

| 规则 | 强制点 | 触发时机 | 状态 |
|---|---|---|---|
| 提交信息格式 `<type>(<scope>): <subject>` | `scripts/git-hooks/commit-msg` | `git commit` | ✅ |
| 文档六检（frontmatter/链接/可达/superseded/archive/TODO） | `scripts/docs/check-docs.mjs` | `pre-commit` + CI | ✅ |
| 文档数字同源 | `scripts/docs/check-facts.mjs` + `docs/facts.json` | `pre-commit` + CI | ✅ |
| 分支名 `<type>/<scope>-<desc>` | `scripts/git-hooks/pre-push` | `git push` | ✅ |
| 变更关联 BL 编号 | `scripts/git-hooks/check-backlog-entry.mjs` | `git push` | ✅ |
| 不推送本机 overlay / 运行时产物 | `scripts/git-hooks/pre-push` §4 | `git push` | ✅ |
| 不在 main 直推功能提交 | `scripts/git-hooks/pre-push` §5 | `git push` | ✅ |
| 产物形态（combo factory，禁行首 import/export） | `scripts/assert-combo.mjs` | build/prepack/prepare/test 全链 | ✅ |
| client 多模块合并为单 combo | `scripts/bundle-client.mjs` | 所有产出 dist 的 script | ✅ |
| 打包卫生（声明的文件必须在包里） | smoke R28（`npm pack --dry-run` 核对） | `npm run test:all` | ✅ |
| 端点/工具/视图计数与 manifest 一致 | smoke 口径守卫 | `npm run test:all` | ✅ |
| 版本三锚点一致 | `scripts/bump-version.mjs` + smoke | bump 时 | ✅ |
| 类型门 | `npx tsc --noEmit` | `npm run build` + CI | ✅ |
| 全量测试 | `npm run test:all`（smoke + render） | 提交前 + CI | ✅ |
| **真实 Loader 加载路径** | `loader.test.mjs`（三层隔离 + 负向验证） | `npm run test:all` + CI | ✅ BL-TEST-01 |
| **验证环境不污染主力数据/端口** | `ISOLATION.md` + `KG_PORT`/`KG_DATA_DIR` + pid 断言 | `loader.test.mjs` + 沙箱纪律 | ✅ BL-SEC-01 |
| 评审四员 + 五维检查单 | `docs/agents/REVIEW.md` + PR 模板 | 开 PR 前 | ✅（人工） |
| 未完成项登记 backlog | `docs/agents/BACKLOG.md` + PR 模板 | PR 创建 | ✅（人工） |

### 逃生门

每个门禁都留了显式逃生门——**没有逃生门的门禁最终会被整体绕过，而暗中绕过不可审计**：

| 门禁 | 逃生门 | 使用要求 |
|---|---|---|
| commit-msg | `SKIP_COMMIT_CHECK=1` | PR 描述写明理由 |
| pre-commit 文档 | `SKIP_DOCS_CHECK=1` | 同上 |
| 数字同源 | `SKIP_FACTS_CHECK=1` | 同上 |
| pre-push | `SKIP_PREPUSH_CHECK=1` | 同上 |
| backlog | `SKIP_BACKLOG_CHECK=1` | 同上 |

## 七、遵守承诺

本规范的修订同样走 PR（目标 `develop`，描述说明变更原因），且**新增规则必须同时提供强制点**。
任何提交若违反上述规则，maintainer 有权要求重做。
