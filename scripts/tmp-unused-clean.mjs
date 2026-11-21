/**
 * 临时脚本：noUnusedLocals 69 错误批量清理（三类处置）
 * ① 未使用 import → 删除该导入名（保持 import 语句其余部分）
 * ② 未使用 interface（TS6196）→ 组件解构补注类型（Props 已写好就消费它）
 * ③ 未使用局部变量 → 逐个人工判定（删除 vs 保留消费）
 */
import fs from 'node:fs'

const REPO = process.cwd()
const read = (p) => fs.readFileSync(p, 'utf-8')
const write = (p, s) => fs.writeFileSync(p, s)

// ① 未使用 import 清单（从 tsc 输出人工核对后的删除表）
const importRemovals = {
  'src/adapters/huasheng13.ts': ['dirname'],
  'src/adapters/naoku.ts': ['statSync', 'dirname'],
  'src/adapters/paperData.ts': ['existsSync', 'guessXingceType'],
  'src/adapters/paperParse.ts': ['basename'],
  'src/adapters/poolDb.ts': ['existsSync', 'renameSync'],
  'src/adapters/poolIngest.ts': ['withTx'],
  'src/adapters/poolSourceImpls.ts': ['statSync'],
  'src/adapters/poolSourceKnowledge.ts': ['poolStats'],
  'src/adapters/tuxing.ts': ['dirname'],
  'src/client/client.tsx': ['Stat'],
  'src/client/question/question-kit.tsx': ['h'],
  'src/client/question/question-lightbox.tsx': ['h'],
  'src/client/views/graph-view.tsx': ['KgLoad', 'KgErr'],
  'src/client/views/huasheng13-view.tsx': ['h'],
  'src/client/views/papers-view.tsx': ['h', 'QwExamNavigator'],
  'src/client/views/plan-view.tsx': ['h', 'Stat', 'KV_BTN'],
  'src/client/views/repos-view.tsx': ['h', 'entries'],
  'src/client/views/study-view.tsx': ['h', 'OptionRow', 'QwQuestionCard'],
  'src/server/historyApi.ts': ['naokuQuestions'],
  'src/server/http.ts': ['shortestPath', 'neighborhood', 'reverseReach'],
  'src/server/paperApi.ts': ['join'],
  'src/server/repoManager.ts': ['renameSync', 'looksLikeReposRoot'],
  'src/server/topicTree.ts': ['buildTopics'],
}

let removed = 0
for (const [file, names] of Object.entries(importRemovals)) {
  let s = read(file)
  for (const name of names) {
    // 从 import { a, b, name, c } 中移除 name（含相邻逗号）
    const before = s
    s = s.replace(new RegExp('(import [^;]*?)\\b' + name + '\\b,?\\s*', 'm'), (mm, head) => {
      // 保持语法合法：去掉 name 及其尾随逗号；若 name 在行首且后面无项，去前导逗号
      return mm.replace(new RegExp('\\b' + name + '\\b\\s*,?\\s*'), '')
    })
    if (s !== before) removed++
  }
  write(file, s)
}
console.log('import 删除:', removed, '处')

// ② huasheng13-view 9 个 Props interface → 组件解构补注类型
const hvFile = 'src/client/views/huasheng13-view.tsx'
let hv = read(hvFile)
const propPairs = [
  ['Hs13DonutProps', 'Hs13Donut'],
  ['Hs13ModuleCardProps', 'Hs13ModuleCard'],
  ['Hs13OverviewProps', 'Hs13Overview'],
  ['Hs13DocReaderProps', 'Hs13DocReader'],
  ['Hs13CatalogProps', 'Hs13Catalog'],
  ['Hs13SearchProps', 'Hs13Search'],
  ['Hs13PracticeProps', 'Hs13Practice'],
  ['Hs13TraceProps', 'Hs13Trace'],
  ['NativeHuasheng13ViewProps', 'NativeHuasheng13View'],
]
let typed = 0
for (const [iface, fn] of propPairs) {
  const re = new RegExp('function ' + fn + '\\((props)\\)')
  if (re.test(hv)) { hv = hv.replace(re, 'function ' + fn + '(props: ' + iface + ')'); typed++ }
}
write(hvFile, hv)
console.log('Hs13 组件类型注解:', typed, '/ 9')

console.log('阶段 A 完成——跑 tsc 复验后进入阶段 B（局部变量）')
