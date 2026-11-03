const fs = require('fs')
const p = 'smoke.test.mjs'
let s = fs.readFileSync(p, 'utf8')

const anchor = '  // v1.7 深度题库（Naoku 五维标注，Node≥22.19 才有）'
if (!s.includes(anchor)) { console.error('锚点未找到'); process.exit(1) }

const insert = [
  '  // v1.7.1 专题树：行测/申论分频道 + 每专题带练习入口',
  '  const tree = await J(`${B}/api/topics`)',
  "  check('专题树分频道(行测/申论)', Array.isArray(tree.channels) && tree.channels.length === 2, (tree.channels || []).map(c => c.name).join('/'))",
  "  const xcCh = (tree.channels || []).find(c => c.id === 'xingce')",
  "  const slCh = (tree.channels || []).find(c => c.id === 'shenlun')",
  "  check('行测专题含模块+细分题型', (xcCh.topics || []).filter(t => t.kind === 'module').length >= 6 && (xcCh.topics || []).some(t => t.kind === 'category'), `${(xcCh.topics || []).length} 个专题`)",
  "  check('申论专题含五类题型', (slCh.topics || []).length === 5, (slCh.topics || []).map(t => t.title).join('/'))",
  "  check('行测有练习入口(含刷题/深度/模考)', (xcCh.entries || []).length >= 3, (xcCh.entries || []).map(e => e.label).join('/'))",
  "  check('申论练习入口并入专题', (slCh.entries || []).some(e => e.view === 'essay'), (slCh.entries || []).map(e => e.label).join('/'))",
  "  check('专题 entry 指向练习视图', (xcCh.topics || []).every(t => t.entry && t.entry.view), 'ok')",
  '',
  anchor,
].join('\n')

s = s.replace(anchor, insert)
fs.writeFileSync(p, s)
console.log('✅ 专题树断言已加')
