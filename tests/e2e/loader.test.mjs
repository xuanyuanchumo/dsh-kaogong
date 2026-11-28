/**
 * loader.test.mjs — 真实 Cordis Loader 入口测试（BL-TEST-01 / BL-SEC-01）
 *
 * 依据：dsh 官方事故复盘 0001 —— 「手动 ctx.plugin() 挂载的测试无法验证插件的真实加载方式」。
 * 本项目 smoke/render 都直接 import dist 模块，从未验证 dist/host/index.js 经真实 Loader 的
 * 导出归一化（unwrapExports）→ entry 激活 → 服务注入 → 工具注册 → 服务可用 这一整条真实路径。
 *
 * ★ 三层隔离（BL-SEC-01，回答「沙箱/真机会不会污染目录」）：
 *   1. 数据根隔离：KG_DATA_DIR / KG_REPOS_DIR → 临时目录（不写 ~/.dsh/kaogong）
 *   2. DSH_HOME 隔离：临时目录（双保险，防止插件内部按 DSH_HOME 解析写回主力）
 *   3. 端口隔离：KG_PORT=184xx（避开主力 8400-8404 与 smoke 8495）
 *   4. 禁止 adopt：断言 /api/status 的 pid === 本进程 pid，杜绝「测的其实是主力实例」假阳性
 *   5. 完成后 dispose fiber + 删除临时目录
 *
 * 只 mock 外部服务（tools/webServer 的最小 Service Provider）——真实 Loader 与插件产物都是真的。
 * 零 npm 运行时依赖：cordis/loader 来自 devDependencies（仅开发期），不进 npm 包。
 *
 * 运行：node loader.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')                  // .../kaogong/dsh-kaogong（本插件根；cycle-47 迁入 tests/e2e/ 上跳两级）
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..')              // .../kaogong（当前会话工作区）
// _dshcli 与 dsh-kaogong 同在工作区根下：kaogong/_dshcli
const DSH_CLI_ROOT = path.join(WORKSPACE_ROOT, '_dshcli')

let results = 0, failed = 0
const ok = (name, cond, detail = '') => {
  results++
  if (!cond) failed++
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`)
}

// ── 隔离环境（必须在 import 插件产物之前设置）──────────────────────
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-loader-test-'))
const DATA_DIR = path.join(TEMP, 'data')
const REPOS_DIR = path.join(TEMP, 'repos')
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(REPOS_DIR, { recursive: true })
// ★ 防污染：预置迁移完成标记，让插件的 migratePkgData 跳过包内 data/→用户数据根的搬迁。
// 否则测试设临时 KG_DATA_DIR 会触发迁移，把随包模板 data/study-plan.md 从仓库工作树迁走
// （实测发生：git status 出现 D data/study-plan.md）。这是测试不该有的副作用。
fs.writeFileSync(path.join(DATA_DIR, '.migrated'), 'loader-test isolation\n')
process.env.KG_DATA_DIR = DATA_DIR
process.env.KG_REPOS_DIR = REPOS_DIR
process.env.DSH_HOME = TEMP
const PORT = 18400
process.env.KG_PORT = String(PORT)

// 加载 devDependencies 里的真实 Loader（解析路径：开发仓上级的 _dshcli）
const require = createRequire(path.join(DSH_CLI_ROOT, 'package.json'))
let Context, Service, Loader
try {
  ;({ Context, Service } = require('@deepseek-ai/cordis'))
  ;({ default: Loader } = require('@deepseek-ai/cordis-plugin-loader'))
} catch (e) {
  // 区分两种情况（reviewer-code 实测的假绿）：
  //   A. _dshcli/node_modules 不存在 → 合理跳过（keyless CI 环境）
  //   B. 目录存在但 require 失败 → 真实回归（依赖损坏/路径错），必须变红
  if (fs.existsSync(path.join(DSH_CLI_ROOT, 'node_modules', '@deepseek-ai', 'cordis'))) {
    console.error(`❌ Cordis Loader 依赖存在但加载失败（真实回归）：${e.message}`)
    process.exit(1)
  }
  console.error(`⚠️  跳过 Loader 测试：开发期 Cordis 包不存在（${e.message}）`)
  console.error('   本测试需要开发期 Cordis 包；CI keyless 环境若缺失属预期，本地应有 _dshcli/node_modules。')
  process.exit(0)
}

// 最小外部服务 Provider（只替代宿主服务，Loader 与插件产物是真实的）
class Tools extends Service {
  static name = 'tools'
  calls = []
  constructor(ctx) { super(ctx, 'tools', true) }
  register(def) { this.calls.push(def); return () => {} }
}
class WebServer extends Service {
  static name = 'webServer'
  constructor(ctx) { super(ctx, 'webServer', true) }
  register() { throw new Error('loader-test: webServer 是最小桩，插件应降级独立端口') }
}
// 阶段 4（issue #4）C5 前置：插件 inject 扩为 ['tools','llm']。
// 若 boot 图缺 llm，Loader 会让 entry 永不激活（R11b 事故）——本桩模拟宿主恒有的 llm 服务，
// 断言 entry 仍激活 + inject 含 llm，证明「声明 llm 不破坏激活」。
class Llm extends Service {
  static name = 'llm'
  calls = []
  constructor(ctx) { super(ctx, 'llm', true) }
  async stream() { throw new Error('loader-test: llm 是最小桩，本 PR 不调用模型') }
}

const root = new Context()
root.plugin(Tools)
root.plugin(WebServer)
root.plugin(Llm)
await root.plugin(Loader, {
  baseUrl: pathToFileURL(DSH_CLI_ROOT + path.sep).href,
})

let entryId = null
try {
  // ── 1. 真实 Loader 加载构建产物 ───────────────────────────────────
  const hostEntry = pathToFileURL(path.join(REPO_ROOT, 'dist', 'host', 'index.js')).href
  ok('dist/host/index.js 构建产物存在', fs.existsSync(path.join(REPO_ROOT, 'dist', 'host', 'index.js')))
  entryId = await root.loader.create({ id: 'kaogong', name: hostEntry, config: {} })
  await root.loader.await()

  const entry = root.loader.resolve(entryId)
  const ns = entry.moduleNamespace || {}

  // ── 2. 导出归一化（事故 0001 核心）───────────────────────────────
  ok('真实 Loader 激活 entry（fiber 有 uid）', !!entry.fiber?.uid, `state=${entry.fiber?.state}`)
  ok('模块导出是命名空间（apply/inject/name 具名导出）',
    typeof ns.apply === 'function' && Array.isArray(ns.inject) && typeof ns.name === 'string' && !!ns.name,
    `exports=${Object.keys(ns).join(',')}`)
  ok('无 export default（default export 会让 Loader 丢弃 inject，见事故 0001）',
    !('default' in ns), `'default' in moduleNamespace = ${'default' in ns}`)
  ok('inject 声明了 tools', ns.inject?.includes('tools'), `inject=${JSON.stringify(ns.inject)}`)
  // C5/R11b 守卫：声明 llm 后 entry 必须仍激活（上面已断言 fiber.uid 存在），
  // 否则说明 inject 声明了 boot 图不存在的服务 → 插件永不激活，必须回退。
  ok('inject 声明了 llm 且 entry 仍激活（R11b 不激活回归守卫）',
    ns.inject?.includes('llm') && !!entry.fiber?.uid,
    `inject=${JSON.stringify(ns.inject)} state=${entry.fiber?.state}`)

  // ── 3. unwrapExports 负向验证：证明测试真的会抓住 default export 事故 ──
  const fakeNs = { ...ns, default: ns.apply }
  const unwrapped = root.loader.unwrapExports(fakeNs)
  // 事故 0001 决定性特征：default export 让 unwrapExports 返回裸函数，inject 丢失。
  // 注意：函数在 JS 里天然有 `.name` 属性，不能拿它当判据；inject 才是 Loader 真正读取的字段。
  ok('负向验证：Loader.unwrapExports 注入 default 后确实丢弃 inject（事故 0001 形态）',
    typeof unwrapped === 'function' && !unwrapped.inject,
    '若此项失败，说明测试无法复现事故 0001，守卫无效')

  // ── 4. 工具注册（真实 apply 路径）───────────────────────────────
  const toolNames = (root.tools.calls || []).map(def => def.name)
  const EXPECTED_TOOLS = [
    'kaogong_launch', 'kaogong_ai_tutor', 'kaogong_ai_plan',
    'kaogong_ai_shenlun', 'kaogong_ai_essay_review', 'kaogong_ai_method',
  ]
  for (const t of EXPECTED_TOOLS) ok(`工具已注册：${t}`, toolNames.includes(t), `实际=${toolNames.join(',')}`)
  ok('6 个工具全部注册（与 CAPABILITIES.tools 一致）', toolNames.length === 6, `实际=${toolNames.length}`)

  // ── 5. 真实服务可用 + 三层隔离验证 ──────────────────────────────
  let status = null
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(300) })
      const j = await r.json()
      if (j.app === 'dsh-kaogong') { status = j; break }
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  ok('真实服务在隔离端口就绪（/api/status）', !!status, `port=${PORT}`)
  ok('服务 pid === 本进程（未 adopt 主力实例，无假阳性）',
    status?.pid === process.pid, `status.pid=${status?.pid} self.pid=${process.pid}`)
  ok('服务端口 === KG_PORT 隔离端口', status?.port === PORT, `status.port=${status?.port}`)

  ok('数据写在隔离目录，未污染主力数据根',
    fs.existsSync(path.join(DATA_DIR, 'runtime.json')) &&
    !fs.existsSync(path.join(os.homedir(), '.dsh', 'kaogong', 'loader-test-canary')),
    `隔离目录=${DATA_DIR}`)

  console.log(`\n═══ Loader 入口: ${results - failed}/${results} 通过 ═══`)
} finally {
  // ── 6. 清理（无论成功失败）───────────────────────────────────────
  try { if (entryId) root.loader.remove(entryId) } catch {}
  try { root.fiber.dispose() } catch {}
  // 插件 disposer 异步关闭 server / reset SQLite 句柄（cycle-35 教训），
  // 给一个短暂窗口再删临时目录，并重试一次（Windows 上句柄释放有延迟）。
  await new Promise(r => setTimeout(r, 300))
  for (let i = 0; i < 5 && fs.existsSync(TEMP); i++) {
    try { fs.rmSync(TEMP, { recursive: true, force: true }); break }
    catch { await new Promise(r => setTimeout(r, 200)) }
  }
  console.log(`[loader-test] 已清理临时目录与 Loader entry：${!fs.existsSync(TEMP) ? 'OK' : '部分残留（下次启动会由 OS 回收）'}`)
}

// cycle-47：迁入 tests/e2e/ 后保持 node 直跑形态（npm run test:loader）。
// vitest 聚合时（npm run test:all 走 npx vitest run tests/）跳过本文件——
// 真实 Loader 测试自带子进程/临时目录/exit 语义，与 vitest 进程模型冲突（process.exit 拦截），
// 其独立性由 test:loader 专项承担（DSH 测试策略：集成/e2e 车道分离于单元车道）。
if (process.env.VITEST_POOL_ID || process.env.VITEST) {
  console.log('[loader-test] vitest 聚合车道跳过（专项：npm run test:loader）')
} else {
  process.exit(failed ? 1 : 0)
}
