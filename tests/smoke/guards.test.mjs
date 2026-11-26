/**
 * tests/smoke/guards.test.mjs — 前端静态守卫域（cycle-47 阶段 2 迁移）
 *
 * 从 smoke.test.mjs 迁移的段：
 *   · v1.8.0 前端静态守卫（图谱 Canvas/FR 力模型/预收敛 + 可观测面板形态，L1083-1099）
 *   · cycle-13 省份维度与导航精简源码级守卫（SMOKE-P-01 / SMOKE-N-01/02 / N-46/46b，L1101-1148）
 *
 * 特征：零 server 依赖、纯源码/产物扫描——迁移耦合最低的面。
 * 断言判定逐字等价（readClientBundle 自愈语义保留）。
 *
 * 运行：npx vitest run tests/smoke/guards.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
// cycle-61 v9：导航从视图注册表派生（断言改走注册表，不再正则抓源码数组）
import { buildNavGroups } from '../../dist/client/view-registry.js'

/** readClientBundle 自愈语义（继承 smoke：检出裸 ESM 产物 → 现场重跑 bundler → 重读） */
const CLIENT_BUNDLE = new URL('../../dist/client/client.js', import.meta.url)
function readClientBundle(reason) {
  let txt = fs.readFileSync(CLIENT_BUNDLE, 'utf-8')
  if (/^import[ \t]/m.test(txt)) {
    try {
      const r = spawnSync(process.execPath, ['scripts/bundle-client.mjs'], { cwd: REPO })
      console.log(`ℹ️ combo 完整性自愈(${reason}): 已重跑 bundler (exit=${r.status})`)
      txt = fs.readFileSync(CLIENT_BUNDLE, 'utf-8')
    } catch (e) { console.log(`ℹ️ combo 自愈跳过(${reason}): ` + ((e && e.message) || e)) }
  }
  return txt
}

const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')

test('v1.8 图谱客户端形态：Canvas 2D + ResizeObserver + DPR', () => {
  const client = readClientBundle('vitest-guards')
  expect(client.includes("getContext('2d')") || client.includes('getContext("2d")')).toBe(true)
  expect(client.includes('ResizeObserver')).toBe(true)
  expect(client.includes('devicePixelRatio')).toBe(true)
})

test('v1.8 图谱客户端形态：标签去重叠 + FR 力模型 + 预收敛布局', () => {
  const client = readClientBundle('vitest-guards')
  expect(/labelBoxes/.test(client) && /clash/.test(client)).toBe(true)
  expect(/K \* K/.test(client) && /kij/.test(client)).toBe(true)
  expect(/function relax/.test(client)).toBe(true)
})

test('v1.8 图谱/可观测端点消费：path 分析 + 搜索定位 + lifecycle/workspaces', () => {
  const client = readClientBundle('vitest-guards')
  expect(client.includes('/graph/path')).toBe(true)
  expect(/focusNode/.test(client)).toBe(true)
  expect(client.includes('/lifecycle')).toBe(true)
  expect(client.includes('/workspaces')).toBe(true)
})

test('v1.8 可观测面板形态：sparkline + 诊断导出 + 学习质量保留', () => {
  const client = readClientBundle('vitest-guards')
  expect(/Sparkline/.test(client) && /polyline/.test(client)).toBe(true)
  expect(/Blob/.test(client) && /diagnostics-/.test(client)).toBe(true)
  expect(client.includes('申论均分率')).toBe(true)
})

test('SMOKE-P-01 索引v2：快照版本门 + province 维度 + facet 码点排序', () => {
  const pd = readSrc('./src/adapters/paperData.ts')
  expect(pd.includes('schemaVersion: 2') && pd.includes('snap.schemaVersion === 2')).toBe(true)
  expect(/province[,:]/.test(pd) && pd.includes("'全国'") && pd.includes("parts[0] === '省考'")).toBe(true)
  expect(pd.includes('byProvince') && /const provinces = /.test(pd) && !pd.includes('localeCompare(')).toBe(true)
})

test('SMOKE-P-01 真题卷视图：省份 chips + 方法论分区（只消费既有端点）', () => {
  const pv = readSrc('./src/client/views/papers-view.tsx')
  expect(pv.includes('省份') && pv.includes('list.provinces') && /filters\.province/.test(pv)).toBe(true)
  expect(pv.includes('方法论') && /TopicMethodView/.test(pv) && pv.includes('/api/methods') && pv.includes('/api/naoku/questions')).toBe(true)
})

test('SMOKE-N-01 导航精简：一级入口口径（v9 由 view-registry 派生）', () => {
  const cl = readSrc('./src/client/client.tsx')
  // v9：导航项不再手写在 client.tsx，而是 buildNavGroups() 从 VIEW_META 派生
  expect(cl.includes('const NAV_GROUPS = buildNavGroups()'), '导航未从注册表派生').toBe(true)
  const navIds = buildNavGroups().flatMap(g => g.items.map(i => i[0]))
  // 一级导航必须覆盖六个核心视图
  for (const id of ['dashboard', 'exam', 'papers', 'topics', 'wrongbook', 'graph', 'observability']) {
    expect(navIds, '一级导航缺 ' + id).toContain(id)
  }
})

test('SMOKE-N-01b exam 别名路由：exam 键保留 + papers 深链 answer（行为等价）', () => {
  const cl = readSrc('./src/client/client.tsx')
  const pv = readSrc('./src/client/views/papers-view.tsx')
  // 别名路由形态：exam 键仍登记（localStorage 旧键/导航入口兼容），但 comp 指向 papers 并传 initialMode:'answer'
  const examLine = cl.split('\n').find(l => l.trim().startsWith('exam:') && l.includes('comp:'))
  expect(!!examLine, 'exam 别名路由键缺失').toBe(true)
  expect(/comp: NativePapersView/.test(examLine), 'exam 未映射到 papers 组件').toBe(true)
  expect(examLine.includes("initialMode: 'answer'"), 'exam 未传 initialMode:answer 深链').toBe(true)
  expect(examLine.includes('initialPaperId: viewParams.paperId'), 'exam 未透传 paperId 深链').toBe(true)
  // papers 组件消费深链：props 形状 + 命中即开考 + 换卷重置保留
  expect(/initialMode\?: 'answer'/.test(pv) && /initialPaperId\?: string/.test(pv), '深链 props 形状缺失').toBe(true)
  expect(pv.includes("initialMode !== 'answer' || !initialPaperId || !list"), '深链未等 list 就绪/未做守门').toBe(true)
  expect(pv.includes('list.papers.some') && pv.includes('p.id === initialPaperId'), '深链未命中卷列表校验').toBe(true)
  expect(pv.includes("setPaperMode(ppDeepLinkArmed ? 'answer' : 'browse')"), '换卷重置语义未与深链协同').toBe(true)
  // 组件本体保留在 papers-view（别名兼容导出）——exam 路由已收敛为 papers 深链，
  // client 不再 import（避免 noUnusedLocals 报错）；bundler __kgM 仍登记该导出供外部引用。
  expect(/export function NativeExamView\(/.test(pv), 'NativeExamView 本体被删').toBe(true)
  expect(!cl.includes('void NativeExamView'), '模块级 void 引用回潮（会破坏 combo 桥接，render 全崩）').toBe(true)
  // 陈旧文案不写死数字（R25/㉘）
  expect(/guideDesc: '[^']*（多源离线题库）'/.test(cl) && !/15个开源仓库/.test(cl), 'guideDesc 陈旧数字残留').toBe(true)
})

test('SMOKE-N-01 导航精简：三练习视图退出一级导航（文案级防回归）', () => {
  // v9：改由注册表断言（导航从 VIEW_META 派生，源码里已无手写数组）
  // cycle-63：deepbank 已删除（数据层与语义并入统一池），剩三视图仍不得进一级导航
  const navIds = buildNavGroups().flatMap(g => g.items.map(i => i[0]))
  for (const id of ['practice', 'tuxing', 'essay']) {
    expect(navIds, id + ' 不应在一级导航（应经专题枢纽进入）').not.toContain(id)
  }
  const labels = buildNavGroups().flatMap(g => g.items.map(i => i[1])).join(' ')
  expect(/刷题|图形推理|申论/.test(labels)).toBe(false)
  // cycle-63 反向断言：deepbank 既不在导航、也不在路由登记（彻底退役）
  expect(navIds, 'deepbank 应已彻底退役').not.toContain('deepbank')
})

test('SMOKE-N-01 三视图路由仍可达（VIEW_ROUTES 键位登记）+ deepbank 已退役', () => {
  const cl = readSrc('./src/client/client.tsx')
  expect(/practice: \{ comp: NativePracticeView/.test(cl)).toBe(true)
  expect(/tuxing: \{ comp: NativeTuxingView/.test(cl)).toBe(true)
  expect(/essay: \{ comp: NativeEssayView/.test(cl)).toBe(true)
  // cycle-63（用户要求）：深度题库分区与视图已删除——路由表不得再有登记
  expect(/deepbank: \{ comp: NativeDeepBankView/.test(cl), 'deepbank 路由应已移除').toBe(false)
  expect(/NativeDeepBankView/.test(cl), 'client.tsx 不应再引用 NativeDeepBankView').toBe(false)
})

test('SMOKE-N-46 幽灵视图补齐：plan/search/method 路由 + 导航可达', () => {
  const cl = readSrc('./src/client/client.tsx')
  expect(/plan: \{ comp: NativePlanView/.test(cl)).toBe(true)
  expect(/search: \{ comp: NativeSearchView/.test(cl)).toBe(true)
  expect(/method: \{ comp: NativeMethodView/.test(cl)).toBe(true)
  const navIds = buildNavGroups().flatMap(g => g.items.map(i => i[0]))
  for (const id of ['plan', 'search', 'method']) expect(navIds, '导航缺 ' + id).toContain(id)
})

test('SMOKE-N-46b obs→observability 统一：路由键为 manifest 口径 + 旧键别名兜底', () => {
  const cl = readSrc('./src/client/client.tsx')
  expect(/observability: \{ comp: NativeObsView/.test(cl)).toBe(true)
  expect(/  obs: \{ comp:/.test(cl)).toBe(false)
  expect(/view === 'obs' \? 'observability'/.test(cl)).toBe(true)
})

test('SMOKE-N-02 对话窗口瘦身：QuickPractice 移除 + TabHome 精简体', () => {
  const cl = readSrc('./src/client/client.tsx')
  const sv = readSrc('./src/client/views/study-view.tsx')
  expect(sv.includes('KaogongQuickPractice')).toBe(false)
  expect(cl.includes('KaogongQuickPractice')).toBe(false)
  expect(cl.includes('KaogongTabHome')).toBe(true)
  expect(/h\(KaogongTabHome,/.test(cl)).toBe(true)
  expect(/h\(KaogongMainPanel, \{ wsKey, t, key: reloadKey/.test(cl)).toBe(false)
})
