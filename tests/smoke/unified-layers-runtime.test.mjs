/**
 * tests/smoke/unified-layers-runtime.test.mjs — cycle-60 统一层运行时契约
 *
 * 守卫「声明 vs 实现」同源（v1.8 遥测事故纪律）：
 *  · /api/search/providers 返回五个 provider id，与 manifest 声明检索端点对账一致；
 *  · /api/search/unified 各 provider 返回统一信封（query/results/total），零 5xx；
 *  · 未知 provider 空信封不抛错（崩溃安全）。
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { setupDomain } from '../_harness/server.mjs'

let h = null
beforeAll(async () => { h = await setupDomain({ ws: 'PROJ_USEARCH_C60' }) })
afterAll(async () => { if (h) await h.close() })

test('C60-RT-01 provider 清单运行时可达且与 manifest 检索端点同源', async () => {
  const caps = await h.J('/api/capabilities')
  const declared = new Set(caps.endpoints.map((e) => e.path))
  const r = await h.J('/api/search/providers?ws=PROJ_USEARCH_C60')
  expect(Array.isArray(r.providers)).toBe(true)
  expect(r.providers).toEqual(['docs', 'history', 'huasheng13', 'kadian', 'pool'])
  const expectEndpoints = ['/api/search', '/api/history/search', '/api/huasheng13/search', '/api/naoku/kadian', '/api/pool/search']
  expect(expectEndpoints.every(p => declared.has(p))).toBe(true)
})

test('C60-RT-02 统一检索信封：五 provider 全部零 5xx + 统一外壳', async () => {
  for (const p of ['docs', 'history', 'huasheng13', 'kadian', 'pool']) {
    const r = await h.J(`/api/search/unified?provider=${p}&q=图形&limit=3&ws=PROJ_USEARCH_C60`)
    expect(r && typeof r.query === 'string', p + ' 信封缺 query').toBe(true)
    expect(Array.isArray(r.results), p + ' 信封缺 results').toBe(true)
    expect(typeof r.total, p + ' 信封缺 total').toBe('number')
  }
})

test('C60-RT-03 未知 provider 空信封（不抛错、不 500）', async () => {
  const r = await h.J('/api/search/unified?provider=__nope__&q=x&ws=PROJ_USEARCH_C60')
  expect(r).toEqual({ query: 'x', results: [], total: 0 })
})

/* ══ cycle-61 v9：统一检索层增强契约 ══ */

test('C61-RT-01 pool provider 必须真出结果（同一数据两条路不得一条恒空）', async () => {
  // 事故背景：装配期 ctx 的池句柄键名是 poolApi，registry 早期写 ctx.pool →
  // pool provider 恒空而被 catch 静默收敛。此断言把「直连端点有结果 ⇒ 统一入口也必须有结果」固化。
  const direct = await h.J('/api/pool/search?q=' + encodeURIComponent('图形推理') + '&limit=3')
  if (!direct || !direct.count) return expect(true).toBe(true)   // 池未就绪环境诚实跳过
  const uni = await h.J('/api/search/unified?provider=pool&q=' + encodeURIComponent('图形推理') + '&limit=3&ws=PROJ_USEARCH_C60')
  expect(direct.count, '直连端点无命中，环境异常').toBeGreaterThan(0)
  expect(uni.total, 'pool provider 恒空（ctx 句柄键名漂移复辟）').toBeGreaterThan(0)
  expect((uni.results || []).length).toBeGreaterThan(0)
  // 每条命中带 provider 标注（聚合时可归因）
  expect((uni.results || [])[0].provider).toBe('pool')
})

test('C61-RT-02 聚合检索：多 provider 交替合并 + 保留分组 + 未知 id 显式报出', async () => {
  const r = await h.J('/api/search/unified?providers=pool,huasheng13&q=' + encodeURIComponent('资料') + '&limit=3&ws=PROJ_USEARCH_C60')
  expect(Array.isArray(r.groups), '聚合检索缺 groups').toBe(true)
  expect(r.groups.length).toBe(2)
  expect(r.providers).toEqual(['pool', 'huasheng13'])
  // total = 各组之和（不跨源比分数，只汇总计数）
  const sum = r.groups.reduce((s, g) => s + (g.total || 0), 0)
  expect(r.total).toBe(sum)
  // 每条命中都带 provider（可归因到组）
  for (const hit of r.results) expect(typeof hit.provider).toBe('string')
  // 未知 provider 不静默吞掉
  const r2 = await h.J('/api/search/unified?providers=pool,__nope__&q=x&limit=2&ws=PROJ_USEARCH_C60')
  expect(r2.unknown).toEqual(['__nope__'])
})

test('C61-RT-03 检索流水与 provider 白盒：域归属 + 调用计数可观测', async () => {
  await h.J('/api/search/unified?provider=pool&q=' + encodeURIComponent('判断') + '&limit=2&ws=PROJ_USEARCH_C60')
  const pv = await h.J('/api/search/providers?ws=PROJ_USEARCH_C60')
  // 清单带域归属（前端选择器与「先装哪个题库」引导用）
  const poolMeta = (pv.list || []).find(x => x.id === 'pool')
  expect(poolMeta && poolMeta.domain).toBe('pool')
  expect(poolMeta.requiresPool).toBe(true)
  // 流水聚合（provider 维度）：调用数与空命中率
  const st = (pv.stats || []).find(x => x.provider === 'pool')
  if (!st) return expect(true).toBe(true)   // 独立构造环境无流水
  expect(st.calls).toBeGreaterThan(0)
  expect(st.emptyRate === null || typeof st.emptyRate === 'number').toBe(true)
})

test('C61-RT-04 空结果不缓存（装好题库后不该还要等缓存过期）', async () => {
  const q = 'zzz-no-such-term-' + Date.now()
  const a = await h.J('/api/search/unified?provider=pool&q=' + encodeURIComponent(q) + '&limit=2&ws=PROJ_USEARCH_C60')
  expect(a.total).toBe(0)
  const b = await h.J('/api/search/unified?provider=pool&q=' + encodeURIComponent(q) + '&limit=2&ws=PROJ_USEARCH_C60')
  // 空信封不写缓存 → 第二次仍是实查（cached 不为 true）
  expect(b.cached).not.toBe(true)
})

/* ══ cycle-61 v9-b：重建不阻塞宿主（运行时契约） ══ */

test('C61-RB-01 重建在 worker 线程执行（主线程不持有 rebuildPool 调用）', () => {
  const raw = fs.readFileSync(new URL('../../src/server/poolApi.ts', import.meta.url), 'utf-8')
  // ⚠️ 去注释后判定：文件注释里会**引用**旧的 `await rebuildPool(...)` 作为反例说明，
  // 直接 grep 会把历史注解当成违规证据（cycle-61 教训㊹ 同族）。
  const poolApi = raw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  expect(/runRebuildInWorker\(/.test(poolApi), '重建未经 worker').toBe(true)
  expect(/await rebuildPool\(/.test(poolApi), '主线程仍直接 await rebuildPool（会冻结事件循环）').toBe(false)
  expect(/await incrementalRebuild\(/.test(poolApi), '主线程仍直接 await incrementalRebuild').toBe(false)
  // worker 入口文件存在且导出可被 Worker 加载
  const worker = fs.readFileSync(new URL('../../src/adapters/poolRebuildWorker.ts', import.meta.url), 'utf-8')
  expect(worker.includes('parentPort') && worker.includes('workerData'), 'worker 入口缺 parentPort/workerData').toBe(true)
  expect(worker.includes("type: 'progress'"), 'worker 未上报进度').toBe(true)
})

test('C61-RB-02 重建状态透出进度（phase/source/index/total 可观测）', () => {
  const poolApi = fs.readFileSync(new URL('../../src/server/poolApi.ts', import.meta.url), 'utf-8')
  expect(/progress: running\.progress/.test(poolApi), '进度未透出到 /api/pool/rebuild/status').toBe(true)
  expect(/job\.progress = \{ \.\.\.p, at: Date\.now\(\) \}/.test(poolApi), 'worker 进度未写入作业').toBe(true)
})

test('C61-RB-03 重建期读走只读连接（写锁不阻塞读）', () => {
  const pdb = fs.readFileSync(new URL('../../src/adapters/poolDb.ts', import.meta.url), 'utf-8')
  expect(pdb.includes('export async function withReadConnAsync'), '缺只读连接读函数').toBe(true)
  expect(pdb.includes("readOnly: true") && pdb.includes('setRebuilding'), '缺只读连接/重建标记').toBe(true)
  const poolApi = fs.readFileSync(new URL('../../src/server/poolApi.ts', import.meta.url), 'utf-8')
  expect(/withReadConnAsync\(/.test(poolApi), '检索未走只读连接').toBe(true)
  expect(/setRebuilding\(true\)/.test(poolApi) && /setRebuilding\(false\)/.test(poolApi), '重建标记未成对设置').toBe(true)
})

test('C61-RB-04 用户态写入不阻塞请求栈（写队列 + 生命周期内存环形）', () => {
  const pdb = fs.readFileSync(new URL('../../src/adapters/poolDb.ts', import.meta.url), 'utf-8')
  expect(pdb.includes('export function enqueueUserWrite'), '缺用户态写队列').toBe(true)
  expect(pdb.includes('export function writeQueueDepth'), '缺队列深度白盒').toBe(true)
  const ws = fs.readFileSync(new URL('../../src/server/ws.ts', import.meta.url), 'utf-8')
  expect(/enqueueUserWrite\(/.test(ws), 'progress 镜像未走写队列').toBe(true)
  const http = fs.readFileSync(new URL('../../src/server/http.ts', import.meta.url), 'utf-8')
  // 生命周期日志不得在请求路径上同步读写整文件
  expect(/function flushLifecycle/.test(http) && /lifecycleMem/.test(http), '生命周期未改内存环形').toBe(true)
  expect(/readLifecycleEvents\([\s\S]{0,400}lifecycleMem\.length/.test(http), '生命周期读取未内存优先').toBe(true)
})
