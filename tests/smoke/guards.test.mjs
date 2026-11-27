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

test('SEC-CORS-01 独立端口不得用通配 CORS（市场评审指出的真实缺陷）', () => {
  /**
   * 上游 awesome-dsh-plugin 条目曾被维护者追加一句：
   * "Its HTTP routes have no DSH access check, so a web page open in your browser could call them."
   * 根因 = 独立端口无条件 `Access-Control-Allow-Origin: *` →
   * 用户浏览的**任意网页**都能 fetch 本机 8400 端口读库数据 / 写进度。
   * 本守卫锁死：① 禁通配 ACAO；② 必须有 Origin 白名单（回环）；③ 变更类请求必须校验来源。
   */
  const http = readSrc('./src/server/http.ts')
  expect(/Access-Control-Allow-Origin',\s*'\*'/.test(http), '独立端口仍在用通配 CORS（任何网页都能读本地 API）').toBe(false)
  expect(http.includes('originOk'), '缺 Origin 白名单判定').toBe(true)
  expect(/127\\\.0\\\.0\\\.1/.test(http), 'Origin 白名单未覆盖回环地址').toBe(true)
  // 写请求必须被拦（CORS 管不住写副作用）
  expect(/拒绝跨站写请求|403/.test(http), '变更类请求缺跨站拦截').toBe(true)
})

test('SEC-BRANCH-01 钩子的分支类型必须覆盖 CONTRIBUTING 的分支模型（同源）', () => {
  /**
   * cycle-68 事故：CONTRIBUTING §一 的 gitflow 写了 `release/*` 与 `hotfix/*`，
   * 但 pre-push 钩子的类型表漏了这两个 → **按规范建的分支被钩子拒推**，
   * 逼人用 SKIP_PREPUSH_CHECK=1 逃生门绕过检查（守卫形同失效）。
   * 本守卫锁死：规范里出现的分支类型，钩子必须都认。
   */
  const hook = readSrc('./scripts/git-hooks/pre-push.mjs')
  // 稳健提取：从 `const BRANCH_RE = ` 到该行末尾的 `/`（源文件里正则含转义斜杠，故按行切）
  const line = hook.split(/\r?\n/).find(l => l.includes('const BRANCH_RE ='))
  expect(!!line, '未找到 BRANCH_RE 定义').toBe(true)
  const body = line.slice(line.indexOf('= /') + 3, line.lastIndexOf('/')).replace(/\\\\\//g, '/')
  const re = new RegExp(body)
  // 规范里明确存在的四种分支形态都必须能通过
  for (const b of ['feat/pool-x', 'fix/ui-y', 'docs/marketplace-entry', 'release/v1.34.4', 'hotfix/v1.34.5']) {
    expect(re.test(b), '分支名 ' + b + ' 被钩子拒（与 CONTRIBUTING 不同源）').toBe(true)
  }
  // 反向：非法名仍必须被拒（不能为了放行而放成通天规则）
  for (const b of ['badname', 'release/', 'feat/']) {
    expect(re.test(b), '非法分支名 ' + b + ' 竟通过').toBe(false)
  }
  // 长驻分支走白名单
  expect(hook.includes("['main', 'develop', 'master', 'dev-history']"), '长驻分支白名单缺失').toBe(true)
})

test('SEC-DIST-01 发布前必须清空 dist（防止源已删的孤儿产物混入发布的包）', () => {
  /**
   * cycle-68 事故：删掉 src/server/topicTree.ts 后，tsc 只覆盖同名产物、不删旧文件，
   * 于是 dist/server/topicTree.js 作为**孤儿**留在 dist 里，并随 v1.34.4 的 npm 包发出
   * （实测 tarball 里有它）。包里带一个源码里已不存在的模块，属于长期潜伏的脏数据。
   * 守则：产出脚本的前置必须清空 dist。
   */
  const pkg = JSON.parse(readSrc('./package.json'))
  expect(!!pkg.scripts['clean:dist'], '缺 clean:dist 脚本').toBe(true)
  // 决定**包内容**的是 prepack（npm publish 前跑）——它必须清空；
  // prepare 也在 `npm install` 时跑，清空会拖慢安装，故不强制（包内容不由它决定）。
  expect(String(pkg.scripts.prepack || '').includes('clean-dist'), 'prepack 未清空 dist（孤儿产物会进包）').toBe(true)
  const clean = readSrc('./scripts/clean-dist.mjs')
  // 安全闸：只允许删 <仓库根>/dist
  expect(clean.includes("resolve(repoRoot, '..', 'dist')"), 'clean-dist 缺目标路径安全闸').toBe(true)
})

test('C70-CONS-01 能力对账 consumer 不得使用未注册的 ui:obs 词表（杜绝假漂移）', () => {
  /**
   * 架构漂移治理（v1.35）：manifest.ts 曾把 /api/repos/jobs 的 consumer 写成 'ui:obs'，
   * 而全仓视图 id 是 'observability'（view-registry.ts:66 / client.tsx VIEW_ROUTES）。
   * 该端点因此在能力对账里恒被判「消费方不存在」——与 v1.8 遥测口径、cycle-18
   * 影子端点同族的「声明 vs 运行态」假阳性。守卫锁定真实词表，防复辟。
   *
   * 注意：ui:header / client:discovery 是 shell 层合法 consumer（不在 VIEW_META），
   * 故不做「所有 ui:* 必在视图表」的一刀切断言——只针对已退役的 ui:obs。
   */
  const mf = readSrc('./src/shared/manifest.ts')
  expect(/['"]ui:obs['"]/.test(mf), "manifest 仍有退役词表 'ui:obs'（应为 ui:observability）").toBe(false)
  expect(mf.includes("path: '/api/repos/jobs'") && /consumers:\s*\[[^\]]*['"]ui:observability['"]/.test(mf.slice(mf.indexOf("path: '/api/repos/jobs'"), mf.indexOf("path: '/api/repos/jobs'") + 200)), '/api/repos/jobs 未声明真实消费方 ui:observability').toBe(true)
})

test('C70-MIME-01 图片 MIME 白名单单一事实源（四端点不得各写一份）', () => {
  /**
   * 架构漂移治理（v1.35）：扩展名→MIME 映射曾在 http/paperApi/naokuApi/tuxing 四处
   * 逐字重复，新增类型只改一处会让同一张图在不同端点出现 200/415 分裂（假漂移）。
   * 守卫锁定：唯一映射在 shared/media.ts，四个端点一律 import imageMime。
   */
  const media = readSrc('./src/shared/media.ts')
  expect(media.includes('export const IMAGE_MIME') && media.includes('export function imageMime'), 'shared/media.ts 缺单一 MIME 事实源').toBe(true)
  const consumers = [
    './src/server/http.ts',
    './src/server/paperApi.ts',
    './src/server/naokuApi.ts',
    './src/adapters/tuxing.ts',
  ]
  for (const p of consumers) {
    const src = readSrc(p)
    expect(src.includes('imageMime'), p + ' 未走 shared/media 的 imageMime').toBe(true)
    // 不得再留本地 MIME 字面量表（'.png': 'image/png' 形态）
    expect(/['"]\.png['"]\s*:\s*['"]image\/png['"]/.test(src), p + ' 仍有本地 MIME 字面量（漂移源）').toBe(false)
  }
})
