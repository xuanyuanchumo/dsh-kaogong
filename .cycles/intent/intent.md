# Intent: 考公备考整合插件（dsh-kaogong）
Author: lead / product_owner. Status: accepted (human-authorized 2026-11-02).

## Problem
散落的 15 个考公开源仓库（题库/笔记/计划/技能包）没有统一入口：用户要翻目录、读 markdown、手动对答案；且原方案依赖打开独立 :8400 页面，脱离 DSH 工作流；模型不可用（断网/无 key）时学习完全中断。

## Proposed outcome
一键装载后，DSH Web GUI **右侧 Sidebar 出现「考公学习」标签**（引导页 Guide 亦有入口），iframe 内嵌零依赖 SPA：
- 完全离线可用：刷题/判分/30天计划/知识检索/方法论/图谱/可观测 7 视图
- 模型为**可选增强**：4 个 kaogong_* 工具仅在对话需要时介入
- 多项目隔离：进度按工作区命名空间分文件，互不污染
- 白盒可观测：遥测(p50/p95/QPS)、能力矩阵(注册→生产→消费+孤儿检测)、图论指标(密度/PageRank/连通分量)、健康度加权评分
- 崩溃安全：任何异步 listen 错误受控回传，绝不影响宿主（cycle-0 教训）

## Affected users and systems
考公备考用户（DSH Web GUI）；宿主 profile 插件表（kaogong 行）；本地文件系统 REPO_ROOT 下 15 仓库（只读）；data/（唯一写路径）。

## Constraints
- 零 npm 依赖（Node 标准库 only）；仅绑定 127.0.0.1:8400-8404
- 遵循 sidebar-right 契约（双注册同 id、函数式 guide）与 ToolDefinition.output 强制声明
- manifest.js 单一事实源；中文注释；ESM

## Out of scope
SaaS/多用户同步、云端题库、SM-2 引擎全量接入（GongkaoNaoku 仅作数据源展示）、移动端独立 App、真考试判卷合规。

## Open questions
- 图形 tab 是否需要 LaTeX 渲染（当前纯文本解析）
- 是否需要把 15 仓库索引做成 SQLite FTS（当前目录扫描可接受）
