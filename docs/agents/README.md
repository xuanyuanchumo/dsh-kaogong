# dsh-kaogong · Agent 开发文档

> 本目录是 **面向 AI agent 与本项目开发者** 的事实基线，与代码同源、随迭代更新。
> 目的：让任何接手者（人或 agent）在不读完全部代码的前提下，能正确修改本插件而不引入回归。

## 阅读路径（按任务选）

| 我要做的事 | 先读 | 再看 |
|---|---|---|
| 第一次接触本项目 | [ARCHITECTURE.md](./ARCHITECTURE.md) | [DATA-SOURCES.md](./DATA-SOURCES.md) |
| 加/改 HTTP 端点 | [API-REFERENCE.md](./API-REFERENCE.md) | [CONVENTIONS.md](./CONVENTIONS.md) §端点契约纪律 |
| 改客户端 UI（视图/交互） | [CONVENTIONS.md](./CONVENTIONS.md) §客户端纪律 | [ARCHITECTURE.md](./ARCHITECTURE.md) §combo 工厂 |
| 用宿主能力（侧栏/工具/路由） | [DSH-HOST-CAPABILITIES.md](./DSH-HOST-CAPABILITIES.md) | — |
| 接入新数据源 | [DATA-SOURCES.md](./DATA-SOURCES.md) | [CONVENTIONS.md](./CONVENTIONS.md) §适配器 |
| 提交前验证 / 发布 | [TESTING.md](./TESTING.md) | [INCIDENTS.md](./INCIDENTS.md) |
| 踩到奇怪的坑 | [INCIDENTS.md](./INCIDENTS.md) | — |
| 决定技术选型（TS/构建） | [CONVENTIONS.md](./CONVENTIONS.md) §为什么是 JS + React 无 JSX | [ROADMAP.md](./ROADMAP.md) |

## 文档清单

| 文档 | 内容 | 维护触发条件 |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 双半结构、combo 工厂、数据流、分层与职责 | 新增分层/入口时 |
| [API-REFERENCE.md](./API-REFERENCE.md) | 33 个端点 + 5 个工具 + 13 个视图的契约 | 改端点时（必须同步） |
| [CONVENTIONS.md](./CONVENTIONS.md) | 编码规范、技术选型理由、纪律条款 | 引入新约定时 |
| [DSH-HOST-CAPABILITIES.md](./DSH-HOST-CAPABILITIES.md) | 宿主能力盘点：已用/可用未用 | 发现新宿主能力时 |
| [DATA-SOURCES.md](./DATA-SOURCES.md) | 15 仓库存量、3 个适配器、字段映射 | 接入新仓库时 |
| [TESTING.md](./TESTING.md) | 测试金字塔、发布流程、ANIC 循环 | 测试策略变化时 |
| [INCIDENTS.md](./INCIDENTS.md) | R1–R15 事故簿（根因+修复+守卫） | 每次线上/真机事故后 |
| [ROADMAP.md](./ROADMAP.md) | 技术债清单与演进方向 | 每轮迭代收口时 |

## 铁律（违反即回归）

1. **改端点先改 manifest**（`src/shared/manifest.js` 是 SSOT），否则能力矩阵漂移。
2. **client 半必须是 combo 工厂格式**，无顶层 `export`，factory 尾部必须 `return { inject, apply }`。
3. **client 半不得拆本地文件**（加载器只支持包级 `require`）——这是 client.js 单文件的合法理由。
4. **子视图必须作为组件挂载**（`h(Comp, props)`），禁止函数直调（R9 白屏事故）。
5. **每次视图切换必须有 render 断言覆盖**（R12/R15 的教训：漏测即漏检）。
6. **沙箱验证通过才允许动主力 profile**（S9.5 纪律）。
