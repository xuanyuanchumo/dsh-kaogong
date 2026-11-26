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

test('MKT-06 描述数字与 manifest 事实源一致（统一题库池 86,454 题）', async () => {
  const { CAPABILITIES } = await import('../../dist/shared/manifest.js')
  expect(CAPABILITIES.endpoints.length).toBe(82)
  expect(CAPABILITIES.tools.length).toBe(6)
  expect(CAPABILITIES.views.length).toBe(16)
  // 统一题库池规模（跨源内容级去重后）——描述里出现的数字必须与之相符
  const en = (yamlText.match(/^\s{2}en:\s*'(.*)'\s*$/m) || [])[1] || ''
  const zh = (yamlText.match(/^\s{2}zh:\s*'(.*)'\s*$/m) || [])[1] || ''
  for (const t of [en, zh]) {
    expect(t.includes('86,454'), '描述须写统一题库池 86,454 题（与统一池事实一致）').toBe(true)
    expect(t.includes('1,683'), '描述须写真题卷 1,683 套').toBe(true)
    expect(t.includes('25 '), '描述须写方法论 25 篇').toBe(true)
  }
})
