/**
 * tests/_harness/server.mjs — 分域测试共享设施（cycle-47 测试体系重构 · 阶段 1）
 *
 * 背景：smoke.test.mjs 单文件 2581 行 / 478 断言 / 86 域组——「大单文件测试」反模式。
 * 本目录把跨域共享的设施（server 启动 / fetch 客户端 / 断言收集）抽为可导入单元，
 * 各域测试文件只 import 自己需要的设施，物理上不再互相耦合。
 *
 * 纪律（迁移期间双轨）：
 *   · 新域测试文件用本 harness（vitest 形态）；
 *   · 旧 smoke.test.mjs 保持原样直到对应域迁移完成，两者并行期间 npm run test:all 全量兜底。
 *
 * 三层隔离纪律（继承 loader.test BL-SEC-01）：
 *   · 端口段隔离：KG_TEST_PORT_BASE（默认 8495，避开宿主 8400-8404）
 *   · publishRuntime: false（不写真相信标）
 *   · prewarm: false（不与断言争抢缓存热身——cycle-14 教训⑦）
 */
import { startServer } from '../../dist/server/http.js'

/** 共享 server 单例（跨域文件复用同一实例——vitest 每文件 fork，单例即文件内单例） */
let _server = null
let _base = null

/**
 * 启动（或复用）测试 server。返回 { base, port, server }。
 * @param {number} portBase 端口段起点（默认 8495）
 */
export async function getTestServer(portBase = +(process.env.KG_PORT || 8495)) {
  if (_server && _base) return { base: _base, port: new URL(_base).port, server: _server }
  const { server, port } = await startServer(portBase, { publishRuntime: false, prewarm: false })
  _server = server
  _base = `http://127.0.0.1:${port}`
  return { base: _base, port, server }
}

/** 关闭共享 server（测试文件 afterEach/afterAll 调用；幂等） */
export async function closeTestServer() {
  if (_server) { try { _server.close() } catch { /* 已关闭 */ } }
  _server = null
  _base = null
}

/** GET JSON（带竞态重试——git spawn/端口回收窗口，继承 smoke J 的容错语义） */
export async function J(base, u, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(base + u); return r.json() }
    catch (e) {
      if (i === tries - 1) throw e
      await new Promise(r => setTimeout(r, 300 + i * 300))
    }
  }
}

/** POST JSON */
export async function P(base, u, body) {
  const r = await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

/** 池就绪自检（空/未建时小样本重建——cycle-41 纪律：不假设上游时序） */
export async function ensurePoolReady(base) {
  try {
    const st = await (await fetch(`${base}/api/pool/status`)).json()
    if (st.ready && st.stats && st.stats.questions) return true
    const rb = await (await fetch(`${base}/api/pool/rebuild`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'full', async: false, maxFiles: 30, maxPapers: 30 }),
    })).json()
    console.log('[harness] 池重建:', rb.ok ? 'ok q=' + (rb.stats ? rb.stats.questions : '?') : 'FAIL ' + (rb.error || '').slice(0, 80))
    return !!rb.ok
  } catch (e) { console.log('[harness] 池自检跳过:', String(e).slice(0, 60)); return false }
}

/**
 * 清理测试命名空间的 progress 文件（cycle-47 阶段 2：分域文件测前自清理）。
 *
 * 背景（HIST-02 假红实证）：progress json 持久化在用户数据根，分域测试重跑时
 * 上一轮的 importedSigs 台账残留 → 补录幂等闸误判「此前已补录」→ accepted=0。
 * 旧 smoke 有全量清理段（PROJ_ 前缀），分域文件各自负责自己的 ws。
 *
 * @param {string} ws 测试命名空间（如 PROJ_VTEST_HIST）
 */
export async function clearProgressNamespace(ws) {
  try {
    const { PROGRESS_DIR_USER } = await import('../../dist/server/dataRoot.js')
    const fs = await import('node:fs')
    const dir = PROGRESS_DIR_USER
    if (!fs.existsSync(dir)) return 0
    let removed = 0
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(ws)) { fs.rmSync(dir + '/' + f); removed++ }
    }
    return removed
  } catch (e) { console.log('[harness] 清理跳过:', String(e).slice(0, 60)); return 0 }
}
