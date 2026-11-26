---
title: BACKLOG · dsh-kaogong 唯一未完成清单
status: current
updated: 2026-11-26
---

# BACKLOG · dsh-kaogong 唯一未完成清单

> **本文件是本项目「未完成事项」的唯一事实源**（SSOT）。
> 任何"遗留""待办""下一步"只允许登记在这里，禁止散落在报告末尾、issue 评论或对话里。
>
> 规则继承 `dsh-kaogong` 既有纪律 + NearSlot 实践，强制点见 §4。

---

## 1. 编号规则

```
BL-<域>-<两位序号>
```

| 域 | 含义 | 覆盖范围 |
|---|---|---|
| `PROC` | 流程基建 | 分支/钩子/评审/发布流程本身 |
| `DOC` | 文档 | 文档漂移、缺失文档、文档门禁 |
| `TEST` | 测试 | 断言缺口、守卫缺失、回归覆盖 |
| `POOL` | 统一题目池 | `.kaogong.db`、摄入、去重、跨源检索 |
| `API` | 端点与契约 | manifest、端点语义、兼容性 |
| `UI` | 客户端视图 | 视图、交互、主题、降级 |
| `DATA` | 数据源适配 | 16 仓库注册、字段映射、解析 |
| `PERF` | 性能 | 复杂度预算、缓存、响应时延 |
| `SEC` | 安全 | 路径穿越、凭据、注入 |
| `REL` | 发布 | npm、GitHub Release、市场条目 |

- 序号从 `01` 起，**只增不复用**；条目删除时保留编号并标 ❌ 作废。
- 一个条目只描述**一件事**；跨域拆成多条并互相引用。

## 2. 优先级

| 级别 | 判定 | 处理要求 |
|---|---|---|
| **P0** | 阻断使用 / 安全 / 数据损坏 / 发布阻断 | 本轮必须闭合，未闭合不得发布 |
| **P1** | 体验缺陷、完整性缺口、文档失真 | 本轮尽量闭合，可跨轮但必须有进展 |
| **P2** | 优化、增强、卫生 | 空闲时处理，允许长期挂起 |

## 3. 状态与条目结构

**状态仅三态**：⬜ 未开始 · 🟡 进行中 · ✅ 已完成

**每个条目必须包含三要素**（缺一不得登记）：

1. **现状**：问题是什么，附**文件位置 / 端点 / 行号**（可定位）
2. **为何暂缓**（若未开始/进行中）：卡在什么上
3. **验收标准**：**可执行断言**（命令 + 预期输出），不接受"应该没问题"

**完成时**：状态改 ✅，在 §5 完成记录追加一行（编号 / 时间 / 提交 / 验证方式）。**条目不删除**——保留决策轨迹。

---

## 4. 强制点（本文件的规则如何被执行）

| 规则 | 强制点 | 触发时机 |
|---|---|---|
| 变更必须关联 BL 编号 | `scripts/git-hooks/pre-push` → `check-backlog-entry.mjs` | `git push` |
| 条目三要素齐全 | 人工评审（PR 模板勾选项） | PR 创建 |
| 完成必须写完成记录 | 人工评审（PR 模板勾选项） | PR 创建 |
| 未完成项不得只写在别处 | 评审 reviewer-git 检查 | 预审阶段 |
| 逃生门 | `SKIP_BACKLOG_CHECK=1 git push` | 确实无关的变更（如 CI 修复） |

> 逃生门使用必须在 PR 描述里写一句理由——**显式绕过可审计，暗中绕过不可审计**。

---

## 5. 条目清单

### 5.1 P0（阻断）

| 编号 | 事项 | 现状 | 为何暂缓 | 验收标准 | 状态 |
|---|---|---|---|---|---|
| **BL-PROC-01** | 建立 backlog 唯一清单 | 债务散落在 `ROADMAP.md`，且原 `.cycles/tech-debt/backlog.md` 已随 `305c13c` 取消跟踪，实际维护位置失联 | — | 本文件存在；每条在办工作能指到 BL 编号 | ✅ |
| **BL-PROC-02** | git 钩子机器化提交/分支校验 | 无 husky/commitlint；CI 无提交信息校验；Conventional Commits 纯靠自觉 | — | `scripts/git-hooks/` 三钩子生效；违规提交被拒；负向验证通过 | ✅ |
| **BL-PROC-03** | 评审制度化（四员 + 五维 + 定级） | PR #7 实证 4 评审员抓 17 blocker 有效，但流程未落文档、无报告模板 | — | `docs/agents/REVIEW.md` 存在；`reviews/` 目录存在；模板可用 | ✅ |
| **BL-DOC-01** | 修复文档数字漂移 | README badge `437/66`、README 正文 `350/59`、ROADMAP `404`、CLAUDE.md `262` 四处不一致（R25 陈旧文案教训复发） | — | 单一事实源 `docs/facts.json`；`check-facts.mjs` 校验全绿；负向验证通过 | ✅ |
| **BL-TEST-01** | 补「真实 Loader 入口」测试 | smoke 直接 `import dist/server/http.js` 启真实 server（这是真实产物路径 ✅），但 **`dist/host/index.js` 经真实 Cordis Loader 加载的路径完全无覆盖**。这是官方事故复盘 0001 的核心教训 | — | `loader.test.mjs` 17/17：真实 Loader 激活 + 命名空间导出 + 6 工具注册 + 服务就绪；**负向验证注入 `export default` 后降到 5/17**（证明守卫有效） | ✅ |

### 5.2 P1（体验与完整性）

| 编号 | 事项 | 现状 | 为何暂缓 | 验收标准 | 状态 |
|---|---|---|---|---|---|
| **BL-PROC-04** | gitflow + 发布流程纳入强制点 | `CONTRIBUTING.md` 已规定双线与合并方式，但分支名/PR 前置无机器校验 | 依赖 BL-PROC-02 | pre-push 校验分支名；PR 模板含版本时序检查项 | ✅ |
| **BL-DOC-02** | 文档门禁（六检） | 无 frontmatter 校验、无链接可达校验、无 current 可达校验 | 依赖 BL-DOC-01 的事实源 | `scripts/docs/check-docs.mjs` 实现六检；挂 pre-commit + CI | ✅ |
| **BL-DOC-03** | 架构目录结构向 dsh 官方规范对齐 | `src/` 已分 `adapters/client/host/server/shared/ui`，但缺「按 dsh 插件形态」的显式分层说明与目录约定文档；`docs/` 无根索引 | — | `docs/agents/ARCH-LAYOUT.md` 存在并说明每层职责与禁区；`docs/README.md` 索引存在 | ✅ |
| **BL-DOC-04** | 双语文档 | 仅 `README.md` 中文；官方插件（kb/README）双语惯例 | 需翻译工作量 | README 增英文段落或 `README.en.md`；locale 已有 en/zh | ⬜ |
| **BL-TEST-02** | 反模式清理：移除断言数基线门禁 | 原实现用 `facts.run.json`/`facts.baseline.json` 做「断言数只增不减」门禁，但 CI 比对的是提交进仓库的 json 而非测试真实结果——自我声明式假门禁（用户指出） | — | 三份 facts 冗余文件减为一份（仅机器可派生的能力计数）；CI 只以测试退出码为质量门；端点/工具计数篡改负向验证 exit=1 | ✅ |
| **BL-TEST-03** | 负向验证（证明门禁会红）纳入流程 | 已有实践（v1.13.1 变异测试），但未制度化 | — | `REVIEW.md` 规定每个新守卫必须配变异测试；至少 6 例已执行记录（见评审报告） | ✅ |
| **BL-TEST-04** | KG_PORT 端口隔离守卫 | `ISOLATION.md` §5 提到 R-KGPORT 守卫但原 BACKLOG 无条目（reviewer-issues 指出指向空洞） | — | 生产代码 `src/host/index.ts` 已加 `Number.isInteger && 1..65531` 校验；非法值回退 8400；边界单测通过 | ✅ |
| **BL-PROC-05** | issue 模板（环境矩阵） | `.github/` 仅 PR 模板 + ci.yml，无 issue 模板；issue #4/#5 内容详实但格式各异 | — | `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml` 含环境矩阵 | ✅ |
| **BL-PROC-06** | 变更连带义务表 | 规则散落（改端点→manifest、改版本→三锚点），未成表 | — | `CONTRIBUTING.md` 含「改动类型 → 必须同步」表 | ✅ |

### 5.3 P2（优化与卫生）

| 编号 | 事项 | 现状 | 为何暂缓 | 验收标准 | 状态 |
|---|---|---|---|---|---|
| **BL-PROC-07** | `lint` 名不副实 | `package.json:72` `"lint": "tsc --noEmit"`，实为类型检查 | 引入风格工具会增加依赖，违背零依赖定位 | 改名 `typecheck` 或明确注释其等价性 | ⬜ |
| **BL-PROC-08** | `_tmp/` 卫生 | 工作区堆积 100+ 一次性调试脚本 | 含历史取证价值，需甄别 | `.gitignore` 覆盖；保留白名单说明 | ⬜ |
| **BL-REL-01** | release workflow 自动化 | 无 tag 触发 workflow；notes 手工操作 | npm 发布建议保持手动（凭据安全） | 可选：tag 触发 GitHub Release workflow；npm 保持 vault_run | ⬜ |
| **BL-PROC-09** | hotfix 流程演练 | `CONTRIBUTING.md:13` 有规定，git 历史无 hotfix 痕迹 | 无真实紧急场景 | 桌面演练记录（双 PR 顺序、bump 时机） | ⬜ |
| **BL-SEC-01** | 验证环境隔离（沙箱/真机是否污染目录） | 实测发现：数据根 `~/.dsh/kaogong` 按用户而非按 profile 隔离，未设 `KG_DATA_DIR` 的探针 adopt 到主力 8400 实例并读到主力进度；端口 8400 硬编码导致假阳性 | — | `docs/agents/ISOLATION.md` 三层隔离；`KG_PORT` 可配置；`loader.test.mjs` 断言 pid/port/数据根隔离；负向验证可观察污染 | ✅ |
| **BL-REL-02** | v1.34.0 发布收口（文档事实校准 + GitHub/npm 发布 + 市场条目更新） | 文档端点数/断言数/题库口径三处漂移（78 端点 → 实为 82；276 断言 × 35 文件 → 实为 411 × 50；统一池仍写 v1.30 的 27,506 题 → 实为 86,454）；发布线 `main` 落后 `origin/main` 5 个提交；`.dsh/` overlay 70 个文件曾被 git 跟踪 | — | ① `npm run facts:check` 全绿；② `npm run test:all` 全绿（50 文件 / 411 断言 + Loader 17/17）；③ `.dsh/` 出库且 gitignore 覆盖；④ `develop` → `main` 合并 + tag `v1.34.0` + GitHub Release；⑤ npm `dsh-kaogong@1.34.0` 认证通道复验；⑥ 上游市场条目描述数字与 manifest 核对一致 | 🟡 |
| **BL-TEST-05** | CI 环境依赖缺失（CI 长期红：25 文件 / 54 断言） | ① 一批 smoke 断言天然依赖真实题库数据（统一池五维/关系边/带图题、真题卷索引、方法论语料）——CI runner 无题库 → 必红；② render harness 硬编码开发机 `../_kgtest/node_modules` 的 React → 7 个 render 文件整体失败；③ naoku 源可用判定只认 `.naoku.db` 投影库，而合并只在 ingest 阶段触发 → **自锁**（池永远缺 27,506 题五维 + kadian 边）；④ paper-index 测试硬编码「仓库上级目录」找真题卷 | — | ① CI 装全量题库 + `scripts/ci/build-pool.mjs` 一次性建池（actions/cache 缓存题库与池），**测试代码零改动**；② React/react-test-renderer 进 devDependencies（**不进运行时依赖面**），harness 改「本仓优先 · 开发机回退」；③ naoku 可用判定改为「投影库 **或** 上游分片任一存在」+ 摄入阶段自动合并；④ paper-index 认 `KG_REPOS_DIR`；⑤ rebuild-safety 改自建 fixture 源（**完全离线自足**）；⑥ CI 实跑绿（50 文件 / 411 断言） | 🟡 |

---

## 6. 完成记录

> 格式：编号 / 完成时间 / 提交 / 验证方式

| 编号 | 完成时间 | 提交 | 验证方式 |
|---|---|---|---|
| BL-PROC-01 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | 本文件存在；各条目三要素齐全 |
| BL-PROC-02 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | 三钩子脚本就位；负向验证（违规提交被拒）见 `docs/agents/REVIEW.md` §5 |
| BL-PROC-03 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `docs/agents/REVIEW.md` + `reviews/` 目录；四员分工表可执行 |
| BL-PROC-04 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `pre-push` 校验分支名；PR 模板含版本时序项 |
| BL-PROC-05 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | 两个 issue 模板含环境矩阵字段 |
| BL-PROC-06 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `CONTRIBUTING.md` §六 变更连带义务表 |
| BL-DOC-01 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `docs/facts.json` 单一事实源；`check-facts.mjs` 全绿 |
| BL-DOC-02 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `check-docs.mjs` 六检；负向验证通过 |
| BL-DOC-03 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `ARCH-LAYOUT.md` + `docs/README.md` |
| BL-TEST-02 | 2026-11-20 | 待提交（反模式清理） | facts 三文件减一；CI 以测试退出码为唯一质量门；端点/工具篡改 exit=1 |
| BL-TEST-03 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `REVIEW.md` §5 负向验证规程 + 3 例记录 |
| BL-TEST-01 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `loader.test.mjs` 17/17；注入 export default → 5/17（负向验证） |
| BL-SEC-01 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | `ISOLATION.md` 三层隔离；KG_PORT 可配置；pid/port 断言；临时目录清理 OK |

---

| BL-TEST-04 | 2026-11-20 | 892c174(feature/workflow-governance-v1.31) | 端口边界单测通过（负数/小数/70000→8400） |

---

## 7. 维护约定

- **每轮迭代收口前**：复核全表状态与代码现状是否一致，防「以为做了其实没做」。
- **每个 PR 合并前**：确认本次工作对应的 BL 条目状态已更新。
- **发布前**：确认无 P0 处于 ⬜/🟡；有则不得发布（见 `BRANCHING-STRATEGY.md` §6.2）。
- **新增条目**：先查是否已存在同类条目，禁止重复登记。
