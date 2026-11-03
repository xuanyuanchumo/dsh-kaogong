# 测试报告 — cycle-13（v1.9.0）

## 1. 元信息

| 字段 | 值 |
|---|---|
| 循环 | cycle-13 |
| 日期 | 2026-11-03 |
| 执行者 | AI-L4（W1-W3 subagent + Lead 收口） |
| 关联提交 | `b6af193`（W1）→ `96b3912`（W2+W3） |

## 2. 结论（先看这里）

**PASS** — smoke **164/164**、render **35/35**、band-detector **Status: OK 零 OVER_BUDGET**、构建零错误（11 模块合并 307.9KB）。变异反证有效（破坏 graphKeyCommand → 33/1 红；恢复 → 绿）。

## 3. 分层证据（完整输出见同目录 .txt）

| 层 | 命令 | 结果 | 报告文件 |
|---|---|---|---|
| 构建/类型门 | `npm run build` | exit 0，`[bundle-client] 已合并 11 个模块 → dist/client/client.js（307.9 KB）`，~3.9s | band-cycle13.txt |
| 服务端 E2E | `node smoke.test.mjs` | **164/164 通过**（~26s，两遍稳定） | smoke-cycle13.txt |
| 浏览器级渲染 | `node render.test.mjs` | **35 通过 / 0 失败**（~2.9s） | render-cycle13.txt |
| 复杂度带 | `band-detector .` | Status: OK；最高 manifest.ts 182（容忍带内既有），client 族 ≤173 | band-cycle13.txt |

## 4. 本循环新增断言（摘录）

- **smoke +20**（W2a 静态 10 + W3 运行时 10）：省份 facet≥35/含山东+全国/码点升序/两次构建深相等、`?province=` 过滤命中、**schemaVersion=1 伪快照运行时验证版本门弃用重建**、/api/methods 活体、naoku 结构化降级非 5xx、导航七项/四视图路由保留/QuickPractice 零残留。
- **render +13**：专题枢纽六分区逐区切换零降级、省份 chips 点击触发 `province=%E5%B1%B1%E4%B8%9C` fetch（__kgFetchLog 录制）、能力流三列 SVG/量化四卡/三态灯列/泳道≥60 热力格、四端点空对象降级不抛错、图谱着色五模式/图例/边类型 chips/小地图证据链/导出 PNG/**键盘 l 真实切布局（graphKeyCommand 行为级）**。

## 5. 复现步骤

```bash
cd D:/Projects/TraeProjects/kaogong/dsh-kaogong
npm run build && node smoke.test.mjs && node render.test.mjs
node "D:/Projects/TraeProjects/dsh-anic/assets/skill/scripts/band-detector.mjs" .
```

## 6. 缺陷与处置（本循环内闭环）

| 缺陷 | 根因 | 处置 | 回归 |
|---|---|---|---|
| eval-runner 并行预热 test∥build 竞态 → 「client 有错误边界」假红（163/164） | build 的 tsc 步先把 dist/client/client.js 重写为裸 ESM，bundler 合并前被 smoke 读取（ErrorBoundary 类在 ui-kit 模块，未合并） | ① bundler 改**原子写**（tmp+rename）；② smoke 增 **0a combo 完整性自愈**（无 combo 头即现场重合并） | `npx tsc && node smoke.test.mjs`（裸 ESM 现场注入）→ 自愈生效 164/164；已固化 CLAUDE.md 教训⑥ |

## 7. 手工记录

- 沙箱/热重载实测由 Lead 在收口链执行（见审计日志与交付清单）。
- 测试动 `data/.paper-index.json` 已测前备份/finally 还原，无现场污染（R-P-03 伪快照实验）。
