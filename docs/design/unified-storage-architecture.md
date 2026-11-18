# 统一存储与模型自选架构 — 设计契约（unified-storage-architecture）

> 本文件是 **cycle-34** 的架构设计契约，回应 GitHub issue #4（图片搜题）并修正「无统一数据层」的既有判断。
> 状态：**设计已定，尚未实施**。任何实现偏离必须先改本文件并通知 Lead。
> 硬约束：**只读上游**（16 个第三方仓库不改一字节）、**零 npm 运行时依赖**、**完全离线可用**（AI 能力一律可选）。

---

## 0. 背景与结论摘要

### 0.1 三个已核实的事实（实测，非推断）

| 事实 | 数据 | 来源 |
|---|---|---|
| 工作区总数据量 | **7820 MB / 27441 md / 216266 张图** | 16 仓库实测 |
| 派生索引层**已存在** | `.naoku.db`(154MB) + `.paper-index.json`(525KB) + `.huasheng13-index.json`(1MB) | `data/` 实查 |
| **跨源身份层已存在** | `questions.qid` 27506 全唯一；`appearances` 58890 条，**join 命中率 100%**；1204 个 qid 跨卷复用 | `.naoku.db` 实查 |

### 0.2 结论（修正既有判断）

> **修正**：既有报告称「本项目无统一数据层，各源各搜各的」。**该判断不准确**。
> 真相是：**统一身份层（qid + appearances）已经建好并验证有效**，但**统一检索层与统一索引层缺失**，
> 导致 216266 张图、27441 篇笔记无法被统一检索，跨源无法去重聚合。

### 0.3 决策

采纳「**统一存储**」方向，但**分层实施**，不做 L3 二进制入库：

| 层 | 内容 | 决策 | 理由 |
|---|---|---|---|
| **L1 资产账本** | 源/文件/版本/内容哈希 | ✅ 实施 | 成本低，是所有其它层的前置 |
| **L2 统一文本索引** | 全源可解析文本 → FTS5 trigram | ✅ 实施 | 实测 0.56ms/题，是「统一检索」的核心 |
| **L3 媒体二进制入库** | 216266 张图 → BLOB | ❌ **不做** | 图片已内容寻址（sha256 文件名），BLOB 化丧失去重、备份体积翻倍；改为**引用登记** |

---

## 0b. 内核边界契约（cycle-35 追加 · 顶层原则）

> 完整推导见 [../research/14-内核边界契约.md](../research/14-内核边界契约.md)。

### 0b.1 四层依赖（只能向下，不得越级）

```
L4 内核层（Kernel）   本项目原生的算法与领域模型（刷题内核、SRS、评分、图谱算法、抽题策略）
   ↓ 只依赖 L3 的接口契约，不认识文件系统与第三方格式
L3 存储层（Store）     .kaogong.db —— 唯一的题 / 关系 / 资产事实源
   ↓ 只依赖 L2 的适配接口，不认识第三方目录结构
L2 适配层（Adapter）   8 个 adapter + poolIngest：第三方格式 → 统一中间形态
   ↓ 只依赖 L1 的只读引用
L1 数据源层（Source）   16 个第三方仓库（只读，永不修改）
```

### 0b.2 六条核心不变量

| 编号 | 不变量 | 状态 |
|---|---|---|
| **I1** | 内核层禁止出现任何 fs 读操作（readFileSync/readdirSync/statSync/existsSync） | 🆕 需守卫 |
| **I2** | 内核层禁止出现第三方目录名或格式常量 | 🆕 需守卫 |
| **I3** | 内核层禁止直接引用第三方图片路径；媒体一律经存储层 `media_ref` | 🆕 需守卫 |
| **I4** | 客户端禁止直接读取第三方仓库文件，一切数据经服务端端点 | ✅ **已满足** |
| **I5** | 第三方仓库内容永远只读；写入只发生在用户数据根与自有派生库 | ✅ **已满足** |
| **I6** | 存储层可被完全删除并从上游重建，不持有不可再生数据 | 🆕 K-1 后满足 |

### 0b.3 内核判定标准

```
K1  表达考公学习的领域语义（题型、规律、考点、遗忘、SRS 权重、采分点…）
K2  对题目的表示形式无关（换掉数据源仍成立）
K3  有独立的可测性（可用构造数据测试，不依赖真实题库）
```

反之（属于适配）：知道某个具体上游的文件名、目录、字段名、正则、编码。

### 0b.4 本项目原生内核清单

| 内核 | 状态 |
|---|---|
| 五箱 SRS / 弱点加权 `1/(rate+0.15)` | ✅ 已是内核 |
| 申论采分点评分 / 大作文评分 | ✅ 已是内核 |
| 图谱算法族（PageRank/Brandes/FR） | ✅ 已是内核（纯算法无 IO） |
| 抽题/判分闭环（`/api/check`） | ✅ 已是内核 |
| 题型推断 `guessXingceType` / 材料组归属 | ⚠️ 半内核（含具体标签字面量 / md 标记形态） |
| 统一题目模型 / 关系模型 / 分层抽题策略 / BM25 检索 | 🆕 待建（K-1~K-6） |

### 0b.5 现状违规点（实测取证）

| 违规 | 位置 | 收敛阶段 |
|---|---|---|
| **抽题读 md** | `repoData.getRandomQuestions`（每次请求 `readFileSync`，**无缓存**） | K-1/K-5 |
| **图片直出第三方目录** | `/api/kg-img`（xingcezhenti）· `/api/naoku-img` · `/api/tuxing-img` · `/api/paper-img` | K-1/K-3 |
| 题面直读 | `paperApi.loadPaper`（逐卷读 md，有索引快照兜底）· `huasheng13`（按需读盘，有 fixtureHash 兜底） | K-1 |

### 0b.6 守卫（原则机器化）

| 守卫 | 判据 |
|---|---|
| `SMOKE-KERNEL-01` | `src/client/**` 禁出现 fs 读 API |
| `SMOKE-KERNEL-02` | 内核文件清单禁出现 fs 读 |
| `SMOKE-KERNEL-03` | 内核文件禁出现第三方目录名字面量 |
| `SMOKE-KERNEL-04` | 媒体端点只接受存储层 `media_ref` 解析结果 |
| `SMOKE-KERNEL-05` | `getRandomQuestions` 不再在请求路径 `readFileSync` |
| `SMOKE-KERNEL-06` | 第三方仓库 `git status` 干净 |

## 1. 现状测绘

### 1.1 16 个第三方仓库的摄入规模（实测）

| 仓库 | tier | 体积 | 文件 | md | 图 | 适配层级 |
|---|---|---|---|---|---|---|
| gwy-zhenti | 推荐 | 2161 MB | 117062 | 1806 | 114860 | **深度**（paperData/paperParse） |
| AdministrativeAptitudeTest | 可选 | 3545 MB | 1407 | 1 | 0（1403 **PDF**） | 参考（打印模考） |
| xingcezhenti | 必选 | 814 MB | 42426 | 2964 | 39449 | **深度**（naokuImage 配图） |
| kaogongzhentizhengliu | 可选 | 610 MB | 44216 | 22380 | 21822 | 检索增强 |
| GongkaoNaoku | 推荐 | 475 MB | 39756 | 4 | 39710 | **深度**（naoku/naokuImage） |
| xingce-app | 可选 | 139 MB | 295 | 5 | 49 | 数据参考 |
| gk-tuxing | 必选 | 40 MB | 361 | 0 | 354 | **深度**（tuxing） |
| kaogong-skill | 推荐 | 8 MB | 51 | 36 | 2 | 半适配 |
| sakib / NovaForge / developer2gwy / Exam_Database / qiuzhao-epi-bank / huasheng13 / yunduanqiqu / civil-exam-agent | — | ≤8 MB | 小 | 小 | 小 | 检索增强 / 备用 |

### 1.2 现有派生层（同构于 L1/L2 的局部实现）

| 文件 | 大小 | 覆盖源 | 形态 |
|---|---|---|---|
| `data/.naoku.db` | 154 MB | GongkaoNaoku | SQLite：questions / materials / appearances / review_verified + 6 索引 |
| `data/.paper-index.json` | 525 KB | gwy-zhenti | JSON 磁盘快照（首建 16s → 61ms） |
| `data/.huasheng13-index.json` | 1 MB | huasheng13 | JSON 快照（fixtureHash 失效判据） |

**缺口**：三者**互不联通**，无跨源 FTS，无统一 qid 映射到 gk-tuxing / xingcezhenti / kaogongzhentizhengliu。

### 1.3 图推内容的四源形态（实测，修正既有误判）

| 源 | 题干文字 | 题图 | 选项图 | 解析文字 |
|---|---|---|---|---|
| gwy-zhenti 真题卷 | ✅（模板化） | ✅ **每题独立 1–4 张** | ❌ 字母 | ✅ **含规律描述** |
| GongkaoNaoku | ✅ | ✅ 1883/1895（99.4%） | ❌ 字母 | ✅ reasoning/fastest |
| xingcezhenti | ✅ | 部分 | ❌ | ✅ |
| gk-tuxing | ❌ **纯图无文字** | ✅ 整图 | ✅ 含在整图 | ✅ exp/acc/trap |

> **修正**：既有报告称「gwy-zhenti 图推嵌在段落大图、无法定位单题」——**错误**。
> 实测 `国考/2026/行测-副省级.md`：135 题中 17 题带图，图片归属到 `### 第 N 题` 块内，题干文字完整。

---

## 2. L1 资产账本

### 2.1 Schema（新增表，挂 `.naoku.db` 或独立 `.unified.db`）

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,          -- 仓库名（16 个）
  tier TEXT,                    -- required | recommended | optional
  upstream_url TEXT,             -- 真实 GitHub 地址（只读引用）
  local_root TEXT,              -- 数据根内相对路径
  cloned_at TEXT, head_sha TEXT,
  file_count INTEGER, byte_size INTEGER
);
CREATE TABLE assets (            -- 统一资产账本：文件级
  id INTEGER PRIMARY KEY,
  source_id TEXT REFERENCES sources(id),
  rel_path TEXT,
  kind TEXT,                    -- md | image | pdf | data | other
  byte_size INTEGER,
  content_hash TEXT,            -- sha256（图片已是 sha256 命名，可直取）
  mtime_ms INTEGER,
  UNIQUE(source_id, rel_path)
);
CREATE INDEX ix_assets_hash ON assets(content_hash);   -- 跨源去重底座
CREATE INDEX ix_assets_kind  ON assets(source_id, kind);
```

### 2.2 语义

- **引用而非复制**：图片/PDF 只登记 `rel_path + content_hash`，二进制留在上游目录。
- **增量**：按 `content_hash + mtime_ms` 判定变更，题库管理更新后仅重扫变更文件。
- **跨源去重**：同 `content_hash` 的资产可判定为同一文件（如同一张图被多源收录）。

---

## 3. L2 统一文本索引

### 3.1 Schema

```sql
CREATE TABLE questions_unified (
  id INTEGER PRIMARY KEY,
  canonical_id TEXT UNIQUE,     -- 统一题目身份（见 §4）
  source_id TEXT, local_key TEXT,  -- 源内标识
  module TEXT, category TEXT, kadian TEXT,
  region TEXT, year TEXT, paper TEXT, seq INTEGER,
  stem TEXT, options TEXT, answer TEXT, analysis TEXT,
  material TEXT, reasoning TEXT,
  has_image INTEGER, img_refs TEXT,
  updated_at TEXT
);
CREATE INDEX ix_qu_src   ON questions_unified(source_id, local_key);
CREATE INDEX ix_qu_canon ON questions_unified(canonical_id);
CREATE INDEX ix_qu_mod   ON questions_unified(module, category);

CREATE VIRTUAL TABLE fts_unified USING fts5(
  stem, options, analysis, reasoning, kadian, category,
  content='questions_unified', content_rowid='id', tokenize='trigram'
);
```

### 3.2 实测基线（本次验证）

| 指标 | 实测值 | 结论 |
|---|---|---|
| 摄入吞吐 | **0.56 ms/题**（300 个真题卷 md → 12737 题，7.16 s） | 全量 100 万题 ≈ 9 分钟，可接受 |
| FTS5 可用 | SQLite **3.51.2** | ✅ |
| **中文 trigram 检索** | 「位置规律」「十六宫格」「三视图」「同比增长」「多面体」**全部命中** | ✅ 中文无需外部分词器 |
| 短语查询 | `"位置规律"` ✅ 命中 | 支持精确短语 |
| 全量 FTS 检索 | **< 1 ms** | ✅ |

> 零 npm 运行时依赖约束下，FTS5 trigram 是**唯一可用且已验证**的中文全文方案。

### 3.3 覆盖范围（S1/S2 建议）

**纳入正文索引**：gwy-zhenti / xingcezhenti / GongkaoNaoku / gk-tuxing / kaogongzhentizhengliu / huasheng13 / kaogong-skill / sakib
**仅登记不入正文**：AdministrativeAptitudeTest（1403 PDF，见 §6）

---

## 4. 统一题目身份（canonical_id）

### 4.1 复用已有资产

`appearances` 表**已经是**跨源映射：

| 列 | 语义 |
|---|---|
| `qid` | 题目全局唯一标识（questions.qid，27506 全唯一） |
| `fp` | 内容指纹（sha1 十六进制，28669 个不同值） |
| `paper/region/year/module/category/seq/path` | 出处 |

`appearances` 共 **58890 条**，与 xingcezhenti 的 **58890 题**完全对应，`join questions` 命中率 **100%**。
**1204 个 qid 出现在多个不同卷** —— 这就是天然的跨卷同一题。

### 4.2 canonical_id 派生规则

```
canonical_id = 'q:' || qid                     （naoku 系，已具备）
             | 'fp:' || fp                     （出现表指纹）
             | 'h:' || sha256(normalize(stem+options+answer))[0:16]
                                                    （无 qid 源：gk-tuxing / kaogongzhentizhengliu）
```

### 4.3 跨源去重

以 `fp`（内容指纹）为桥：**同一 fp 出现在多个源 → 聚合成一条 canonical 记录，标注多处出处**。
这直接服务「一道题在多库重复」的痛点，也是统一检索的价值所在。

---

## 5. 模型自选（对齐 DSH 对话输入框）

### 5.1 宿主契约（官方知识库核实）

| 能力 | 契约 | 用途 |
|---|---|---|
| **模型路由** | `ctx.llm`（`inject: ['llm']`），provider + model 身份 | 复用宿主已配置的模型，**零额外凭据** |
| **图片模态** | `ContentBlock = { text, reasoning, image, file, tool-call }`，`ImageBlock` | 图片作为一等模态随请求序列化 |
| **图片读取** | `ImageAttachmentAccess.readonlyPath` | 模型工具读图的规范路径（只读） |
| **附件持久化** | `ctx.attachments` → `<DSH_HOME>/attachments/v1`，**内容寻址引用** | 上传图直接复用宿主持久化，**不落 base64** |
| **模型选择事件** | `event:model/selection`、`event:llm/retry` | 观测模型路由与重试 |
| **默认模型配置** | `agent-default-model` 插件 Config：`provider/model/reasoningEffort` | 宿主默认模型的声明形状 |
| **客户端远程调用** | `@Remote` / `ctx.remote` + `remoteAccess` | 插件 Host ↔ Client 通信（模型清单下拉） |

### 5.2 模型选择器（对齐 DSH 输入框）

**目标 UX**：与 DSH 对话输入框一致——**用户自选 provider + model**，插件不锁定模型。

设计：

```
┌──────────────────────────────────────────────┐
│ 📷 上传题目图片        [🔍 搜题]              │
│ 模型: [DeepSeek ▾] [deepseek-chat ▾]  ← 自选 │
│ ─────────────────────────────────────────── │
│ 识别结果: 图推 · 位置规律 · 黑色三角形三顶点…  │
│ 候选: 3 条 (跨源聚合, 去重后 2 道题)          │
│ [✓ 核对并加入错题本]                          │
└──────────────────────────────────────────────┘
```

**模型清单来源**（两级降级）：

1. **优先**：宿主暴露的可用模型清单（provider + model 列表）→ 插件 `@Remote` 暴露 `listModels()` 给 Client，UI 渲染下拉。
2. **降级**：插件配置声明 `provider/model` 默认值（对齐 `agent-default-model` 的 Config 形状），宿主未暴露清单时使用。

**关键约束**：**选中的模型仅作用于本插件的 AI 增强功能**，**不影响** DSH 主对话的模型选择，两者独立但同源（同一宿主模型路由）。

### 5.3 与现有 5 个 AI 工具的关系

现有 `kaogong_ai_*` 工具当前是「**素材供模型加工**」模式（拼装 prompt 交给宿主 agent 侧模型处理），**不自带模型调用**。

本设计**不推翻**它们，而是新增一条**插件内直连模型**的能力（`ctx.llm`），用于：
- 图片识别（图搜题）——需要**结构化输出**（规律特征），agent 侧通用模型处理无法保证 schema
- 图表数据抽取——需要 JSON schema 约束输出

| 路径 | 适合 | 现状 |
|---|---|---|
| `kaogong_ai_*` 工具（agent 侧） | 长文本点评、批改、方法论问答 | 已有，保持 |
| `ctx.llm` 直连（插件内） | **结构化抽取**、图片理解、需要 schema 的任务 | 新增 |

---

## 6. PDF 源的分层策略（AdministrativeAptitudeTest）

### 6.1 实测结论

- 1403 个 PDF / 1929.7 MB，分类：国考(66) + 省考市考(1200+，含上海/云南/内蒙古/北京/吉林/四川/天津/宁夏) + 选调
- 年份 **2000–2024**；与 gwy-zhenti（2008–2026）**文件名规范化后零重叠**，但年份段大量重合
- PDF 独有形态：**独立「答案及解析」PDF**（md 源把答案内嵌 `<details>`）
- PDF **独有年份：2000–2007**（md 源没有）

### 6.2 决策

| 段 | 决策 | 理由 |
|---|---|---|
| **2000–2007**（真题卷无） | ⚠️ **候选做 OCR/解析入库** | 唯一来源，但 OCR 成本高 → 列为**可选项**，非阻塞 |
| 2008–2022 | ❌ 不入库正文 | 与 md 源同题不同来源；md 已结构化可检索 |
| 答案及解析 PDF | 🔵 **登记为资产 + 独立出处** | 不做正文，但登记进 L1，供「答案来源」溯源 |
| 全部 PDF | ✅ **L1 登记**（rel_path + hash） | 保留可追溯性与打印模考入口 |

> **不做 PDF 正文入库的理由**：OCR 1403 个 PDF 成本极高（估 10+ 小时 CPU），
> 而 2008+ 段内容已被 md 源以结构化形式覆盖。**先登记，后按需**。

### 6.3 图推选项图的正解（不靠 PDF）

图推「选项图缺失」的三个候选来源，按性价比排序：

1. **gk-tuxing 354 张整图**——题面+选项已合成单图 ✅ **现成、零成本**（但无题干文字，无法以图搜图）
2. **PDF 渲染**——理论含完整排版图，但需 PDF 渲染管线 ❌ 成本高
3. **vision 反推**——不可靠 ❌

**结论**：gk-tuxing 已足够支撑「图推专项浏览 + 看选项图」；**不为此新增 PDF 管线**。

---

## 7. 统一检索 API

### 7.1 新端点

| 端点 | 语义 |
|---|---|
| `GET /api/unified/search?q=&source=&module=&limit=` | 跨源统一检索（FTS5 trigram），跨源去重聚合 |
| `GET /api/unified/question/:canonicalId` | 跨源聚合视图：一份题干 + N 处出处 |
| `GET /api/unified/assets?source=&kind=` | L1 资产账本查询 |
| `GET /api/unified/stats` | 统一统计：各源题目数/图数/覆盖率 |
| `POST /api/unified/reindex` | 增量重建（按 hash/mtime） |

### 7.2 兼容硬约束

- `/api/search`、`/api/history/search`、`/api/naoku/*`、`/api/papers/*` 既有字段**一个都不能删/改名**，新增一律**追加**。
- 旧 UI（独立 SPA `src/ui/index.html`）不改也能跑。

---

## 8. 图推桥接（figure_bridge）—— #4 P1 的关键

### 8.1 核心洞察

图推题的**题干文字高度模板化**（真题卷 135 道图推题题干几乎都是「从所给的四个选项中，选择最合适的一个填入问号处…」），
**无法区分题目**。但**解析文字可区分**：

> 「元素组成基本相同，优先考虑位置规律。题干图形出现十六宫格，黑色三角形均存在三个顶点……」
> 「元素组成相同，但无明显位置规律和属性规律，考虑数量规律。题干图形面数量依次为0、1、2、3」

⇒ **图推的可检索特征 = 解析文本中的规律描述**，而非题干。

### 8.2 桥接链路

```
用户上传图推截图
  → ctx.llm 直连模型读图（ImageBlock）
  → 模型产出结构化特征：{规律类型, 特征描述, 元素/数量线索}
  → 以特征描述 + 规律类型查询 fts_unified（匹配 analysis/reasoning 列）
  → 跨源聚合去重 → 人工核对 → 入错题本
```

**成本低**（纯文本检索，复用现有 FTS 层），**不碰上游**，**不需图像 embedding**。

### 8.3 规律类型标签（复用 gk-tuxing 13 类）

空间重构 / 位置 / 面数量 / 对称性 / 样式 / 笔画数 / 线条规律 / 元素种类 / 点规律 / 曲直性 / 角数量 / 特殊规律 / 综合规律

⇒ 规律类型作为**一等检索维度**并入 `questions_unified.kadian`（或独立 `rule_type` 列）。

---

## 9. 实施路线

| 阶段 | 交付 | 依赖 | 守卫 |
|---|---|---|---|
| **S1** | L1 资产账本（16 源文件/版本/hash） | 题库管理 clone/update | 新增 smoke：账本条数与磁盘一致、增量幂等 |
| **S2** | L2 统一 FTS + canonical_id + 统一检索 API | S1 | 新增 smoke：跨源检索命中、去重正确、响应 < 50ms |
| **S3** | 图推桥接 + 规律特征抽取 + #4 P0/P1 | S2 | 新增 smoke：图搜题召回、人工核对环 |
| **S4**（可选） | PDF 2000–2007 OCR 入库 | 独立评估 | 抽样准确率门禁 |
| **S5**（可选） | L3 媒体统一存储 | 独立评估 | **默认不做** |

### 9.1 #4 议题分层（随 S3 落地）

| 阶段 | 范围 | 改上游 | 成本 | 判定 |
|---|---|---|---|---|
| **P0** | 文字题（资料分析/常识/言语）图片搜题 | ❌ | 低 | ✅ |
| **P1** | 图推 + 资料分析图表（规律特征/图表数据 → FTS） | ❌ | 低-中 | ✅ |
| **P2** | gk-tuxing 以图搜图（图像 embedding） | 需补选项图 | 高 | ❌ **砍掉**（纯图无文字键） |

**红线**：模型抽取不可能 100% 准 → 匹配结果必须过**人工核对环**，**绝不自动落库**。

---

## 9b. 统一题目池与多源抽题（cycle-34 追加 · 回应「刷题只能刷一个题库」）

### 9b.1 问题

练习链路 `/api/questions` 的取数源**硬编码单仓库**：

```ts
// src/adapters/repoData.ts — getRandomQuestions()
const modulePath = join(repoRoot, 'xingcezhenti', dirName)   // ← 硬编码
const randomFile = files[Math.floor(Math.random() * files.length)]
const questions = parseQuestions(join(modulePath, randomFile), 30)   // ← 只解析前 30 题
```

`/api/questions` 参数仅 `module`/`count`/`sort`，**无来源参数** ⇒ 只能刷 xingcezhenti。
其它入口各自锁一源：`/api/naoku/*`→GongkaoNaoku、`/api/tuxing/*`→gk-tuxing、`/api/papers/*`→gwy-zhenti。

**三重后果**：① 可达集被压缩（每次只来自一份随机试卷的前 30 题，考点轮换极慢）；② 与已装源脱钩（不装 xingcezhenti 则专题刷题不可用）；③ naoku 五维标注未贯通练习卡片。

### 9b.2 关键实测（决定方案形态）

| 实测项 | 结果 | 对方案的约束 |
|---|---|---|
| `xingcezhenti` 内嵌 `<sub>qid N</sub>` ↔ `naoku.qid` 匹配 | **327/327 = 100%** | ✅ **跨仓共享同一 ID 体系** → 身份映射**天然可建**，不需改上游 |
| `naoku.qid` 唯一性 | 27506 全唯一 | L1 判据可靠 |
| 同一 `fp` 对应多个 `qid` | **仅 3 例**（28669 fp / 27506 题） | ✅ **fp 可作合并键**，去重安全 |
| 同一 `qid` 对应多个 `fp` | 1204 例 | 跨卷同一题，可聚合出处 |
| `.naoku.db` 生成方式 | `Buffer.concat(上游分片)` 整库重建 | ⚠️ **不可往其写自有表**（重建即冲掉） |
| FTS5 外部内容表 / ATTACH | ✅ 可用 | 新库可用 FTS5 + 可 ATTACH 既有库 |
| 批量插入 / 解析吞吐 | 12.3ms÷千题 / **0.56ms/题** | **解析是瓶颈**（差 45 倍），优化方向是增量解析非 DB 调优 |

### 9b.3 载体决策：新建独立 `.unified.db`，不扩展 `.naoku.db`

**「新建数据库」是必要载体，但不是方案本身。** 完整方案 = 载体 + 模型 + 身份 + 抽样，四者缺一不可：

| # | 要素 | 决策 |
|---|---|---|
| 1 | **载体** | ✅ 新建 `.unified.db`（自有库）。**不写 `.naoku.db`**——它是上游投影、整库重建会静默冲掉自有表；边界上「上游投影留上游库，项目派生物进自有库」，两者以 `qid` 关联 |
| 2 | **统一题目模型** | ✅ 必须容纳四源差异（见 §9b.4） |
| 3 | **跨源身份** | ✅ **优先消费上游 qid**（跨仓 100% 匹配）；`fp` 作合并键（冲突仅 3 例）；sha256 归一哈希仅作最后兜底 |
| 4 | **抽样策略** | ✅ 改为**分层加权**（按 kadian 分层 + SRS 同源权重），废弃「随机文件前 30 题」 |

> **修正上一版设计**：原文档提出 `'h:' || sha256(normalize(...))` 作为 canonical_id 主路径，实测证明**上游 qid 已是事实标准**（327/327），该方案应**降级为最后兜底**，避免自造标准与上游冲突。

### 9b.4 统一题目模型（须容纳的四源差异）

```sql
CREATE TABLE pool (
  id INTEGER PRIMARY KEY,
  qid TEXT,                    -- 上游 qid（主身份，跨仓 100% 一致）
  canonical_key TEXT UNIQUE,   -- qid 优先；否则 fp；否则 h:sha256
  source_id TEXT, local_key TEXT,  -- 源内标识（反向定位）
  module TEXT, category TEXT, kadian TEXT, rule_type TEXT,  -- gk-tuxing 13 类规律标签
  stem TEXT, options TEXT, answer TEXT, analysis TEXT,
  reasoning TEXT, fastest TEXT, pitfalls TEXT, mother TEXT,   -- naoku 五维（可空）
  group_material TEXT, group_material_no INTEGER,             -- 材料组绑定
  has_image INTEGER, images TEXT,     -- 归一为 [{source, relPath, hash}]
  freq REAL, paper TEXT, region TEXT, year TEXT, seq INTEGER
);
CREATE INDEX ix_pool_qid   ON pool(qid);
CREATE INDEX ix_pool_key   ON pool(canonical_key);
CREATE INDEX ix_pool_kd    ON pool(module, kadian);
CREATE VIRTUAL TABLE pool_fts USING fts5(
  stem, options, analysis, reasoning, fastest, pitfalls, kadian, rule_type,
  content='pool', content_rowid='id', tokenize='trigram'
);
CREATE TABLE pool_sources (   -- 一题多出处（跨源聚合）
  canonical_key TEXT, source_id TEXT, local_key TEXT, paper TEXT, seq INTEGER, path TEXT
);
```

**四源差异的落点**：

| 差异 | 处理 |
|---|---|
| gk-tuxing 无题干文字（整图） | `stem` 可空 + `images` 指向整图 + `rule_type` 标签 → 卡片形态「整图 + 规律标签」 |
| 材料组（资料分析/篇章） | `group_material` + `group_material_no` 保留绑定，**不可丢弃**（否则题与材料失联） |
| 两套图片引用协议 | `kgimg://`（xingcezhenti）与 `img_refs`（naoku）统一为 `images[{source,relPath,hash}]` |
| naoku 五维独有 | 字段**可空**，不作必填（其它源为空） |

### 9b.5 抽题接口与策略

```
GET /api/pool/questions?module=&kadian=&source=all|xingcezhenti|naoku|tuxing|papers&count=&policy=
```

**策略**（权重公式**复用** SRS 同源模型，不另立一套）：

```
P(q) ∝ w_kadian(kadian) · w_weak(module) · w_srs(state)
w_weak = 1/(rate + 0.15)     -- 既有单一事实源（C30b）
w_srs  = 未掌握错题最久先回炉   -- FIFO 贪心
```

**兼容**：`/api/questions` 保持既有行为不变（向后兼容硬约束），新池走**新端点**；UI 逐步迁移。

### 9b.6 实施顺序

| 阶段 | 交付 | 守卫 |
|---|---|---|
| **P-1** | 建 `.unified.db` + 全源摄入 + qid/fp 身份映射 | SMOKE-POOL-01/02/05/06 |
| **P-2** | 统一题目模型落地（四源差异归一） | SMOKE-POOL-02（出处聚合正确） |
| **P-3** | `/api/pool/questions` 多源分层抽题 | SMOKE-POOL-03/04（分布防偏斜回归） |
| **P-4** | 练习卡片消费五维标注 + 跨源出处展示 | render 旅程 |

> **载体隔离守卫（SMOKE-POOL-06）**：重建 `.naoku.db` 后统一池条目数与内容**不变** —— 防止误把自有表写进上游投影库。

## 9b. 统一题目池与多源抽题（cycle-34 追加 · 回应「刷题只能刷一个题库」）

### 9b.1 问题

练习链路 `/api/questions` 的取数源**硬编码单仓库**：

```ts
// src/adapters/repoData.ts — getRandomQuestions()
const modulePath = join(repoRoot, 'xingcezhenti', dirName)   // ← 硬编码
const randomFile = files[Math.floor(Math.random() * files.length)]
const questions = parseQuestions(join(modulePath, randomFile), 30)   // ← 只解析前 30 题
```

`/api/questions` 参数仅 `module`/`count`/`sort`，**无来源参数** ⇒ 只能刷 xingcezhenti。
其它入口各自锁一源：`/api/naoku/*`→GongkaoNaoku、`/api/tuxing/*`→gk-tuxing、`/api/papers/*`→gwy-zhenti。

**三重后果**：① 可达集被压缩（每次只来自一份随机试卷的前 30 题，考点轮换极慢）；② 与已装源脱钩（不装 xingcezhenti 则专题刷题不可用）；③ naoku 五维标注未贯通练习卡片。

### 9b.2 关键实测（决定方案形态）

| 实测项 | 结果 | 对方案的约束 |
|---|---|---|
| `xingcezhenti` 内嵌 `<sub>qid N</sub>` ↔ `naoku.qid` 匹配 | **327/327 = 100%** | ✅ **跨仓共享同一 ID 体系** → 身份映射**天然可建**，不需改上游 |
| `naoku.qid` 唯一性 | 27506 全唯一 | L1 判据可靠 |
| 同一 `fp` 对应多个 `qid` | **仅 3 例**（28669 fp / 27506 题） | ✅ **fp 可作合并键**，去重安全 |
| 同一 `qid` 对应多个 `fp` | 1204 例 | 跨卷同一题，可聚合出处 |
| `.naoku.db` 生成方式 | `Buffer.concat(上游分片)` 整库重建 | ⚠️ **不可往其写自有表**（重建即冲掉） |
| FTS5 外部内容表 / ATTACH | ✅ 可用 | 新库可用 FTS5 + 可 ATTACH 既有库 |
| 批量插入 / 解析吞吐 | 12.3ms÷千题 / **0.56ms/题** | **解析是瓶颈**（差 45 倍），优化方向是增量解析非 DB 调优 |

### 9b.3 载体决策：新建独立 `.unified.db`，不扩展 `.naoku.db`

**「新建数据库」是必要载体，但不是方案本身。** 完整方案 = 载体 + 模型 + 身份 + 抽样，四者缺一不可：

| # | 要素 | 决策 |
|---|---|---|
| 1 | **载体** | ✅ 新建 `.unified.db`（自有库）。**不写 `.naoku.db`**——它是上游投影、整库重建会静默冲掉自有表；边界上「上游投影留上游库，项目派生物进自有库」，两者以 `qid` 关联 |
| 2 | **统一题目模型** | ✅ 必须容纳四源差异（见 §9b.4） |
| 3 | **跨源身份** | ✅ **优先消费上游 qid**（跨仓 100% 匹配）；`fp` 作合并键（冲突仅 3 例）；sha256 归一哈希仅作最后兜底 |
| 4 | **抽样策略** | ✅ 改为**分层加权**（按 kadian 分层 + SRS 同源权重），废弃「随机文件前 30 题」 |

> **修正上一版设计**：原文档提出 `'h:' || sha256(normalize(...))` 作为 canonical_id 主路径，实测证明**上游 qid 已是事实标准**（327/327），该方案应**降级为最后兜底**，避免自造标准与上游冲突。

### 9b.4 统一题目模型（须容纳的四源差异）

```sql
CREATE TABLE pool (
  id INTEGER PRIMARY KEY,
  qid TEXT,                    -- 上游 qid（主身份，跨仓 100% 一致）
  canonical_key TEXT UNIQUE,   -- qid 优先；否则 fp；否则 h:sha256
  source_id TEXT, local_key TEXT,
  module TEXT, category TEXT, kadian TEXT, rule_type TEXT,
  stem TEXT, options TEXT, answer TEXT, analysis TEXT,
  reasoning TEXT, fastest TEXT, pitfalls TEXT, mother TEXT,   -- naoku 五维（可空）
  group_material TEXT, group_material_no INTEGER,
  has_image INTEGER, images TEXT,     -- 归一为 [{source, relPath, hash}]
  freq REAL, paper TEXT, region TEXT, year TEXT, seq INTEGER
);
CREATE INDEX ix_pool_qid   ON pool(qid);
CREATE INDEX ix_pool_key   ON pool(canonical_key);
CREATE INDEX ix_pool_kd    ON pool(module, kadian);
CREATE VIRTUAL TABLE pool_fts USING fts5(
  stem, options, analysis, reasoning, fastest, pitfalls, kadian, rule_type,
  content='pool', content_rowid='id', tokenize='trigram'
);
CREATE TABLE pool_sources (   -- 一题多出处（跨源聚合）
  canonical_key TEXT, source_id TEXT, local_key TEXT, paper TEXT, seq INTEGER, path TEXT
);
```

**四源差异的落点**：

| 差异 | 处理 |
|---|---|
| gk-tuxing 无题干文字（整图） | `stem` 可空 + `images` 指向整图 + `rule_type` 标签 → 卡片形态「整图 + 规律标签」 |
| 材料组（资料分析/篇章） | `group_material` + `group_material_no` 保留绑定，**不可丢弃**（否则题与材料失联） |
| 两套图片引用协议 | `kgimg://`（xingcezhenti）与 `img_refs`（naoku）统一为 `images[{source,relPath,hash}]` |
| naoku 五维独有 | 字段**可空**，不作必填（其它源为空） |

### 9b.5 抽题接口与策略

```
GET /api/pool/questions?module=&kadian=&source=all|xingcezhenti|naoku|tuxing|papers&count=&policy=
```

**策略**（权重公式**复用** SRS 同源模型，不另立一套）：

```
P(q) ∝ w_kadian(kadian) · w_weak(module) · w_srs(state)
w_weak = 1/(rate + 0.15)     -- 既有单一事实源（C30b）
w_srs  = 未掌握错题最久先回炉   -- FIFO 贪心
```

**兼容**：`/api/questions` 保持既有行为不变（向后兼容硬约束），新池走**新端点**；UI 逐步迁移。

### 9b.6 实施顺序

| 阶段 | 交付 | 守卫 |
|---|---|---|
| **P-1** | 建 `.unified.db` + 全源摄入 + qid/fp 身份映射 | SMOKE-POOL-01/02/05/06 |
| **P-2** | 统一题目模型落地（四源差异归一） | SMOKE-POOL-02（出处聚合正确） |
| **P-3** | `/api/pool/questions` 多源分层抽题 | SMOKE-POOL-03/04（分布防偏斜回归） |
| **P-4** | 练习卡片消费五维标注 + 跨源出处展示 | render 旅程 |

> **载体隔离守卫（SMOKE-POOL-06）**：重建 `.naoku.db` 后统一池条目数与内容**不变** —— 防止误把自有表写进上游投影库。

## 9c. `.kaogong.db` —— 项目自有统一知识库（cycle-35 架构升级）

### 9c.1 定位与边界

```
上游仓库（16 个第三方，只读，永不修改）
   ↓ 题库管理 clone/update（只读引用）
适配层（8 个 adapter + 新增 poolIngest）
   ↓ 解析 → 归一 → 关系抽取
.kaogong.db（项目自有派生物 · 可完全重建）
   ↓ 统一查询 / FTS / 关系遍历 / 分层抽题 / 统计
服务端（poolApi 域）+ 客户端（统一题库视图）
```

**与 `.naoku.db` 的边界（硬约束）**：

| | `.naoku.db` | `.kaogong.db` |
|---|---|---|
| 性质 | **上游投影**（整库重建） | **项目自有派生物**（可全量重建） |
| 内容 | naoku 蒸馏库原始 schema | 统一池 + 关系 + 资产 + 索引 + 用户态 |
| 写自有表 | ❌ **禁止**（重建即静默冲掉） | ✅ 允许 |
| 关联方式 | — | 以 `qid` 关联（`ATTACH` 实测可用） |
| 位置 | `data/.naoku.db` | `data/.kaogong.db` |

### 9c.2 完整 Schema

```sql
PRAGMA journal_mode=WAL;

-- ① 元信息：schema 版本 + 源快照指纹（决定增量策略）
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
--   schema_version / built_at / source_fingerprint / ingest_stats(json)

-- ② 源目录（题库管理的 16 仓只读登记）
CREATE TABLE source (
  id TEXT PRIMARY KEY, tier TEXT, upstream_url TEXT, local_root TEXT,
  head_sha TEXT, cloned_at TEXT, file_count INTEGER, byte_size INTEGER,
  content_hash TEXT);

-- ③ 资产账本（L1：文件级；引用而非复制）
CREATE TABLE asset (
  id INTEGER PRIMARY KEY, source_id TEXT, rel_path TEXT, kind TEXT,
  byte_size INTEGER, content_hash TEXT, mtime_ms INTEGER,
  UNIQUE(source_id, rel_path));
CREATE INDEX ix_asset_hash ON asset(content_hash);
CREATE INDEX ix_asset_kind ON asset(source_id, kind);

-- ④ 统一题目池（核心）
CREATE TABLE question (
  id INTEGER PRIMARY KEY,
  qid TEXT,                   -- 上游 qid（跨仓 100% 一致；主身份）
  fp TEXT,                    -- 内容指纹（合并键，冲突仅 3 例）
  canonical_id TEXT UNIQUE,   -- q: + qid | fp: + fp | h: + sha256 前16
  source_id TEXT, local_key TEXT,
  module TEXT, category TEXT, kadian TEXT, rule_type TEXT,
  qtype TEXT, ask_model TEXT,
  stem TEXT, options TEXT, answer TEXT, analysis TEXT,
  reasoning TEXT, fastest TEXT, pitfalls TEXT, mother TEXT,
  doubt TEXT, related TEXT,
  group_material TEXT, group_material_no INTEGER, material_ref TEXT,
  images TEXT,                -- JSON: [{source, relPath, hash}]
  has_image INTEGER,
  freq REAL, paper TEXT, region TEXT, year TEXT, seq INTEGER, n_paper INTEGER,
  updated_at TEXT);
CREATE INDEX ix_q_qid ON question(qid);
CREATE INDEX ix_q_fp ON question(fp);
CREATE INDEX ix_q_canon ON question(canonical_id);
CREATE INDEX ix_q_mod ON question(module, category);
CREATE INDEX ix_q_kadian ON question(kadian);
CREATE INDEX ix_q_source ON question(source_id, local_key);

-- ⑤ 关系层（统一边表，10 种关系）
CREATE TABLE relation (
  id INTEGER PRIMARY KEY,
  rel_type TEXT NOT NULL,     -- SAME_AS|APPEARS_IN|BELONGS_TO|IN_MODULE|HAS_MATERIAL|RELATED_TO|HAS_DOUBT|DERIVED_FROM|SAME_REGION|REVIEWED
  src_kind TEXT, src_id TEXT, dst_kind TEXT, dst_id TEXT,
  weight REAL DEFAULT 1.0,   -- 证据强度（SAME_AS 由 qid 佐证权重更高）
  evidence TEXT,             -- JSON: 来源端点/规则/置信度
  UNIQUE(rel_type, src_kind, src_id, dst_kind, dst_id));
CREATE INDEX ix_rel_src ON relation(src_kind, src_id);
CREATE INDEX ix_rel_dst ON relation(dst_kind, dst_id);
CREATE INDEX ix_rel_type ON relation(rel_type);

-- ⑥ 材料（共享材料的独立实体，题与材料的桥）
CREATE TABLE material (id INTEGER PRIMARY KEY, mid TEXT UNIQUE, title TEXT, body TEXT, path TEXT);

-- ⑦ 派生索引（FTS5 trigram，外部内容表）
CREATE VIRTUAL TABLE question_fts USING fts5(
  stem, options, analysis, reasoning, fastest, pitfalls, kadian, rule_type,
  content='question', content_rowid='id', tokenize='trigram');

-- ⑧ 用户态层（学习记录；写在自有库，不再散在 progress json）
CREATE TABLE study_event (
  id INTEGER PRIMARY KEY, at TEXT, ws TEXT,
  qid TEXT, canonical_id TEXT, module TEXT, kadian TEXT,
  action TEXT,               -- answer|wrong|mastered|promoted|import
  user_answer TEXT, correct_answer TEXT, is_correct INTEGER,
  box INTEGER, consecutive INTEGER, duration_ms INTEGER);
CREATE INDEX ix_study_qid ON study_event(qid);
CREATE INDEX ix_study_canon ON study_event(canonical_id);
CREATE INDEX ix_study_kd ON study_event(kadian);
CREATE INDEX ix_study_at ON study_event(at);

-- ⑨ 人工校验（承接 review_verified 语义，扩展到全源）
CREATE TABLE review (
  canonical_id TEXT PRIMARY KEY, official_answer TEXT,
  verified_answer TEXT, status TEXT, at TEXT);
```

### 9c.3 各源适配规范（如何把不同格式喂进同一张表）

| 源 | 解析入口 | 归一要点 | 关系产出 |
|---|---|---|---|
| **GongkaoNaoku** | `adapters/naoku.ts`（读 `.naoku.db`） | `stem/options` 含 HTML → 剥标签但**保留 `kgimg://` 占位**（cycle-22 全字段枚举纪律） | kadian/related/material/doubt/mother + appearances(SAME_AS/APPEARS_IN) |
| **xingcezhenti** | `adapters/repoData.ts` `parseQuestions` | `<sub>qid N</sub>` → **直接取上游 qid**（跨仓 100% 一致）；`kgimg://` 占位保留 | qid⇒SAME_AS；groupMaterial⇒HAS_MATERIAL |
| **gwy-zhenti** | `adapters/paperData.ts` + `paperParse.ts` | frontmatter（考试/地区/年份/科目/卷型）→ 出处维度；题块标题 `### 第 N 题` | paper/region/year⇒APPEARS_IN；材料块⇒HAS_MATERIAL |
| **gk-tuxing** | `adapters/tuxing.ts`（data.js QDATA） | **无题干文字** ⇒ `stem` 空、整图入 `images`、`cat`→`rule_type`（13 类） | rule_type⇒BELONGS_TO（规律维度） |
| **huasheng13** | `adapters/huasheng13.ts` | 文档 25 篇（references/examples），非题目 | 文档⇒知识点实体（BELONGS_TO 的目标端） |
| **kaogong-skill / sakib / developer2gwy** | 通用 `repoData.ts` DFS | 纯知识文档，无结构化题 | 仅资产登记（不产题） |
| **AdministrativeAptitudeTest** | 新增 PDF 解析器（**可选，K-7**） | 2000–2007 独有段；OCR/文本抽取 | APPEARS_IN |

**归一铁律（三条）**：

1. **图片只引用不复制** —— `images` 存 `{source, relPath, hash}`，二进制留在上游目录（L3 不做纪律）。
2. **HTML 剥除必须枚举字段** —— 凡剥 `<[^>]+>` 的调用点逐一判定业务语义，img 必须占位保留（cycle-22 教训）。
3. **可空字段不臆造** —— 五维标注（reasoning/fastest/pitfalls/mother/doubt/related）缺即空，**不用 0 或空串冒充**（㊲ 纪律）。

### 9c.4 服务端与客户端改造

**服务端**：新增 `src/server/poolApi.ts`（域工厂装配）+ `src/adapters/poolIngest.ts`（摄入）。

端点四步纪律（manifest → server → UI → smoke）：

```
GET  /api/pool/status         库状态/构建时间/各源覆盖/关系边数
GET  /api/pool/questions      多源分层抽题（source/module/kadian/count）
GET  /api/pool/search         跨源统一检索（FTS5 trigram + 跨源聚合去重）
GET  /api/pool/question/:id   单题聚合视图（一份题干 + N 处出处 + 关系邻居）
GET  /api/pool/relations      关系查询（rel_type/src/dst 过滤）
GET  /api/pool/graph          关系子图（知识点/同题/同材料的邻域）
POST /api/pool/rebuild        增量重建（按 source content_hash 判定）
POST /api/pool/review         人工校验写入（承接 review 语义）
```

**接入点**：`src/server/http.ts` 的 `buildDomains(root)` 内新增 `poolApi: makePoolApi({...})`（换根时随域重建，cycle-16 教训⑬）。

**客户端**：新增「统一题库」视图（收敛进专题枢纽，遵循「新增业务视图一律先问该不该进一级导航」纪律）；`VIEW_ROUTES` 加一行，组件自治 fetch，早退在所有 hook 之后（cycle-24 纪律）。

**兼容硬约束**：`/api/questions` 行为不变；新能力走 `/api/pool/*` 新端点；既有端点字段零删改。

### 9c.5 增量与重建策略

```
判定：source.content_hash 变化 ⇒ 该源需重解析；未变 ⇒ 跳过
粒度：文件级 asset.content_hash + mtime_ms ⇒ 只重解析变更文件
事务：单源一个事务，失败回滚该源（不留半成品源）
原子性：tmp 文件 + rename（cycle-18 ⑦ 内容寻址/原子写纪律）
幂等：UPSERT（qid/canonical_id 唯一键），连续两次重建结果必须完全相等
```

### 9c.6 实施阶段

| 阶段 | 交付 | 守卫 |
|---|---|---|
| **K-1** | `.kaogong.db` schema + 池摄入（先 naoku + xingcezhenti） | KGDB-01/02/03/07 |
| **K-2** | 关系层（kadian/material/related/doubt/mother + SAME_AS） | KGDB-03 |
| **K-3** | `/api/pool/*` 端点 + manifest 登记 + 能力对账 | KGDB-06 |
| **K-4** | 客户端「统一题库」视图（聚合题 + 出处 + 关系邻居） | render 旅程 |
| **K-5** | 分层抽题 + 五维标注贯通（**服务 #5**） | POOL-03/04 |
| **K-6** | 统一检索 + 图推桥接（**服务 #4**） | POOL-02 + FTS 命中 |
| **K-7**（可选） | PDF 2000–2007 OCR 段 | 抽样准确率门禁 |

> **SMOKE-KGDB-04（重建幂等）** 与 **SMOKE-KGDB-05（载体隔离）** 是本方案的两条命门：前者保证「可重建」不是口号，后者保证不误写上游投影库。

## 10. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 统一库体积增长 | 🟡 中 | L2 只索引文本；媒体走引用；设 FTS 裁剪/归档策略 |
| 入库吞吐与一致性 | 🟢 低 | 实测 0.56ms/题；增量按 hash+mtime；原子写 + fixtureHash |
| 上游变更导致索引过期 | 🟡 中 | 题库管理更新后触发增量重建；索引带 source head_sha 指纹 |
| 图推召回质量 | 🟡 中 | 人工核对环；gk-tuxing 走专项浏览兜底 |
| 模型依赖与离线冲突 | 🟡 中 | AI 增强一律可选；无模型时降级为「上传图片 + 手动关键词」 |
| PDF OCR 成本 | 🟡 中 | 默认不做（S4 可选），先登记后评估 |

---

## 11. 验收标准（Definition of Done）

1. `/api/unified/search` 一次查询可命中 **≥3 个源**（真题卷 + 深度题库 + 笔记库）的结果。
2. 同一道题在多源出现时，统一结果**去重为 1 条**，并列出 **N 处出处**。
3. 中文检索命中与 FTS5 trigram 实测一致（位置规律/十六宫格/三视图/同比增长/多面体）。
4. 全量入库吞吐 **≤ 1 ms/题**；统一检索响应 **< 50ms**。
5. 上游仓库**零修改**（git status 干净）。
6. 图搜题链路端到端可走通：上传图 → 模型特征抽取 → 跨源召回 → 人工核对 → 入错题本。
7. 模型选择器可自选 provider + model，且**不影响 DSH 主对话的模型选择**。
8. 既有端点字段零删改（向后兼容）。

---

*本文档结论基于 2026-11-18 实测：16 仓库规模测绘、`.naoku.db` schema 与 qid/appearances 统计、真题卷图推结构抽样、FTS5 中文 trigram 验证、DSH 官方知识库（llm-streaming / attachment / api-gateway / config-catalog）契约核实。*
