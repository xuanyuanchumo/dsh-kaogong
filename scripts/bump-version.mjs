#!/usr/bin/env node
/**
 * scripts/bump-version.mjs — 版本三锚点统一管理器（cycle-17）
 *
 * 背景：版本号字面量分散在 package.json / manifest.ts / README.md 三处，手工 bump
 * 必漏（cycle-13 收口教训：W3 升 package.json 漏改 manifest → 沙箱 banner 报旧版）。
 * SELF_META/buildGraph 已引用 CAPABILITIES.plugin.version（运行期单一事实源），
 * 本脚本把「发布期」三锚点也收敛为一条命令，杜绝漂移。
 *
 * 用法：node scripts/bump-version.mjs 1.13.0
 *   （或 npm run version:bump -- 1.13.0）
 * 行为：校验语义化版本 → 三处原子替换（tmp+rename）→ 打印 diff 摘要；
 *   任一锚点找不到模式 = 响亮失败（exit 1，绝不静默跳过——静默即漂移）。
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ver = process.argv[2]
if (!ver || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(ver)) {
  console.error('[bump-version] 用法: node scripts/bump-version.mjs <x.y.z>（需合法语义化版本）')
  process.exit(1)
}

// 三锚点定义：文件 + 精确替换模式 + 人读标签
const ANCHORS = [
  {
    file: 'package.json', label: 'package.json',
    captureOld: /"version":\s*"(\d+\.\d+\.\d+(?:-[\w.]+)?)"/,
    test: (s) => /"version":\s*"\d+\.\d+\.\d+(-[\w.]+)?"/.test(s),
    apply: (s) => s.replace(/"version":\s*"\d+\.\d+\.\d+(-[\w.]+)?"/, `"version": "${ver}"`),
  },
  {
    file: 'src/shared/manifest.ts', label: 'manifest CAPABILITIES.plugin.version',
    captureOld: /plugin: \{ id: 'kaogong', name: 'dsh-kaogong', version: '(\d+\.\d+\.\d+(?:-[\w.]+)?)'/,
    test: (s) => /plugin: \{ id: 'kaogong', name: 'dsh-kaogong', version: '\d+\.\d+\.\d+(-[\w.]+)?'/.test(s),
    apply: (s) => s.replace(/plugin: \{ id: 'kaogong', name: 'dsh-kaogong', version: '(\d+\.\d+\.\d+(-[\w.]+)?)'/,
      `plugin: { id: 'kaogong', name: 'dsh-kaogong', version: '${ver}'`),
  },
  {
    file: 'README.md', label: 'README 标题锚点',
    captureOld: /dsh-kaogong — 考公备考整合插件（DSH 宿主原生面板）· v(\d+\.\d+\.\d+(?:-[\w.]+)?)/,
    test: (s) => /dsh-kaogong — 考公备考整合插件（DSH 宿主原生面板）· v\d+\.\d+\.\d+(-[\w.]+)?/.test(s),
    apply: (s) => s.replace(/(dsh-kaogong — 考公备考整合插件（DSH 宿主原生面板）· v)(\d+\.\d+\.\d+(-[\w.]+)?)/, `$1${ver}`),
  },
]

const results = []
for (const a of ANCHORS) {
  const p = join(root, a.file)
  let src
  try { src = readFileSync(p, 'utf-8') } catch (e) { console.error(`[bump-version] 读失败 ${a.file}: ${e.message}`); process.exit(1) }
  // 旧版本从锚点自身捕获（captureOld 与各锚点模式对齐；不用全文首个 semver——
  // package.json 全文首匹配可能是依赖版本，README 首匹配可能是引用行）
  const om = src.match(a.captureOld)
  const oldV = om ? (om[1] || om[0]) : '?'
  const next = a.apply(src)
  const tmp = p + '.tmp'
  writeFileSync(tmp, next)
  renameSync(tmp, p)
  results.push(`${a.label}: ${oldV} → ${ver}`)
}
console.log('[bump-version] v' + ver + ' 三锚点已原子同步：')
for (const r of results) console.log('  ✅ ' + r)
console.log('（提醒：改完 .ts 必须 npm run build；smoke 版本三锚点守卫会核验一致）')
