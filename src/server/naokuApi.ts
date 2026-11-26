/**
 * server/naokuApi.ts — 深度题库**图片服务**（cycle-62 端点收敛后）
 *
 * ── 历史与收敛 ──
 * 本文件原提供 6 个端点：status / questions / kadian / practice / papers / categories。
 * v9 统一数据层改造后，这些端点的数据层已**完全是统一池**（`poolNaoku` 读层，
 * 绝不直读 `.naoku.db`）——于是形成「同一能力两套端点」的漂移面：
 * 能力对账要维护两份声明，消费方也无从判断该走哪一套。
 *
 * cycle-62 收敛（用户确认方案 A）：
 *   · 3 个「池没有等价能力」的语义**下沉为池端点**：
 *       /api/pool/kadians            ← 原 /api/naoku/kadian + /api/naoku/categories
 *       /api/pool/by-kadian          ← 原 /api/naoku/practice
 *       /api/pool/papers-by-kadian   ← 原 /api/naoku/papers
 *   · 抽题/状态原语本就由 /api/pool/questions + /api/pool/status 覆盖，不重复造；
 *   · **6 个 /api/naoku/* 端点整体退役**（能力矩阵 82 → 79 端点）。
 *
 * ── 为什么保留这个文件 ──
 * `/api/naoku-img` 是**图片二进制服务**，不属于「题目事实直读」：
 * 图片是媒体引用（L3 不做 BLOB 的既定决策），按 `rel_path` 从数据根取流，
 * 与 I-DB-1（题目事实只走池）不冲突。故 `serveImage` 保留，其余全部移除。
 */
import { safeImagePath } from '../adapters/naokuImage.js'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

/**
 * @param repoRoot 题库数据根（图片按 rel_path 从此读取）
 */
export function makeNaokuApi({ repoRoot }: any) {
  /** 深度题库配图端点（二进制；DB 记 webp 磁盘为 png，由 resolveNaokuImage 换扩展名） */
  function serveImage(params: any, res: any) {
    const dec = (v: any) => { try { return decodeURIComponent(v || '') } catch { return v || '' } }
    const rel = dec(params.get('p'))
    if (!rel) { try { res.writeHead(400); res.end('bad request') } catch { /* 响应已断开 */ } ; return }
    const target = safeImagePath(repoRoot, rel)
    if (!target) { try { res.writeHead(404); res.end('not found') } catch { /* 响应已断开 */ } ; return }
    const ext = extname(target).toLowerCase()
    const mime = (MIME as Record<string, any>)[ext]
    if (!mime) { try { res.writeHead(415); res.end('unsupported') } catch { /* 响应已断开 */ } ; return }
    let size = 0
    try { size = statSync(target).size; res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Cache-Control': 'public, max-age=86400' }) }
    catch { try { res.writeHead(500); res.end('stat error') } catch { /* 响应已断开 */ } ; return }
    const st = createReadStream(target)
    st.on('error', () => { try { res.destroy() } catch { /* 流已销毁 */ } })
    st.pipe(res)
  }

  return { serveImage }
}
