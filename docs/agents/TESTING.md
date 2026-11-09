# 测试与发布

## 一、测试金字塔

```
        ┌─────────────────────────────┐
   ⑤    │ 真机（沙箱 GUI 浏览器）      │  人工+Playwright，5–10 min
        ├─────────────────────────────┤
   ④    │ render.test.mjs  50 断言     │  真实 React 18 + 真实 client.js，~8s
        ├─────────────────────────────┤
   ③    │ smoke.test.mjs   262 断言    │  真实 server + 真实数据，~25s
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
npm run build              # tsc：类型检查 + 产出 dist + bundler 合并
node smoke.test.mjs        # 必须 262/262
node render.test.mjs       # 必须 50/50
```

输出必须贴进交付说明。任一失败不得提交。

## 二b、cycle-18 方法论测试基线（HS13 / C18 / 反向旅程）

### 2b.1 smoke HS13-01..10（`smoke.test.mjs:394-791`，55 条 `check`）

> 位置纪律（教训⑧+⑤）：本块在 §11 之后、**§12 崩溃安全（`server.close()`）之前**；块内无长阻塞（索引快照命中即返回）。
> 计数口径：静态 `check('` 调用点 273 处（含依赖数据就绪的条件分支），运行态基线 **262**；其中 HS13 段 55 条。

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
- 绝不 adopt 到正在运行的实例（会误判「改了没生效」）。
- 跑完确认真实端口（8400/8401）没有被测试进程占用。
