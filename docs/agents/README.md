# dsh-kaogong · Agent 开发文档

> 本目录是 **面向 AI agent 与本项目开发者** 的事实基线，与代码同源、随迭代更新。
> 目的：让任何接手者（人或 agent）在不读完全部代码的前提下，能正确修改本插件而不引入回归。
> 当前基线：v1.29.1 / cycle-32b（16 仓库 · 67 端点 · 6 工具（全部接入 presentCall/presentResult 展示契约）· 16 视图；smoke 371 + render 62；真题卷三模式：📝答题（exam 域限时判分）/ 🎓学习（单题即判即析）/ 📖全卷（自答对照）；/api/plan/schedule 智能排程）。

## 阅读路径（按任务选）

| 我要做的事 | 先读 | 再看 |
|---|---|---|
| 第一次接触本项目 | [ARCHITECTURE.md](./ARCHITECTURE.md) | [DATA-SOURCES.md](./DATA-SOURCES.md) |
| 加/改 HTTP 端点 | [API-REFERENCE.md](./API-REFERENCE.md) | [CONVENTIONS.md](./CONVENTIONS.md) §端点契约纪律 |
| **改/扩方法论（花生十三）语料或检索** | [METHODOLOGY.md](./METHODOLOGY.md) | [API-REFERENCE.md](./API-REFERENCE.md) §七 |
| 改客户端 UI（视图/交互） | [CONVENTIONS.md](./CONVENTIONS.md) §客户端纪律 | [ARCHITECTURE.md](./ARCHITECTURE.md) §combo 工厂 |
| 用宿主能力（侧栏/工具/路由） | [DSH-HOST-CAPABILITIES.md](./DSH-HOST-CAPABILITIES.md) | — |
| 接入新数据源 | [DATA-SOURCES.md](./DATA-SOURCES.md) | [CONVENTIONS.md](./CONVENTIONS.md) §适配器 |
| 提交前验证 / 发布 / 市场投稿 | [TESTING.md](./TESTING.md) | [MARKETPLACE-ENTRY.md](./MARKETPLACE-ENTRY.md) |
| 踩到奇怪的坑 | [INCIDENTS.md](./INCIDENTS.md) | — |
| 决定技术选型（TS/构建） | [CONVENTIONS.md](./CONVENTIONS.md) §为什么是 JS + React 无 JSX | [ROADMAP.md](./ROADMAP.md) |

## 文档清单

| 文档 | 内容 | 维护触发条件 |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 双半结构、combo 工厂、域工厂重建与数据根四级解析、方法论域装配与边界 | 新增分层/入口/域时 |
| [API-REFERENCE.md](./API-REFERENCE.md) | 57 个端点 + 6 个工具 + 16 个视图的契约（含 6 个 `/api/huasheng13/*`） | 改端点时（必须同步） |
| [**METHODOLOGY.md**](./METHODOLOGY.md) | 花生十三体系适配库：数据来源/授权、25 篇清单、单一事实源四步法、BM25+bigram、覆盖矩阵口径、74 题练习、降级语义 | **新增/修改方法论语料或检索时必读** |
| [CONVENTIONS.md](./CONVENTIONS.md) | 编码规范、技术选型理由、纪律条款（含 `hs13/Hs13` 前缀与导航收敛） | 引入新约定时 |
| [DSH-HOST-CAPABILITIES.md](./DSH-HOST-CAPABILITIES.md) | 宿主能力盘点：已用/可用未用/市场合规 | 发现新宿主能力时 |
| [DATA-SOURCES.md](./DATA-SOURCES.md) | 16 仓库分级注册表（tier/upstream/体积）、适配器、字段映射（含 huasheng13） | 接入新仓库时 |
| [TESTING.md](./TESTING.md) | 测试金字塔、HS13-01..10 / C18-01..08 / 反向旅程、发布流程（GitHub SSH + npm + 市场合规清单） | 测试/发布策略变化时 |
| [**MARKETPLACE-ENTRY.md**](./MARKETPLACE-ENTRY.md) | awesome-dsh-plugin 条目 YAML 草案 + 合规证据 | 投稿/条目更新时 |
| [INCIDENTS.md](./INCIDENTS.md) | R1–R25 事故簿（根因+修复+守卫；含 cycle-18 方法论语料/覆盖/检索三案） | 每次线上/真机事故后 |
| [ROADMAP.md](./ROADMAP.md) | 技术债清单与演进方向（v1.13.0 基线） | 每轮迭代收口时 |

## 铁律（违反即回归）

1. **改端点先改 manifest**（`src/shared/manifest.ts` 是 SSOT），否则能力矩阵漂移。
2. **client 半必须是 combo 工厂格式**，无顶层 `export`，factory 尾部必须 `return { inject, apply }`。
3. **client 源码可拆多模块，但顶层名必须全局唯一**（bundler 合并后共享单一作用域，重名即 SyntaxError）——改完任何 `src/client/*.ts` 必须 `npm run build`。方法论模块统一 `hs13/Hs13` 前缀。
4. **子视图必须作为组件挂载**（`h(Comp, props)`），禁止函数直调（R9 白屏事故）。
5. **每次视图切换必须有 render 断言覆盖**（R12/R15 的教训：漏测即漏检）。
6. **沙箱验证通过才允许动主力 profile**（S9.5 纪律）。
7. **路径是运行期事实，不是加载期常量**：数据根走四级解析；变更即域重建 + 三级缓存失效（R19）。
8. **响应含 per-tenant 字段时缓存必须 per-tenant**（R20 跨工作区泄漏）。
9. **一切子进程 spawn 默认 `windowsHide:true` + `on('error')` 接住**（R21/cycle-0 同族）。
10. **面向用户/模型的文案从事实源渲染，不手写模板**（R22 输出陈旧）。
11. **数据不随包**：方法论语料/题库一律安装在数据根，`assets/` 只放图标与截图；新增语料走 [METHODOLOGY.md](./METHODOLOGY.md) §5 四步法。
12. **导航只收敛、不扩散**：新能力进专题枢纽分区（`data-kg-hub-tab`），不新增一级导航项。