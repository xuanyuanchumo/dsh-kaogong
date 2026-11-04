/**
 * server/tuxingApi.ts — 图形推理专项 API（T-023 完整版）
 *
 * GET /api/tuxing/cats     分类清单（13 类规律 + 题量）
 * GET /api/tuxing/list?cat=&limit=&offset=  按规律抽题（含图片 URL）
 * GET /api/tuxing/q?id=    单题详情（完整解题思路/分析/陷阱）
 * GET /api/tuxing-img?p=   二进制图片
 */
import { tuxingReady, tuxingCats, tuxingQuestions, tuxingQuestion, serveTuxingImage } from '../adapters/tuxing.js'

export function makeTuxingApi({ repoRoot }: { repoRoot: string }) {
  function handleTuxingApi(path: string, params: URLSearchParams): any {
    if (!path.startsWith('/api/tuxing')) return undefined

    if (path === '/api/tuxing/cats') {
      const ready = tuxingReady(repoRoot)
      return { ready, total: ready ? tuxingCats(repoRoot).reduce((s: number, c: any) => s + c.count, 0) : 0, cats: ready ? tuxingCats(repoRoot) : [] }
    }

    if (path === '/api/tuxing/list') {
      if (!tuxingReady(repoRoot)) return { total: 0, questions: [], fallback: true, hint: 'gk-tuxing 数据缺失' }
      return tuxingQuestions(repoRoot, {
        cat: params.get('cat') || undefined,
        limit: parseInt(params.get('limit') || '10'),
        offset: parseInt(params.get('offset') || '0'),
      })
    }

    if (path === '/api/tuxing/q') {
      const id = params.get('id') || ''
      if (!id) return { error: '缺少 id' }
      return tuxingQuestion(repoRoot, id)
    }

    return undefined
  }

  function serveImage(params: URLSearchParams, res: any) {
    const dec = (v: string) => { try { return decodeURIComponent(v || '') } catch { return v || '' } }
    serveTuxingImage(repoRoot, dec(params.get('p') || ''), res)
  }

  return { handle: handleTuxingApi, serveImage }
}
