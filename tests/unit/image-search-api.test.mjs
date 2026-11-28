/**
 * image-search-api.test.mjs — 图片搜题域单测（issue #4 阶段 4）
 *
 * 用 mock AiBridge 验证三端点契约，无需真实宿主服务：
 *  · parseExtraction 稳健解析（JSON 围栏 / 噪声 / 非法）
 *  · extractionQuery 分题型拼检索词
 *  · models / analyze / match 的行为与降级
 */
import { test, expect } from 'vitest'
import { makeImageSearchApi, parseExtraction, extractionQuery } from '../../dist/server/imageSearchApi.js'

const OK_BRIDGE = () => ({
  listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
  listModels: async () => [{ id: 'vision-pro', name: 'Vision Pro', inputModalities: ['text', 'image'] }],
  analyze: async () => JSON.stringify({
    stem: '从所给四个选项中选出规律', chartData: '', figureFeatures: '元素位置平移', module: '判断推理', kind: 'tuxing',
  }),
})

const post = (p, o = {}) => new URLSearchParams()

test('IMGAPI-01 parseExtraction 容忍 ```json 围栏与前后噪声', () => {
  const raw = '好的，结果如下：\n```json\n{"stem":"题干","chartData":"","figureFeatures":"面数量递增","module":"判断推理","kind":"tuxing"}\n```\n希望有帮助'
  const ex = parseExtraction(raw)
  expect(ex).toBeTruthy()
  expect(ex.stem).toBe('题干')
  expect(ex.figureFeatures).toBe('面数量递增')
  expect(ex.kind).toBe('tuxing')
})

test('IMGAPI-02 parseExtraction 非法输出返回 null（不臆造）', () => {
  expect(parseExtraction('')).toBe(null)
  expect(parseExtraction('没有 JSON')).toBe(null)
  expect(parseExtraction('{"stem": broken}')).toBe(null)
})

test('IMGAPI-03 extractionQuery 图推优先规律特征、资料优先图表数据', () => {
  const base = { stem: '题干', chartData: '120,130', figureFeatures: '位置平移', module: '', kind: 'tuxing' }
  expect(extractionQuery(base)).toContain('位置平移')
  expect(extractionQuery({ ...base, kind: 'ziliao' })).toContain('120,130')
})

test('IMGAPI-04 models：无 bridge 诚实降级（不假装有 AI）', async () => {
  const api = makeImageSearchApi(null, { search: async () => ({ results: [] }) })
  const r = await api.handle('/api/img-search/models', post(), {}, 'GET')
  expect(r.ok).toBe(false)
  expect(r.providers).toEqual([])
})

test('IMGAPI-05 models：返回 bridge 的 provider 清单', async () => {
  const api = makeImageSearchApi(OK_BRIDGE(), { search: async () => ({ results: [] }) })
  const r = await api.handle('/api/img-search/models', post(), {}, 'GET')
  expect(r.ok).toBe(true)
  expect(r.providers[0].id).toBe('deepseek-official')
})

test('IMGAPI-06 analyze：base64 校验 + 结构化抽取', async () => {
  const api = makeImageSearchApi(OK_BRIDGE(), { search: async () => ({ results: [] }) })
  const good = await api.handle('/api/img-search/analyze', post(), {
    image: Buffer.from('fake-png').toString('base64'), mediaType: 'image/png', kind: 'tuxing',
    provider: 'deepseek-official', model: 'vision-pro',
  }, 'POST')
  expect(good.ok).toBe(true)
  expect(good.extraction.kind).toBe('tuxing')
  expect(good.extraction.figureFeatures).toContain('平移')

  const bad = await api.handle('/api/img-search/analyze', post(), { image: 'not base64!!', mediaType: 'image/png' }, 'POST')
  expect(bad.ok).toBe(false)
})

test('IMGAPI-07 match：复用统一检索信封，截断到 limit', async () => {
  let seenQuery = ''
  const api = makeImageSearchApi(null, {
    search: async (q) => {
      seenQuery = q
      return { results: Array.from({ length: 20 }, (_, i) => ({ id: 'q' + i })), total: 20, groups: [] }
    },
  })
  const r = await api.handle('/api/img-search/match', post(), {
    extraction: { stem: '增长率', figureFeatures: '', chartData: '', kind: 'auto', module: '' }, limit: 5,
  }, 'POST')
  expect(r.ok).toBe(true)
  expect(r.hits.length).toBe(5)
  expect(r.total).toBe(20)
  expect(seenQuery).toContain('增长率')
})
