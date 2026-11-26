/**
 * tests/smoke/connectivity.test.mjs — cycle-49 视图连通性守卫域
 *
 * 固化本轮「功能与业务打通」的三类修复：
 *   A. 确定性 bug：图谱 method 死链 / wrongbook srs 死参 / manifest 消费声明漂移
 *   B. 死胡同打通：统一 onGo 出口 + 仪表盘/统一库/方法页交叉跳转
 *   C. 检索连通：Knowledge Search 双语料源（落地 manifest ui:search 声明）
 *
 * 零 server 依赖、纯源码/产物静态扫描（同 guards.test.mjs 形态）。
 * 运行：npx vitest run tests/smoke/connectivity.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')
const readBundle = () => fs.readFileSync(new URL('../../dist/client/client.js', import.meta.url), 'utf8')

/* ── A. 确定性 bug 修复守卫 ── */

test('C49-A1: 图谱 method 节点跳 method 视图带 topic（不再把 topic 当 hs13 section 造成死链）', () => {
  const g = readSrc('src/client/views/graph-view.tsx')
  expect(g.includes("nType === 'method' && nKey"), 'method 节点分支缺失').toBe(true)
  expect(g.includes("v: 'method', p: { topic: nKey }"), 'method 节点必须跳 method 视图并带 topic').toBe(true)
  // 负向守卫：旧死链形态不得回归（topic 传给 huasheng13 的 section → 空白页）
  expect(g.includes("v: 'huasheng13', p: { section: nKey }"), '旧 method 死链回归').toBe(false)
})

test('C49-A2: wrongbook {srs:1} 深链被 practice 真实消费（死参根治）', () => {
  const client = readBundle()
  expect(client.includes('initialSrs: viewParams.srs === undefined ? undefined : !!viewParams.srs'), 'client 未传 initialSrs').toBe(true)
  const study = readSrc('src/client/views/study-view.tsx')
  expect(study.includes('initialSrs === undefined ? true : !!initialSrs'), 'practice 未以 initialSrs 覆盖默认 SRS').toBe(true)
})

test('C49-A3: manifest 消费声明对齐运行态（pool/questions 含 ui:practice）', () => {
  const m = readSrc('src/shared/manifest.ts')
  const line = m.split('\n').find(l => l.includes("path: '/api/pool/questions'"))
  expect(!!line, 'pool/questions 端点声明缺失').toBe(true)
  expect(line.includes('ui:practice'), 'practice 已消费 pool/questions，声明漏登记会误判孤儿端点').toBe(true)
})

/* ── B. 死胡同打通守卫 ── */

test('C59-B0: exam→papers answer 深链别名路由（17 路由含 exam，papers 具备双深链 props）', () => {
  const client = readSrc('src/client/client.tsx')
  const papers = readSrc('src/client/views/papers-view.tsx')
  // API 视图契约：exam 仍在统一 onGo 出口的 17 项路由内（别名路由形态）
  const routes = ['dashboard', 'wrongbook', 'graph', 'observability', 'papers', 'exam',
    'practice', 'deepbank', 'tuxing', 'repos', 'pool', 'huasheng13', 'topics', 'essay',
    'plan', 'search', 'method']
  const examLine = client.split('\n').find(l => l.trim().startsWith('exam:') && l.includes('comp:'))
  expect(routes).toContain('exam')
  expect(!!examLine && examLine.includes("initialMode: 'answer'"), 'exam 别名路由未指向 papers answer 深链').toBe(true)
  // papers 消费 dual 深链（mode + paperId），并保持别名兼容
  expect(papers.includes('initialMode?:') && papers.includes('initialPaperId?:'), 'papers 未声明深链 props').toBe(true)
  // exam 别名路由的 comp 必须是 NativePapersView；NativeExamView 本体保留在 papers-view（兼容导出），
  // client 不得有模块级 void 引用（会破坏 combo 桥接——cycle-60 render 全崩事故）。
  expect(!!examLine && examLine.includes('comp: NativePapersView'), 'exam 别名路由未用 papers 组件').toBe(true)
  expect(/export function NativeExamView\(/.test(papers) && !client.includes('void NativeExamView'), '兼容导出/桥接纪律被破坏').toBe(true)
})

test('C49-B1: 所有视图统一 onGo 出口（死胡同视图消灭）', () => {
  const client = readSrc('src/client/client.tsx')
  expect(client.includes('const go = (v: any, params?: any) => setView(v, params || {})'), '统一 go 出口缺失').toBe(true)
  const routes = ['dashboard', 'wrongbook', 'graph', 'observability', 'papers', 'exam',
    'practice', 'deepbank', 'tuxing', 'repos', 'pool', 'huasheng13', 'topics', 'essay',
    'plan', 'search', 'method']
  // 逐行校验每条路由都含 onGo: go（排除注释行）
  const routeLines = routes.map(id => client.split('\n').find(l => l.trim().startsWith(id + ':') && l.includes('comp:')))
  const missing = routes.filter((id, i) => !routeLines[i] || !routeLines[i].includes('onGo: go'))
  expect(missing, '以下视图仍无跨视图出口: ' + missing.join(',')).toEqual([])
})

test('C49-B2: 仪表盘薄弱模块/空态一键开练 + 计划日跳计划', () => {
  const s = readSrc('src/client/views/study-view.tsx')
  expect(s.includes("onGo && onGo('practice', { module: m })"), '薄弱模块「去练」出口缺失').toBe(true)
  expect(s.includes("onGo('plan')"), '计划进度日跳转缺失').toBe(true)
  expect(s.includes("onGo('practice')"), '空态「去刷题」按钮缺失').toBe(true)
})

test('C49-B3: 统一库数据链打通（未就绪→题库管理，单题→练知识点/模块）', () => {
  const p = readSrc('src/client/views/pool-view.tsx')
  expect(p.includes("onGo('repos')"), '库未就绪「去题库管理」出口缺失').toBe(true)
  expect(p.includes("onGo('deepbank', { kadian: d.kadian })"), '单题「练此知识点」出口缺失').toBe(true)
  expect(p.includes("onGo('practice', { module: d.module })"), '单题「练此模块」出口缺失').toBe(true)
  // deepbank 消费 initialKadian 深链
  const s = readSrc('src/client/views/study-view.tsx')
  expect(s.includes('initialKadian'), 'deepbank 未消费 kadian 深链').toBe(true)
})

test('C49-B4: 方法页与专题枢纽方法论主区连通（initialTab 深链）', () => {
  const plan = readSrc('src/client/views/plan-view.tsx')
  expect(plan.includes("onGo('topics', { tab: 'method' })"), '方法参考「去专题方法论主区」出口缺失').toBe(true)
  const topics = readSrc('src/client/views/papers-view.tsx')
  expect(topics.includes('initialTab'), '专题枢纽未支持 initialTab 深链').toBe(true)
  expect(topics.includes("t.id === initialTab"), 'initialTab 未参与分区种子校验').toBe(true)
})

/* ── C. 检索连通守卫 ── */

test('C49-C1: 知识检索双语料源落地（/api/search + /api/huasheng13/search）', () => {
  const plan = readSrc('src/client/views/plan-view.tsx')
  expect(plan.includes("type SearchSource = 'md' | 'hs13'"), '语料源类型缺失').toBe(true)
  expect(plan.includes("api('/huasheng13/search?q='"), '方法论语料检索未接通').toBe(true)
  expect(plan.includes("api('/search?q=' + encodeURIComponent(k))"), '三库全文检索分支缺失').toBe(true)
  const m = readSrc('src/shared/manifest.ts')
  const hsLine = m.split('\n').find(l => l.includes("path: '/api/huasheng13/search'"))
  expect(hsLine && hsLine.includes('ui:search'), 'manifest 仍声明 ui:search 但需与实现一致').toBe(true)
})

test('C58-01: 知识检索页接入统一池 FTS5（三源统一入口，manifest 消费声明同源）', () => {
  const plan = readSrc('src/client/views/plan-view.tsx')
  expect(plan.includes("type SearchSource = 'md' | 'hs13' | 'pool'"), 'pool 源未加入联合类型').toBe(true)
  expect(plan.includes("api('/pool/search?q='"), '统一池检索分支未接通').toBe(true)
  expect(plan.includes("['pool', '统一题库']"), 'pool 源切换按钮缺失').toBe(true)
  const m = readSrc('src/shared/manifest.ts')
  const poolLine = m.split('\n').find(l => l.includes("path: '/api/pool/search'"))
  expect(poolLine && poolLine.includes('ui:search'), 'manifest pool/search 未登记 ui:search 消费').toBe(true)
})

/* ── D. 闭环：改动未破坏既有形态守卫 ── */

test('C49-D1: combo 产物形态仍合法（无行首 import/export + load 头 + return）', () => {
  const b = readBundle()
  expect(/^import[ \t]/m.test(b)).toBe(false)
  expect(/^export[ \t]/m.test(b)).toBe(false)
  expect(b.includes('window.__ModuleLoader__.load({')).toBe(true)
  expect(b.includes('inject') && b.includes('apply')).toBe(true)
})

/* ── E. cycle-52 状态管理收敛 ── */

test('C52-01: localStorage 唯一门面 kgStorage（客户端零直读，除门面自身）', () => {
  const files = [
    'src/client/client.tsx', 'src/client/ui-kit.tsx',
    'src/client/views/graph-view.tsx', 'src/client/views/huasheng13-view.tsx',
    'src/client/views/huasheng13-md.tsx', 'src/client/views/obs-view.tsx',
    'src/client/views/papers-view.tsx', 'src/client/views/repos-view.tsx',
    'src/client/views/study-view.tsx', 'src/client/views/plan-view.tsx',
    'src/client/views/pool-view.tsx', 'src/client/question/question-kit.tsx',
    'src/client/question/question-lightbox.tsx',
  ]
  const direct = files.filter(f => {
    if (f.endsWith('ui-kit.tsx')) return false // 门面自身允许直读（唯一事实源）
    return /localStorage\.(getItem|setItem|removeItem)/.test(readSrc(f))
  })
  expect(direct, '以下文件仍直读 localStorage（应走 kgStorage）: ' + direct.join(',')).toEqual([])
  const kit = readSrc('src/client/ui-kit.tsx')
  expect(kit.includes('export const kgStorage'), 'kgStorage 门面缺失').toBe(true)
  // 门面内恰好 3 处 localStorage 调用（get/set/remove）——零外泄；且每处均带 catch 防御
  expect((kit.match(/localStorage\.(getItem|setItem|removeItem)/g) || []).length, '门面调用数').toBe(3)
  const facade = kit.slice(kit.indexOf('export const kgStorage'))
  expect((facade.match(/catch/g) || []).length >= 3, '门面未对三种操作做 try/catch 防御').toBe(true)
})

test('C52-02: 视图偏好初始化有隐私模式防御（原 client.tsx:95 无 try/catch 崩溃点已修）', () => {
  const client = readSrc('src/client/client.tsx')
  const papers = readSrc('src/client/views/papers-view.tsx')
  expect(client.includes("kgStorage.get('kg-native-view', 'dashboard')"), '视图偏好未走门面 get').toBe(true)
  expect(client.includes("kgStorage.set('kg-native-view', v)"), 'setView 未走门面 set').toBe(true)
  expect(papers.includes('kgStorage.get(essayDraftKey(q))'), '申论草稿读取未走门面').toBe(true)
  expect(papers.includes('kgStorage.remove(essayDraftKey(cur))'), '申论草稿清理未走门面').toBe(true)
})

/* ── F. cycle-52 续·三态组件复用（C44 守卫盲区：非 kg-load 类手写态）── */

test('C52-03: papers-view 手写加载/错误/空态收拢到 ui-kit 三态基建', () => {
  const p = readSrc('src/client/views/papers-view.tsx')
  // 已改用 KgLoad/KgErr/KgEmpty
  expect(p.includes('KgLoad label="加载卷库…"') && p.includes('KgLoad label="加载考点…"'), '加载态未走 KgLoad').toBe(true)
  expect(p.includes('KgErr msg={detail.error}'), '试卷错误态未走 KgErr').toBe(true)
  expect(p.includes('KgEmpty text="本题卷无题目"') && p.includes('KgEmpty text="题目索引异常"'), '空态/异常未走 KgEmpty').toBe(true)
  // 负向：不得残留「灰色小字手写加载/空态」形态（C44 旧守卫只禁 className kg-load，此为盲区补齐）
  const residual = /<div style=\{\{ fontSize: 12, color: 'var\(--text-muted\)' \}\}>\{'(加载|加载中|题目索引异常|题目加载异常|本题卷无题目)/.test(p)
  expect(residual, 'papers-view 仍有手写三态文本').toBe(false)
})

/* ── G. cycle-54 取数 hook 依赖正确性 ── */

test('C54-01: useApiMany 把 paths 内容键纳入 effect 依赖（消除 stale data / 无限重取两难）', () => {
  const hook = readSrc('src/client/hooks/useApiMany.ts')
  expect(hook.includes('const pathsKey = JSON.stringify'), 'paths 内容序列化缺失').toBe(true)
  expect(hook.includes('}, [...deps, pathsKey])'), 'pathsKey 未纳入 effect 依赖').toBe(true)
  // 负向：不得退回「仅 deps」的旧形态（stale data 根因）
  expect(/\}, deps\)\s*\n\s*return \{ data, loading, err \}/.test(hook), '旧 deps-only 依赖回归').toBe(false)
})
