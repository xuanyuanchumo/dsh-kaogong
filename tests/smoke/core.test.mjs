/**
 * tests/smoke/core.test.mjs — 基础设施域（cycle-47 阶段 9 迁移）
 *
 * 从 smoke.test.mjs §0-§3/§9 迁移：
 *   · §0 构建产物新鲜度门（T-022：dist >= src，逐文件 mtime 对账）
 *   · §2 信标自描述（status.app/pid/uptime/port）
 *   · §3 adopt 复用（二次启动同端口、不崩、不新绑）
 *   · §9 能力矩阵（工具 6 个唯一 + 方法论检索工具 + 端点≥14 + 双入口 + 双通道）
 *
 * 判定逐字等价；新鲜度门在 vitest 内同样先于一切断言（T-022 纪律）。
 * 运行：npx vitest run tests/smoke/core.test.mjs
 */
import { test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTestServer, closeTestServer } from '../_harness/server.mjs'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
let base = null
let port = null

beforeAll(async () => {
  const s = await getTestServer()
  base = s.base
  port = Number(s.port)
}, 60_000)

afterAll(async () => {
  await closeTestServer()
})

test('§0 构建产物新鲜度（T-022：dist 必须不旧于 src）', () => {
  const pairs = []
  ;(function walk(dir, rel) {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + name.name : name.name
      if (name.isDirectory()) { walk(path.join(dir, name.name), r); continue }
      if (name.name.endsWith('.ts')) pairs.push(r.replace(/\.ts$/, '.js'))
    }
  })(path.join(REPO, 'src'), '')
  const stale = []
  for (const rel of pairs) {
    const srcUrl = path.join(REPO, 'src', rel.replace(/\.js$/, '.ts'))
    const distUrl = path.join(REPO, 'dist', rel)
    if (!fs.existsSync(distUrl)) { stale.push(rel + '（产物缺失）'); continue }
    if (fs.statSync(distUrl).mtimeMs < fs.statSync(srcUrl).mtimeMs - 1000) stale.push(rel + '（产物过期）')
  }
  expect(stale, '过期/缺失产物').toEqual([])
})

test('§2 信标自描述（status.app/pid/uptime/port）', async () => {
  const st = await (await fetch(`${base}/api/status?ws=PROJ_VTEST_CORE`)).json()
  expect(st.app).toBe('dsh-kaogong')
  expect(st.pid > 0 && st.uptimeSec >= 0 && st.port === port).toBe(true)
})

test('§3 adopt 复用：二次启动同端口、adopted=true（不崩不新绑）', async () => {
  const { startServer } = await import('../../dist/server/http.js')
  const second = await startServer(+(process.env.KG_PORT || 8495), { publishRuntime: false, prewarm: false })
  expect(second.port === port && second.adopted === true).toBe(true)
  if (second.server) { try { second.server.close() } catch { /* adopt 无自有句柄 */ } }
})

test('§9 能力矩阵：工具 6 个唯一 + 方法论检索工具 + 端点≥14 + 双入口 + 双通道', async () => {
  const caps = await (await fetch(`${base}/api/capabilities`)).json()
  const toolNames = (caps.tools || []).map(t => t && t.name)
  expect(toolNames.length).toBe(6)
  expect(new Set(toolNames).size).toBe(6)
  expect(toolNames.indexOf('kaogong_ai_method')).toBeGreaterThanOrEqual(0)
  expect(['kaogong_ai_tutor', 'kaogong_ai_plan', 'kaogong_ai_shenlun', 'kaogong_ai_essay_review']
    .every(n => toolNames.indexOf(n) >= 0)).toBe(true)
  expect(caps.endpoints?.length).toBeGreaterThanOrEqual(14)
  expect(caps.entries?.length === 2 && caps.entries.some(e => e.kind === 'left-immersive') && caps.entries.some(e => e.kind === 'right-docked')).toBe(true)
  expect(caps.channels?.length === 2 && caps.channels.find(c => c.id === 'same-origin')?.preferred === true).toBe(true)
})
