/**
 * server/ws.js — 工作区隔离命名空间域（v1.3 复杂度拆分自 http.js）
 * slug + sha1 短哈希双段文件名：可读、防碰撞、跨项目零污染。
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

function safeReaddir(d) { try { return readdirSync(d) } catch { return [] } }

export function makeWsStore(progressDir) {
  function wsKey(raw) {
    const key = (raw && String(raw).trim()) || 'default'
    const slug = key.replace(/[^0-9A-Za-z\u4e00-\u9fa5_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(-40)
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 8)
    return `${slug || 'ws'}-${hash}`
  }
  function progressFile(raw) { return join(progressDir, `${wsKey(raw)}.json`) }
  function loadProgress(raw: any): any {
    try {
      const j = JSON.parse(readFileSync(progressFile(raw), 'utf-8'))
      if (j && typeof j === 'object') return { day: 1, answered: 0, correct: 0, wrong: 0, history: [], byModule: {}, ...j }
    } catch { /* 损坏文件走默认 */ }
    return { day: 1, answered: 0, correct: 0, wrong: 0, history: [], byModule: {} }
  }
  function saveProgress(raw: any, p: any): void {
    try { mkdirSync(progressDir, { recursive: true }); writeFileSync(progressFile(raw), JSON.stringify(p, null, 2)) } catch {}
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
      }).filter(Boolean).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))
    } catch { return [] }
  }
  return { wsKey, loadProgress, saveProgress, listWorkspaces }
}
export { existsSync }
