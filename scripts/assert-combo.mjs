#!/usr/bin/env node
/**
 * scripts/assert-combo.mjs — combo 产物形态硬守卫（cycle-20 P0 根治）
 *
 * 背景（R11 第三次复发 / 2026-11-13 用户实证）：
 *   `.cycles/config.yml` 的 G3 `build_commands: ["npx tsc"]` 绕过了 npm scripts，
 *   裸 tsc 把 dist/client/client.js 从 combo factory 重写回裸 ESM（7 处行首 import）。
 *   宿主 Web 组合加载器解析裸 ESM 抛 SyntaxError → Client 半不激活（"插件启动失败"），
 *   组合加载器异常未被隔离时可能冒泡影响宿主启动。
 *   主力 profile 是 `link:` 到开发仓，所以构建产物被污染 = 宿主下次启动直接踩雷。
 *
 * 本守卫是「最后一道机械防线」：凡读取宿主将要加载的 combo 文件，先验形态。
 * 判据与 bundler 终检同源（行首 import/export + load 头 + return {inject, apply}）；
 * 与 smoke 的 readClientBundle 自愈不同——本脚本**只判不修**（构建期发现污染必须
 * 响亮失败，让调用方修流程，而不是悄悄把错误产物带过门禁）。
 *
 * 用法：
 *   node scripts/assert-combo.mjs              # 检查，失败 exit 1
 *   node scripts/assert-combo.mjs --fix        # 检查，失败时重跑 bundler 再复查（安装期/收口用）
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const comboPath = join(root, 'dist', 'client', 'client.js')
const fix = process.argv.includes('--fix')

function shape(txt) {
  return {
    bareImport: /^import[ \t]/m.test(txt),
    bareExport: /^export[ \t]/m.test(txt),
    hasLoad: /window\.__ModuleLoader__\.load\(\{/.test(txt),
    hasReturn: /return \{\s*inject: \[[^\]]*\],\s*apply\(ctx\)/.test(txt),
    /**
     * cycle-60 R13 加固（真实守卫洞）：上面 bareExport 只认**行首** export，
     * 但 `export function f` 若与前置注释同行（`/** doc *​/export function f`），
     * bundler 的 `^[ \t]*export` 正则失配 → export 关键字留在 combo 中段 →
     * 宿主解析 `SyntaxError: Unexpected token 'export'`，而本守卫当时仍判 OK（假绿）。
     * 判据：任何非行首的 `export function|const|class|default` 都视为产物污染。
     * （`__kgM`/注释里的 'export' 字样不会命中原生语法关键字形态。）
     */
    midLineExport: /^(?!export[ \t]).*\bexport[ \t]+(?:async[ \t]+)?(?:function|const|class|default|let|var)\b/m.test(txt),
  }
}
function check(label) {
  if (!existsSync(comboPath)) {
    console.error(`[assert-combo] ${label}: 产物缺失 dist/client/client.js`)
    return false
  }
  const s = shape(readFileSync(comboPath, 'utf-8'))
  const bad = s.bareImport || s.bareExport || s.midLineExport || !s.hasLoad || !s.hasReturn
  if (bad) {
    console.error(`[assert-combo] ${label}: combo 形态破坏 → ` +
      `行首import=${s.bareImport} 行首export=${s.bareExport} 中段export=${s.midLineExport} ` +
      `load头=${s.hasLoad} return.inject/apply=${s.hasReturn}`)
    console.error('[assert-combo] 根因：裸 tsc 覆写 combo，或 export 与注释同行致 bundler 漏剥；必须跑 `npm run build`')
    return false
  }
  console.log(`[assert-combo] ${label}: combo 形态 OK（无行首/中段 import·export · load 头 · return {inject,apply}）`)
  return true
}

if (check('首次')) process.exit(0)
if (!fix) process.exit(1)
const r = spawnSync(process.execPath, ['scripts/bundle-client.mjs'], { cwd: root, stdio: 'inherit' })
if (r.status !== 0) {
  console.error('[assert-combo] bundler 重跑失败，拒绝放行')
  process.exit(1)
}
if (!check('修复后')) process.exit(1)
console.log('[assert-combo] 已自愈并复查通过')
