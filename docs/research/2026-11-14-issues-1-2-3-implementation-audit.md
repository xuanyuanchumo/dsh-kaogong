# 研究报告：Issues #1/#2/#3 关闭说明与实现的全量核对审计

**报告时间**：2026-11-14 23:25（北京时间）
**性质**：静态核对审计（GitHub 议题正文 × 本地源码 × smoke/render 守卫 × npm 发布线），**本次不修改任何代码**；结论与缺口以「文件:行号」可回溯。
**范围**：xuanyuanchumo/dsh-kaogong 三个已关闭议题（发起者均为 yyscream，均无评论线程，细节全在议题正文）：

| 议题 | 标题 | 关闭版本 | 关闭说明承诺要点 |
|---|---|---|---|
| #1 | 专题行测练习入口进入刷题选择判断推理带有图片的题目未显现 | v1.17.0（cycle-21/22/23） | kgimg 占位化全字段、材料图归属、/api/kg-img、扩展名探测回退 |
| #2 | 市场升级失败后改命令升级，已下载题库消失（默认数据存于包内） | v1.16.0（cycle-21） | 数据根外置、启动原子迁移、/api/data-location 白盒、「已下载题库不再消失」 |
| #3 | 支持纸质刷题记录补录（匹配现有题库、记录历史对错并接入错题复习） | v1.16.0 交付 → v1.30.0 根治 | 三通道搜索、三态补录、错题入 SRS、批次撤销、双入口 |

**发布线现状**：npm `dsh-kaogong` latest = **1.30.0**（本审计时实查）；本地 package.json 同步 1.30.0；HEAD = d08bf18（cycle-33）。

---

## 一、Issue #1（带图题不显示）——已实现，承诺逐条兑现

### 1.1 承诺 → 实现证据

| 关闭说明承诺 | 实现证据（文件:行号） | 判定 |
|---|---|---|
| `<img>` 不再一刀切剥掉 → `kgimg://` 中立占位 | `src/adapters/repoData.ts:82-90`（neutralizeImages，真题卷链路）；`src/adapters/naoku.ts:220-233`（stripHtmlKeepImg，深度题库链路） | ✅ |
| stem/options/analysis/reasoning/fastest/pitfalls/mother 全字段占位化 | `src/adapters/naoku.ts:136-154`（naokuQuestions 映射链）；`:251-252`（parseOptions 选项含图占位化，「同文件不留幸存者」）；`src/adapters/repoData.ts:90` | ✅ |
| 材料图按「题块前最近有图材料段」归属附题干（1479 个含图材料块） | `src/adapters/repoData.ts:61-73`（matImgTable 偏移表 + 注释）、`:117-147`（归属逻辑：题块自身无图才附，防重复） | ✅ |
| `/api/kg-img` 二进制端点 + 扩展名探测回退（DB 记 .webp、磁盘全 .png） | `src/server/http.ts:114-124`（serveKgImage 注释与安全模型：resolve 归一 + 白名单 + basename 换扩展名兜底）、`:624` `:675`（双路由注册）、manifest 补登记（SMOKE-IMG22-02，smoke.test.mjs:1308） | ✅ |
| RichText 渲染时占位改写为绝对 URL（落盘与端口/挂载无关） | `src/client/ui-kit.tsx:74-102`（`【图:kgimg://…】`→`MOUNT_PATH + '/api/kg-img?p='`）；`:180-183`（选项文本含 kgimg:// 时走 RichText 出图） | ✅ |
| 材料与题干字段分离（不拼接，避免 SRS 快照不可复现 + 双重渲染） | `src/adapters/naoku.ts:129-134`（SELECT 补 material/material_ref + 移除 img_refs 追加的 300 题抽检依据）、`:160-162`（material/materialRef 透出） | ✅（cycle-23 追加承诺） |

### 1.2 「能实现的已实现、不能实现的如实说明」部分

- **图形推理选项图（上游数据源限制）**：2728 道图形推理题的选项在上游数据里就是纯字母 A/B/C/D（选项图未随上游收录）。实现选择了**诚实降级提示**而非虚构：`src/client/views/study-view.tsx:292-355`（lettersOnly 判定 + 「选项配图未随上游收录」提示条 + cycle-22 选项占位计数防误报，`:351` 含 optImgCount 的部分恢复文案）。
- **替代入口已存在**：图形推理专项库 gk-tuxing（354 题，题图完整，走 `/api/tuxing-img`）——`src/adapters/tuxing.ts:2-11, 113-124`。用户要「看图做图形推理」可走专项入口。
- **守卫**：SMOKE-IMG22-01..04（smoke.test.mjs:1298-1384，含真实题库跨模块抽题占位 + kg-img 200/MIME 扩展名回退）；沙箱 Playwright 端到端 naturalWidth=678（INCIDENTS R28b 记录，docs/agents/INCIDENTS.md:179-184）。

**结论：issue #1 关闭说明的所有承诺均已实现且可回溯；选项图属数据源限制，已有诚实降级 + 专项库替代。无未兑现承诺。**

---

## 二、Issue #2（升级丢数据）——核心已实现；发现一处「关闭说明过度承诺」缺口

### 2.1 承诺 → 实现证据

| 关闭说明承诺 | 实现证据（文件:行号） | 判定 |
|---|---|---|
| 数据根外置 `~/.dsh/kaogong/`（KG_DATA_DIR / DSH_HOME 感知） | `src/server/dataRoot.ts:36-45`（解析优先级 env > DSH_HOME/kaogong > ~/.dsh/kaogong）；`:47` DEFAULT_MANAGED=外置根/repos；`:49` PROGRESS_DIR_USER；`src/server/http.ts:47`（DATA_DIR=USER_DATA_ROOT，`.naoku.db` 等运行时数据落外置根，`:80` initNaoku 注入） | ✅ |
| 启动原子迁移（tmp+rename、跨卷 cp 回退删源、MIGRATED_MARK 幂等） | `src/server/dataRoot.ts:136-150`（moveEntry：rename 失败→cp 到 tmp→rename→删源）；`:157-213`（migratePkgData 决策树；`:160` 幂等短路；`:204` 标记落盘） | ✅ |
| 失败只读降级，绝不删源 | `dataRoot.ts:191-195`（单条目失败即 break，剩余保持原位）；`moveEntry` catch 不删源（`:146-149`）；目标已存在时字面一致才删源、否则保留源「宁多勿丢」（`:169-187`） | ✅ |
| lifecycle 环形日志特殊语义（保留新根删源） | `dataRoot.ts:122-132`（pkgMigrateEntries 注释）、`:183-186`（lifecycle 分支） | ✅ |
| `/api/data-location` 白盒透出 userDataRoot/source/migration | `src/server/http.ts:535`；`dataRoot.ts:216-228`（含 pkgResidual 残留探测） | ✅ |
| 旧配置 root 指向包内 repos → 改写为新外置目录 | `dataRoot.ts:198-203`（legacyRepos 比对 + writeReposConfig 改写） | ✅ |
| SMOKE-DX-01..06 回归守卫 | `smoke.test.mjs:1145-1167`（白盒端点 / 数据根不在包内 / 迁移词表 / DATA_DIR 派生 / 迁移幂等与失败保护 / manifest 闭环） | ✅ |

### 2.2 ⚠️ 缺口：关闭说明「已下载题库不再消失」对一批真实用户不成立

**事实链**（全部可回溯）：

1. 迁移条目白名单只有四类：`progress/`、`repos-config.json`、`study-plan.md`、`lifecycle.jsonl`——**不含 `repos/`（已下载题库本体）**（`dataRoot.ts:126-132`；`:107-109` 注释显式说明缓存快照不迁，但 repos 本体同样不在列）。
2. `/api/data-location` 的 pkgResidual 探测同样只列这四类（`dataRoot.ts:126-132` 被 `:225` 复用）→ **包内若遗留 GB 级题库本体，白盒报告与面板都不会提示**。
3. 根因改写只发生在 `cfg.root` **恰好指向** `<pkg>/data/repos` 时（`dataRoot.ts:198-203`）；且改写注释「旧根数据已随 progress 语义搬迁」与实际不符——**repos 本体并未搬迁**，root 改写后 UI 显示 0/16（新外置根为空）。

**场景推演**：

- **场景 A（v1.16+ 新装用户）**：一键克隆直接下载到 `~/.dsh/kaogong/repos`（DEFAULT_MANAGED，`dataRoot.ts:47`）→ 升级整目录替换零影响 → **关闭说明成立** ✅。
- **场景 B（≤v1.15 装机、题库下在包内 `data/repos/`）**：升级到 v1.16+ → 启动迁移搬走四类用户数据 + 改写 root → 题库本体仍留在包内（UI 已不可见）→ **下一次升级整目录替换时物理删除，无法找回** → 只能重新一键克隆（GB 级重下）。迁移器不搬、白盒不提示、UI 无「迁移旧题库」入口 → **关闭说明「命令升级后打开插件即自动完成迁移，已下载题库不再消失」对该批次用户过度承诺** ⚠️。

**定性**：P2 边界缺口。不是回归（v1.16 起新数据已安全），而是**遗留数据的一次性收尾能力缺失**——恰好是 issue #2 原始受害者（yyscream 1.13.1→1.14.0 丢数据的同类人群）二次受伤的路径。设计上「不自动搬 GB 级目录」有其合理性（跨卷搬迁风险/时长），但**缺检测、缺提示、缺一键迁移**三件套是真实的未实现项。

**结论：issue #2 核心机制全部实现且守卫齐全；「已下载题库不再消失」仅对 v1.16 起的数据成立，遗留包内题库本体存在「静默失效→物理丢失」缺口（详见 §5 R-A 后续研究）。**

---

## 三、Issue #3（纸质刷题补录）——已根治（v1.30.0），真实环境矩阵已验证

> 根因分析与修复过程已有专项研究文档：[2026-11-14-issue3-history-import-gap.md](2026-11-14-issue3-history-import-gap.md)（cycle-33）。本节做承诺级核对与补充发现。

### 3.1 承诺 → 实现证据

| 关闭说明承诺 | 实现证据（文件:行号） | 判定 |
|---|---|---|
| 三通道搜索：naoku DB LIKE 全量 → 目录兜底 → **真题卷全文扫描（新增）** | `src/server/historyApi.ts:45-115`（通道① `:52-63` naokuReady 门控 + searchQuestionsByStem（`src/adapters/naoku.ts:178-210`）；通道② `:65-80`；通道③ `:81-113` buildPaperIndex+loadPaper、年份倒序、maxPapers=80 上限、找满早停） | ✅ |
| 溯源元数据 paperId/exam/year/no/paperFile（可点回原卷核对） | `historyApi.ts:105-108`（matchSource:'papers' + 溯源字段）；守卫 C33-01b（smoke.test.mjs:1722-1723） | ✅ |
| 三态补录 right/wrong/unknown（纸上只有叉号也能录）+ 统计隔离（historical 标记，不算今日新刷） | `historyApi.ts:1-17`（设计纪律）、`:125-186`（addEntries 幂等三闸 `:143-146`、happenedAt 未知为 null `:147-148`） | ✅ |
| 错题自动进 SRS 错题本（box=1）+ 出处快照 | `src/server/srs.ts:24-25`（入库快照 source/sig）；SMOKE-HIST-02/03（smoke.test.mjs:1241-1248） | ✅ |
| 批次撤销（只动 import 条目，绝不动在线作答） | `historyApi.ts:188-206`（undo）+ `:213-230`（batches/undo 路由）；批次台账 30 批滚动（`:181-182`）；SMOKE-HIST-05/06 | ✅ |
| UI 四步旅程（搜索→核对→标记→保存/撤销） | `src/client/views/study-view.tsx:916-1044`（KgHistoryImport 完整旅程，`:988` 四步引导文案） | ✅ |
| **双入口**：深度题库页 + 错题本内嵌 | `study-view.tsx:889`（深度题库页）+ `:447`（错题本内嵌折叠卡）；守卫 C33-03（`:1728-1729`） | ✅ |
| 错题本工作台：筛选（模块 chips + 三态）/SRS 回炉/展开全文 | `study-view.tsx:392-470`（`:418` 筛选实现、`:432-447` 操作条、`:469` fromImport 标签）；RENDER-WB-33 全交互零降级（render.test.mjs:456-484） | ✅ |
| 真实环境验证（naoku 缺席环境） | 沙箱实证 547ms 命中浙江 2026 A 类卷（cycle-33 commit d08bf18 记录）；桌面端 v1.30.0 实测搜「习近平总书记指出」命中 3 条（议题正文记录） | ✅（既有验证，本审计未复跑） |

### 3.2 补充发现（不影响关闭结论，列入后续研究）

- **通道②「目录兜底」未修**：仍是 `getRandomQuestions(module, 12)` 随机抽 12 题再过滤关键词（`historyApi.ts:64-80`）——issue3 研究文档指出的「兜底形同虚设」对通道②本身依然成立。**影响面极小**：通道③扫描的正是同一仓库（xingcezhenti）的真题卷，papers 索引可用时通道②永不参与；仅当真题卷解析不可用而目录文件可用这一罕见组合才暴露。
- **空结果提示无通道级区分**：搜索返回空时 UI 未告知「三个通道各自的可用状态」（如 naoku DB 缺席 / papers 索引失败），用户排障仍靠猜（KgHistoryImport `study-view.tsx:936-939` 只报错误或空列表）。

**结论：issue #3 已按 v1.30.0 关闭说明兑现，双入口 + 三通道 + 工作台全部落地且有运行时/静态/渲染三层守卫；遗留两个低优先级体验项（通道②确定性、空结果可解释性）。**

---

## 四、总体核对结论

| 议题 | 关闭说明兑现度 | 未实现/部分实现项 |
|---|---|---|
| #1 图片全链路 | **100%**（含 cycle-23 追加承诺） | 无（选项图为上游数据源限制，已诚实降级 + 专项库替代） |
| #2 数据外置迁移 | **核心 100%，一处过度承诺** | 包内遗留题库本体（≤v1.15 下载）：不迁移、不检测、不提示 → 下次升级物理丢失（§2.2） |
| #3 纸质补录 | **100%**（v1.30.0 根治口径） | 通道②随机兜底未确定性化（影响面极小）；空结果无通道级可解释性 |

守卫面：三议题合计 SMOKE-IMG(-22) 10 项 + SMOKE-DX 6 项 + SMOKE-HIST 14 项 + C33 5 项 + RENDER-WB-33/RENDER-PP-31/32，全部在仓且随 v1.30.0 发布线全绿（cycle-33 commit 记录 376/376 smoke + 63/63 render；本审计为静态核对，未复跑）。

---

## 五、未实现项的后续研究文档建议

以下每项建议按 `docs/research/README.md` 约定立档（新增研究 = 本目录加一篇 + README 阅读矩阵加一行 + smoke RDOC 守卫），**本次审计不落地任何代码**：

### R-A（P2）：包内遗留题库本体的检测与安全收编
- **问题**：§2.2 场景 B——`pkgMigrateEntries()` 白名单不含 repos（`dataRoot.ts:126-132`），`dataLocationReport()` 也不探测（`:216-228`），遗留 GB 级题库静默等死。
- **研究方向**：三档方案对比——① 最小方案：`dataLocationReport()` 增加 `legacyPkgRepos: {exists, sizeHint, repoKeys}` 探测 + 面板白盒卡提示「检测到旧版包内题库 N 个，可一键迁移/重新克隆」；② 一键迁移：复用 moveEntry（`dataRoot.ts:136-150`）逐仓库流式搬迁 + 磁盘空间预检 + 失败不删源（沿用现有纪律）；③ 保守方案：只提示不迁移，引导 repoManager 一键重克隆（T-028 镜像回落直连已就绪，`repoManager.ts:170-177`）。
- **验收口径**：场景 B 用户升级到含修复版本后，`/api/data-location` 可见 legacy 探测；UI 有明确去路；smoke 新增 SMOKE-DX-07（遗留探测）+ 迁移/提示语义守卫。
- **风险**：跨卷 GB 级搬迁时长与中断安全（建议逐仓库粒度 + 已迁仓库记账，参照 MIGRATED_MARK 幂等模式）。

### R-B（P2）：图形推理选项图的源头恢复
- **问题**：通用题库 2728 道图形推理题选项=纯字母（上游未收录选项图），当前诚实降级（`study-view.tsx:292-355`）。
- **研究方向**：gk-tuxing 专项库 354 题已带图（`tuxing.ts`）——研究「专项库 ↔ 通用库题干指纹对齐」，把专项库选项图按题干匹配回填通用题库候选；或评估从上游原始 PDF/题源重新抓取选项图的内容寻址管线（可复用 07-内容寻址研究）。
- **验收口径**：抽样 N 题人工核对选项图-题干对齐准确率 ≥ 阈值；错配回退到现有诚实降级提示。

### R-C（P3）：补录搜索通道②的确定性化（或退役）
- **问题**：`getRandomQuestions` 随机 12 题兜底命中率≈0（`historyApi.ts:64-80`）。
- **研究方向**：把通道②替换为 BM25/倒排索引全文检索（复用 02-BM25 研究与 huasheng13 适配器经验，`huasheng13.ts:56`）；或直接让通道③全责、通道②降级为「papers 索引不可用」时的显式提示；同时给空结果加通道级可解释性（naoku 缺席/papers 失败/关键词无命中三态文案）。

### R-D（P3）：研究文档索引补录（流程性）
- 本审计文档与 2026-11-14-issue3-history-import-gap.md 均未收录进 [README.md](README.md) 阅读矩阵；RDOC smoke 守卫亦未覆盖。按 README「更新流程」约定补一行 + RDOC 断言（属文档/测试改动，本次不执行）。

---

## 六、证据索引（快速回溯）

- 议题正文：GitHub xuanyuanchumo/dsh-kaogong issues #1/#2/#3（均 CLOSED，无评论线程）
- 事故档案：docs/agents/INCIDENTS.md:172-184（R27=issue#2、R28b=issue#1）
- 专项研究：docs/research/2026-11-14-issue3-history-import-gap.md（issue#3 根因/修复）
- 关键源码：`src/server/dataRoot.ts`（数据根/迁移）、`src/server/historyApi.ts`（补录域）、`src/server/http.ts`（路由/域链/kg-img）、`src/adapters/repoData.ts` 与 `src/adapters/naoku.ts`（占位化/材料归属）、`src/client/ui-kit.tsx`（RichText）、`src/client/views/study-view.tsx`（补录旅程/错题本工作台/降级提示）
- 守卫：smoke.test.mjs:1145-1167（DX）、1228-1298（HIST）、1298-1384（IMG22）、1716-1732（C33）；render.test.mjs:456-484（WB-33）
- 发布线：npm dist-tags.latest=1.30.0；HEAD d08bf18（cycle-33，v1.30.0）
