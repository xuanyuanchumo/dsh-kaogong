---
title: 统一题目池（`.kaogong.db`）· 开发规范与设计契约
status: current
updated: 2026-11-26
---
# 统一题目池（`.kaogong.db`）· 开发规范与设计契约

> cycle-34 阶段 1 · 存储层（L3）+ 适配层（L2）落地
> 研究依据：[../../docs/research/13-kaogong-db统一知识库.md](../../docs/research/13-kaogong-db统一知识库.md) ·
> [../../docs/research/14-内核边界契约.md](../../docs/research/14-内核边界契约.md) ·
> [../../docs/research/15-全局整合分析.md](../../docs/research/15-全局整合分析.md)
> 设计契约：[../../docs/design/unified-storage-architecture.md](../../docs/design/unified-storage-architecture.md) §9c

**当前基线**：v1.30.0 / cycle-35（76 端点 · 16 视图 · 6 工具；统一库 **51211 题 / 346797 关系边 / 141489 出处 / 10588 知识节点**；schema v2 含 knowledge 表 + USES_METHOD/REFERENCES_DOC 关系；**9 摄入源**全注册）

---

## 0. 一句话

> 把「散落 16 个第三方仓库的题库」收敛成「**一张可查询、可重建、跨源去重的知识库**」。

---

## 1. 四层依赖（研究 14 · 只能向下，不得越级）

```
L4 内核层（Kernel）   SRS / 图谱算法族 / 判分闭环 / 抽题权重
   ↓ 只依赖 L3 接口契约；不认识文件系统与第三方格式
L3 存储层（Store）    .kaogong.db —— 唯一的题/关系/资产事实源
   ↓ 只依赖 L2 适配接口；不认识第三方目录结构
L2 适配层（Adapter）  poolSources 注册表 + poolSourceImpls + 既有 8 adapter
   ↓ 只依赖 L1 的只读引用
L1 数据源层（Source）  16 个第三方仓库（只读，永不修改）
```

**六条不变量（已机器化为 `SMOKE-KERNEL-01..06b`）**：

| # | 不变量 | 守卫 |
|---|---|---|
| I1 | 内核层禁 fs 读 | `SMOKE-KERNEL-02` |
| I2 | 内核层禁第三方目录名字面量 | `SMOKE-KERNEL-03` |
| I3 | 媒体一律经存储层 `media_ref`，禁裸拼第三方路径 | `SMOKE-KERNEL-04` |
| I4 | 客户端禁 fs 读（取数只走端点） | `SMOKE-KERNEL-01` |
| I5 | 第三方仓库零写（只读整合） | `SMOKE-KERNEL-06` / `06b` |
| — | 抽题请求路径零文件读（存储层优先） | `SMOKE-KERNEL-05` / `05b` |

---

## 2. 文件清单（改动前先看这里）

| 文件 | 层 | 职责 | 行数级 |
|---|---|---|---|
| `src/adapters/poolDb.ts` | L3 | schema / 连接 / UPSERT / canonical_id / 事务 | ~380 |
| `src/adapters/poolSources.ts` | L2 | **源注册表**（可扩展性枢纽） | ~140 |
| `src/adapters/poolSourceImpls.ts` | L2 | 题目源实现（naoku / xingcezhenti） | ~420 |
| `src/adapters/poolSourceJson.ts` | L2 | JSON 题目源实现（xingce-app / gk-tuxing / qiuzhao / cea） | ~230 |
| `src/adapters/poolSourceKnowledge.ts` | L2 | 知识层实现（方法论 / kadian 考点 / 文档资产） | ~230 |
| `src/adapters/poolUpsert.ts` | L2 | 共享 UPSERT（只填空位合并语义单一事实源） | ~120 |
| `src/adapters/poolIngest.ts` | L2 | **编排器**（重建/增量重建） | ~120 |
| `src/server/poolApi.ts` | 服务端 | `/api/pool/*` 九端点 + 供数给练习链路 | ~470 |
| `src/server/poolObservability.ts` | 服务端 | 白盒健康快照 + 摄入诊断 | ~190 |
| `src/client/views/pool-view.tsx` | 客户端 | 「🗄️ 统一题库」视图 | ~400 |

> **分工纪律**：`poolIngest.ts` **不含**任何源的具体逻辑（否则每加一个源都要改主流程）。
> 源清单在 `poolSources.ts`，源实现在 `poolSourceImpls.ts`。

---

## 3. Schema（`POOL_SCHEMA_VERSION = 1`）

```
meta(k,v)                       —— schema_version / built_at / source_fingerprint / ingest_stats / source_registry
source(id,tier,upstream_url,…)  —— 源目录（只读登记）
asset(id,source_id,rel_path,…)  —— L1 资产账本（文件级引用，不复制）
question(…)                     —— 统一题目池（canonical_id UNIQUE）
question_source(…)              —— 一题多出处（跨源聚合）
relation(rel_type,src_*,dst_*,weight,evidence)  —— 统一边表（10 种 rel_type）
material(mid UNIQUE,…)          —— 共享材料实体
question_fts                    —— FTS5 trigram（content='question' 外部内容表）
study_event(…)                  —— 用户态学习事件
review(canonical_id PK,…)       —— 人工校验
```

### 3.1 canonical_id 派生（统一口径）

```
q:<qid>   优先（跨仓 327/327 = 100% 一致，qid 是最强键）
fp:<fp>   次之（同 fp 多 qid 仅 3 例 / 28669）
h:<sha256前16>  兜底（二者皆缺时）
```

**实现**：`poolDb.ts` 的 `deriveCanonicalId(qid, fp, stem)`。
**注意**：上游 `fp` 实测是 **SHA-1 40-hex**（不是 SHA-256）——不要写错算法。

### 3.2 关系类型词表（10 种 · 统一边表）

| rel_type | 含义 | 权重语义 |
|---|---|---|
| `SAME_AS` | 同一道题的跨源等价 | qid 佐证权重更高 |
| `APPEARS_IN` | 题 → 试卷出处 | 1.0 |
| `BELONGS_TO` | 题 → 知识点(kadian) | 1.0 |
| `IN_MODULE` | 题 → 模块/题型 | 1.0 |
| `HAS_MATERIAL` | 题 → 共享材料 | 1.0 |
| `RELATED_TO` | 题 → 题（同类/衍生） | 1.0 |
| `HAS_DOUBT` | 题 → 疑点 | 1.0 |
| `DERIVED_FROM` | 题 → 母题 | 1.0 |
| `SAME_REGION` | 题 → 地区/年份 | 1.0 |
| `REVIEWED` | 题 → 人工校验 | 1.0 |

**新增关系类型的唯一动作**：① `poolDb.ts` 的 `REL_TYPES` 加一项；
② `poolObservability.ts` 的 `REL_TYPE_META` 加一项（label/color/desc）；
③ **零 DDL 迁移**（统一边表）。
未在 `REL_TYPE_META` 登记的类型会在白盒面板标 ⚠（`SMOKE-KGDB-06` 关系词表对账）。

---

## 4. 归一铁律（设计 §9c.3 · 三条）

1. **图片只引用不复制** —— `images` 存 `{source, relPath}`，二进制留在上游目录（L3 不做纪律）。
2. **HTML 剥除必须枚举字段** —— 剥 `<[^>]+>` 的调用点逐一判定业务语义，**img 必须占位保留**
   （`kgimg://<相对路径>`）。工具：`poolSourceImpls.ts` 的 `stripHtmlKeepImg`。
3. **可空字段不臆造** —— 五维标注缺即空，**不用 0 或空串冒充**（㊲ 纪律）。

---

## 5. 可扩展性：新增一个数据源

**三步，主流程零改动**：

```ts
// ① src/adapters/poolSourceImpls.ts
export function ingestXxxSource(ctx: any): any {
  const { repoRoot, db, opts } = ctx
  // …解析上游格式 → 写 question / question_source / relation
  return { questions: n, relations: m }
}

// ② src/adapters/poolSources.ts 注册表加一条
{
  id: 'xxx', tier: 'optional', label: '新题库（owner/repo）',
  upstream: 'https://github.com/owner/repo',
  available: (ctx) => existsSync(join(ctx.repoRoot, 'xxx')),
  ingest: (ctx) => ingestXxxSource(ctx),
}

// ③ 完成。自动生效：
//   · 摄入主流程（ingestAll 遍历注册表）
//   · /api/pool/status 的 registry 快照（面板自动列出）
//   · 白盒面板的「已注册源」区
//   · /api/pool/questions?source=xxx 过滤
```

**守卫**：`SMOKE-KGDB-08`（源清单在注册表，编排器零硬编码）· `SMOKE-KGDB-08b`（源规格字段齐备）。

> ⚠️ **注册表 `ingest` 必须 `await`**：`await spec.ingest(ctx)`。
> 漏 await 会展开 Promise 对象 → 计数全丢 → **静默少摄入**（cycle-34 实测踩坑）。

---

## 6. 可观测性：白盒健康快照

`GET /api/pool/health` → `poolObservability.ts` 的 `poolHealth(db)`。

| 区块 | 内容 | 用途 |
|---|---|---|
| `tables[]` | 10 表的行数 | 一眼看出哪个表空/爆 |
| `relTypes[]` | 关系类型分布（含 label/color/known） | 关系词表对账 |
| `modules[]` / `sources[]` | 模块分布 / 各源题数与出处数 | 覆盖度 |
| `quality[]` | 8 项数据质量指标（**每项附判据 SQL**） | 可解释的质量面板 |
| `topKadian[]` | Top 知识点（边数降序） | 弱项诊断入口 |

**8 项质量指标**：身份唯一 / 知识点覆盖 / 五维标注 / 配图覆盖 / 跨源聚合 / 出处完整 / 无自环边 / 关系词表齐备。

**纪律**：
- **只读**：观测绝不写库；失败一律降级为「不可用」而非抛错。
- **口径唯一**：数字全部来自同一查询源，客户端不二次裁剪、不自报数字（cycle-20 教训㊼）。
- **不臆造**：不可探测的量用 `null`（降级）而非 `0`（撒谎）（cycle-20 教训㊻）。

---

## 7. 性能纪律

| 事项 | 实测 | 纪律 |
|---|---|---|
| 全量摄入（27506 题 + 22 万边） | **41s**（事务内） | **单源一个事务**；无事务时 421s（逐条 fsync） |
| FTS5 trigram 检索 | **19–38ms** | 候选集上限 500；`bm25()` 排序 |
| FTS5 rebuild（5 万行） | 311ms | 摄入后统一 rebuild |
| 库体积 | ~399MB | 媒体走引用不复制 |

**事务纪律**（`poolDb.ts` 的 `withTx`）：单源一个事务，失败回滚该源，不留半成品源。

---

## 8. 兼容硬约束（违反即回归）

1. **既有端点字段零删改** —— `/api/questions` 行为不变；新能力走 `/api/pool/*`。
2. **`/api/questions` 形状不变** —— 走存储层后仍返回 `{options:{A:文本}, correctAnswer, stem(含 kgimg://), paperFile, source, module, ...}`。
3. **`source` 字段回填真实上游源名**（`xingcezhenti`/`naoku`/`gk-tuxing`），**不可用 `'pool'` 之类中性地名**
   —— 客户端 `KG_SOURCE_META` 按源名渲染出处徽章。
4. **端点用查询参数而非路径参数**（`/api/pool/question?id=` 而非 `/api/pool/question/:id`）
   —— 能力对账以**精确路径**集合为准，路径参数端点会被判成「影子端点」制造假漂移。
5. **合并语义「只填空位」** —— 跨源命中同一 canonical_id 时，naoku 先入库的五维标注**不得**被后到的
   xingcezhenti 覆盖洗掉（UPSERT 用 `CASE WHEN LENGTH(现有) > 0 THEN 现有 ELSE 新值 END`）。

---

## 9. 存储层供数（I5/KERNEL-05 违规收敛）

```
/api/questions ──► getRandomQuestions(root, module, count, pool)
                        │
                        ├─ pool.sampleQuestions()  ← 存储层优先（请求路径零 fs 读）
                        │     · 优选带图题（kgimg:// 占位保留）
                        │     · options 归一 {A:文本}（naoku 数组形态 → 同形）
                        │     · answer → correctAnswer 映射
                        └─ 目录解析回落（池未就绪时的唯一数据源，受控降级）
```

**守卫**：`SMOKE-KERNEL-05`（存储层优先的代码形态）· `SMOKE-KERNEL-05b`（池供数路径零 fs 读）。

---

## 10. 常见坑速查

| 症状 | 根因 | 正解 |
|---|---|---|
| 摄入「成功」但题数为 0 | 注册表 `ingest` 漏 `await` | `await spec.ingest(ctx)` |
| 摄入 421s | 无事务（逐条 fsync） | 单源一个事务 |
| 只摄入 8 个文件 | `break` 只跳内层循环 | 标签 `break outer` |
| `distinctQid` 恒为 0 | SQL 用双引号空串（SQLite 视为标识符） | 用 `LENGTH(x) > 0` |
| 端点被判「影子端点」 | 路径参数端点与 manifest 精确路径不匹配 | 改用查询参数 |
| 出处徽章显示「未知来源」 | `source` 填了 `'pool'` | 回填真实上游源名 |
| 库打开失败 | 顶层 `import 'node:sqlite'`（旧 Node 整插件加载失败） | 动态 `await import('node:sqlite')` |
| 重建后孤儿题 | 上游 `appearances` 不覆盖全部题 | 用题自身 paper/region/year 兜底登记 |
| 五维标注被洗掉 | 后到的源覆盖了先到的富字段 | UPSERT 只填空位 |

---

## 11. 验证方式（可运行）

```bash
cd dsh-kaogong && npm run build && npm run test:all
# smoke 404/404 · render 66/66

# 重建 + 幂等验证（连续两次，池条目数与边数必须完全相等）
node -e "import('./dist/adapters/poolIngest.js').then(async m => {
  const a = await m.rebuildPool(process.cwd()+'/..', process.env.USERPROFILE+'/.dsh/kaogong', {rebuild:true})
  const b = await m.rebuildPool(process.cwd()+'/..', process.env.USERPROFILE+'/.dsh/kaogong', {rebuild:true})
  console.log('idempotent:', a.stats.questions===b.stats.questions && a.stats.relations===b.stats.relations)
})"
```

---

*本文结论基于 2026-11-18 实测：`.naoku.db` 真实 schema（questions 28 列 / appearances 10 列 / materials 4 列 / review_verified 9 列；27506 + 58890 + 1578 + 53 行）、qid 唯一性（27506 distinct = 27506 total）、fp 为 SHA-1 40-hex、摄入性能 421s→41s（事务）、检索 19–38ms、库 399MB。*
