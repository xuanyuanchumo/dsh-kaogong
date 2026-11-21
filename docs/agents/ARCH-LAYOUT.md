---
title: 架构与目录布局规范（ARCH-LAYOUT）
status: current
updated: 2026-11-20
---

# 架构与目录布局规范（ARCH-LAYOUT）

> 本文件定义 dsh-kaogong 的**目录职责与分层禁区**，并说明它与 dsh 官方插件规范的对应关系。
> 依据：dsh 插件开发知识库（`site/develop/basic/publish.md` 的组合包 manifest、`site/reference/cookbook/adding-a-package.md` 的包布局、`extra/testing.zh.md` 的「测试真实入口路径」）。
> 关联：`BACKLOG.md` BL-DOC-03 · `ARCHITECTURE.md`（运行时结构）· `CONVENTIONS.md`（编码纪律）

---

## 1. 三层对照：官方规范 ↔ 本项目实际

dsh 官方把一个可发布插件看作**组合包（bundle）**：npm 包 + `dsh.bundle.patch` 声明的配置层 + patch 引用的插件模块。

| 官方概念 | 官方要求 | 本项目对应 | 状态 |
|---|---|---|---|
| 组合包 manifest | `package.json` 的 `dsh.bundle.patch` | `package.json:45-48` → `./cordis.patch.yml` | ✅ 合规 |
| patch 层 | YAML 数组，`insert`/`override` 插件行 | `cordis.patch.yml`（插入 `id: kaogong`） | ✅ 合规 |
| 插件模块 | 命名空间导出 `name`/`inject`/`apply`，**禁止 `export default`** | `src/host/index.ts:83-86`（`name`/`inject`/`apply`，无 default） | ✅ 合规 |
| 版本范围 | `engines.dsh` + `peerDependencies` | `package.json:15-22`（含预发布分支） | ✅ 合规 |
| peer 双声明 | 与宿主共享实例的 dsh 包同时进 `peerDependencies` 与 `devDependencies` | `peerDependencies` 有，`devDependencies` 仅 `@types/node`+`typescript` | ⚠️ 见 §4 |
| 构建产物入口 | `main`/`exports` 指向构建产物 | `dist/host/index.js` 等 | ✅ 合规 |
| 打包白名单 | `files` 必须覆盖所有被引用文件 | `files` 含 `dist`/`cordis.patch.yml`/`data/study-plan.md` | ✅ 合规（R28 守卫） |
| 测试真实入口 | 至少一个测试经**真实 Loader** 驱动 | smoke 走 `dist/server/http.js`（真实产物），**且 `loader.test.mjs` 走 `dist/host/index.js` 真实 Loader**（17/17，注入 export default → 5/17） | ✅ 已闭合 BL-TEST-01 |

---

## 2. 目录职责（src/）

本项目按**运行时角色**分层，与 dsh 的 Host/Client 双半模型对应：

```
src/
├── host/          Host 半入口 —— Cordis 插件（name/inject/apply）+ 6 个 AI 工具注册
│   └── index.ts        ★ 唯一 Host 入口；命名空间导出，禁 export default
├── server/        HTTP 服务层 —— 端点实现、数据装配、遥测、图谱查询
│   ├── http.ts         ★ 服务装配与路由（startServer 唯一出口）
│   ├── dataApi.ts      题库/练习/判分域端点
│   ├── paperApi.ts     真题卷域
│   ├── naokuApi.ts     深度题库域
│   ├── tuxingApi.ts    图形推理域
│   ├── methodologyApi.ts 方法论（花生十三）域
│   ├── poolApi.ts      统一题目池域
│   ├── historyApi.ts   历史补录域
│   ├── planSchedule.ts 学习计划排程（确定性纯函数）
│   ├── graphQuery.ts   图谱查询（纯函数，参数注入）
│   ├── telemetry.ts    遥测环形统计
│   ├── dataRoot.ts     数据根四级解析（env > config > 开发态 > 托管默认）
│   ├── repoManager.ts  题库克隆/更新作业控制面
│   ├── poolDb.ts → adapters/poolDb.ts
│   └── ws.ts           工作区命名空间隔离
├── client/        Client 半 —— Web GUI 插件（combo factory 格式）
│   ├── client.tsx      ★ 唯一 Client 入口；VIEW_ROUTES 视图注册表（唯一分发事实源）
│   ├── ui-kit.tsx      基建：全 bundle 唯一 require('react') 在此
│   ├── views/          视图组件层（7 个视图文件）
│   └── graph/          图谱引擎纯逻辑族（零 JSX）
├── adapters/      数据源适配层 —— 每个上游仓库一个适配器
│   ├── repoData.ts     16 仓库注册与字段映射
│   ├── paperData.ts / paperParse.ts  真题卷索引与解析
│   ├── naoku.ts / naokuImage.ts      深度题库（node:sqlite）
│   ├── tuxing.ts       图推
│   ├── huasheng13.ts / huasheng13-text.ts  方法论语料 + BM25
│   ├── pool*.ts        统一池摄入/去重/源实现
├── shared/        跨半共享 —— 单一事实源
│   ├── manifest.ts     ★ CAPABILITIES（端点/工具/视图/lifecycle）+ 各种 META
│   └── types.ts        共享类型
└── ui/            零依赖 SPA（兜底通道）
    ├── index.html
    └── app.css
```

### 分层禁区（违反即事故）

| 规则 | 理由 | 强制点 |
|---|---|---|
| `client/` **禁止** `import React from 'react'` | `verbatimModuleSyntax` 会保留行首 import → 破坏 combo 格式（R11 第四形态） | `assert-combo.mjs` |
| `client/` 顶层名必须**全局唯一** | bundler 合并后共享单一 factory 作用域，重名即 SyntaxError | bundler 重名防御 + smoke |
| `client/views/*.tsx` **禁止**回放到 `client/` 根 | 目录分层契约（cycle-24） | smoke C24 守卫 |
| `views/` 组件**禁止**函数直调 | R9：hook 记到父链 → GUI 崩溃 | smoke 静态守卫 + render |
| `shared/manifest.ts` 是端点/工具/视图的**唯一声明处** | 改端点不登记 → 能力矩阵漂移、对账假阳性 | smoke 口径守卫 |
| `server/` **禁止**在模块加载期硬编码数据路径 | 路径是运行期事实（R12/R19），必须走 `dataRoot` 四级解析 | smoke 静态守卫 |
| `adapters/` **禁止**写上游仓库 | I5 约束：第三方仓库只读 | smoke `git status` 守卫 |
| 一切 `spawn` 必须 `windowsHide:true` + `on('error')` | R21：Windows 闪黑窗；错误必须收敛不击杀宿主 | smoke 静态守卫 |

---

## 3. 仓库根布局

```
dsh-kaogong/
├── package.json          ★ 组合包 manifest（dsh.bundle.patch / files / engines）
├── cordis.patch.yml      ★ 插件行声明（被 dsh.bundle.patch 引用，必须在 files 里）
├── cordis.local.example.yml  本地调试 overlay 模板（cordis.local.yml 不入库）
├── tsconfig.json         编译配置（jsx:"react" classic，禁 react-jsx）
├── README.md             对外文档（数字须与 docs/facts.json 一致）
├── CHANGELOG.md          Keep a Changelog + SemVer
├── CLAUDE.md             AI agent 事实基线（事故簿 R1–R28）
├── CONTRIBUTING.md       贡献规范契约（分支/提交/PR/连带义务）
├── LICENSE
├── smoke.test.mjs        ★ E2E 冒烟（真实 server + 真实数据）
├── render.test.mjs       ★ 渲染测试（真实 React 18 + 真实 client.js）
├── loader.test.mjs       ★ 真实 Loader 入口（BL-TEST-01；三层隔离 BL-SEC-01）
├── screenshots.json      市场截图清单
├── icon.svg / assets/    图标与截图（**不含任何题库数据**）
├── locale/               {zh,en}.json 双语元数据
├── data/                 随包模板（仅 study-plan.md；运行时数据在用户数据根）
├── scripts/
│   ├── assert-combo.mjs      ★ 产物形态硬守卫
│   ├── bundle-client.mjs     ★ client 多模块 → 单 combo 合并
│   ├── bump-version.mjs      ★ 版本三锚点原子同步
│   ├── git-hooks/            ★ 三层 git 钩子（commit-msg/pre-commit/pre-push）
│   └── docs/                 ★ 文档门禁（check-docs / check-facts / gen-facts）
├── docs/
│   ├── README.md         ★ 文档中心入口（索引）
│   ├── facts.json        ★ 文档事实源（自动生成）
│   ├── agents/           agent 开发文档（事实基线层）
│   ├── design/           设计契约
│   ├── research/         研究文档（五段式）
│   ├── release/          发行说明
│   └── marketplace/      市场条目
└── .github/
    ├── PULL_REQUEST_TEMPLATE.md
    ├── ISSUE_TEMPLATE/   bug_report.yml / feature_request.yml
    └── workflows/ci.yml  类型门/构建门/smoke/render + 文档与事实源门禁
```

### 薄入口原则（官方规范推论）

`src/host/index.ts` 与 `src/client/client.tsx` 应保持**薄**——只做注册与装配，业务逻辑下沉到 `server/`、`adapters/`、`views/`。
这样做的理由：入口是最难测试的部分（需要真实 Loader），把逻辑放在可独立测试的模块里，能最大化测试覆盖。

---

## 4. 已知偏差与处理计划

| 偏差 | 现状 | 官方要求 | 处理 |
|---|---|---|---|
| peer 未进 `devDependencies` | 仅 `peerDependencies` 有 `@deepseek-ai/dsh` / `@deepseek-ai/cordis` | 与宿主共享实例的包应双声明（peer 供运行时、dev 供类型检查与独立测试） | 本项目零 npm 运行时依赖是**刻意设计**；类型检查走 `@types/node` + 手写声明。**保留偏差并在本文件声明理由**，不盲目照抄 |
| 无真实 Loader 测试 | smoke 走 `dist/server` 真实产物，但 `dist/host` 未过 Loader | 产品可见插件必须有非单元的真实组合测试 | ✅ 已落地 `loader.test.mjs`（BL-TEST-01）；17/17，负向验证注入 default → 5/17 |
| 端口硬编码导致测试假阳性 | Host 原 `PREFERRED_PORT=8400` 硬编码，测试会 adopt 主力实例 | 运行期端口应可配置 | ✅ 加 `KG_PORT` env 覆盖（默认 8400 兼容），见 ISOLATION.md |
| `L1` 无 `README.en.md` | 仅中文 README | 官方生态中英双语常见 | 见 `BACKLOG.md` **BL-DOC-04**（P1） |
| `lint` = `tsc --noEmit` | 名不副实 | — | 见 `BACKLOG.md` **BL-PROC-07**（P2） |

> **偏差不是错误，未声明的偏差才是。** 任何与官方规范的偏离，必须在本表登记理由，否则视为违规。

---

## 5. 何时更新本文件

| 触发条件 | 动作 |
|---|---|
| 新增顶层目录（如 `src/plugins/`） | 更新 §2 目录树 + 分层禁区 |
| 新增 npm script 产出 dist | 确认接了 bundler + assert-combo，登记到 §3 |
| 发现与官方规范的新偏差 | 登记 §4 并说明理由或建 BACKLOG 条目 |
| dsh 官方发布新版本规范 | 读知识库 `extra/upgrade-guide/` 对应版本，检查本表是否需要新增偏差项 |

**维护强制点**：`check-docs.mjs` 校验本文件链接可达；`CONTRIBUTING.md` 的变更连带义务表要求「改架构 → 更新 ARCH-LAYOUT」。
