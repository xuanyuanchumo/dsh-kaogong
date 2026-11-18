/**
 * server/telemetry.ts — 遥测域（cycle-34 复杂度预算治理外提）
 *
 * ── 为什么外提（cycle-13 教训① 的固定拆法）──
 *   `http.ts` 引入统一题目池域后复杂度达 **201 > 预算 180**（band-detector 热点 #1）。
 *   沿用项目既有拆法：**只读纯函数外提 + 闭包值同名参数穿线**——
 *   本文件承载「遥测记录与快照」这一自洽单元（记录 → 分位 → 快照 → 告警），
 *   `http.ts` 侧只保留调用点，**函数体逐语义等价**（不做行为改动）。
 *
 * ── 边界纪律 ──
 *   · 只读 + 进程内状态（不碰文件系统、不碰数据库）；
 *   · 未声明端点只进 `__unmatched__` 聚合桶（不进端点对账表——cycle-18 ㉗）；
 *   · UI 壳路径（'/' 与 '/index.html'）不进对账（cycle-19 ㉞）；
 *   · 告警阈值与排序**稳定可复现**（同输入两次输出深相等）。
 */

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/** 单端点统计（环形延迟样本 + 计数） */
export interface EpStat { count: number; errors: number; lat: number[]; lastTs?: number }

/** 未声明端点的聚合桶键（不进端点对账表，避免永久「影子端点」） */
export const UNMATCHED_BUCKET = '__unmatched__'

/** 延迟环形样本上限 */
const LAT_RING = 100

/** 遥测状态（进程内；由 createTelemetry 持有） */
export interface TelemetryState {
  endpoints: Record<string, EpStat>
  requests: number[]
  window: number
}

/** 创建独立的遥测状态（便于测试隔离；避免模块级可变状态跨 fiber 残留——教训 R7） */
export function createTelemetry(): TelemetryState {
  return { endpoints: {}, requests: [], window: 60_000 }
}

/**
 * 是否为已声明端点。
 * 非 /api/* 路径（UI/静态）不参与端点对账，一律视为 matched；
 * UI 壳路径（'/' 与 '/index.html'）同样不进对账——它们是页面壳而非能力端点。
 */
export function isDeclaredEndpoint(path: any, declaredSet: Set<string>): boolean {
  const p = String(path || '')
  if (p === '/' || p === '/index.html') return true
  if (!p.startsWith('/api/')) return true
  return declaredSet.has(p)
}

/** 记录一次请求（计数 + 延迟样本 + 时间戳窗口） */
export function recordRequest(telemetry: TelemetryState, path: any, ms: any, isError: any, declared?: boolean): void {
  const key = declared === false ? UNMATCHED_BUCKET : path
  const t = (telemetry.endpoints[key] = telemetry.endpoints[key] || { count: 0, errors: 0, lat: [] })
  t.count++
  if (isError) t.errors++
  t.lat.push(Math.round(ms))
  if (t.lat.length > LAT_RING) t.lat.shift()
  t.lastTs = Date.now()
  telemetry.requests.push(t.lastTs)
  if (telemetry.requests.length > 1000) telemetry.requests.shift()
}

/** 有序统计分位（输入须已排序） */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/**
 * 遥测快照（端点表 + 全局直方图 + 慢端点排行 + 告警）。
 *
 * @param telemetry 遥测状态
 * @param declaredCount 已声明端点数（能力矩阵长度）——口径与 manifest 同源
 * @param bootTs 进程启动时间戳（uptimeSec 基准）
 */
export function telemetrySnapshot(telemetry: TelemetryState, declaredCount: number, bootTs: number): any {
  const now = Date.now()
  const inWindow = telemetry.requests.filter(ts => now - ts < telemetry.window).length
  const eps: any = {}
  let unmatchedCount = 0, unmatchedErrors = 0
  for (const [path, t] of entries(telemetry.endpoints)) {
    // 未声明端点的请求只进聚合桶，不混入端点对账表（否则会成为永久「影子端点」）
    if (path === UNMATCHED_BUCKET) { unmatchedCount = t.count; unmatchedErrors = t.errors; continue }
    const sorted = [...t.lat].sort((a, b) => a - b)
    eps[path] = {
      count: t.count, errors: t.errors,
      errRate: t.count ? +(t.errors / t.count).toFixed(3) : 0,
      p50: percentile(sorted, 50), p95: percentile(sorted, 95),
      lastActive: t.lastTs ? Math.round((now - t.lastTs) / 1000) : null,
      series: t.lat,
    }
  }
  const totalReq: number = (Object.values(eps) as any[]).reduce((s: number, e: any) => s + e.count, 0)
  const totalErr: number = (Object.values(eps) as any[]).reduce((s: number, e: any) => s + e.errors, 0)

  // ── 全局延迟直方图（各端点最新环形样本合并，有序统计）──
  const allLat: number[] = []
  for (const t of Object.values(telemetry.endpoints) as EpStat[]) allLat.push(...t.lat)
  allLat.sort((a, b) => a - b)
  const histogram = {
    p50: percentile(allLat, 50), p90: percentile(allLat, 90),
    p95: percentile(allLat, 95), p99: percentile(allLat, 99),
    max: allLat.length ? allLat[allLat.length - 1] : 0,
  }

  // ── 慢端点排行（p95 降序 → count 降序 → path 字典序，稳定可复现）──
  const topSlow = entries(eps)
    .filter(([path]) => !path.includes('-img')) // 二进制流不计入慢端点排名
    .map(([path, e]: [string, any]) => ({ path, p95: e.p95, count: e.count }))
    .sort((a, b) => b.p95 - a.p95 || b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, 10)

  // ── 告警（契约阈值 p95>200 warn / >500 error / errRate>1% warn）──
  const alerts: any[] = []
  for (const [path, e] of entries(eps) as Array<[string, any]>) {
    if (e.p95 > 500) alerts.push({ level: 'error', msg: `${path} p95 ${e.p95}ms 超过 500ms` })
    else if (e.p95 > 200) alerts.push({ level: 'warn', msg: `${path} p95 ${e.p95}ms 超过 200ms` })
    if (e.count > 0 && e.errors / e.count > 0.01) {
      alerts.push({ level: 'warn', msg: `${path} 错误率 ${(e.errors / e.count * 100).toFixed(1)}% 超过 1%` })
    }
  }
  if (totalReq > 0 && totalErr / totalReq > 0.01) {
    alerts.push({ level: 'warn', msg: `全局错误率 ${(totalErr / totalReq * 100).toFixed(1)}% 超过 1%` })
  }
  // 命中未声明端点的请求（拼错/扫描器/旧客户端）——有量就提示，但不进端点表
  if (unmatchedCount > 0) {
    alerts.push({ level: 'info', msg: `有 ${unmatchedCount} 次请求命中未声明端点（已聚合，未计入端点对账）` })
  }
  // 稳定排序：error 在前，同级按消息字典序（避免 telemetry 插入序导致抖动）
  alerts.sort((a, b) => (a.level === b.level
    ? (a.msg < b.msg ? -1 : a.msg > b.msg ? 1 : 0)
    : (a.level === 'error' ? -1 : 1)))

  return {
    uptimeSec: Math.round((now - bootTs) / 1000),
    qpsWindow: +(inWindow / (telemetry.window / 1000)).toFixed(3),
    totalRequests: totalReq,
    endpoints: eps,
    activeEndpoints: Object.keys(eps).length,
    declaredEndpoints: declaredCount,
    coverage: +(Object.keys(eps).length / declaredCount).toFixed(3),
    histogram,
    topSlow,
    alerts,
    // 未声明端点请求的可观测余量（不含具体路径，避免影子端点回流；
    // 有计数就说明「有人在打不存在的 API」——这个信号本身必须保留）
    unmatched: { count: unmatchedCount, errors: unmatchedErrors },
  }
}
