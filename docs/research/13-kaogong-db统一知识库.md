---
title: 13 · `.kaogong.db`：把「散落各源的题库」收敛成「一张可查询的知识库」
status: current
updated: 2026-11-26
---
# 13 · `.kaogong.db`：把「散落各源的题库」收敛成「一张可查询的知识库」

> dsh-kaogong 研究文档 · cycle-35 · 架构升级：新建项目自有数据库
> 配套设计契约：[../design/unified-storage-architecture.md](../design/unified-storage-architecture.md)
> 状态：**研究已定，尚未实施**
> 📌 **本篇是整体的一环，实施须按 [15-全局整合分析.md](./15-全局整合分析.md) 的统一主线走。**
> 统一口径：canonical_id 以 **qid 优先** · 存储层名 **`.kaogong.db`** · 阶段编号 **阶段 0-4**（不再用各篇自定的 S/P/K 编号）。

## 1. 数学与模型定义

### 1.1 问题陈述

现状是「**多源各自为政**」：16 个第三方仓库各自有格式、各自有解析器、各自有取数入口，
题、解析、图、五维标注、材料、出处散落在各处，彼此**不能联合查询**。

目标是把「题目 + 关系 + 更多内容」收敛为**一个项目自有数据库**：

```
.kaogong.db  =  统一题目池（pool）
             ⊕ 关系层（relations）
             ⊕ 资产层（assets / media）
             ⊕ 派生索引层（fts）
             ⊕ 用户态层（progress / wrongbook / study）
```

### 1.2 关系的形式化

「关系」统一为**二部图上的边**，边带类型与证据：

```
Edge = (src_kind, src_id, rel_type, dst_kind, dst_id, weight, evidence)

rel_type ∈ {
  SAME_AS     同一道题的跨源等价      （qid 命中 100% / fp 命中）
  APPEARS_IN  题 → 试卷出处            （appearances 58890 条）
  BELONGS_TO  题 → 知识点(kadian)      （27506 条，10552 个不同 kadian）
  IN_MODULE   题 → 模块/题型            （6 模块 / 25 细分题型）
  HAS_MATERIAL 题 → 共享材料             （materials 1578 条 / material_ref 7315）
  RELATED_TO  题 → 题（同类/衍生）       （related 7922 条）
  HAS_DOUBT   题 → 疑点                 （doubt 1577 条）
  DERIVED_FROM 题 → 母题                 （mother 11282 条）
  SAME_REGION 题 → 地区/年份             （36 地区 / 19 年份）
  REVIEWED    题 → 人工校验              （review_verified 53 条）
}
```

**关键设计**：`relation` 表用**统一边表**而非为每种关系建表——
理由是关系种类会随上游演进增补（现已 11 种），统一边表新增类型**零 DDL 迁移**，
且天然支持「一条边多证据」（如 SAME_AS 同时由 qid 与 fp 佐证 → weight 更高）。

### 1.3 去重与合并的数学

定义题目等价类（并查集）：

```
Union-Find over edges of type SAME_AS
canonical(q) = find(q) 的代表元（取 qid 最小者为代表）
```

**合并键的可靠性判据**（实测）：同一 `fp` 对应多个 `qid` 仅 **3 例** / 28669 fp ⇒ fp 可作合并键；
而 `qid` 跨仓匹配 **327/327 = 100%** ⇒ qid 是更强键。
**优先级**：qid > fp > sha256(normalize) 兜底。

### 1.4 分层存储：项目库 vs 上游投影

```
上游仓库（只读，永不修改）
   │  题库管理 clone/update（只读引用）
   ▼
适配层（8 个 adapter，产出统一中间形态）
   │  解析 → 归一 → 关系抽取
   ▼
.kaogong.db（项目自有派生物，可重建）
   │  统一查询 / FTS / 关系遍历 / 抽题 / 统计
   ▼
服务端域（poolApi / relationApi）+ 客户端视图
```

**边界纪律**：`.naokong.db` 是**上游投影**（整库重建，自有表会被静默冲掉）；
`.kaogong.db` 是**项目自有派生物**（可全量重建，可承载自有表与用户态）。
两者以 `qid` 关联（`ATTACH` 实测可用）。

## 2. 本插件代码落地（含实测证据）

### 2.1 现有结构（改动面盘点）

| 层 | 文件 | 现状 | 改造 |
|---|---|---|---|
| Host | `src/host/index.ts` | 注册 6 工具 + 同源路由 | 新增 `pool` 域注入声明 |
| Server | `src/server/http.ts` | `buildDomains(root)` 域工厂 + 域链分发 | **新增 `poolApi` 域**（域工厂装配 + 域链前置） |
| Server | 14 个域文件 | dataApi/paperApi/naokuApi/tuxingApi/methodologyApi/historyApi… | 新增 `poolApi.ts` |
| Adapter | 8 个 adapter | 各解析各的格式 | 新增 `poolIngest.ts`（归一 + 关系抽取） |
| Shared | `src/shared/manifest.ts` | `CAPABILITIES.endpoints` 单一事实源 | **必须同步登记新端点**（否则能力对账漂移） |
| Client | `src/client/client.tsx` | `VIEW_ROUTES` 唯一分发事实源 | 新增视图行 + 视图组件 |
| Client | `src/client/views/*.tsx` | 7 视图 | 新增「统一题库/知识库」视图 |

### 2.2 实测：关系数据已大量存在，只是未被统一建模

`.naoku.db` 实查（27506 题）：

| 关系/字段 | 覆盖 |
|---|---|
| `kadian`（知识点） | **27506（100%）**，10552 个不同知识点 |
| `n_paper` / `qtype` / `freq` | 27506（100%） |
| `related`（题→题） | **7922** |
| `material` / `material_ref`（共享材料） | 7327 / 7315 |
| `materials` 表 | **1578** 条独立材料 |
| `doubt`（疑点） | **1577** |
| `reasoning`/`fastest`/`mother`/`ask_model` | **11282** |
| `pitfalls` | 11278 |
| `review_verified`（人工校验） | **53** |
| distinct module / category / region / year | 6 / 25 / **36** / **19** |

⇒ 「关系」不是新造概念，而是**把既有分散字段显式化为边表**，让它们可 JOIN、可遍历。

### 2.3 实测：`.kaogong.db` 技术可行性（全部通过）

| 能力 | 实测 |
|---|---|
| UPSERT 批量写 5 万行 | **244 ms** |
| 增量更新 5000 行（同 qid 改内容） | **20 ms** |
| FTS5 外部内容表 rebuild（5 万行） | **311 ms** |
| FTS 中文 trigram 命中 | ✅ |
| `ATTACH` 上游 `.naoku.db` 联合查询 | ✅ 可用 |
| WAL 模式 | ✅（`-wal`/`-shm` 正常生成） |
| 库体积（5 万行） | ~14.8 MB + WAL 8.3 MB |

⇒ **技术无阻碍**，且性能余量充足（写入不是瓶颈，解析才是）。

### 2.4 必须沿用的既有纪律

| 纪律 | 出处 | 在本方案中的落点 |
|---|---|---|
| `node:sqlite` **必须动态 import**（顶层 import 会让旧 Node 整插件加载失败） | cycle-16 适配器注释 | `poolIngest.ts` 与 `poolApi.ts` 均走 `await import('node:sqlite')` |
| 域工厂 `buildDomains(root)` 装配 + `rebuildDomains()` 换根重建 | cycle-16 教训⑬ | 新域进 `buildDomains`，换根时随域一起重建 |
| 能力 SSOT：改端点必须同步 `CAPABILITIES.endpoints` | v1.8 教训 | 新端点四步纪律：manifest → server → UI → smoke |
| 客户端 `VIEW_ROUTES` 唯一分发事实源 | cycle-24 | 新视图只加一行，不改分发点 |
| 视图自治 fetch + 早退在所有 hook 之后 | cycle-24 P0-1/C24-2 | 新视图遵守 |
| 事故驱动沉淀 + smoke 守卫 | 全项目 | 每条关键事实配一条守卫 |

## 3. 中文思维：学习场景启发

- **「散珠成串，串在针上」**：十六个题库是散珠，各有各的孔。`.kaogong.db` 就是那根**针**——不是把珠子融了重铸，而是**穿起来**：珠还是珠，但从此能一把抓起、逐颗比对。
- **「一题多处，注疏并置」**：同一道题在国考 2021、在省考 2019、在深度库都有。边表把这「多处」显式记下来，于是「这道题我到底见过没有」有了确切的答案，而不是靠记忆与运气。
- **「材料如共用之灯，照一串题」**：资料分析一组五题共用一段材料。材料不是题的附属，而是**题的前提**——丢了材料，题就废了。这解释了为何 `groupMaterial` 在统一模型里**不可丢弃**。
- **「疑点亦是关系」**：1577 条 `doubt`（易错点/疑点）不是标签，而是「这道题与哪个坑相连」。把疑点也建成边，刷题时才能**提前绕坑**，而不是答错后才知道。
- **「自有库如自有的账本」**：上游的库是**借来的册子**（上游一变整本重抄），自有库是**自己的账本**（想怎么记就怎么记，随时可重抄）。凡是要沉淀「我们的判断」（校验结果、复习记录、学习画像），都必须写在自有账本上。
- **「可重建者方能信」**：`.kaogong.db` 必须是**可从上游完全重建**的产物——这样它永远不是单点故障，也永远不需要「修数据库」，只需「重建数据库」。

## 4. 工程实践价值

1. **一处升级，四处受益**：统一库同时解决 #4（图片搜题需统一检索）、#5（练习锁单源）、跨源去重溯源、图推桥接——**四个议题共享同一个底座**，避免重复建库。
2. **关系显式化 > 字段堆叠**：把 `related`/`material`/`doubt`/`mother` 等散字段做成统一边表，使「跨源同题」「同知识点」「同材料组」成为**可 JOIN 的查询**，而非逐个字段特判。
3. **单一事实源延续**：抽题权重继续复用 SRS 的 `1/(rate+0.15)`（C30b 纪律）；统计口径继续由 manifest 与端点响应派生（㊲/㉑ 纪律）。新库不引入第二套公式。
4. **可重建性作为设计目标**：`.kaogong.db` 全量重建 ≤ 数分钟（解析 0.56ms/题 × 全量 + 写入 12.3ms÷千题），**构建失败即删除重建**，不留半成品（对齐「失败只读降级绝不删源」纪律的镜像：不留脏派生库）。
5. **关系使「弱项诊断」成为可能**：现在 SRS 只能按**模块**聚合（6 维）；有了 `kadian` 边（10552 个知识点），可按**知识点**诊断——「你在『面数量』这个知识点上反复错」才是真正的指导。
6. **审计友好**：每条关系带 `evidence`（来源端点/规则/置信度），任何一条「同题」判定都可追溯到证据——这与项目既有的「白盒可观测」价值观一致。

## 5. 验证方式（可运行）

```bash
# ① 关系数据实查
node _tmp/relations-probe.cjs

# ② .kaogong.db 技术可行性（UPSERT / FTS5 / ATTACH / WAL）
node _tmp/kg-db-probe.cjs

# ③ 既有门禁
cd dsh-kaogong && npm run build && npm run test:all
```

**新增守卫（随实施落地）**：

- `SMOKE-KGDB-01`：`.kaogong.db` schema 与 `manifest` 声明一致（版本号 + 表清单）
- `SMOKE-KGDB-02`：池内同 `qid` 只有一条 canonical 记录；`relation` 中 SAME_AS 边无自环
- `SMOKE-KGDB-03`：关系覆盖率断言（kadian 边 = 池内题数 100%；related/material 边数 ≥ 上游实测值）
- `SMOKE-KGDB-04`：**重建幂等** —— 连续两次全量重建，池条目数与关系边数完全相等（可重建性守卫）
- `SMOKE-KGDB-05`：**载体隔离** —— 重建 `.naoku.db` 后 `.kaogong.db` 不受影响（防误写上游投影库）
- `SMOKE-KGDB-06`：新端点已在 `CAPABILITIES.endpoints` 登记且运行态可达（能力对账无漂移）
- `SMOKE-KGDB-07`：`node:sqlite` 动态 import 纪律（静态守卫：禁顶层 import） |

---

*本文结论基于 2026-11-18 实测：`.naoku.db` 关系字段覆盖率全表统计（27506 题）、UPSERT 5 万行 244ms、FTS5 外部内容表 rebuild 311ms、`ATTACH` 上游库联合查询、WAL 模式与体积测量、现有 14 个 server 域 / 8 个 adapter / 7 个视图的改动面盘点。*