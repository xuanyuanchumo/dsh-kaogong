/**
 * tests/smoke/pool-freshness.test.mjs — cycle-60 数据新鲜度门守卫
 *
 * 换源前置的可机器判定信号的形态守卫（零 server）+ 运行时降级验证：
 *  · freshness 字段在 poolHealth 输出中；三指标 + ready + hint + sources；
 *  · ready 判定必须是 AND 三条件（cf 污染=0 ∧ schema≥6 ∧ 图推覆盖≥99%）；
 *  · 生产库实测刷新前 ready=false（诚实反映需要 rebuild，不假绿）。
 */
import { test, expect } from 'vitest'
import { setupDomain } from '../_harness/server.mjs'

test('C60-FRESH-01 freshness 门形态：三指标 + ready + hint + sources 判据', async () => {
  const h = await setupDomain({ ws: 'PROJ_FRESH_C60' })
  try {
    const st = await h.J('/api/pool/status?ws=PROJ_FRESH_C60')
    const fresh = st && st.health && st.health.freshness
    expect(!!fresh, 'freshness 未透出').toBe(true)
    expect(typeof fresh.ready).toBe('boolean')
    expect(fresh.cfPollutionRows).not.toBeNull()
    expect(fresh.tuxingKadianQuestions).not.toBeNull()
    expect(fresh.schemaVersion).not.toBeNull()
    expect(fresh.expectedTuxingKadian).toBe(1895)
    expect(fresh.expectedMinSchema).toBe(6)
    expect(Array.isArray(fresh.sources) || (fresh.sources && typeof fresh.sources === 'object')).toBe(true)
  } finally {
    await h.close()
  }
})

test('C60-FRESH-02 源码守卫：ready 三条件 AND + cf 判据 SQL', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync('src/server/poolObservability.ts', 'utf8')
  // ready 三条件（cycle-60 R3 外提为命名布尔，语义等价且更可读）
  expect(src.includes('const okCf = cfPollution === 0') && src.includes('const okSchema = (schemaNum ?? 0) >= 6') && src.includes('const okTuxing = tuxingKadian >= 1895 * 0.99')).toBe(true)
  expect(src.includes('ready: okCf && okSchema && okTuxing')).toBe(true)
  expect(src.includes("content_fp LIKE '20%-%T%'")).toBe(true)
  expect(src.includes("kadian LIKE '%图形推理%'")).toBe(true)
})

test('C60-FRESH-03 naoku 域收敛（cycle-62）：6 端点退役 → 只剩图片服务 + 3 语义下沉到池', async () => {
  const fs = await import('node:fs')
  const naoku = fs.readFileSync('src/server/naokuApi.ts', 'utf8')
  const poolApiSrc = fs.readFileSync('src/server/poolApi.ts', 'utf8')
  const reader = fs.readFileSync('src/server/poolNaoku.ts', 'utf8')
  const http = fs.readFileSync('src/server/http.ts', 'utf8')
  /**
   * cycle-62 端点收敛后，naoku 域只剩图片服务（/api/naoku-img）。
   * 原断言（ensureDomain 门 / sourceTier 计数 / 域工厂注入签名）随 handler 退役失去意义，
   * 改为断言**收敛后的正确形态**：
   */
  expect(/usePool\(\)/.test(naoku), '换源门形态复辟（v9 应只有单一读路径）').toBe(false)
  expect(/handleNaokuApi/.test(naoku), 'naoku API handler 应已删除（cycle-62 端点收敛）').toBe(false)
  expect(/sourceTier:/.test(naoku), 'naoku 域不应再有 sourceTier 判定（handler 已退役）').toBe(false)
  // 图片服务保留（媒体引用不是题目事实直读）
  expect(naoku.includes('function serveImage'), 'naoku-img 图片服务应保留').toBe(true)
  // 池读层仍是唯一数据源，口径不漂移
  expect(reader.includes('function ready()') && reader.includes("source_id='naoku'")).toBe(true)
  // 3 个 kadian 语义端点确实下沉到池端点文件
  for (const ep of ['/api/pool/kadians', '/api/pool/by-kadian', '/api/pool/papers-by-kadian']) {
    expect(poolApiSrc.includes(ep), `缺下沉端点 ${ep}`).toBe(true)
  }
  // http 层不再注入 poolNaoku / 不再注册 naoku handler
  expect(http.includes('naokuApi: makeNaokuApi({ repoRoot: root })'), 'naokuApi 注入应只剩 repoRoot（图片服务）').toBe(true)
  expect(/name: 'naoku', handle:/.test(http), 'naoku 域 handler 注册应已移除').toBe(false)
})

test('C60-FRESH-04 补录搜索（v9）：唯一通道 = 统一池，外源直读通道已删除', async () => {
  const fs = await import('node:fs')
  const histRaw = fs.readFileSync('src/server/historyApi.ts', 'utf8')
  // 去注释后判定（注释里会引用「已删除的旧通道」作为历史说明，不能当复辟证据）
  const hist = histRaw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  const http = fs.readFileSync('src/server/http.ts', 'utf8')
  // v9：naoku 直读与真题卷目录扫描两条通道**物理删除**（不是 Gate 跳过）
  expect(/naokuReady|searchQuestionsByStem/.test(hist), 'naoku 直读通道复辟').toBe(false)
  expect(/buildPaperIndex|loadPaper\(/.test(hist), '真题卷目录扫描通道复辟').toBe(false)
  // 池结果带出处溯源（question_source 的 paper/region/year/seq/path）
  expect(hist.includes('SELECT canonical_id, paper, region, year, seq, path FROM question_source')).toBe(true)
  expect(hist.includes("matchSource: 'pool'")).toBe(true)
  // 数据门从域工厂注入（唯一按需摄入入口）
  expect(http.includes('historyApi: makeHistoryApi({ store, repoRoot: root, dataCtx })')).toBe(true)
})