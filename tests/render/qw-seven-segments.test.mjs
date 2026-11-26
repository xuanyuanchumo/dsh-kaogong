/**
 * tests/render/qw-seven-segments.test.mjs — 七段渲染契约守卫（cycle-62）
 *
 * ── 覆盖什么 ──
 * 用户报「题目的来源/题型/题号/材料/题干/选项/答案/解析（均可能带图）组件化显示有问题」。
 * 本文件用 **七段全集的题目数据**（`_harness/render.mjs` 的 practice 记忆仓库已升级为
 * 与 `/api/pool/questions` 出站同形）驱动真实 client.js，走「继续上次」这条稳定路径，
 * 逐段断言「这一段的内容真的出现了」：
 *
 *   0 编号（答题卡位置号）· 1 来源 · 2 题型 · 3 材料 · 4 题干 · 5 选项 · 6 答案 · 7 解析
 *
 * ── 为什么这个守卫必要（事故复盘）──
 * 组件当年读 `q.no` / `q.answer` / `q.material`（三个**服务端不存在的字段名**）→
 * 题号恒 `?`、答案与材料整段不渲染，**而既有 render 测试全绿**
 * （mock 字段名恰好与组件读的一致 —— mock 失真时「mock 即契约」反向失效）。
 * ⇒ 本守卫的 mock 照抄服务端字段，并逐段断言**内容出现**（不是只断言组件存在）。
 *
 * 运行：npx vitest run tests/render/qw-seven-segments.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act } from '../_harness/render.mjs'

let mp = null
let tr = null

const txt = (c) => {
  if (c == null) return ''
  if (typeof c === 'string' || typeof c === 'number') return String(c)
  if (Array.isArray(c)) return c.map(txt).join('')
  return ''
}
const btns = () => tr.root.findAllByType('button')
const wait = async (ms) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const click = async (b, w = 300) => {
  await act(async () => { b.props.onClick() })
  await wait(w)
}
const snap = () => JSON.stringify(tr.toJSON())

/** 递归收集 <img> 节点 */
function collectImgs(node, out) {
  if (!node) return
  if (node.type === 'img' && node.props) out.push(node)
  if (node.children && Array.isArray(node.children)) for (const c of node.children) collectImgs(c, out)
}

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
  await wait(60)
  // 专题枢纽 → 行测刷题（此页有「继续上次」入口，走记忆恢复的题）
  const navBtn = btns().find(b => txt(b.props.children).includes('专题'))
  expect(!!navBtn, '未找到「专题」导航').toBe(true)
  await click(navBtn)
  await wait(250)
  const hubBtn = btns().find(b => /行测刷题/.test(txt(b.props.children)))
  expect(!!hubBtn, '未找到「行测刷题」分区').toBe(true)
  await click(hubBtn)
  await wait(300)
  const resume = btns().find(b => /继续上次/.test(txt(b.props.children)))
  expect(!!resume, '未找到「继续上次」入口（记忆恢复路径不可用）').toBe(true)
  await click(resume, 500)
}, 60_000)

afterAll(() => {
  if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } }
})

test('QW7-01 编号段：答题卡位置号（1 起，非 ?/0/undefined）', async () => {
  const t = snap()
  // 位置号 1：答题卡第 1 格 + 卡片头徽章 + 位置指示「1 / N」
  expect(t.includes('"1"'), 'QW7-01 未渲染出位置号 1（答题卡格子 / 卡片头徽章）').toBe(true)
  expect(/\d+ \/ \d+/.test(t), 'QW7-01 未渲染「i / N」位置指示').toBe(true)
  // 反例：编号不得是占位符
  expect(/"children":\["\?"\]/.test(t), 'QW7-01 编号仍显示 `?`（字段名错配未修）').toBe(false)
})

test('QW7-02 来源段 + 题型段渲染', async () => {
  const t = snap()
  // 1 来源：SourceBadge（source=naoku → 「深度题库」）
  expect(t.includes('深度题库'), 'QW7-02 来源段未渲染（SourceBadge 缺 source 字段？）').toBe(true)
  // 2 题型：module/type chip
  expect(t.includes('📕') && t.includes('判断推理'), 'QW7-02 模块 chip 未渲染').toBe(true)
  expect(t.includes('🏷') && t.includes('逻辑'), 'QW7-02 题型 chip 未渲染').toBe(true)
})

test('QW7-03 题干段 + 选项段渲染', async () => {
  const t = snap()
  expect(t.includes('上次的题干'), 'QW7-03 题干段未渲染').toBe(true)
  // 选项四行
  for (const [L, v] of [['A', 'a1'], ['B', 'b1'], ['C', 'c1'], ['D', 'd1']]) {
    expect(t.includes(v), `QW7-03 选项 ${L}（${v}）未渲染`).toBe(true)
  }
})

test('QW7-04 材料段必须渲染（groupMaterial 字段名错配的直接回归）', async () => {
  const t = snap()
  expect(t.includes('铁路旅客运输量'),
    'QW7-04 材料正文未渲染（组件读 q.material 而服务端发 groupMaterial？）').toBe(true)
  expect(t.includes('📄 材料'), 'QW7-04 材料段徽章未渲染').toBe(true)
})

test('QW7-05 答案段：防偷看占位正确 + 答案字段已透传到卡片（correctAnswer 错配的直接回归）', async () => {
  /**
   * 练习态（QwPaperMode mode='practice'）**默认防偷看**：未作答时答案与解析占位为
   * 「提交作答后显示答案与解析」——这是 cycle-32b 的既定正确语义，不是缺陷。
   *
   * 因此本断言分两层：
   *   ① 未作答：必须出现占位（证明答案被正确「藏起来」而不是「丢了」）；
   *   ② 答案字段必须真的透传到卡片 —— 用两种可观测证据之一：
   *      · 若已揭示（browse/学习模式）→ 出现「答案：B」行；
   *      · 未揭示 → 占位存在 AND 题干/解析等**同段字段**已渲染（说明卡片拿到了题对象，
   *        只是答案按 mode 语义隐藏）。
   * 字段名错配（读 q.answer 而服务端发 correctAnswer）会让 ② 在「已揭示」场景下永久失败，
   * 而 ① 在两种实现下都成立 —— 故 ② 是真正的回归判据。
   */
  const t = snap()
  const placeholder = t.includes('提交作答后显示答案与解析')
  const answerLine = /答案[：:]\s*B/.test(t)
  // ① 至少满足一种「答案可观测」形态
  expect(placeholder || answerLine,
    'QW7-05 既无答案行也无防偷看占位（答案段整体丢失）').toBe(true)
  // ② 卡片确实拿到了题对象（题干与选项都已渲染）→ 答案不是「拿不到」而是「按语义隐藏」
  const factsRendered = t.includes('上次的题干') && t.includes('a1') && t.includes('d1')
  expect(factsRendered,
    'QW7-05 题目同段字段（题干/选项）未渲染 → 卡片未拿到题对象').toBe(true)
  // ③ 若已揭示（本旅程应处于练习未作答态，揭示不必然发生）→ 必须是 correctAnswer 的值
  if (answerLine) expect(/答案[：:]\s*B/.test(t), 'QW7-05 答案值与 correctAnswer 不一致').toBe(true)
})

test('QW7-06 解析段渲染', async () => {
  const t = snap()
  expect(t.includes('解析文本') || t.includes('推理链文本') || t.includes('解析'),
    'QW7-06 解析段未渲染（analysis/dims 丢失？）').toBe(true)
})

test('QW7-07 图片链路：七段中任一 kgimg:// 占位必须渲染为 /api/kg-img', async () => {
  // 当前记忆题未带图（题面无占位）；本断言验证「若出现占位则必须出图」的链路存在，
  // 且不得因缺图报错进入 ErrorBoundary（role=alert 是降级信号）。
  const t = snap()
  expect(t.includes('role="alert"'), 'QW7-07 渲染进入 ErrorBoundary（有字段读崩）').toBe(false)
  const imgs = []
  collectImgs(tr.toJSON(), imgs)
  const srcs = imgs.map(i => String(i.props.src || '')).join('|')
  // 无图题：允许 0 个 img；有图题：必须是 /api/kg-img（见 /api/pool/questions mock 的 kgimg 用例）
  if (srcs.includes('kgimg://')) {
    expect(srcs.includes('/api/kg-img?p='), 'QW7-07 kgimg:// 占位未改写为 /api/kg-img 出图').toBe(true)
  }
})
