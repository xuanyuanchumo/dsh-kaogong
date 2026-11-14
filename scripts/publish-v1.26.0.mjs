/**
 * publish-v1.26.0.mjs — npm 发布脚本（㊳ 教训：显式 chdir 到发布仓根，绝不依赖调用环境 cwd）
 * 令牌经环境变量 NPM_TOKEN 注入（vault_run），.npmrc.publish 引用 ${NPM_TOKEN}。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

process.chdir('D:/Projects/TraeProjects/kaogong/_publish-kaogong')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
console.log('[publish] cwd =', process.cwd())
console.log('[publish] publishing', pkg.name + '@' + pkg.version)

// pack 先做最后一次形态复核（combo 格式 = 宿主启动先验条件）
const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { shell: true, encoding: 'utf8' })
if (pack.status !== 0) { console.error('[publish] pack dry-run 失败'); process.exit(1) }
const info = JSON.parse(pack.stdout)[0]
const files = info.files.map(f => f.path)
for (const must of ['cordis.patch.yml', 'data/study-plan.md', 'dist/client/client.js']) {
  if (!files.includes(must)) { console.error('[publish] 关键文件缺失:', must); process.exit(1) }
}
console.log('[publish] pack OK:', files.length, 'files ·', Math.round(info.size / 1024) + 'KB')

const r = spawnSync('npm', ['publish', '--access', 'public', '--userconfig', '.npmrc.publish'], { shell: true, encoding: 'utf8' })
console.log(r.stdout)
if (r.status !== 0) { console.error(r.stderr); process.exit(r.status || 1) }
console.log('[publish] DONE:', pkg.name + '@' + pkg.version)
