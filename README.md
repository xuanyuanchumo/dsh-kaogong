# dsh-kaogong — 考公备考整合插件（DSH 宿主原生面板）· v1.11.0

> **一句话**：把 15 个优秀开源考公仓库整合为 DeepSeek Harness（DSH）宿主内的原生学习平台 ——
> 刷题 / 错题本 SRS / 真题卷 / 整卷模考 / 申论评改 / 知识图谱 / 白盒可观测，完全离线可用。
>
> **重要说明（安装前必读）**：本插件是**整合与可视化层，npm 包不含题库数据**。
> 15 个数据仓库合计约 2.2GB 且各有独立上游作者，不适合随包分发。
> 安装插件后打开「📦 题库管理」视图 → **一键安装必选包（约 363MB）** → 全部核心功能即刻可用。
> 支持自定义数据目录、GitHub 镜像代理（国内网络加速）、分级下载（必选/推荐/可选）避免一次拉取过大。

## ✨ 核心特性

| | |
|---|---|
| 🏠 **宿主原生** | DSH Web GUI 双入口：左栏「考公学习」全屏沉浸面板 + 右侧 Sidebar 并排标签；同源路由零 CORS，非 iframe |
| 📦 **一键式题库管理**（v1.11） | 必选/推荐/可选三级分装 · git 浅克隆/更新/删除 · 目录浏览 · 自定义数据根 · 镜像代理（gh-proxy 等）· 作业实时日志 |
| ✏️ **智能刷题** | 58,890 题行测真题 · 五箱 SRS 错题本（答错收集→回炉升箱→掌握）· 弱点加权抽题 · 键盘流 |
| 💾 **专项刷题记忆**（v1.10） | 进入刷题/图形推理/深度题库自动显示「上次练到 xx 的 xx 题」，一键跳回原题 |
| 📚 **真题卷 1,683 套** | 申论 944 / 行测 739（2008-2026）· 科目/省份/年份三维筛选 · 材料逐份折叠 · 题目配图 |
| ✍️ **申论离线评改** | 零模型规则引擎：采分点覆盖 50% + 结构 20% + 字数 15% + 语言 15%，附批改建议；大作文五档字数分档 |
| ⏱ **整卷模考** | 限时倒计时 · 服务端判分（答案不下发防作弊）· 模块得分分布 · 历史战绩 |
| 🧠 **深度题库** | 27,506 题五维标注（考点定位/推理链/最快解法/易错点/母题思维）· 10,647 题含图 |
| 🕸️ **交互图谱** | Canvas 2D 力导向（FR 模型）· 三布局（力导向/分层/环形）· 边流动粒子 · 五档着色 · 小地图 · 路径分析 · 导出 PNG |
| 📡 **白盒可观测** | 生命周期状态机 · 能力对账（注册→生产→消费三态灯）· 端点性能表 · 延迟分位阶梯 · 吞吐×延迟四象限 · 诊断导出 |
| 🔌 **可选 AI 增强** | 5 个宿主工具（launch/tutor/plan/shenlun/essay_review）把离线基线分+方法论交模型深度点评；无模型时全部离线功能不受影响 |

## 🚀 安装

### 方式一：DSH 宿主内安装（推荐）

```bash
# 从 GitHub 克隆后，在 DSH 会话/控制台执行：
git clone https://github.com/xuanyuanchumo/dsh-kaogong.git
# 然后在 DSH 内：
plugin_manager install_bundle <克隆目录>/dsh-kaogong
```

安装即生效：Host 挂载同源路由 `/kaogong/*` → Client 注册双入口 → 刷新 GUI → 点左栏 📚。

### 方式二：npm 包

```bash
npm install dsh-kaogong
```

（作为 DSH profile 的 bundle 依赖引入，宿主启动时自动装配。）

### 首次使用：一键装数据

1. 打开左栏「考公学习」→ **📦 题库管理**
2. 国内网络先在「镜像代理」填 `https://gh-proxy.com/` 再安装
3. 点「🚀 一键安装必选包」（行测真题 341MB + 方法论 3MB + 图形推理 19MB，合计约 363MB）
4. 装完即可刷题；真题卷/模考/深度题库按需再装「推荐」级；其余素材装「可选」级

> 独立运行（无 DSH 宿主）：
> `node -e "import('dsh-kaogong/server').then(m=>m.startServer(8400))"` → http://127.0.0.1:8400

## 🗂 数据根与题库管理（v1.11 核心）

**数据根解析优先级**（高→低）：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 环境变量 `KG_REPOS_DIR` | CI / 高级用户 |
| 2 | `data/repos-config.json` | 题库管理面板「保存根目录」写入 |
| 3 | 开发态上级目录 | 目录内含任一已登记题库仓库时自动识别 |
| 4 | `data/repos/`（托管默认） | npm 安装态，配合一键克隆 |

**题库分级**（15 仓库全量登记于 manifest `REPOS_META`，单一事实源）：

| 级 | 仓库 | 体积 | 支撑功能 |
|---|---|---|---|
| 必选 | xingcezhenti | 341MB | 行测刷题（58,890 题） |
| 必选 | kaogong-skill | 3MB | 方法论 10 主题 |
| 必选 | gk-tuxing | 19MB | 图形推理 354 题 |
| 推荐 | gwy-zhenti | 626MB | 真题卷 1,683 套 / 模考 / 申论评改 |
| 推荐 | GongkaoNaoku | 120MB | 深度题库 27,506 题五维标注 |
| 可选 | 其余 9 仓库 | ~1.16GB | 检索增强 / 笔记模板 / 面试素材等 |

**管理面板能力**：安装（浅克隆 `--depth 1`）· 更新（`pull --ff-only`）· 删除（仅清数据目录，学习进度不受影响）· 目录浏览 · 作业实时日志与取消 · 并发上限 2 · 非 git 目录保护（拒绝覆盖用户数据）· 路径穿越防线 · 安装/换根后 paperIndex/naoku/graphCache 三级缓存自动失效重建。

## 🏗 架构

```
src/
├── shared/manifest.ts     # 能力单一事实源：端点/工具/视图/lifecycle + REPOS_META + 图算法(PageRank/Union-Find/健康度加权)
├── adapters/              # 数据源适配层（15 仓库只读隔离）：repoData/paperData(索引v2+快照+分块预热)/naoku(node:sqlite)/tuxing/paperParse
├── server/
│   ├── dataRoot.ts        # 数据根四级解析 + repos-config 持久化（v1.11）
│   ├── repoManager.ts     # 题库管理域：git 作业/校验/镜像/浏览/删除（v1.11）
│   ├── http.ts            # 路由分发(域链+异步管理域) + 信标 + 遥测 + 图谱 + 崩溃安全启动 + 同源挂载
│   ├── ws.ts / srs.ts     # 工作区命名空间隔离 / 错题本五箱 SRS + 专项记忆
│   └── paperApi / naokuApi / tuxingApi / dataApi / topicTree
├── host/index.ts          # Cordis Host 半：webServer 同源(主) + 端口兜底 + 5 AI 工具
├── client/                # Cordis Client 半（12 模块，构建期合并为宿主要求的单 combo）
│   ├── client.ts          # 双入口注册 + 视图分发 + 通道探测
│   ├── study-view / papers-view / graph-view+engine+physics+transition+canvas+analytics
│   ├── obs-view           # 白盒管理面板
│   └── repos-view         # 题库管理面板（v1.11）
└── ui/                    # 零依赖 SPA 兜底页（独立端口通道）
```

**双通道**：宿主同源 `/kaogong/*`（主，零 CORS）→ 独立端口 `127.0.0.1:8400-8404`（兜底，信标发现 + adopt 复用）。

**关键机制**：崩溃安全（listen 错误 Promise 受控回传，绝不击杀宿主）· 热重载竞态防线（本代资源闭包持有）· 工作区隔离（`?ws=` → slug+sha1 分文件）· 零 npm 运行时依赖（Node 标准库 only）。

## 🙏 致敬上游（全部数据与成果归原作者）

本插件仅做整合、解析与可视化。题库数据与解题方法论来自以下开源仓库（排名不分先后，点击跳转原仓库）：

| 仓库 | 作者 | 内容 |
|---|---|---|
| [xingcezhenti](https://github.com/ERRRC/xingcezhenti) | [@ERRRC](https://github.com/ERRRC) | 515 套卷 58,890 题行测真题库 |
| [kaogongzhentizhengliu](https://github.com/ERRRC/kaogongzhentizhengliu) | [@ERRRC](https://github.com/ERRRC) | 22,375 篇考点重组深度笔记 |
| [GongkaoNaoku](https://github.com/jangviktor-web/GongkaoNaoku) | [@jangviktor-web](https://github.com/jangviktor-web) | SM-2 引擎 · 27,506 题五维深度标注 |
| [AdministrativeAptitudeTest](https://github.com/jecoat/AdministrativeAptitudeTest) | [@jecoat](https://github.com/jecoat) | 近二十年国考省考选调生试卷 PDF |
| [NovaForge](https://github.com/SiriusFzh/NovaForge) | [@SiriusFzh](https://github.com/SiriusFzh) | 通用笔记模板（LaTeX/Typst/Markdown） |
| [kaogong-skill](https://github.com/KeWang0622/kaogong-skill) | [@KeWang0622](https://github.com/KeWang0622) | 考公 AI 技能包（出题/讲解/批改/复盘） |
| [sakib](https://github.com/vsakib/sakib) | [@vsakib](https://github.com/vsakib) | 公考知识文档库 |
| [developer2gwy](https://github.com/miss-mumu/developer2gwy) | [@miss-mumu](https://github.com/miss-mumu) | 程序员上岸公考实践指南 |
| [gwy-zhenti](https://github.com/ProfessorZhi/gwy-zhenti) | [@ProfessorZhi](https://github.com/ProfessorZhi) | 国考省考行测申论图文真题 1,683 套 |
| [Exam_Database](https://github.com/869909419/Exam_Database) | [@869909419](https://github.com/869909419) | 多渠道考公素材题库 |
| [qiuzhao-epi-bank](https://github.com/Timothy-yqw19/qiuzhao-epi-bank) | [@Timothy-yqw19](https://github.com/Timothy-yqw19) | 秋招行测/银行 EPI 刷题（697 题 PWA） |
| [xingce-app](https://github.com/YMDHZBSJ/xingce-app) | [@YMDHZBSJ](https://github.com/YMDHZBSJ) | 离线行测 App（22,298 题） |
| [gk-tuxing](https://github.com/Cha551/gk-tuxing) | [@Cha551](https://github.com/Cha551) | 图形推理真题 354 道逐题解析 |
| [civil-exam-agent](https://github.com/tongnian0666-code/civil-exam-agent) | [@tongnian0666-code](https://github.com/tongnian0666-code) | 公考督导智能体系统 |
| [yunduanqiqu](https://github.com/hwlvipone/yunduanqiqu) | [@hwlvipone](https://github.com/hwlvipone) | 申论范文/面试真题/素材分享 |

同时感谢 [DeepSeek Harness](https://github.com/deepseek-ai) 宿主提供 webServer 同源路由、slots 席位、工具注册与热重载等能力面。

## 🧪 开发与验证

```bash
npm run build        # tsc 类型门 → scripts/bundle-client.mjs 合并 12 模块为单 combo
node smoke.test.mjs  # 202 断言 E2E（信标/adopt/隔离/SRS闭环/图谱算法确定性/
                     # 专项记忆 R-MEM/三布局/流动粒子/白盒三件套/题库管理 R-P-01..05 + 省份维度）
node render.test.mjs # 41 断言真实 React 18 + 真实 client.js 集成渲染（零 role=alert 降级）
```

ANIC 质量流程：`.cycles/`（intent→spec→plan→G0-G3 门禁→归档 15+ 循环；L4 全自主 + 人类门禁授权）。工程纪律与事故簿见 [CLAUDE.md](./CLAUDE.md)。

## ⚖️ 许可与免责

- 本插件代码：MIT。
- 题库数据：版权归各上游仓库及其作者所有，请遵循各自许可；**本插件不重新分发任何数据**。
- 仅供个人学习备考使用；题目答案与解析的准确性以上游仓库为准。
