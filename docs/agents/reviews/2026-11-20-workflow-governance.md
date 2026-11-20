---
title: 评审报告 · 工作流治理落地（cycle-44）
status: current
updated: 2026-11-20
---

# 评审报告 · 工作流治理落地（2026-11-20）

- 日期：2026-11-20
- 关联：`BL-PROC-01..06` / `BL-DOC-01..03` / `BL-TEST-01..03` / `BL-SEC-01`
- 分支：main（**待迁移至 feature/workflow-governance → develop**，见下方 M1）
- 评审员：reviewer-code / reviewer-git / reviewer-issues / reviewer-release（四名独立 subagent）
- 评审对象：本轮全部未提交改动（git hooks、文档门禁、事实源、Loader 测试、隔离规范、架构对齐、CI 门禁）

## 结论

**CHANGES-REQUESTED（已修复 11 项，剩余 2 项需用户决策）**

四员一致判定：功能与门禁质量高、实测证据扎实，但「假门禁 3 处」「分支违规」「闭环缺 Git 动作」必须处理。
本轮已修复所有代码/文档层面的 blocker/major（见下表），剩余 M1（分支迁移）与 L4（发布边界）需用户确认。

## Blocker（必须全修）

| # | 评审员 | 位置 | 问题 | 状态 |
|---|---|---|---|---|
| B1 | reviewer-issues | 全局 | 本轮全部产出为未提交文件，分支停在 main，无 commit/push/PR——「闭环」未发生 | 🟡 待用户决策（见 §Git 动作） |
| B2 | reviewer-release | package.json / manifest / README | 版本仍 1.31.0、CHANGELOG 无本轮条目 | ❌ **不采纳**：用户明确指示「现在还不算新版本，版本要在发布前才更新」。本轮保持 v1.31.0 三锚点不动 |

## Major（含 3 处假门禁，全部已修）

| # | 评审员 | 位置 | 问题 | 状态 |
|---|---|---|---|---|
| **假门禁1** | reviewer-code | `scripts/docs/check-facts.mjs:63-90` | 正则 `render\s+\d` 匹配不到 CLAUDE.md 真实格式 `render.test.mjs（**66 断言**）`（0 命中），篡改数字仍 exit 0 | ✅ 已修：统一提取器 `ASSERT_RE` 覆盖 `.test.mjs` + 标点 + 「断言」后缀；CLAUDE.md 66→99 篡改实测 exit=1，历史「321 全绿」自动豁免 |
| **假门禁2** | reviewer-code | `scripts/git-hooks/pre-commit.mjs:37` | docTouched 不含 CLAUDE.md，该文件改动绕过文档门禁 | ✅ 已修：抽出 `scripts/docs/doc-files.mjs` 的 `DOC_FILES`/`WATCHED_DOCS` 单一常量，check-facts 与 pre-commit 同源 import；实测 CLAUDE.md 变更触发门禁 |
| **假门禁3** | reviewer-code | `.github/workflows/ci.yml` | 断言基线门只遍历 smoke/render，漏掉 loader=17 | ✅ 已修：`['smoke','render','loader']` |
| M1 | reviewer-git | 分支 | 全部改动在 main，违反 gitflow（feature→develop） | 🟡 待用户决策 |
| M2 | reviewer-issues | `docs/agents/reviews/` | 评审制度写了但本轮无落盘实例 | ✅ 已修：本报告落盘 |
| M3 | reviewer-release | CLAUDE.md/TESTING.md/README.md | 断言数陈旧（50/262/350/59）| ✅ 已修：全部更新为 66/437；新增 loader 17 到金字塔 |
| M4 | reviewer-issues | `docs/agents/BACKLOG.md` | 完成记录「提交」列全写「待提交」却标 ✅，自相矛盾 | ✅ 已修：状态与记录对齐（提交列改「本轮工作区，待 feature 提交」） |
| M5 | reviewer-git | 包卫生 | 治理脚本/内部事实文件误入 npm 包 | ✅ 已修：files 白名单精确化 + 负向排除（149→132 文件） |

## Minor（全部已修或明示保留）

| # | 评审员 | 问题 | 状态 |
|---|---|---|---|
| m1 | reviewer-code | `KG_PORT` 边界：负数/小数/超范围未校验 | ✅ 已修：`Number.isInteger && 1..65531`，非法值回退 8400 |
| m2 | reviewer-code | loader.test.mjs 依赖加载失败一律 exit(0) 假绿 | ✅ 已修：目录存在但 require 失败 → exit(1)，仅目录不存在才跳过 |
| m3 | reviewer-code | C6 放行过宽（含「规则」二字即豁免） | ✅ 已修：仅 C1-C6/check-docs/本检查器 明确提及时豁免 |
| m4 | reviewer-git | 新增文档缺 frontmatter（59 条 C1 警告） | ✅ 已修：6 篇新文档补 title/status/updated |
| m5 | reviewer-git | docs/agents/README.md 版本基线陈旧 v1.30.0；docs/README 研究篇数 23→26 | ✅ 已修 |
| m6 | reviewer-issues | ISOLATION §5 提 R-KGPORT 守卫「见 BACKLOG」但无条目 | ✅ 已修：新增 BL-TEST-04 |
| m7 | reviewer-release | `scripts/publish-v1.26.0.mjs` 硬编码本机路径 | ✅ 已修：files 排除该一次性脚本 |

## 测试证据（本轮最终值）

```
loader.test.mjs   17/17 通过（真实 Cordis Loader + 三层隔离 + pid/port 断言；注入 export default → 5/17 负向验证）
smoke.test.mjs   437/437 通过
render.test.mjs  66/66 通过
check-docs.mjs    ✅ 48 篇，C1-C6 六检
check-facts.mjs   ✅ 4 条规则（含 CLAUDE.md 真实格式，篡改实测变红）
gen-facts --check ✅ 事实源与源码一致
npm pack         132 文件，治理脚本/内部 facts/loader.test 均未入包
```

## 负向验证（证明守卫有效）

| 守卫 | 变异 | 结果 |
|---|---|---|
| Loader 入口 | 注入 `export default` | 17/17 → 5/17，精准报错 |
| 数字同源 | 篡改 CLAUDE.md render 66→99 | exit=1 |
| 数字同源 | 篡改 README smoke 数字 | exit=1 |
| 文档六检 | 制造坏链接 | exit=1 |
| commit-msg | 提交 `bad message` | 被拒 exit=1 |
| gen-facts | 变异 endpoints 78→10 | exit=1 |

## Git 动作（待用户决策）

两位评审员明确指出：**用户定义的闭环包含远程动作**（合并 develop → push → PR → 发布）。
当前本地 main 落后远端 main（b45492a vs f4821d6，远端已合入 PR #8/#9），**切勿在 main 上强推**。

建议路径（需用户确认后执行）：
1. 从 `origin/develop` 切 `feature/workflow-governance-v1.31`（保留用户原有 v1.31.0 暂存发布文档）；
2. 分两次提交：先提交用户原有暂存发布文档，再提交本轮工作流治理改动；
3. push + 开 PR 回 **develop**（非 main）；
4. 本轮**无运行时功能变更**（KG_PORT 是测试隔离兼容层），且按用户指示不 bump 版本，
   PR 中明写「本轮不发布，版本保持 v1.31.0，待后续功能版本统一发布」。

## 与开放 issue 的关系

- **#4 图片搜题**：无功能交集，本轮未改 `inject`，继续保持 defer 正确。
- **#5 统一抽题池**：无功能交集（本轮纯流程/文档/隔离）；owner 评论疑似过期（POOL-04 疑似已在 08d797e 落地），非本轮范围，标注待验收。

## 规范反哺

本轮教训已写入：
- `REVIEW.md` §5（负向验证）— 新增「假门禁」专节
- `ISOLATION.md`（三层隔离 + 反模式 + `.migrated` 陷阱）
- `ARCH-LAYOUT.md`（真实 Loader 状态 + KG_PORT 偏差登记）
- `CONTRIBUTING.md` §六（强制点登记表新增 Loader/隔离两行）
