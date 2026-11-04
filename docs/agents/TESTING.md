# 测试与发布

## 一、测试金字塔

```
        ┌─────────────────────────────┐
   ⑤    │ 真机（沙箱 GUI 浏览器）      │  人工+Playwright，5–10 min
        ├─────────────────────────────┤
   ④    │ render.test.mjs  11 断言     │  真实 React 18 + 真实 client.js，~8s
        ├─────────────────────────────┤
   ③    │ smoke.test.mjs   80 断言     │  真实 server + 真实数据，~20s
        ├─────────────────────────────┤
   ②    │ npm run build（tsc 类型检查+编译）│  ~4s
        └─────────────────────────────┘
```

| 层 | 命令 | 覆盖 | 不在覆盖内的 |
|---|---|---|---|
| ② 类型 | `npm run build` | **TS 类型错误阻断**（含未定义标识符 R15）、编译产物 | 运行时行为 |
| ③ 冒烟 | `node smoke.test.mjs` | 端点契约、真实数据解析、评分算法、边界/降级、静态守卫 | 浏览器渲染 |
| ④ 渲染 | `node render.test.mjs` | combo 注册、13 视图挂载、hook 稳定性、降级检测 | 真实网络/样式 |
| ⑤ 真机 | 沙箱 + 浏览器 | 视觉、交互、真实加载路径 | 自动化回归 |

**关键教训**：② 通过 ≠ 能跑。T-022 后宿主编织 `dist/`，smoke 有「dist mtime >= src mtime」新鲜度门，忘记 build 会直接失败。R15（组件定义丢失）语法合法、smoke 绿、render 当时只点 3 个视图 → 到真机才炸。所以 ④ 必须覆盖**每一个导航视图**。

## 二、必跑清单（提交前）

```bash
cd dsh-kaogong
npm run build              # tsc：类型检查 + 产出 dist
node smoke.test.mjs        # 必须 80/80
node render.test.mjs       # 必须 11/11
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
