# API 参考（v1.12.0 · 51 端点 · 与 src/shared/manifest.ts 逐条同步）

> 所有端点前缀：宿主通道 `/kaogong/api/*`，独立端口通道 `/api/*`（两侧都接受带前缀路径）。
> 隔离参数：`?ws=<workspace>`（缺省为 `default`；服务端 slug+sha1-8 命名空间分文件）。
> **本文件与 `src/shared/manifest.ts` CAPABILITIES.endpoints 必须同步**（能力对账以 manifest 为准，孤儿/漂移会被白盒面板点亮）。
> 错误约定：业务性失败返回 `{error: '…'}` 且 **HTTP 200**（UI 卡片级降级，绝不 5xx 冒泡）；仅基础设施异常才 500。

## 一、核心信标与统计（coreApi）

| 端点 | 方法 | 说明 | 主要返回 |
|---|---|---|---|
| `/api/status` | GET | 插件状态信标（client 通道发现依据：`app==='dsh-kaogong'`） | `{app, port, pid, uptimeSec, repos:{ready,total}, repoRoot, db, ws, progress}` |
| `/api/stats` | GET | 学习统计 | `{days[14], streak, mastery{}, wrong:{open,mastered}, day, answered, correct, rate}` |
| `/api/progress` | GET/POST | 进度读/写（day 夹取 1..30；reset 清空答题域但保留 wrongBook 之外字段） | 进度对象 |
| `/api/workspaces` | GET | 命名空间清单（可观测面板消费） | `{workspaces:[{ns,day,answered,rate,lastActive,label}]}` |

## 二、抽题 / 判分 / 错题本 SRS（srsApi）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/questions?module=&count=` | GET | 随机抽题（xingcezhenti 目录解析） |
| `/api/questions?module=&count=&sort=srs` | GET | SRS 调度：未掌握错题按 lastAt 最久先回炉；无错题按模块弱点加权 `1/(rate+0.15)` |
| `/api/check` | POST | 判分 + 落进度 + 错题钩子；体 `{question:<完整题对象含 correctAnswer>, answer:'A', label?}` → `{isCorrect, correctAnswer, analysis, wrongEvent, progress}` |
| `/api/wrong?module=` | GET | 错题清单（五箱：box 1..5；mastered=box≥3∧连对2；300 环形淘汰） |
| `/api/wrong/remove` | POST | 按 `{sig}` 移除 |
| `/api/memory` | GET/POST | **专项刷题记忆**（v1.10）：`progress.memory[kind]`；POST 体 `{kind, data}`，kind 白名单 `^[a-z][a-z0-9-]{0,31}$`、data ≤8KB、12-kind LRU；消费方=practice/tuxing/deep 三专项视图（进入读横幅「上次练到 xx」，翻题静默回写，一键跳回**原题对象**） |

## 三、真题卷 / 专题 / 申论（paperApi）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/papers?subject=&exam=&year=&province=&q=` | GET | 试卷列表（**1683 套**：申论 944/行测 739）+ subjects/provinces facet（≥35 省，码点升序；索引 v2 + 磁盘快照 + 分块预热） |
| `/api/paper?id=` | GET | 单卷详情：给定材料分段 + 题目（分值/要求）+ 参考答案；配图已改写为端点 URL |
| `/api/topics` | GET | 专题树（channels[xingce/shenlun] + topics + entries 统一练习路由 `{view, params}`） |
| `/api/essay/list?type=&limit=` | GET | 申论题目聚合（五类题型） |
| `/api/essay/grade` | POST | 小题离线评分：要点覆盖 50%/结构 20%/字数 15%/语言 15% → `{score,max,dims,hitTerms,missingTerms,feedback}` |
| `/api/essay/article` | POST | 大作文：字数五档 + 结构要素 + 论证标志 → `{lengthBand,lengthPenalty,elements,…}` |
| `/api/essay/history` | GET | 申论历史 + avgRatio（dashboard/obs 消费） |
| `/api/paper/exam/start?id=` | GET | 整卷模考开始（**不下发答案防作弊**） |
| `/api/paper/exam/submit` | POST | 服务端比对交卷 → 模块得分分布 + 错题清单 |
| `/api/paper/exam/history` | GET | 模考历史 + avgRate |
| `/api/paper-img?id=&p=` | GET | **二进制**：试卷配图（基准目录=dirname(paperId)） |

## 四、深度题库（naokuApi · GongkaoNaoku 27506 题五维标注）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/naoku/status` | GET | 就绪状态 + 覆盖率 + 分布（node:sqlite 只读，动态 import） |
| `/api/naoku/questions?module=&category=&kadian=&count=` | GET | 抽题（五维标注 + 配图 markdown） |
| `/api/naoku/kadian?q=&limit=` | GET | 知识点检索（考点→思路） |
| `/api/naoku/practice?kadian=&count=` | GET | 按知识点刷题 |
| `/api/naoku/papers?category=` | GET | 考点→试卷反查 |
| `/api/naoku/categories` | GET | 考点清单 |
| `/api/naoku-img?p=` | GET | **二进制**：配图（webp 磁盘记 png 由 resolveNaokuImage 换扩展） |

五维字段：`kadian`考点定位(100%) · `reasoning`推理链(100%) · `fastest`最快解法(41%) · `pitfalls`易错点(41%) · `mother`母题思维(部分)。

## 五、图形推理（tuxingApi · gk-tuxing 354 题 13 规律）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/tuxing/cats` | GET | 规律分类（按题量排序） |
| `/api/tuxing/list?cat=&limit=` | GET | 抽题列表（含 ans/exp/acc/trap 四字段） |
| `/api/tuxing/q?id=` | GET | 单题详情 |
| `/api/tuxing-img?f=` | GET | **二进制**：题干图（354 张本地图） |

## 六、计划 / 检索 / 方法论（dataApi）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/plan?day=` | GET | 30 天四阶段计划（正则状态机解析 study-plan.md） |
| `/api/search?q=&repo=` | GET | 全文检索（DFS 限深 3 + 命中 15 早停） |
| `/api/method?topic=` | GET | 方法论正文（10 主题，kaogong-skill references） |
| `/api/methods` | GET | 方法论目录（含每主题 exists） |
| `/api/banks` · `/api/modules` | GET | 仓库就绪 / 模块题量索引 |

## 七、图谱与可观测（coreApi · 白盒链路）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/graph` | GET | 图谱快照（5s TTL **按 wsKey 分槽缓存**，v1.12 隔离修复）：`{nodes,edges,metrics{V,E,density,orphans,components},rank,health,banks,nodeMeta,edgeMeta,analytics{degree,degreeStats,communities,clustering,betweenness,layers},layout,progress}` |
| `/api/graph/neighborhood?node=&depth=1..3` | GET | k 跳邻域子图（未知节点→`{error}` 200） |
| `/api/graph/path?from=&to=` | GET | 无向 BFS 最短路（路径分析） |
| `/api/graph/impact?node=` | GET | 反向可达影响面 |
| `/api/lifecycle` | GET | 生命周期状态机：`{stages[{stage,desc,state,at}], events[≤50 倒序], current}`（lifecycle.jsonl 环形 300 合成） |
| `/api/telemetry` | GET | 遥测：`{uptimeSec,qpsWindow,totalRequests,endpoints{path:{count,errors,errRate,p50,p95,lastActive,series[≤100]}},coverage,histogram{p50..max},topSlow[10],alerts[]}`（**路径口径=相对挂载点逻辑路径**，v1.8 假阳性事故固化） |
| `/api/capabilities` | GET | 能力矩阵 + 对账：`{...CAPABILITIES, runtime, orphans, reconciliation{orphanEndpoints,orphanViews,unconsumedEndpoints,missingProducers}, lifecycle}` |

## 八、题库管理（repoManager · v1.11 一键式安装 · v1.12 增 self）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/repos` | GET | 总览：`{root, rootSource, mirror, git(bool 探测), self(SELF_META), repos[15]{key,tier,size,desc,upstream,present,isGit,files,job}, summary{total,present,requiredMissing,running,tiers}}` |
| `/api/repos/install` | POST | `{key}` → 无仓库 `git clone --depth 1`；有 `.git` `pull --ff-only`；非 git 目录拒绝覆盖；并发上限 2；镜像前缀自动拼接；**windowsHide 静默子进程**（v1.12 修控制台闪现） |
| `/api/repos/job?key=` | GET | 作业状态 `{state:running|done|failed|canceled, action, url, log[], elapsedSec, error}` |
| `/api/repos/cancel` | POST | SIGTERM 在途作业 |
| `/api/repos/remove` | POST | 删除本地数据目录（学习进度不受影响；作业中拒绝） |
| `/api/repos/browse?key=&sub=` | GET | 目录浏览（≤300 条目；`isInside` 路径穿越防线） |
| `/api/repos/config` | POST | `{root?, mirror?}` 持久化数据根/镜像（原子写 repos-config.json；root='' 回自动解析）；变更后域重建 + 三级缓存失效 |

数据根解析优先级：env `KG_REPOS_DIR` > `data/repos-config.json` > 开发态上级（含任一登记仓库）> `data/repos` 托管默认。

## 九、工具（host 半 · 5 个 · 均声明 output:{schema,render}）

| 工具 | 类 | 说明 |
|---|---|---|
| `kaogong_launch` | 离线 | 平台状态引导（v1.12：**全部字段实时取自 /api/status + /api/capabilities + /api/repos**，杜绝模板陈旧漂移；数据缺失时引导一键安装） |
| `kaogong_ai_tutor` | 可选 AI | 错题辅导素材（method + search） |
| `kaogong_ai_plan` | 可选 AI | 个性化建议素材（progress 弱项排序） |
| `kaogong_ai_shenlun` | 可选 AI | 申论批改素材（method + 题目 + 作答） |
| `kaogong_ai_essay_review` | 可选 AI | 深度点评：先调离线 grade/article 基线分再交模型；参数 `{paperId?, no?, question?, answer, mode?:'essay'|'article', workspace?}` |

## 十、视图清单（15）

`dashboard`仪表盘 · `practice`刷题 · `deepbank`深度题库 · `tuxing`图形推理 · `exam`模考 · `papers`真题卷 · `topics`专题 · `essay`申论 · `wrongbook`错题本 · `plan`计划 · `search`检索 · `method`方法论 · `graph`图谱 · `repos`题库管理 · `observability`可观测

一级导航七项（学习/题库/复盘/管理分组）：仪表盘/模考/真题卷/专题/错题本/图谱/可观测 + 题库管理；practice/deepbank/tuxing/essay 经专题枢纽分区触达，路由仍直达。
