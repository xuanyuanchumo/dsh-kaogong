# 数据源与适配器

> 15 个开源仓库 → 适配器层。原则：**只读**源仓库，慢操作做缓存，平台能力做降级。
> **v1.11 关键变化：数据根可配置**。npm/GitHub 安装态下插件包内不含数据（~2.2GB，归上游作者），
> 数据根四级解析：env `KG_REPOS_DIR` > `data/repos-config.json` > 开发态上级目录 > `data/repos` 托管默认；
> 用户在「📦 题库管理」一键克隆（分级：必选/推荐/可选），安装/删除后域重建 + 三级缓存失效。

## 一、仓库地图（根=运行期解析的数据根，见上；开发态识别为工作区上级目录）

| 仓库 | tier | pack | 内容 | 本项目用途 |
|---|---|---|---|---|
| **xingcezhenti** | 必选 | 341MB | 515 套卷 58890 题分模块 + 39051 图 | ✅ 刷题硬依赖 / 深度题库配图来源 |
| **kaogong-skill** | 必选 | 3MB | 方法论 10 主题 | ✅ 方法论视图 / AI 工具素材 |
| **gk-tuxing** | 必选 | 19MB | 图形推理 354 题逐题解析（13 规律） | ✅ 图推视图（T-023 已落地） |
| **gwy-zhenti** | 推荐 | 626MB | 真题卷 **1683 套**（申论 944/行测 739，2008–2026）+ 114849 图 | ✅ 真题卷库 / 申论 / 模考 / 配图 |
| **GongkaoNaoku** | 推荐 | 120MB | **27506 题五维标注** db 分片 | ✅ 深度题库 |
| kaogongzhentizhengliu | 可选 | 208MB | 22375 篇考点重组深度笔记 | 检索增强 |
| AdministrativeAptitudeTest | 可选 | 2MB | 近二十年国考省考选调生试卷 PDF | 打印模考 |
| NovaForge | 可选 | 3MB | 通用笔记模板（LaTeX/Typst/Markdown） | 备用 |
| sakib | 可选 | 1MB | 公考知识文档库 | 检索增强 |
| developer2gwy | 可选 | 1MB | 程序员上岸公考实践指南 | 备用 |
| Exam_Database | 可选 | 131MB | 多渠道考公素材题库 | 检索增强 |
| qiuzhao-epi-bank | 可选 | 486MB | 秋招行测/银行 EPI 697 题 PWA | 参考 |
| xingce-app | 可选 | 46MB | 离线行测 App（22298 题 Android） | 数据参考 |
| civil-exam-agent | 可选 | 276MB | 公考督导智能体系统 | 参考 |
| yunduanqiqu | 可选 | 5MB | 申论范文/面试真题/素材分享 | 备用 |

> 注册表真值 = `src/shared/manifest.ts` 的 `REPOS_META`（含 upstream 真实地址）；本表与其同步。

## 二、适配器一览

| 适配器 | 数据源 | 缓存策略 | 降级行为 |
|---|---|---|---|
| `adapters/repoData.js` | 15 仓库 | 进程内 TTL | 仓库缺失 → 该模块 0 题 |
| `adapters/paperData.js` | gwy-zhenti | **磁盘快照** `data/.paper-index.json`（首建 16s → 61ms） | 无快照则现场重建 |
| `adapters/paperParse.js` | 试卷文本 | 无（纯函数） | — |
| `adapters/naoku.js` | GongkaoNaoku 分片 | 合并为 `data/.naoku.db` + 只读连接 | `node:sqlite` 不可用 → `{ready:false, hint}` |
| `adapters/naokuImage.js` | xingcezhenti/90-图片 | 目录列表缓存（39051 文件只列一次） | 找不到图 → 跳过该图 |

## 三、关键字段映射

### 3.1 试卷（gwy-zhenti）

文件路径：`gwy-zhenti/<考试>/<年份>/[<卷型>/]<科目>-<卷型>.md`（3–4 层深）

```yaml
---
考试: "国考"          地区: "国考"        年份: 2009
科目: "申论"          卷型: "副省级"
真题性质: "粉笔题库整理版本"   来源: "https://www.fenbi.com/ti/view/paper/..."
---
```

正文结构：

```
## 给定材料
### 材料 1
（正文，行测卷含 ![](assets-fenbi-229/xxx.png)）
## 题目
### 第 1 题
**题干**（申论加粗；行测为纯文本 + A. B. C. D. 选项行）
关联材料：材料 1、材料 2
作答要求：不超过300字
<details><summary>答案与解析</summary>
**参考答案（粉笔题库参考内容）**
（申论多段；行测为单行字母 + **解析**）
</details>
```

### 3.2 行测 vs 申论解析差异（`paperParse.js`）

| 维度 | 申论 | 行测 |
|---|---|---|
| 题干 | `**加粗**` 段落 | 纯文本（首个 `A.` 行之前） |
| 选项 | 无 | `^([A-D])[.、．]\s*(.+)$` 逐行 |
| 答案 | details 内「参考答案」段 | details 内**首个独立大写字母行** |
| 分值 | 题干内 `（20分）` | 多数无 |
| 题型 | 从题干/要求推断 | `<sub>` 标签，退化时 `guessXingceType()` 六模块推断 |

### 3.3 深度题库（GongkaoNaoku）

表 `questions` 关键列：

| 列 | 含义 | 覆盖 |
|---|---|---|
| `module` | 模块（判断推理/言语…/常识判断/资料分析/数量关系） | 100% |
| `category` | 细分题型（图形推理/逻辑判断/片段阅读…） | 高 |
| `kadian` | 考点定位 | 100% |
| `reasoning` | 推理链 | 100% |
| `fastest` | 最快解法 | 41% |
| `pitfalls` | 易错点 | 41% |
| `mother` | 母题思维 | 部分 |
| `stem` / `options` / `answer` | 题干（HTML）/ 选项（JSON）/ 答案 | 100% |
| `img_refs` | 图片引用（**记 `.webp`，磁盘是 `.png`**） | 10647 题 |

**图片坑**：`img_refs` 与磁盘扩展名不一致（DB 记 webp，磁盘只有 png）。`naokuImage.js` 按「去扩展名 basename」在候选扩展名中探测，并有前缀匹配兜底。

## 四、新增数据源的步骤

1. 勘察真实结构（**必须看原始字节**，不能凭假设——CRLF、中文键、图片扩展名都踩过坑）。
2. 写适配器到 `src/adapters/`，只读 + 加缓存。
3. 若产出新端点 → 先改 `manifest.js`（端点 + REPOS_META 若为新仓库要登记 tier/upstream）。
4. 在 `src/server/` 加域模块并挂进 `handleApi` 链（域工厂 `buildDomains` 内装配，保证换根重建覆盖它）。
5. smoke 加**真实数据**端到端断言（不要 mock）；运行时断言置于 §11b 长阻塞之前、§12 关服务器之前（教训⑤⑧）。
6. 更新本文件 + API-REFERENCE。

## 五、性能基线（实测）

| 操作 | 耗时 | 说明 |
|---|---|---|
| 真题卷索引首建 | 16.5s | 1683 文件头部读取 |
| 真题卷索引（快照） | **61ms** | `data/.paper-index.json` |
| 深度题库合并分片 | 首建一次 | 147MB → `data/.naoku.db` |
| 深度题库抽题 | ~10ms | SQLite 只读 + 目录缓存 |
| 图片服务 | ~5ms | 文件流 |
| 申论评分 | ~15ms | 规则引擎 |
