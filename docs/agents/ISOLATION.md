---
title: 验证环境隔离规范（ISOLATION）
status: current
updated: 2026-11-20
---

# 验证环境隔离规范（ISOLATION）

> 回答一个真实且严重的问题：**沙箱验证和真机验证会不会污染文件目录（DSH 插件安装目录、用户数据根、端口）？**
> 关联：`BACKLOG.md` **BL-SEC-01** · `loader.test.mjs` · `TESTING.md` · dsh-dev-sandbox 技能

---

## 1. 结论（先说答案）

| 验证方式 | 插件安装目录 | 用户数据根 `~/.dsh/kaogong/` | 端口 | 污染风险 |
|---|---|---|---|---|
| **主力 profile 真机** | `link:` 指向开发仓，不重写 | ⚠️ **会写**（共享数据根） | 占用 8400-8404 | **高** |
| **沙箱 profile（默认）** | 独立 profile，不碰主力 | ⚠️ **仍会写**（数据根按用户隔离，非按 profile） | 独立进程但同数据根 | **中高** |
| **沙箱 + 独立 DSH_HOME** | 独立 | ✅ 隔离到 `$DSH_HOME/kaogong` | 独立 | **低** |
| **Loader 测试（本次新增）** | 不安装 | ✅ `KG_DATA_DIR` 临时目录 | ✅ `KG_PORT=184xx` | **无** |

**关键洞察**：dsh-dev-sandbox 技能说的"独立 profile 隔离插件、会话、设置"**不包含插件自己定义的用户数据根**。
本项目 `dataRoot.ts:35-42` 的数据根优先级是 `KG_DATA_DIR > $DSH_HOME/kaogong > ~/.dsh/kaogong`——
所有 profile 默认共享 `~/.dsh/kaogong`，所以**仅靠独立 profile 无法实现数据隔离**。

**本机实测证据**（2026-11-20）：
- 主力 `~/.dsh/kaogong/runtime.json` 记录 pid 46692 / 端口 8400，正是主力在跑的实例；
- 未设 `KG_DATA_DIR` 的 Loader 探针 adopt 到了它，读到了主力的 105 题进度（**假阳性**）；
- 主力 profile 的 `package.json` 用 `link:D:/.../dsh-kaogong` 指向开发仓——**安装目录本身不会被沙箱改**，污染源是数据根与端口。

---

## 2. 三类污染面与机理

### 2.1 用户数据根（最严重）

`src/server/dataRoot.ts`：

```
resolveUserDataRoot():
  KG_DATA_DIR (env, 最高) > $DSH_HOME/kaogong > ~/.dsh/kaogong
```

运行时写入这个根的文件（`ops_grep` 实测 8 个文件含写操作）：

| 文件 | 写入方 | 沙箱误写的后果 |
|---|---|---|
| `progress/*.json` | `ws.ts`（3 处写） | 主力进度/错题本被覆盖或污染 |
| `repos-config.json` | `dataRoot.ts`（16 处） | 主力题库数据根配置被改 |
| `runtime.json` | `http.ts`（信标） | 主力信标被覆盖 → 宿主 adopt 到错误实例 |
| `lifecycle.jsonl` | `http.ts` | 环形审计日志混入测试数据 |
| `.kaogong.db` | `poolDb.ts` | 统一池被测试数据写入 |

### 2.2 端口信标（假阳性之源）

`src/server/http.ts:505-527` 的 `startServer` 会**先探测同应用实例并 adopt**：

```ts
const beacon = await probePort(port)   // 探测 8400-8404
if (beacon) return { server: null, port, adopted: true }   // adopt 别人的服务
```

未隔离端口时，测试会连到主力实例（`adopt 既有实例`），读到主力数据——
**测试"通过"了，但测的根本不是刚改的代码**。这是本项目"改了没生效"事故的同族。

### 2.3 开发仓 `data/`

开发仓 `data/` 仍有 154MB `.naoku.db` 与索引快照（历史遗留，已 gitignore）。
构建/测试/迁移若误写这里，会产生 git 噪音与仓库卫生问题。

---

## 3. 隔离方案（三层，强制）

### 3.1 Loader 测试（已实现，`loader.test.mjs`）

```js
// 1. 数据根隔离
process.env.KG_DATA_DIR = <temp>/data
process.env.KG_REPOS_DIR = <temp>/repos
// 2. DSH_HOME 隔离（双保险）
process.env.DSH_HOME = <temp>
// 3. 端口隔离（需要生产代码支持 KG_PORT，见下）
process.env.KG_PORT = '18400'
```

并断言：
- `status.pid === process.pid`（**未 adopt 别人**）
- `status.port === KG_PORT`（**监听隔离端口**）
- 数据写在 `<temp>/data`，主力数据根无 canary 文件
- 结束时 dispose fiber + 删临时目录（含 SQLite 句柄释放等待）

### 3.2 生产代码改动：端口可配置（向后兼容）

`src/host/index.ts`：

```ts
// KG_PORT（cycle-44 测试隔离）：端口是运行期事实，禁止硬编码
const PREFERRED_PORT = Number(process.env.KG_PORT) || 8400
```

默认 8400 完全兼容；测试设 `KG_PORT=184xx` 即与主力 8400-8404 / smoke 8495 隔离。
这与项目既有纪律「路径/端口进运行期一律做成可配置事实源」一致。

### 3.3 沙箱 profile 启动（dsh-dev-sandbox 配方）

```powershell
# 独立 DSH_HOME：让 $DSH_HOME/kaogong 与主力 ~/.dsh/kaogong 物理分离
$env:DSH_HOME = "$env:TEMP\dsh-sb-home-kaogong"
npx -y "@deepseek-ai/dsh@0.2.1-rc.5" web --profile sb-kaogong --port 3181 --no-open
```

或启动沙箱时同时给插件注入 `KG_DATA_DIR`：

```powershell
$env:KG_DATA_DIR = "$env:TEMP\kaogong-sandbox-data"
$env:KG_REPOS_DIR = "$env:TEMP\kaogong-sandbox-repos"
```

**红线**：
- 沙箱只用独立 profile + 独立端口；**绝不** Stop 主力 dsh 进程、**绝不**改主力 profile 下文件。
- 主力 `desktop` profile 的 `link:` 指向开发仓——改开发仓 `dist/` 会影响主力**下次启动**，所以合入前必须沙箱全绿（S9.5 纪律不变）。

### 3.4 真机（主力 profile）验证

真机验证天然会写主力数据根。规则：
1. **只在沙箱全绿 + 四评审 blocker 全清后**才做（真机是验收，不是调试）；
2. 验证后跑 `git status --short` 确认开发仓无新增噪音；
3. 真机产生的用户数据（进度/配置）属正常用户数据，不需要回滚——但**不得**把测试数据写进开发仓 `data/`。

---

## 4. 反模式（禁止）

| 反模式 | 后果 |
|---|---|
| 测试不设 `KG_DATA_DIR` 就加载插件 | 写主力数据根（实测已发生） |
| 测试用默认端口 8400 | adopt 主力实例 → 假阳性（实测已发生） |
| 沙箱与主力共用 `~/.dsh` 且未设独立 `DSH_HOME` | 锁竞争挂死 + 数据交叉污染 |
| 用 `ctx.plugin()` 手动挂载代替真实 Loader | 复现官方事故 0001（测试全绿但产品崩溃） |
| 测试结束后不 dispose / 不删临时目录 | SQLite 句柄泄漏 + 临时垃圾 |
| 设临时 `KG_DATA_DIR` 但不预置 `.migrated` 标记 | 触发 `migratePkgData` 把随包模板 `data/study-plan.md` 从工作树迁走（**实测发生**，git 出现 `D data/study-plan.md`）。正解：临时数据根先写 `.migrated`，让幂等分支跳过 |

---

## 5. 强制点

| 规则 | 强制点 | 触发时机 |
|---|---|---|
| Loader 测试三层隔离 | `loader.test.mjs` 内断言（pid/port/数据根） | `npm run test:all` + CI |
| 端口可配置 | smoke 静态守卫 `R-KGPORT`（建议，见 BACKLOG） | `npm run test:all` |
| 沙箱独立 DSH_HOME | 本文档 + dsh-dev-sandbox 技能 | 人工（沙箱验证时） |
| 真机验证后仓库卫生 | `git status` 检查（PR 自检项） | 提交前 |

**新增 BACKLOG 条目**：`BL-SEC-01`（验证环境隔离）——验收标准即本文档 §3 的三层隔离全部可复现，且负向验证（不设隔离时）能观察到污染。
