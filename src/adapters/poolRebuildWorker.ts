/**
 * adapters/poolRebuildWorker.ts — 重建 worker 线程入口（cycle-61 v9-b）
 *
 * ── 为什么必须有这个文件 ──
 *   旧实现把「清库 + 1683 卷 + 27506 题 + 57 万关系边」的重建直接放在宿主进程的
 *   异步函数里跑，而内部全是**同步** readFileSync / SQLite 调用 —— Node 单线程因此被
 *   独占数分钟，整个 DSH 宿主（所有插件、会话心跳、UI 请求）全部失去响应。
 *   用户报「重建时宿主功能失效、能力崩溃」就是这条。
 *
 *   把重建搬进 **worker 线程**后：
 *   · 主线程事件循环完全不受影响（宿主其余功能照常）；
 *   · worker 内部还能进一步分片让出（见 `chunkYield`，避免 worker 自己也被 watchdog 判定卡死）；
 *   · 进度经 `parentPort.postMessage` 实时回传 → 主线程作业状态 → `/api/pool/rebuild/status`。
 *
 * ── 隔离纪律 ──
 *   · worker 有**自己的模块实例与自己的 SQLite 连接**（不能跨线程共享 DatabaseSync）；
 *   · 因此本文件只做「拿到参数 → 调既有编排器」——不复制任何摄入逻辑；
 *   · 失败一律 postMessage 结构化结果（绝不 throw 到线程外，否则主线程只看到模糊的 ERR_WORKER）。
 *
 * ── 与主线程的事务边界 ──
 *   rebuildPool 在 worker 里开一个**长事务**（整库原子）。WAL 模式下主线程读者全程看到
 *   重建前的完整快照；重建提交后下一次读取自然切到新数据（无需重开连接）。
 */
import { parentPort, workerData } from 'node:worker_threads'

interface WorkerInput {
  repoRoot: string
  dataDir: string
  mode: 'full' | 'incremental'
  maxFiles?: number
  maxPapers?: number
}

/** 让出事件循环（worker 内部也分片，避免长同步段把 worker 自己的消息通道堵死） */
function chunkYield(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

async function main(): Promise<void> {
  const input = workerData as WorkerInput
  const post = (msg: any) => { try { parentPort && parentPort.postMessage(msg) } catch { /* 父线程已退出 */ } }
  const t0 = Date.now()
  post({ type: 'ready', at: t0 })
  try {
    // 动态 import：worker 启动即加载重模块会拖慢线程创建；且 node:sqlite 需延迟加载（旧 Node 兼容）
    const mod = await import('./poolIngest.js')
    await chunkYield()
    const onProgress = (p: any) => post({ type: 'progress', progress: p, at: Date.now() })
    const opts = { maxFiles: input.maxFiles, maxPapers: input.maxPapers, onProgress }
    const result = input.mode === 'incremental'
      ? await mod.incrementalRebuild(input.repoRoot, input.dataDir, opts)
      : await mod.rebuildPool(input.repoRoot, input.dataDir, { ...opts, rebuild: true })
    await chunkYield()
    post({ type: 'done', result, elapsedMs: Date.now() - t0 })
  } catch (e: any) {
    post({ type: 'failed', error: String((e && e.message) || e), elapsedMs: Date.now() - t0 })
  }
}

void main()
