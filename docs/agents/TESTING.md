# 测试与发布

## 一、测试金字塔

```
        ┌─────────────────────────────┐
   ⑥    │ 真机（沙箱 GUI 浏览器）      │  人工+Playwright，5–10 min
        ├─────────────────────────────┤
   ⑤    │ loader.test.mjs  17 断言     │  真实 Cordis Loader + 三层隔离，~5s
         ├─────────────────────────────┤
   ④    │ render.test.mjs  66 断言     │  真实 React 18 + 真实 client.js，~8s
        ├─────────────────────────────┤
   ③    │ smoke.test.mjs   437 断言    │  真实 server + 真实数据，~25s
        ├─────────────────────────────┤
   ②    │ npm run build（tsc 类型检查+编译+bundler 合并 13 模块）│  ~4s
        └─────────────────────────────┘
```

| 层 | 命令 | 覆盖 | 不在覆盖内的 |
|---|---|---|---|
| ② 类型 | `npm run build` | **TS 类型错误阻断**（含未定义标识符 R15）、编译产物、combo 合并终检 | 运行时行为 |
| ③ 冒烟 | `node smoke.test.mjs` | 端点契约、真实数据解析、评分算法、边界/降级、静态守卫、**题库管理控制面（不真克隆）** | 浏览器渲染 |
| ④ 渲染 | `node render.test.mjs` | combo 注册、**16 视图挂载**、hook 稳定性、降级检测、键盘行为、安装按钮真实发请求、**方法论视图 + 专题枢纽锚点（C18）** | 真实网络/样式 |
| ⑤ 真机 | 沙箱 + 浏览器 | 视觉、交互、真实加载路径、**一键克隆端到端**（`KG_REPOS_DIR=空目录` 模拟安装态） | 自动化回归 |

**关键教训**：② 通过 ≠ 能跑。T-022 后宿主编织 `dist/`，smoke 有「dist mtime >= src mtime」新鲜度门，忘记 build 会直接失败。R15（组件定义丢失）语法合法、smoke 绿、render 当时只点 3 个视图 → 到真机才炸。所以 ④ 必须覆盖**每一个导航视图**。

## 二、必跑清单（提交前）

```bash
cd dsh-kaogong
npm run test:all           # 聚合：build + loader + smoke + render + vitest(tests/)
```

聚合包含（cycle-47 起五车道）：

| 车道 | 命令 | 断言基线 | 说明 |
|---|---|---|---|
| 类型+构建 | `npm run build` | 零错误 | tsc + bundler 合并 + combo 守卫 |
| e2e Loader | `npm run test:loader` | 17/17 | 真实 Cordis Loader（tests/e2e/loader.test.mjs，node 直跑） |
| 冒烟 | `node smoke.test.mjs` | 447/447 | 旧单文件（迁移期权威事实源） |
| 渲染 | `node render.test.mjs` | 69/69 | 真实 React + combo（旧单文件，迁移期保留） |
| 分域 vitest | `npx vitest run tests/` | 12+/12+ | tests/ 新形态（迁移目标形态） |

输出必须贴进交付说明。任一失败不得提交。

## 二a、测试体系分域重构（cycle-47 · 进行中）

### 背景与定案（用户确认）

- **现状问题**：smoke（2581 行/478 断言/86 域组）与 render（1594 行/41 旅程组）两个大单文件——「大单文件测试」反模式；断言间隐式顺序耦合（同一 server 实例跨 § 顺序消费）。
- **框架定案（用户纠正后）**：引入 **vitest** 作为 dev-only 测试运行器。理由：①「零依赖」纪律约束的是 `dependencies`（运行时），devDependencies 经 npm pack/files 白名单天然不进包（R28 守卫实测）；② DSH 官方测试策略（kb extra/testing.zh.md）就是 vitest 分层金字塔，对齐规范；③ render.test 原经包外 `../_kgtest/node_modules` 野解析 React——才是真正的不规范，vitest 化后可正立化。
- **拆分粒度**：`tests/` 按业务域分目录 + `_harness/` 共享设施；**不做** unit/integration/e2e 三层强拆（项目以端点契约+渲染旅程为主，强分层会引入 mock 形态爆炸）。
- **节奏**：分阶段迁移（每轮迁 2-3 域，旧文件保持权威事实源直至对应域迁完，`test:all` 全量兜底）。

### 目标目录结构

```
tests/
├── _harness/          共享设施（server 启动单例 / J·P fetch / 池自检重建）
│   └── server.mjs
├── smoke/             冒烟分域（从 smoke.test.mjs 逐域迁入）
│   └── pool.test.mjs  ← 阶段 1 已迁：POOL-01..04b + KGDB-04/04b/05b + MAT-01..03（12 断言）
├── render/            渲染旅程分域（阶段 2 起）
├── e2e/
│   └── loader.test.mjs ← 已迁（node 直跑形态保留；vitest 聚合车道自动跳过）
└── unit/              dist 纯函数直测（阶段 2 起填充）
```

### 迁移规则（机器可核对）

1. **逐字等价**：断言判定逻辑不变，只换 harness 与测试框架形态（check → test+expect）。
2. **命名空间隔离**：分域文件用独立 `CX`（如 `PROJ_VTEST_POOL`），不与旧 smoke 共用 ws。
3. **环境降级三态**：池未就绪等环境性前置缺失 → `expect(true).toBe(true)` 跳过，不假红不崩（继承旧 skip 语义）。
4. **双轨期权威**：迁移完成（旧文件对应段删除）前，旧 smoke.test.mjs 对同 ID 断言仍是权威；两处任一失败以旧为准修。
5. **车道分离**：loader.test 保持 node 直跑（process.exit 语义与 vitest 进程模型冲突，已在文件内 `VITEST` 环境检测跳过）。


## 二b、cycle-18 方法论测试基线（HS13 / C18 / 反向旅程）

### 2b.1 smoke HS13-01..10（`smoke.test.mjs:394-791`，55 条 `check`）

> 位置纪律（教训⑧+⑤）：本块在 §11 之后、**§12 崩溃安全（`server.close()`）之前**；块内无长阻塞（索引快照命中即返回）。
> 计数口径：静态 `check('` 调用点 454 处（含依赖数据就绪的条件分支），运行态基线 **437**；其中 HS13 段 55 条。
> 注：这些数字仅供读者了解规模，**不是门禁**——断言数可被随手改且不等于质量，质量只看 `npm run test:all` 是否全绿。

| 组 | 断言要点（真实断言，非 length>0） |
|---|---|
| **HS13-01** 目录树 | catalog HTTP 200；`meta.docCount=25`；三层结构（六模块+三策略+一示例）；声明数 ≡ 磁盘可用数（25/25、`degraded=false`、`missing=[]`）；25 篇逐篇 `chars/sections>0`、`present=true`；`orphans=[]` 且 `dirMismatch=[]` |
| **HS13-02** 端点口径 | `CAPABILITIES.endpoints` 恰 6 条 `/api/huasheng13/*`（无缺无多）；无 `/kaogong` 前缀；运行态 `trace.declaration.allDeclared=true` + 6 条逐条 `declared`；六端点逐条真实可达；未知子路径 HTTP 200 `{error}` 不 5xx、不进端点对账但进 `telemetry.unmatched` |
| **HS13-03** BM25 命中 | `q=截位直除` 首条 `ziliao-susuan`；分数降序且为正；`rawTotal ≡ results.length + filtered` 且裁剪真实生效；`confidence=high`、`phraseHit=true`、`coverage=1`；首条 `snippets` 非空、`terms` 为真实命中词 |
| **HS13-04** 检索边界 | `假设分配` 命中 `ziliao-susuan` 且 high；`隔板法` 命中 `shuliang-guanxi`；空 `q` → `results=[]` 且不计 miss；生造词 `不存在的词` → `confidence=low`、`phraseHit=false`；**低置信度仍返回结果 + note**（提示而不过滤） |
| **HS13-05** 单篇全文 | `doc?file=ziliao-fenxi` 的 `markdown` 含「ABRX」；元信息 `file/moduleId/chars/formulas/weight>1` 完整；未知 file → 200 `{error,known[]}`；缺 file → 200 `{error,hint}` |
| **HS13-06** 覆盖矩阵 | 六模块齐备；`overall` 在 [0,1] 且为真实值 **0.9756**（≠1，yanyu 缺公式不凑绿）；逐模块 `coverage ∈ [0,1]` 且 `overall ≡ presentDims/expectedDims` 可复算；`dims.formula=false` 透传到常识/申论（不判假阴性）；`gaps` 如实列出 `yanyu-zhuanxiang 缺公式` |
| **HS13-07** 配套练习 | 默认 `total=10 n=5 returned=5 hasMore=true`；`n=10` → `returned=10 hasMore=false` 且 `total` 恒为题库总量；题目形状（index 连续/stem 非空/options 带 key/含解析）；`answerIsLetter` 自洽（true ⇒ 答案 A–D；false ⇒ 文字作答）；数量关系 18 题全为文字作答；未知 file → 200 `{error,known}` |
| **HS13-08** 白盒链路 | trace 六端点槽位 + `hits/p50/p95/lastAt/samples`；`searches` 四元组 + `hitRate=hit/total` 自洽；`docs.reads` 结构 + distinct；`recent` 字段类型正确；调用后 hits **单调递增**（search +1、doc +2）；`reads.ziliao-fenxi` 按 file 累计；环形容量透出（200 / 分槽 24） |
| **HS13-09** 跨 ws 隔离 | A 有真实调用、B 全零，互不污染；两 ws 落到不同分槽；A 的历史在 B 访问后仍完整；无 ws 参数走独立 default 槽 |
| **HS13-10** 静态守卫 | 语料在数据根 `root/huasheng13` 且**包内无 `assets/huasheng13`**；META 声明 25 篇逐条可解析（零断链）；磁盘 25 个 `.md` 全被 META 声明（无孤儿）；`examples/` 恰 5 篇；`zhenti-shili` 按磁盘事实在 `references/`；源码级端点口径守卫（manifest 含 6 条且无 `/kaogong` 前缀） |

### 2b.2 render C18-01..08（`render.test.mjs:874-1008`）

| 编号 | 断言 |
|---|---|
| C18-01 | 花生十三视图挂载 + 五分区 tab 齐备（`data-kg-hs13-tab` 属性锚定） |
| C18-02 | 五分区逐区切换零降级（overview/catalog/search/practice/trace 全绿） |
| C18-03 | 总览渲染六模块卡 + 覆盖率（`coverage.overall=0.9756` → 97.6%） |
| C18-04 | 检索交互：输入「截位直除」→ 发请求 → 结果列表 + 置信度提示「精确命中」 |
| C18-05 | 配套练习渲染题干（消费真实 `items`）且零降级 |
| C18-06 | 白盒链路渲染 trace（端点命中/检索统计）且零降级 |
| C18-07 | 专题枢纽「📖 方法论」分区 `data-kg-hub-tab=method` 可达、零降级，且与 hs13 数据域不混用 |
| C18-08 | 白盒面板「📖 方法论链路」卡：三源齐请求 + 六模块热力条 + 覆盖率/命中率/p95 + 缺口如实展示 + 无 `role="alert"` |

### 2b.3 反向旅程 `_tmp/journey-notinstalled.mjs`（15 条，本地 scratch）

模拟「未安装 huasheng13」的干净数据根（`KG_REPOS_DIR` 指向空目录），验证诚实降级与装后自愈：

1. 16 仓库登记；2. `present=0`；3. `requiredMissing` 含 `huasheng13`；4. `huasheng13.present=false`；5. **无 `builtin` 旁路字段**；
6. `catalog.meta.degraded=true`；7. `available=0`；8. `declaredByAdapter=25`（声明规模不撒谎）；9. `error` 含「题库管理」安装引导；
10. `doc` 未装时返回 `error` 而非空内容；11. `search` 返回空数组不崩；12. `coverage` 降级（`overall=0` 或 `degraded`）；
13. 复制语料进数据根并越过 3s 重试窗口后 `degraded=false`（**自愈，无需重启**）；14. `available=25`；15. 检索恢复非空。

> `_tmp/` 是本地 scratch（不进 npm 包、不入 git）；保留它作为真机反向验证脚本模板。下次做同类「未安装 → 装后恢复」验证时先跑它。

## 三、沙箱验证（改动 UI / 宿主交互时必做）

```bash
# 启动沙箱（端口 3181，插件崩只崩沙箱）
node ..\_dshcli\node_modules\@deepseek-ai\dsh\lib\bin.js --profile sb-kaogong --port 3181 --no-open
# 输出里有 token，拼成 http://127.0.0.1:3181/?token=...
```

浏览器验证要点：

1. 左栏出现「📚 考公学习」图标 → 点开面板。
2. **逐个点击全部导航视图**，断言无 `⚠️ 面板渲染降级`（`role="alert"`）。
3. 关键链路：刷题（选模块→抽题→作答→判分+解析）、图片题（`<img>` 真显示）、专题（切频道→点专题→跳转到练习）、申论（材料区可展开）、模考（开始→交卷→报告）。
4. 控制台无 `Uncaught`。

**严禁**直接在主力 `desktop` profile 上测试未验证的改动。

## 四、变异验证（新增守卫时必做）

守卫写完要证明它**真能抓 bug**：临时注入错误 → 确认测试失败且报出准确信息 → 恢复 → 确认全绿。

```bash
# 例：验证 R15 守卫
cp src/client/client.js /tmp/bak.js
# 把 function NativeDeepBankView 改名
node render.test.mjs   # 必须失败且报 "NativeDeepBankView is not defined"
cp /tmp/bak.js src/client/client.js
node render.test.mjs   # 必须 11/11
```

已做过变异验证的守卫：R12（graph prop 形状）、R15（组件丢失）。

## 五、发布流程（S9.5 纪律）

```
改动 → build ✅ → smoke ✅ → render ✅ → 沙箱真机 ✅ → 主力热重载 → 主力端点验证
                                                              ↓
                                                    失败则立即 set_plugin enabled=false
```

主力操作：

```js
plugin_manager({ action: 'set_plugin', target: 'include:kaogong', enabled: false })
plugin_manager({ action: 'set_plugin', target: 'include:kaogong', enabled: true })
```

装/重装：`remove_bundle` → `install_bundle <绝对路径>`。`link:` 挂载改源码即刻生效，但**必须热重载**才重新加载 fiber。

## 五b、发布流程（GitHub + npm + 插件市场）

**发布走独立干净快照目录**（不在开发仓打 tag 直推——开发仓历史含 147MB 数据 blob 与 `.cycles/`）：

```bash
# 1) 干净快照：源码 + dist + 文档 + 测试；绝不含 data/ .dsh/ .cycles/ node_modules/
mkdir _publish-kaogong && cp -r dsh-kaogong/{src,dist,locale,scripts,docs,assets,icon.svg,\
package.json,cordis.patch.yml,smoke.test.mjs,render.test.mjs,README.md,CLAUDE.md,LICENSE,\
screenshots.json,.gitignore} _publish-kaogong/
rm -rf _publish-kaogong/data _publish-kaogong/cordis.local.yml

# 2) 卫生核验（机器证据，不靠记忆）
npm pack --dry-run                       # 判据：无 data/、无 huasheng13 语料、无凭据；含 dist/docs/assets 图标与截图
git -C _publish-kaogong ls-files | grep -E '^data/|\.env|token' # 必须空

# 3) GitHub（SSH 优先：Windows 下 HTTPS 443 易被重置，SSH 22 稳定）
git init -b main && git add -A && git commit -m "vX.Y.Z — <主题>"
git remote add origin git@github.com:xuanyuanchumo/dsh-kaogong.git
git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z

# 4) npm（token 走环境变量引用，不落盘；registry 显式指官方源，本机全局是 npmmirror）
printf '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\nregistry=https://registry.npmjs.org/\n' > .npmrc.publish
npm publish --userconfig .npmrc.publish --access public
npm view dsh-kaogong version dist.fileCount --registry=https://registry.npmjs.org
```

**首次发布可能 409 Conflict**（registry 对刚下架同名包的 packument 异步处理锁）→ 等 30s 重试。
发布后 `npm view` 可能先显示 `0.0.0-stage` 占位，约 1 分钟落位真实版本（异步处理，非失败）。

**插件市场（awesome-dsh-plugin）合规清单**（`contributing.md` 硬要求，CI 会逐条查）：

| 项 | 本仓状态 |
|---|---|
| `package.json` 声明 `dsh.bundle.patch`（只声明 `dsh.client` **不可安装**，最常见被拒原因） | ✅ cordis.patch.yml |
| 仓库有真实可运行代码（非占位/纯 README） | ✅ |
| 仓库创建满 1 天（CI 自动查） | ⏳ 按提交 PR 当日计 |
| GitHub topic `dsh-plugin` | ✅ |
| peer 范围含**显式预发布分支**（否则静默排除所有 rc，用户 ERESOLVE） | ✅ 三段 `\|\|` |
| npm 包 `repository` 回指该仓库（自动关联下载量；手写 `npm:` 键会被拒） | ✅ |
| 描述**只说功能、必须属实**（写「57 端点」就得真有 57 个） | ✅ 数字取自 manifest 实测（57 端点 / 6 工具 / 16 视图 / 16 仓库） |
| 投稿方式：一个 PR 一个文件 `data/plugins/xuanyuanchumo__dsh-kaogong.yml`（README 由脚本生成，勿手改；单 PR ≤3 条） | ⏳ 待提 PR；条目草案见 [MARKETPLACE-ENTRY.md](./MARKETPLACE-ENTRY.md) |
| category 取自实际功能（可用值：agi/ui/usage/theme/model/identity/session/memory/**tools**/wsl/browser/vision/voice/docs/skill/workflow/git/notify/dev/security/remote/market/fun） | ✅ `tools`（条目里**不得**手写 `npm:` 键，npm 关联由 registry 自动采集） |
| 可选：`icon:` 指向 GitHub 托管位图（`assets/icon-180.png`）、本仓 `screenshots.json` 声明 1–8 张 | ✅ 两者齐备（4 张截图真实存在） |

## 六、ANIC 循环（L4 自主）

每轮迭代收口：

```bash
anic_evaluate        # 16 维度评估（test/lint/build + 质量维度）
anic_flows_gate_check --record   # G0–G3 + Quality 门禁，写 hash-chain ledger
anic_flows_archive   # 归档到 .cycles/archive/cycle-N
```

- 复杂度预算：`complexity_budget: 180`（`.cycles/config.yml`，client 单文件受 combo 约束）。
- 技术债登记在 `.cycles/tech-debt/backlog.md`（T-0xx），每轮更新状态。
- 循环编号归档后重置，按项目约定手动 `mv cycle-1 cycle-N`。

## 七、测试隔离

- smoke 用独立端口段 `8495+`，`publishRuntime: false`，自清理 `PROJ_*` 命名空间。
- **loader.test.mjs 三层隔离**（BL-SEC-01，详见 [ISOLATION.md](./ISOLATION.md)）：
  `KG_DATA_DIR`/`KG_REPOS_DIR` 临时目录 + `DSH_HOME` 临时目录 + `KG_PORT=18400`，
  并断言 `status.pid === process.pid`（绝不 adopt 既有实例——因为 `startServer` 默认会 adopt 8400 的主力实例，实测假阳性）。
- **沙箱 profile 必须配合独立 `DSH_HOME` 或 `KG_DATA_DIR`**：数据根按用户而非按 profile 隔离，
  仅开独立 profile 仍会写主力 `~/.dsh/kaogong`（实测证据见 ISOLATION.md §1）。
- 跑完确认真实端口（8400/8401）没有被测试进程占用；`git status` 无新增噪音。

### 阶段 2 迁移记录（cycle-47 · 2026-11-21）

| 域 | 文件 | 断言 | 特征 |
|---|---|---|---|
| pool | tests/smoke/pool.test.mjs | 12 | POOL-01..04b + KGDB-04/04b/05b + MAT-01..03 |
| guards | tests/smoke/guards.test.mjs | 12 | 前端静态守卫（零 server 依赖，纯源码/产物扫描） |
| history | tests/smoke/history.test.mjs | 6 test | SMOKE-HIST-01..12 补录全旅程 |

**迁移期抓出的 harness 语义缺口**（迁移本身的价值证明——大单文件时代这些语义隐式存在）：
1. **J/P 签名形态**：旧 smoke 全局 `J(u)/P(u,body)` 直用单例 base；harness 版是
   `J(base,u)/P(base,u,body)`。域文件用 `J1/P2` 包装（bind base，兼容全 URL 与
   相对路径两种入参）。**教训：拆全局单例为显式参数时，先盘点调用形态再定签名**。
2. **测前清理**：progress json 持久化在用户数据根——分域文件重跑时上轮
   `importedSigs` 台账残留会让补录幂等闸误判 `accepted=0`。harness 补
   `clearProgressNamespace(ws)`（按 ws 前缀删 progress 文件），域文件 beforeAll 自清理。
   **教训：旧大文件的「全量清理段」是隐式全局前置，拆域后必须显式化为每域前置**。

**累计进度：30/478 断言已迁移（阶段 3 起按域继续：KGDB 静态段 → HIST 后续 → RP/RM → render 分域）。**

### 第⑥层规划：dsh-testkit 发布门禁（用户补充的规范项 · 评估结论）

DSH 社区 dsh-testkit（npm v0.4.4，MIT）提供「真实宿主发布门禁」：Docker 隔离环境按精确 DSH 版本安装 tarball → bundle assemble → tool/service schema 校验 → runtime probe → 卸载残留检查，产出 report.json/junit.xml 证据。

**与现有车道的关系**：本项目的 loader.test（真实 Cordis Loader 入口 17 断言）覆盖了「安装→激活→服务注入→工具注册」的进程内路径；R28 族 npm pack dry-run 守卫覆盖「声明→实体」打包卫生；沙箱（sb-kaogong）覆盖人工真机冒烟。dsh-testkit 的增量价值 = **Docker 隔离的精确版本矩阵 + 卸载残留自动化取证**（本机 Docker 29.8.0 可用）。

**落地建议**（下轮可选增强，非阻塞）：
1. npm i -D dsh-testkit && npx dsh-test init → 生成 dsh-testkit.yaml（row 预期按 manifest 的 service/tool 声明填）；
2. 接入 pre-release 脚本（发布前人工跑，不进 test:all——Docker 依赖不宜硬门禁）；
3. junit.xml 产物接 CI。

**教训**：测试金字塔第⑥层「真机」从「人工+Playwright」升级为「dsh-testkit 自动化 + 人工 Playwright 抽查」——发布门禁从手工流程变为可复核证据。

## 三、生态工具对齐矩阵（依据《DSH插件开发官方与生态》v0.2.2-rc.5 基准 · cycle-47）

> 权威依据：用户提供的《DSH插件开发官方与生态》结构性文档（2026-11-21，rc.5 基准）。
> 本节把本项目的测试车道与该文档的 L1–L5 验证等级、生态工具矩阵逐项对齐，
> 标出「已对齐 / 有等价物 / 缺口」三种状态，作为后续补齐路线图。

### 3.1 本项目车道 ↔ 验证等级对照

| 生态等级 | 本项目对应车道 | 状态 | 说明 |
|---|---|---|---|
| L1 已找到 / L2 结构化 | manifest 单一事实源 + R28 族声明→实体守卫 | ✅ 已对齐 | smoke guards/packaging 域（vitest） |
| L3 安装规范 | peerDependencies + engines.dsh 声明守卫（兼容声明测试） | ✅ 已对齐 | packaging.test.mjs |
| L4 安装实测 | **loader.test.mjs**（真实 Cordis Loader 进程内安装，三层隔离） | ✅ 有等价物（进程内级） | 生态标准是 dsh-dev-sandbox / testkit 容器级 |
| L5 安装已验证 | 沙箱 sb-kaogong 人工冒烟 | ⚠️ 人工 | **缺口：dsh-testkit 容器级自动化**（见 3.3） |
| 代码级 | vitest 分域（tests/，本重构主体） | ✅ 进行中 30/478 | 契约/逻辑/执行路径——文档 §4.1 口径 |

### 3.2 生态工具 ↔ 本项目现状

| 生态工具 | 本项目现状 | 状态 |
|---|---|---|
| dsh-plugin-dev-kb | 已在用（dsh_kb_search/read；CLAUDE.md 事实基线即其纪律的落地） | ✅ |
| vitest | tests/ 分域迁移中（阶段 1-3 已迁 52 断言） | ✅ 进行中 |
| dsh-testkit | **未引入**。文档 §4.2：公开适配器证据止于 rc.1/rc.2，rc.5 未适配——**不强行代跑**（exit code 4 是保护机制） | ⚠️ 待适配器跟进 rc.5 后引入 |
| dsh-seam | **未引入**。文档 §3.4：编译期兼容性检查（源码 vs 目标版本接口面），升级适配的秒级快速失败门禁 | ⚠️ 缺口：本项目 peer 范围宽（>=0.2.0-rc.2），升基线时应引入 |
| dsh-plugin-check | 未引入（只读静态合规扫描，不替代 L4/L5） | ⚠️ 可选增强 |
| Joker2377/dsh-plugin-devkit | 未引入（doctor=安装闸门重现 / audit=供应链） | ⚠️ 可选增强 |
| @effaf/dsh-plugin-devkit | 未引入（运行时调试 / fake host / preview） | ⚠️ 可选增强 |
| dsh-dev-sandbox | 已在用（sb-kaogong profile，三层隔离纪律） | ✅ |
| dsh-test-plugin | 未引入（业务流程端到端，跟当前会话） | ⚠️ render.test 部分等价（真实 React 渲染旅程） |

### 3.3 补齐路线图（按文档场景 B/C 的门禁顺序）

场景 B（发布前门禁）的生态标准序列：**plugin-check → plugin_audit → dsh-seam → vitest → dsh-testkit →（UI）dsh-test-plugin**。

本项目当前序列：**npm run build（tsc+combo 守卫）→ vitest 分域 → smoke → render → loader**。

缺口按优先级：
1. **dsh-seam**（升级适配前置——本项目 peer 范围跨 rc 版本，抬基线时必引；秒级快速失败应插在 vitest 之前）
2. **dsh-testkit**（L5 自动化——等适配器公开声明覆盖 rc.5；exit code 4 不绕过）
3. vitest 迁移完成（448 断言余量，按域继续）
4. dsh-plugin-check / plugin_audit（发布 PR 前人工跑，非硬门禁）

**纪律（文档 §10.3/10.9 采纳）**：CI/门禁锁定 DSH 版本不跟随 next/latest 漂移；任何「隔离测试」未独立 DSH_HOME 的，证据强度打折——loader.test 的三层隔离（数据根/DSH_HOME/端口）已满足。
### 阶段 3+4 迁移记录（cycle-47 · 续）

| 域 | 文件 | 断言 | 特征 |
|---|---|---|---|
| packaging | tests/smoke/packaging.test.mjs | 13 | R9/R11/R28 打包发布卫生（npm pack dry-run 实测） |
| kgdb | tests/smoke/kgdb.test.mjs | 9 | 存储层静态守卫（UPSERT/动态 import/载体隔离/复杂度预算） |
| perf | tests/smoke/perf.test.mjs | 8 | 性能守卫静态判据（缓存/索引/采样/作业化；运行时延迟留旧文件） |
| huasheng13 | tests/smoke/huasheng13.test.mjs | 7 | 方法论语料位 + META↔磁盘双向零漂移（import dist 事实源） |

**累计：67/478 断言已迁移。** 剩余大头为需 server 的运行时域（RP/RM 题库管理、HS13 运行时、IMG 链路、SRS/判分旅程）与 render.test 的 41 旅程组——待 server harness 域迁移时统一处理。

**阶段 4 新增教训**：迁移静态判据前先定位判据的**事实源**——HS13-10 的 META↔磁盘对账在旧文件里 import dist 的 HUASHENG13_META，初版迁移误用源码 grep 形态查错了文件（META 定义在 manifest.ts）导致假红。**规矩：迁移 = 判据逐字等价 + 事实源同一，两者缺一不可。**
### 阶段 5 迁移记录（cycle-47 · server 运行时域首迁）

| 域 | 文件 | 断言 | 特征 |
|---|---|---|---|
| srs | tests/smoke/srs.test.mjs | 4 test | §4 工作区隔离/判分 + §11 SRS 闭环全旅程 + §5-§9 抽验（**首个 server 运行时域**） |

**累计：71/478 断言已迁移（8 个测试文件全绿）。**

**阶段 5 三个基建收口**：
1. **setupDomain({ws})**：分域 server 域文件的最短启动样板（server+base+J/P/JW/PW+测前清理一次拿到）——后续 server 域迁移全部走此入口；
2. **vitest.config.mjs**：exclude tests/e2e/**（loader.test 为 node 直跑形态，vitest 聚合报「No test suite found」——e2e 车道分离于单元车道由配置化收口，不再依赖文件内环境检测）；
3. **fileParallelism: false**：分域文件共享用户数据根与 8495 端口段——实测并发下 progress 写覆盖假红（HIST 域），串行消除竞态。**教训：vitest 默认文件级并行的前提是「测试间资源隔离」，共享外部状态的分域文件必须显式关并行或做资源分片**。

**剩余 407 断言的迁移路径**：server 运行时域（RP/RM 题库管理、HS13 运行时、IMG 链路、模考/申论/真题卷端到端）全部走 setupDomain 样板；render.test 的 41 旅程组待 render harness（React 三件套 mock）抽取后分域。
### 阶段 6 迁移记录（cycle-47 · 续）

| 域 | 文件 | 断言 | 特征 |
|---|---|---|---|
| repos | tests/smoke/repos.test.mjs | 12 | RP-01..06 题库管理（第二个 server 运行时域，setupDomain 样板零新 harness 代码） |

**累计：83/478 断言已迁移（9 文件全绿）。** server 运行时域迁移形态已稳定：
setupDomain({ws}) → h.J/h.JW/h.PW → 每测试独立命名空间 → afterAll close。
剩余 395 断言：HS13 运行时、IMG 链路、模考/申论/真题卷端到端（同样板），
render.test 41 旅程组（待 render harness 抽取）。
### 阶段 7 迁移记录（cycle-47 · 续）

| 域 | 文件 | 断言 | 特征 |
|---|---|---|---|
| huasheng13-runtime | tests/smoke/huasheng13-runtime.test.mjs | 10 | HS13-01/02/03 catalog+端点口径+检索（server 域 #3） |
| img | tests/smoke/img.test.mjs | 8 | IMG22/C23 图片链路 + kg-img 服务 + 越级防线（server 域 #4） |

**累计：101/478 断言已迁移（11 文件全绿）——突破百位。**

**阶段 7 新增教训**：迁移「受控回落」类探针时必须核对探针的**实际 URL**——HS13-02 的未知子路径探针打的是域内 （域链回落语义），初版误译成根路径裸探针（拿到独立端口 404 文本非 JSON）。「探针打到哪」和「探针证明什么」是两件事，判定语义不变则 URL 也不许变。
### 阶段 17-19 迁移记录（cycle-47 · render 旅程域全部完成）

| 域 | 文件 | 断言 |
|---|---|---|
| render harness | tests/_harness/render.mjs | 设施（combo 加载+49 端点 mock+mountPanel） |
| smoke-journey | tests/render/smoke-journey.test.mjs | 7 |
| papers-journey | tests/render/papers-journey.test.mjs | 5 |
| obs-journey | tests/render/obs-journey.test.mjs | 10 |
| graph-journey | tests/render/graph-journey.test.mjs | 8 |
| memory-repos | tests/render/memory-repos.test.mjs | 7 |
| huasheng13-journey | tests/render/huasheng13-journey.test.mjs | 8 |
| ghost-journey | tests/render/ghost-journey.test.mjs | 3 |

**累计：276/478 断言已迁移（35 文件全绿）。render.test 66 旅程断言已全部等价覆盖。**

**harness 抽取教训**：机械切割三次失败（残尾注释/重复声明/try 闭合/captured 作用域/combo 相对路径）——教训㉙「顶层声明行号切点」对『块内互相引用的设施』不适用；正解 = 切割后必须逐项修结构依赖（变量提升/catch 补齐/路径重锚），且每次修后 node --check + 实跑验证。