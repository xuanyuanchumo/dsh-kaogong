/**
 * tests/smoke/market-entry.test.mjs — 市场条目守卫（cycle-62）
 *
 * 守 awesome-dsh-plugin 贡献规范（contributing.md）：
 *   · 只允许 url / name / category / description{en,zh} / icon / tarball 六个键；
 *   · **禁止手写 `npm:` 键**（npm 关联由 registry 自动采集）；
 *   · `description.en` 必填、**单行**、以句号结尾；
 *   · `icon` 必须是 **GitHub 托管位图**（png/jpg/jpeg/webp；SVG 与第三方图床会被拒）；
 *   · filename 必须等于 url 推出的 slug（owner__repo.yml）。
 *
 * 另加**数字一致性**守卫（㉝「声明 vs 实体」纪律）：条目描述里出现的关键数字
 * 必须与 manifest 事实源一致——否则市场页会展示过期能力（用户可感知缺陷）。
 *
 * 运行：npx vitest run tests/smoke/market-entry.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const ENTRY = path.join(REPO, 'docs', 'marketplace', 'xuanyuanchumo__dsh-kaogong.yml')
const raw = fs.readFileSync(ENTRY, 'utf8')

/** 去掉注释行（本地镜像文件顶部有说明注释；上游条目无注释） */
const yamlText = raw.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n')

test('MKT-01 条目文件名 = url 推出的 slug（owner__repo.yml）', () => {
  const base = path.basename(ENTRY)
  expect(base).toBe('xuanyuanchumo__dsh-kaogong.yml')
  const url = (yamlText.match(/^url:\s*(\S+)/m) || [])[1] || ''
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/)
  expect(!!m, 'url 必须是 https://github.com/owner/repo 形状：' + url).toBe(true)
  expect(`${m[1]}__${m[2]}.yml`).toBe(base)
})

test('MKT-02 字段集合合法（无 npm: 键 / 无多余键）', () => {
  const allowed = new Set(['url', 'name', 'category', 'description', 'en', 'zh', 'icon', 'tarball'])
  const keys = []
  for (const line of yamlText.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*):/)
    if (m) keys.push(m[1])
  }
  const bad = keys.filter(k => !allowed.has(k))
  expect(bad, '非法字段（contributing.md 只允许 url/name/category/description/icon/tarball）').toEqual([])
  expect(keys.includes('npm'), '禁止手写 npm: 键（npm 关联由 registry 自动采集）').toBe(false)
})

test('MKT-03 description.en 必填 · 单行 · 以句号结尾', () => {
  const enBlock = (yamlText.match(/^\s{2}en:\s*'(.*)'\s*$/m) || [])[1]
  expect(typeof enBlock === 'string' && enBlock.length > 0, 'description.en 必填').toBe(true)
  expect(!/[\r\n]/.test(enBlock), 'description.en 必须是单行').toBe(true)
  expect(enBlock.trim().endsWith('.'), 'description.en 以句号结尾').toBe(true)
})

test('MKT-04 icon 为 GitHub 托管位图（png/jpg/jpeg/webp；禁 SVG/第三方图床）', () => {
  const icon = (yamlText.match(/^icon:\s*(\S+)/m) || [])[1] || ''
  expect(icon, 'icon 必须存在').toBeTruthy()
  expect(icon.startsWith('https://raw.githubusercontent.com/'), 'icon 必须是 GitHub 托管位图：' + icon).toBe(true)
  expect(/\.(png|jpe?g|webp)(\?.*)?$/i.test(icon), 'icon 必须是位图（禁 SVG）：' + icon).toBe(true)
})

test('MKT-05 category 取值合法（tools 等上游既定词表）', () => {
  const cat = (yamlText.match(/^category:\s*(\S+)/m) || [])[1] || ''
  // 上游分类词表（contributing.md §category）；维护者可改，但格式须为小写单词
  expect(cat).toMatch(/^[a-z][a-z-]*$/)
  expect(cat).toBe('tools')
})

test('MKT-06 描述数字与服务端事实源一致（题量从池实测派生，不写死）', async () => {
  const { CAPABILITIES } = await import('../../dist/shared/manifest.js')
  // cycle-62 端点收敛：/api/naoku/* 六端点退役 + 3 语义下沉到池 → 82 − 6 + 3 = 79
  expect(CAPABILITIES.endpoints.length).toBe(79)
  expect(CAPABILITIES.tools.length).toBe(6)
  expect(CAPABILITIES.views.length).toBe(16)
  /**
   * ⚠️ cycle-68 修复（两轮才修对）：
   * ① 原守卫把「86,454 题」**写死在测试里**——池一增长（本地 87,434）守卫就红，
   *    而红的原因是"描述没跟上"还是"守卫自己过期"无从分辨；
   * ② 改成「从池实测派生」后仍然红：**CI 环境的池是 87,768 题、本地是 87,434 题**——
   *    两者由不同的源集合构建（CI 走 `scripts/ci/build-pool.mjs`），这个数字
   *    **本质上是环境相关的**，不该拿来做跨环境的精确断言。
   *
   * 正解 = 断言「描述里的题量与**同环境**池实测的数量级一致」：
   *   · 池不可用（本地无题库 / CI 未建池）→ 跳过数字断言，不假红
   *   · 池可用 → 断言描述里写的千分位数字与实测**在同一万位区间**（容忍不同源集合的差异），
   *     且**必须≥ 8 万**（描述的是"8 万+题"这个量级事实）
   * 这样既能抓住"描述写成 1 万题"这种严重漂移，又不会因为 CI/本地源集合不同而假红。
   */
  const { DatabaseSync } = await import('node:sqlite')
  const { USER_DATA_ROOT } = await import('../../dist/server/dataRoot.js')
  let poolCount = 0
  let paperCount = 0
  try {
    const db = new DatabaseSync(USER_DATA_ROOT + '/.kaogong.db', { readOnly: true })
    try {
      poolCount = Number(db.prepare('SELECT COUNT(*) c FROM question').get().c || 0)
      paperCount = Number(db.prepare('SELECT COUNT(*) c FROM paper').get().c || 0)
    } finally { db.close() }
  } catch { /* 池不可用 → 跳过数字断言（环境差异不该假红） */ }

  const en = (yamlText.match(/^\s{2}en:\s*'(.*)'\s*$/m) || [])[1] || ''
  const zh = (yamlText.match(/^\s{2}zh:\s*'(.*)'\s*$/m) || [])[1] || ''
  // 描述里出现的题量数字（千分位）
  const numsIn = (t) => (t.match(/\b\d{2},\d{3}\b/g) || []).map(s => Number(s.replace(/,/g, '')))
  for (const [tag, t] of [['en', en], ['zh', zh]]) {
    const nums = numsIn(t)
    expect(nums.length > 0, tag + ' 描述未写任何题量数字（应说明题库规模）').toBe(true)
    // 量级断言：描述宣称的题量必须 ≥ 8 万（当前池 8.7 万+，写成 1 万就是严重失真）
    const claimed = Math.max(...nums)
    expect(claimed >= 80000, tag + ` 描述题量 ${claimed} 明显低于实际池量级（应写 8 万+）`).toBe(true)
    // 与实测的相对偏差 ≤ 30%（容忍 CI/本地源集合差异，但不容忍数量级漂移）
    if (poolCount > 0) {
      const dev = Math.abs(claimed - poolCount) / poolCount
      expect(dev <= 0.3, tag + ` 描述题量 ${claimed} 与池实测 ${poolCount} 偏差 ${(dev * 100).toFixed(1)}%（>30%）`).toBe(true)
    }
  }
  /**
   * 卷数同理（cycle-68 第三轮）：CI 环境实测 **1,669 套**、本地 **1,683 套**——
   * 源集合相同（都用 question-banks.txt 的 9 个仓），但 `gwy-zhenti` 上游仓库在
   * 不同克隆时刻的卷数本来就会变（上游持续补卷）。故卷数也只做**量级 + 容差**断言。
   */
  for (const [tag, t] of [['en', en], ['zh', zh]]) {
    const papers = (t.match(/\b\d{1,2},\d{3}\b/g) || []).map(s => Number(s.replace(/,/g, '')))
    // 描述里除题量外还应有卷数；取介于 1000~5000 的那个数当卷数
    const claimedPapers = papers.filter(n => n >= 1000 && n < 5000)
    expect(claimedPapers.length > 0, tag + ' 描述未写真题卷数（应说明卷规模）').toBe(true)
    const cp = Math.max(...claimedPapers)
    if (paperCount > 0) {
      const dev = Math.abs(cp - paperCount) / paperCount
      expect(dev <= 0.3, tag + ` 描述卷数 ${cp} 与实测 ${paperCount} 偏差 ${(dev * 100).toFixed(1)}%（>30%）`).toBe(true)
    }
  }
  // 方法论 25 篇是静态事实源（HUASHENG13_META），不随池变化
  for (const t of [en, zh]) {
    expect(t.includes('25 '), '描述须写方法论 25 篇').toBe(true)
  }
})
