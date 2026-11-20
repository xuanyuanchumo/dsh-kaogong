---
title: 评审规范（REVIEW）
status: current
updated: 2026-11-20
---

# 评审规范（REVIEW）

> 本文件规定**开 PR 之前的评审环节**——这是工作流里最容易缺失、又最能拦住事故的一环。
> 依据：本项目 PR #7 实证（4 名独立评审员在开 PR 前抓出 **17 个 blocker，含 2 个 P0**，
> 其中「恢复 `.gitignore` 的 `.cycles/*` 规则」「版本三锚点 bump」**CI 根本抓不到**）。
> 关联：`BACKLOG.md` BL-PROC-03 · `CONTRIBUTING.md` §三 · `TESTING.md`

---

## 1. 为什么评审必须是独立环节

CI 能验证的是**机器可判定**的事（类型/构建/测试/产物形态）。
CI **不能**验证的事，恰恰是最容易出事的地方：

| CI 抓不到 | 真实事故 |
|---|---|
| 该改的文档改了吗 | 测试断言数在 4 处不一致（README/ROADMAP/CLAUDE.md） |
| 版本号三锚点同步了吗 | release 前发现 `manifest.ts` 版本与 `package.json` 不同 |
| 有没有把本机文件提交上去 | `.cycles/*` 工件 384 个被跟踪；`cordis.local.yml` 含绝对路径 |
| 目标 issue 真的解决了吗 | issue #3 两条搜索通道在真实用户环境双双失效，测试全绿 |
| 这次改动会不会破坏相邻功能 | cycle-30 真题卷交互被静默降级，smoke/render 全绿 |
| 有没有"说得比做得多" | 文档写"已实现"但运行时代码缺失 |

**结论**：评审不是形式，是**盲区覆盖**。

---

## 2. 四评审员分工

开 PR 前，按四个视角各过一遍。**单人项目也要做**——用不同视角自我审查，效果等同。

| 评审员 | 关注点 | 必查项 | 产出 |
|---|---|---|---|
| **reviewer-code** | 正确性与回归 | ① 边界条件（空/极值/并发/重复/取消）② 类型是否真的收窄 ③ 复杂度预算（≤180）④ **修复是否引入二阶影响**（C32b 教训）⑤ 新增断言是否真的能红 | blocker/major/minor 清单 |
| **reviewer-git** | 仓库卫生 | ① `.gitignore` 是否覆盖运行时产物 ② 是否误跟踪本机文件（`cordis.local.yml`/`data/progress.json`/`.cycles/*`）③ 分支名合规 ④ 提交粒度（一个提交一件事）⑤ **文档是否自相矛盾**（数字/端点/工具计数） | 同上 |
| **reviewer-issues** | 需求闭环 | ① 目标 issue 是否真的解决（**跑真实环境矩阵**，不只看测试绿）② 相邻 issue 是否被波及（当前开放：#4 图片搜题、#5 统一抽题池）③ 未完成项是否登记 `BACKLOG.md` ④ 关闭 issue 的证据是否可复现 | 同上 |
| **reviewer-release** | 发布完备 | ① 版本三锚点一致（`package.json` / `manifest.ts` / `README.md`）② `CHANGELOG.md` 已更新且分组 ③ `npm pack` 内容正确（含 `cordis.patch.yml`、无语料无凭据）④ 实测数字（smoke/render）与声明一致 ⑤ 回滚锚点已记录 | 同上 |

---

## 3. 五维检查单（每个变更都要过）

| 维度 | 检查项 | 反例 |
|---|---|---|
| **① 功能正确** | 主链路通；边界（空输入/极值/重复/取消/超时）有断言 | IMG-04 间歇假红（概率补捞 → 确定性配额） |
| **② 安全** | 路径穿越（`isInside`）、凭据不入库、子进程 `windowsHide` + `on('error')` | issue #6 Windows 安装 100% 失败 |
| **③ 性能** | 缓存键覆盖全部租户维度、无 N+1、长阻塞不在 HTTP 断言之后 | R20 跨工作区缓存泄漏 |
| **④ 可维护** | 模块边界清晰、命名带前缀（combo 单作用域）、**文档已同步** | R25 陈旧文案 |
| **⑤ 可观测** | 新增端点进 manifest、遥测口径与声明同源、降级不吞错 | v1.8 遥测假阳性（43 端点全误判） |

---

## 4. 问题定级与处理

| 级别 | 定义 | 处理要求 |
|---|---|---|
| **blocker** | 会导致功能不可用 / 数据损坏 / 安全漏洞 / 发布阻断 | **必须全修**，未修不得开 PR |
| **major** | 明显缺陷或规范违反，但有绕行方案 | **应修**；不修须在 PR 写明理由与遗留登记 |
| **minor** | 风格、优化、可读性 | 可登记 `BACKLOG.md` 延后 |

**硬规则**：

1. 评审意见**必须落到 `文件:行号`**——"某处可能有问题"不是评审意见。
2. 争议走**文档补录**（写进 `CONVENTIONS.md` 或 ADR 式记录），不靠口头结论。
3. **连续两次同类 blocker → 必须回补规范**（写进 `INCIDENTS.md` 事故簿 + 能固化的加成 smoke 断言）。
   本项目已有此传统：R1–R28 事故簿几乎每条都对应一个 smoke 守卫。
4. 结论只有三种：**PASS** / **CHANGES-REQUESTED** / **REJECT**。

---

## 5. 负向验证（证明门禁真的会红）★

> **一个守卫只有在回归能让它失败时才有效。**（官方测试规范原文）

这是本规范最重要的一条。每次新增守卫/断言，必须做一次**变异测试**：

```bash
# 1. 故意制造违规
#    例：临时移除 package.json files 中的 cordis.patch.yml
# 2. 运行守卫，确认它变红（非 0 退出 / 断言失败）
node smoke.test.mjs          # 期望：R28 断言失败
# 3. 撤销违规，确认恢复绿
git checkout -- package.json
node smoke.test.mjs          # 期望：全绿
```

**必须做负向验证的场景**：

| 守卫类型 | 变异方式 |
|---|---|
| 打包卫生（R28） | 从 `files` 移除 `cordis.patch.yml` |
| 产物形态（assert-combo） | 绕过 bundler 直接 `npx tsc` |
| 提交信息门禁 | 试提交 `bad message` |
| backlog 关联 | 在无 BL 编号的分支上试 push |
| 文档数字同源 | 改 README 里任一断言数 |
| 端点声明（manifest） | 删掉一个端点声明 |

**已执行的负向验证记录**：

| 日期 | 守卫 | 变异 | 结果 |
|---|---|---|---|
| 2026-11-10 (v1.13.1) | R28 打包卫生 | 移除 `files` 白名单条目 | ✅ 两条断言立刻变红 |
| 2026-11-20 | 文档数字同源 | 篡改 README smoke 断言数 | ✅ `check-facts.mjs` exit 1 |
| 2026-11-20 | 提交信息门禁 | 提交 `bad commit message` | ✅ `commit-msg` 拒绝 |

---

## 6. 评审报告模板

存到 `docs/agents/reviews/YYYY-MM-DD-<主题>.md`：

```markdown
# 评审报告 · <主题>

- 日期：YYYY-MM-DD
- 关联：BL-XXX-NN / #issue
- 分支：feature/xxx
- 评审员：reviewer-code / reviewer-git / reviewer-issues / reviewer-release

## 结论

PASS / CHANGES-REQUESTED

## Blocker（必须全修）

| # | 评审员 | 位置 | 问题 | 状态 |
|---|---|---|---|---|
| B1 | reviewer-git | `.gitignore:12` | `.cycles/*` 规则丢失，工件被跟踪 | ✅ 已修 |

## Major

| # | 评审员 | 位置 | 问题 | 状态 |
|---|---|---|---|---|

## Minor（登记 BACKLOG）

| # | 位置 | 问题 | 去向 |
|---|---|---|---|

## 测试证据

（贴命令与输出；实测数字，不接受"应该没问题"）

## 负向验证

（本次新增守卫的变异测试记录）

## 规范反哺

（本次教训是否已写入 INCIDENTS.md / 是否新增 smoke 守卫）
```

---

## 7. 与其他文档的关系

| 文档 | 关系 |
|---|---|
| `CONTRIBUTING.md` | 分支/提交/PR 的**规则**；本文件是评审**执行方法** |
| `BACKLOG.md` | 评审发现的 minor 与未完成项的去处 |
| `TESTING.md` | 测试策略与必跑清单（评审的证据来源） |
| `INCIDENTS.md` | 事故簿；连续 blocker 反哺的落点 |
| `CONVENTIONS.md` | 编码纪律；争议裁决的依据 |
