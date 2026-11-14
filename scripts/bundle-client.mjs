#!/usr/bin/env node
/**
 * scripts/bundle-client.mjs — 零依赖构建期 bundler（cycle-13 T-025 / AD-13.1）
 *
 * 背景：T-025 把 src/client/client.ts（原 3362 行、复杂度 677）拆成 8 个真 ESM 模块，
 * tsc 按 module:ESNext 产出多文件 dist/client/*.js；但宿主 Web 组合加载器只认
 * **单文件 combo factory**（window.__ModuleLoader__.load({ id, factory(require){…} })），
 * 裸 ESM import/export 会直接 SyntaxError（R11 事故）。本脚本在 tsc 之后把多文件产物
 * 按依赖拓扑序合并回 dist/client/client.js，宿主契约零变化。
 *
 * 算法：
 *   1. 扫描 dist/client/*.js，从 entry（client.js）递归解析 `import {…} from './x.js'`；
 *   2. DFS 拓扑排序（依赖在前）；检测到循环依赖 → 打印环并 process.exit(1)；
 *   3. 改写：`export function/const/class X` → 剥掉 export 关键字并收集导出名；
 *      `export { A, B }` 列表行删除并收集名；每个非 entry 模块尾部追加
 *      `__kgM('client/<name>', { … })` 登记进微模块注册表；entry 体内联不包裹；
 *   4. import 语句按名去重后改写为 `const { … } = __kgR('client/<dep>')`。关键正确性
 *      约束：合并后所有模块体共享 factory **单一作用域**，而导出名本身就是导出方的
 *      顶层声明（const/function/class）——拓扑序保证「导出方先于导入方」落位，导入名
 *      与既有声明同名时若再发 `const { X } = __kgR(…)` 会直接重复声明 SyntaxError。
 *      因此同名绑定以「先落位的声明」为准（先到先得），import 改写在单作用域合并下
 *      退化为按名去重；注册表保留为模块清单 + 防御性取用口（__kgR 对未登记 id 响亮抛错）；
 *   5. 产出形态：factory 内 = 注册表 → 拓扑序模块体 → entry 体内联（其 factory 外的
 *      import 一并移入体内改写）→ 原 return {inject, apply} → factory/load 收尾原样。
 *
 * 铁律：不重命名任何标识符；不压缩；不删注释（中文注释全保留）；模块体内的
 * require('react') 原样保留（factory 参数 require 经闭包可见，render.test 的
 * requireShim 只认 'react'）；绝不产生行首 `export `/`import `（smoke 组合格式守卫）。
 *
 * cycle-24（v1.19.0 客户端组件化 TSX 重构）：模块发现从「单层平铺」升级为
 * 「递归扫子目录」——src/client/views/（视图组件层）与 src/client/graph/（图谱引擎族）
 * 进入合并范围；模块 id 为相对 dist/client 的 posix 路径（如 client/views/graph-view），
 * 相对导入 `./x.js` / `./views/x.js` / `../graph/x.js` 统一经 resolveSpec 解析。
 * 拓扑序 / 重名防御 / 原子写 / combo 终检语义零变化。
 */
import { readFileSync, writeFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'dist', 'client')
const entryId = 'client'

const read = (p) => readFileSync(p, 'utf-8')
const fail = (msg) => { console.error('[bundle-client] ' + msg); process.exit(1) }

/* ── 模块发现与依赖解析 ── */

/** 以 dist/client 为根解析模块相对导入 spec（'./x' | './views/x' | '../graph/x'），
 *  返回 dist/client 相对 posix 路径（不含 .js）。手写解析避免 Windows 分隔符混入。 */
function resolveSpec(fromName, spec) {
  const parts = fromName.includes('/') ? fromName.slice(0, fromName.lastIndexOf('/')).split('/') : []
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

function parseModule(name) {
  const src = read(join(clientDir, name + '.js'))
  const deps = []
  const importRe = /^[ \t]*import \{([^}]*)\} from '(\.\.?\/(?:[\w-]+\/)*[\w-]+)\.js';?[ \t]*$/gm
  let m
  while ((m = importRe.exec(src)) !== null) {
    deps.push({ names: m[1].split(',').map(s => s.trim()).filter(Boolean), target: resolveSpec(name, m[2]) })
  }
  return { name, id: 'client/' + name, src, deps }
}

// 收集模块体顶层声明名（缩进恰好 4 空格 = factory 作用域顶层；6 空格及以上属于函数内部）
function topLevelDecls(src) {
  const names = []
  for (const line of src.split('\n')) {
    const indent = (line.match(/^ */) || [''])[0].length
    if (indent !== 0 && indent !== 4) continue
    const m = line.match(/^(?:export )?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/)
    if (m) names.push(m[1])
  }
  return names
}

// export 剥皮：内联前缀去掉 `export `；`export { A, B }` 整行删除；返回改写体 + 导出名
function collectExports(src) {
  const names = new Set()
  for (const m of src.matchAll(/^[ \t]*export\s+(?:(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})/gm)) {
    if (m[1]) names.add(m[1])
    else for (const n of m[2].split(',').map(s => s.trim()).filter(Boolean)) names.add(n)
  }
  const body = src
    .replace(/^[ \t]*export (?=(?:function|class|const|let|var)\s+[A-Za-z_$][\w$]*)/gm, '')
    .replace(/^[ \t]*export \{[^}]*\};?[ \t]*\n?/gm, '')
  return { body, names: [...names] }
}

/* ── 拓扑排序（依赖在前）+ 环检测 ── */
const modules = new Map()
// cycle-24：递归发现 dist/client/**/*.js（含 views/、graph/ 子目录），模块名统一 posix 分隔符
for (const rel of readdirSync(clientDir, { recursive: true })) {
  if (!rel.endsWith('.js')) continue
  const name = rel.split('\\').join('/').slice(0, -3)
  if (name.endsWith('.tmp-' + String(process.pid)) || name.includes('.tmp-')) continue  // 原子写 tmp 产物不参与合并
  modules.set(name, parseModule(name))
}
if (!modules.has(entryId)) fail('缺少 dist/client/client.js entry')

const order = []
const state = new Map() // 0 未访问 | 1 访问中 | 2 完成
function visit(name, path) {
  const st = state.get(name) || 0
  if (st === 1) {
    const cycle = [...path.slice(path.indexOf(name)), name].join(' → ')
    fail('循环依赖:\n  ' + cycle)
  }
  if (st === 2) return
  state.set(name, 1)
  for (const d of modules.get(name).deps) {
    if (!modules.has(d.target)) fail(`${name} 导入了不存在的模块 ./d.js`.replace('d', d.target))
    visit(d.target, [...path, name])
  }
  state.set(name, 2)
  order.push(name)
}
visit(entryId, [])
if (order[order.length - 1] !== entryId) fail('entry 不在拓扑序末位: ' + order.join(' → '))

/* ── entry factory 头尾定位（以 entry 现有 factory 头尾为准包裹，不发明新结构） ── */
const entryMod = modules.get(entryId)
const openToken = 'factory(require) {'
const openIdx = entryMod.src.indexOf(openToken)
if (openIdx < 0) fail('entry 缺少 factory(require) { 头')
const tailMatch = /\n[ ]*\},\n\}\);?\n?$/.exec(entryMod.src)
if (!tailMatch) fail('entry 尾部不是预期的 "…},\\n});"（factory 闭合 + load 闭合）')
const head = entryMod.src.slice(0, openIdx + openToken.length)
const entryBody = entryMod.src.slice(openIdx + openToken.length, tailMatch.index)
const tail = entryMod.src.slice(tailMatch.index)

// entry 头部（factory 之外）的顶层 import：剥离并移入 factory 体内改写
const entryImports = []
const headOut = head.replace(/^[ \t]*import \{([^}]*)\} from '(\.\.?\/(?:[\w-]+\/)*[\w-]+)\.js';?[ \t]*\n?/gm, (_, list, spec) => {
  entryImports.push({ list: list.split(',').map(s => s.trim()).filter(Boolean), target: resolveSpec(entryId, spec) })
  return ''
})

/* ── 全局重名防御：不同模块顶层声明同名 → 合并后必然 SyntaxError，构建期响亮失败 ── */
const declOwner = new Map()
for (const name of order) {
  for (const n of topLevelDecls(collectExports(modules.get(name).src).body)) {
    if (declOwner.has(n) && declOwner.get(n) !== name) {
      fail(`顶层标识符重名: ${n} 同时声明于 ${declOwner.get(n)} 与 ${name}`)
    }
    declOwner.set(n, name)
  }
}

/* ── 组装 ── */
const bound = new Set() // factory 作用域内已落位的绑定名（声明优先，导入按名去重）
const pick = (list, target) => {
  const need = list.filter(n => !bound.has(n))
  need.forEach(n => bound.add(n))
  return need.length ? `    const { ${need.join(', ')} } = __kgR('client/${target}')` : null
}
const out = []
out.push('    /* ═══ 微模块注册表（cycle-13 AD-13.1：tsc 多文件产物 → 单 combo 工厂的桥） ═══')
out.push('       __kgM 登记 / __kgR 取用；模块体按依赖拓扑序排列（依赖在前），')
out.push('       合并后共享 factory 单作用域：模块导出名即其顶层声明（同名绑定以声明为准，')
out.push('       import 改写按名去重），__kgR 对未登记 id 响亮抛错绝不静默降级。 ═══ */')
out.push('    const __kg_reg = Object.create(null)')
out.push('    function __kgM(id, ex) { __kg_reg[id] = ex }')
out.push("    function __kgR(id) { if (!(id in __kg_reg)) throw new Error('kaogong bundle 缺模块: ' + id); return __kg_reg[id] }")

for (const name of order) {
  if (name === entryId) continue
  const mod = modules.get(name)
  const collected = collectExports(mod.src)
  if (!collected.names.length) fail(`模块 ${name} 无导出（异常）`)
  let body = collected.body
  const importLines = []
  body = body.replace(/^[ \t]*import \{([^}]*)\} from '(\.\.?\/(?:[\w-]+\/)*[\w-]+)\.js';?[ \t]*\n?/gm, (_, list, spec) => {
    const line = pick(list.split(',').map(s => s.trim()).filter(Boolean), resolveSpec(name, spec))
    if (line) importLines.push(line)
    return ''
  })
  out.push('')
  out.push(`    /* ════════════ 模块 client/${name}（拓扑序依赖在前） ════════════ */`)
  out.push(...importLines)
  out.push(body.replace(/^\n+/, ''))
  out.push(`    __kgM('client/${name}', { ${collected.names.join(', ')} })`)
  // 本模块顶层声明落位 → 后续模块的同名导入按名去重
  for (const n of topLevelDecls(body)) bound.add(n)
}

/* ── entry 体内联（import 移入体内改写；factory 头尾原样） ── */
out.push('')
out.push('    /* ════════════ 模块 client/client（entry，factory 体原样内联） ════════════ */')
for (const imp of entryImports) {
  const line = pick(imp.list, imp.target)
  if (line) out.push(line)
}
out.push(entryBody.replace(/^\n+/, ''))

const bundle = headOut.replace(/\n+$/, '\n') + '\n' + out.join('\n') + tail + '\n'

/* ── 终检：combo 形态硬约束 ── */
if (/^export /m.test(bundle) || /^import /m.test(bundle)) fail('产物含行首 export/import（combo 格式破坏）')
if (!/window\.__ModuleLoader__\.load\(\{/.test(bundle)) fail('产物丢失 window.__ModuleLoader__.load({ 头')
if (!/return \{\s*inject: \[[^\]]*\],\s*apply\(ctx\)/.test(bundle)) fail('产物丢失 return {inject, apply}')
for (const needle of ["getContext('2d')", 'function relax', 'function step', 'function draw', 'function fit', 'labelBoxes', 'focusNode']) {
  if (!bundle.includes(needle)) fail('产物丢失图谱关键文本: ' + needle)
}

/* 原子写（cycle-13 教训⑥）：eval-runner 并行预热会同时跑 test∥build，
 * smoke 可能在「tsc 已重写、bundler 未合并」的窗口读产物；tmp+rename 保证
 * 读者要么看到完整旧 combo、要么看到完整新 combo，绝不读到半截文件。
 * tmp 名带 pid：smoke 自愈与 build 子进程的 bundler 可能并发，防同名 tmp 互踩。 */
const tmpOut = join(clientDir, 'client.js.tmp-' + process.pid)
writeFileSync(tmpOut, bundle)
renameSync(tmpOut, join(clientDir, 'client.js'))
const kb = (Buffer.byteLength(bundle) / 1024).toFixed(1)
console.log(`[bundle-client] 已合并 ${order.length} 个模块 → dist/client/client.js（${kb} KB）`)
console.log('[bundle-client] 拓扑序: ' + order.join(' → '))
