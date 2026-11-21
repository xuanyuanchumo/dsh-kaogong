# 前端 UI 规范（cycle-48 固化 · 守卫随测试演进）

> 适用范围：`src/client/**`（ui-kit.tsx + views/*.tsx + question/*.tsx）。
> 原则：**视觉层级靠 token、交互反馈靠全局规则、降级语义靠卡片级**——三者都不许每处手写。

## 一、颜色 token（单一事实源 = client.tsx 注入的 `:root` 变量）

| token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--surface-card` | `#fff` | `#232324` | 卡片/面板底（dsw alias 派生） |
| `--text-primary` | `#0f172a` | `#e2e8f0` | 主文字（标题/正文强调） |
| `--text-secondary` | `#475569` | `#cbd5e1` | 次级文字（正文默认） |
| `--text-muted` | `#64748b` | `#94a3b8` | 弱化文字（说明/标签） |
| `--text-faint` | `#94a3b8` | `#64748b` | 极弱文字（辅助/占位） |

**纪律**：
1. **视图层文字色禁止硬编码 slate 灰阶**（`#0f172a/#334155/#475569/#64748b/#94a3b8`）——一律消费
   `var(--text-*)`（cycle-48 已完成 253 处 token 化；新增代码直接用变量）。
2. **brand 语义色允许硬编码**（indigo `#6366f1` / emerald `#10b981` / amber `#f59e0b` / red `#ef4444` /
   violet `#8b5cf6` 等）——它们是「语义色板」而非「主题色」，暗底可读，且与图分析色板
   （NODE_META/EDGE_META）同源。
3. **SVG 图元 fallback 灰可用 `var(--text-faint)`**（CSS 变量在 SVG fill/stroke 上下文可解析）。

## 二、交互反馈（全局规则，零状态化）

React 内联样式体系无法用 `:hover`——**不自管 onMouseEnter 状态**，统一走 client.tsx 注入的
全局规则（cycle-48 落地）：

```css
[style*="cursor: pointer"]:hover { filter: brightness(1.06) }
[style*="cursor: pointer"]:active { filter: brightness(.94) }
```

**纪律**：可点元素只需 `cursor: 'pointer'` 即自动获得 hover/active 反馈；不要为单元素
手写 onMouseEnter 状态机（既有 1 处保留，新增禁止）。导航按钮用 `.kg-navbtn` 类（有
专属 hover/选中态）。

## 三、降级语义（卡片级，绝不白屏）

1. 接口字段一律视为可选——缺失即**卡片级降级**（隐藏该卡/显示占位），绝不 `role="alert"`。
2. `role="alert"` 只属于 ErrorBoundary 兜底态——任何正常分支不许渲染它（render 旅程全量断言）。
3. 诚实降级必须回答「用户下一步怎么走」（C32 教训：降级≠死路，配跳过/重试入口）。

## 四、组件复用

1. **卡片**：优先 `<Card>`（ui-kit，surface-card 底 + radius 14 + shadow）；紧凑形态可用
   `var(--surface-card)` 内联（差异属设计自由度，不强制统一）。
2. **三态**：加载/错误/空一律 `KgLoad/KgErr/KgEmpty`（C44 守卫：视图层禁止手写 kg-load）。
3. **徽章行**：`KgChips`；出处标注：`SourceBadge`；五维标注：`DimBlock`。
4. **新增重复样式 ≥3 处时必须提为 ui-kit 组件**（先查 ui-kit 是否已有——16 组件清单见
   ui-kit.tsx 导出）。

## 五、守卫状态

| 规范条目 | 守卫 | 状态 |
|---|---|---|
| 文字 token 化 | 无字面守卫（机械替换已清零，回归靠 review） | ✅ 253 处完成 |
| 全局 hover 反馈 | 无字面守卫（CSS 注入一次性落地） | ✅ 完成 |
| 卡片级降级 | render 旅程全量 role="alert" 断言 | ✅ 长期守卫 |
| KgLoad 禁手写 | C44-02 静态守卫 | ✅ 长期守卫 |
| 组件消费 ≥4 视图 | C44-03 静态守卫 | ✅ 长期守卫 |
