/**
 * tests/smoke/img.test.mjs — 图片链路域（cycle-47 阶段 7 迁移）
 *
 * 从 smoke.test.mjs IMG22/C23 段迁移：naoku 适配器占位化静态守卫 + 深度题库
 * 跨模块抽题 kgimg 占位运行时 + /api/kg-img 占位服务（含扩展名探测回退）+ 403/404 越级防线。
 * 环境降级三态保留（naoku 未就绪 → 跳过不假红——旧文件同语义）。
 * 判定逐字等价。
 *
  * 旧 ID 对照：SMOKE-IMG-02（RichText 渲染）/03（双通道分流）/05（占位服务）
 * 运行：npx vitest run tests/smoke/img.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupDomain } from '../_harness/server.mjs'

let h = null
const readSrc = (p) => fs.readFileSync(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url), 'utf8')
const CX = 'PROJ_VTEST_IMG'

beforeAll(async () => {
  h = await setupDomain({ ws: CX })
}, 60_000)

afterAll(async () => {
  if (h) await h.close()
})

test('SMOKE-IMG22-01 naoku 适配器占位化：stripHtmlKeepImg 覆盖 stem/options/analysis', () => {
  const nkSrc = readSrc('src/adapters/naoku.ts')
  expect(nkSrc.includes('stripHtmlKeepImg') && nkSrc.includes('neutralizeImages') && nkSrc.includes('kgimg://')).toBe(true)
})

test('SMOKE-IMG22-02 manifest 补登记 /api/kg-img（能力对账闭环）', () => {
  expect(readSrc('src/shared/manifest.ts').includes("path: '/api/kg-img'")).toBe(true)
})

test('SMOKE-C23-01/02 naoku material 字段链路 + img_refs 追加移除（静态）', () => {
  const nkSrc23 = readSrc('src/adapters/naoku.ts')
  expect(nkSrc23.includes('material,material_ref') && nkSrc23.includes('material: materialText')).toBe(true)
  expect(!nkSrc23.includes('imageMarkdown') && !nkSrc23.includes('+ imageMarkdown') && !nkSrc23.includes('imgMarkdown')).toBe(true)
})

test('SMOKE-C23-04 material 与 stem 字段分离（服务端不拼接，UI 组装）', () => {
  const nkSrc23 = readSrc('src/adapters/naoku.ts')
  expect(nkSrc23.includes('stem: stemText') && !nkSrc23.includes('materialText + NL + stemText')).toBe(true)
})

test('SMOKE-C23-03 深度题库资料分析抽题带材料字段（覆盖率 ≥80%）', async () => {
  const nk22 = await h.J('/api/naoku/status')
  if (!nk22.ready) return expect(true).toBe(true)  // 环境降级三态（旧文件同语义）
  let matN = 0, zlTotal = 0
  for (const mod of ['资料分析', '言语理解与表达']) {
    const d23 = await h.J(`/api/naoku/questions?module=${encodeURIComponent(mod)}&count=6&ws=${CX}`)
    for (const q of (d23.questions || [])) {
      if (mod === '资料分析') { zlTotal++; if (q.material) matN++ }
    }
  }
  expect(zlTotal).toBeGreaterThan(0)
  expect(matN / zlTotal, `资料分析 ${matN}/${zlTotal} 带材料`).toBeGreaterThanOrEqual(0.8)
})

test('SMOKE-IMG22-03 深度题库跨模块抽题：解析含 kgimg:// 占位（公式图/题图不再丢失）', async () => {
  const nk22 = await h.J('/api/naoku/status')
  if (!nk22.ready) return expect(true).toBe(true)
  let anaImg = 0, qN = 0
  for (const mod of ['资料分析', '数量关系', '判断推理']) {
    const d = await h.J(`/api/naoku/questions?module=${encodeURIComponent(mod)}&count=8&ws=${CX}`)
    for (const q of (d.questions || [])) {
      qN++
      if (String(q.analysis || '').includes('kgimg://')) anaImg++
      // stem/options 占位链路同守卫（旧文件同段语义）
      expect(typeof q.stem).toBe('string')
    }
  }
  expect(qN).toBeGreaterThan(0)
  expect(anaImg, `跨模块 ${qN} 题解析含占位 ${anaImg} 题（>0 即链路存活）`).toBeGreaterThan(0)
})

test('SMOKE-IMG22-04 /api/kg-img 解析内联占位服务 200 且为图片 MIME（扩展名探测回退）', async () => {
  const nk22 = await h.J('/api/naoku/status')
  if (!nk22.ready) return expect(true).toBe(true)
  let rel = null
  for (let i = 0; i < 4 && !rel; i++) {
    const d = await h.J(`/api/naoku/questions?module=资料分析&count=8&ws=${CX}`)
    for (const q of (d.questions || [])) {
      const m = String(q.analysis || '').match(/kgimg:\/\/([^\]】]+)】/)
      if (m) { rel = m[1]; break }
    }
  }
  if (!rel) return expect(true).toBe(true)  // 本轮抽样未命中含图解析（旧文件同语义跳过）
  const img = await fetch(`${h.base}/api/kg-img?p=${encodeURIComponent(rel)}&ws=${CX}`)
  expect(img.status).toBe(200)
  expect(/^image\//.test(img.headers.get('content-type') || ''),
    `type=${img.headers.get('content-type')} rel=${String(rel).slice(0, 50)}`).toBe(true)
})

test('SMOKE-IMG-06 越级路径 403/404 防线（绝不出包）', async () => {
  const bad = await fetch(`${h.base}/api/kg-img?p=${encodeURIComponent('../../etc/passwd')}&ws=${CX}`)
  expect([403, 404]).toContain(bad.status)
})

test('SMOKE-IMG-01/02/03 题图占位链路静态守卫（repoData 占位化 + RichText 渲染 + 双通道分流）', () => {
  const rdSrc = readSrc('src/adapters/repoData.ts')
  expect(rdSrc.includes('kgimg://') && rdSrc.includes('neutralizeImages')).toBe(true)
  // client bundle（combo）必须含 kgimg 渲染链路（RichText → /api/kg-img?p= 绝对 URL）
  const bundlePath = new URL('../../dist/client/client.js', import.meta.url)
  const ukSrc = fs.readFileSync(bundlePath, 'utf-8')
  expect(ukSrc.includes('/api/kg-img?p=') && ukSrc.includes('kgimg://')).toBe(true)
  // 双通道分流：同源 attachWebRoute + 独立端口 buildHttpServer 两处
  const httpSrc = readSrc('src/server/http.ts')
  expect(httpSrc.split("'/api/kg-img'").length >= 3).toBe(true)
})

test('SMOKE-IMG-04 存储层供数带图能力：池抽题带图 ≥ 配额下限（确定性 L1 配额 ⌈10/2⌉=5）', async () => {
  const poolImgQ = await h.J(`/api/pool/questions?module=判断推理&count=10&ws=${CX}`)
  const poolImgHit = (poolImgQ.questions || []).filter(r => String(r.stem || '').includes('kgimg://')).length
  expect(poolImgHit >= 5, `池抽 10 题含图 ${poolImgHit} 题（配额下限 5）`).toBe(true)
})

test('SMOKE-IMG-04b 目录解析路径带图能力（回落路径保留，随机抽题不假红）+ IMG-05 占位服务可达', async () => {
  // 跨 5 模块各抽 6 题（图形推理/资料分析含图率高，单模块随机会漏）——qTotal>0 即回落路径存活
  let withImgTotal = 0, qTotal = 0
  for (const mod of ['判断推理', '资料分析', '数量关系', '言语理解与表达', '常识判断']) {
    const qs = await h.J(`/api/questions?module=${encodeURIComponent(mod)}&count=6&ws=${CX}`)
    qTotal += (qs.questions || []).length
    withImgTotal += (qs.questions || []).filter(q => String(q.stem || '').includes('kgimg://')).length
  }
  expect(qTotal > 0, `抽 ${qTotal} 题（含图 ${withImgTotal} 题随源分布）`).toBe(true)
  // IMG-05：占位路径经 /api/kg-img 服务真实可达（旧文件 withImgTotal 条件分支语义）
  if (withImgTotal) {
    const qs2 = await h.J(`/api/questions?module=资料分析&count=6&ws=${CX}`)
    const first = (qs2.questions || []).concat((await h.J(`/api/questions?module=判断推理&count=6&ws=${CX}`)).questions || [])
      .find(q => String(q.stem || '').includes('kgimg://'))
    const rel = first && String(first.stem).match(/kgimg:\/\/([^\]】]+)】/)?.[1]
    if (rel) {
      const img = await fetch(`${h.base}/api/kg-img?p=${encodeURIComponent(rel)}&ws=${CX}`)
      expect(img.status === 200 && /^image\//.test(img.headers.get('content-type') || ''),
        `status=${img.status} type=${img.headers.get('content-type')}`).toBe(true)
    }
  }
})
