# dsh-kaogong — 考公备考整合插件（DSH 宿主原生面板）· v1.13.0

> **一句话**：把 16 个优秀开源考公仓库整合为 DeepSeek Harness（DSH）宿主内的原生学习平台 ——
> 刷题 / 错题本 SRS / 真题卷 / 整卷模考 / 申论评改 / **花生十三方法论** / 知识图谱 / 白盒可观测，完全离线可用。
>
> **重要说明（安装前必读）**：本插件是**整合与可视化层，npm 包不含题库与方法论语料**。
> 16 个数据仓库各有独立上游作者，体积各异（见「📦 题库管理」分级列表），不适合随包分发。
> 安装插件后打开「📦 题库管理」视图 → **一键安装必选包**（`huasheng13` / `xingcezhenti` / `gk-tuxing`）→ 全部核心功能即刻可用。
> 支持自定义数据目录、GitHub 镜像代理（国内网络加速）、分级下载（必选/推荐/可选）避免一次拉取过大。

## ✨ 核心特性

| | |
|---|---|
| 🏠 **宿主原生** | DSH Web GUI 双入口：左栏「考公学习」全屏沉浸面板 + 右侧 Sidebar 并排标签；同源路由零 CORS，非 iframe |
| 📦 **一键式题库管理**（v1.11） | 必选/推荐/可选三级分装 · git 浅克隆/更新/删除 · 目录浏览 · 自定义数据根 · 镜像代理（gh-proxy 等）· 作业实时日志 · **「关于本项目」GitHub/Release/Issue/npm 跳转**（v1.12） |
| 🔒 **跨项目隔离**（v1.12） | 进度/记忆/图谱缓存全部按工作区命名空间分槽——不同项目使用本插件互不污染；Windows 静默子进程（无控制台闪现）；工具输出实时取自能力矩阵（无陈旧模板） |
| ✏️ **智能刷题** | 58,890 题行测真题 · 五箱 SRS 错题本（答错收集→回炉升箱→掌握）· 弱点加权抽题 · 键盘流 |
| 💾 **专项刷题记忆**（v1.10） | 进入刷题/图形推理/深度题库自动显示「上次练到 xx 的 xx 题」，一键跳回原题 |
| 📚 **真题卷 1,683 套** | 申论 944 / 行测 739（2008-2026）· 科目/省份/年份三维筛选 · 材料逐份折叠 · 题目配图 |
| ✍️ **申论离线评改** | 零模型规则引擎：采分点覆盖 50% + 结构 20% + 字数 15% + 语言 15%，附批改建议；大作文五档字数分档 |
| ⏱ **整卷模考** | 限时倒计时 · 服务端判分（答案不下发防作弊）· 模块得分分布 · 历史战绩 |
| 🧠 **深度题库** | 27,506 题五维标注（考点定位/推理链/最快解法/易错点/母题思维）· 10,647 题含图 |
| 📖 **花生十三体系方法论**（v1.13） | 25 篇六模块语料 · BM25 中文检索（bigram+单字）· 六模块覆盖矩阵（overall 0.9756，缺口如实暴露）· 74 题配套练习 · 白盒消费链路；语料走「📦 题库管理」安装必选包 `huasheng13`（336KB），**零大题库也能用** |
| 🕸️ **交互图谱** | Canvas 2D 力导向（FR 模型）· 三布局（力导向/分层/环形）· 边流动粒子 · 五档着色 · 小地图 · 路径分析 · 导出 PNG |
| 📡 **白盒可观测** | 生命周期状态机 · 能力对账（注册→生产→消费三态灯）· 端点性能表 · 延迟分位阶梯 · 吞吐×延迟四象限 · **方法论链路卡** · 诊断导出 |
| 🔌 **可选 AI 增强** | 6 个宿主工具（launch/tutor/plan/shenlun/essay_review/**method**）把离线基线分+方法论交模型深度点评；无模型时全部离线功能不受影响 |

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
3. 点「🚀 一键安装必选包」：`huasheng13`（方法论 336KB）+ `xingcezhenti`（行测真题 341MB）+ `gk-tuxing`（图形推理 19MB）
   —— 各仓库体积以面板分级列表为准，不再写死合计值
4. 装完即可刷题与查方法论；真题卷/模考/深度题库按需再装「推荐」级；其余素材装「可选」级

> 独立运行（无 DSH 宿主）：
> `node -e "import('dsh-kaogong/server').then(m=>m.startServer(8400))"` → http://127.0.0.1:8400

## 📖 花生十三体系方法论（v1.13）

用户路径：**🎯 专题 → 📖 方法论**（**不设独立一级导航**；分区锚点 `data-kg-hub-tab=method`）。

- **语料**：25 篇（20 references + 5 examples，336KB），上游 [huasheng13-skill](https://github.com/WangJunqing-coder/huasheng13-skill)。
  **不随 npm 包分发**：由「📦 题库管理」统一下载到 `<数据根>/huasheng13`，与其它题库同一条安装/更新/删除链路（无内置旁路）。
  未安装时 6 个端点诚实降级（`degraded:true` + 安装引导），装好后 3 秒内自愈、无需重启。
- **六模块覆盖**：资料分析 1 / 数量关系 1 / 言语理解 **0.889** / 判断推理 1 / 常识判断 1 / 申论 1，`overall = 0.9756`（40/41）。
  `yanyu` 的 0.889 是**真实缺口**（专项突破篇缺公式），不是缺陷；常识/申论不考公式，覆盖矩阵按 `dims` 不计公式维度（否则会假阴性）。
- **BM25 检索**：`k1=1.2, b=0.75`，字段加权 title×3 / heading×2 / body×1；中文用字符 bigram + 单字双粒度（零依赖）。
  服务端只做尾部裁剪（`score < max(1.0, top×0.15)`，永远保留首条）+ 三档 `confidence`（high/medium/low）+ `phraseHit`；低置信度结果**不丢弃**，靠提示让调用方判断。
- **74 题配套练习**：资料 10 / 数量 18 / 言语 15 / 判断 18 / 申论 13。其中 **32 题有字母答案可自动判分，42 题文字作答走「查看解析 + 自评」**（数量 18、申论 13、判断 8、资料 2、言语 1）——不臆造字母答案。
- **白盒链路**：`/api/huasheng13/trace` 输出真实端点命中/p50/p95/检索命中率/最近事件，`📖 方法论链路` 卡与图表面板同源消费。
- **入口结构**：分区主视图 = 花生十三体系（`data-kg-hs13-root`）；底部「▸ 另见：kaogong-skill 十主题 + 深度题库母题精选」默认折叠，明确标注其依赖外部仓库（`kaogong-skill` 已从必选降为**推荐**）。

> 适配库开发规范（25 篇清单 / 新增语料四步法 / 检索与覆盖口径 / 降级语义）见 [docs/agents/METHODOLOGY.md](./docs/agents/METHODOLOGY.md)。

## 🗂 数据根与题库管理（v1.11 核心）

**数据根解析优先级**（高→低）：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 环境变量 `KG_REPOS_DIR` | CI / 高级用户 |
| 2 | `data/repos-config.json` | 题库管理面板「保存根目录」写入 |
| 3 | 开发态上级目录 | 目录内含任一已登记题库仓库时自动识别 |
| 4 | `data/repos/`（托管默认） | npm 安装态，配合一键克隆 |

**题库分级**（16 仓库全量登记于 manifest `REPOS_META`，单一事实源；体积以面板分级列表为准）：

| 级 | 仓库 | 体积 | 支撑功能 |
|---|---|---|---|
| 必选 | huasheng13 | 336KB | 花生十三方法论 25 篇（方法论视图硬依赖） |
| 必选 | xingcezhenti | 341MB | 行测刷题（58,890 题） |
| 必选 | gk-tuxing | 19MB | 图形推理 354 题 |
| 推荐 | kaogong-skill | 3MB | 方法论 10 主题（专题「另见」折叠区，v1.13 降为推荐） |
| 推荐 | gwy-zhenti | 626MB | 真题卷 1,683 套 / 模考 / 申论评改 |
| 推荐 | GongkaoNaoku | 120MB | 深度题库 27,506 题五维标注 |
| 可选 | 其余 10 仓库 | 见面板分级列表 | 检索增强 / 笔记模板 / 面试素材等 |

**管理面板能力**：安装（浅克隆 `--depth 1`）· 更新（`pull --ff-only`）· 删除（仅清数据目录，学习进度不受影响）· 目录浏览 · 作业实时日志与取消 · 并发上限 2 · 非 git 目录保护（拒绝覆盖用户数据）· 路径穿越防线 · 安装/换根后 paperIndex/naoku/graphCache 三级缓存自动失效重建 · **「关于本项目」卡**（GitHub 仓库 / Release / Issue / npm / 上游致谢一键跳转 + 版本徽章，元数据单一事实源 `SELF_META`）。

## 🏗 架构

```
src/
├── shared/manifest.ts     # 能力单一事实源：端点/工具/视图/lifecycle + REPOS_META(16) + HUASHENG13_META(25 篇) + 图算法
├── adapters/              # 数据源适配层（16 仓库只读隔离）：repoData/paperData(索引v2+快照+分块预热)/naoku(node:sqlite)/tuxing/huasheng13(BM25+覆盖矩阵)/paperParse
├── server/
│   ├── dataRoot.ts        # 数据根四级解析 + repos-config 持久化（v1.11）
│   ├── repoManager.ts     # 题库管理域：git 作业/校验/镜像/浏览/删除（v1.11）
│   ├── methodologyApi.ts  # 花生十三体系方法论域 6 端点（v1.13）
│   ├── http.ts            # 路由分发(域链+异步管理域) + 信标 + 遥测 + 图谱 + 崩溃安全启动 + 同源挂载
│   ├── ws.ts / srs.ts     # 工作区命名空间隔离 / 错题本五箱 SRS + 专项记忆
│   └── paperApi / naokuApi / tuxingApi / dataApi / topicTree
├── host/index.ts          # Cordis Host 半：webServer 同源(主) + 端口兜底 + 6 AI/引导工具
├── client/                # Cordis Client 半（13 模块，构建期合并为宿主要求的单 combo）
│   ├── client.ts          # 双入口注册 + 视图分发 + 通道探测
│   ├── study-view / papers-view / graph-view+engine+physics+transition+canvas+analytics
│   ├── huasheng13-view    # 方法论视图（五分区，v1.13）
│   ├── obs-view           # 白盒管理面板
│   └── repos-view         # 题库管理面板（v1.11）
└── ui/                    # 零依赖 SPA 兜底页（独立端口通道）
```

**双通道**：宿主同源 `/kaogong/*`（主，零 CORS）→ 独立端口 `127.0.0.1:8400-8404`（兜底，信标发现 + adopt 复用）。

**关键机制**：崩溃安全（listen 错误 Promise 受控回传，绝不击杀宿主）· 热重载竞态防线（本代资源闭包持有）· 工作区隔离（`?ws=` → slug+sha1 分文件）· 零 npm 运行时依赖（Node 标准库 only）· 数据/代码分离（包内不携带题库与方法论语料）。

## 🙏 致敬上游（全部数据与成果归原作者）

本插件仅做整合、解析与可视化。题库数据与解题方法论来自以下开源仓库（排名不分先后，点击跳转原仓库）：

| 仓库 | 作者 | 内容 |
|---|---|---|
| [huasheng13-skill](https://github.com/WangJunqing-coder/huasheng13-skill) | [@WangJunqing-coder](https://github.com/WangJunqing-coder) | 花生十三体系方法论 25 篇（六模块 + 策略 + 练习） |
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
npm run build        # tsc 类型门 → scripts/bundle-client.mjs 合并 13 模块为单 combo
node smoke.test.mjs  # 262 断言 E2E（信标/adopt/隔离/SRS闭环/图谱算法确定性/
                     # 专项记忆 R-MEM/三布局/流动粒子/白盒三件套/题库管理 R-P-01..06/
                     # 方法论 HS13-01..10 六端点 + 降级语义 + 跨 ws 隔离）
node render.test.mjs # 50 断言真实 React 18 + 真实 client.js 集成渲染（零 role=alert 降级；
                     # 含 C18-01..08 方法论五分区 + 专题枢纽锚点 + 白盒链路卡）
```

ANIC 质量流程：`.cycles/`（intent→spec→plan→G0-G3 门禁→归档；L4 全自主 + 人类门禁授权）。工程纪律与事故簿见 [CLAUDE.md](./CLAUDE.md)，Agent 开发文档见 [docs/agents/](./docs/agents/)。

## ⚖️ 许可与免责

- 本插件代码：MIT。
- 题库数据与方法论语料：版权归各上游仓库及其作者所有，请遵循各自许可；**本插件不重新分发任何数据**。
- 方法论内容基于花生十三公开教学体系整理；速算方法（截位直除/415 份数/假设分配等）为公考培训行业通用方法，非独家版权。
- 仅供个人学习备考使用；题目答案与解析的准确性以上游仓库为准。