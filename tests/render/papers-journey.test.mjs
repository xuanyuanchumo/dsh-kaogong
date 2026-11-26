/**
 * tests/render/papers-journey.test.mjs — 渲染旅程·真题卷三模式域（cycle-47 阶段 18 迁移）
 *
 * 从 render.test.mjs 旅程段迁入（覆盖 L780-975）：
 * RENDER-P-01（省份 chips facet 驱动 + 点击触发 ?province= 请求）+
 * RENDER-PP-30（browse 自答对照全旅程）+ PP-31（未对照态解析完整）+
 * PP-31b（学习模式防偷看）+ PP-32（三模式切换 + 学习判分 + exam 链复用）。
 * fresh mount 独立步进（harness mountPanel）；判定逐字等价。
 *
 * 运行：npx vitest run tests/render/papers-journey.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act, React, TestRenderer } from '../_harness/render.mjs'

let mp = null
let tr = null

/** 试卷列表项扁平文本（div onClick + 嵌套 children，旧判据逐字等价） */
function flatText(node, depth) {
  if (depth > 6 || !node) return ''
  let s = ''
  if (node.children && Array.isArray(node.children)) {
    for (const ch of node.children) {
      if (typeof ch === 'string') s += ch
      else if (ch && typeof ch === 'object') s += flatText(ch, depth + 1)
    }
  }
  return s
}

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
  // 进入真题卷视图
  const ppBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('真题卷'))
  if (!ppBtn) throw new Error('RENDER-P-01 未找到「真题卷」导航按钮')
  await act(async () => { ppBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
}, 60_000)

afterAll(() => {
  if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } }
})

test('RENDER-P-01: 省份 chips 渲染（facet 驱动）且点击触发 ?province=山东 过滤请求', async () => {
  const pText = JSON.stringify(tr.toJSON())
  expect(pText.includes('省份'), '省份 chips 行未渲染').toBe(true)
  const provChips = tr.root.findAllByType('button').filter(b => /^(山东|全国|广东) \d+$/.test(String(b.props.children)))
  expect(provChips.length >= 3, '省份 chips 少于 3 个: ' + provChips.map(b => String(b.props.children)).join('|')).toBe(true)
  const sdChip = provChips.find(b => String(b.props.children).includes('山东'))
  globalThis.__kgFetchLog.length = 0
  await act(async () => { sdChip.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  const hit = globalThis.__kgFetchLog.find(u => u.includes('/api/papers') && u.includes('province=' + encodeURIComponent('山东')))
  expect(!!hit, '点击省份 chip 未触发带 province 参数的请求').toBe(true)
})

test('RENDER-PP-30: browse 态自答对照全旅程（选卷→下一题→点选 B→对照揭示→重做）', async () => {
  // 回全部卷（清省份过滤语义——重新进入真题卷）
  const ppBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('真题卷'))
  await act(async () => { ppBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  const rows = tr.root.findAll(n => n.type === 'div' && typeof n.props.onClick === 'function')
  const paperItem = rows.filter(r => flatText(r, 0).includes('副省级'))
  expect(paperItem.length > 0, '未找到试卷列表项').toBe(true)
  await act(async () => { paperItem[0].props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  const t0 = JSON.stringify(tr.toJSON())
  expect(t0.includes('整卷浏览'), 'QwPaperMode browse 未挂载').toBe(true)
  // 跳到第 2 题（行测选择题，带卷面答案 B）
  const nextBtn = tr.root.findAllByType('button').find(b => String(b.props.children) === '下一题 →')
  expect(!!nextBtn, '切换区「下一题 →」缺失').toBe(true)
  await act(async () => { nextBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  // 点选项 B 记录自选（div onClick 行扁平文本定位）
  function optText(node, depth) {
    if (depth > 6 || !node) return ''
    let s = ''
    if (node.children && Array.isArray(node.children)) {
      for (const ch of node.children) {
        if (typeof ch === 'string') s += ch
        else if (ch && typeof ch === 'object') s += optText(ch, depth + 1)
      }
    }
    return s
  }
  const optRows = tr.root.findAll(n => n.type === 'div' && typeof n.props.onClick === 'function')
  const optB = optRows.find(r => optText(r, 0) === 'B选项B' || optText(r, 0).includes('选项B'))
  expect(!!optB, 'browse 态选项不可点（interactive/onSelect 转发断裂）').toBe(true)
  await act(async () => { optB.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  // 主动揭示：对照按钮（data-kg-browse-reveal）→ 揭示态 + 重做入口
  const revealBtn = tr.root.findAllByType('button').find(b => b.props['data-kg-browse-reveal'] === '1')
  expect(!!revealBtn, '对照答案按钮缺失').toBe(true)
  expect(String(revealBtn.props.children).includes('B'), '对照按钮未透出卷面答案').toBe(true)
  await act(async () => { revealBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const t1 = JSON.stringify(tr.toJSON())
  expect(t1.includes('重做此题'), '揭示后重做入口缺失').toBe(true)
  expect(t1.includes('解析文本'), '揭示后答案解析段未展开').toBe(true)
  // 重做 → 回未揭示态
  const redo = tr.root.findAllByType('button').find(b => String(b.props.children) === '↺ 重做此题')
  await act(async () => { redo.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  const t2 = JSON.stringify(tr.toJSON())
  expect(t2.includes('对照答案（卷面：B）'), '重做后未回未揭示态').toBe(true)
})

test('RENDER-PP-31: browse 未对照态解析/参考答案完整显示（占位语义收敛到 practice）', async () => {
  const prevBtn = tr.root.findAllByType('button').find(b => String(b.props.children) === '← 上一题')
  expect(!!prevBtn, '切换区「← 上一题」缺失').toBe(true)
  await act(async () => { prevBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  const tUnrevealed = JSON.stringify(tr.toJSON())
  expect(tUnrevealed.includes('提交作答后显示答案与解析'), 'browse 未对照态出现占位行（解析被省略）').toBe(false)
  expect(tUnrevealed.includes('参考答案'), 'browse 未对照态参考答案缺失').toBe(true)
})

test('RENDER-PP-31b: 学习模式未作答态解析/答案占位隐藏（防偷看语义）', async () => {
  const toLearn31 = tr.root.findAllByType('button').find(b => b.props['data-kg-paper-mode'] === 'learn')
  expect(!!toLearn31, '学习模式切换按钮缺失').toBe(true)
  await act(async () => { toLearn31.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const tLearnHidden = JSON.stringify(tr.toJSON())
  expect(tLearnHidden.includes('提交作答后显示答案与解析'), '学习模式未作答时解析未隐藏').toBe(true)
})

test('RENDER-PP-32: 三模式切换 + 学习模式单题判分旅程 + 答题模式 exam 链复用', async () => {
  // 答题模式：验引导卡与开始按钮
  const ansBtn = tr.root.findAllByType('button').find(b => b.props['data-kg-paper-mode'] === 'answer')
  expect(!!ansBtn, '三模式切换条缺「答题模式」按钮').toBe(true)
  await act(async () => { ansBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const tAns = JSON.stringify(tr.toJSON())
  expect(tAns.includes('答题模式（未开始）'), '答题模式引导卡未渲染').toBe(true)
  const startBtn = tr.root.findAllByType('button').find(b => b.props['data-kg-answer-start'] === '1')
  expect(!!startBtn, '开始作答按钮缺失').toBe(true)
  await act(async () => { startBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  const tExam = JSON.stringify(tr.toJSON())
  expect(tExam.includes('⏱') && tExam.includes('交卷'), '答题模式考试中视图未渲染').toBe(true)
  // 学习模式：申论题降级 + 跳题防死路
  const learnBtn = tr.root.findAllByType('button').find(b => b.props['data-kg-paper-mode'] === 'learn')
  expect(!!learnBtn).toBe(true)
  await act(async () => { learnBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const tLearn0 = JSON.stringify(tr.toJSON())
  expect(tLearn0.includes('学习进度'), '学习模式进度条未渲染').toBe(true)
  expect(tLearn0.includes('不支持在线判分'), '主观题降级提示缺失').toBe(true)
  const skipBtn = tr.root.findAllByType('button').find(b => b.props['data-kg-learn-skip'] === '1')
  expect(!!skipBtn, '主观题跳过按钮缺失（学习模式死路）').toBe(true)
  await act(async () => { skipBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const tSkip = JSON.stringify(tr.toJSON())
  expect(tSkip.includes('学习进度 2/'), '跳过主观题未推进到第 2 题').toBe(true)
  // 学习模式第 2 题点选 A（错答）→ 即时揭示
  function lrText(node, depth) {
    if (depth > 6 || !node) return ''
    let s = ''
    if (node.children && Array.isArray(node.children)) { for (const ch of node.children) { if (typeof ch === 'string') s += ch; else if (ch && typeof ch === 'object') s += lrText(ch, depth + 1) } }
    return s
  }
  const lRows = tr.root.findAll(n => n.type === 'div' && typeof n.props.onClick === 'function')
  const optA = lRows.find(r => lrText(r, 0) === 'A选项A' || lrText(r, 0).includes('选项A'))
  expect(!!optA, '学习模式选项不可点').toBe(true)
  await act(async () => { optA.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const tJudge = JSON.stringify(tr.toJSON())
  expect(tJudge.includes('回答错误') && tJudge.includes('卷面答案：B'), '学习模式即时判分揭示缺失').toBe(true)
  expect(tJudge.includes('解析文本'), '学习模式判分后解析未展开').toBe(true)
  // 末题边界：下一题按钮 disabled + 文案「已是最后一题」
  const nextLearn = tr.root.findAllByType('button').find(b => b.props['data-kg-learn-next'] === '1')
  expect(!!nextLearn, '学习模式下一题按钮缺失').toBe(true)
  expect(String(nextLearn.props.children) === '已是最后一题' && nextLearn.props.disabled === true).toBe(true)
  expect(JSON.stringify(tr.toJSON()).includes('学习进度 2/2'), '学习进度未停留在末题').toBe(true)
})

test('RENDER-PP-59: exam 别名路由——点「⏱ 模考」入口选卷直入 answer 模式（倒计时/交卷/报告行为等价）', async () => {
  // 点击左栏 nav「⏱ 模考」→ exam 别名路由（papers + initialMode:'answer'），非旧 NativeExamView
  const examNav = tr.root.findAllByType('button').find(b => String(b.props.children).includes('模考'))
  expect(!!examNav, '未找到「⏱ 模考」导航入口').toBe(true)
  await act(async () => { examNav.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  // 无 paperId 深链时落到卷列表——仍能选卷（行为等价第一环）
  const listRows = tr.root.findAll(n => n.type === 'div' && typeof n.props.onClick === 'function')
  const paperItem = listRows.filter(r => flatText(r, 0).includes('副省级'))
  expect(paperItem.length > 0, '模考入口未落到可选卷列表').toBe(true)
  await act(async () => { paperItem[0].props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  // 行为等价硬断言：选卷后直接进入 answer 模式（引导卡 + data-kg-paper-mode="answer" 激活态）
  const tAnswer = JSON.stringify(tr.toJSON())
  expect(tAnswer.includes('答题模式（未开始）'), '点模考选卷后未直入 answer 模式（深链 armed 未生效）').toBe(true)
  const ansBtn = tr.root.findAllByType('button').find(b => b.props['data-kg-paper-mode'] === 'answer')
  expect(!!ansBtn, 'answer 模式切换按钮缺失').toBe(true)
  const ansBg = (ansBtn.props.style && ansBtn.props.style.background) || ''
  expect(String(ansBg).includes('gradient'), 'answer 模式按钮未呈激活态（paperMode 未切到 answer）').toBe(true)
  // 倒计时 + 交卷（旧 exam 视图核心行为，C30 教训：守卫必须验行为非形态）
  const startBtn = tr.root.findAllByType('button').find(b => b.props['data-kg-answer-start'] === '1')
  expect(!!startBtn, '开始作答按钮缺失').toBe(true)
  await act(async () => { startBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  const tExam = JSON.stringify(tr.toJSON())
  expect(tExam.includes('⏱') && tExam.includes('交卷'), '模考考试中视图（倒计时/交卷）未渲染').toBe(true)
  // 交卷 → 看报告（行为等价闭环）
  const submitBtn = tr.root.findAllByType('button').find(b => b.props['data-kg-answer-submit'] === '1')
  expect(!!submitBtn, '交卷按钮缺失').toBe(true)
  await act(async () => { submitBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  expect(JSON.stringify(tr.toJSON()).includes('答题报告'), '交卷后报告未渲染').toBe(true)
})
