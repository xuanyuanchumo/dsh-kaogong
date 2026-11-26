/**
 * server/ws.js — 工作区隔离命名空间域（v1.3 复杂度拆分自 http.js）
 * slug + sha1 短哈希双段文件名：可读、防碰撞、跨项目零污染。
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

function safeReaddir(d: any) { try { return readdirSync(d) } catch { return [] } }

export function makeWsStore(progressDir: any) {
  function wsKey(raw: any) {
    const key = (raw && String(raw).trim()) || 'default'
    const slug = key.replace(/[^0-9A-Za-z\u4e00-\u9fa5_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(-40)
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 8)
    return `${slug || 'ws'}-${hash}`
  }
  function progressFile(raw: any) { return join(progressDir, `${wsKey(raw)}.json`) }
  function loadProgress(raw: any): any {
    try {
      const j = JSON.parse(readFileSync(progressFile(raw), 'utf-8'))
      if (j && typeof j === 'object') return { day: 1, answered: 0, correct: 0, wrong: 0, history: [], byModule: {}, ...j }
    } catch { /* 损坏文件走默认 */ }
    return { day: 1, answered: 0, correct: 0, wrong: 0, history: [], byModule: {} }
  }
  function saveProgress(raw: any, p: any): void {
    try { mkdirSync(progressDir, { recursive: true }); writeFileSync(progressFile(raw), JSON.stringify(p, null, 2)) } catch {}
    // cycle-60 管理数据双写：progress.json 仍是读侧权威，本步把错题/进度/补录等管理域
    // 镜像进 .kaogong.db 的 wrong_book / user_kv（ws 前缀隔离，rebuild 不清）。
    // 动态 import 避免模块加载期拉起 sqlite（node:sqlite 必须延迟加载——cycle-16 教训）；
    // 镜像失败静默，绝不拖垮判分/进度主链路。
    //
    // cycle-61 v9-b：改为**入队异步写**（enqueueUserWrite）。原因（重建压测实测）：
    // 重建时 worker 持写锁，主线程的同步镜像 INSERT 会在 busy_timeout 排队，
    // 把整条请求链（含 /api/status 信标）拖到秒级。镜像是可重放的账本，
    // 不需要在请求同步栈里完成 —— 入队即返回，写队列分片执行。
    try {
      const key = wsKey(raw)
      const snapshot = p
      void import('../adapters/poolDb.js')
        .then(m => { try { m.enqueueUserWrite(() => { try { m.mirrorProgressToDb(m.poolDb(), key, snapshot) } catch { /* 单次镜像失败静默 */ } }) } catch {} })
        .catch(() => {})
    } catch {}
  }
  function listWorkspaces() {
    try {
      mkdirSync(progressDir, { recursive: true })
      return safeReaddir(progressDir).filter(f => f.endsWith('.json')).map(f => {
        try {
          const p = JSON.parse(readFileSync(join(progressDir, f), 'utf-8'))
          const st = statSync(join(progressDir, f))
          if (!p || typeof p !== 'object') return null
          return { ns: f.replace(/\.json$/, ''), day: p.day, answered: p.answered, correct: p.correct,
            rate: p.answered ? Math.round((p.correct / p.answered) * 100) : 0, lastActive: st.mtimeMs, label: p.label || f.replace(/\.json$/, '') }
        } catch { return null }
      }).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))
    } catch { return [] }
  }
  return { wsKey, loadProgress, saveProgress, listWorkspaces }
}
export { existsSync }
