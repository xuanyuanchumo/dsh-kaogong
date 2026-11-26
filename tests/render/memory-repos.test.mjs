/**
 * tests/render/memory-repos.test.mjs — 渲染旅程·记忆/题库管理/数据安全域（cycle-47 阶段 19 迁移·批二）
 *
 * 从 render.test.mjs 迁移（L1160-1360）：
 * C15-04..06（记忆三视图横幅 + 一键跳回原题）+ C22-IMG（深度题库解析 kgimg 出图）+
 * C23-MAT（材料块徽章+标题+材料图）+ C16-01（题库管理面板关于本项目/分级卡片/安装请求）+
 * C21-01（批量一键/作业历史/旧根提示/健康徽章/可用空间）+ C22-03（数据安全白盒卡）+
 * C22-02（纸质补录四步旅程）+ C22-01（占位渲染链路）。
 * fresh mount 独立步进；判定逐字等价。
 *
 * 运行：npx vitest run tests/render/memory-repos.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import { mountPanel, act, React, TestRenderer } from '../_harness/render.mjs'

let mp = null
let tr = null

function collectImgs(node, out) {
  if (!node) return
  if (node.type === 'img' && node.props) out.push(node)
  if (node.children && Array.isArray(node.children)) for (const c of node.children) collectImgs(c, out)
}

beforeAll(async () => {
  mp = await mountPanel()
  tr = mp.tr
}, 60_000)

afterAll(() => {
  if (tr) { try { tr.unmount() } catch { /* 已卸载 */ } }
})

test('C15-04: 刷题记忆横幅 → 一键跳回上次的模块与原题', async () => {
  await mp.enterHubTab('practice')
  const backBtn = tr.root.findAllByType('button').find(b => String(b.props.children) === '← 模块')
  if (backBtn) { await act(async () => { backBtn.props.onClick() }); await act(async () => { await new Promise(r => setTimeout(r, 40)) }) }
  let t = JSON.stringify(tr.toJSON())
  expect(t.includes('上次练到「判断推理」'), 'C15 刷题记忆横幅缺失').toBe(true)
  const resumeBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('继续上次'))
  expect(!!resumeBtn, 'C15 继续上次按钮缺失').toBe(true)
  await act(async () => { resumeBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  t = JSON.stringify(tr.toJSON())
  expect(t.includes('上次的题干（记忆恢复）'), 'C15 记忆跳回未恢复原题').toBe(true)
})

test('C15-05: 图形推理记忆横幅（规律类型 · 题号）渲染', async () => {
  await mp.enterHubTab('tuxing')
  const t = JSON.stringify(tr.toJSON())
  expect(t.includes('上次练到「数量规律」 · 第 2 题'), 'C15 图形推理记忆横幅缺失').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})

test('C15-06 + C22-IMG + C23-MAT: 刷题记忆跳回 + 解析出图 + 材料块', async () => {
  /**
   * cycle-63：深度题库分区已删除（数据层与语义并入统一池）。
   * 原此测试走 `enterHubTab('deepbank')`；现改走 `practice` 分区——
   * 深度题库的抽题/材料/图片能力全部由池端点承载，mock 已按
   * `/api/pool/questions?source=naoku` 提供同形数据，故断言语义不变。
   */
  await mp.enterHubTab('practice')
  let t = JSON.stringify(tr.toJSON())
  expect(t.includes('上次练到'), 'C15 刷题记忆横幅缺失').toBe(true)
  const resumeBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('继续上次'))
  expect(!!resumeBtn, 'C15 继续按钮缺失').toBe(true)
  await act(async () => { resumeBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  t = JSON.stringify(tr.toJSON())
  expect(t.includes('上次的题干') || t.includes('记忆恢复'), 'C15 记忆跳回未恢复原题').toBe(true)
  // C22-IMG：练习态是「选项 → 提交并看思路 → 就地显示判分+解析」。
  // ⚠️ cycle-63：深度题库分区删除后，本测试改走 practice。**图片链路**的专项守卫在
  //   · tests/smoke/img.test.mjs（/api/kg-img 可达 + 扩展名回退）
  //   · tests/render/paper-single-question.test.mjs（真题卷解析出图）
  // 此处只断言「练习态提交后解析区确实渲染」（该链路的渲染契约），不再重复验图片。
  const optBtns = tr.root.findAll(n => typeof (n.props || {}).onClick === 'function')
    .filter(n => /^[ABCD]$/.test(String(n.props?.children || '').trim()))
  if (optBtns.length) {
    await act(async () => { optBtns[0].props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
  }
  const submitBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('提交'))
  if (submitBtn) {
    await act(async () => { submitBtn.props.onClick() })
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
  }
  const tAfter = JSON.stringify(tr.toJSON())
  expect(/解析|思路|答案/.test(tAfter), 'C22-IMG 练习态提交后未渲染解析区').toBe(true)
  // C23-MAT：回模块选择 → 切「资料分析」→ 材料块渲染（groupMaterial + 材料图占位）
  const backBtn23 = tr.root.findAllByType('button').find(b => /模块/.test(String(b.props.children)))
  if (backBtn23) { await act(async () => { backBtn23.props.onClick() }); await act(async () => { await new Promise(r => setTimeout(r, 100)) }) }
  // 模块卡片是带 onClick 的 div（不是 button），按扁平文本定位
  const flat23 = (node, d) => {
    if (d > 8 || !node) return ''
    let s = ''
    if (node.children) for (const ch of node.children) { if (typeof ch === 'string') s += ch; else if (ch && typeof ch === 'object') s += flat23(ch, d + 1) }
    return s
  }
  const zlTarget = tr.root.findAll(n => n.type === 'div' && typeof n.props.onClick === 'function' && flat23(n, 0).includes('资料分析'))[0]
    || tr.root.findAllByType('button').find(b => String(b.props.children) === '资料分析')
  expect(!!zlTarget, 'C23-MAT 「资料分析」模块入口缺失').toBe(true)
  await act(async () => { zlTarget.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 150)) })
  const json23 = tr.toJSON()
  const s23 = JSON.stringify(json23)
  expect(s23.includes('📄 材料'), 'C23-MAT 材料块徽章缺失').toBe(true)
  // 材料正文（groupMaterial）——practice 走 QwPaperMode 四区，正文在该区渲染。
  // ⚠️ 材料含 kgimg:// 占位 → RichText 会把文本切成「文本段 + <img> 段」，
  // 故正文断言用较短的可识别片段（不跨图片切点）。
  expect(s23.includes('2018-2023 年铁路旅客运输量'),
    'C23-MAT 材料正文未渲染（groupMaterial 字段缺失或未消费）').toBe(true)
  const imgs23 = []
  collectImgs(json23, imgs23)
  // 材料图占位 kgimg:// → /api/kg-img?p=<encodeURIComponent(rel)>；
  // 断言用「出图链路」判据（src 走 /api/kg-img），rel 段落编码后仍含 mock-material
  const srcs23 = imgs23.map(i => decodeURIComponent(String(i.props.src || ''))).join('|')
  expect(srcs23.includes('mock-material') || srcs23.includes('/api/kg-img?p='),
    'C23-MAT 材料图占位未渲染出 <img>（src=' + srcs23.slice(0, 120) + '）').toBe(true)
})

test('C16-01: 题库管理面板（关于本项目 + 分级卡片 + 批量/单仓库安装真实发请求 + 零降级）', async () => {
  const rpBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('题库管理'))
  if (!rpBtn) throw new Error('C16 未找到题库管理导航按钮')
  await act(async () => { rpBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  const t = JSON.stringify(tr.toJSON())
  for (const k of ['关于本项目', 'GitHub 仓库', 'Release', '反馈 Issue', 'npm', '上游致谢', 'v1.11.0']) {
    expect(t.includes(k), 'C16 题库面板缺「' + k + '」').toBe(true)
  }
  expect(t.includes('https://github.com/xuanyuanchumo/dsh-kaogong')).toBe(true)
  for (const k of ['必选 · ', '推荐 · ', '可选 · ', '已安装', '未安装', '一键安装必选包', '数据根与镜像代理']) {
    expect(t.includes(k), 'C16 题库面板区块缺失: ' + k).toBe(true)
  }
  expect(t.includes('https://github.com/ERRRC/xingcezhenti'), 'C16 上游仓库跳转缺失').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
  // 批量安装按钮真实发请求
  const before = globalThis.__kgFetchLog.length
  const allBtns = tr.root.findAllByType('button')
  const batchBtn = allBtns.find(b => String(b.props.children).includes('一键安装全部必选'))
  expect(!!batchBtn, 'C21 一键批量安装按钮缺失').toBe(true)
  await act(async () => { batchBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  const afterBatch = globalThis.__kgFetchLog.slice(before).join(' ')
  expect(afterBatch.includes('/api/repos/install-batch'), 'C21 批量按钮未触发请求').toBe(true)
  const installBtn = allBtns.find(b => String(b.props.children).includes('⬇ 安装'))
  expect(!!installBtn, 'C16 单仓库安装按钮缺失').toBe(true)
  const before2 = globalThis.__kgFetchLog.length
  await act(async () => { installBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  const after = globalThis.__kgFetchLog.slice(before2).join(' ')
  expect(after.includes('/api/repos/install'), 'C16 安装按钮未触发请求').toBe(true)
  expect(tr.root.findAll(n => n.props && n.props.role === 'alert').length).toBe(0)
})

test('C21-01: 题库面板新流程区块（批量一键 · 作业历史 · 旧根提示 · 健康徽章 · 可用空间）零降级', async () => {
  const t0 = JSON.stringify(tr.toJSON())
  for (const k of ['一键安装全部必选', '最近作业', '可用空间', '健康仓库']) {
    expect(t0.includes(k), 'C21 题库面板新区块缺失: ' + k).toBe(true)
  }
  expect(t0.includes('仍有 3 个仓库'), 'C21 旧数据根提示缺失').toBe(true)
  const backBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('切回旧根'))
  expect(!!backBtn, 'C21 切回旧根按钮缺失').toBe(true)
  expect(t0.includes('缺 .git'), 'C21 健康巡检徽章缺失').toBe(true)
  const jobsToggle = tr.root.findAllByType('button').find(b => String(b.props.children).includes('展开历史'))
  expect(!!jobsToggle, 'C21 作业历史展开开关缺失').toBe(true)
  await act(async () => { jobsToggle.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })
  const t2 = JSON.stringify(tr.toJSON())
  expect(t2.includes('网络中断'), 'C21 作业历史失败原因未显示').toBe(true)
})

test('C22-03: 数据位置白盒卡（用户数据根/来源/迁移状态/包内残留）渲染零降级', async () => {
  const rpBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('题库管理'))
  await act(async () => { rpBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  const t = JSON.stringify(tr.toJSON())
  for (const k of ['数据安全', '用户数据根', '迁移: migrated', '包内无用户数据 ✓']) {
    expect(t.includes(k), 'C22-03 数据位置白盒卡缺「' + k + '」').toBe(true)
  }
})

test('C22-02: 纸质补录四步旅程（搜索→核对→标记→保存+撤销入口）交互零降级', async () => {
  /**
   * cycle-63：深度题库分区删除后，纸质补录卡的位置在**错题本工作台**内
   * （cycle-33 把错题本重写成复习工作台时就把补录卡嵌进去了），需点「📥 纸质刷题补录」展开。
   * 断言语义不变（四步旅程本身的交互契约）。
   */
  const wbBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('错题本'))
  expect(!!wbBtn, 'C22-02 未找到「错题本」导航').toBe(true)
  await act(async () => { wbBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  // 展开补录卡（工作台操作条上的折叠开关）
  const toggle = tr.root.findAllByType('button').find(b => String(b.props.children).includes('纸质刷题补录'))
  expect(!!toggle, 'C22-02 补录卡展开开关缺失').toBe(true)
  await act(async () => { toggle.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 120)) })
  let t = JSON.stringify(tr.toJSON())
  expect(t.includes('纸质刷题补录'), 'C22-02 补录分区缺失').toBe(true)
  const input = tr.root.findAllByType('input').find(i => String(i.props.placeholder || '').includes('题干关键词'))
  expect(!!input, 'C22-02 补录搜索框缺失').toBe(true)
  await act(async () => { input.props.onChange({ target: { value: '林产品' } }) })
  const sBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('搜索候选'))
  await act(async () => { sBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  t = JSON.stringify(tr.toJSON())
  expect(t.includes('能够正确描述2017年A市间接经济价值占比的统计图是'), 'C22-02 候选卡未渲染').toBe(true)
  expect(t.includes('深度题库'), 'C22-02 候选来源徽章缺失').toBe(true)
  const wrongBtn = tr.root.findAllByType('button').find(b => String(b.props.children) === '✗ 已做错')
  await act(async () => { wrongBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  t = JSON.stringify(tr.toJSON())
  expect(t.includes('待补录 1 题'), 'C22-02 待补录条缺失').toBe(true)
  const saveBtn = tr.root.findAllByType('button').find(b => String(b.props.children).includes('保存补录'))
  await act(async () => { saveBtn.props.onClick() })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) })
  t = JSON.stringify(tr.toJSON())
  expect(t.includes('已补录 1 题'), 'C22-02 保存反馈缺失').toBe(true)
  expect(t.includes('错题已进错题本'), 'C22-02 统计隔离提示缺失').toBe(true)
  expect(t.includes('↩ 撤销此批'), 'C22-02 批次撤销入口缺失').toBe(true)
})
