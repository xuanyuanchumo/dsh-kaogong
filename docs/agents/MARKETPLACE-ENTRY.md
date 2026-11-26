---
title: 插件市场收录条目（awesome-dsh-plugin）
status: current
updated: 2026-11-26
---
# 插件市场收录条目（awesome-dsh-plugin）

> 规范来源：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>（2026-11-20 核对）。
> **投稿只提交一个文件**：`data/plugins/xuanyuanchumo__dsh-kaogong.yml`（一个 PR 最多 3 条；两个 README 由脚本生成，**勿手改**）。

## 0. 收录状态（2026-11-20 核实）

**本插件已被 awesome-dsh-plugin 收录**——上游 `data/plugins/xuanyuanchumo__dsh-kaogong.yml` 已存在
（`category: tools`，description 中英双语，icon 指向本仓库 `assets/icon-180.png`）。
本文件下方保留「建议更新版」，仅在需要更新描述时向上游提 PR（**只改自己这一条**）。

## 1. 建议更新版 YAML（如需刷新描述时使用）

```yaml
url: https://github.com/xuanyuanchumo/dsh-kaogong
name: xuanyuanchumo/dsh-kaogong
category: tools
description:
  en: 'Civil-service exam study platform: on-demand install of 16 upstream question-bank repos, five-box SRS wrong-book, 1,683 real exam papers in three study modes, offline essay grading, a 25-article methodology library, an interactive knowledge graph, and a white-box observability panel.'
  zh: '考公备考学习平台：按需安装 16 个上游题库仓库、五箱 SRS 错题本、1,683 套真题卷三种模式、申论离线评改、25 篇方法论库、可交互知识图谱与白盒可观测面板。'
icon: https://raw.githubusercontent.com/xuanyuanchumo/dsh-kaogong/main/assets/icon-180.png
```

**格式纪律（contributing.md 明文）**
- 只用 `url / name / category / description{en,zh} / icon / tarball`；**禁止手写 `npm:` 键**（npm 关联由 registry 自动采集）。
- `description.en` 必填、**一句话、以句号结尾**；含 `: ` 的值必须加引号（上方已用单引号）。
- `icon` 必须是 **GitHub 托管位图**（png/jpg/jpeg/webp）；SVG 与第三方图床会被拒。本仓库 `assets/icon-180.png`（2.3KB）已就位。

## 2. category 取值决策

**上游实际取 `tools`**（维护者决定）——与「提供工具面板与 API」的定位一致；本插件 6 个宿主工具 + 79 个 HTTP 端点
属工具类。`usage`/`skill`/`docs` 的取舍已由上游定案，无需再争。

> contributing.md 明确「分类选得不够准的，维护者会直接改，不会打回」——此处取最贴近者即可。

## 3. 投稿前置自检（全部已满足，2026-11-20 核实）

| 要求 | 状态 | 证据 |
|---|---|---|
| `package.json` 声明 `dsh.bundle`（非仅 `dsh.client`） | ✅ | `dsh.bundle.patch = ./cordis.patch.yml` |
| 仓库根有 `cordis.patch.yml` | ✅ | `insert: [{id: kaogong, name: dsh-kaogong}]` |
| 仓库有真实可用代码 | ✅ | 72 源文件（`src/**/*.ts(x)`）· 79 端点 · 6 工具 · 16 视图 |
| 仓库创建满 1 天 | ✅ | 2026-11 前创建（CI 自动查） |
| 添加 `dsh-plugin` topic | ✅ | topics: `dsh-plugin` / `civil-service` / `deepseek-harness` / `exam` / `kaogong` |
| 描述属实（数字可对代码核对） | ✅ | 16 仓库（REPOS）· 1,683 卷（paperIndex）· 25 篇（HUASHENG13_META）· 6 工具 · 16 视图 |
| 官方 `@deepseek-ai/*` 用 `peerDependencies` 且带**显式预发布分支** | ✅ | `>=0.2.1-rc.0 <0.3.0-0 \|\| >=0.3.0-rc.0 <0.4.0-0`（含 `0.2.1` 元组预发布标签） |
| `screenshots.json`（1–8 图，相对路径） | ✅ | `assets/screenshot-1..4.png` |
| npm 包 `repository` 指回本仓库 | ✅ | `git+https://github.com/xuanyuanchumo/dsh-kaogong.git` |

## 4. 投稿操作

```bash
# 1) fork awesome-dsh-plugin
# 2) 新增 data/plugins/xuanyuanchumo__dsh-kaogong.yml（内容 = 上方 YAML）
# 3) 提 PR（只加这一个文件；不要动 README、不要改他人条目）
# CI 依次检查：条目数 ≤3 → dsh.bundle → 仓库年龄 ≥1 天 → awesome-lint / 站点构建
```

被要求修改时维护者会打 `held: author`：把修复推到同一分支 + 留**一条**评论说明改了什么；
不要反复推送或催问（队列两侧在重新评审前都看不到变化）。

## 5. 机器校验

`docs/marketplace/xuanyuanchumo__dsh-kaogong.yml` 与上方结构一致，由 smoke 的 `RDOC`/市场条目断言校验
（字段集合、引号、icon 位图后缀、无 `npm:` 键）。改动条目时同步该文件与断言。
