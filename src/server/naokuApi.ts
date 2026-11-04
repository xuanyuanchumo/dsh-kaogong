/**
 * server/naokuApi.js — 深度标注题库 API（v1.7）
 *
 * 端点：
 *   GET  /api/naoku/status    题库状态（题数/标注覆盖率/模块分布）
 *   GET  /api/naoku/questions?module=&category=&kadian=&count=  带深度标注抽题
 *   GET  /api/naoku/kadian?q=  知识点检索（考什么+怎么想）
 *   GET  /api/naoku/practice?kadian=&count=  按知识点刷题
 *
 * 与 xingcezhenti 目录解析互补：Naoku 提供 kadian/reasoning/fastest/pitfalls 五维标注，
 * 是「方法论原生化」的数据基础；不可用时上层自动回落。
 */
import { initNaoku, resetNaoku, naokuReady, naokuStatus, naokuStats, naokuQuestions, searchKadian, questionsByKadian, papersByCategory, categoryList } from '../adapters/naoku.js'
import { safeImagePath } from '../adapters/naokuImage.js'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'

export { initNaoku, resetNaoku }

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

export function makeNaokuApi({ repoRoot, dataDir, store }) {
  const { loadProgress, saveProgress } = store

  /** 深度题库配图端点（二进制；DB 记 webp 磁盘为 png，由 resolveNaokuImage 换扩展名） */
  function serveImage(params, res) {
    const dec = (v) => { try { return decodeURIComponent(v || '') } catch { return v || '' } }
    const rel = dec(params.get('p'))
    if (!rel) { try { res.writeHead(400); res.end('bad request') } catch {} ; return }
    const target = safeImagePath(repoRoot, rel)
    if (!target) { try { res.writeHead(404); res.end('not found') } catch {} ; return }
    const ext = extname(target).toLowerCase()
    const mime = MIME[ext]
    if (!mime) { try { res.writeHead(415); res.end('unsupported') } catch {} ; return }
    let size = 0
    try { size = statSync(target).size; res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Cache-Control': 'public, max-age=86400' }) }
    catch { try { res.writeHead(500); res.end('stat error') } catch {} ; return }
    const st = createReadStream(target)
    st.on('error', () => { try { res.destroy() } catch {} })
    st.pipe(res)
  }

  function handleNaokuApi(path, params, post, method, wsRaw) {
    if (!path.startsWith('/api/naoku/')) return undefined

    if (path === '/api/naoku/status') {
      const st = naokuStats()
      return {
        ...naokuStatus(),
        stats: st,
        hint: st ? null : '深度题库不可用（Node < 22.19 无 node:sqlite，或 GongkaoNaoku 分片缺失）——已回落到目录题库',
      }
    }

    if (path === '/api/naoku/questions') {
      if (!naokuReady()) return { questions: [], fallback: true, hint: '深度题库未就绪' }
      const qs = naokuQuestions({
        module: params.get('module') || undefined,
        category: params.get('category') || undefined,
        kadian: params.get('kadian') || undefined,
        count: parseInt(params.get('count') || params.get('limit') || '1'),
        random: params.get('random') !== '0',
        repoRoot,
      })
      return { questions: qs, source: 'naoku', count: qs.length }
    }

    if (path === '/api/naoku/kadian') {
      if (!naokuReady()) return { list: [], fallback: true }
      const q = params.get('q') || ''
      return { keyword: q, list: q ? searchKadian(q, parseInt(params.get('limit') || '20')) : [] }
    }

    if (path === '/api/naoku/practice') {
      if (!naokuReady()) return { questions: [], fallback: true }
      const kadian = params.get('kadian') || ''
      const count = Math.min(20, parseInt(params.get('count') || '5'))
      const qs = kadian ? questionsByKadian(kadian, count, repoRoot) : naokuQuestions({ count, repoRoot })
      return { kadian, questions: qs, count: qs.length }
    }

    // T-019 考点→试卷反查
    if (path === '/api/naoku/papers') {
      if (!naokuReady()) return { papers: [], fallback: true }
      const cat = params.get('category') || ''
      return { category: cat, papers: cat ? papersByCategory(cat, parseInt(params.get('limit') || '40')) : [] }
    }

    // 考点清单
    if (path === '/api/naoku/categories') {
      if (!naokuReady()) return { list: [], fallback: true }
      return { list: categoryList(parseInt(params.get('limit') || '40')) }
    }

    return undefined
  }

  return { handle: handleNaokuApi, serveImage }
}
