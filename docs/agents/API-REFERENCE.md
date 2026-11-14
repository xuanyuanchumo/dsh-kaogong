# API 参考（v1.15.0 · 60 端点 · 与 src/shared/manifest.ts 逐条同步）

> 所有端点前缀：宿主通道 `/kaogong/api/*`，独立端口通道 `/api/*`（两侧都接受带前缀路径）。
> 隔离参数：`?ws=<workspace>`（缺省为 `default`；服务端 slug+sha1-8 命名空间分文件）。
> **本文件与 `src/shared/manifest.ts` CAPABILITIES.endpoints 必须同步**（能力对账以 manifest 为准，孤儿/漂移会被白盒面板点亮）。
> 错误约定：业务性失败返回 `{error: '…'}` 且 **HTTP 200**（UI 卡片级降级，绝不 5xx 冒泡）；仅基础设施异常才 500。
> 计数基线：`CAPABILITIES.endpoints = 60`、`tools = 6`、`views = 16`、`REPOS_META = 16`（导入 manifest 实测；cycles 旧文档里的 51/5/15 已过期）。

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

## 六、计划 / 检索 / 方法论（dataApi · 外部仓库）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/plan?day=` | GET | 30 天四阶段计划（正则状态机解析 study-plan.md） |
| `/api/search?q=&repo=` | GET | 全文检索（DFS 限深 3 + 命中 15 早停） |
| `/api/method?topic=` | GET | 方法论正文（10 主题，**kaogong-skill** references） |
| `/api/methods` | GET | 方法论目录（含每主题 exists） |
| `/api/banks` · `/api/modules` | GET | 仓库就绪 / 模块题量索引 |

> `/api/method*` 属外部 kaogong-skill 仓库（v1.13 起 tier=recommended，UI 退到专题「📖 方法论 → 另见」折叠区）。
> **不要与本文件 §七 的 `/api/huasheng13/*` 混淆**：后者是花生十三体系适配库，数据源是必选仓库 `huasheng13`。

## 七、花生十三体系方法论（methodologyApi · cycle-18 · 6 端点）

> 实现：`src/server/methodologyApi.ts`；适配层：`src/adapters/huasheng13.ts`。
> 域链位置：`handleApi` **最前**（`methodologyApi.handle(...) ?? srsApi(...)`，见 `src/server/http.ts:392-399`）。
> 语料**不随包**：位于 `<数据根>/huasheng13/{references,examples}`，由「📦 题库管理」安装必选包 huasheng13（336KB）。
> 路径口径：以下均为**相对挂载点**的逻辑路径，绝不带 `/kaogong` 前缀（v1.8 白盒假阳性事故根因；smoke HS13-02/HS13-10 双重守卫）。
> 方法：全部仅 GET；非 GET 返回 `{error:'方法论端点仅支持 GET（收到 X）'}` 且 HTTP 200。
> 未知子路径不属本域（`handle` 返回 undefined 交给下游/未匹配桶），不会 5xx。

| 端点 | 参数 | 主要返回 | 错误/降级 |
|---|---|---|---|
| `/api/huasheng13/catalog` | `refresh=1`（可选，强制重扫语料重建索引） | `{meta, modules[], strategy[], examples[]}`；`meta` 含 `id/label/version/upstream/attestation/docCount/declaredByAdapter/available/missingCount/missing/builtAt/indexedAt/indexSource/buildMs/fixtureHash/degraded/error/root/dirMismatch/orphans`；每篇文档含 `file/title/desc/chars/tables/formulas/sections/present` | 语料缺失：`meta.degraded=true`、`available=0`、`declaredByAdapter=25`、`error` 指引导航安装；六模块骨架仍返回（逐篇 `present:false`、统计 0） |
| `/api/huasheng13/doc` | `file=<id>`（必填；id 不带目录/`.md`；取 basename 防路径穿越） | `{file,title,moduleId,kind,desc,markdown,chars,tables,formulas,sections[],sectionCount,weight,path,degraded:false}`；`weight = 1 + log(1+formulas) + log(1+tables)`（四舍五入 2 位） | 缺参数 → `{error:'缺少 file 参数',hint,known[]}`；未知 file → `{error:'未知语料文件: X',file,known[]}`；文件缺失 → `{error,file,title,moduleId,degraded:true}`；解析异常 → `{error,file,degraded:true}`。全部 HTTP 200 |
| `/api/huasheng13/search` | `q=`（空 → `{results:[]}`，不计入 hit 率）、`limit=`（默认 10，夹紧 1..30） | `{query,took,limit,total,rawTotal,filtered,confidence:'high'|'medium'|'low',coverage,phraseHit,results[{file,title,score,highlight,snippets[],terms[],moduleId,kind,weight}]}`；必要时附 `note`/`error`/`degraded` | 语料缺失 → `{results:[],degraded:true,error}`，计 miss；检索抛错 → `{error:'检索失败：…',degraded:true}`；低置信度**不丢弃**，附 `note` |
| `/api/huasheng13/coverage` | `refresh=1`（可选） | `{modules[{id,label,icon,color,weight,targetMinutes,targetQuestions,docCount,presentDocs,examples,tables,formulas,chars,coverage,dims{formula,table,example},expectedDims,presentDims,missing[],files[]}], overall, gaps[], expectedDims, presentDims, adapterGaps[], degraded}`；`overall = ΣpresentDims/ΣexpectedDims`（全局比率，当前真实值 **0.9756 = 40/41**，不是模块算术平均） | 语料缺失 → `overall:0`、`degraded:true`、`gaps` 含 `no-corpus`；计算异常 → 附 `error` |
| `/api/huasheng13/practice` | `file=<id>`（必填）、`n=`（本次抽取上限，默认 5，夹紧 1..50） | `{file,title,moduleId,total,n,returned,hasMore,items[{index,title,heading,level,category,stem,options[{key,text}],analysis,answer,answerIsLetter,pitfalls,startLine,endLine}],degraded:false}`；`total` 是文件总题数，`n` 不是 | 缺参数/未知 file 同上（附 `known[]`）；文件缺失 → `{items:[],total:0,degraded:true,error}`；无「## 练习 N」块 → `note` 说明（分类标题不计单题） |
| `/api/huasheng13/trace` | 无（按 `?ws=` 分槽） | `{ws,endpoints{6 路径:{hits,p50,p95,lastAt,samples}},searches{total,hit,miss,empty,hitRate},docs{reads{file:count},distinct},recent[≤20],ring{recentCap,recentLen,latCap,slotsCap,slots},declaration{endpoints[{path,declared}],allDeclared,declaredTotal},corpus{root,rootRel,dirPresent,snapshot,snapshotPresent,indexed,degraded,builtAt,source,buildMs,error},at}` | 本域异常全部收敛为 `{error,path,degraded:true}`；计数真实（环形缓冲 200），**禁止伪造**；跨 ws 分槽互不污染（HS13-09） |

### 7.1 `degraded` 语义（与「题库未安装」区分）

| 场景 | `degraded` | 说明 |
|---|---|---|
| 数据根下没有 `huasheng13` | `true` | 6 端点全部诚实降级；`error` 明确指向「📦 题库管理」安装 huasheng13；不崩、不返回假内容 |
| 25 篇中缺若干篇 | `true` | `missing[]` 列出缺失文件；`available < docCount`；`error` 给出前 5 个文件名 |
| 25 篇齐全 | `false` | `available=25`；`dirMismatch=[]`（zhenti-shili 已按 references 声明）；`orphans=[]` |
| 题库（其它 15 仓）一个都没装 | **不是 degraded** | 本域与题库数据无关；只要 huasheng13 在，照常返回 25 篇 |

- 降级索引每 3s 重试（`IDX_DEGRADED_RETRY_MS`），语料后补/安装完成后**无需重启**即可自愈。
- `declaredByAdapter=25` 是适配层声明规模常量（不撒谎）；`docCount=25` 是 META 展平条数；磁盘可用性看 `available`。
- 覆盖矩阵的 `dims` 是维度适用性：`changshi`（不考公式、无练习）只计 2 维、`shenlun`（不考公式）计 2 维；因此 `overall=0.9756=40/41`，`yanyu 0.889` 是**真实缺口**（yanyu-zhuanxiang 缺公式），不是缺陷。

## 八、图谱与可观测（coreApi · 白盒链路）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/graph` | GET | 图谱快照（5s TTL **按 wsKey 分槽缓存**，v1.12 隔离修复）：`{nodes,edges,metrics{V,E,density,orphans,components},rank,health,banks,nodeMeta,edgeMeta,analytics{degree,degreeStats,communities,clustering,betweenness,layers},layout,progress}` |
| `/api/graph/neighborhood?node=&depth=1..3` | GET | k 跳邻域子图（未知节点→`{error}` 200） |
| `/api/graph/path?from=&to=` | GET | 无向 BFS 最短路（路径分析） |
| `/api/graph/impact?node=` | GET | 反向可达影响面 |
| `/api/lifecycle` | GET | 生命周期状态机：`{stages[{stage,desc,state,at,cumMs?}], events[≤50 倒序], current, bootMs?}`（lifecycle.jsonl 环形 300 合成；**v1.14** 增每阶段 `cumMs`=启动后到达耗时、顶层 `bootMs`=本次启动耗时，可选字段缺失即 UI 徽章降级） |
| `/api/telemetry` | GET | 遥测：`{uptimeSec,qpsWindow,totalRequests,endpoints{path:{count,errors,errRate,p50,p95,lastActive,series[≤100]}},unmatched,coverage,histogram{p50..max},topSlow[10],alerts[]}`（**路径口径=相对挂载点逻辑路径**，v1.8 假阳性事故固化） |
| `/api/capabilities` | GET | 能力矩阵 + 对账：`{...CAPABILITIES, runtime, orphans, reconciliation{orphanEndpoints,orphanViews,unconsumedEndpoints,missingProducers}, lifecycle}`（**v1.14**：对账消费集排除 UI 壳 `/`、`/index.html` 与 `__unmatched__` 桶——壳路径不再产生假漂移） |

## 九、题库管理（repoManager · v1.11 一键式安装 · v1.12 增 self · v1.13 16 仓库）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/repos` | GET | 总览：`{root, rootSource, mirror, git(bool 探测), self(SELF_META), repos[16]{key,tier,size,desc,upstream,present,isGit,files,job}, summary{total,present,requiredMissing,running,tiers}}`；**无 builtin 字段**（统一管理） |
> **cycle-20 字段增补**：`/api/repos` 增 `previousRoot`/`previousRootRepos`（旧根快照，G4）、`diskFreeMB`（可用空间，null=不可探测）、`recentJobs`（最近 5 条作业）、`summary.health{ok,empty,half-clone,no-git,absent}`（健康巡检）；每仓库增 `health`（健康态词表）与 `lastCommitAt`（最近更新时间戳，null=不可读）。
| `/api/repos/install` | POST | `{key}` → 无仓库 `git clone --depth 1`；有 `.git` `pull --ff-only`；非 git 目录拒绝覆盖；并发上限 2；镜像前缀自动拼接；**windowsHide 静默子进程**（v1.12 修控制台闪现）。装 huasheng13 后方法论域 3s 内自愈 |
| `/api/repos/job?key=` | GET | 作业状态 `{state:running|done|failed|canceled, action, url, log[], elapsedSec, error}` |
| `/api/repos/cancel` | POST | SIGTERM 在途作业 |
| `/api/repos/remove` | POST | 删除本地数据目录（学习进度不受影响；作业中拒绝；删除 huasheng13 → 方法论端点回到 degraded） |
| `/api/repos/browse?key=&sub=` | GET | 目录浏览（≤300 条目；`isInside` 路径穿越防线） |
| `/api/repos/config` | POST | `{root?, mirror?}` 持久化数据根/镜像（原子写 repos-config.json；root='' 回自动解析）；变更后域重建（含 methodologyApi）+ 三级缓存失效 |
| `/api/repos/install-batch` | POST | **cycle-20**：一键批量安装（缺省=全部必选；服务端队列化，并发 2，完成即补位）→ `{ok, batchId, batch}` |
| `/api/repos/batch?id=` | GET | 批量安装批次进度 → `{batch:{id,state,items[{key,state,error}],done,total}}` |
| `/api/repos/jobs?limit=` | GET | 作业归档（环形 20）→ `{total, jobs[{key,action,state,error,elapsedSec,logTail}]}` |

数据根解析优先级：env `KG_REPOS_DIR` > repos-config.json > 开发态上级（含任一登记仓库）> `<用户数据根>/repos` 托管默认。
分级：**必选 3**（huasheng13 336KB / xingcezhenti 341MB / gk-tuxing 19MB）、**推荐 3**（kaogong-skill 3MB / gwy-zhenti 626MB / GongkaoNaoku 120MB）、**可选 10**（体积见 `/api/repos` 面板分级列表，不在文档写死合计值）。

## 九b、数据位置白盒与纸质补录（v1.16 · cycle-21）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/data-location` | GET | **数据位置白盒**（issue #2 可观测闭环）→ `{userDataRoot, source, reposRoot:{root,source}, migratedMark, pkgResidual[], migration:{status:'not-needed'\|'migrated'\|'already-migrated'\|'failed', movedCount, failedItem?}}` |
| `/api/history/search?q=&module=&limit=` | GET | **补录候选搜索**（issue #3）：naoku DB LIKE 全量 + xingcezhenti 目录兜底 → `{keyword, list[{...题对象, contentSig, matchSource}]}` |
| `/api/history/entries` | POST | **补录写入**：`{entries:[{contentSig\|question, result:'right'\|'wrong'\|'unknown', userAnswer?, source?, happenedAt?}]}` → `{batchId, accepted, acceptedItems, conflicts[], rejected[]}`；错题自动进错题本（box=1, historical=true, fromImport=批次） |
| `/api/history/undo` | POST | **批次撤销**：`{batchId}` → `{undone, removedHistory, removedWrong}`；只回滚 import 条目，在线作答历史不动 |
| `/api/history/batches` | GET | 补录台账 → `{batches[{batchId,at,count,source}], importedTotal, undoWindow:30}` |
| `/api/kg-img?p=` | GET | **xingcezhenti 题图服务**（issue #1 + cycle-22）：`kgimg://` 中立占位的二进制端点；安全模型同 `/api/naoku-img`（resolve 前缀 + 扩展名白名单，越级 403）。**cycle-22 扩展名探测回退**：原样未命中 → basename 换扩展名重探（DB 记 `.webp` 磁盘是 `.png` 的深度题库内联图可服务） |

**统计隔离口径（补录语义）**：import 条目（`source:'import'`）不进 `/api/stats` 的 days/byModule/answered/streak（历史归历史，不污染今日打卡），但错题进入 wrongBook 参与 SRS 回炉；`stats.importedTotal` 单独透出。幂等：`importedSigs[sig]=batchId` 台账防重复计数；同批内重复=冲突提示。

**题图占位协议**：`parseQuestions` 不再剥 `<img>`——转中立占位 `【图:kgimg://<相对 xingcezhenti 路径>】`（落盘数据与端口/挂载点无关，升级/换挂载不失效）；前端 RichText 渲染时改写为 `${MOUNT_PATH}/api/kg-img?p=`。资料分析等「根据上图」题的**材料块图**按「最近前置材料段」归属附给题干（1479 个含图材料块全库覆盖）。

**cycle-22 深度题库占位化（专题-判断推理无图修复）**：`adapters/naoku.ts` 的 `stripHtmlKeepImg`/`neutralizeImages` 与 repoData 同模板——选项（1406 题含图）、解析（8294 题含图）、五维标注（reasoning/fastest/pitfalls/mother）的内联 `<img>` 全部转 `kgimg://` 占位；客户端 `OptionRow`/深度题库选项行/模考选项行检测占位后走 RichText 渲染出图；manifest 已补登记 `/api/kg-img`（consumers=practice/deepbank/topics）。

## 十、工具（host 半 · 6 个 · 均声明 output:{schema,render}）

| 工具 | 类 | 说明 |
|---|---|---|
| `kaogong_launch` | 离线 | 平台状态引导（v1.12：**全部字段实时取自 /api/status + /api/capabilities + /api/repos**，杜绝模板陈旧漂移；数据缺失时引导一键安装） |
| `kaogong_ai_tutor` | 可选 AI | 错题辅导素材（method + search + **huasheng13/search/doc**） |
| `kaogong_ai_plan` | 可选 AI | 个性化建议素材（progress 弱项排序） |
| `kaogong_ai_shenlun` | 可选 AI | 申论批改素材（method + 题目 + 作答 + **huasheng13/doc**） |
| `kaogong_ai_essay_review` | 可选 AI | 深度点评：先调离线 grade/article 基线分再交模型；参数 `{paperId?, no?, question?, answer, mode?:'essay'|'article', workspace?}` |
| `kaogong_ai_method` | 可选 AI | **v1.13 新增**：花生十三体系方法论检索；消费 `/api/huasheng13/search` + `/doc` + `/coverage`（不依赖题库安装检查，但仍需数据根已装 huasheng13） |
| （全体工具） | 输出契约 | **v1.14**：六工具输出统一「正文 + 尾部标记行」`[kaogong vX.Y.Z · 服务:up|down · ws:<ns>]`（`kgMarkTail`，版本锚/服务态/隔离键三要素；dsh-ops host-contract 卡片模式落地） |
| （全体工具） | UI 展示契约 | **v1.26（cycle-29 命令窗口根治）**：六工具统一接入宿主 `presentCall`/`presentResult`（`kgToolCard` 工厂）——待执行卡 = 语义化标题（图标+模块名）+ 参数摘要行（workspace 隔离键不进正文）；完成卡 = 正文首个非标题行截 140 字。两投影纯函数（must be total，异常收敛 undefined 保留宿主兜底；smoke C29-02 守卫）。未声明时宿主回退 generic 卡（title=工具名、raw args 平铺 = 用户感知的「命令窗口」） |

## 十·b、图谱查询端点（v1.26 cycle-29 UI 消费闭环）

| 端点 | 入参 | 响应 | UI 消费 |
|---|---|---|---|
| `/api/graph/neighborhood` | `node`, `depth`(1-3) | `{center,depth,nodes[],edges[],stats}`（error 时 200+`{error}`） | 详情抽屉「🕸 1跳/2跳邻域」按钮 → `loadSubgraph` → 引擎换源子图渲染 + 面包屑 |
| `/api/graph/impact` | `node` | `{node,dependents[],count}`（只有 id 集） | 抽屉「⚡ 影响面」→ 客户端按 `nodeIndex` 派生节点/边子图（`graphDeriveImpact`）→ 面包屑显示反向可达计数 |
| `/api/graph/path` | `from`, `to` | `{found,path[],length}` | 既有路径分析（v1.8，未变） |

**子图模式契约（v1.26）**：`activeNodes/activeEdges` 是 `createGraphEngine` 唯一数据源——子图/全图同一装配路径零分支（C28 教训推广）；统计面板/图例**保持全图口径**（subData 不参与 metrics），面包屑明示口径防止「数字对不上」假漂移感知；「← 返回全图」置空 subData 即恢复。实现：`src/client/graph/graph-subgraph.ts`（fetch/normalize/derive 三纯函数，cycle-13 教训①固定拆法）+ `src/server/graphQuery.ts`（graphSnapshot 参数注入外提）。

## 十一、视图清单（16）

`dashboard`仪表盘 · `practice`刷题 · `deepbank`深度题库 · `tuxing`图形推理 · `exam`模考 · `papers`真题卷 · `topics`专题 · `essay`申论 · `wrongbook`错题本 · `plan`计划 · `search`检索 · `method`方法论 · **`huasheng13`花生十三体系** · `graph`图谱 · `repos`题库管理 · `observability`可观测

**导航口径（v1.13）**：一级导航**不新增**方法论入口。用户路径 = `🎯 专题` → `📖 方法论` 分区（`data-kg-hub-tab="method"`）→ 分区主视图 `data-kg-hs13-root="1"`；底部为默认折叠的「另见：kaogong-skill 十主题 + 母题精选」。
`practice`/`deepbank`/`tuxing`/`essay`/`huasheng13` 均收敛在专题枢纽分区触达，路由深链仍直达（`setView('huasheng13')` 保留）。