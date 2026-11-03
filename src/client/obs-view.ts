/**
 * obs-view.ts — NativeObsView 白盒管理/可观测面板（cycle-13 T-025 从 client.ts 拆出）
 */
import { h, React, Stat, Bar, Card, Sparkline, stageColor, alertColor, G_BTN, G_BTN_ON, G_TAG } from './ui-kit.js'

    /* ═══════════════════════════════════════════════════════════════════════
       NativeObsView — 白盒管理/可观测面板（v1.8.0 重做）
       契约 §4 覆盖：A 学习质量 · B 运行态 · C 生命周期 stepper · D 能力对账
                    · E 慢端点 TOP · F 告警 · G 命名空间 · H 管理动作
       设计原则：
       ① 所有接口字段都视为「可选」——端点未就绪/字段缺失一律降级为空态，绝不抛错；
       ② 表格默认 p95 降序（性能问题第一屏可见），可点表头切换排序方向；
       ③ sparkline 用内联 SVG polyline（零依赖、无 hook、无副作用）；
       ④ 事件一律 onClick 驼峰（R6 事故）；hook 全部在组件顶部、数量恒定（R9）。
       ═══════════════════════════════════════════════════════════════════════ */

    export function NativeObsView(props) {
      const data: any = (props && props.data) || {}
      const tel: any = data.tel || {}
      const caps: any = data.caps || {}
      const life: any = data.life || null
      const wsList: any[] = Array.isArray(data.workspaces) ? data.workspaces : (Array.isArray(data.wsList) ? data.wsList : [])

      /* ── hooks：全部在顶部声明，跨渲染数量恒定（R9） ── */
      const [sortKey, setSortKey] = React.useState('p95')     // p95 | count | p50 | errRate | path
      const [sortAsc, setSortAsc] = React.useState(false)
      const [filter, setFilter] = React.useState('')
      const [onlyProblems, setOnlyProblems] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [lastAt, setLastAt] = React.useState(null)

      const ins: any = (props && props.insight) || {}
      const eps: any = tel.endpoints || {}
      const consumed = new Set(Object.keys(eps))
      const declared: any[] = Array.isArray(caps.endpoints) ? caps.endpoints : []
      const recon: any = caps.reconciliation || {}
      const orphanEndpoints = new Set(Array.isArray(recon.orphanEndpoints) ? recon.orphanEndpoints : [])
      const unconsumedEndpoints = new Set(Array.isArray(recon.unconsumedEndpoints) ? recon.unconsumedEndpoints : [])

      /* ── 行数据：声明端点 ∪ 运行态端点（并集，暴露「未声明」影子端点） ── */
      const rows: any[] = React.useMemo(() => {
        const out: any[] = []
        for (const d of declared) {
          const p = String(d.path || '')
          const r: any = eps[p] || {}
          out.push({
            path: p, label: String(d.label || ''), consumers: Array.isArray(d.consumers) ? d.consumers : [],
            count: r.count || 0, errors: r.errors || 0,
            errRate: typeof r.errRate === 'number' ? r.errRate : 0,
            p50: r.p50 || 0, p95: r.p95 || 0, series: r.series || [],
            active: consumed.has(p), orphan: orphanEndpoints.has(p), undeclared: false,
          })
        }
        // 运行态出现但 manifest 未登记的端点 = 绕过单一事实源的调用（白盒断裂证据）
        for (const p of Object.keys(eps)) {
          if (declared.some(d => String(d.path) === p)) continue
          const r: any = eps[p] || {}
          out.push({
            path: p, label: '未在 manifest 声明', consumers: [],
            count: r.count || 0, errors: r.errors || 0, errRate: r.errRate || 0,
            p50: r.p50 || 0, p95: r.p95 || 0, series: r.series || [],
            active: true, orphan: false, undeclared: true,
          })
        }
        return out
      }, [declared, eps, orphanEndpoints, consumed])

      /* ── 过滤 + 排序（表格视图） ── */
      const viewRows: any[] = React.useMemo(() => {
        let list = rows
        const q = String(filter || '').trim().toLowerCase()
        if (q) list = list.filter(r => (r.path + ' ' + r.label).toLowerCase().includes(q))
        // 「问题」= 真实被调用过且慢/有错误，或绕过 manifest 的未声明端点。
        // 从未被调用的端点 p95=0 属于「未触达」，不是性能问题（否则 40+ 端点全算问题）。
        if (onlyProblems) list = list.filter(r => r.undeclared || (r.count > 0 && (r.p95 > 200 || r.errRate > 0.01)))
        const dir = sortAsc ? 1 : -1
        const copy = [...list]
        copy.sort((a, b) => {
          if (sortKey === 'path') return (sortAsc ? 1 : 1) * (a.path < b.path ? 1 : a.path > b.path ? -1 : 0)
          return dir * (((a[sortKey] || 0) - (b[sortKey] || 0)) || 0)
        })
        return copy
      }, [rows, filter, onlyProblems, sortKey, sortAsc])

      const hist: any = tel.histogram || {}
      const alertsRows: any[] = Array.isArray(tel.alerts) ? tel.alerts : []
      const topSlow: any[] = Array.isArray(tel.topSlow) ? tel.topSlow : []
      const stages: any[] = Array.isArray(life && life.stages) ? life.stages : []
      const lifeEvents: any[] = Array.isArray(life && life.events) ? life.events.slice(-12).reverse() : []

      const essayAvg = (ins.essay && ins.essay.avgRatio) || 0
      const examAvg = (ins.exam && ins.exam.avgRate) || 0
      const essayN = (ins.essay && ins.essay.total) || 0
      const examN = (ins.exam && ins.exam.total) || 0

      const coverage = typeof tel.coverage === 'number' ? tel.coverage : (declared.length ? Object.keys(eps).length / declared.length : 0)
      const problemCount = rows.filter(r => r.undeclared || (r.count > 0 && (r.p95 > 200 || r.errRate > 0.01))).length
      const maxP95 = Math.max.apply(null, [1].concat(rows.map(r => r.p95 || 0)))

      const th: any = { textAlign: 'left', padding: '7px 8px', fontSize: 11, color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(148,163,184,.3)' }
      const thSort: any = { ...th, cursor: 'pointer', userSelect: 'none' }
      const td: any = { padding: '6px 8px', fontSize: 11.5, borderBottom: '1px solid rgba(148,163,184,.12)', verticalAlign: 'middle' }
      const doSort = (key: any) => {
        if (sortKey === key) setSortAsc(a => !a)
        else { setSortKey(key); setSortAsc(false) }
      }
      const sortHead = (key: any, label: any) => h('th', {
        style: Object.assign({}, thSort, { color: sortKey === key ? '#4f46e5' : '#64748b' }),
        onClick: () => doSort(key),
        title: '点击按「' + label + '」排序',
      }, label + (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''))

      /* ── 管理动作：刷新 / 导出诊断 / 复制摘要 ── */
      const doRefresh = () => {
        if (busy) return
        setBusy(true)
        try { if (typeof props.onReload === 'function') props.onReload() } catch {}
        setTimeout(() => { setBusy(false); setLastAt(new Date()) }, 500)
      }
      const doExport = () => {
        try {
          const payload = {
            exportedAt: new Date().toISOString(),
            plugin: { id: (caps.plugin && caps.plugin.id) || 'kaogong', version: (caps.plugin && caps.plugin.version) || '?' },
            telemetry: {
              uptimeSec: tel.uptimeSec || 0, totalRequests: tel.totalRequests || 0,
              qpsWindow: tel.qpsWindow || 0, coverage, histogram: hist, alerts: alertsRows,
            },
            endpoints: rows.map(r => ({
              path: r.path, label: r.label, count: r.count, errors: r.errors,
              errRate: r.errRate, p50: r.p50, p95: r.p95, active: r.active, orphan: r.orphan, undeclared: r.undeclared,
            })),
            reconciliation: recon,
            lifecycle: life,
            workspaces: wsList,
            insight: ins,
          }
          const text = JSON.stringify(payload, null, 2)
          if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
            const blob = new Blob([text], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'dsh-kaogong-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 800)
          }
        } catch {}
      }
      const doCopy = () => {
        try {
          const summary = rows
            .map(r => [r.path, r.count, 'p50=' + r.p50 + 'ms', 'p95=' + r.p95 + 'ms', 'err=' + (r.errRate * 100).toFixed(1) + '%', r.undeclared ? '未声明' : r.orphan ? '孤儿' : r.active ? '活跃' : '未触达'].join('\t'))
            .join('\n')
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(summary)
        } catch {}
      }
      const mgBtn = (label: any, fn: any, title: any) => h('button', {
        key: label, onClick: fn, title: title || label,
        style: { border: '1px solid rgba(148,163,184,.4)', background: 'rgba(255,255,255,.7)', color: '#475569', borderRadius: 9, padding: '5px 11px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' },
      }, label)

      return h('div', {},
        /* ── H 管理动作条 ── */
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: '8px 12px', borderRadius: 12, background: 'rgba(148,163,184,.08)', border: '1px solid rgba(148,163,184,.2)' } },
          h('span', { style: { fontWeight: 800, fontSize: 12.5, color: '#334155' } }, '📡 白盒管理面板'),
          h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, '覆盖 ' + (coverage * 100).toFixed(0) + '% · ' + (lastAt ? '刷新于 ' + lastAt.toLocaleTimeString() : '实时')),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' } },
            mgBtn(busy ? '刷新中…' : '↻ 刷新', doRefresh, '重新拉取遥测/能力/生命周期'),
            mgBtn('⤓ 导出诊断', doExport, '下载完整诊断 JSON（仅本机数据，无凭据）'),
            mgBtn('⧉ 复制摘要', doCopy, '复制端点性能表为 TSV，便于贴给模型分析'))),

        /* ── F 告警区（有告警才出现，避免视觉噪音）── */
        alertsRows.length
          ? h(Card, { title: '🚨 运行告警 · ' + alertsRows.length + ' 条' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                alertsRows.slice(0, 8).map((a, i) => {
                  const c = alertColor(a.level)
                  return h('div', { key: 'al' + i, style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', borderRadius: 9, background: c.bg, border: '1px solid ' + c.border } },
                    h('span', null, c.icon),
                    h('span', { style: { fontSize: 11.5, color: c.fg, lineHeight: 1.6 } }, String(a.msg || '')))
                })))
          : null,

        /* ── A 学习质量 ── */
        h(Card, { title: '📈 我的学习质量' },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 } },
            h(Stat, { v: essayN ? essayAvg + '%' : '—', l: '申论均分率 · ' + essayN + ' 次', color: essayAvg >= 60 ? '#10b981' : '#f59e0b' }),
            h(Stat, { v: examN ? examAvg + '%' : '—', l: '模考均分率 · ' + examN + ' 场', color: examAvg >= 60 ? '#10b981' : '#f59e0b' }),
            h(Stat, { v: (ins.essay && ins.essay.recent && ins.essay.recent.length) || 0, l: '近期申论记录' }),
            h(Stat, { v: (ins.exam && ins.exam.recent && ins.exam.recent.length) || 0, l: '近期模考记录' }))),

        /* ── B 运行态 ── */
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8, marginBottom: 14 } },
          h(Stat, { v: (tel.uptimeSec || 0) + 's', l: '运行时长' }),
          h(Stat, { v: tel.totalRequests || 0, l: '总请求' }),
          h(Stat, { v: tel.qpsWindow || 0, l: 'QPS(60s)' }),
          h(Stat, { v: (coverage * 100).toFixed(0) + '%', l: '端点覆盖', color: coverage > .7 ? '#10b981' : '#f59e0b' }),
          h(Stat, { v: (tel.activeEndpoints || Object.keys(eps).length) + '/' + (tel.declaredEndpoints || declared.length), l: '活跃/声明' }),
          h(Stat, { v: problemCount, l: '问题端点', color: problemCount ? '#ef4444' : '#10b981' }),
          h(Stat, { v: (hist.p95 || 0) + 'ms', l: '全局 p95', color: (hist.p95 || 0) > 200 ? '#f59e0b' : '#10b981' }),
          h(Stat, { v: (hist.max || 0) + 'ms', l: '最慢样本' })),

        /* ── C 生命周期状态机 ── */
        h(Card, { title: '🔁 生命周期状态机' },
          stages.length
            ? h('div', null,
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', marginBottom: 12 } },
                  stages.map((s, i) => {
                    const c = stageColor(s.state)
                    return h('div', { key: String(s.stage), style: { display: 'flex', alignItems: 'center' } },
                      h('div', {
                        title: String(s.desc || '') + (s.at ? ' · ' + new Date(s.at).toLocaleTimeString() : ''),
                        style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
                      },
                        h('i', { style: { width: 7, height: 7, borderRadius: '50%', background: c.dot, display: 'inline-block' } }),
                        String(s.stage),
                        s.state === 'done' ? ' ✓' : s.state === 'current' ? ' ●' : ''),
                      i < stages.length - 1 ? h('span', { key: 'ar' + i, style: { color: '#cbd5e1', margin: '0 3px', fontSize: 11 } }, '→') : null)
                  })),
                lifeEvents.length
                  ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 190, overflowY: 'auto' } },
                      lifeEvents.map((e, i) => h('div', { key: 'ev' + i, style: { display: 'flex', gap: 8, fontSize: 10.5, color: '#64748b', padding: '2px 0', borderBottom: '1px dashed rgba(148,163,184,.15)' } },
                        h('span', { style: { fontFamily: 'monospace', color: '#94a3b8', flex: '0 0 62px' } }, String(e.ts || '').slice(11, 19)),
                        h('span', { style: { fontWeight: 700, color: '#475569' } }, String(e.event || '')),
                        e.port ? h('span', null, ':' + e.port) : null,
                        e.pid ? h('span', null, 'pid ' + e.pid) : null)))
                  : null)
            : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '生命周期端点未就绪（/api/lifecycle 未返回 stages）—— 服务可用，仅该卡片降级')),

        /* ── D 能力对账 + E 端点性能表（共用一张表，一屏看全） ── */
        h(Card, { title: '🧩 能力对账 × 端点性能（注册 → 生产 → 消费）' },
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, fontSize: 10.5 } },
            h('span', { style: G_TAG }, '声明 ' + declared.length),
            h('span', { style: G_TAG }, '活跃 ' + consumed.size),
            h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(239,68,68,.12)', color: '#dc2626' }) }, '孤儿 ' + orphanEndpoints.size),
            h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(245,158,11,.12)', color: '#b45309' }) }, '未触达 ' + unconsumedEndpoints.size),
            h('span', { style: Object.assign({}, G_TAG, { background: 'rgba(16,185,129,.12)', color: '#059669' }) }, '无问题 ' + Math.max(0, declared.length - orphanEndpoints.size))),
          rows.length
            ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9, alignItems: 'center' } },
                h('input', {
                  value: filter, placeholder: '过滤端点路径 / 名称…',
                  onChange: (e) => setFilter(e && e.target ? e.target.value : ''),
                  'aria-label': '过滤端点',
                  style: { flex: '1 1 180px', minWidth: 130, padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,.35)', fontSize: 11.5, fontFamily: 'inherit', background: 'var(--surface-card,#fff)', color: 'inherit' },
                }),
                h('button', { onClick: () => setOnlyProblems(v => !v), style: Object.assign({}, G_BTN, onlyProblems ? G_BTN_ON : {}) }, onlyProblems ? '✓ 仅问题端点' : '仅问题端点'),
                h('span', { style: { fontSize: 10.5, color: '#94a3b8' } }, viewRows.length + ' / ' + rows.length + ' 行'))
            : null,
          rows.length
            ? h('div', { style: { overflowX: 'auto' } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: 620 } },
                  h('thead', null, h('tr', null,
                    sortHead('path', '端点'),
                    sortHead('count', '次数'),
                    sortHead('p50', 'p50'),
                    sortHead('p95', 'p95'),
                    sortHead('errRate', '错误率'),
                    h('th', { key: 'spark', style: th }, '延迟趋势'),
                    h('th', { key: 'st', style: th }, '状态'))),
                  h('tbody', null, viewRows.slice(0, 60).map(r => {
                    const bad = r.p95 > 200 || r.errRate > 0.01
                    const statusBg = r.undeclared ? 'rgba(245,158,11,.15)' : r.orphan ? 'rgba(239,68,68,.15)' : r.active ? 'rgba(16,185,129,.15)' : 'rgba(148,163,184,.15)'
                    const statusFg = r.undeclared ? '#b45309' : r.orphan ? '#dc2626' : r.active ? '#059669' : '#64748b'
                    const statusText = r.undeclared ? '未声明' : r.orphan ? '孤儿' : r.active ? '活跃' : '未触达'
                    return h('tr', { key: r.path, style: { background: bad ? 'rgba(245,158,11,.045)' : 'transparent' } },
                      h('td', { style: Object.assign({}, td, { fontFamily: 'monospace', fontSize: 10.5 }) },
                        h('div', null, r.path),
                        (r.label && r.label !== '未在 manifest 声明')
                          ? h('div', { style: { fontSize: 9.5, color: '#94a3b8', marginTop: 1, fontFamily: 'inherit' } }, r.label + ' · ' + r.consumers.length + ' 消费者')
                          : null),
                      h('td', { style: td }, r.count),
                      h('td', { style: Object.assign({}, td, { color: r.p50 > 100 ? '#b45309' : 'inherit' }) }, r.p50 ? r.p50 + 'ms' : '—'),
                      h('td', { style: Object.assign({}, td, { fontWeight: bad ? 800 : 400, color: bad ? '#dc2626' : 'inherit' }) }, r.p95 ? r.p95 + 'ms' : '—'),
                      h('td', { style: Object.assign({}, td, { color: r.errRate > 0.01 ? '#dc2626' : '#94a3b8' }) }, r.errRate ? (r.errRate * 100).toFixed(1) + '%' : '0%'),
                      h('td', { style: td }, h(Sparkline, { series: r.series, color: bad ? '#ef4444' : '#6366f1' })),
                      h('td', { style: td }, h('span', { style: { background: statusBg, color: statusFg, padding: '2px 8px', borderRadius: 20, fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' } }, statusText)))
                  }))))
            : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '能力矩阵未就绪（/api/capabilities 未返回 endpoints）—— 服务可用，仅该卡片降级')),

        /* ── E 慢端点 TOP（性能优先级直读） ── */
        topSlow.length
          ? h(Card, { title: '🐌 慢端点 TOP（p95 降序）' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                topSlow.slice(0, 6).map(r => h('div', { key: String(r.path), style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 } },
                  h('span', { style: { flex: '0 0 auto', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 10.5 } }, String(r.path)),
                  h('div', { style: { flex: 1 } }, h(Bar, { pct: Math.min(100, Math.round(((r.p95 || 0) / maxP95) * 100)), color: (r.p95 || 0) > 200 ? 'linear-gradient(135deg,#ef4444,#f87171)' : undefined })),
                  h('span', { style: { flex: '0 0 66px', textAlign: 'right', color: '#64748b', fontSize: 10.5 } }, (r.p95 || 0) + 'ms · ' + (r.count || 0) + '次')))))
          : null,

        /* ── G 命名空间清单 ── */
        h(Card, { title: '🗂 工作区命名空间 · ' + wsList.length + ' 个' },
          wsList.length
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 170, overflowY: 'auto' } },
                wsList.slice(0, 40).map((w, i) => h('span', {
                  key: String(w.ns || w.label || i),
                  title: '答题 ' + (w.answered || 0) + ' · 正确率 ' + (w.rate || 0) + '%',
                  style: Object.assign({}, G_TAG, { fontFamily: 'monospace', fontSize: 10 }),
                }, String(w.ns || w.label || '?') + ' · D' + (w.day || 1) + ' · ' + (w.answered || 0) + '题')))
            : h('div', { style: { fontSize: 12, color: '#94a3b8' } }, '命名空间端点未就绪（/api/workspaces）—— 服务可用，仅该卡片降级')),

        /* ── 白盒口径说明 ── */
        h('div', { style: { fontSize: 10.5, color: '#94a3b8', lineHeight: 1.8, marginTop: 4 } },
          '口径：p50/p95 = 每端点最近 100 次请求的环形样本百分位；覆盖 = 运行态被触达端点数 / 声明端点数；',
          '孤儿 = 声明了但能力图上无人消费（矩阵断裂点）；「未声明」= 运行态出现但 manifest 未登记（绕过单一事实源的证据）。'))
    }