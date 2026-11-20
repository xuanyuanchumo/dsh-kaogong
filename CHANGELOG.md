# 变更日志

本文件记录 dsh-kaogong 的版本级变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.31.0] - 2026-11-20

### 修复

- **issue #6 · Windows 题库管理全功能失效**：`isInside()` 原用 `b + '\\\\'`（两字面反斜杠）判前缀，
  Windows `resolve()` 返回单 `\` → 安装/删除/浏览 100% 报「路径越界」。改用 `path.relative`
  语义判定（`rel === ''` 视为同一路径，兼容大小写不敏感），一处修复覆盖三调用点；
  `SMOKE-ISSUE6` 固化 13 组边界（子路径/自身/穿越/裸../兄弟/跨盘/混合/末尾/大小写/UNC）。
- **IMG-04 间歇假红**：池抽题带图优选从「概率补捞」升级为两级确定性配额（L1 带图层 ⌈n/2⌉ +
  L2 五维 + L3 兜底），`/api/pool/questions` 结果层顺序扫池必达 + 带图稳定分区截断；
  断言升级为「带图 ≥ ⌈n/2⌉」确定性下限（20 轮实测全 5）。
- **`source`/`kadian` 抽题过滤越界**：带图补足路径原只按 module 过滤（实测 `source=qiuzhao`
  10 条中 5 条主源是 xingce-app）。补 `imgPoolFilter` 谓词，三过滤维度统一 honour。
- **练习卡五维标注未透传**：`study-view` 组装练习卡时漏传 `dims` → 五维块不渲染。已补
  `dims: x.dims`（API 与共享卡早已支持，缺的只是这一处映射）。
- **孤儿出处**：cf 归并/覆盖后残留 `question_source` 指向不存在的 canonical（实测 1987 条）。
  rebuild 后自动清理，守卫 `SMOKE-POOL-02b` 保证不变量。

### 新增

- 统一存储主线（cycle-34~42 累积）：SQLite 统一池 `~/.dsh/kaogong/.kaogong.db`——跨源内容级
  去重（140465→86454 题）、出处全标记（229732 行）、解析多版本（141121 行，`/api/pool/analysis-versions`）。
- 端到端：gwy-zhenti 89254 出处入池、跨源检索源多样性轮转、客户端暗色/亮色主题适配。

### 工程 / 规范

- 新增 `CONTRIBUTING.md` / `.github/PULL_REQUEST_TEMPLATE.md` / `docs/agents/BRANCHING-STRATEGY.md`
  —— 确立 `develop` 为统一开发主线，`main` 为发布线。
- 仓库卫生：恢复 `.gitignore` 的 `.cycles/*` 排除规则（`config.yml` 除外）；`cordis.local.yml`
  与 `data/progress.json`（开发态数据）不入库，提供 `.example` 样例。
- 版本三锚点同步 1.30.0 → 1.31.0（`npm run version:bump`）。

## [1.30.0] - 2026-11-14

- issue #3 补录可用性根治（真题卷全文第三通道）+ 错题本工作台。（详见 git tag v1.30.0）
