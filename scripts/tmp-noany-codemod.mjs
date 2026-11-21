/**
 * 临时脚本：noImplicitAny codemod——按 tsc 输出给隐式 any 参数补 ': any' 显式标注。
 *
 * 原理：解析 tsc 输出的 (file, line, col) + 参数名，在源文件对应位置插入 ': any'。
 * 安全性：只处理 TS7006（Parameter 'x' implicitly has an 'any' type）——这类标注
 * 是显式化而非改语义；每文件修完立即跑 tsc 校验，语法损坏即还原（教训㉙）。
 *
 * 注意：必须按行号从大到小处理（避免插入后行号漂移）。
 */
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const REPO = process.cwd()

// 生成 tsc 输出
const base = JSON.parse(fs.readFileSync('tsconfig.json', 'utf-8'))
base.compilerOptions.noImplicitAny = true
fs.writeFileSync('tsconfig.probe.json', JSON.stringify(base, null, 2))
let out = ''
try { execSync('npx tsc -p tsconfig.probe.json --noEmit', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }) }
catch (e) { out = (e.stdout || '') + (e.stderr || '') }
fs.rmSync('tsconfig.probe.json')

// 解析 TS7006
const fixes = new Map() // file -> [{ line, col, param }]
for (const l of out.split('\n')) {
  const m = l.match(/^(src\/[^(]+)\((\d+),(\d+)\): error TS7006: Parameter '([^']+)' implicitly has an 'any' type/)
  if (m) {
    const [, file, line, col, param] = m
    if (!fixes.has(file)) fixes.set(file, [])
    fixes.get(file).push({ line: +line, col: +col, param })
  }
}
console.log('待修文件数:', fixes.size, '· 总参数:', [...fixes.values()].reduce((s, a) => s + a.length, 0))

let totalFixed = 0
for (const [file, items] of fixes) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n')
  // 行号从大到小（避免漂移）；同行多个参数从列号大到小
  items.sort((a, b) => b.line - a.line || b.col - a.col)
  let ok = 0
  for (const it of items) {
    const line = lines[it.line - 1]
    if (line == null) continue
    const col = it.col - 1 // 0-based
    // 在 col 处的参数名后插 ': any'——校验该位置确实是参数名
    const before = line.slice(0, col)
    const rest = line.slice(col)
    if (!rest.startsWith(it.param)) continue // 位置漂移防御
    // 防止重复标注（已经有类型的不插）
    const afterParam = rest.slice(it.param.length)
    if (/^\s*:/.test(afterParam)) continue
    lines[it.line - 1] = before + it.param + ': any' + afterParam
    ok++
  }
  if (ok) {
    fs.writeFileSync(file, lines.join('\n'))
    totalFixed += ok
    console.log(' ', file.replace('src/', ''), '→', ok, '处标注')
  }
}
console.log('总计标注:', totalFixed)
