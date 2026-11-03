/**
 * client/client.js — DSH Web GUI 双入口 · v1.5.1（combo 格式修复 R11）
 *
 * R11 事故（沙箱闭环取证）：宿主 Web 组合加载器要求 **combo factory 格式**
 * （window.__ModuleLoader__.load + require 取依赖）；裸 ESM `export` 直接
 * `SyntaxError: Unexpected token 'export'` → 插件条目不激活 → GUI 显示
 * "Failed to load plugins"。此前「注册成功」日志全部来自 Host 半，
 * Client 半从未真正加载。格式照实测参考 @wlv-zedd/dsh-chatgpt-web（无构建步骤）。
 *
 * R9 保留：子视图一律组件化挂载（直调含 hook 函数 → hook 漂移 → GUI 白屏）+ ErrorBoundary。
 * R6 保留：React 事件一律 onClick 驼峰。
 *
 * 席位契约：
 *  - 左栏 = sidebar.panellist register{id,order,label()}（svg 带 data-dsh-panel-entry）+ main keyed slot
 *  - 右侧 = sidebarRightTabs.register(定义) + sidebar.right.pane.tab keyed slot（双注册同 id）+ guide 函数式
 *  - 通道 = 同源 /kaogong/*（ctx.webServer 挂载，主）→ 独立端口（兜底）
 *
 * cycle-13 T-025：本文件原 3362 行（复杂度 677）已拆分为 ui-kit / graph-analytics /
 * graph-physics / graph-engine / graph-view / obs-view / study-view / papers-view
 * 八个真 ESM 模块（组件名零改动）；构建期 scripts/bundle-client.mjs 把 tsc 多文件
 * 产物按依赖拓扑序合并回本 combo factory（微模块注册表 __kgM/__kgR 桥接），
 * 宿主加载器契约（单文件 combo、无行首 export、factory 返回 {inject, apply}）不变。
 */

import { h, React, MOUNT_PATH, PORTS, APP_NAME, KaogongErrorBoundary } from './ui-kit.js'
import { NativeDashboardView, NativePracticeView, NativeWrongbookView, KaogongQuickPractice, NativeTuxingView, NativeDeepBankView } from './study-view.js'
import { NativeExamView, NativePapersView, NativeTopicsView, NativeEssayView } from './papers-view.js'
import { NativeGraphView } from './graph-view.js'
import { NativeObsView } from './obs-view.js'

;(window as any).__ModuleLoader__.load({
  id: 'dsh-kaogong',
  factory(require) {
    const PANEL_ID = 'dsh-kaogong'
    const TAB_KIND = 'kaogong'
    let lastWsKey = 'default'
    const DICTS = {
      zh: { title: '考公学习', guideDesc: '离线题库 · 30天计划 · SRS错题本 · 知识图谱 · 可观测仪表盘（15个开源仓库）', loading: '正在连接学习服务…', down: '本地学习服务未运行', downHint: 'Host 插件加载时自动启动；若刚崩溃请执行热重载', openExternal: '↗ 浏览器标签', retry: '↻', probe: '项目', native: '宿主原生', fallback: 'iframe 兜底' },
      en: { title: 'Exam Study', guideDesc: 'Offline bank · 30-day plan · SRS wrong-book · knowledge graph · observability', loading: 'Connecting to study service…', down: 'Local study service not running', downHint: 'It starts when the Host plugin loads; hot-reload if it crashed', openExternal: '↗ Browser tab', retry: '↻', probe: 'project', native: 'native', fallback: 'iframe fallback' },
    }
    function KaogongMainBounded(props) { return h(KaogongErrorBoundary, null, h(KaogongMainPanel, props)) }
    function KaogongTabBounded(props) { return h(KaogongErrorBoundary, null, h(KaogongTabBody, props)) }
    /** 会话 → 工作区路径（隔离 key）；逐级兜底且永不崩 */
    function resolveWorkspaceKey(ctx, sessionId) {
      try {
        if (!sessionId) return 'default'
        const sessions = ctx.get('sessions')
        const scope = sessions && sessions.scope && sessions.scope(sessionId)
        const wp = scope && (scope.workspacePath || scope.workspace || (scope.binding && scope.binding.workspacePath))
        if (wp && typeof wp === 'string') return wp
        return 'session/' + sessionId
      } catch {
        return 'session/' + (sessionId || 'default')
      }
    }

    /** 通道探测：同源 /kaogong/api/status 优先，独立端口兜底 */
    function useChannel() {
      const [channel, setChannel] = React.useState(null)
      React.useEffect(() => {
        if (channel) return
        let cancelled = false
        ;(async () => {
          while (!cancelled) {
            try {
              const r = await fetch(`${MOUNT_PATH}/api/status`, { signal: AbortSignal.timeout(1200) })
              const j = await r.json()
              if (j && j.app === APP_NAME) { if (!cancelled) setChannel({ kind: 'same-origin', base: MOUNT_PATH }); return }
            } catch {}
            for (const port of PORTS) {
              try {
                const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(900) })
                const j = await r.json()
                if (j && j.app === APP_NAME) { if (!cancelled) setChannel({ kind: 'port', base: `http://127.0.0.1:${port}` }); return }
              } catch {}
            }
            await new Promise(r2 => setTimeout(r2, 3000))
          }
        })()
        return () => { cancelled = true }
      }, [channel])
      return channel
    }

    /** 宿主原生面板：同源 fetch + React 渲染（左栏 main 席位，全屏沉浸） */
    function KaogongMainPanel({ wsKey, t }) {
      const channel = useChannel()
      const [view, setViewRaw] = React.useState(() => localStorage.getItem('kg-native-view') || 'dashboard')
      const [viewParams, setViewParams] = React.useState({})   // v1.7.1：专题 entry 传参（模块/题型/科目）
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [tick, setTick] = React.useState(0)

      /**
       * 视图切换（v1.8.0 修复「重复点击同一视图永久 loading」）：
       * 原实现无条件 setData(null)，但父 effect 依赖 [channel, view, api, tick] ——
       * 重复点同一 tab 时 view 未变、effect 不重跑，于是 data 永远为 null，
       * 界面卡在 spinner（用户感知「图谱打不开」）。现在用 tick 强制重取：
       * 命中同一视图时自增 tick（effect 依赖含 tick，必然重新拉数据）。
       */
      const setView = React.useCallback((v: any, params?: any) => {
        localStorage.setItem('kg-native-view', v)
        setData(null)
        setViewParams(params || {})
        setViewRaw(prev => {
          if (prev === v) setTick(t => t + 1)   // 同一视图重入 → 强制刷新
          return v
        })
      }, [])

      const api = React.useCallback(async (p: string, opts?: any): Promise<any> => {
        const sep = p.includes('?') ? '&' : '?'
        const r = await fetch(`${channel.base}/api${p}${sep}ws=${encodeURIComponent(wsKey)}`, opts)
        return r.json()
      }, [channel, wsKey])

      React.useEffect(() => {
        if (!channel) return
        // v1.6：自管数据视图（papers/topics/essay）由子组件自行 fetch，父不介入
        if (view === 'papers' || view === 'topics' || view === 'essay' || view === 'exam' || view === 'practice' || view === 'deepbank' || view === 'tuxing') { setData(null); return }
        let cancelled = false
        setErr(null)
        ;(async () => {
          try {
            if (view === 'dashboard') {
              const [st, stats, papers, eh, xh] = await Promise.all([
                api('/status'), api('/stats'),
                api('/papers?_=1').catch(() => ({ total: 0, subjects: [] })),
                api('/essay/history').catch(() => ({ total: 0, avgRatio: 0 })),
                api('/paper/exam/history').catch(() => ({ total: 0, avgRate: 0 })),
              ])
              const subj = (papers && papers.subjects) || []
              const essayPapers = (subj.find(x => x.subject === '申论') || {}).count || 0
              const xingcePapers = (subj.find(x => x.subject === '行测') || {}).count || 0
              const extra = {
                paperTotal: (papers && papers.total) || 0, essayPapers, xingcePapers,
                essayCount: (eh && eh.total) || 0, avgEssay: (eh && eh.avgRatio) || 0,
                examCount: (xh && xh.total) || 0, avgExam: (xh && xh.avgRate) || 0,
              }
              if (!cancelled) setData({ kind: 'dashboard', st, stats, extra })
            } else if (view === 'wrongbook') {
              const wb = await api('/wrong')
              if (!cancelled) setData({ kind: 'wrongbook', wb })
            } else if (view === 'graph') {
              const [g, statsI] = await Promise.all([api('/graph'), api('/stats').catch(() => null)])
              if (!cancelled) setData({ kind: 'graph', g, stats: statsI })
            } else if (view === 'obs') {
              // v1.8.0：并行拉齐白盒面板所需全部数据源，任一失败单独降级不影响其余卡片
              const [tel, caps, eh, xh, life, wss] = await Promise.all([
                api('/telemetry'),
                api('/capabilities'),
                api('/essay/history').catch(() => null),
                api('/paper/exam/history').catch(() => null),
                api('/lifecycle').catch(() => null),
                api('/workspaces').catch(() => null),
              ])
              if (!cancelled) setData({
                kind: 'obs', tel, caps,
                life: life || (caps && caps.lifecycle) || null,
                workspaces: (wss && wss.workspaces) || [],
                insight: { essay: eh, exam: xh },
              })
            }
          } catch (e) { if (!cancelled) setErr(String((e && e.message) || e)) }
        })()
        return () => { cancelled = true }
      }, [channel, view, api, tick])

      if (!channel) {
        return h('div', { className: 'kg-page', role: 'main', 'aria-label': t('title') },
          h('div', { className: 'kg-load', style: { flex: 1 } },
            h('div', { className: 'kg-spin', role: 'status' }), t('loading')))
      }

      // v1.7.4 导航分组：学习 / 题库 / 复盘（三组各司其职，减少横向拥挤）
      const NAV_GROUPS: Array<{ id: string; label: string; items: Array<[string, string]> }> = [
        { id: 'learn', label: '学习', items: [['dashboard', '📊 仪表盘'], ['practice', '✏️ 刷题'], ['deepbank', '🧠 深度题库'], ['tuxing', '🔷 图形推理'], ['exam', '⏱ 模考']] },
        { id: 'bank', label: '题库', items: [['papers', '📚 真题卷'], ['topics', '🎯 专题'], ['essay', '✍️ 申论']] },
        { id: 'review', label: '复盘', items: [['wrongbook', '📕 错题本'], ['graph', '🕸️ 图谱'], ['obs', '📡 可观测']] },
      ]
      return h('div', { className: 'kg-page', role: 'main', 'aria-label': t('title') },
        h('div', { className: 'kg-page-head' },
          h('span', { className: 'kg-page-title' }, '📚 ' + t('title')),
          h('span', { style: { fontSize: 11, color: '#64748b' } },
            `${channel.kind === 'same-origin' ? '🏠 ' + t('native') : '🔌 ' + t('fallback')} · ${String(wsKey).split(/[\\/]/).pop() || 'default'}`),
          h('nav', { style: { marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }, role: 'tablist' },
            NAV_GROUPS.map((g, gi) => h('div', {
              key: g.id,
              style: { display: 'flex', alignItems: 'center', gap: 2, paddingRight: 10, borderRight: gi < NAV_GROUPS.length - 1 ? '1px solid rgba(148,163,184,.25)' : 'none' },
            },
              h('span', { style: { fontSize: 9.5, color: '#94a3b8', letterSpacing: 1, marginRight: 3, textTransform: 'uppercase' } }, g.label),
              g.items.map(([id, label]) => h('button', {
                key: id, role: 'tab', 'aria-selected': view === id, className: 'kg-navbtn' + (view === id ? ' on' : ''),
                onClick: () => setView(id),
              }, label)))))),
        h('div', { className: 'kg-page-body', style: { overflowY: 'auto', padding: '16px 20px' } },
          err ? h('div', { style: { color: '#ef4444', fontSize: 13 } }, '加载失败: ' + err) : null,
          // v1.6 自管数据视图（组件内自行 fetch，不经父 effect）
          view === 'papers' ? h(NativePapersView, { key: 'pp' + tick, api, initialSubject: viewParams.subject || '' }) : null,
          view === 'exam' ? h(NativeExamView, { key: 'ex' + tick, api }) : null,
          view === 'practice' ? h(NativePracticeView, { key: 'pr' + tick + JSON.stringify(viewParams), api, initialModule: viewParams.module || '', onGoWrongbook: () => setView('wrongbook') }) : null,
          view === 'deepbank' ? h(NativeDeepBankView, { key: 'dp' + tick, api, initialModule: viewParams.module || '', initialCategory: viewParams.category || '' }) : null,
          view === 'tuxing' ? h(NativeTuxingView, { key: 'tx' + tick, api }) : null,
          view === 'topics' ? h(NativeTopicsView, { key: 'tp' + tick, api, onGo: (v, params) => setView(v, params || {}) }) : null,
          view === 'essay' ? h(NativeEssayView, { key: 'es' + tick + JSON.stringify(viewParams), api, initialType: viewParams.type || '' }) : null,
          // 父 effect 管理数据的视图
          view !== 'papers' && view !== 'topics' && view !== 'essay' && view !== 'exam' && view !== 'practice' && view !== 'deepbank' && view !== 'tuxing' && !data && !err ? h('div', { className: 'kg-load' }, h('div', { className: 'kg-spin' })) : null,
          // R9：子视图经组件挂载，key=view+tick → 切换即干净重挂载，父 hook 链恒定
          data && data.kind === 'dashboard' ? h(NativeDashboardView, { key: 'd' + tick, data }) : null,
          data && data.kind === 'wrongbook' ? h(NativeWrongbookView, { key: 'w' + tick, data: data.wb }) : null,
          data && data.kind === 'graph' ? h(NativeGraphView, { key: 'g' + tick, data: data.g, stats: data.stats, api, wsKey }) : null,
          data && data.kind === 'obs' ? h(NativeObsView, { key: 'o' + tick, data, insight: data.insight, onReload: () => setTick(t => t + 1) }) : null,
          ))
    }
    /** 左栏面板图标（shell 事件委托接管点击/选中） */
    function KaogongPanelIcon({ size }) {
      return h('svg', {
        'data-dsh-panel-entry': PANEL_ID,
        viewBox: '0 0 16 16', width: size, height: size,
        fill: 'none', stroke: 'currentColor', strokeWidth: '1.3',
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
        h('path', { d: 'M2 3.2A1.2 1.2 0 0 1 3.2 2H7v12.4H3.2A1.2 1.2 0 0 1 2 13.2z' }),
        h('path', { d: 'M14 3.2A1.2 1.2 0 0 0 12.8 2H9v12.4h3.8A1.2 1.2 0 0 0 14 13.2z' }),
        h('path', { d: 'M5.5 5.5h1M10.5 5.5h1' }))
    }
    /** 右侧 tab 正文：同源优先原生，端口兜底 iframe */
    function KaogongTabBody({ wsKey, sidebarRight, t }) {
      const channel = useChannel()
      const [reloadKey, setReloadKey] = React.useState(0)

      if (!channel) {
        return h('div', { className: 'kg-shell', role: 'region', 'aria-label': t('title') },
          h('div', { className: 'kg-load' },
            h('div', { className: 'kg-spin', role: 'status' }), t('loading')))
      }
      if (channel.kind === 'same-origin') {
        return h('div', { className: 'kg-shell', role: 'region', 'aria-label': t('title') },
          h('div', { className: 'kg-bar' },
            h('span', { className: 'kg-dot', 'aria-hidden': 'true' }),
            h('span', null, '🏠 ' + t('native') + ' · ' + channel.base),
            h('span', { style: { opacity: .6, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${t('probe')} ${String(wsKey).split(/[\\/]/).pop()}`),
            h('button', { 'aria-label': t('retry'), style: { marginLeft: 'auto' }, onClick: () => setReloadKey(k => k + 1) }, t('retry'))),
          h('div', { className: 'kg-frame' },
            h(KaogongMainPanel, { wsKey, t, key: reloadKey })))
      }
      const url = `${channel.base}/?ws=${encodeURIComponent(wsKey)}&embed=1&_r=${reloadKey}`
      return h('div', { className: 'kg-shell', role: 'region', 'aria-label': t('title') },
        h('div', { className: 'kg-bar' },
          h('span', { className: 'kg-dot', 'aria-hidden': 'true' }),
          h('span', null, '🔌 ' + t('fallback') + ' · ' + channel.base.replace('http://', '')),
          h('button', {
            'aria-label': t('openExternal'), style: { marginLeft: 'auto' },
            onClick: () => { try { sidebarRight && sidebarRight.openTab && sidebarRight.openTab('browser', { params: { url } }) } catch { window.open(url, '_blank') } },
          }, t('openExternal')),
          h('button', { 'aria-label': t('retry'), onClick: () => setReloadKey(k => k + 1) }, t('retry'))),
        h('div', { className: 'kg-frame' },
          h('iframe', { src: url, title: t('title'), 'aria-label': t('title'), allow: 'clipboard-write' })))
    }
    /* ══ 插件本体：combo factory 必须返回 {inject, apply}（R11 二次取证：
       缺失 return → 加载器收到 undefined → "invalid plugin"）══ */
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try { ctx.locale.register('dsh-kaogong', { zh: DICTS.zh, en: DICTS.en }) } catch { /* locale 缺席不影响核心 */ }
        const t = (k) => {
          try {
            const tt = ctx.locale.bind('dsh-kaogong')
            const v = tt && tt(k)
            return v && v !== k ? v : DICTS.zh[k] || k
          } catch { return DICTS.zh[k] || k }
        }

        // 样式注入双保险（R11 取证：combo 环境 `styles` 内置全局可能不存在，
        // 直接 styles.insert 抛 ReferenceError → 条目激活失败）
        const CSS = `
          .kg-shell{width:100%;height:100%;display:flex;flex-direction:column}
          .kg-frame{flex:1;min-height:0;display:flex;position:relative}
          .kg-frame iframe{border:0;width:100%;height:100%;background:#fff}
          .kg-bar{display:flex;align-items:center;gap:8px;padding:5px 10px;font-size:11.5px;color:var(--text-muted,#64748b);background:rgba(148,163,184,.08);border-bottom:1px solid rgba(148,163,184,.18);flex-shrink:0}
          .kg-bar button{border:0;background:none;cursor:pointer;font-size:11.5px;color:#6366f1;padding:2px 6px;border-radius:5px}
          .kg-bar button:hover{background:rgba(99,102,241,.1)}
          .kg-dot{width:7px;height:7px;border-radius:50%;background:#10b981;flex-shrink:0}
          .kg-load{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#64748b;font-size:13px}
          .kg-spin{width:26px;height:26px;border:3px solid #e2e8f0;border-top-color:#6366f1;border-radius:50%;animation:kgspin .8s linear infinite}
          @keyframes kgspin{to{transform:rotate(360deg)}}
          .kg-page{display:flex;flex-direction:column;height:100%;overflow:hidden}
          .kg-page-head{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid rgba(148,163,184,.25);flex-shrink:0;flex-wrap:wrap}
          .kg-page-title{font-size:15px;font-weight:800;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
          .kg-page-body{flex:1;min-height:0}
          .kg-navbtn{border:0;cursor:pointer;font-size:12px;font-weight:600;padding:5px 10px;border-radius:8px;font-family:inherit;background:transparent;color:var(--text-muted,#64748b)}
          .kg-navbtn:hover{background:rgba(99,102,241,.08)}
          .kg-navbtn.on{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff}
          @media (max-width:420px){.kg-bar{font-size:10.5px;gap:5px}}
        `
        ctx.effect(() => {
          if (typeof (globalThis as any).styles !== 'undefined' && (globalThis as any).styles && (globalThis as any).styles.insert) {
            return (globalThis as any).styles.insert(CSS) || (() => {})
          }
          try {
            const el = document.createElement('style')
            el.textContent = CSS
            document.head.appendChild(el)
            return () => { try { el.remove() } catch {} }
          } catch { return () => {} }
        }, 'kaogong styles')

        // ── 左栏双席位：面板图标 + main 全屏原生面板 ──
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 120, label: () => t('title') },
            KaogongPanelIcon,
          )
        ), 'kaogong panel icon')

        // T-024：会话输入区「练题」控件（slot 缺席时静默跳过，绝不影响对话）
        ctx.effect(() => {
          try {
            const injectSlot = (ctx.slots as any).inject
            if (typeof injectSlot !== 'function') return
            return injectSlot.call(ctx.slots, 'conversation.input.left', () =>
              (ctx.slots as any).register(
                { name: 'conversation.input.left', id: PANEL_ID, order: 85, inject: () => ({ apiBase: '/kaogong/api' }) },
                KaogongQuickPractice,
              ),
            )
          } catch (e) {
            console.warn('[dsh-kaogong] 会话练题控件注册跳过：', (e as any)?.message || e)
            return
          }
        }, 'kaogong quick practice')

        ctx.effect(() => ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: PANEL_ID, inject: () => ({ wsKey: lastWsKey, t }) },
            KaogongMainBounded,
          )
        ), 'kaogong main panel')

        // ── 右侧边栏 tab（双注册同 id + guide 入口）──
        ctx.inject(['sidebarRightTabs'], (injected) => {
          const tabs = injected.get('sidebarRightTabs')
          if (!tabs) { console.error('sidebarRightTabs 服务缺失，标签注册跳过'); return }
          const disposers: any[] = []
          disposers.push(tabs.register({
            id: PANEL_ID, kind: TAB_KIND, priority: 'extension', keepMounted: true,
            title: () => t('title'),
            guide: [{ order: 200, title: () => t('title'), description: () => t('guideDesc') }],
          }))
          disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab', key: PANEL_ID,
                inject: (sessionId) => {
                  lastWsKey = resolveWorkspaceKey(ctx, sessionId)
                  return { wsKey: lastWsKey, sidebarRight: ctx.get('sidebarRight') || null, t }
                },
              },
              KaogongTabBounded,
            )
          ))
          console.log('kaogong 双入口已注册 (left=panel, right=tab, 宿主原生面板优先)')
          return () => { for (const d of disposers) { try { d() } catch {} } }
        })
      },
    }
  },
})