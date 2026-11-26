---
title: 架构收敛基线（cycle-49 起 · cycle-61 v9 收口）
status: current
updated: 2026-11-26
---
# 架构收敛基线（cycle-49 起 · cycle-61 v9 收口）

> 目标：收敛为「只维护 `.kaogong.db` 统一数据库 + 统一检索层 + 优化适配层/内核层 + 统一前端组件化架构」。
> 本文是三域并行调研（数据层 / 检索内核层 / 前端架构）的**事实基线与收敛路线图**，后续每轮落地前先读本文。
> 权威依据：`STORAGE-LAYER.md`（四层依赖 + 六不变量）、`research/26-统一架构数学模型v9.md`（六层模型）、
> `research/27-数据层库表设计v9.md`（逐表设计）、`unified-storage-architecture.md`、`15-全局整合分析.md`。

---

## v9 收口状态（cycle-61 · 2026-11-26）

**一句话**：六层已全部收敛，`npm run build` + `npm run test:all`（**49 文件 / 401 断言**）全绿；
运行期外源直读已**物理删除**（不是门控跳过）。

| 层 | 状态 | 核心落点 | 关键不变量 |
|---|---|---|---|
| 数据层 | ✅ 完成 | `shared/storage.ts` + `adapters/poolDb.ts`（schema v9 / 26 表）+ `shared/domains.ts` | I-DB-1 运行期零外源 IO |
| 数据门 | ✅ 完成 | `server/dataGate.ts`（按域就绪 + single-flight + 后台/sync 双模式） | 就绪失败不回落外源 |
| 检索层 | ✅ 完成 | `server/searchRegistry.ts`（单查/聚合 + provider 域归属） | I-SEARCH-1/2 |
| 缓存层 | ✅ 完成 | `server/cache.ts`（键空间 + 快照 + 失效图 + 命中率）+ `server/dataEvents.ts` | I-CACHE-1/2 |
| 取题层 | ✅ 完成 | `shared/kernel.ts`（quotaPlan/weightedPickIndex/moduleWeakness） | 配额守恒 + 让渡 |
| 错题补录层 | ✅ 完成 | `server/reviewStore.ts`（库权威 + JSON 镜像 + 诊断分桶） | I-REVIEW-1 |
| 前端 | ✅ 完成 | `client/view-registry.ts`（视图元数据单一事实源）+ 白盒两卡 | I-VIEW-1 |

**v9 由模型直接推出的 10 个真实缺陷**（详见研究 26 §4）：六条回落分支、新列索引致整库降级、
失效图漏两域、单查缺 provider、空结果被缓存、ctx 键名漂移致 pool 恒空、配额不守恒、
单侧删除、镜像列清单落后、导航三处漂移。**全部修复并固化守卫。**

**仍未完成（诚实登记）**：
1. 生产库 `~/.dsh/kaogong/.kaogong.db` 数据仍是旧版（cf 污染 80 行 / 图延 925 / paper 0）——
   代码已就绪，`fresh` 门会提示重建；本轮按需摄入已实测把 paper 从 0 灌到 1683 卷。
2. `paper` 域首次摄入实测 149s（1683 卷 md）→ 设计为后台模式（前端轮询 `/api/data-domains`），
   前端轮询 UI 尚未做成自动重试（当前需用户刷新或点重载）。
3. 维护性：8 个文件仍 >800 行（复杂度均在预算内）；10 处手写 cancelled effect 未迁移。

---

## 0. 一句话现状（cycle-49 原文，保留为历史）

> 目标架构在 cycle-34/35 **已大部分落地**（.kaogong.db 统一池 / 10 摄入源 / FTS5 检索 / 四层依赖 + 六不变量守卫），
> 剩余工作是**消除三类残留**：① 运行期外源直读（多套检索/多个 DB 并存）；② 内核算法散落与参数漂移；③ 前端组件/状态/页面冗余。
>
> **v9 已消除这三类残留**（见上表）。

---

## 1. 数据层（只维护 .kaogong.db）

### 1.1 现状（实测）
| DB | 位置 | 内容 | 状态 |
|---|---|---|---|
| `.kaogong.db` | `~/.dsh/kaogong/` | 86534 题 / 230083 出处 / 571394 边 / 9721 知识 / schema v5 | **统一池（目标事实源）** |
| `.naoku.db` | 包内 + 用户根各一份 | 27506 题 / 58890 appearances | 上游投影，运行期仍被 `/api/naoku/*` 直查 |
| `.paper-index.json` / `.huasheng13-index.json` | 包内 `data/` | 卷索引 / 语料索引快照 | 构建期产物，运行期读 |

### 1.2b 管理数据入池（cycle-60 · schema v6）
- `wrong_book` 表（ws+sig 主键）：错题管理全字段（SRS 五箱/掌握态/出处快照/材料），索引 `(ws,mastered,last_at)` 支撑 SRS 回炉。
- `user_kv` 表（ws+domain+k 主键）：刷题进度/专项记忆/模考/申论/补录台账等域对象 JSON 存放，新增管理域**零 DDL 扩展**。
- 两表**故意不进 `POOL_TABLES`**——rebuild「原地清库」只清 POOL_TABLES，用户态永不丢失。
- 双写边界 = `saveProgress`（唯一 choke point）：progress.json 仍是读侧权威，镜像失败静默；切读是独立决策（带迁移），本轮不偷偷改读路径（研究 15 C7 阶段 2 口径）。
- ws 是第一隔离维度（R20 跨租户污染防线）：所有主键/索引以 ws 开头。守卫 C60-05 + MGMT-01..04。

### 1.2 摄入管线（已成型，勿重造）
- 编排：`poolIngest.ts:39-93 rebuildPool()` → `ingestAll()` → `rebuildFts()` → `produceUsesMethodEdges()`。
- 注册表：`poolSources.ts:85-172`（**10 源**，可扩展枢纽，新增源零改主流程）。
- 已入池 10/16 源；未入池：AdministrativeAptitudeTest（PDF，决策只做 L1 登记）、kaogongzhentizhengliu（疑被 naoku 覆盖）、sakib/developer2gwy 等纯文档仓（只登记 asset）。
- 潜在 bug：`incrementalRebuild`（`poolIngest.ts:99-114`）指纹用 `.naoku.db` mtime，meta 指纹却是「题数:关系数」（`:82-83`）→ 增量几乎永不命中。

### 1.3 运行期直读外源残留（收敛优先级）
**P0 题目消费只走 .kaogong.db**
- `repoData.ts:189-218 getRandomQuestions`：池优先 + 目录回落（`/api/questions` 与 SRS 仍走此）→ 直接调 `poolApi.sampleQuestions`，删目录回落。
- `historyApi.ts:68`：故意不传 pool → 必定直读目录；`:81-113` 真题卷逐卷扫描。
- `naokuApi.ts:45-92`：6 端点直查 `.naoku.db` → 改查池。**⚠️ cycle-54 实测阻塞：换源不等价，见下「naoku 换源取证」。**

### naoku 换源取证（cycle-54/55 · 两轮实测修正，勿再凭直觉迁移）
实测两库（用户数据根 `.naoku.db` / `.kaogong.db`，2026-11-23）：
| 指标 | `.naoku.db` | `.kaogong.db` |
|---|---|---|
| 题目总数 | 27506（qid 全唯一） | naoku 主行 26525 / 带 naoku 出处 26590 |
| `kadian LIKE '%图形推理%'` 题数 | 1895 | 925（任何 source 过滤口径都是 925） |
| `kadian LIKE '%图形推理%'` 聚合频数和（top10） | 89 | 40 |

**两轮取证的修正过程（诚实留档，防再犯）**：
- cycle-54 初判「916 题摄入缺口、既不在主表也无出处」——**该结论错误**。验证方法有缺陷：用 `question_source.local_key=qid` 精确匹配得到 0 缺失（误以为全在池），而按 `canonical_id='q:'+qid` 查却又缺失 916——两种口径矛盾。
- cycle-55 精确追踪样本（qid 12100998 等）后确认真相：**916 题都在池里**，canonical_id 就是 `q:<qid>`，但 `source_id=xingcezhenti`（被另一源先占主行）且 `kadian` 为空；同时 naoku 内部同题姊妹条（如 q:11367796）带完整 kadian，通过 content_fp 归并到了**另一条** canonical。
- 即核心问题不是「题丢了」，而是 **① 同题多 canonical + ② 富字段（kadian/五维）回填打到姊妹条而非 xingcezhenti 主行**——`poolSourceImpls.ts:171-187` 的 naoku 归并回填 UPDATE 目标是 `mergeTarget`（cf 命中的 naoku 姊妹 canonical），不会回头补 xingcezhenti 主行。

**cycle-55 找到真正根因并修复（数据完整性 bug）**：
- 根因 = `poolSourceImpls.ts` 的 xingcezhenti `insQ.run` **末两参数顺序写反**：QUESTION_COLS 末两列是 `updated_at, content_fp`，原写成 `cfp, new Date().toISOString()` → xingcezhenti 全量题的 `content_fp` 变成时间戳字符串（实测 `q:12100998` 的 content_fp = `"2026-11-21T04:14:48.004Z"`）→ content_fp 去重/跨源归并/富字段回填全面失效。
- 修复①：`src/adapters/poolSourceImpls.ts:380` 参数顺序改为 `new Date().toISOString(), cfp`（与 naoku L204 对齐）；全局排查确认仅此一处错位。
- 修复②：`src/adapters/poolUpsert.ts` 新增 `backfillContentFpFamilies(db)`——摄入完成后按 content_fp 家族把富字段并集回填到组内每行（只填空位、幂等计数），接入 `rebuildPool` 且在 FTS 重建之前；解决"富源先到、主行后到"时序下逐源回填打偏。内存副本实测：修复前 kadian 命中 1 行→回填后 2 行，二次回填 0 改动（幂等）。
- 守卫：`kgdb.test.mjs` KGDB-10（参数顺序）/ KGDB-11（回填接入+幂等计数）。

**cycle-56 隔离 rebuild 实测（第三次修正，完整数据链，最终结论）**：
在隔离数据根（复制 `.naoku.db` + 源仓库）跑全量 rebuild，得到：
- `content_fp 时间戳数 = 0`（参数顺序修复**确实生效**，不再污染）
- `enrichedRows = 0`（家族回填未触发——因为 content_fp 修复后各题指纹已独立，无"同 cf 多 canonical"）
- naoku 摄入日志 `insert=26525 merge=981 rows=27506`；kadian 图形推理 pool=925
- **决定性证据**：上游 naoku 的 1895 条"图形推理"题按归一 stem 分组仅 **545 个唯一题干**，其中 146 组重复、1350 行冗余；同组题 stem 相同但 kadian**完全不同**（如 q:10204454「部分数」与 q:10204458「位置规律-平移」同 stem）。

**最终根因（推翻前三轮判断）**：图推题题干是通用模板（"从所给四个选项…"），不同图/不同考点的题**文本完全相同**。`contentFingerprint` 只归一文本（不含图），把这些**不同题错误归并为同题**——正是 `poolDb.ts:371-374` 纪律②「图推合成行禁用 cf 合并」描述的风险，但 naoku 真实 stem 路径未受该保护。
**结论**：kadian 1895→925 不是"数据丢失"也不是"正常去重"，而是 **cf 过度合并吞掉了不同考点题**——是真实数据缺陷。
**真正前置条件**：给 `contentFingerprint` 增加图/考点维度（或对 kadian 不同的同 stem 题禁用 cf 合并），让不同考点的图推题保留为独立题。在此之前 `/api/naoku/*` 换源不等价（会丢 970 个不同考点的题），维持现状。
**cycle-57 修复完成并实测通过（最终结论）**：
- **根因**：`contentFingerprint` 的 norm 用 `<[^>]+>` 把 `<img src>` 整标签剥掉 → 图推题通用题干 + 不同图（内容寻址文件名不同）剥完后文本相同 → 不同考点题被误并。
- **修复**：`poolDb.ts:378 contentFingerprint` 剥 HTML 前先提取 img src 的**内容寻址文件名主体（去扩展名）**作为区分因子附在指纹后——同图跨源（路径/扩展名不同）文件名主体一致仍可合并；不同图文件名不同→不误并。沿用项目「剥 HTML 必须保留 img 语义」纪律（CLAUDE.md cycle-22）。
- **隔离 rebuild 实测（最终证据）**：
  | 指标 | 修复前 | 修复后 |
  |---|---|---|
  | naoku 摄入 merge（误并次数） | 981 | **9** |
  | kadian 图形推理题数 | 925 | **1895**（= 上游原始，零丢失） |
  | 样本 q:10204454 / q:10204458 | 只留一条 | 两条均保留、kadian 各自完整 |
- 单元验证：不同图指纹不同 ✓、同图跨源（不同路径+扩展名）指纹相同 ✓。
- 守卫：KGDB-12（img 区分因子）/ KGDB-13（实测数字留档）。

**结论**：统一数据层 cf 过度合并缺陷已修复，**naoku 换源的数据完整性前置条件已满足**（kadian 零丢失）。`/api/naoku/*` 迁 `.kaogong.db` 已可行——留待下一轮实施（注意：当前用户库仍是旧数据，需 rebuild 后生效）。

**cycle-60 R2 实施（Gate 控制换源，勿再凭直觉强切）**：
- `poolHealth.freshness` 三指标门：schema≥6 ∧ `content_fp` 无时间戳污染 ∧ kadian 图形推理≥1895×99%（cycle-57 隔离实测基线）。生产库实测 v5/80 污染行/925 图推 → `ready=false`，强切会丢 970 个不同考点题。
- `src/server/poolNaoku.ts` 统一读层：所有查询强制 `source_id='naoku'` 保持口径；`poolRowToNaoku` 字段映射（options/answer→correctAnswer/五维/images/material/id 前缀/source 真实源名）。
- `naokuApi` 六端点按 `isPoolFresh()` 每次请求派生切源：fresh → `.kaogong.db`（响应带 `sourceTier:'pool'`），否则回落 `.naoku.db`。**rebuild 后自动生效，无需改代码**。
- 教训：换源不等价时不要「要么全切要么不动」——用可观测的 freshness 门做渐进切换，既消除外源直读（fresh 后），又不牺牲旧库用户的数据完整性。

### cycle-59 管理数据量化口径修正（数据库设计合理性）
`studyEventStats`（学习事件白盒统计）按考点正确率旧用 `SUM(is_correct)/COUNT(*)`，但 `is_correct` 以 NULL 表示"无判定"——SUM 忽略 NULL、COUNT(*) 计入 → **正确率被系统性低估**（实测 1 对 1 错 1 无判定：正确显示 50%，旧口径显示 33%）。修正为 `SUM(is_correct)/COUNT(is_correct)` 同口径，并透出 `judged/skipped` 让白盒看清排除量；保留 `count` 兼容别名。守卫 KGDB-14 固化。
前三轮「916 摄入缺口 / 富字段回填打偏 / content_fp 错位是本因」的判断均已在上方诚实留档并标注被推翻——最终以本节实测为准。

**P1 真题卷/方法论换源**
- `paperApi.ts:85-288` + `topicTree.ts:65-106` + `paperData.ts:220-246`：卷级元数据（provinces facet/frontmatter/材料/图片路径/答案）尚未完整入池——这是最大阻塞项，需先补摄入。
- `tuxingApi.ts:15-41`：gk-tuxing 354 行已在池。
- `dataApi.ts:39-42`：/api/search /api/method 直读 md → 池 FTS + knowledge 表。
- `methodologyApi.ts:220-260,420-440,758-769`：huasheng13 25 篇正文已入池（超 64KB 截断待核）。

**P2 元数据/图片/快照**
- banks/modules/status.db 改读 source/asset 表；4 图片端点改从 asset.rel_path 解析（L3 BLOB 不做是既定决策）；包内快照改到用户数据根。

**非目标**：progress.json / lifecycle.jsonl / repos-config.json（用户态/控制面）、study-plan.md（静态模板）——不入池。

---

## 2. 统一检索层

### 2.1 五套检索并存（形态各异）
| 端点 | 算法 | 数据源 | 证据 |
|---|---|---|---|
| `/api/search` | DFS 子串匹配，无打分 | 三仓 md 直读 | `repoData.ts:222-254` |
| `/api/pool/search` | FTS5 trigram + bm25 + 跨源去重轮转 | .kaogong.db | `poolApi.ts:320-410` |
| `/api/huasheng13/search` | BM25 字段加权 + 只裁尾 + confidence | 语料 index | `methodologyApi.ts:548-629` |
| `/api/naoku/kadian` | SQL LIKE 聚合计数 | .naoku.db | `naoku.ts:184-193` |
| `/api/history/search` | 三通道串联（DB→目录→逐卷） | 混合 | `historyApi.ts:45-115` |

### 2.2 收敛策略（不统一算法，统一信封）
- **不要合并打分算法**：BM25 字段权重/snippets/confidence 与 FTS5 bm25 语义不同，强行合并丢信息。
- **统一输出信封**：`{ query, results, total, took, confidence? }`；hit 外壳 `{ id, source, title, snippet, score?, meta }`。
- **以 pool/search 为收敛点**：已具备跨源 + canonical_id 去重 + 源轮转。
- **抽象范式已有先例**：`SourceSpec` 注册表（`poolSources.ts:54-75`）→ 检索层缺对应物 `SearchProvider`。
- ✅ cycle-49：`shared/types.ts` 已补 `SearchHit` / `SearchEnvelope` / `SearchProvider` 契约（只统一信封/hit 外壳，不统一打分算法）。运行时注册表（SearchProvider registry）留待 cycle-51。
- ✅ cycle-58：`NativeSearchView` 接入第三源 `/api/pool/search`（FTS5 trigram 跨源去重），成为「md 三库 / 花生十三 BM25 / 统一池」三源统一入口；三源映射为统一 `{file,snippet}` 行，不混用打分。manifest `/api/pool/search` consumers 补 `ui:search`（同源）。守卫 C58-01。
- ✅ **cycle-60 运行时注册表已落地**：`src/server/searchRegistry.ts`（createSearchRegistry）把五检索源注册为 provider（pool / huasheng13 / docs / kadian / history），**id/label 从 manifest 端点声明派生**（单一事实源，未声明端点拒绝注册）；新增 `/api/search/unified?provider=&q=&limit=` 统一信封 `{query,results,total,took?,confidence?}` + 外壳 `{id,source,title,snippet,score?,meta?}`，源特有字段（confidence/coverage/sources/rotation/matchSource/kadian count）全进 meta 无损透出。**旧五端点零删改、零算法复制**（STORAGE-LAYER §8 兼容硬约束）。守卫 C60-01/02 + search-registry 单测 4 例。客户端三分支（C58-01）暂保持，后续可逐步改走统一端点，不做「一家算法吞并三家」。

---

## 3. 内核层

### 3.1 现状：散落且漂移
- 无 `src/shared/kernel/` 目录；算法散在 `manifest.ts:424-910`（图族）、`srs.ts`、`planSchedule.ts`、`telemetry.ts`。
- **真实漂移**：客户端 `graph-analytics.ts:80-102 graphLocalPageRank` iter=**24**，服务端 `manifest.ts:424 pageRank` iter=**40**——同一图两侧中心性不同。
- **重复代码**：`percentile` 在 `telemetry.ts:67-70` 与 `methodologyApi.ts:84-88` 逐字重复（注释自称「同口径」）。
- **守卫盲区**：`tests/smoke/kernel.test.mjs:33-35 KERNEL_FILES` 硬编码 6 文件，**持有全部图算法的 manifest.ts 不在清单内**；R9 正则只匹配 Native/Kaogong 前缀，`Obs13HeatBar`（obs-view.tsx:659 直调纯函数）不受覆盖。

### 3.2 收敛策略与进度
- ✅ `src/shared/kernel.ts` 已建（cycle-49）：统一 percentile / PageRank / 弱点模型 `1/(rate+0.15)` / kgNum/kgClamp01/round2/round4，零 IO。
- ✅ manifest.pageRank 改为 kernel re-export；telemetry/methodologyApi 的 percentile 去重（telemetry 保留 re-export 兼容）。
- ✅ 客户端 PageRank 迭代数 24→40 对齐（`KG_LOCAL_PAGERANK_ITER` 常量镜像 + 守卫 07 断言一致）。
  - ⚠️ 物理共享未完成：combo bundler 只扫 `dist/client/**`（cycle-24），客户端无法值导入 shared/kernel；
    **后续 cycle 若扩展 bundler 支持跨目录值导入，须把客户端镜像常量改为真 import**（守卫 07 会随之调整）。
- ✅ 内核文件清单外提（KERNEL_FS_FREE_FILES/I2 分层，manifest 因含仓库名字面量只进 I1），新增守卫 07/08。
- ✅ cycle-50（第二轮）：弱点公式三处（srs.ts / planSchedule.ts / poolApi.ts）统一走 `weaknessWeight()`；
  **业务先验差异保留在调用侧**（srs 抽题无数据 rate=0.5 中性；排程与池抽题 rate=0 新模块优先）
  ——公式单一事实源 ≠ 抹平业务语义差异。守卫 KERNEL-09 固化。
- ✅ cycle-50（第二轮）：增量重建指纹口径统一（rebuild 写 `.naoku.db mtimeMs` 到 `source_fingerprint`，
  incremental 读同款比对；旧「题数:边数」改存 `pool_size` 供白盒展示）——根治"增量永不命中"静默全量重建 bug。守卫 KERNEL-10 固化。
- ✅ cycle-60：环形缓冲 helper 统一——`kernel.ringPush/ringTrim` 收口 telemetry（LAT_RING/requests）与 methodologyApi（recent/lat）四处手写 shift/splice（守卫 KERNEL-11）。
- ✅ **cycle-60 R5 客户端真共享 kernel**：bundler 白名单 `EXTRA_MODULES=['shared/kernel']` + 多段 `../` import + `moduleId` 集合分类；`graph-analytics.ts` 删镜像算法体改真 import `kernel.pageRank`（阻尼系数/迭代数/算法体不再有第二份）。combo 从 22 → 23 模块，`shared/kernel` 位于拓扑序正确位置。守卫 KERNEL-07 重写（禁镜像循环/D=0.85 复辟）+ KERNEL-SHARE 运行时深相等 + 7 render 旅程。

---

## 4. 前端组件化

### 4.1 现状
- 路由：`VIEW_ROUTES`（client.tsx:136-165）+ setView tick 重入修复 + 统一 onGo（cycle-49）；符合规范。
- DSH 合规：combo factory / inject+apply / sidebar 双注册 / onClick 驼峰 / ErrorBoundary / 子视图组件化**全部合规**。
- 组件基建：`ui-kit.tsx`（298 行）Stat/Bar/Card/RichText/OptionRow/KgLoad/KgErr/KgEmpty 齐备；`hooks/useApiData`（**0 调用**）+ `useApiMany`（仅 1 处）。
- 架构债：13 处手写 `cancelled` effect；20+ 处手写加载/错误/空态未复用基建；5 个视图 >800 行（papers 1188 / obs 1154 / study 1090 / hs13 1012 / graph 954）。
- ✅ cycle-52：localStorage 6 处直读（3 文件）已收敛到 `ui-kit.tsx` 的 `kgStorage` 门面（唯一事实源，3 操作全带 try/catch）；守卫 C52-01 断言客户端零直读（门面除外）。

### 4.2 页面冗余评估
- ✅ **cycle-60 已融合**：exam 路由改为 papers + `initialMode:'answer'` 深链别名（消除两套 start/submit/倒计时/报告重复实现），NativeExamView 本体保留在 papers-view 作兼容导出；NAV/QUICK「模考」入口不变（仍指 exam 键）；papers-view 收 `initialPaperId` 深链 props。守卫 SMOKE-N-01b / C59-B0 / RENDER-PP-59 全旅程（选卷→直入 answer→倒计时→交卷→报告）。
- **（历史）可融合评估**：exam ≈ papers 的 answer 模式（两套 start/submit/倒计时/报告几乎逐字重复：papers-view.tsx:51/66/37/95 vs 250/262/243/467）→ 已按此收敛；**须同波次改 NAV_GROUPS + papers-journey.test 锚点**（教训④）。
- **⚠️ cycle-60 事故·模块级 `void Component` 破坏 combo 桥接**：为了「显式持有引用避免 noUnusedLocals」在 client.tsx 顶层加 `void NativeExamView`，bundler 把该语句留在 factory **外**（模块桥 `__kgR` 在 factory 内定义）→ `NativeExamView is not defined` → **7 个 render 旅程全崩**（R11 家族新形态：不是裸 ESM，而是「模块作用域引用 bridged 变量」）。正解：删除顶层 void，直接从 import 列表移除未用组件（本体仍在 papers-view 导出、`__kgM` 登记）；守卫断言 `!cl.includes('void NativeExamView')`。**教训：combo 里所有跨模块变量的引用必须在 factory 内；顶层语句只能放纯声明/注释。**
- **抽公共组件**：search / pool 检索三套输入+结果卡 → SearchPanel。
- **保留**：method（轻量查阅，ghost-journey GHOST-46c 锚定）/ huasheng13（体系主区）、plan（30 天日历，与 dashboard 不重叠）、observability（开发者面板，独立 render 域）。

### 4.3 hooks 缺陷（部分修复）
- ✅ cycle-54：`useApiMany` 已加 `pathsKey = JSON.stringify(paths 的 key/path/fallbackNull)` 并纳入 effect 依赖——消除「stale data（paths 内容变但 deps 不变不重取）」与「内联新数组每次渲染无限重取」两难。守卫 C54-01 固化。
- `useApiData` 无需改：path 是 string 基本类型，已在 `[path, ...deps]` 依赖里（值比较安全）。
- 待做：13 处手写 cancelled effect 逐视图迁移到这两个 hook（每批 test:all 兜底；注意早退必须在 hooks 后 C24-2）。

---

## 5. 分阶段路线图

| 轮次 | 内容 | 风险 |
|---|---|---|
| cycle-49（本轮·已完成） | 研究固化 + 内核确定性收敛（percentile 去重 / PageRank 参数统一 / 守卫清单外提）+ 检索类型契约。**已落地**：`src/shared/kernel.ts`（pageRank/percentile/弱点模型单一事实源）、manifest re-export、telemetry/methodologyApi 去重、客户端 PageRank 24→40 对齐、kernel.test 加 07/08 守卫、types.ts 检索契约。验证：build 全绿 + test:all 287/287 + Loader 17/17 | 低 |
| cycle-50（第二轮·部分完成） | 弱点公式三处收敛 + 增量重建指纹 bug 修复（守卫 09/10）。**待续**：P0 数据层抽题/补录/naoku 端点改走 .kaogong.db；消除 .naoku.db 运行期直查 | 中高 |
| cycle-58（第八轮·部分完成） | 知识检索页三源统一入口（md/hs13/pool，守卫 C58-01）。**待续**：SearchProvider 注册表化（当前视图内分支，收益需权衡） | 中 |
| cycle-52（第三轮·部分完成） | kgStorage 门面已落地（6 处 localStorage 直读收敛到 ui-kit 唯一门面，修复视图偏好初始化无 try/catch 崩溃点；守卫 C52-01/02）。三态复用已落地：papers-view 9 处手写加载/错误/空态→KgLoad/KgErr/KgEmpty（守卫 C52-03，补 C44 盲区）。**待续**：其余视图三态 + hooks 迁移 | 中 |
| cycle-54（第五轮·部分完成） | useApiMany pathsKey 依赖修复（消除 stale data / 无限重取两难，守卫 C54-01）。**待续**：13 处手写 cancelled effect 逐视图迁移 | 中 |
| cycle-53 | 页面融合：exam→papers answer 深链（同波次改测试锚点） | 高 |
| cycle-54 | 大文件拆分（cycle-13 固定拆法）+ 摄入元数据补齐（P1 真题卷入池） | 高 |

每轮闭环：`npm run build` + `npm run test:all`（Loader 17 + vitest 全绿）。
