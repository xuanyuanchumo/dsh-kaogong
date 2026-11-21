/**
 * client/hooks.ts — 自定义 hooks（cycle-48 阶段 2 · 取数模式复用抽取）
 *
 * 背景：10 处「cancelled + try/catch + setLoading(false)」取数模式散在 5 个视图，
 * 形态一致但各自手写——提取为 useApiData / useApiMany 两个 hook，消除重复并统一
 * 取数语义（错误收敛 {error} / cancelled 防御 / 早退在 hooks 后）。
 *
 * ⚠️ React 纪律（C24-06）：全组合唯一 require('react') 在 ui-kit——本模块经
 * `import { React } from './ui-kit.js'` 获取（combo factory 闭包可见）。
 * ⚠️ 兼容纪律：现有视图保持手写形态不动（工作正常），本 hooks 供**新增代码与新拆
 * 子组件**使用；迁移逐视图进行（每批走 npm run test:all 全量兜底）。
 */
import { React } from './ui-kit.js'

/**
 * 单端点取数 hook（cancelled 防御 + error 收敛）。
 *
 * @param fetcher 视图标准接口 api（视图自治取数纪律——api 由宿主注入）
 * @param path    请求路径（含查询串；为 null 时不取数——条件取数场景）
 * @param deps    依赖数组（路径变化/刷新令牌参与依赖——教训「永久 spinner」）
 * @param opt     label（错误消息前缀）/ fallbackNull（请求失败时 data 置 null 而非进 err）
 */
export function useApiData(fetcher: (p: string, opts?: any) => Promise<any>, path: string | null, deps: any[], opt?: { label?: string, fallbackNull?: boolean }) {
  const [data, setData] = React.useState(null)
  const [loading, setLoading] = React.useState(!!path)
  const [err, setErr] = React.useState('')
  React.useEffect(() => {
    if (!path) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setErr('')
    ;(async () => {
      try {
        const d = await fetcher(path)
        if (cancelled) return
        if (d && d.error) { setErr(String(d.error)); setData(null) }
        else { setData(d); setErr('') }
      } catch (e: any) {
        if (!cancelled) {
          if (opt?.fallbackNull) setData(null)
          else setErr(String((e && e.message) || e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [path, ...deps])
  return { data, loading, err, setErr }
}

/**
 * 多端点并行取数 hook（Promise.all 形态——plan-view 双源先例）。
 * 每个条目可独立声明 fallbackNull（弱依赖端点失败不阻塞页面）。
 */
export function useApiMany(fetcher: (p: string, opts?: any) => Promise<any>,
  paths: Array<{ key: string, path: string, fallbackNull?: boolean }>, deps: any[]) {
  const [data, setData] = React.useState(null)
  const [loading, setLoading] = React.useState(paths.some(p => p.path))
  const [err, setErr] = React.useState('')
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const results = await Promise.all(paths.map(p =>
          fetcher(p.path).catch(() => null)))
        if (cancelled) return
        const next: Record<string, any> = {}
        let firstErr = ''
        paths.forEach((p, i) => {
          const d = results[i]
          if (d && d.error) { if (!firstErr) firstErr = String(d.error); return }
          if (!d && !p.fallbackNull) { if (!firstErr) firstErr = p.key + ' 请求失败'; return }
          next[p.key] = d
        })
        setData(next)
        setErr(firstErr)
      } catch (e: any) {
        if (!cancelled) setErr(String((e && e.message) || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, deps)
  return { data, loading, err }
}
