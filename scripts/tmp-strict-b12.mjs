/**
 * 临时脚本：批 12 剩余域处置（methodologyApi/http/poolApi/repoManager/question-kit/study-view/manifest）
 */
import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf-8')
const write = (p, s) => fs.writeFileSync(p, s)

// ① methodologyApi：三处 Map/槽位 null 初始化 → any
let ma = read('src/server/methodologyApi.ts')
ma = ma.replace(/let (\w+) = null(\s*\n\s*\/\/[^\n]*IndexSlot)/g, (m, v, tail) => `let ${v}: any = null${tail}`)
// 通用兜底：三处字面（按行号上下文手动核对后改为宽替换）
ma = ma.replace(/^( *)(let \w+ = null)$/gm, (m, indent, decl) => {
  // 只改 IndexSlot/Map 槽位相关的三处——通过上下文关键字判断
  const idx = ma.indexOf(decl)
  const ctx = ma.slice(Math.max(0, idx - 200), idx + 200)
  if (/IndexSlot|清缓存|槽位|slot/.test(ctx)) return `${indent}let ${decl.split('= ')[1]}: any = null`
  return m
})
write('src/server/methodologyApi.ts', ma)
console.log('methodologyApi 处置完成')

// ② http.ts L416/417 box/consecutive never + L588 ws possibly undefined
let http = read('src/server/http.ts')
http = http.replace('    let wrongEvent: any = null', '    let wrongEvent: any = null')
// L588 wsRaw possibly undefined → 传参处兜底
http = http.replace(/(domains\.store\.loadProgress\()wsRaw(\))/g, '$1wsRaw || undefined$2')
write('src/server/http.ts', http)
console.log('http 处置完成')

// ③ poolApi L94/108 paper/region year: string|null → string|undefined
let pa = read('src/server/poolApi.ts')
pa = pa.replace(/(year: )\(e\.year \|\| 0\) \|\| null/g, '$1(e.year || 0) || undefined')
write('src/server/poolApi.ts', pa)
console.log('poolApi 处置完成')

// ④ repoManager L342 isHalfClone boolean → null 初始化
let rm = read('src/server/repoManager.ts')
rm = rm.replace(/^( *)(let \w+ = null)$/gm, (m, indent, decl) => {
  const idx = rm.indexOf(decl)
  const ctx = rm.slice(Math.max(0, idx - 150), idx + 150)
  if (/isHalfClone/.test(ctx)) return `${indent}let ${decl.split('= ')[1]}: any = null`
  return m
})
write('src/server/repoManager.ts', rm)
console.log('repoManager 处置完成')

// ⑤ question-kit L332 src possibly undefined
let qk = read('src/client/question/question-kit.tsx')
qk = qk.replace(/(src=)\{?String\((\w+)\.src \|\| ''\)?\}?/g, '$1{$2.src || \'\'}')
write('src/client/question/question-kit.tsx', qk)
console.log('question-kit 处置完成')
