/**
 * server/naokuApi.ts — 深度标注题库 API（v1.7 · v9 统一数据层改造）
 *
 * 端点：
 *   GET  /api/naoku/status    题库状态（题数/标注覆盖率/模块分布）
 *   GET  /api/naoku/questions?module=&category=&kadian=&count=  带深度标注抽题
 *   GET  /api/naoku/kadian?q=  知识点检索（考什么+怎么想）
 *   GET  /api/naoku/practice?kadian=&count=  按知识点刷题
 *   GET  /api/naoku/papers?category=&limit=   考点→试卷反查
 *   GET  /api/naoku/categories?limit=         考点清单
 *
 * ── v9 改造（统一数据层·消除外源直读）──
 *   旧实现：`isPoolFresh()` 为真才读 `.kaogong.db`，否则回落**直查 `.naoku.db`**。
 *   那条回落分支让「池未就绪」成为静默正常路径，运行期永远有一份外源直读代码在跑。
 *   v9 正解：**只有一条读路径**——读统一池；域未就绪时经 dataGate 触发该域摄入后重读，
 *   仍不可用则返回结构化未就绪（含可操作提示），**绝不直读 `.naoku.db`**。
 *
 *   兼容性硬约束（STORAGE-LAYER §8）：响应字段零删改——`sourceTier` 仍存在但恒为 'pool'
 *   （消费方按它做白盒展示），`fallback` 字段保留为 false（旧客户端读到 false 走正常渲染）。
 *
 *   深度题库数据在池内的口径：`source_id='naoku'`（出处表与主行都按此过滤）。
 */
import { safeImagePath } from '../adapters/naokuImage.js'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { ensureDomain } from './dataGate.js'
// v9：运行期**不再打开** `.naoku.db` 连接（它只在适配层摄入期作只读输入）。
// init/reset 仍 re-export 以保持既有调用面稳定（host 清理路径引用 resetNaoku）。
export { initNaoku, resetNaoku } from '../adapters/naoku.js'

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

/**
 * @param poolNaoku  统一池读层（poolNaoku.ts；唯一数据源）
 * @param dataCtx    { repoRoot, dataDir } —— 供 dataGate 按需摄入（不再用于直读）
 */
export function makeNaokuApi({ repoRoot, poolNaoku, dataCtx }: any) {
  /** 深度题库配图端点（二进制；DB 记 webp 磁盘为 png，由 resolveNaokuImage 换扩展名）
   *  ⚠️ 图片是**媒体引用**（L3 不做 BLOB 的既定决策），故仍按 rel_path 从数据根读取——
   *  这不属于「题目事实直读」，是「媒体文件按内容寻址取流」，与 I-DB-1 不冲突。 */
  function serveImage(params: any, res: any) {
    const dec = (v: any) => { try { return decodeURIComponent(v || '') } catch { return v || '' } }
    const rel = dec(params.get('p'))
    if (!rel) { try { res.writeHead(400); res.end('bad request') } catch {} ; return }
    const target = safeImagePath(repoRoot, rel)
    if (!target) { try { res.writeHead(404); res.end('not found') } catch {} ; return }
    const ext = extname(target).toLowerCase()
    const mime = (MIME as Record<string, any>)[ext]
    if (!mime) { try { res.writeHead(415); res.end('unsupported') } catch {} ; return }
    let size = 0
    try { size = statSync(target).size; res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Cache-Control': 'public, max-age=86400' }) }
    catch { try { res.writeHead(500); res.end('stat error') } catch {} ; return }
    const st = createReadStream(target)
    st.on('error', () => { try { res.destroy() } catch {} })
    st.pipe(res)
  }

  /**
   * 确保 pool 域就绪（按需摄入一次；后台模式返回「入库中」）。
   */
  async function ensure(): Promise<{ ready: boolean, hint?: string, ingesting?: boolean }> {
    const r = await ensureDomain('pool', dataCtx)
    return { ready: r.ready, hint: r.hint, ingesting: !!r.ingesting }
  }

  async function handleNaokuApi(path: any, params: any, post: any, method: any, wsRaw: any) {
    if (!path.startsWith('/api/naoku/')) return undefined

    // 未就绪的统一响应（结构化：缺什么、怎么办、是否正在入库——不制造死路）
    const notReady = (g?: { hint?: string, ingesting?: boolean }) => {
      const st = poolNaoku && poolNaoku.ready ? poolNaoku.ready() : false
      return {
        ready: false, fallback: true, ingesting: !!(g && g.ingesting),
        hint: (g && g.hint) || '深度题库数据尚未入库——请到「📦 题库管理」安装 GongkaoNaoku 后在「🗄️ 统一题库」重建',
        sourceTier: st ? 'pool' : 'none',
      }
    }

    if (path === '/api/naoku/status') {
      const ps = poolNaoku.status()
      if (ps) return { ...ps, stats: ps, hint: null, sourceTier: 'pool' }
      const g = await ensure()
      const ps2 = poolNaoku.status()
      if (ps2) return { ...ps2, stats: ps2, hint: null, sourceTier: 'pool' }
      return { ...notReady(g), stats: null }
    }

    if (path === '/api/naoku/questions') {
      const args = {
        module: params.get('module') || undefined,
        category: params.get('category') || undefined,
        kadian: params.get('kadian') || undefined,
        count: parseInt(params.get('count') || params.get('limit') || '1'),
        random: params.get('random') !== '0',
      }
      let qs = poolNaoku.questions(args)
      if (!qs.length) {
        const g = await ensure()
        qs = poolNaoku.questions(args)
        if (!qs.length) return { ...notReady(g), questions: [] }
      }
      return { questions: qs, source: 'naoku', count: qs.length, sourceTier: 'pool' }
    }

    if (path === '/api/naoku/kadian') {
      const q = params.get('q') || ''
      const limit = parseInt(params.get('limit') || '20')
      const list = q ? poolNaoku.kadian(q, limit) : []
      if (q && !list.length) {
        const g = await ensure()
        const list2 = poolNaoku.kadian(q, limit)
        if (!list2.length) return { ...notReady(g), keyword: q, list: [] }
        return { keyword: q, list: list2, sourceTier: 'pool' }
      }
      return { keyword: q, list, sourceTier: 'pool' }
    }

    if (path === '/api/naoku/practice') {
      const kadian = params.get('kadian') || ''
      const count = Math.min(20, parseInt(params.get('count') || '5'))
      let qs = poolNaoku.questions({ kadian: kadian || undefined, count })
      if (!qs.length) {
        const g = await ensure()
        qs = poolNaoku.questions({ kadian: kadian || undefined, count })
        if (!qs.length) return { ...notReady(g), kadian, questions: [] }
      }
      return { kadian, questions: qs, count: qs.length, sourceTier: 'pool' }
    }

    // T-019 考点→试卷反查
    if (path === '/api/naoku/papers') {
      const cat = params.get('category') || ''
      const limit = parseInt(params.get('limit') || '40')
      const papers = cat ? poolNaoku.papers(cat, limit) : []
      if (cat && !papers.length) {
        const g = await ensure()
        const papers2 = cat ? poolNaoku.papers(cat, limit) : []
        if (!papers2.length) return { ...notReady(g), category: cat, papers: [] }
        return { category: cat, papers: papers2, sourceTier: 'pool' }
      }
      return { category: cat, papers, sourceTier: 'pool' }
    }

    // 考点清单
    if (path === '/api/naoku/categories') {
      const limit = parseInt(params.get('limit') || '40')
      let list = poolNaoku.categories(limit)
      if (!list.length) {
        const g = await ensure()
        list = poolNaoku.categories(limit)
        if (!list.length) return { ...notReady(g), list: [] }
      }
      return { list, sourceTier: 'pool' }
    }

    return undefined
  }

  return { handle: handleNaokuApi, serveImage }
}
