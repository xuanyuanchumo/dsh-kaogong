# 测试与发布

## 一、测试金字塔

```
        ┌─────────────────────────────┐
   ⑤    │ 真机（沙箱 GUI 浏览器）      │  人工+Playwright，5–10 min
        ├─────────────────────────────┤
   ④    │ render.test.mjs  42 断言     │  真实 React 18 + 真实 client.js，~8s
        ├─────────────────────────────┤
   ③    │ smoke.test.mjs   204 断言    │  真实 server + 真实数据，~25s
        ├─────────────────────────────┤
   ②    │ npm run build（tsc 类型检查+编译+bundler 合并 12 模块）│  ~4s
        └─────────────────────────────┘
```

| 层 | 命令 | 覆盖 | 不在覆盖内的 |
|---|---|---|---|
| ② 类型 | `npm run build` | **TS 类型错误阻断**（含未定义标识符 R15）、编译产物、combo 合并终检 | 运行时行为 |
| ③ 冒烟 | `node smoke.test.mjs` | 端点契约、真实数据解析、评分算法、边界/降级、静态守卫、**题库管理控制面（不真克隆）** | 浏览器渲染 |
| ④ 渲染 | `node render.test.mjs` | combo 注册、**15 视图挂载**、hook 稳定性、降级检测、键盘行为、安装按钮真实发请求 | 真实网络/样式 |
| ⑤ 真机 | 沙箱 + 浏览器 | 视觉、交互、真实加载路径、**一键克隆端到端**（`KG_REPOS_DIR=空目录` 模拟安装态） | 自动化回归 |

**关键教训**：② 通过 ≠ 能跑。T-022 后宿主编织 `dist/`，smoke 有「dist mtime >= src mtime」新鲜度门，忘记 build 会直接失败。R15（组件定义丢失）语法合法、smoke 绿、render 当时只点 3 个视图 → 到真机才炸。所以 ④ 必须覆盖**每一个导航视图**。

## 二、必跑清单（提交前）

```bash
cd dsh-kaogong
npm run build              # tsc：类型检查 + 产出 dist + bundler 合并
node smoke.test.mjs        # 必须 204/204
node render.test.mjs       # 必须 42/42
```

输出必须贴进交付说明。任一失败不得提交。

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
npm pack --dry-run                       # 期望 ~320KB / ~54 文件，无数据无凭据
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
| 描述**只说功能、必须属实**（写「51 端点」就得真有 51 个） | ✅ 数字取自 manifest 实测 |
| 投稿方式：一个 PR 一个文件 `data/plugins/xuanyuanchumo__dsh-kaogong.yml`（README 由脚本生成，勿手改） | ⏳ 待提 PR |
| 可选：`icon:` 指向 GitHub 托管位图（`assets/icon-180.png`）、本仓 `screenshots.json` 声明 1–8 张 | ✅ 两者齐备 |

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
