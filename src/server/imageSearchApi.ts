/**
 * server/imageSearchApi.ts — 图片搜题域（issue #4 阶段 4 · v1.36）
 *
 * ── 职责 ──
 * 把用户上传的题目图片交给宿主 LLM 结构化抽取，再复用既有统一检索层匹配原题。
 * 本域是**唯一**触碰 ctx.llm / ctx.attachments 的地方，通过构造注入的 aiBridge 拿到能力，
 * 不 import 任何宿主包（保持零 npm 运行时依赖），也不污染其它域。
 *
 * ── 三端点 ──
 *   GET  /api/img-search/models              可用 provider + model 清单（模型自选 UI）
 *   POST /api/img-search/analyze {image,mediaType,kind,provider,model}
 *        → attachments.admitPromptContent 持久化图片 → llm.stream 结构化抽取
 *        → { ok, extraction:{stem,chartData,figureFeatures,module,kind}, tookMs }
 *   POST /api/img-search/match {extraction,limit,ws}
 *        → 复用 domains.searchRegistry / poolApi 检索 → { ok, hits:[...] }
 *
 * ── 依赖反转 ──
 * aiBridge = { listProviders(), listModels(p), analyze(opts) }，由 Host 半 apply(ctx) 装配。
 * 这样 server 层可独立测试（注入 mock bridge），无需真实宿主服务（符合薄入口原则）。
 *
 * ── 安全 ──
 * · 图片 base64 只经 attachments 持久化，绝不落插件数据根、绝不进日志。
 * · provider/model 必须来自 listProviders/listModels 白名单，绝不信任客户端透传的任意值。
 * · 抽取输出按 JSON schema 强约束 + 容错解析；失败一律结构化降级，绝不抛穿宿主。
 */
import { IMAGE_MIME } from '../shared/media.js'

/** AI 能力桥（由 Host 半注入；server 层零宿主包依赖） */
export interface AiBridge {
  /** 列出已注册 provider（{id,name}[]） */
  listProviders(): Array<{ id: string; name?: string }>
  /** 列出某 provider 的模型（{id,name?,inputModalities?}[]） */
  listModels(provider: string): Promise<Array<{ id: string; name?: string; inputModalities?: string[] }>>
  /**
   * 图片结构化抽取：桥接 attachments.admitPromptContent + llm.stream。
   * @returns 模型可见文本（JSON 字符串，含 stem/chartData/figureFeatures/module/kind）
   */
  analyze(opts: {
    imageBase64: string
    mediaType: string
    kind: 'ziliao' | 'tuxing' | 'auto'
    provider: string
    model: string
    hint?: string
  }): Promise<string>
}

/** 抽取结果（结构化输出契约） */
export interface ImageExtraction {
  stem: string
  chartData: string
  figureFeatures: string
  module: string
  kind: 'ziliao' | 'tuxing' | 'auto'
}

const KINDS = new Set(['ziliao', 'tuxing', 'auto'])
const MAX_IMAGE_BYTES = 8 * 1024 * 1024   // 8MB 上传上限（附件服务还有自身限额，双重防线）
const BASE64_RE = /^[A-Za-z0-9+/=\r\n]+$/

/** 从模型输出里稳健提取 JSON（容忍 ```json 围栏与前后噪声）——只裁尾不臆造（教训㉜） */
export function parseExtraction(raw: string): ImageExtraction | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: any
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const s = (v: any) => typeof v === 'string' ? v.trim() : ''
  return {
    stem: s(obj.stem),
    chartData: s(obj.chartData),
    figureFeatures: s(obj.figureFeatures),
    module: s(obj.module),
    kind: KINDS.has(obj.kind) ? obj.kind : 'auto',
  }
}

/** 把抽取结果拼成检索 query（资料分析优先题干+图表数据；图推优先规律特征） */
export function extractionQuery(ex: ImageExtraction): string {
  const parts: string[] = []
  if (ex.stem) parts.push(ex.stem.slice(0, 200))
  if (ex.kind === 'tuxing' && ex.figureFeatures) parts.push(ex.figureFeatures.slice(0, 300))
  if (ex.kind === 'ziliao' && ex.chartData) parts.push(ex.chartData.slice(0, 300))
  if (!parts.length && ex.figureFeatures) parts.push(ex.figureFeatures.slice(0, 300))
  return parts.join(' ').trim()
}

export function makeImageSearchApi(bridge: AiBridge | null, deps: {
  /**
   * 统一检索（复用 domains.searchRegistry.searchMany —— 跨源 round-robin，不合并打分）。
   * @returns 含 results[] 的信封（与 /api/search/unified 同形）。
   */
  search(q: string, opts: { limit: number; provider?: string; ws?: string }): Promise<{ results?: any[]; groups?: any[]; total?: number; took?: number }>
}) {
  /** 模型未配置时的诚实降级（不假装有 AI） */
  const unavailable = () => ({
    ok: false as const,
    degraded: true,
    hint: '宿主未配置模型服务，图片搜题不可用。请在 DSH 设置中配置模型后重试；其余离线功能不受影响。',
  })

  async function handle(path: string, params: URLSearchParams, post: any, method: string, wsRaw?: string): Promise<any> {
    // GET /api/img-search/models
    if (path === '/api/img-search/models' && method === 'GET') {
      if (!bridge) return { ok: false, providers: [] }
      try {
        const providers = bridge.listProviders().map(p => ({ id: p.id, name: p.name || p.id }))
        return { ok: true, providers }
      } catch (e) {
        return { ok: false, providers: [], error: (e as Error).message }
      }
    }

    // GET /api/img-search/models?provider=x → 该 provider 的模型（走 POST 便于前端一次拉取）
    if (path === '/api/img-search/models' && method === 'POST') {
      if (!bridge) return { ok: false, models: [] }
      try {
        const provider = String((post && post.provider) || '')
        if (!provider) return { ok: false, models: [], error: '缺少 provider' }
        const all = bridge.listProviders().map(p => p.id)
        if (!all.includes(provider)) return { ok: false, models: [], error: '未注册的 provider' }
        const models = await bridge.listModels(provider)
        return { ok: true, models: models.map(m => ({ id: m.id, name: m.name || m.id, vision: !!m.inputModalities?.includes('image') })) }
      } catch (e) {
        return { ok: false, models: [], error: (e as Error).message }
      }
    }

    // POST /api/img-search/analyze
    if (path === '/api/img-search/analyze' && method === 'POST') {
      if (!bridge) return unavailable()
      const t0 = Date.now()
      const image = String((post && post.image) || '')
      const mediaType = String((post && post.mediaType) || '')
      const kindRaw = String((post && post.kind) || 'auto')
      const kind = KINDS.has(kindRaw) ? kindRaw as ImageExtraction['kind'] : 'auto'
      const provider = String((post && post.provider) || '')
      const model = String((post && post.model) || '')
      if (!image || !BASE64_RE.test(image)) return { ok: false, error: '图片数据无效（需 base64）' }
      if (Buffer.byteLength(image, 'utf8') > MAX_IMAGE_BYTES) return { ok: false, error: '图片过大（上限 8MB）' }
      // MIME 白名单：客户端声明的 mediaType 必须是我们认识的类型
      const mimeOk = Object.values(IMAGE_MIME).includes(mediaType)
      if (!mimeOk) return { ok: false, error: '不支持的图片类型' }
      // provider/model 白名单（兑现本文件安全契约：绝不信任客户端透传的任意值）
      if (!provider || !bridge.listProviders().some(p => p.id === provider)) {
        return { ok: false, error: '未注册的 provider' }
      }
      try {
        const models = await bridge.listModels(provider)
        if (!model || !models.some(m => m.id === model)) {
          return { ok: false, error: '该 provider 下未注册此 model' }
        }
      } catch (e) {
        return { ok: false, error: '模型清单校验失败：' + (e as Error).message }
      }
      try {
        const raw = await bridge.analyze({ imageBase64: image, mediaType, kind, provider, model, hint: (post && post.hint) || undefined })
        const extraction = parseExtraction(raw)
        // 不回显原始模型输出：它可能含 OCR 出的题目文本，泄露到客户端日志/网络面板无必要
        if (!extraction) return { ok: false, error: '模型输出无法解析为结构化结果（输出长度 ' + raw.length + '）' }
        return { ok: true, extraction, tookMs: Date.now() - t0 }
      } catch (e) {
        return { ok: false, error: (e as Error).message, tookMs: Date.now() - t0 }
      }
    }

    // POST /api/img-search/match
    if (path === '/api/img-search/match' && method === 'POST') {
      const ex = (post && post.extraction) || {}
      const extraction: ImageExtraction = {
        stem: String(ex.stem || ''), chartData: String(ex.chartData || ''),
        figureFeatures: String(ex.figureFeatures || ''),
        module: String(ex.module || ''), kind: KINDS.has(ex.kind) ? ex.kind : 'auto',
      }
      const q = extractionQuery(extraction)
      if (!q) return { ok: false, hits: [], error: '抽取结果为空，无可检索内容' }
      const limit = Math.min(30, Math.max(1, Number((post && post.limit) || 10)))
      try {
        const env = await deps.search(q, { limit, provider: (post && post.provider) || undefined, ws: wsRaw })
        const rows = (env && env.results) || []
        const hits = Array.isArray(rows) ? rows.slice(0, limit) : []
        return { ok: true, query: q, hits, total: (env && env.total) || hits.length, groups: (env && env.groups) || [] }
      } catch (e) {
        return { ok: false, hits: [], error: (e as Error).message }
      }
    }
    return undefined
  }

  return { handle }
}
