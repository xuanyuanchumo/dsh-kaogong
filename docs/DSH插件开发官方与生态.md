以下是在原有文档基础上进行查漏补缺后的完整版本。核心修订思路是：**补入原文档完全缺失的“知识库与文档入口层”**（`dsh-plugin-dev-kb`、官方文档站、`llms.txt` 索引），**补入 `dsh-seam` 作为编译期兼容性检查的前置环节**，**修正 `dsh-plugin-devkit` 的定位与工具构成**（原文档记录的“四个模块”与生态现状存在偏差），并在版本适配矩阵与故障排查中相应更新。

---

# DSH 开发测试验证插件：官方与生态结构性文档（v0.2.2-rc.5 基准）

**宿主版本基准**：DSH `0.2.2-rc.5`（`next` 通道）
**文档整理日期**：2026-11-21
**范围**：DSH 生态中用于“知识获取—开发—测试—验证—升级适配”闭环的官方/准官方/事实标准工具与机制。

> **版本口径**：本文档的“宿主版本基准”指当前生态观察与场景设计所锚定的 DSH 发布版本。各工具条目的“适配版本”独立标注，以该条目自身声明为准。宿主已到 `0.2.2-rc.5`，不等于每个工具都已在该版本上完成真测。未标注 `0.2.2-rc.5` 的工具，其证据强度应回退到其最近一次实测版本，**不应默认推定兼容**。

---

## 0. 文档定位与使用方式

本文档面向三类读者：**插件作者**（开发阶段自测）、**维护者/审核者**（PR 或发布前验证）、**CI 流水线设计者**（将验证步骤自动化）。

使用原则：**先用 §1 确定“当前需要证明什么”，再在 §2–§5 中选取匹配的工具**，§6 解决环境隔离这个贯穿性前提，§7 给出按场景的组合方式。不要一次性堆叠所有工具——每个工具证明的性质不同，混用会稀释证据的可解释性。

**本版相对于前版的结构性补全**：

| 补全项                                                              | 原文档状态                                                      | 本版处理                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **知识库与官方文档入口**（`dsh-plugin-dev-kb`、文档站、`llms.txt`） | **完全缺失**                                                    | 新增 §2.0，作为开发前的“知识层”                                                                                        |
| **`dsh-plugin-devkit` 的工具构成**                                  | 记为“四个模块”（debugger / debug-boot / plugin-test / preview） | 生态中存在**同名不同物的 `dsh-plugin-devkit`**（Joker2377 的 scaffold / doctor / audit / inspect），已在 §3.1 区分标注 |
| **编译期兼容性检查**（`dsh-seam`）                                  | 未涉及                                                          | 新增 §3.4，作为升级适配的“源码级前置检查”                                                                              |
| **官方文档站与 `llms.txt` 索引**                                    | 未涉及                                                          | 新增 §2.1，给出 agent 可读的文档入口                                                                                   |
| **awesome 列表与生态发现**                                          | 未涉及                                                          | 在 §8 速查表中增加“发现工具”入口                                                                                       |

---

## 1. 顶层框架：DSH 验证等级 L1–L5（不变）

| 等级   | 名称       | 判定内容                                       | 版本关系            |
| ------ | ---------- | ---------------------------------------------- | ------------------- |
| **L1** | 已找到     | 仓库可访问、非空、有 README                    | 版本无关            |
| **L2** | 结构化     | `manifest` / `package.json` 有效，关键字段完整 | 版本无关            |
| **L3** | 安装规范   | 能解析安装命令，声明 DSH 版本要求              | 版本无关            |
| **L4** | 安装实测   | 安装命令在隔离沙盒内真实执行成功               | 仅当前 DSH 版本真测 |
| **L5** | 安装已验证 | 宿主加载插件并跑通功能冒烟，清单状态 active    | 仅当前 DSH 版本真测 |

**关键规则**（前版已确立，此处保留）：分版本生效；L4/L5 是运行时结论，只对实测版本有效，旧判定标记 `stale` 而非清零；三分类（Bundle 插件 / 生态插件 / 生态应用）；**未实测 ≠ 失败**，不参与通过率分母。

---

## 2. 知识层：官方文档与开发知识库（原文档结构性空白，本版补入）

这一层解决的是：**“在写第一行代码之前，从哪里获得权威、可检索、与当前宿主版本对齐的知识。”** 原文档直接从“环境与调试”开始，跳过了知识获取环节——而 DSH 处于 developer preview，README 原话为 “THERE WILL BE COMPATIBILITY-BREAKING CHANGES”，**不知道权威文档在哪里，后续所有工具的使用都建立在猜测之上**。

### 2.0 `dsh-plugin-dev-kb`（插件开发知识库，事实标准）

**性质**：社区项目（Pasumao/dsh-plugin-dev-kb），非官方背书，但它是目前 DSH 生态中**唯一将官方文档完整镜像为 agent 原生可用形态的工具**，定位为“写 DSH 插件时的随身辅助”。

**核心构成**：

| 组件                                       | 内容                                                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **官方站点镜像**                           | 将 `https://deepseek-harness.github.io/deepseek-harness/` 的全部内容由仓库 `deepseek-ai/deepseek-harness` 的 `docs/` 原始 Markdown 投影生成，中英双语 **194 页**（1.8.0 版本数据） |
| **仓库独占补充文档**                       | 官方仓库 `docs/` 中未发布到站点的 **554 篇** 开发参考（术语表、防御模式、模块图、测试策略、事故复盘、i18n 规范、升级指南、持久化变更等）——**线上站点看不到的内容**                 |
| **技能自动加载**                           | `skills/dsh-plugin-dev-kb.md` 使 agent 在插件开发任务中**自动获知知识库位置、主题导航与检索策略**，无需手动翻网页                                                                  |
| **主题导航**                               | `kb/meta/topics.md` 按任务场景映射要读的文件；`kb/meta/search-index.json` 提供全量检索索引                                                                                         |
| **`dsh_kb_search` 工具**                   | 本地打分检索（标题/路径/正文多词加权），一次调用返回命中文件路径、行号与上下文片段；支持 `scope: api`（只搜 API 签名/目录类文档）、`lang: en`、空 query 返回主题导航               |
| **`dsh_kb_read` 工具**（1.8.0+）           | 按 `path/offset/limit` 行号窗口局部阅读原文，防大文件整读，拒绝越界路径，自动提示中英对照续读位置                                                                                  |
| **版本感知横幅**（1.8.0+）                 | 工具输出自动标注「知识库快照 vs 宿主 DSH 版本」差异，并给出对应 `extra/upgrade-guide/<vX.Y.Z>` 指南路径；探测失败时自动降级（无横幅不报错）                                        |
| **`dsh-upgrade-assistant` 技能**（1.7.0+） | 升级 DSH 版本时，agent 自动读官方升级指南与持久化变更记录，生成迁移检查清单、预判插件兼容闸门与回滚方案                                                                            |
| **`dsh-plugin-starter` 技能**（1.8.0+）    | 从零新建合规 DSH 插件的脚手架指南（骨架清单 / 收录门槛 / 验证闭环）                                                                                                                |
| **`dsh-dev-sandbox` 技能**                 | 自建独立沙箱 profile 工作流，agent 按任务自定沙箱名，隔离运行、自主重启、headless 冒烟验证，全程 agent 闭环                                                                        |

**最小接入**：

```bash
dsh plugin --profile web add dsh-plugin-dev-kb
# 重启后，在插件开发任务中 agent 应自动加载知识库技能
# 也可手动调用：
dsh_kb_search "cordis plugin contract" scope=api
dsh_kb_read path=docs/plugin-development.md offset=1 limit=120
```

**它证明什么 / 不证明什么**：

| 证明                                                 | 不证明                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 你拥有与官方文档站**逐字一致**的知识源               | 知识库快照与当前宿主 `0.2.2-rc.5` 的**实时** API 面完全一致（版本感知横幅会提示差异，但差异本身需要你处理） |
| 你能检索到**仓库独占**的测试策略、升级指南、事故复盘 | 替代 `dsh-testkit` 的真实生命周期验证——文档描述的是“应该怎样”，不是“你的插件在真实宿主中是否确实这样”       |
| 升级时能获得**迁移检查清单与回滚预案**               | 替代编译期兼容性检查（`dsh-seam`）——后者在**你的源码**上逐行定位破坏性变更                                  |

**已知约束**：知识库镜像的更新频率为“每周自动同步上游”。在 DSH 快速迭代期（如 `0.2.2-rc.1 → rc.2` 之间发生了 Menu API 替换、Agent Teams 服务换包等真实契约变更），**不要假设今天镜像到的 API 面就是宿主当前版本的实际面**。版本感知横幅是必要的，但不是充分的——最终结论以 `dsh-seam` 的编译期检查和 `dsh-testkit` 的真实生命周期为准。

### 2.1 官方文档站与 `llms.txt` 索引

**官方文档站**：`https://deepseek-harness.github.io/deepseek-harness/`。该站点提供 `llms.txt` 索引，**页面 URL 去斜杠 + `.md` 即原文**，agent 可直接读取原始 Markdown，无需解析 HTML。

**DSH Desktop 开发文档**（独立于 Web 插件开发，但生态中相关）：`https://dshdesktop.com/workbench/docs/development/`，提供 Markdown 原文入口 `https://dshdesktop.com/workbench/docs/development.md`，覆盖普通 DSH 插件、Desktop 服务、兼容模式与生命周期。

**与 `dsh-plugin-dev-kb` 的关系**：`dev-kb` 是官方文档站 + 仓库独占文档的**离线、可检索、agent 原生**封装。在线时可直接用 `llms.txt` 路径；离线或需要**仓库独占内容**（测试策略、事故复盘、升级指南）时，`dev-kb` 是唯一入口。

### 2.2 生态发现：awesome 列表

写插件前需要知道“生态里已经有什么、别人踩过什么坑”。以下列表持续维护，可作为 `dev-kb` 检索的补充：

- `awesome-deepseek-harness`（0xsline / IvenKooLab）：收录插件、工具与基础设施，包含 `dsh-plugin-bench`（证据驱动的质量基准）、`dsh-plugin-starter`（零依赖脚手架，含 `--verify` 冒烟）、`create-dsh-plugin` 等。
- `awesome-dsh-plugin`（beancookie / stephenlzc）：按 UI 增强、开发与运行时等分类收录。
- **注意**：awesome 列表的收录**不等于**该插件在 `0.2.2-rc.5` 上通过了 L4/L5。发现之后，仍需按 §1 的阶梯独立验证。

---

## 3. 开发与调试工具层

这一层解决的是：在**不污染日常 DSH 环境**的前提下，观察插件行为、定位问题，并在源码层面做前置检查。

### 3.1 `dsh-plugin-devkit`（同名不同物的两个项目——原文档未区分，本版修正）

原文档将 `dsh-plugin-devkit` 记为单一工具，包含 `dsh-debugger` / `dsh-debug-boot` / `dsh-plugin-test` / `dsh-plugin-preview` 四个模块，适配版本记为 `0.2.2-rc.3`。生态检索显示，存在**两个不同维护者的 `dsh-plugin-devkit`**，功能集与适配版本均不同。使用前必须**先确认你安装的是哪一个**。

#### 3.1a `@effaf/dsh-plugin-devkit`（原文档记录的项目）

**适配版本**：公开验证记录显示其**已验证至 `0.1.5-rc.2`**，`engines.dsh` 在该基线声明。另有记录显示 `0.2.2-rc.3` 上的 L5 通过（验证日期 2026-11-15，Node v24.14.0）。**`0.2.2-rc.5` 尚未出现在其公开验证矩阵中**，在 rc.5 上使用时应视为“前置版本兼容、rc.5 未真测”。

**功能**：运行时观察（`dsh-debugger`、`dsh-debug-boot`）、宿主契约测试（`dsh-plugin-test`，fake Cordis host）、slot 预览（`dsh-plugin-preview`）。详见前版 §2.1，本版不再重复示例。

#### 3.1b `Joker2377/dsh-plugin-devkit`（生态中另一个同名项目，本版补入）

**定位**：**四个 host 端工具，对应插件生命周期的四个时刻**，纯 JavaScript，无 UI、无常驻服务、不改 profile。

| 工具                  | 作用                                                    | 关键行为                                                                                                                                         |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`plugin_scaffold`** | 开一个插件骨架                                          | 产出 `package.json`（含 `dsh.bundle.patch`）、入口、示例工具、测试、README、LICENSE、`.gitignore`、CI workflow；“**产出来就能跑、就跑得过测试**” |
| **`plugin_doctor`**   | 读一个插件，说出“DSH 安装它会被哪一条挡下来”            | **重现 DSH 自己的兼容性判定**：`engines.dsh` 存在时只看它；否则逐条检查 `@deepseek-ai/dsh*` peers，prerelease 参与比较                           |
| **`plugin_audit`**    | 读一个**已发布**的套件，判断“装进我的 profile 合不合理” | 比对 tarball 哈希、扫描 install 脚本、看依赖面与 provenance、判 `engines.dsh` 相容性、比对现有版本；**只读，不装、不执行对方代码**               |
| **`plugin_inspect`**  | 装完之后，确认“它在 Host 里真的载入了吗”                | 运行后验证载入状态                                                                                                                               |

**适配范围**：声明 `Node.js >=22.19`，`DeepSeek Harness >=0.1.1-rc.2 <0.3.0`。**这是一个较宽的声明范围，覆盖 `0.2.2-rc.5`，但未在该版本上逐版本真测**。`plugin_doctor` 在不提供 `hostVersion` 时不做兼容性判定（“devkit 不去猜你跑的是哪一版 DSH”）。

**最小使用**（无需安装，CLI 与工具走同一核心）：

```bash
node scripts/cli.mjs doctor ./my-plugin
node scripts/cli.mjs audit <package-spec>
```

**与 `dsh-plugin-check` 的区别**：`plugin-check` 做**静态合规扫描**（manifest 协议、patch 格式、构建陷阱、hub 收录状态）；`plugin_doctor` 做**安装兼容性判定重现**（模拟 DSH 安装时的版本闸门）；`plugin_audit` 做**供应链审计**（哈希、install 脚本、provenance）。三者证明的性质不同，可在发布前串联使用。

### 3.2 `dsh-dev-sandbox`（不变）

每个沙盒 = 独立 `DSH_HOME` + 独立端口 + 标准 web profile。**隔离边界是 `DSH_HOME`**，不是 profile 名或 CWD。在 rc.5 上开发时，应**显式在沙盒内安装 `@deepseek-ai/dsh@0.2.2-rc.5`**，而非依赖沙盒默认版本。

### 3.3 `make-dsh-plugin`（官方技能，定位更新）

官方开发技能，引导插件创建流程。**注意**：官方 `packages/plugin/console` 已归档（2026-10-03），`make-dsh-plugin` skill 已迁移至 `vlln/dsh-skills` 仓库；官方 Plugins 页面现覆盖已安装插件管理与逐插件设置。

### 3.4 `dsh-seam`（编译期兼容性检查，原文档缺失，本版补入）

**定位**：给 DSH 插件作者用的**编译期兼容性检查工具**，非 DSH 用户向。在插件目录跑一行命令，即可检查插件用到的 DSH 接口在新版本下有没有破坏性变更，并**定位到源码具体行号**。非官方社区项目（YMoose，MIT），tested with DSH `0.2.2-rc.1`。

**核心机制**：扫描插件源码**实际用到**的上游字段、事件 hook 与注入服务，生成契约快照 `coupling.json`，并对照当前安装的依赖版本逐项验证。

**为什么这一层不可省略**：`dsh-plugin-dev-kb` 的版本感知横幅告诉你“知识库快照和宿主版本可能有差异”；`plugin_doctor` 告诉你“安装闸门会不会放行”；但只有 `dsh-seam` 能告诉你 **“你的代码里第 42 行用到的 `ctx.menu.getAnchorRect`，在目标版本里已经被替换为 `anchorPoint`”**。`0.2.2-rc.1 → rc.2` 的适配记录显示，Menu 的定位 API 发生了真实删除与替换，Agent Teams 服务也整体换包——这类变更不是版本号差异能概括的。

**最小使用**：

```bash
npx github:YMoose/dsh-seam#v0.1.0 check
# 或集成到测试套件中：
npx github:YMoose/dsh-seam#v0.1.0 check --check && npm test
```

**在流程中的位置**：**升级 DSH 版本或抬插件基线时，在运行 `dsh-testkit` 之前先跑 `dsh-seam`**。`dsh-seam` 是秒级/分钟级的源码级门禁，`dsh-testkit` 是分钟级的真实生命周期门禁。顺序颠倒意味着你可能花几分钟启动 Docker 容器，只为发现一个编译期就能定位的 API 删除。

---

## 4. 测试自动化与执行层

### 4.1 vitest（代码级测试，不变，前版 §3.0 的定位保留）

契约测试（`vi.mock('@deepseek-ai/dsh-tools')`）、执行路径测试（`execute` 正常/错误/render）、逻辑测试（纯函数直接导入）。**vitest 是 `dsh-seam` 之外另一道高频反馈**：`dsh-seam` 检查“接口接触面”，vitest 检查“逻辑与执行路径”。两者不重叠。

### 4.2 `dsh-testkit`（真实宿主生命周期，适配状态更新）

**当前适配状态**：npm 上的 `dsh-testkit` 默认适配器公开记录显示支持 `0.1.1-rc.2`、`0.1.0-rc.8`、`0.1.0-rc.7`、`0.1.0-rc.6`。另有社区 Discussion 记录 `dsh-testkit@0.4.4` 被允许在 `0.2.2-rc.1` 上运行（`dsh plugin allow-version`），以及 `0.2.1-rc.2` 上的 L5 运行验证记录。**截至 2026-11-21，`0.2.2-rc.5` 尚未出现在任何公开的 `dsh-testkit` 适配声明或 L5 记录中。**

**rc.5 策略**（与前版一致，但证据更明确）：安装最新 `dsh-testkit`，检查其 `engines.dsh` / `peerDependencies` 是否覆盖 `0.2.2-rc.5`。**若未覆盖，不要强行让它跑 rc.5**。`init` 后锁定其显式支持的最高 `0.2.2` 版本（如 `rc.1` 或 `rc.2`），将 rc.5 的 L5 标记为“待适配器跟进”，而非用旧适配器代跑后声称 rc.5 已通过。**exit code 4 是保护机制，不是缺陷**。

### 4.3 `dsh-test-plugin` / `dsh-plugin-test-controller`（不变）

前者做业务流程端到端（自然语言测试规划 + HTML 报告）；后者做一次性隔离运行 + 证据导出。两者跟随当前宿主运行，但端到端结论不等同于 L4/L5 的安装与生命周期证据。

---

## 5. 验证、审计与诊断层（在 前版 §4 基础上补入 `dsh-seam` 的定位区分）

`dsh-plugin-check`（静态合规扫描，只读，不替代 L4/L5）；`dsh-verification-receipt`（活动审计，非内容审计）；`dsh-session-health`（会话帧级取证）；`dsh-context-doctor`（上下文 token 成本与冲突）；`dsh-security-audit`（本机暴露面只读报告）。

**新增边界**：`dsh-seam` 不属于这一层。它是**编译期兼容性检查**，在代码尚未进入宿主之前运行，产出的是“源码与目标 DSH 接口面的差异”，而不是“运行中的健康信号”。

---

## 6. 环境隔离：贯穿性前提（不变）

| 隔离手段                | 机制                                    | 适用工具                                                                                             |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **`DSH_HOME` 独立**     | 优先级：配置项 > `$DSH_HOME` > `~/.dsh` | `dsh-dev-sandbox`、`dsh-debug-boot`、`dsh-testkit`（Docker 内）、`dsh-plugin-dev-kb` 的 sandbox 技能 |
| **独立端口**            | 每个沙盒实例自动分配                    | `dsh-dev-sandbox`                                                                                    |
| **一次性容器**          | Docker 隔离，runner 结束后环境销毁      | `dsh-testkit`                                                                                        |
| **一次性会话/数据目录** | 每轮测试使用独立目录，结束后清理        | `dsh-plugin-test-controller`                                                                         |
| **headless 进程**       | 无 GUI、无常驻端口                      | `dsh --profile headless`                                                                             |

**关键提醒**：端口隔离和 profile 名隔离**不能替代 `DSH_HOME` 隔离**。`dsh-plugin-dev-kb` 附带的 `dsh-dev-sandbox` 技能同样基于独立沙箱 profile 工作流，应确认其实际创建的 `DSH_HOME` 边界，而非仅凭“沙箱”名称推定隔离充分。

---

## 7. 按场景的工具组合建议（修订版）

### 场景 A：日常开发中的快速迭代

```
dsh-plugin-dev-kb（知识检索：API 签名、主题导航、升级指南）
→ make-dsh-plugin / plugin_scaffold（规范形态）
→ vitest（契约 + 逻辑 + 执行路径，秒级反馈）
→ dsh-plugin-devkit（/debug + debug-boot 观察行为，确认安装的是哪个同名项目）
→ dsh-plugin-check / plugin_doctor（静态合规 + 安装兼容性判定）
```

### 场景 B：发布前门禁

```
dsh-plugin-check（静态 preflight）
→ plugin_audit（供应链审计，若发布到公开源）
→ dsh-seam（编译期兼容性检查，确认源码未使用目标版本已删除的接口）
→ vitest（全量单测 + 覆盖率）
→ dsh-testkit（真实宿主生命周期 + 干净移除 + 可重复性；锁定显式支持的 DSH 版本）
→ 如涉及 UI：dsh-test-plugin（/test-plan 人工审核后执行）
```

### 场景 C：CI 流水线

```
dsh-plugin-check 作为 preflight
→ dsh-seam check（源码级兼容性，秒级失败）
→ vitest run --coverage（代码级门禁）
→ dsh --profile headless --json（轻量逻辑验证，可选）
→ dsh-testkit（Docker 内真实生命周期，产出 junit.xml；锁定支持的 DSH 版本）
```

### 场景 D：问题诊断（插件可疑导致异常）

```
dsh-session-health（会话帧级扫描）
→ dsh-context-doctor（上下文膨胀/冲突）
→ dsh-security-audit（暴露面检查）
→ dsh-verification-receipt（活动审计）
```

### 场景 E：在 rc.5 上到达 L5 的完整路径（修订）

```
L1–L3：dsh-plugin-dev-kb 获取规范 + dsh-plugin-check / plugin_doctor 静态扫描（版本无关）
L4：dsh-dev-sandbox 中显式安装 @deepseek-ai/dsh@0.2.2-rc.5
    或 dsh-testkit 中锁定适配器显式支持的最高 0.2.2 版本（当前公开证据指向 rc.1 / rc.2）
L5：dsh-testkit 的 exercise 阶段（确定性 tool 调用 + web 启动冒烟）
    ——若 testkit 尚未适配 rc.5，则 rc.5 的 L5 证据标记为“待复测 / 待适配器跟进”，
    不强行用 rc.1/rc.2 适配器代跑后声称 rc.5 已通过
```

### 场景 F：rc.5 升级后的兼容性自查（修订，补入 `dsh-seam` 与 `dev-kb` 升级助手）

```
dsh-plugin-dev-kb + dsh-upgrade-assistant 技能（获取官方升级指南、持久化变更记录、迁移检查清单）
→ dsh-seam check（编译期逐行定位源码中已删除/已变更的上游接口）
→ dsh-plugin-check（静态兼容声明扫描：engines.dsh / peerDependencies）
→ vitest（契约测试确认 @deepseek-ai/dsh-tools 导出面未破坏）
→ dsh-dev-sandbox（在 rc.5 沙盒中真实安装一次）
→ dsh-testkit（若适配器已支持 rc.5，跑完整生命周期；否则锁定 rc.1/rc.2 做回归）
```

---

## 8. 故障排查（在 前版基础上补入本版新增条目）

### 8.1 `dsh-testkit` exit code 4（不变）

适配器不认识指定的 DSH 版本。**不是插件失败**，是保护机制。检查 `dsh.version`，改为其显式支持的版本；不要绕过。

### 8.2 Docker 相关失败（不变）

`dsh-testkit` 默认使用 Docker runner；CI runner 需具备 Docker 权限。

### 8.3 端口冲突 / `DSH_HOME` 残留（不变）

检查 `~/.dsh-sandboxes/<name>` 并手动清理，或使用全新沙盒名。**不要复用已污染的沙盒做发布前验证**。

### 8.4 `npm install git+https` 陷阱（不变）

npm 10.5 以下静默安装仓库根目录而非子包。使用发布包或 `git clone` 后路径安装。

### 8.5 vitest 中 `@deepseek-ai/dsh-tools` 解析失败（不变）

契约测试必须用 `vi.mock` 将其替换为桩，设计前提是零 DSH 依赖可跑。

### 8.6 **`dsh-plugin-devkit` 安装了错误的同名项目**

**现象**：按照教程安装 `dsh-plugin-devkit`，但找不到 `dsh-debugger`、`dsh-plugin-test` 等模块，或 CLI 入口完全不同。
**原因**：生态中存在两个 `dsh-plugin-devkit`——`@effaf/dsh-plugin-devkit`（运行时调试 + 契约测试 + slot 预览）与 `Joker2377/dsh-plugin-devkit`（scaffold / doctor / audit / inspect）。二者包名或安装源不同，功能集不重叠。
**处理**：明确当前任务需要的是**运行时观察与 fake host 契约测试**（→ `@effaf`），还是**安装兼容性判定重现与供应链审计**（→ `Joker2377`）。二者可以同时安装，但不要在文档或 CI 中混用两者的工具名。

### 8.7 **`dsh-seam check` 报告接口缺失，但代码看起来“应该能用”**

**现象**：`dsh-seam check` 定位到源码某行使用了目标 DSH 版本中已不存在的字段/方法，但 TypeScript 编译或旧版运行时“似乎没问题”。
**原因**：DSH 处于 developer preview，破坏性变更真实发生（如 `0.2.2-rc.2` 删除了 `useAnchoredPosition` / `AnchoredPositionOptions` / `getAnchorRect`，替换为 `anchorRef` / `anchorPoint`）。TypeScript 可能因为 peer 依赖版本未同步抬升而无法捕获这类变更；旧版运行时能跑不等于新版能跑。
**处理**：以 `dsh-seam` 的 `coupling.json` 差异为准，对照 `dsh-plugin-dev-kb` 中对应的 `extra/upgrade-guide/` 指南进行迁移。**不要用“旧版本能跑”作为跳过编译期兼容性检查的理由**。

### 8.8 **`dsh-plugin-dev-kb` 的版本感知横幅提示“快照与宿主有差异”**

**含义**：知识库镜像快照的 API 面与你当前宿主的 DSH 版本不完全一致。这是**预期行为**（镜像每周同步，DSH 迭代快于镜像周期）。
**处理**：横幅会指向对应的 `extra/upgrade-guide/<vX.Y.Z>` 指南。按指南路径阅读，然后**用 `dsh-seam` 在你的源码上做编译期验证**。知识库告诉你“发生了什么变化”，`dsh-seam` 告诉你“你的代码受不受影响、在哪一行受影响”。二者顺序不可颠倒。

---

## 9. 版本适配矩阵（截至 2026-11-21，修订版）

| 工具/机制                         | 类型                                   | 核心证明                                                    | 隔离方式                        | 对 `0.2.2-rc.5` 的适配状态                                                              |
| --------------------------------- | -------------------------------------- | ----------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| **`dsh-plugin-dev-kb`**           | 插件 + 技能 + 工具                     | 官方文档镜像 + 仓库独占参考 + 版本感知检索                  | agent 内加载；附带 sandbox 技能 | ✅ 版本感知横幅会标注快照差异；**镜像周期 ≠ 宿主版本**，结论需 `dsh-seam` 兜底           |
| **官方文档站 / `llms.txt`**       | 在线文档                               | 权威规范原文                                                | 不适用                          | ✅ 在线可用；`llms.txt` 供 agent 直接读取                                                |
| **vitest**                        | 通用测试框架                           | 契约/逻辑/执行路径                                          | 进程内，可 mock                 | ✅ 版本无关                                                                              |
| **`dsh-seam`**                    | 社区 CLI                               | 编译期兼容性 / 源码行定位                                   | 本地运行，扫描源码              | ⚠️ tested with `0.2.2-rc.1`；`rc.5` 未真测，但工具逻辑不绑定特定版本，**结果需人工复核** |
| **`@effaf/dsh-plugin-devkit`**    | 社区 npm 包 + CLI                      | 运行时观察 / fake host 契约 / slot 预览                     | debug-boot 独立 profile         | ⚠️ 公开验证至 `0.1.5-rc.2`；有 `0.2.2-rc.3` L5 记录；`rc.5` 未出现                       |
| **`Joker2377/dsh-plugin-devkit`** | 社区 host 工具                         | scaffold / doctor（安装闸门重现）/ audit（供应链）/ inspect | 只读，无 UI                     | ⚠️ 声明 `>=0.1.1-rc.2 <0.3.0`，覆盖 rc.5 的范围；**未逐版本真测**                        |
| **`dsh-dev-sandbox`**             | 插件                                   | 沙盒 Web 镜像挂载开发中插件                                 | 独立 `DSH_HOME` + 端口          | ✅ 跟随当前；沙盒内需显式装 rc.5                                                         |
| **`make-dsh-plugin`**             | 官方技能（已迁移至 `vlln/dsh-skills`） | 规范形态 + 安装验证纪律                                     | 不适用（引导性）                | ✅ 规范层面                                                                              |
| **`dsh-testkit`**                 | npm 包 + CLI                           | 真实生命周期 / 干净移除 / 可重复性                          | Docker 一次性环境               | ⚠️ 公开默认适配器记录至 `0.1.1-rc.2`；有 `0.2.2-rc.1` 运行记录；**`rc.5` 未适配**        |
| **`dsh-test-plugin`**             | 插件                                   | 业务流程 / UI / API 端到端                                  | 复用当前会话                    | ✅ 跟随当前（端到端结论不等同 L4/L5）                                                    |
| **`dsh-plugin-test-controller`**  | 插件                                   | 一次性运行 + 证据导出                                       | 独立会话与数据目录              | ✅ 跟随当前                                                                              |
| **`dsh-plugin-check`**            | 插件                                   | 静态合规扫描                                                | 只读，不启动宿主                | ⚠️ 以最新发布版声明为准                                                                  |
| **`dsh --profile headless`**      | 官方 CLI                               | 轻量逻辑验证 / 机器可读事件流                               | 无 GUI、进程级                  | ✅ 内置；需 Node ≥ 24.9                                                                  |
| **L1–L5 阶梯**                    | 生态级度量                             | 分级质量信号                                                | 平台侧沙盒                      | 宿主基准 `0.2.2-rc.5`                                                                   |

**图例**：✅ 可直接在 rc.5 上使用（知识库的“使用”不等于“其内容与 rc.5 逐字节一致”）；⚠️ 需核对具体安装版本/实例的适配声明，未覆盖 rc.5 时不应默认推定兼容。

---

## 10. 关键注意事项汇总（在 前版 9 条基础上扩充）

1. **“官方”的严格含义不变**：`make-dsh-plugin` 是官方技能（已迁移至 `vlln/dsh-skills`）；`dsh-testkit` 有 DeepSeek AI 团队 Discussion 背书；`dsh-plugin-devkit`（两个同名项目）、`dsh-plugin-dev-kb`、`dsh-seam` 均为**社区项目**，不应表述为“DeepSeek 官方插件”。

2. **宿主版本 ≠ 工具适配版本 ≠ 知识库快照版本**：三者是独立维度。`dsh-plugin-dev-kb` 的版本感知横幅是**披露**这个差异的工具，不是消除差异的工具。消除差异靠 `dsh-seam`（源码级）+ `dsh-testkit`（运行时级）+ 手动迁移。

3. **`dsh-testkit` 的 exit code 4 是保护机制**：CI 应锁定 DSH 版本，而非跟随 `next` / `latest` 漂移。

4. **知识层不是可选的“阅读材料”**：DSH 处于 developer preview，README 明示 “THERE WILL BE COMPATIBILITY-BREAKING CHANGES”。没有 `dsh-plugin-dev-kb` 或等效知识源，后续所有测试工具的产出都缺少“应该对照什么规范”的基准。

5. **`dsh-seam` 是升级适配中不可跳过的一环**：`plugin_doctor` 判断“安装闸门会不会放行”，`dsh-testkit` 判断“装进去之后生命周期对不对”；**只有 `dsh-seam` 在代码尚未运行时逐行告诉你哪个接口已经不存在了**。在 CI 中，它应该是 `vitest` 和 `dsh-testkit` **之前**的快速失败门禁。

6. **同名工具必须区分**：`dsh-plugin-devkit` 至少存在 `@effaf`（运行时调试 + fake host + preview）与 `Joker2377`（scaffold / doctor / audit / inspect）两个不同物。**在文档、CI 配置和团队沟通中，应使用完整包名或维护者标识，避免“devkit”单独出现。**

7. **`dsh-test-plugin` 与 `dsh-testkit` 不可互相替代**：前者证明“业务流程按预期走通”，后者证明“插件在真实宿主中的生命周期行为正确”。

8. **`plugin-check` / `plugin_doctor` 是只读前置检查**：静态扫描或判定重现，不启动宿主，不能作为 L4/L5 的替代。

9. **隔离必须到 `DSH_HOME` 层**：端口或 profile 名隔离会在会话、workspace、全局状态层面泄漏。任何声称“隔离测试”但未独立 `DSH_HOME` 或未使用一次性容器的流程，证据强度应打折扣。

10. **rc.5 的 Node 下界**：DSH `0.2.2` 线要求 Node ≥ 24.9；但 `Joker2377/dsh-plugin-devkit` 声明 `Node >=22.19`。**不同工具的 Node 要求可能不同，以各工具声明为准**，不要假设宿主的下界自动成为所有工具的下界。

---

## 附：工具速查表（按“我想证明 / 获取什么”反向索引，修订版）

| 我想……                                                   | 首选工具                                                   | 备选/补充                                       |
| -------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| **知道官方规范怎么说、API 签名是什么**                   | **`dsh-plugin-dev-kb`**（`dsh_kb_search` / `dsh_kb_read`） | 官方文档站 + `llms.txt`                         |
| **获取仓库独占的测试策略、事故复盘、升级指南**           | **`dsh-plugin-dev-kb`**（`extra/` 补充文档）               | —                                               |
| **在升级 DSH 时获得迁移检查清单与回滚预案**              | **`dsh-plugin-dev-kb`** 的 `dsh-upgrade-assistant` 技能    | —                                               |
| **发现生态中已有哪些插件/工具**                          | awesome 列表（`awesome-deepseek-harness` 等）              | `dsh-plugin-dev-kb` 检索                        |
| 我的函数逻辑正确                                         | **vitest**（`impl.spec.ts`）                               | —                                               |
| 我的插件导出了正确的 Cordis 契约                         | **vitest**（`vi.mock` 契约测试）                           | `@effaf/dsh-plugin-devkit` 的 `dsh-plugin-test` |
| 我的工具 `execute` 正常/错误路径都对                     | **vitest**（执行路径测试）                                 | —                                               |
| **我的源码用到的 DSH 接口在目标版本中是否已被删除/变更** | **`dsh-seam check`**                                       | `dsh-plugin-dev-kb` 的 `extra/upgrade-guide/`   |
| **DSH 安装我的插件时会被哪条版本闸门挡下**               | **`Joker2377/dsh-plugin-devkit` 的 `plugin_doctor`**       | `dsh-plugin-check`                              |
| **我要安装的第三方包供应链是否可疑**                     | **`Joker2377/dsh-plugin-devkit` 的 `plugin_audit`**        | —                                               |
| 我的插件能装进真实 DSH 并正确注册                        | `dsh-testkit`                                              | `dsh-dev-sandbox`                               |
| 卸载后没有残留                                           | `dsh-testkit`                                              | —                                               |
| 我的 manifest / patch 格式合规                           | `dsh-plugin-check`                                         | `plugin_doctor`（安装闸门重现）                 |
| 我的业务流程端到端走通                                   | `dsh-test-plugin`                                          | —                                               |
| 插件是否导致会话损坏                                     | `dsh-session-health`                                       | —                                               |
| 插件注入了过多上下文                                     | `dsh-context-doctor`                                       | —                                               |
| 配置和暴露面是否安全                                     | `dsh-security-audit`                                       | —                                               |
| 发生了什么类别的活动（事后审计）                         | `dsh-verification-receipt`                                 | —                                               |