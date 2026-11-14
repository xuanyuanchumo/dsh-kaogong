# 技术债登记簿 — dsh-kaogong

| ID | 描述 | 类别 | 影响量化 | 建议处置 | 登记循环 |
|---|---|---|---|---|---|
| T-001 | 题库→知识点二级业务图谱未实现（当前仅能力/数据域图） | 功能缺口 | 图谱视图信息密度 -40%；用户"考点关联"诉求无入口 | 下一循环 adapters 增知识点抽取（利用 kaogongzhentizhengliu 标注笔记）→ shared 图谱二模式 | cycle-1 |
| T-002 | ~~SM-2 间隔重复未接入出题序列~~ | 功能缺口 | **v1.3 大部分清偿**：自研简化五箱 SRS（答错降箱/答对升箱/箱≥3连对2=掌握/最久未复习先回炉）+ 6 断言覆盖 | 剩余：box→SM-2 interval(1/2/4/8/16天) 映射 + GongkaoNaoku 27506 题去重库打通 | cycle-1→3 ✅部分 |
| T-003 | client wsKey 依赖 `sessions.scope(id).workspacePath` 字段名假设（已实现三级兜底不崩） | 契约风险 | 最坏退化到 `session/<id>` 命名空间粒度=会话级（项目级隔离降级） | 宿主浏览器 Console 验证一次真实字段形状，固化到 spec S2.3 | cycle-1 |
| T-004 | Sidebar 渲染级 E2E（截图断言）未自动化 | 测试缺口 | client.js 逻辑由 smoke 间接证据 + 人工验证覆盖，回归成本每次 ~10min | 评估 dsh web 无头注入可行性；否则维持人工 | cycle-1 |
| T-005 | ~~ui 无独立 CSS 语义化 token 与宿主主题联动~~ | 体验债 | **已清偿（双入口轮）**：client 传 theme 参数 + ui 优先级链（URL>localStorage>system） | - | cycle-1 ✅ |
| T-006 | data/ 无限增长防护仅环形两处（history/lifecycle）；progress 命名空间数无上限 | 运维债 | 长期多项目使用下文件数=工作区数（每文件 <50KB，风险低） | /api/workspaces 加 90 天不活跃归档建议提示 | cycle-1 |
| T-007 | 归档后 init-cycle 编号复用 cycle-1（与 archive/cycle-1 同名，目录语义混淆） | 流程债 | 归档审计需看 mtime 区分轮次；账本哈希链不受影响（append-only） | 观察 ANIC 技能上游编号策略；项目侧以报告时间戳消歧 | cycle-2 |
| T-008 | 左栏 main 面板 wsKey 依赖 tab 先挂载更新 lastWsKey（未挂右 tab 时回落 default） | 隔离边界 | 直接进沉浸模式的首个会话进度落 default 命名空间（可迁移） | 下轮接入 uiWorkspace/当前工作区服务解析路径 | cycle-2 |
| T-009 | 图表多日趋势/雷达无法真实回测（history.date 由服务端生成=当天，不能造历史） | 测试缺口 | 图表函数已由 mock 注入浏览器验证；但端到端多日路径只有生产自然积累才能覆盖 | 允许 /api/check 传 at 覆盖日期（仅测试模式开关）或维持 mock 验证 | cycle-2 |
| T-010 | 交付清单/非功能报告为 cycle-1 模板未随 v1.3 刷新 | 文档债 | 门禁只查 8 关键词存在性，内容滞后不影响判定但影响审计可读性 | 下轮顺手重写 | cycle-2 |
| T-011 | 原生面板未覆盖计划/检索/方法论三视图（5/8 已原生） | 功能缺口 | 左栏面板内三视图仍需跳独立 SPA；宿主内体验不完整 | 原生面板补 vPlan/vSearch/vMethod 的 React 移植（复用同源 fetch） | cycle-3 |
| T-012 | ~~原生面板渲染未自动化验证~~ | 测试缺口 | **v1.5 大部分清偿**：`npm run test:render` 真实 React 18 + 真实 client.js 集成渲染 7 断言（席位注册→渲染→切视图→答题→6连切换）；剩余：登录态 GUI 内像素级截图断言 | dsh web 无头注入评估时补 | cycle-3→4 ✅部分 |
| T-013 | ~~宿主级完整加载验证缺 dsh CLI~~ | 验证缺口 | **cycle-5 已清偿**：独立工具目录装 dsh 0.2.1-rc.5 + 沙箱 `sb-kaogong`，真机验证 combo 激活 / 同源路由 / 5 视图渲染 / 11 端点 200 全通过 | 保留沙箱与 `_dshcli` 供后续真机回归 | cycle-4→5 ✅ |
| T-014 | ~~主力 profile 回装待用户决定~~ | 部署决策 | **2026-11-03 用户授权 T-014，已回装**：`install_bundle` applied v1.5.1 → `include:kaogong` fiberPhase=active → 4 工具注册 → 双通道 200（同源 59946 + 独立 8400，pid 23292 v1.5.1 自有实例）；沙箱实例已停并清理 | 后续迭代仍走沙箱验证再回装 | cycle-5→6 ✅ |
| T-015 | 沙箱与 CLI 工具目录占用磁盘（`_dshcli` 完整 dsh 发行 + `_kgtest` react devDeps） | 运维债 | 约数百 MB；仅开发期需要 | 长期不用可删（沙箱 profile 亦可 `rm -rf ~/.dsh/profiles/sb-kaogong`） | cycle-5 |
| T-016 | 行测整套卷未做「整卷模考」模式（140 题按套练习/计时/交卷/模块得分分布/错题归因） | 功能缺口 | 有 739 套行测卷但只能单题练；真实考场体验缺失 | papers 视图增「开始模考」→ 整卷计时作答 → 交卷算分 → 按模块给诊断 | cycle-6 |
| T-017 | 申论大作文缺字数分档细则与范文对照（当前仅粗粒度字数比与要点覆盖） | 功能缺口 | 大作文 40 分权重最高，评改深度不足 | 引入字数档位表（不足/合格/超标）、总分论点识别、范文结构模板比对 | cycle-6 |
| T-018 | 题目配图未本地渲染（行测卷均含图片，如 2008 国考 17 处图形推理图） | 功能缺口 | 图形推理类题目缺图不可作答 | adapters 解析 `![](path)` 映射到 gwy-zhenti 本地图片目录，前端 `<img>` 渲染 | cycle-6 |
| T-019 | ~~真题卷筛选缺考点维度~~ | 功能缺口 | **cycle-10 已清偿**：papersByCategory 反查 + /api/naoku/papers + /api/naoku/categories；UI 加「按考点」模式（18 考点 chip） | — | cycle-10 ✅ |
| T-020 | ~~图谱/可观测未接入题库维度~~ | 功能缺口 | **cycle-10 已清偿**：图谱加「我的考点掌握（弱→强）」热力条；可观测加「我的学习质量」（申论/模考均分率） | — | cycle-10 ✅ |
| T-021 | ~~材料与题目无联动高亮~~ | 体验债 | **cycle-10 已清偿**：关联段号变可点 chip → 平滑滚动 + 左缘高亮 + 背景色 | — | cycle-10 ✅ |
| T-022 | ~~TypeScript 迁移~~ | 技术选型 | **cycle-9 已清偿**：15 个 .ts + types.ts 契约；tsc 镜像编译 dist；类型错误 131→0；noEmitOnError 阻断；dist 新鲜度门；宿主实测可加载 | TS 仅 devDependency，运行时零依赖不变 | cycle-9 ✅ |
| T-023 | ~~图形推理专项（gk-tuxing）~~ | 功能缺口 | **cycle-11 完整版已清偿**：354 题 / 13 类规律 / 354 图 / 原创思路+分析+陷阱；新增独立视图「🔷 图形推理」+ 4 端点 | 仅交互式图形动画未迁移（锦上添花） | cycle-11 ✅ |
| T-024 | 会话内练题（conversation.input.left） | ~~体验升级~~ | **cycle-11 已清偿**：输入栏「📚 练题」控件 + 上弹面板（抽题/判分/解析/统计）；try/catch 全包裹 | 选最轻 slot，不接管会话流 | cycle-11 ✅ |
| T-025 | **client.ts 单文件复杂度 677（预算 180，超 3.76 倍）** | 架构债 | 475 分支 / 101 函数 / 3363 行；band-detector OVER_BUDGET；根因是 combo 格式要求单文件内嵌全部视图（`require` 仅解析已注册模块，禁本地 import） | **两条候选路径**：(a) 拆为多 combo 文件并在 `__ModuleLoader__` 逐条注册（已验证 loader 支持 registered-factory 解析，需改 `dsh.client` 声明与 bundle 生成）；(b) 迁移到 tsc 多文件 + 代码生成单文件 combo 产物。**评估下一循环专项**（影响 5 个视图 400+ 行，需完整回归） | cycle-12 |
| T-026 | 图谱力学参数与原实现标定方式脆弱（魔数 LINK/REP/向心） | 可维护债 | **cycle-12 部分清偿**：改 FR 模型 `k=sqrt(area/V)` + 度数加权理想边长 + 离线预收敛 `relax(140)` + `fit` 适配；参数不再依赖节点数魔数 | 剩余：力模拟缺 octree 空间索引（V>600 走抽样近似，精度有损） | cycle-12 ✅部分 |

## cycle-24 登记（2026-11-14）

| ID | 描述 | 类别 | 处置建议 | 登记循环 |
|---|---|---|---|---|
| T-24-12 | graph-view.tsx / obs-view.tsx JSX 转换未完成（subagent 超时，lead 接管降级） | 体验债 | cycle-25 首项；tsx-graph-obs 移交的侦察情报在 _tmp/tsx-conv-backup 同级（EOL/反斜杠敏感行/interface 清单） | cycle-24 |
| T-24-13 | ui-kit 样式 token 化：~200 处硬编码色值 + 5 种圆角混用（ui-radius.md 先角色后档位） | 体验债 | 语义 CSS 变量（--kg-accent/--kg-border/--kg-surface）+ 明暗联动 | cycle-25 |
| T-24-14 | obs-view 1101 行单文件巨型视图（八区块） | 架构债 | 卡片级拆分 obs/cards/*.tsx，与复杂度预算 180 联动 | cycle-25 |
| T-24-15 | ui/index.html 1514 行独立 SPA 与 client.tsx 重复实现同一界面 | 架构债 | 降级为极简跳转页（R25 文案漂移同族根治） | cycle-26 |
