# Plan: dsh-kaogong v1.1 实施计划
Status: done — 本文件记录已实现分解，供符合性与回归评审锚定。

| # | 任务 | 落点 | 验收（spec 条款） | 状态 |
|---|------|------|------------------|------|
| 1 | 崩溃安全启动：async startServer + adopt + 端口降级 | server.js §启动 | S1.1/2/3 | ✅ smoke 24/24 |
| 2 | 工作区命名空间隔离 | server.js wsKey/progressFile | S2.1/2/3 | ✅ PROJ_A/B 互证 |
| 3 | 能力单一事实源 manifest.js（图算法/PageRank/健康度） | manifest.js | S4.2 | ✅ 图谱断言×3 |
| 4 | 遥测环形样本 + QPS 滑窗 | server.js telemetry | S4.1 | ✅ 遥测断言×3 |
| 5 | 结构化学习计划（4阶段30天） | server.js parsePlanStructure | S3.2 | ✅ |
| 6 | Host 工具重写（output 声明 + ws 透传 + 动态端口） | index.js | S5.4 | ✅ 4 工具注册 |
| 7 | Client 重写（guide 函数式 + 端口发现 + CSP 兜底 + 会话解析） | client.js | S5.1/2/3 | ✅ applied 无 TypeError |
| 8 | 前端 v1.1：7 视图 + Canvas 力导向图(拖拽/缩放/拾取/详情) + 可观测仪表盘 + 主题 | ui/index.html | S4/N5 | ✅ |
| 9 | smoke.test.mjs 24 断言 + 自清理 | smoke.test.mjs | 全部 | ✅ |

## 未完成（进技术债簿）
- T1: 图形视图仅覆盖能力图谱，题库→知识点二级业务图谱未做（intent 开放问题）
- T2: GongkaoNaoku SM-2 间隔重复仅展示未接入出题序列
- T3: 客户端 ws key 依赖 `sessions.scope().workspacePath` 字段名假设，需宿主侧验证后固化
- T4: E2E 浏览器级验证（sidebar 实际渲染截图）未自动化，依赖人工/本会话浏览器工具
