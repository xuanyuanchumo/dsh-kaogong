---
title: dsh-kaogong 文档中心
status: current
updated: 2026-11-20
---

# dsh-kaogong 文档中心

> 本目录是插件开发文档、规范与质量体系的**唯一入口**。
> 治理规则：每个主题只有一份 `current` 文档；历史靠 Git；废弃文档标 `legacy` + `superseded_by`。
> 门禁：`node scripts/docs/check-docs.mjs`（六检）+ `node scripts/docs/check-facts.mjs`（数字同源）。

---

## 开工必读（顺序）

| 顺序 | 文档 | 为什么先读 |
|---|---|---|
| 1 | [BACKLOG.md](./agents/BACKLOG.md) | 确认本次任务有编号、有验收标准 |
| 2 | [CONTRIBUTING.md](../CONTRIBUTING.md) | 分支模型、提交规范、PR 流程、变更连带义务 |
| 3 | [ARCH-LAYOUT.md](./agents/ARCH-LAYOUT.md) | 目录职责与分层禁区 |
| 4 | [REVIEW.md](./agents/REVIEW.md) | 评审分工、五维检查单、负向验证要求 |
| 5 | [CLAUDE.md](../CLAUDE.md) | 项目事实基线与事故簿（R1–R28） |

---

## 快速路由（按任务找文档）

| 我要做的事 | 先读 | 再看 |
|---|---|---|
| 第一次接触本项目 | [ARCHITECTURE.md](./agents/ARCHITECTURE.md) | [ARCH-LAYOUT.md](./agents/ARCH-LAYOUT.md) |
| 加/改 HTTP 端点 | [API-REFERENCE.md](./agents/API-REFERENCE.md) | [CONVENTIONS.md](./agents/CONVENTIONS.md) §端点契约纪律 |
| 改统一题目池 / 存储层 | [STORAGE-LAYER.md](./agents/STORAGE-LAYER.md) | [API-REFERENCE.md](./agents/API-REFERENCE.md) §九c |
| 改客户端 UI | [CONVENTIONS.md](./agents/CONVENTIONS.md) §客户端纪律 | [ARCH-LAYOUT.md](./agents/ARCH-LAYOUT.md) §2 |
| 用宿主能力 | [DSH-HOST-CAPABILITIES.md](./agents/DSH-HOST-CAPABILITIES.md) | — |
| 接入新数据源 | [DATA-SOURCES.md](./agents/DATA-SOURCES.md) | [STORAGE-LAYER.md](./agents/STORAGE-LAYER.md) §5 |
| 提交前验证 / 发布 | [TESTING.md](./agents/TESTING.md) | [BRANCHING-STRATEGY.md](./agents/BRANCHING-STRATEGY.md) §6 |
| **准备开 PR（评审）** | [**REVIEW.md**](./agents/REVIEW.md) | [CONTRIBUTING.md](../CONTRIBUTING.md) §三 |
| 踩到奇怪的坑 | [INCIDENTS.md](./agents/INCIDENTS.md) | [CLAUDE.md](../CLAUDE.md) 事故簿 |
| **沙箱/真机验证会不会污染目录** | [**ISOLATION.md**](./agents/ISOLATION.md) | [TESTING.md](./agents/TESTING.md) §三 |
| 登记未完成项 | [BACKLOG.md](./agents/BACKLOG.md) | — |
| 市场投稿 | [MARKETPLACE-ENTRY.md](./agents/MARKETPLACE-ENTRY.md) | [marketplace/](./marketplace/) |

---

## 目录结构

| 目录 | 内容 | 主题文档 |
|---|---|---|
| [agents/](./agents/) | **agent 开发文档（事实基线层）** | 见下方清单 |
| [design/](./design/) | 设计契约 | [unified-storage-architecture](./design/unified-storage-architecture.md) · [cycle-12-contract](./design/cycle-12-contract.md) |
| [research/](./research/) | 研究文档（五段式：定义→代码落地→场景→价值→验证） | [README](./research/README.md)（31 篇） |
| [release/](./release/) | 发行说明（GitHub Release notes 源） | [v1.34.1](./release/v1.34.1.md) · [v1.34.0](./release/v1.34.0.md) · [v1.31.0](./release/v1.31.0.md) |
| [marketplace/](./marketplace/) | awesome-dsh-plugin 市场条目 | [xuanyuanchumo__dsh-kaogong.yml](./marketplace/xuanyuanchumo__dsh-kaogong.yml) |
| [facts.json](./facts.json) | **文档事实源**（自动生成，勿手改） | 生成：`node scripts/docs/gen-facts.mjs` |
| [DSH插件开发官方与生态.md](./DSH插件开发官方与生态.md) | DSH 官方插件开发规范与生态现状（宿主契约、市场规范） | 宿主能力/市场规则变更时 |

---

## agents/ 文档清单

| 文档 | 内容 | 维护触发条件 |
|---|---|---|
| [ARCH-LAYOUT.md](./agents/ARCH-LAYOUT.md) | **目录职责、分层禁区、与 dsh 官方规范的对照与偏差登记** | 新增目录/发现新偏差时 |
| [ARCHITECTURE.md](./agents/ARCHITECTURE.md) | 双半结构、combo 工厂、域工厂重建、数据根四级解析 | 新增分层/入口/域时 |
| [STORAGE-LAYER.md](./agents/STORAGE-LAYER.md) | 统一题目池 `.kaogong.db`：四层依赖 + 六不变量 + schema + 源注册表 | 改存储层/关系层/新增源时 |
| [API-REFERENCE.md](./agents/API-REFERENCE.md) | 端点 + 工具 + 视图契约 | 改端点时（必须同步） |
| [METHODOLOGY.md](./agents/METHODOLOGY.md) | 花生十三体系适配库：语料/BM25/覆盖矩阵 | 改方法论语料或检索时 |
| [CONVENTIONS.md](./agents/CONVENTIONS.md) | 编码规范、技术选型理由、纪律条款 | 引入新约定时 |
| [DSH-HOST-CAPABILITIES.md](./agents/DSH-HOST-CAPABILITIES.md) | 宿主能力盘点：已用/可用未用/市场合规 | 发现新宿主能力时 |
| [DATA-SOURCES.md](./agents/DATA-SOURCES.md) | 16 仓库分级注册表、适配器、字段映射 | 接入新仓库时 |
| [TESTING.md](./agents/TESTING.md) | 测试金字塔、守卫清单、发布流程 | 测试/发布策略变化时 |
| [REVIEW.md](./agents/REVIEW.md) | **评审规范：四员分工、五维检查单、负向验证** | 评审流程变化时 |
| [ISOLATION.md](./agents/ISOLATION.md) | **验证环境隔离：沙箱/真机是否污染数据根、端口、安装目录；三层隔离方案** | 验证策略/隔离规则变化时 |
| [BACKLOG.md](./agents/BACKLOG.md) | **唯一未完成清单（BL 编号体系）** | 每轮迭代收口时 |
| [BRANCHING-STRATEGY.md](./agents/BRANCHING-STRATEGY.md) | 分支拓扑、合并方案、发布与回滚 runbook | 分支策略变化时 |
| [MARKETPLACE-ENTRY.md](./agents/MARKETPLACE-ENTRY.md) | 市场条目与合规证据 | 投稿/条目更新时 |
| [INCIDENTS.md](./agents/INCIDENTS.md) | 事故簿 R1–R28（根因+修复+守卫） | 每次线上/真机事故后 |
| [ROADMAP.md](./agents/ROADMAP.md) | 演进方向（**技术债已迁至 BACKLOG.md**） | 每轮迭代收口时 |

---

## 文档治理规则

1. **frontmatter 必填**：`title` / `status`(draft\|current\|legacy) / `updated`；被替代文档必须填 `superseded_by`。
2. **默认不新建**：优先扩展现有文档；确需新建，先在本文件「agents/ 文档清单」登记。
3. **历史靠 Git**：不建 `archive/` 目录；废弃文档标 `legacy` + `superseded_by`。
4. **可派生数字必须同源**：能力计数（端点/工具/视图/仓库数）以 [facts.json](./facts.json) 为准（由 manifest 派生），禁止手写。测试断言数**不进事实源**——它是自我声明且不等于质量，测试质量只由 `npm run test:all` 退出码保证。
5. **中文优先**：正文中文；术语首现给英文；代码注释中文。
6. **不写空谈**：研究文档必须含「代码落地（file:line）」与「可运行验证」两节，否则该文档无价值。

**门禁命令**：

```bash
node scripts/docs/check-docs.mjs     # 六检：frontmatter/链接/可达/superseded/archive/TODO
node scripts/docs/check-facts.mjs    # 能力计数同源（端点/工具；从 manifest 派生）
node scripts/docs/gen-facts.mjs      # 重新生成事实源（需先 npm run build）
npm run test:all                     # 唯一质量门：loader + smoke + render 退出码
```
