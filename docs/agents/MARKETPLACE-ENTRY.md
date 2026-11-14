# 插件市场条目（awesome-dsh-plugin）

> 备查文件：条目 YAML 草案 + 投稿合规证据。**真正投稿时只提交一个文件**：
> `data/plugins/xuanyuanchumo__dsh-kaogong.yml`（一个 PR 一个文件、最多 3 条；两个 README 由脚本生成，勿手改）。
> 规范来源：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>（2026-11 核对）。

## 1. 条目 YAML（草案，可直接作为 PR 文件内容）

```yaml
url: https://github.com/xuanyuanchumo/dsh-kaogong
name: xuanyuanchumo/dsh-kaogong
category: usage
description:
  en: 'Civil-service exam study platform: on-demand question banks, five-box SRS wrong-book, 1,683 real exam papers with three study modes (timed mock exam, learn-one-by-one with instant analysis, full-paper answer checking), offline essay grading, a 25-article six-module methodology library with BM25 search, an adaptive 30-day study schedule, an interactive knowledge graph with on-demand subgraphs, and a white-box observability panel; the 16 upstream data repositories are installed on demand, and the package ships no exam data.'
  zh: '离线考公备考平台：一键式题库管理、五箱 SRS 错题本、1,683 套真题卷（三种模式：限时模考 / 学习模式单题即判即析 / 全卷答案对照）、申论离线评改、25 篇六模块方法论（BM25 检索）、30 天学习计划智能排程、可交互知识图谱（子图按需加载）与白盒可观测面板；16 个上游数据仓库按需安装，插件包不携带题库数据。'
icon: https://raw.githubusercontent.com/xuanyuanchumo/dsh-kaogong/main/assets/icon-180.png
```

> cycle-19 修订：category 由 `tools` 调整为 `usage`（学习/使用类工具，与「usage=学习类」定位更贴）；机器校验脚本 `docs/marketplace/xuanyuanchumo__dsh-kaogong.yml`（六项结构断言全过：url/name/category/引号描述/icon）。

字段纪律（contributing.md 明文）：

- 只用 `url / name / category / description{en,zh} / icon / tarball`；**不得手写 `npm:` 键**（npm 关联由 registry 自动采集，手写会被校验拒绝）。
- `description.en` 必填；含 `: ` 的值必须加引号（上面已用单引号包裹）。
- `icon` 必须是 **GitHub 托管的位图**（png/jpg/jpeg/webp）；SVG 与第三方图床会被拒。
- category 取最贴合功能的：本项目为 **`tools`**（不是 `skill`——本插件不是 skill 包；也不放 `docs`，因为核心是工具面板与 API）。
- 不要营销词、不要夸大；描述里的数字会被维护者对着代码核对（见 §3）。

## 2. 投稿操作

```bash
# 1) fork awesome-dsh-plugin，新增一个文件（文件名 = owner__repo.yml）
#    data/plugins/xuanyuanchumo__dsh-kaogong.yml
# 2) 内容 = 上方 YAML
# 3) 提 PR（标题说明新增 dsh-kaogong；不要改 README、不要顺手改别人的条目）
# 4) CI 依次检查：条目数 ≤3 → dsh.bundle → 仓库年龄 ≥1 天 → awesome-lint/站点构建
```

被要求修改时维护者会打 `held: author` 标签：把修复推到同一分支 + 留**一条**评论说明改了什么即可；不要反复推送或催问。

## 3. 合规证据（本仓实测，2026-11）

| contributing.md 要求 | 本仓证据 |
|---|---|
| `package.json` 声明 `dsh.bundle`（只声明 `dsh.client` 不可安装，最常见被拒原因） | `package.json` → `"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": {…} }`；`cordis.patch.yml` 在仓库根 |
| 仓库有真实、可运行代码（非占位/纯 README） | 16 视图 / 57 端点 / 6 工具 / 130+ 源文件；smoke 262 + render 50 |
| 仓库创建满 1 天（CI 自动查） | ✅ GitHub API 实测 `created_at=2026-11-04T02:37:08Z`（截至 2026-11-09 已满 1 天） |
| GitHub topic `dsh-plugin` | ✅ GitHub API 实测 topics 含 `dsh-plugin`（同含 `deepseek-harness` / `kaogong` / `civil-service` / `exam`） |
| 描述只说功能、数字属实 | 58,890 题 = `xingcezhenti`（REPOS_META 描述）；1,683 套 = `gwy-zhenti`；25 篇 = `HUASHENG13_META` 展平；16 仓库 = `REPOS_META` 键数；336KB = `REPOS_META.huasheng13.size`。均在 `src/shared/manifest.ts:278-296` |
| peer 范围含**显式预发布分支**（否则静默排除所有 rc，用户 ERESOLVE） | `package.json` → `">=0.2.0-rc.2 <0.2.1-0 \|\| >=0.2.1-rc.0 <0.3.0-0 \|\| >=0.3.0-rc.0 <0.4.0-0"`（三段，每段都在对应 tuple 带预发布标签）；`engines.dsh` 同串 |
| 官方 `@deepseek-ai/*` 用 `peerDependencies` 而非 `dependencies` | `peerDependencies` 声明 `@deepseek-ai/cordis` + `@deepseek-ai/dsh`；`devDependencies` 只有 typescript/@types/node |
| 描述不含没有的命令/API | 描述未提具体端点名；功能均可在 `CAPABILITIES.endpoints/tools/views` 找到 |
| icon 为 GitHub 托管位图 | `assets/icon-180.png`（2348B，真实文件）；`https://raw.githubusercontent.com/xuanyuanchumo/dsh-kaogong/main/assets/icon-180.png` 实测 HTTP 200 / 2348B |
| `screenshots.json` 在仓库根、1–8 张、相对路径不跳出插件目录 | `screenshots.json` 4 条：`assets/screenshot-{1-dashboard,2-graph,3-observability,4-repos}.png`；本地 4 文件存在，GitHub main 分支 `assets/` 经 API 核对同样 4 张齐全 |
| npm 包 `repository` 回指本仓库 | `package.json` → `"repository": { "url": "git+https://github.com/xuanyuanchumo/dsh-kaogong.git" }` |
| 单 PR ≤3 条、只动自己的条目 | 本条目只提交 1 个文件；不修改 README/他人条目 |
| 非纯聚合包（meta-package） | 本插件自身产出 6 端点 + 视图 + BM25 引擎 + 白盒面板，不是只依赖别人的聚合包 |

## 4. 截图清单（`screenshots.json`）

| 文件 | 内容 |
|---|---|
| `assets/screenshot-1-dashboard.png` | 仪表盘（双入口宿主面板） |
| `assets/screenshot-2-graph.png` | 交互式知识图谱 |
| `assets/screenshot-3-observability.png` | 白盒可观测面板 |
| `assets/screenshot-4-repos.png` | 题库管理（分级安装 + 关于本项目） |

> v1.13 方法论视图暂未补截图（不伪造素材）。若要展示方法论文档/检索，先真机截图再追加到 `screenshots.json`（最多 8 张）。

## 5. 发布前自检命令

```bash
cd dsh-kaogong
npm run build                                   # tsc + bundler（13 模块 → 单 combo）
node smoke.test.mjs && node render.test.mjs     # 262 + 50
npm pack --dry-run                              # 判据：无 data/、无 huasheng13 语料、含 assets 图标与截图
```

> 发布由 Lead 执行；本文件只准备条目与证据，不代提 PR、不代发 npm。