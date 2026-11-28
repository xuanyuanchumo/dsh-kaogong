/**
 * tests/smoke/img-search.test.mjs — 图片搜题域守卫（issue #4 阶段 4 · v1.36）
 *
 * 静态：manifest 声明（3 端点 + 视图）/ Host 注入 bridge / server 域装配 / 零宿主包 import。
 * 运行时：三端点契约——无模型诚实降级（本 harness 无 bridge）、analyze 校验、match 复用检索。
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupDomain } from '../_harness/server.mjs'

let h = null
const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')
const CX = 'PROJ_VTEST_IMGSEARCH'

beforeAll(async () => { h = await setupDomain({ ws: CX }) }, 60_000)
afterAll(async () => { if (h) await h.close() })

test('IMGSEARCH-01 manifest 三端点归 ui:pool，无独立 imgsearch 视图（并入统一检索区）', () => {
  const mf = readSrc('src/shared/manifest.ts')
  for (const p of ['/api/img-search/models', '/api/img-search/analyze', '/api/img-search/match']) {
    expect(mf.includes("path: '" + p + "'"), 'manifest 缺端点 ' + p).toBe(true)
  }
  // 用户反馈：图片搜题并入「统一题库 → 跨源统一检索」，不设独立视图
  expect(mf.includes("id: 'imgsearch'"), '仍残留独立 imgsearch 视图').toBe(false)
  expect(/path: '\/api\/img-search\/models'[^}]*consumers: \['ui:pool'\]/.test(mf), '端点消费方应为 ui:pool').toBe(true)
})

test('IMGSEARCH-02 Host 注入 AI bridge，server 层零宿主包 import（依赖反转）', () => {
  const host = readSrc('src/host/index.ts')
  expect(host.includes('createAiBridge') && host.includes('aiBridge'), 'Host 未注入 bridge').toBe(true)
  expect(/inject\s*=\s*\['tools',\s*'llm'\]/.test(host), 'inject 未含 llm').toBe(true)
  const apiSrc = readSrc('src/server/imageSearchApi.ts')
  const bridgeSrc = readSrc('src/host/ai-bridge.ts')
  // server 域不得 import 宿主包（零 npm 运行时依赖）；桥接只在 host 半用 duck typing
  expect(/from\s+['"]@deepseek-ai\//.test(apiSrc) || /from\s+['"]@deepseek-ai\//.test(bridgeSrc), '不应 import 宿主包').toBe(false)
  const http = readSrc('src/server/http.ts')
  expect(http.includes('makeImageSearchApi') && http.includes("name: 'imgsearch'"), 'server 未装配 imgsearch 域').toBe(true)
})

test('IMGSEARCH-03 无 bridge 时 models 诚实降级（不假装有 AI）', async () => {
  const r = await h.J('/api/img-search/models?ws=' + CX)
  // harness 未注入 bridge → ok:false / providers:[]（诚实降级，绝不 500）
  expect(r && typeof r === 'object').toBe(true)
  expect(r.ok === false ? Array.isArray(r.providers) && r.providers.length === 0 : Array.isArray(r.providers)).toBe(true)
})

test('IMGSEARCH-04 无 bridge 时 analyze 诚实降级（不假装有 AI，base64 校验由单测覆盖）', async () => {
  const bad = await h.PW('/api/img-search/analyze', { image: 'not base64!!', mediaType: 'image/png', kind: 'auto' })
  expect(bad.ok).toBe(false)
  // 无 bridge → unavailable()：degraded + hint（有模型配置引导），绝不 500、绝不假成功
  expect(bad.degraded).toBe(true)
  expect(typeof bad.hint).toBe('string')
})

test('IMGSEARCH-05 match 复用统一检索层（无抽取内容时拒绝，不臆造）', async () => {
  const r = await h.PW('/api/img-search/match', { extraction: { stem: '', chartData: '', figureFeatures: '', kind: 'auto', module: '' } })
  expect(r.ok).toBe(false)
  expect(Array.isArray(r.hits)).toBe(true)
  expect(r.hits.length).toBe(0)
})
