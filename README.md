# dsh-kaogong — 考公备考一键式学习平台 · v1.7

> 整合 15 个考公开源仓库 → **DSH 宿主内原生界面**：左栏「考公学习」全屏面板 + 右侧 Sidebar 并排标签（引导页亦有入口）。
> 完全离线可用（零模型依赖、零 npm 依赖）；**AI 为可选增强**：5 个工具中 `kaogong_ai_essay_review` 可把「离线基线分 + 方法论」交模型做深度点评。
> **v1.7 新增**：深度标注题库（27506 题五维标注）、整卷模考、大作文分档评估、题目配图、可选模型深度点评。

## 双通道架构（v1.4 核心）

| 通道 | 路径 | 说明 |
|------|------|------|
| 🏠 **宿主同源**（主） | `ctx.webServer` → `/kaogong/*` | UI/API 走 DSH GUI 同源端口：零 CORS、无端口依赖；左栏面板为**原生 React 渲染**（非 iframe） |
| 🔌 独立端口（兜底） | `127.0.0.1:8400-8404` | Electron（无 webServer）/ 挂载失败自动回退；信标发现 + adopt 复用 |

## 快速开始

```bash
# 安装（DSH 宿主内）
plugin_manager install_bundle D:/Projects/TraeProjects/kaogong/dsh-kaogong
```

安装即生效：
1. **Host** 挂载宿主同源路由 `/kaogong/*`（+ 兜底独立端口自动启动）
2. **Client** 注册双入口：左栏面板图标（`sidebar.panellist` + `main`）+ 右侧标签（`sidebarRightTabs` + guide）
3. 刷新 DSH Web GUI → 点左栏 📚 图标 → **原生全屏学习面板**（仪表盘/刷题/错题本/图谱/可观测）

独立运行（无 DSH）：`node -e "import('./src/server/http.js').then(m=>m.startServer(8400))"` → http://127.0.0.1:8400

## 视图能力

| 视图 | 能力 |
|------|------|
| 📊 仪表盘 | 仓库就绪/答题/正确率/模块掌握度（正确率×置信）/14日趋势线/30日热力/🔥streak |
| 🧠 **深度题库** | **27506 题五维标注**（考点定位/解题推理链/最快解法/易错点/母题思维）+ 知识点检索 + 含图 10647 题 |
| ⏱ **整卷模考** | 选卷 → 限时倒计时（行测 120min）→ 逐题作答 → 交卷 → **模块得分分布 + 错题清单**（答案不下发防作弊） |
| ✏️ 刷题 | SRS 智能（错题回炉+弱点加权）/键盘流 A-D·Enter·N/单题计时/连击/toast |
| 📚 **真题卷** | **1683 套卷库**（申论 944 / 行测 739，2008-2026）：科目/年份筛选 → 详情（给定材料分段 + 题目 + 分值 + 作答要求 + 参考答案折叠 + **题目配图**） |
| 🎯 **专题** | 科目专题（年份跨度/题量）+ 申论五类题型（概括/分析/对策/应用文/大作文） |
| ✍️ **申论** | 按题型选题 → **材料阅读区** → 作答 → 离线评分（小题四维/大作文分档）→ 采分点命中/遗漏诊断 |
| 📕 错题本 | 五箱 SRS：答错降箱收集→回炉升箱→箱≥3连对2=掌握；签名去重；300 环形 |
| 📅 计划 | 30 天四阶段日历 + 进度日滑杆 |
| 🔍 检索 | 15 仓库全文检索（DFS 限深早停） |
| 📖 方法论 | 10 主题参考（kaogong-skill 实战方法论） |
| 🕸️ 图谱 | Canvas 力导向交互图（拖拽/缩放/拾取）+ PageRank/密度/连通分量/健康度 |
| 📡 可观测 | 生命周期状态机·端点 p50/p95/QPS·能力矩阵对账·命名空间清单 |

### 申论评改样例（离线，无需模型）
| 作答质量 | 得分（满分20） | 要点覆盖 | 结构 |
|---|---|---|---|
| 全覆盖 + 分条作答 | **18.8** | 100% | 80% |
| 部分要点 | 6.9 | 0% | 59% |
| 口语化敷衍 | 5.3 | 0% | 42% |

## 分层架构（复杂度预算驱动）

```
src/
├── shared/manifest.js    # 能力单一事实源 + 图算法(PageRank/Union-Find/健康度加权)
├── adapters/repoData.js  # 外部数据源适配层（15仓库只读隔离）
├── server/
│   ├── http.js           # 路由分发 + 信标 + 遥测 + 图谱 + 崩溃安全启动 + attachWebRoute
│   ├── ws.js             # 工作区隔离命名空间域（slug+sha1 分文件）
│   ├── srs.js            # 错题本五箱调度 + 统计域
│   └── dataApi.js        # 只读数据查询域（banks/plan/search/method）
├── host/index.js         # Cordis Host 半：webServer 同源挂载(主) + 端口兜底 + 4 AI 工具
├── client/client.js      # Cordis Client 半：双入口 + 宿主原生 React 面板 + 通道探测
└── ui/ (index.html+app.css)  # 零依赖 SPA（同源路由页；服务端内联 CSS）
locale/{zh,en}.json       # DSH 插件规范 i18n 位置
data/                     # progress/<slug>-<hash8>.json · runtime.json · lifecycle.jsonl
```

### 关键机制
- **崩溃安全**（cycle-0）：startServer async；listen 错误 Promise 受控回传；adopt/端口降级。
- **热重载竞态防线**（R7）：本代资源闭包局部持有，cleanup 只清自己那代；重复注册 600ms 重试。
- **信标发现**：`/api/status.app === 'dsh-kaogong'` 自证身份；client 探测顺序 = 同源 → 8400-8404。
- **工作区隔离**：`?ws=<路径>` → `slug+sha1-8` 命名空间分文件；smoke 独立端口段 + publishRuntime=false 自清理。

## AI 增强（可选，需模型）
`kaogong_launch` · `kaogong_ai_tutor` · `kaogong_ai_plan` · `kaogong_ai_shenlun` — 素材供模型加工模式，离线核心与之解耦。

## 开发验证

```bash
npm run build        # 语法门 ×8
node smoke.test.mjs  # 40 断言 E2E（信标/adopt/隔离/图谱/遥测/崩溃安全/SRS闭环/同源路由/UI契约）
```

ANIC 质量流程：`.cycles/`（intent→spec(S1-S8)→plan→门禁 G0-G3 全绿→归档 cycle-1/1-dualentry/2/3；L4 人授权；自举 CONVERGED；举他 sourceUntouched 证明）。技术债：`.cycles/tech-debt/backlog.md`。事故簿：`CLAUDE.md`。

## 数据源（15 仓库，均在上级目录）
xingcezhenti(515套58890题) · kaogongzhentizhengliu(22375篇笔记) · GongkaoNaoku(SM-2引擎) · AdministrativeAptitudeTest · NovaForge · kaogong-skill · sakib · developer2gwy · gwy-zhenti · Exam_Database · qiuzhao-epi-bank · xingce-app · gk-tuxing · civil-exam-agent · yunduanqiqu
