# dsh-kaogong 数据流向与交互业务图

> status: current · updated: 2026-11-21 · 适用版本：v1.31.0+（含 cycle-43 材料保真 / cycle-44 前端组件化）
>
> 本文回答两个问题：① 抽题是否已统一从 `.kaogong.db` 获取？② 前端是否全部经服务端与数据库交互？
> 结论先行：**是的，前端零直连文件系统（I4 守卫固化）；抽题主链路已池化，仅剩「真题卷整卷浏览」与「方法论原文」两个保留直读面（均为设计决策，见 §4）**。

---

## 1. 全局数据流（四层）

```
┌─────────────────────────────────────────────────────────────────────────┐
│  浏览器（React 18 原生面板 · src/client/**）                              │
│  双入口：左栏 panellist + main keyed slot · 右侧 sidebar.right.pane.tab   │
│  取数纪律（cycle-24 P0-1）：全部视图自治 fetch → api() 仅打 /kaogong/api/* │
│  ⛔ 客户端禁 fs 读（SMOKE-KERNEL-01 静态守卫）—— I4 内核边界              │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ 同源 fetch（ctx.webServer prefix /kaogong）
                                │ 独立端口 8400-8404 兜底（信标发现）
┌───────────────────────────────▼─────────────────────────────────────────┐
│  服务端域层（src/server/http.ts handleApi 总路由 + 各域 Api）             │
│  崩溃安全纪律：任何异常收敛 {error}（HTTP 200），不向路由层冒泡           │
│  遥测：recordRequest（未声明路径只进 __unmatched__ 桶）                   │
├───────────────┬───────────────┬───────────────┬─────────────────────────┤
│ 统一池域       │ 真题卷域       │ 深度题库域     │ 方法论域 / 数据域 / …   │
│ poolApi       │ paperApi      │ naokuApi      │ methodologyApi/dataApi  │
└───────┬───────┴───────┬───────┴───────┬───────┴───────────┬─────────────┘
        │               │               │                   │
┌───────▼───────┐ ┌─────▼──────┐ ┌──────▼──────┐ ┌──────────▼──────────┐
│ 存储层 L3      │ │ 适配层 L2   │ │ 适配层 L2   │ │ 适配层 L2           │
│ .kaogong.db   │ │ paperData  │ │ naoku(.db)  │ │ huasheng13 / repoData│
│ (自有派生物)   │ │ +paperParse│ │ 只读投影     │ │ (md 语料/知识文档)   │
└───────┬───────┘ └─────┬──────┘ └──────┬──────┘ └──────────┬──────────┘
        │ 摄入期          │               │                   │
┌───────▼────────────────▼───────────────▼───────────────────▼───────────┐
│  上游只读源（数据根 <root>/ = 16 个开源仓库，绝不写入）                    │
│  .naoku.db（上游投影）· gwy-zhenti md · xingcezhenti md · JSON 题库 …     │
│  图片：内容寻址文件（216,266 张）——按 rel_path 引用，不复制不进库         │
└─────────────────────────────────────────────────────────────────────────┘
```

**分层铁律**（`docs/agents/STORAGE-LAYER.md`）：
- `.naoku.db` = 上游投影（整库重建会冲掉自有表 → **禁写自有表**，只读打开）
- `.kaogong.db` = 项目自有派生物（可全量重建，位于**用户数据根** `~/.dsh/kaogong/`，升级换包不丢）
- 上游仓库只读；图片是引用不是 BLOB（L3 不做——cycle-34 事实基线）

---

## 2. 抽题链路（回答「是否统一走 .kaogong.db」）

### 2.1 练习/回炉主链路（已池化 ✅）

```
GET /api/questions?module=&count=&sort=srs
        │
        ├─ sort=srs → srs.srsQuestions()
        │     ├─ 错题本有未掌握 → progress.wrongBook 快照回炉（含 groupMaterial）
        │     └─ 无错题 → 弱点加权选模块 → getRandomQuestions(repoRoot, mod, count, pool)
        │
        └─ 默认 → http.ts → getRandomQuestions(..., domains.poolApi)
                    │
                    ├─ ① 存储层优先：pool.sampleQuestions()
                    │     SELECT ... FROM question（.kaogong.db）
                    │     四层确定性配额：
                    │       L0 材料组层（真组 2-8 员整组捞齐，内存索引快照 0.09ms）
                    │       L1 带图层（stem LIKE kgimg）
                    │       L2 五维层（reasoning/fastest/pitfalls）
                    │       L3 普通层（随机 rowid 采样）
                    │
                    ├─ ② 回落：目录解析 parseQuestions（池未就绪时的唯一数据源——
                    │     SMOKE-KERNEL-05 断言「池优先在前」；池就绪时零文件读）
                    │
                    └─ ③ 形状契约：poolRowToQuestion 与目录路径同形
                          （options{A:文本}/correctAnswer/kgimg:// 占位——客户端零感知）
```

**机器守卫**：SMOKE-KERNEL-05（存储层优先）/ 05b（池路径零 fs 读）。

### 2.2 各业务面的供数现状（本轮逐面核实）

| 业务面 | 端点 | 供数源 | 状态 |
|---|---|---|---|
| 专项刷题 / SRS 回炉 | `/api/questions` | `.kaogong.db`（池优先） | ✅ 已池化 |
| 统一检索 | `/api/pool/search` | `.kaogong.db` FTS5 trigram | ✅ 纯池 |
| 关系图谱 | `/api/pool/graph` `/api/pool/relations` | `.kaogong.db` relation 表 | ✅ 纯池 |
| 深度题库专项 | `/api/naoku/*` | `.naoku.db`（上游投影只读） | ⚠️ 独立库（见 §4） |
| 真题卷整卷/专题/模考 | `/api/paper*` | `loadPaper()` 直读 gwy-zhenti md | ⚠️ 直读（见 §4） |
| 方法论 | `/api/huasheng13/*` | 语料 md + BM25 索引快照 | ⚠️ 直读（语料本体，见 §4） |
| 知识搜索/方法参考 | `/api/search` `/api/method` | `searchKnowledge`/`getMethodRef` 直读 md | ⚠️ 直读 |
| 错题本/统计/记忆/补录 | `/api/wrong` `/api/stats` `/api/memory` `/api/history/*` | `progress/<ws>.json`（per-ws 隔离写路径） | ✅ 进度文件（自有数据） |

### 2.3 用户态数据（与题目数据分离）

- **写路径唯一面**：判分/进度/错题本/记忆/补录 → `loadProgress/saveProgress` 原子写 → 用户数据根 `~/.dsh/kaogong/progress/<slug>-<hash8>.json`
- 双写：`study_event` 流水进 `.kaogong.db`（统计快照仍以 progress 为权威——cycle-38 阶段 2 契约）
- 学习事件写入后 `invalidateStatsCache('review-write')` 失效统计快照

---

## 3. 摄入链路（数据如何进 .kaogong.db）

```
POST /api/pool/rebuild（桌面端走宿主端点——外部进程 EPERM）
        │
   poolIngest.rebuildPool(repoRoot, dataDir)
        │
   SOURCE_REGISTRY（注册表驱动，新增源零改主流程）
        ├─ naoku            .naoku.db 只读 → 27,506 题 + 五维 + 材料(✅cycle-43)
        ├─ xingcezhenti     md 目录 → 1,636 题
        ├─ xingce-app       JSON → 22,298 题（材料保真原范例）
        ├─ gk-tuxing        QDATA → 354 题
        ├─ qiuzhao / cea    JSON → 1,038 题
        ├─ gwy-zhenti       1683 卷 loadPaper → 89,254 题（含组材料）
        ├─ huasheng13       语料 → 9,685 知识节点
        └─ kadian / doc-assets
        │
   归一：canonical_id(qid/namespace) + content_fp 跨源去重合并
        · 归并 = 贡献合并（出处/解析版本/富字段回填含 group_material）
        · UPSERT「只填空位」；单源单事务（421s→秒级）
        │
   收尾：孤儿出处清理 → FTS rebuild → invalidateStatsCache('rebuild')
```

**池规模（本轮真实库实测）**：86,534 题 / 570,194 关系边 / 230,083 出处行；资料分析材料覆盖 naoku 3643 条 100%（修复前 0%）。

---

## 4. 保留直读面（有意设计，非遗漏）

| 直读面 | 为什么保留直读 | 未来池化路径 |
|---|---|---|
| **真题卷整卷浏览**（`loadPaper`） | 「整卷」是**文件级实体**：材料区+题目区+details 答案需要原文结构（标题层级/折叠），池的 question 行模型无卷结构；且已入池供检索与跨源比对 | 保持双轨：浏览走文件、检索/组题走池（现状即如此） |
| **方法论原文**（huasheng13 md + BM25） | 语料是文档不是题——索引快照 `.huasheng13-index.json` 已做缓存（fixtureHash 自动失效）；「方法论 ↔ 题」的关联已入池（USES_METHOD/REFERENCES_DOC 边） | 语料正文不入库符合「图片不进库」同族决策 |
| **知识搜索**（sakib/kaogong-skill） | 长尾文档检索，量小（DFS 限深 3+15 命中早停），池化收益低 | 低优先 |
| **深度题库专项**（naokuApi） | 走 `.naoku.db` 上游投影（不是文件系统），专用视图需要 kadian 检索等五维维度专用查询；与统一池同数据的另一视图 | 已是 DB 直查；是否并入池端点待评估 |

**架构结论**：前端 → 服务端 → 数据层的分层已完整成立，客户端不存在任何直连数据库/文件系统的路径；「统一池」承担跨源聚合与抽题主链路，文件直读仅剩「需要原文结构」的场景，属于**按数据形态选存储**的正确分工，不是未完成的迁移。

---

## 5. 端点 ↔ 视图消费矩阵（关键路径）

| 视图（client） | 主端点 | 数据落地 |
|---|---|---|
| 仪表盘 | `/api/stats` `/api/plan/schedule` | progress.json + plan 模板 |
| 刷题（practice） | `/api/questions` → `/api/check` | `.kaogong.db` ←→ progress.json |
| 错题本 | `/api/wrong` `/api/history/*` | progress.json |
| 深度题库 | `/api/naoku/*` `/api/pool/questions` | `.naoku.db` / `.kaogong.db` |
| 真题卷 | `/api/paper` `/api/paper-img` | gwy-zhenti md + 图片文件 |
| 图谱 | `/api/pool/graph` `/api/graph` | `.kaogong.db` relation / 遥测派生 |
| 白盒 | `/api/capabilities` `/api/telemetry` `/api/pool/status` | manifest（声明）× 运行态（遥测）× `.kaogong.db` |
| 题库管理 | `/api/repos*` | 数据根 git clone（作业队列 + 归档环形） |
| 方法论 | `/api/huasheng13/*` | 语料 md + 索引快照 |

---

## 6. 守卫清单（本文档口径的机器证据）

| 守卫 | 断言 |
|---|---|
| SMOKE-KERNEL-01 | 客户端禁 fs 读（I4） |
| SMOKE-KERNEL-05 / 05b | 抽题存储层优先 / 池路径零 fs 读 |
| SMOKE-KGDB-07 | node:sqlite 动态 import（禁顶层） |
| SMOKE-KGDB-07b | 上游投影库只读打开（readOnly:true） |
| SMOKE-MAT-01..05 | 材料保真（抽题带材料/组整体/回炉快照/摄入/错题三路） |
| SMOKE-PERF-01..04 | 统计快照缓存 / rowid 采样 / 单列索引 |
| C24-03 / C44-01..03 | client 分层 / 三态 chips 基建单一事实源 |

---

## 附录：cycle-45 性能审计结论（2026-11-21 · 真实库 86,534 题实测）

### 服务端基线（startServer 8498 端口实测，n=3-10 中位数）

| 业务面 | 端点 | 时延 | 状态 |
|---|---|---|---|
| 练习抽题 | `/api/questions?count=10` | 稳态 88ms（首查含快照首建 ~0.5s） | ✅ |
| 统一检索 | `/api/pool/search` | 18ms | ✅ |
| 深度题库抽题 | `/api/naoku/questions` | **12ms**（优化前 110ms，9 倍） | ✅ 本轮修复 |
| 真题卷列表 | `/api/papers` | 3.6ms | ✅ |
| 真题卷单卷 | `/api/paper` | 15ms | ✅ |
| 方法论目录/检索 | `/api/huasheng13/*` | 1.7/3.9ms | ✅ |
| 知识搜索 | `/api/search` | 138ms（DFS 直读，低频） | ⚠️ 可接受 |
| 错题本/统计/排程 | `/api/wrong` `/api/stats` `/api/plan/schedule` | 0.9/0.9/2.5ms | ✅ |
| 能力对账 | `/api/capabilities` | 5.8ms | ✅ |

### 本轮性能修复（cycle-45）

1. **naokuQuestions 无过滤路径**：`ORDER BY RANDOM()` 在 27,506 行宽表 = 91.7ms（全表物化排序）→ 随机 rowid 起点补捞 0.1ms；带 WHERE 子集保留 RANDOM（1.7ms）。**110ms → 12ms**
2. **poolDb schema v5**：`ix_q_mat` 部分索引（`WHERE group_material != ''`）——L0 材料组快照首建 735ms → 281ms（稳态 0.09ms 不变）。三条纪律：查询 WHERE 蕴含索引 WHERE / 索引列含查询所需列 / 排序放内存。
3. **显式收口**：L1 带图层 31.5ms（stem LIKE 固有成本）经四方案对比后**保留现状**（收益 ≤30ms/请求 vs 首建+一致性复杂度）。

### 前端审计（bundle 598KB · 524K 字符）

- **体积分布**：huasheng13-view 68KB / graph-view 66KB / question-kit 62KB；注释占 ~9%（bundler 铁律不删中文注释；本地文件体积非运行时成本，宿主同源加载无 gzip 也 <1MB 一次性）
- **render 热点**：papers-view 24 个 `.map` 渲染点、56 useState——但真题卷列表**服务端已截断 200 条**（listPapers `slice(0,200)` + total 全量口径，㊼ 纪律），渲染成本 ≤200 行 ≈ 4ms，无虚拟滚动必要
- **池化状态**（更新 §2.2）：前端零直连不变；抽题主链路池化不变；本轮验证「保留直读面」四项收益/复杂度比后**维持现状**（理由已固化 CLAUDE.md cycle-45 段）
