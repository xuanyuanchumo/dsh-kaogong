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

test('SMOKE-N-01 导航精简：一级入口口径（observability 统一后）', () => {
  const cl = readSrc('./src/client/client.tsx')
  const nav = (cl.match(/const NAV_GROUPS[\s\S]*?\n {6}\]/) || [''])[0]
  expect(nav.length).toBeGreaterThan(0)
  expect(nav.includes("'dashboard'") && nav.includes("'exam'") && nav.includes("'papers'") && nav.includes("'topics'")).toBe(true)
  expect(nav.includes("'wrongbook'") && nav.includes("'graph'") && nav.includes("'observability'")).toBe(true)
})

test('SMOKE-N-01 导航精简：四练习视图退出一级导航（文案级防回归）', () => {
  const cl = readSrc('./src/client/client.tsx')
  const nav = (cl.match(/const NAV_GROUPS[\s\S]*?\n {6}\]/) || [''])[0]
  expect(nav.length).toBeGreaterThan(0)
  expect(/['"](?:practice|deepbank|tuxing|essay)['"]/.test(nav)).toBe(false)
  expect(nav.includes('刷题') || nav.includes('深度题库') || nav.includes('图形推理') || nav.includes('申论')).toBe(false)
})

test('SMOKE-N-01 四视图路由仍可达（VIEW_ROUTES 键位登记）', () => {
  const cl = readSrc('./src/client/client.tsx')
  expect(/practice: \{ comp: NativePracticeView/.test(cl)).toBe(true)
  expect(/deepbank: \{ comp: NativeDeepBankView/.test(cl)).toBe(true)
  expect(/tuxing: \{ comp: NativeTuxingView/.test(cl)).toBe(true)
  expect(/essay: \{ comp: NativeEssayView/.test(cl)).toBe(true)
})

test('SMOKE-N-46 幽灵视图补齐：plan/search/method 路由 + 导航可达', () => {
  const cl = readSrc('./src/client/client.tsx')
  const nav = (cl.match(/const NAV_GROUPS[\s\S]*?\n {6}\]/) || [''])[0]
  expect(/plan: \{ comp: NativePlanView/.test(cl)).toBe(true)
  expect(/search: \{ comp: NativeSearchView/.test(cl)).toBe(true)
  expect(/method: \{ comp: NativeMethodView/.test(cl)).toBe(true)
  expect(nav.includes("'plan'") && nav.includes("'search'") && nav.includes("'method'")).toBe(true)
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
