# 07 · 内容寻址、原子写与 Merkle 根：从「一致性」到「数据完整性工程」

> dsh-kaogong 研究文档 · cycle-19

## 1. 定义与原理

**内容寻址（Content-Addressing）**：标识符 = 数据的哈希。数据变 → 标识变 → 依赖者自动感知。git blob、语料 fixtureHash、错题 sig 同属一族。

**原子写（Atomic Write）**：`write(tmp) → rename(tmp, target)`——rename 在同一文件系统上是原子操作，读者要么看到旧完整文件、要么看到新完整文件，**不存在中间态**。对比 `truncate + write`：崩溃窗口内读者看到半截文件。

**Merkle 树/根**：叶子=数据块哈希，父=子哈希的哈希，根=整棵树指纹。两棵树比根即可知全部叶子是否一致；局部比对从根下行 O(log n) 定位差异块。

## 2. 本插件代码落地

| 落点 | 内容 |
|---|---|
| `src/server/srs.ts` | 错题 `sig = sha1(module|stem前120字)` 内容寻址去重——同一性判定 O(1) |
| `src/adapters/huasheng13.ts` | 索引快照带 `fixtureHash`：语料文件哈希变化 → 快照自动失效重建（内容寻址失效） |
| `src/server/dataRoot.ts:42` | repos-config.json **原子写**（tmp+rename）——配置写崩不产生半截 JSON |
| `src/server/srs.ts`/`dataApi.ts` | progress 写入 tmp+rename 原子落盘 |
| ANIC 技能 `scripts/lib/eval-runner` | 测试缓存键 = 源文件集 **Merkle 根**（`.cycles/.eval-cache.json` keyed by Merkle root `75deb733…`）——任何源文件变化 → 根变 → 缓存自动失效，无需手工清缓存 |
| ANIC 技能 `scripts/lib/ledger.mjs` | 门禁账本**哈希链**：每条记录含前一条的哈希 → 篡改任何中间记录即断链可检（INV-9 append-only） |

**EOL 纪律（cycle-18 ㉚）**：脚本改文件必须 `newline=''`/二进制模式保持原 EOL——Windows 上 LF→CRLF 翻转会让 git diff 显示「整文件改写」，污染 blame 历史。提交前 `git diff --numstat` 查「增删都接近文件总行数」即 EOL 翻转。

## 3. 中文思维：语言/学习场景启发

- **一字千金，一字一证**：内容寻像「盖印章」——内容变印章就变，鉴定真伪只需比对印章（哈希）不必通读全文。错题 sig 就是题目的「指纹」，指纹相同即同一题。
- **改卷子先誊后换**：原子写像考场誊卷——把新答案誊在草稿纸上（tmp），誊完一次换上（rename）。考试中途（崩溃）监考老师看到的要么是旧卷要么是新卷，绝不会是涂了一半的。
- **总账一笔对**：Merkle 根像总账——对账时不必逐笔核对，比对「总账页」即可知有无差异，有差异再逐级下钻。账本哈希链是「每页写上上一页的页脚」——撕掉中间一页立即可见。

## 4. 工程实践价值

1. **一切持久写路径走原子写**：本插件 progress/config/快照三类写路径全部 tmp+rename——崩溃安全从「希望不崩」变为「崩了也不坏」。
2. **内容寻址失效优于时间失效**：TTL 缓存（「5 分钟后过期」）在数据未变时浪费重建、在数据已变时提供脏数据；fixtureHash 失效两种情况都正确。
3. **Merkle 缓存键的复制成本为零**：根就是一个字符串，比对根=比对全库——ANIC eval-runner 借此实现「cache miss 才跑测试」，Amdahl 并行预热的时间省在「没变就不跑」。

## 5. 验证方式

```bash
node smoke.test.mjs   # R28 族 pack 实测 + progress 原子写守卫
node smoke.test.mjs   # SRS sig 去重断言
```
