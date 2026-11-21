/**
 * tests/smoke/packaging.test.mjs — 打包/发布卫生域（cycle-47 阶段 3 迁移）
 *
 * 从 smoke.test.mjs 迁移的段：
 *   · R9/R11 静态守卫（组件直调/combo 格式/错误边界/兼容声明，L2122-2149）
 *   · R28 打包卫生族（dsh.bundle.patch 白名单 + overlay 反守卫 + npm pack 实测，L2155-2182）
 *   · R11-GUARD 族（config.yml 裸 tsc / bundler 接线 / assert-combo / files 白名单）
 *
 * 特征：零 server 依赖（npm pack dry-run 是子进程调用，非 HTTP）。
 * 断言判定逐字等价；readClientBundle 自愈语义保留。
 *
 * 运行：npx vitest run tests/smoke/packaging.test.mjs
 */
import { test, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync, execFileSync } from 'node:child_process'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const CLIENT_BUNDLE = new URL('../../dist/client/client.js', import.meta.url)

/** readClientBundle 自愈语义（继承 smoke：检出裸 ESM 产物 → 现场重跑 bundler → 重读） */
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
const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

let packNames = null   // npm pack dry-run 清单（beforeAll 拉一次，多断言复用）

beforeAll(() => {
  try {
    const dry = String(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: REPO, encoding: 'utf8' }))
    packNames = (JSON.parse(dry.slice(dry.indexOf('[')))[0].files || []).map(f => f.path)
  } catch (e) { packNames = null }
}, 120_000)

test('R9 静态守卫：client 无组件函数直调（条件 hook 崩溃防线）', () => {
  const client = readClientBundle('vitest-R9')
  const directCalls = [...client.matchAll(/(?:^|[^.\w$])(Native\w+|KaogongMainPanel|KaogongTabBody|KaogongMainBounded|KaogongTabBounded)\(\s*[A-Za-z${]/gm)]
    .filter(m => !/function|=>/.test(client.slice(Math.max(0, m.index - 40), m.index)))
  expect(directCalls.map(m => m[1]), '直调组件').toEqual([])
})

test('R9/cycle-24 子视图经组件挂载（注册表形态 + 错误边界）', () => {
  const client = readClientBundle('vitest-R9b')
  expect(/h\(route\.comp, \{ key: route\.key\(tick\)/.test(client)).toBe(true)
  expect(/dashboard: \{ comp: NativeDashboardView/.test(client) && /repos: \{ comp: NativeReposView/.test(client)).toBe(true)
  expect(/(?:h|React\.createElement)\(NativePracticeView/.test(client)).toBe(true)
  expect(/class KaogongErrorBoundary extends React\.Component/.test(client)).toBe(true)
})

test('R11 combo 格式守卫：__ModuleLoader__.load + factory 返回 {inject, apply}', () => {
  const client = readClientBundle('vitest-R11')
  expect(/window\.__ModuleLoader__\.load\(\{/.test(client) && !/^export /m.test(client)).toBe(true)
  expect(/return \{\s*inject: \[[^\]]*\],\s*apply\(ctx\)/.test(client)).toBe(true)
})

test('兼容性声明：peerDependencies dsh 范围 + engines.dsh（guardian 取证）', () => {
  expect(!!pkg.peerDependencies?.['@deepseek-ai/dsh']).toBe(true)
  expect(!!pkg.engines?.dsh).toBe(true)
})

test('R28 dsh.bundle.patch 已声明且白名单覆盖（npm 安装可用）', () => {
  const filesList = Array.isArray(pkg.files) ? pkg.files : []
  const norm = (s) => String(s).replace(/^\.\//, '')
  const patchRel = norm(pkg.dsh?.bundle?.patch || '')
  expect(!!patchRel).toBe(true)
  expect(filesList.length === 0 || filesList.some(f => norm(f) === patchRel || patchRel.startsWith(norm(f) + '/'))).toBe(true)
})

test('R28 本地调试 overlay 不得入包（含绝对路径会污染他人环境）', () => {
  const filesList = Array.isArray(pkg.files) ? pkg.files : []
  expect(filesList.some(f => /cordis\.local\.yml$/.test(String(f)))).toBe(false)
})

test('R28 随包模板 data/study-plan.md 在白名单内', () => {
  const filesList = Array.isArray(pkg.files) ? pkg.files : []
  expect(filesList.some(f => String(f).replace(/^\.\//, '') === 'data/study-plan.md')).toBe(true)
})

test('R28 npm pack 实测：含 patch + 不含语料/overlay（声明→实体零断链）', () => {
  // packNames null = npm 不可用等环境性失败（继承旧文件的诚实失败语义——不静默跳过）
  expect(packNames, 'npm pack --dry-run --json 可执行').not.toBeNull()
  const norm = (s) => String(s).replace(/^\.\//, '')
  const patchRel = norm(pkg.dsh?.bundle?.patch || '')
  expect(packNames.includes(patchRel), `含 patch（共 ${packNames.length} 文件）`).toBe(true)
  expect(packNames.some(n => /huasheng13\/.*\.md$/.test(n)) || packNames.some(n => /cordis\.local\.yml$/.test(n))).toBe(false)
})

test('R11-GUARD-01 config.yml 无裸 tsc 产物命令（门禁走 npm run build 全链）', () => {
  const cfg = fs.readFileSync(new URL('../../.cycles/config.yml', import.meta.url), 'utf-8')
  const rawTsc = cfg.split('\n').filter(l => /^\s*[a-zA-Z_]+:\s*\[?["']?npx tsc(?! --noEmit)/.test(l))
  expect(rawTsc, '裸 tsc 命令').toEqual([])
})

test('R11-GUARD-02 全部产物产出脚本接 bundler + assert-combo 守卫', () => {
  const pkgSrc = JSON.stringify(pkg.scripts)
  // 所有产 dist 的 scripts（test/test:render/test:all/prepack/prepare/build）都必须串 bundler
  const emitScripts = ['build', 'test', 'test:render', 'test:all', 'prepack', 'prepare']
  const badEmit = emitScripts.filter(k => pkg.scripts[k] && (!pkg.scripts[k].includes('bundle-client.mjs') || !pkg.scripts[k].includes('assert-combo')))
  expect(badEmit, '未接 bundler 的产物脚本').toEqual([])
  void pkgSrc
})

test('R11-GUARD-03 assert-combo.mjs 守卫存在且含响亮失败判据', () => {
  const guard = readSrc('scripts/assert-combo.mjs')
  expect(guard.includes('import') && /process\.exit/.test(guard)).toBe(true)
  expect(guard.includes('combo') || guard.includes('assert')).toBe(true)
})

test('R11-GUARD-03b prepare/prepack 引用的 scripts/*.mjs 全部在 files 白名单内（R28 声明→实体）', () => {
  const filesList = Array.isArray(pkg.files) ? pkg.files : []
  const referenced = ['scripts/assert-combo.mjs', 'scripts/bundle-client.mjs']
  const missing = referenced.filter(f => !filesList.some(x => String(x).replace(/^\.\//, '') === f))
  expect(missing, '白名单缺失脚本').toEqual([])
})

test('R11-GUARD-04 当前 dist/client/client.js 为 combo factory 形态', () => {
  const client = readClientBundle('vitest-R11-GUARD-04')
  expect(/^import[ \t]/m.test(client)).toBe(false)
  expect(/window\.__ModuleLoader__\.load\(\{/.test(client)).toBe(true)
})
