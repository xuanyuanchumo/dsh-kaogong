# API 参考（v1.7.2）

> 所有端点前缀：宿主通道 `/kaogong/api/*`，独立端口通道 `/api/*`（两侧都接受带前缀路径）。
> 隔离参数：`?ws=<workspace>`（缺省为 `default`）。
> **本文件与 `src/shared/manifest.js` 必须同步**；改端点先改 manifest。

## 一、核心（coreApi）

| 端点 | 方法 | 说明 | 主要返回 |
|---|---|---|---|
| `/api/status` | GET | 插件状态信标 | `{app, version, port, pid, uptimeSec, repos:{ready,total}, ws, progress}` |
| `/api/stats` | GET | 学习统计 | `{days[], streak, answered, rate, mastery{}, wrong:{open,mastered}}` |
| `/api/graph` | GET | 知识图谱快照 | `{nodes[], edges[], metrics:{V,E,density,components}, rank[], health{total,factors}}` |
| `/api/telemetry` | GET | 遥测（环形 p50/p95） | `{uptimeSec, totalRequests, qpsWindow, coverage, endpoints{}}` |
| `/api/capabilities` | GET | 能力矩阵对账 | `{endpoints[], tools[], views[], entries[], channels[]}` |
| `/api/workspaces` | GET | 命名空间清单 | `{list[]}` |
| `/api/progress` | GET | 进度全文 | 进度对象 |
| `/api/check` | POST | 判分并落进度 | `{isCorrect, correctAnswer, analysis, wrongEvent, progress}` |

`/api/check` 请求体：`{question: <完整题对象>, answer: 'A', label?: string}`

## 二、题库/计划/方法论（dataApi）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/questions?module=&count=&sort=srs` | GET | 抽题（`sort=srs` 走错题回炉 + 弱点加权） |
| `/api/banks` | GET | 题库清单（15 仓库就绪状态） |
| `/api/modules` | GET | 模块及题量 |
| `/api/plan?day=` | GET/POST | 30 天计划读取/更新 |
| `/api/method?topic=` | GET | 方法论参考（10 主题） |
| `/api/search?q=` | GET | 15 仓库全文检索 |
| `/api/wrong` | GET | 错题本（五箱 SRS） |
| `/api/wrong/remove` | POST | 移除错题 |

## 三、真题卷 / 专题 / 申论（paperApi）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/papers?subject=&exam=&year=&q=` | GET | 试卷列表（**1683 套**）+ 科目聚合 |
| `/api/paper?id=` | GET | 单卷详情：材料 + 题目 + 参考答案（图片已改写为端点 URL） |
| `/api/topics` | GET | **专题树**（见下） |
| `/api/essay/list?type=&limit=` | GET | 申论题目聚合（五类题型筛选） |
| `/api/essay/grade` | POST | 小题评分（采分点制） |
| `/api/essay/article` | POST | 大作文评分（字数分档 + 结构论证） |
| `/api/essay/history` | GET | 申论练习历史 + 均分率 |
| `/api/paper-img?id=&p=` | GET | **二进制**：试卷配图 |
| `/api/paper/exam/start?id=` | GET | 整卷模考开始（**不下发答案**） |
| `/api/paper/exam/submit` | POST | 交卷计分 + 模块分布 |
| `/api/paper/exam/history` | GET | 模考历史 + 均分率 |

### `/api/topics` 返回结构（v1.7.1）

```json
{
  "channels": [
    {
      "id": "xingce", "name": "行测", "icon": "📐",
      "desc": "深度题库 27506 题 + 真题卷 739 套",
      "topics": [
        { "id": "xc:module:判断推理", "kind": "module", "title": "判断推理",
          "questionCount": 7749, "desc": "深度题库 7749 题（含解题链标注）",
          "entry": { "view": "practice", "params": { "module": "判断推理" } } },
        { "id": "xc:cat:图形推理", "kind": "category", "title": "图形推理",
          "questionCount": 1234, "entry": { "view": "deepbank", "params": { "category": "图形推理" } } }
      ],
      "entries": [
        { "label": "刷题（SRS）", "view": "practice", "params": {} },
        { "label": "深度题库", "view": "deepbank", "params": {} },
        { "label": "整卷模考", "view": "exam", "params": {} },
        { "label": "真题卷库", "view": "papers", "params": { "subject": "行测" } }
      ]
    },
    { "id": "shenlun", "name": "申论", "icon": "✍️", "topics": [ /* 五类题型 */ ], "entries": [ /* 2 个 */ ] }
  ],
  "stats": { "paperTotal": 1683, "essayPapers": 944, "xingcePapers": 739, "naokuTotal": 27506 }
}
```

`entry` 是**统一练习路由**：UI 点击后 `onGo(entry.view, entry.params)` → 切视图并传参。

### 申论评分契约

**小题** `/api/essay/grade` 权重：要点覆盖 50% / 结构 20% / 字数 15% / 语言 15%

```json
{ "score": 16.5, "max": 20, "chars": 182, "limit": 300,
  "dims": { "coverage": 78, "structure": 80, "length": 85, "language": 100 },
  "hitTerms": ["如何走新型工业化道路"], "missingTerms": ["如何提高国家粮食安全"],
  "feedback": ["要点覆盖中等，可再补充 2-3 个关键点"] }
```

**大作文** `/api/essay/article`：

```json
{ "score": 28.6, "max": 40, "chars": 181, "limit": 1000,
  "lengthBand": "严重不足", "lengthPenalty": 5,
  "dims": { "structure": 100, "argument": 25, "language": 80 },
  "elements": { "hasOpening": true, "subPoints": 3, "hasEnding": true, "argMarkers": 2 },
  "feedback": ["字数严重不足（181/1000），考场按档约扣 5 分"] }
```

## 四、深度题库（naokuApi · 27506 题五维标注）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/naoku/status` | GET | 题库状态 + 标注覆盖率 + 模块/题型分布 |
| `/api/naoku/questions?module=&category=&kadian=&count=` | GET | 抽题（含五维标注 + 配图 markdown） |
| `/api/naoku/kadian?q=&limit=` | GET | 知识点检索（考点 → 思路） |
| `/api/naoku/practice?kadian=&count=` | GET | 按知识点刷题 |
| `/api/naoku-img?p=` | GET | **二进制**：深度题库配图 |

五维标注字段：

| 字段 | 含义 | 覆盖 |
|---|---|---|
| `kadian` | 考点定位（考什么） | 100% |
| `reasoning` | 解题推理链（怎么想） | 100% |
| `fastest` | 最快解法（考场用） | 41% |
| `pitfalls` | 易错点 | 41% |
| `mother` | 母题思维 | 部分 |

## 五、工具（host 半，模型可见）

| 工具 | 类 | 说明 |
|---|---|---|
| `kaogong_launch` | 离线 | 平台状态与引导 |
| `kaogong_ai_tutor` | 可选 AI | 错题辅导（拉方法论 + 知识片段） |
| `kaogong_ai_plan` | 可选 AI | 个性化学习建议（读进度） |
| `kaogong_ai_shenlun` | 可选 AI | 申论批改素材 |
| `kaogong_ai_essay_review` | 可选 AI | **深度点评**：离线基线分 + 方法论 → 交模型 |

`kaogong_ai_essay_review` 参数：`{paperId?, no?, question?, answer, mode?: 'essay'|'article', workspace?}`

## 六、视图清单（13）

`dashboard`(仪表盘) · `practice`(刷题) · `deepbank`(深度题库) · `exam`(模考) · `papers`(真题卷) · `topics`(专题) · `essay`(申论) · `wrongbook`(错题本) · `plan`(计划) · `search`(检索) · `method`(方法论) · `graph`(图谱) · `observability`(可观测)

## 七、错误码约定

| 场景 | 返回 |
|---|---|
| 参数缺失 | `{error: '缺少 xxx 参数'}` |
| 资源不存在 | `{error: '试卷不存在: <id>'}` |
| 能力不可用 | `{fallback: true, hint: '...'}`（不抛错，UI 显示降级提示） |
| 二进制端点 | HTTP 400/403/404/415 + 纯文本 body |
