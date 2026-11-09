# 花生十三体系方法论适配库（METHODOLOGY）

> 状态：cycle-18 / v1.13.0 已交付。
> 事实基线：`src/shared/manifest.ts` 的 `HUASHENG13_META`（目录结构）与 `REPOS_META.huasheng13`（安装登记）；
> 运行时实现：`src/adapters/huasheng13.ts`（解析/索引/BM25/覆盖矩阵）+ `src/server/methodologyApi.ts`（6 端点）。
> 本文所有路径/行号/数字均取自当前仓库与实测输出，改代码后必须同步。

## 1. 定位与入口（用户明确要求：不设独立一级导航）

方法论视图**没有**独立的一级导航项。唯一入口是：

```
🎯 专题（topics） → 📖 方法论 分区（tab id = method）
```

| 事实 | 证据（可验证） |
|---|---|
| 专题枢纽分区表含 `method`，label「📖 方法论」 | `src/client/papers-view.ts:330-337` |
| 分区按钮用 `data-kg-hub-tab="method"` 锚定（测试与脚本定位用） | `src/client/papers-view.ts:357` |
| 分区主体 = 花生十三体系视图 `NativeHuasheng13View` | `src/client/papers-view.ts:553-556` |
| 主视图根节点带 `data-kg-hs13-root="1"` | `src/client/huasheng13-view.ts:1252` |
| 底部「▸ 另见：kaogong-skill 十主题方法论 + 深度题库母题精选」默认折叠 | `src/client/papers-view.ts:561-566` |
| 视图仍保留 `huasheng13` 深链分发（不新增一级导航项） | `src/client/client.ts:203,234`；manifest views 声明 `src/shared/manifest.ts:143` |

- 方法论主视图内部分五区：体系总览 / 目录浏览 / 检索 / 配套练习 / 白盒链路，分区锚点 `data-kg-hs13-tab`（`src/client/huasheng13-view.ts:38-43,1241`）。
- 「另见」区是 cycle-13 已有的 kaogong-skill 十主题 + 深度题库母题精选，**不是**花生十三体系；两者数据依赖不同，用折叠区隔开，避免读者误认为同一套内容。
- 白盒面板「📖 方法论链路」卡复用同一组三源端点（`src/client/obs-view.ts:602-633,985`）。

### 与 `/api/method`（kaogong-skill）的边界

| | 花生十三体系（本适配库） | kaogong-skill 方法论 |
|---|---|---|
| 端点 | `/api/huasheng13/*`（6 个） | `/api/method`、`/api/methods` |
| 数据来源 | 数据根 `huasheng13` 仓库（25 篇） | 数据根 `kaogong-skill` 仓库（10 主题） |
| tier | **required**（336KB） | **recommended**（3MB，已降级） |
| 未安装时 | 6 端点 `degraded:true` + 安装引导，绝不崩 | 目录缺失 → 空态/引导 |
| UI 位置 | 专题 → 方法论 **主视图** | 同分区底部「另见」折叠区 |
| AI 工具 | `kaogong_ai_method` | `kaogong_ai_tutor` / `kaogong_ai_shenlun` 的历史依赖 |

两者**不混用数据域**：方法论主视图不请求 `/api/method`；「另见」区不请求 `/api/huasheng13/*`。

## 2. 数据来源与授权声明

- 上游仓库：<https://github.com/WangJunqing-coder/huasheng13-skill>（`HUASHENG13_META.upstream`，`src/shared/manifest.ts:174`）。
- 内容基于花生十三公开教学体系整理；**速算方法（截位直除 / 415 份数 / 假设分配等）为公考培训行业通用方法，非任何一方独家版权**。该声明固化在 `HUASHENG13_META.attestation`（`src/shared/manifest.ts:175`），并由 catalog 端点原样透出（`src/server/methodologyApi.ts:376-379`）。
- 上游许可：MIT（仓库声明）。本插件只做解析、索引、检索与可视化，不修改语料内容，不重新分发语料（见 §3）。
- 语料总量：25 篇 Markdown（20 `references` + 5 `examples`），约 336KB（`REPOS_META.huasheng13.size`，`src/shared/manifest.ts:279`）。

## 3. 数据架构：为什么语料走数据根、不随包

**最终事实（覆盖任何旧任务书描述）：插件 npm 包内 `assets/` 只有图标与截图，不含任何方法论语料。**

| 场景 | 语料位置 |
|---|---|
| 开发/当前机器 | `D:\Projects\TraeProjects\kaogong\huasheng13`（与其它题库仓库同级的 git 浅克隆） |
| 安装态 | `<数据根>/huasheng13/{references,examples}/*.md`，由「📦 题库管理」统一下载 |
| npm 包内 | **不存在** `assets/huasheng13`；`files` 只收 `assets`（图标/截图） |

四条理由（用户明确要求统一配置）：

1. **数据来源单一化**：语料与其余 15 个题库走同一条安装/更新/删除链路，不存在「随包内置」旁路，避免同一份内容两个来源、两套版本。
2. **更新与卸载语义统一**：题库管理面板能刷新/删除语料；随包分发则只能等插件发版。
3. **包体与安装体验**：npm 包保持纯代码 + 图标/截图，不在安装期夹带内容数据。
4. **上游版权与分发边界**：语料归上游作者，由用户显式安装其仓库；插件不重新分发第三方内容（见 LICENSE 免责）。

代码事实：

- 解析根 = `repoRoot/META.root`：`src/server/methodologyApi.ts:224-229`（`META.root === 'huasheng13'`，`src/shared/manifest.ts:254`）。
- 数据根变更 → `rebuildDomains()` 重建域：`src/server/http.ts:55-68,79-82`（`methodologyApi: makeMethodologyApi({ pkgRoot, repoRoot: root, dataDir, store })`）。
- 统一登记：`REPOS_META.huasheng13 = { tier:'required', size:'336KB', upstream:… }`（`src/shared/manifest.ts:279`）。
- 仓库总数 **16**；必选 **3**：`huasheng13` / `xingcezhenti` / `gk-tuxing`；`kaogong-skill` 已从 required **降为 recommended**（`src/shared/manifest.ts:279-296`）。
- 无 `builtin` 旁路字段：smoke `SMOKE-RP-01c`（`smoke.test.mjs:326-329`）与反向旅程 `_tmp/journey-notinstalled.mjs` 均有断言。
- 包内不得携带语料：smoke `HS13-10`（`smoke.test.mjs:747-750`）。

## 4. 25 篇语料清单（模块 → 文件 → 职责）

> 目录：`<数据根>/huasheng13/references/*.md` 与 `<数据根>/huasheng13/examples/*.md`。
> 下表顺序 = `HUASHENG13_META.modules[].docs` 顺序 = UI 展示顺序 = 学习优先级（`src/shared/manifest.ts:177-239`）。

### 4.1 六模块（16 篇文档 + 5 篇练习）

| 模块 | 文档（references） | 职责 |
|---|---|---|
| 📊 资料分析 `ziliao` | `ziliao-fenxi.md` | ABRX 四要素体系（现期/基期/增长率/增长量互推与全部子题型公式） |
| | `ziliao-susuan.md` | 三大速算方法（截位直除 · 415 份数 · 假设分配）+ 分数比较/首尾数法 |
| | `ziliao-zonghe.md` | 综合分析题专项（题型分类/陷阱/提速蒙题） |
| | `examples/ziliao-lianxi.md` | 资料分析练习 10 题 |
| 🔢 数量关系 `shuliang` | `shuliang-guanxi.md` | 全题型解法（工程/行程/利润/排列组合/概率/容斥/最值/年龄/几何/溶液/牛吃草） |
| | `shuliang-gongshi.md` | 公式速查手册（十三类题型全部公式） |
| | `examples/shuliang-lianxi.md` | 数量关系练习 18 题 |
| 💬 言语理解 `yanyu` | `yanyu-lianjie.md` | 逻辑填空与片段阅读（语境/中心理解/细节/排序/篇章） |
| | `yanyu-ciyu.md` | 高频成语实词辨析（200+ 成语分类、易混、固定搭配） |
| | `yanyu-zhuanxiang.md` | 专项突破（一空/两空、标题填入、语句衔接）——**当前缺公式，是唯一真实覆盖缺口** |
| | `examples/yanyu-lianxi.md` | 言语理解练习 15 题 |
| 🧩 判断推理 `panduan` | `panduan-tuili.md` | 图形/定义/类比/逻辑四类规律体系与翻译推理公式 |
| | `panduan-guilv.md` | 规律速查手册（图形优先级/定义要素/类比关系/逻辑公式） |
| | `panduan-tuxing.md` | 图形推理专项（位置/样式/数量/属性、立体图形、训练方法） |
| | `examples/panduan-lianxi.md` | 判断推理练习 18 题 |
| 🌍 常识判断 `changshi` | `changshi-panduan.md` | 常识排除法体系（政治/法律/经济/历史/文化/地理/科技/时政） |
| | `shizheng-redian.md` | 时政热点积累（会议/战略/新质生产力/科技成就） |
| ✍️ 申论 `shenlun` | `shenlun.md` | 申论全题型（单一题/综合分析/提出对策/公文/大作文） |
| | `shenlun-biaoda.md` | 规范表达与金句（口语转规范/政府用语/论证素材） |
| | `shenlun-sucai.md` | 申论素材库（经济/乡村/民生/生态/文化/科技/治理） |
| | `examples/shenlun-lianxi.md` | 申论练习 13 题 |

### 4.2 跨模块策略层（3 篇，`references`）

| 文件 | 职责 |
|---|---|
| `strategy.md` | 答题顺序与时间分配（模块顺序/时间切块/选做蒙题/套题复盘） |
| `beikao-jihua.md` | 备考三阶段计划（30/60/90 天、在职/全职、分模块提分） |
| `cuoti-muban.md` | 错题本与复盘方法（通用+分模块模板、数字化管理） |

### 4.3 跨模块真题示例（1 篇，声明 `dir:'references'`）

| 文件 | 职责 |
|---|---|
| `references/zhenti-shili.md` | 各模块真题示例与解析。**必须注意**：上游实际落在 `references/`，曾误声明为 `examples/`；现已按磁盘事实声明（`src/shared/manifest.ts:251`），catalog `meta.dirMismatch` 应为空。 |

计数自证：3+1 + 2+1 + 3+1 + 3+1 + 2 + 3+1 = 16 篇文档 + 5 篇练习 + 3 策略 + 1 真题示例 = **25**（`HUASHENG13_CORPUS_COUNT`，`src/adapters/huasheng13.ts:47`）。

### 4.4 磁盘布局

```
<数据根>/huasheng13/
├── references/     # 20 篇：16 模块文档 + 3 策略 + 1 真题示例
│   ├── ziliao-fenxi.md … shenlun-sucai.md
│   └── strategy.md / beikao-jihua.md / cuoti-muban.md / zhenti-shili.md
└── examples/       # 5 篇：五科练习（常识判断无练习文件）
    └── ziliao-lianxi.md … shenlun-lianxi.md
```

## 5. `HUASHENG13_META` 是目录单一事实源：新增语料四步法

`HUASHENG13_META` 同时供三方消费，**任何一侧都不得再写文件名字面量**：

1. server 解析器：`buildFileRegistry()` 从 META 展平 25 条登记（`src/server/methodologyApi.ts:142-168`）；
2. client 视图：模块卡/目录树/缺口展示全部由 catalog 响应驱动（不硬编码文件表）；
3. 覆盖矩阵：D1 按 META 的 `modules[].docs/examples` + `dims` 分母（`src/adapters/huasheng13.ts:1065`）。

新增一篇语料的四步法（顺序不可省略）：

1. **放文件到数据根**：`<数据根>/huasheng13/{references|examples}/<id>.md`（真实目录必须与声明一致；目录偏差会被 catalog 的 `dirMismatch` 暴露）。
2. **登记 META**：在 `modules[].docs`（或 `strategy` / `examples`）加 `{ file, title, desc }`，`file` 是不带目录与 `.md` 的逻辑 id。若模块考核维度变化，同步 `dims`。
3. **索引快照失效**：适配层按 `fixtureHash`（25 个文件 `path+size+mtimeMs` 的 sha1）判断快照是否过期；新增/修改文件后哈希变化 → 自动重建，无需手工删快照。快照名 `.huasheng13-index.json`（`src/adapters/huasheng13.ts:67`），写入 `data/.huasheng13-index.json`，原子写（tmp+rename）。进程内缓存同样按 fixtureHash 复用（`buildIndex`，`src/adapters/huasheng13.ts:665`）。
4. **加 smoke 断言**：至少补 `HS13-01`（docCount/逐篇 present）与 `HS13-10`（磁盘 ↔ META 双向零漂移、包内无语料）；若新增模块还要补 `HS13-06` 覆盖矩阵断言与 render 分区断言。断言口径见 [TESTING.md](./TESTING.md) §HS13。

**反例（会被白盒点亮）**：只在磁盘放文件不登记 META → `orphans`；只在 META 登记但文件缺失 → `available < docCount`、`missing[]` 非空、`degraded:true`；声明目录与实际目录不符 → `dirMismatch`。

## 6. 检索：BM25 + 中文 bigram/单字双粒度

### 6.1 参数与公式

| 项 | 值 | 证据 |
|---|---|---|
| BM25 `k1` | 1.2（词频饱和） | `src/adapters/huasheng13.ts:54` |
| BM25 `b` | 0.75（文档长度归一） | `src/adapters/huasheng13.ts:55` |
| 字段权重 | title ×3.0 / heading ×2.0 / body ×1.0 | `FIELD_WEIGHTS`（同文件；实测导出 `{"title":3,"heading":2,"body":1}`） |
| 中文分词 | **字符 bigram + 单字** 双粒度（零依赖，无词典） | `tokenize`，`src/adapters/huasheng13.ts:238` |
| 单字查询权重折扣 | 单字噪声大，查询侧压低（`UNIGRAM_WEIGHT`） | 同文件常量注释 |
| 短语加成 | `PHRASE_BOOST` | 同文件 |

打分式（源码注释 `src/adapters/huasheng13.ts:846`）：

```
score(q,d) = Σ_t qw(t) · idf(t) · [ tfW(t,d)·(k1+1) ] / [ tfW(t,d) + k1·(1−b + b·lenW(d)/avgLenW) ]
```

中文没有空格边界，bigram 保精度（「截位」「位直」「直除」），单字保召回；英文/数字按词并小写化。复杂度 O(查询词数 × 命中倒排的文档数)，25 篇语料下为亚毫秒级。

### 6.2 端点层收尾：尾部裁剪 + 三档置信度（不丢结果）

服务端在 BM25 之后只做**尾部裁剪**，不改排序、不淘汰首条（`src/server/methodologyApi.ts:483-486,590-600`）：

```
floor = max(1.0, topScore × 0.15)      # SEARCH_ABS_FLOOR / SEARCH_REL_CUT
results = results.filter((r,i) => i === 0 || r.score >= floor)
```

- `confidence` 三档：`high` = 查询整串（去空白）真的出现在某篇语料里（`phraseHit:true`）；`medium` = 全部 token 在同篇共现但不相邻；`low` = 只有部分 token 命中。
- **低置信度结果不丢弃**：中文 bigram 对生造词必然产生双字噪声（「不存在的词」→「不存/存在/在的/的词」），服务端把判断权交给 UI/调用方，并附 `note` 提示。
- 空查询 `q=''` 返回 `{results:[]}`，且不计入检索命中率分母（`empty` 单独统计）。

实测（当前数据根，端点口径 `limit` 默认 10）：

| 查询 | 命中 | 首条 | confidence | 说明 |
|---|---|---|---|---|
| `截位直除` | 7 条 | `ziliao-susuan`（三大速算方法） | `high`（`phraseHit:true`，coverage=1） | 整串真实落在语料里 |
| `假设分配` | 命中 `ziliao-susuan` | 同左 | `high` | 速算方法命中 |
| `隔板法` | 2 条 | `shuliang-guanxi` | `high` | 长尾被裁掉（10 → 2） |
| `不存在的词` | 10 条 | `shenlun-biaoda` | `low` | bigram 噪声，**保留**并提示「仅有部分查询词命中」 |
| `ABRX` | 3 条 | `ziliao-fenxi` | `high` | 英文缩写按词匹配 |

> 实测原话：raw BM25 候选 25 条，裁剪后 `rawTotal/filtered/total` 自洽；smoke `HS13-03/04` 固化这些口径（`smoke.test.mjs:496-551`）。

## 7. 覆盖矩阵口径（`coverage.overall = 0.9756`）

### 7.1 定义

- 每个模块有**适用维度** `dims = { formula, table, example }`，来自 `HUASHENG13_META.modules[].dims`；未声明 = 三维全适用（`resolveDims`，`src/adapters/huasheng13.ts:991-1026`）。
- `expectedDims = docCount × (适用维度数)`；`presentDims` = 已满足的维度计数（表格存在且 >0、公式存在且 >0、配套示例存在）。
- `coverage = presentDims / expectedDims`，四舍五入到 4 位；`overall = ΣpresentDims / ΣexpectedDims`（**全局比率**，不是六模块覆盖率的算术平均——当前 40/41=0.9756，而模块均值约 0.9815，两者不同）。
- **`dims` 的意义**：常识判断与申论本来就不考公式，用统一三维会给它们判 33%/67% 的**假阴性**，让白盒面板对健康模块持续告警（与 v1.8 遥测假阳性同族错误）。因此 `changshi` 的 `dims.formula=false, example=false`（2 维）、`shenlun` 的 `dims.formula=false`（3 维中的 2 维适用：表格+示例）。见 `src/shared/manifest.ts:220-222,231-233`。

### 7.2 实测值（当前数据根，2026-11 实测）

| 模块 | docCount | 适用维度数 | expectedDims | presentDims | coverage | 缺口 |
|---|---|---|---|---|---|---|
| 资料分析 `ziliao` | 3 | 3 | 9 | 9 | **1** | — |
| 数量关系 `shuliang` | 2 | 3 | 6 | 6 | **1** | — |
| 言语理解 `yanyu` | 3 | 3 | 9 | 8 | **0.889** | `yanyu-zhuanxiang 缺公式` |
| 判断推理 `panduan` | 3 | 3 | 9 | 9 | **1** | — |
| 常识判断 `changshi` | 2 | 2 | 2 | 2 | **1** | — |
| 申论 `shenlun` | 3 | 2 | 6 | 6 | **1** | — |
| **合计** | | | **41** | **40** | **overall 0.9756** | 1 条真实缺口 |

**口径纪律**：

- `0.9756 = 40/41`，不是「全覆盖」；`yanyu 0.889` 是**真实缺口**（专项突破篇没有公式），不是缺陷、不是 bug，也不允许为了凑绿改断言到 1.0。smoke `HS13-06` 明确断言「≠1：yanyu 缺公式是真实缺口，不凑绿」（`smoke.test.mjs:585-590`）。
- 反过来也不允许把「有缺口」当缺陷报障：缺口清单 `gaps[]` 是诚实度量的一部分，UI 以提示而非告警呈现。
- 覆盖率的 `expectedDims/presentDims` 与 `modules[].missing` 由适配层给出，server 只做骨架补齐（META 漏算的模块补零而不是消失，`src/server/methodologyApi.ts:650-674`）。

## 8. 配套练习口径（74 题）

- 解析规则：`## 练习 N` 分块（`parsePractice`）；「## 一、图形推理」这类分类标题**不计**为单题（端点 `note` 会说明）。
- `total` = 文件内总题数；`n` 是本次抽取上限（默认 5，1..50）；`returned` / `hasMore` 显式返回，避免把 `n` 误读成题库总量（`src/server/methodologyApi.ts:756-786`）。
- **判分可行性以 `answerIsLetter` 为准**：只有答案形态是 A–D 字母才能本地自动比对；文字作答题（数量关系全部、申论全部、判断推理部分、资料/言语少量）页面只提供「查看解析 + 自评」，**不臆造字母答案**（`src/client/huasheng13-view.ts:16-25` 的分支注释）。

实测分布（5 个练习文件，共 **74** 题）：

| 练习文件 | 题数 | 字母答案（可自动判分） | 文字作答（走自评） |
|---|---|---|---|
| `examples/ziliao-lianxi.md` | 10 | 8 | 2 |
| `examples/shuliang-lianxi.md` | 18 | **0** | **18** |
| `examples/yanyu-lianxi.md` | 15 | 14 | 1 |
| `examples/panduan-lianxi.md` | 18 | 10 | **8** |
| `examples/shenlun-lianxi.md` | 13 | **0** | **13** |
| **合计** | **74** | **32** | **42** |

> 文档不得写「74 题全部可自动判分」。数量关系 18 / 申论 13 / 判断推理 8 是明确的文字作答，资料 2 / 言语 1 同样按 `answerIsLetter:false` 处理。smoke `HS13-07` 断言答案形态自洽与「数量关系 18 题全为文字作答」（`smoke.test.mjs:607-650`）。

## 9. 未安装时的诚实降级（6 端点）

数据根下没有 `huasheng13` 时，方法论域**不崩、不伪造**：

| 端点 | 降级表现 |
|---|---|
| `catalog` | `meta.degraded:true`、`available:0`、`declaredByAdapter:25`（声明规模不撒谎）、`error` 指向「📦 题库管理」安装 huasheng13；六模块骨架仍返回（每篇 `present:false`、统计为 0） |
| `doc` | `{error, degraded:true}`（缺 file / 未知 file 还附 `known` 全量清单） |
| `search` | `{results:[], degraded:true, error}`，不计入 hit |
| `coverage` | `overall:0`、`degraded:true`、`gaps` 列出 `no-corpus` |
| `practice` | `{items:[], total:0, degraded:true, error}` |
| `trace` | `corpus.dirPresent:false`、`corpus.degraded:true`、`corpus.error`，其余计数结构照常 |

- 降级索引每 **3s** 重试（`IDX_DEGRADED_RETRY_MS`，`src/server/methodologyApi.ts:240`）；语料安装完成后**无需重启**即可自愈（反向旅程实测：装好后 `degraded=false`、`available=25`、检索恢复）。
- 反向旅程脚本：`_tmp/journey-notinstalled.mjs`（本地 scratch，不入 npm 包），15 条断言覆盖「16 仓库登记 / huasheng13 缺失 / 无 builtin / catalog 降级 / declaredByAdapter=25 / error 引导 / doc 报错 / search 空 / coverage 降级 / 装后自愈 3 条」。
- `declaredByAdapter` 与 `docCount` 是两个不同字段：前者是适配层常量 25（声明规模），后者是 META 展平条数 25；磁盘可用数看 `available`，缺失看 `missing[]`。

## 10. 事实源口径与已知文案残留

- 计数一律以注册表条目为准：`REPOS_META` **16** 仓库、`CAPABILITIES.endpoints` **57** 端点、`CAPABILITIES.tools` **6** 工具、`CAPABILITIES.views` **16** 视图（`node -e` 导入 manifest 实测）。
- `src/shared/manifest.ts` 内有三处历史计数未清理（前两处**仅注释**；`:40` 是 lifecycle 的 `desc` 文案，会被 `/api/lifecycle` 展示给白盒面板，**属于用户可见漂移**）：`:40` 写「4 个 AI 工具注册」（实际 6 个）、`:149` 写「15 仓库」、`:268` `SELF_META.desc` 写「15 开源仓库」。README/docs 已按 6 工具 / 16 仓库表述；这三处待有权限者随下轮代码改动一并清理（本任务仅获准改 manifest 的版本行，故未动）。
- 方法论域端点键**永远**是相对挂载点的逻辑路径 `/api/huasheng13/*`，不得拼 `/kaogong` 前缀（v1.8 白盒假阳性事故根因；smoke `HS13-02`/`HS13-10` 双重守卫）。

## 11. 相关文档

- 端点契约与 degraded 字段：[API-REFERENCE.md](./API-REFERENCE.md) §七
- 域链装配与数据根重建：[ARCHITECTURE.md](./ARCHITECTURE.md) §3
- HS13-01..10 / C18-01..08 / 反向旅程：[TESTING.md](./TESTING.md)
- client 前缀与导航纪律：[CONVENTIONS.md](./CONVENTIONS.md) §2.2
- 市场条目与合规：[MARKETPLACE-ENTRY.md](./MARKETPLACE-ENTRY.md)