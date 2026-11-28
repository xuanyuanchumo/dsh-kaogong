/**
 * search-integration.test.mjs — 图片搜题并入统一检索区 + 检索结果完整渲染守卫
 *
 * 用户 2026-11-28 反馈三缺陷的回归守卫：
 *  1. 图片搜题应并入「统一题库 → 跨源统一检索」，不设独立视图
 *  2. 统一检索结果渲染不全（缺选项/答案/题号/材料/图片）
 *  3. 无「加入错题本」能力
 *  补充：使用模型开关 + provider/model 切换入口
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'

const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')

test('SEARCHINT-01 图片搜题并入 pool-view，无独立视图入口', () => {
  const pool = readSrc('src/client/views/pool-view.tsx')
  expect(pool.includes('PoolImageSearch'), 'pool-view 未集成 PoolImageSearch').toBe(true)
  expect(pool.includes('🖼 图片搜题'), '检索区无图片搜题展开入口').toBe(true)
  expect(!fs.existsSync(new URL('../../src/client/views/imgsearch-view.tsx', import.meta.url)), '独立 imgsearch 视图未删除').toBe(true)
  const client = readSrc('src/client/client.tsx')
  expect(client.includes('NativeImgSearchView') || client.includes("imgsearch:"), 'client 仍残留 imgsearch 路由').toBe(false)
  const reg = readSrc('src/client/view-registry.ts')
  expect(reg.includes("id: 'imgsearch'"), 'view-registry 仍残留 imgsearch').toBe(false)
})

test('SEARCHINT-02 使用模型开关 + provider/model 切换入口（一等控件）', () => {
  const pool = readSrc('src/client/views/pool-view.tsx')
  expect(pool.includes('使用模型'), '缺「使用模型」开关文案').toBe(true)
  expect(/type=\"checkbox\"/.test(pool), '缺 checkbox 开关').toBe(true)
  expect(pool.includes('选择 provider'), '缺 provider 切换入口').toBe(true)
  expect(pool.includes('选择模型'), '缺 model 切换入口').toBe(true)
  expect(pool.includes("/img-search/models"), '未拉模型清单').toBe(true)
})

test('SEARCHINT-03 检索结果七段渲染（题干/选项/答案/题号/材料/解析/图片）', () => {
  const pool = readSrc('src/client/views/pool-view.tsx')
  // 题干题干用 RichText（支持 kgimg:// 题图与选项图）
  expect(pool.includes('<RichText'), '未用 RichText 渲染（图片/富文本丢失）').toBe(true)
  // 选项渲染（Object.entries(options) 防御式归一）
  expect(pool.includes('poolOptionsOf') && pool.includes('optEntries'), '缺选项渲染').toBe(true)
  // 答案
  expect(pool.includes('正确答案'), '缺答案渲染').toBe(true)
  // 题号
  expect(pool.includes('第 '), '缺题号渲染').toBe(true)
  // 材料
  expect(pool.includes('给定材料'), '缺材料渲染').toBe(true)
  // 解析（放宽到 3000）
  expect(pool.includes('官方解析') && pool.includes('3000'), '解析未完整渲染').toBe(true)
})

test('SEARCHINT-04 加入错题本走真实补录契约（非假按钮）', () => {
  const pool = readSrc('src/client/views/pool-view.tsx')
  expect(pool.includes('PoolAddWrongBtn'), '缺加入错题本组件').toBe(true)
  expect(pool.includes("api('/history/entries'"), '未走 /api/history/entries 真实补录').toBe(true)
  expect(pool.includes("result: 'wrong'"), '补录结果应为 wrong').toBe(true)
  expect(pool.includes('conflicts'), '幂等冲突未视为已加入').toBe(true)
  expect(pool.includes('加入错题本'), '缺按钮文案').toBe(true)
})

test('SEARCHINT-05 match 命中补 canonicalId（复用 PoolDetail 完整详情）', () => {
  const api = readSrc('src/server/imageSearchApi.ts')
  expect(api.includes('canonicalId: h.canonicalId'), 'match 未补 canonicalId').toBe(true)
  const pool = readSrc('src/client/views/pool-view.tsx')
  expect(pool.includes('canonicalId: h.canonicalId || h.id'), '图片命中未映射 canonicalId').toBe(true)
})
