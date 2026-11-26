/**
 * server/tuxingApi.ts — 图形推理专项 API（T-023 完整版 · v9 统一数据层）
 *
 * GET /api/tuxing/cats     分类清单（13 类规律 + 题量）
 * GET /api/tuxing/list?cat=&limit=&offset=  按规律抽题（含图片 URL）
 * GET /api/tuxing/q?id=    单题详情（完整解题思路/分析/陷阱）
 * GET /api/tuxing-img?p=   二进制图片（媒体按内容寻址引用取流，非题目事实直读）
 *
 * ── v9 改造（消除外源直读）──
 *   旧实现：`isPoolFresh() ∧ 池内有 gk-tuxing 题` 才读池，否则**直读 data.js**。
 *   v9：唯一读路径 = 统一池（`source_extras` 无损保留上游 acc/trap/fmt/g/cat 全部字段）；
 *   域未就绪时经 dataGate 按需摄入后重读，仍不可用则返回结构化未就绪。
 *
 *   字段零丢失的根据（cycle-60 T-038）：摄入期把**完整上游对象**写进
 *   `question.source_extras`，因此 cat 代码/陷阱/加速度等派生列装不下的字段全部可还原。
 */
import { serveTuxingImage } from '../adapters/tuxing.js'
import { ensureDomain } from './dataGate.js'

export function makeTuxingApi({ repoRoot, poolTuxing, dataCtx }: { repoRoot: string, poolTuxing?: any, dataCtx?: { repoRoot: string, dataDir: string } }) {
  /** 就绪提示（可操作；不制造死路） */
  const HINT = '图形推理专项数据尚未入库——请到「📦 题库管理」安装 gk-tuxing 后在「🗄️ 统一题库」重建'

  async function ensure(): Promise<{ hint?: string, ingesting?: boolean } | undefined> {
    const ctx = dataCtx || { repoRoot, dataDir: '' }
    const r = await ensureDomain('tuxing', ctx)
    if (r.ready) return undefined
    return { ingesting: !!r.ingesting, hint: r.hint || HINT }
  }
  const notReady = (g: { hint?: string, ingesting?: boolean } | undefined) => ({
    ready: false, fallback: true, ingesting: !!(g && g.ingesting),
    hint: (g && g.hint) || HINT, sourceTier: 'none',
  })

  async function handleTuxingApi(path: string, params: URLSearchParams): Promise<any> {
    if (!path.startsWith('/api/tuxing')) return undefined
    const tReady = (): boolean => !!(poolTuxing && typeof poolTuxing.ready === 'function' && poolTuxing.ready())

    if (path === '/api/tuxing/cats') {
      let cs = poolTuxing.cats()
      if (!cs.length && !tReady()) {
        const g = await ensure()
        cs = poolTuxing.cats()
        if (!cs.length) return { ...notReady(g), total: 0, cats: [] }
      }
      return { ready: true, total: cs.reduce((s: number, c: any) => s + c.count, 0), cats: cs, sourceTier: 'pool' }
    }

    if (path === '/api/tuxing/list') {
      const args = {
        cat: params.get('cat') || undefined,
        limit: parseInt(params.get('limit') || '10'),
        offset: parseInt(params.get('offset') || '0'),
      }
      let out = poolTuxing.questions(args)
      if (!out.questions.length) {
        const g = await ensure()
        out = poolTuxing.questions(args)
        if (!out.questions.length) return { ...notReady(g), ...out }
      }
      return { ...out, sourceTier: 'pool' }
    }

    if (path === '/api/tuxing/q') {
      const id = params.get('id') || ''
      if (!id) return { error: '缺少 id' }
      let q = poolTuxing.question(id)
      if (!q || q.error) {
        const g = await ensure()
        q = poolTuxing.question(id)
        if (!q || q.error) return { ...notReady(g), ...(q || {}) }
      }
      return { ...q, sourceTier: 'pool' }
    }

    return undefined
  }

  function serveImage(params: URLSearchParams, res: any) {
    const dec = (v: string) => { try { return decodeURIComponent(v || '') } catch { return v || '' } }
    serveTuxingImage(repoRoot, dec(params.get('p') || ''), res)
  }

  return { handle: handleTuxingApi, serveImage }
}
