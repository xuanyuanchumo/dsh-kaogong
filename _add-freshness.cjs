const fs = require('fs')
const p = 'smoke.test.mjs'
let s = fs.readFileSync(p, 'utf8')

// 找一个合适的插入点：在第一个 check 之前（测试段 1 之前）
const anchor = "// ── 1. 崩溃安全"
if (!s.includes(anchor)) { console.error('锚点未找到'); process.exit(1) }

const guard = `// ── 0. 构建产物新鲜度（T-022：dist 必须不旧于 src）──
{
  const root = new URL('.', import.meta.url).pathname.replace(/^\\/([A-Za-z]:)/, '$1')
  const pairs = []
  function walk(dir, rel) {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + name.name : name.name
      if (name.isDirectory()) { walk(dir + '/' + name.name, r); continue }
      if (name.name.endsWith('.ts')) pairs.push(r.replace(/\\.ts$/, '.js'))
    }
  }
  walk(root + 'src', '')
  const stale = []
  for (const rel of pairs) {
    const srcPath = root + 'src/' + rel.replace(/\\.js$/, '.ts')
    const distPath = root + 'dist/' + rel
    if (!fs.existsSync(distPath)) { stale.push(rel + '（产物缺失）'); continue }
    if (fs.statSync(distPath).mtimeMs < fs.statSync(srcPath).mtimeMs - 1000) {
      stale.push(rel + '（产物过期）')
    }
  }
  check('构建产物新鲜(dist >= src)', stale.length === 0, stale.slice(0, 3).join('; ') || 'ok')
}

` + anchor

s = s.replace(anchor, guard)
fs.writeFileSync(p, s)
console.log('✅ 新鲜度门已加入')
