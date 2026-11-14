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

import { h, React, MOUNT_PATH, PORTS, APP_NAME, Stat, KaogongErrorBoundary } from './ui-kit.js'
// cycle-13 对话窗口瘦身：会话练题控件已删除（会话输入区 slot 随之下线）
import { NativeDashboardView, NativePracticeView, NativeWrongbookView, NativeTuxingView, NativeDeepBankView } from './views/study-view.js'
import { NativeExamView, NativePapersView, NativeTopicsView, NativeEssayView } from './views/papers-view.js'
import { NativeGraphView } from './views/graph-view.js'
import { NativeObsView } from './views/obs-view.js'
import { NativeReposView } from './views/repos-view.js'
// cycle-18 花生十三体系方法论（消费 /api/huasheng13/*，自管数据视图）
import { NativeHuasheng13View } from './views/huasheng13-view.js'

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
      const [tick, setTick] = React.useState(0)

      /**
       * 视图切换（v1.8.0 修复「重复点击同一视图永久 loading」，cycle-24 保留语义）：
       * tick 参与挂载 key —— 命中同一视图时自增 tick（key 变化 → 自治视图干净重挂载并重新取数）。
       * cycle-24 P0-1：父层不再拉取/下发 data —— 全部视图自治 fetch（窄 props），err 下沉到各视图。
       */
      const setView = React.useCallback((v: any, params?: any) => {
        localStorage.setItem('kg-native-view', v)
        setViewParams(params || {})
        setViewRaw(prev => {
          if (prev === v) setTick(t => t + 1)   // 同一视图重入 → 强制重挂载重取
          return v
        })
      }, [])

      const api = React.useCallback(async (p: string, opts?: any): Promise<any> => {
        const sep = p.includes('?') ? '&' : '?'
        const r = await fetch(`${channel.base}/api${p}${sep}ws=${encodeURIComponent(wsKey)}`, opts)
        return r.json()
      }, [channel, wsKey])

      // cycle-24 P0-1：取数下沉段整体移除 —— dashboard/wrongbook/graph/obs 四视图改为自治 fetch
      //（原 90 行 data.kind 分发 + Promise.all 整包下传删除；各视图错误各自就地降级）
      /** 自管视图名单（组件内自行 fetch，不经父层）：cycle-24 起为全部视图 */
      const SELF_MANAGED_VIEWS = new Set(['papers', 'topics', 'essay', 'exam', 'practice', 'deepbank', 'tuxing', 'repos', 'huasheng13'])

      /**
       * cycle-24 P0-2：视图路由注册表（唯一分发事实源）。
       * 每项：组件（稳定函数引用，模块/壳作用域声明）+ 挂载 key + 窄 props 工厂。
       * 新增视图 = 一行登记（替代原 17 行三元分发链 + 重复布尔排除串两处）。
       */
      const VIEW_ROUTES: Record<string, { comp: any; key: (t: number) => string; props: () => any }> = {
        dashboard: { comp: NativeDashboardView, key: t => 'd' + t, props: () => ({ api }) },
        wrongbook: { comp: NativeWrongbookView, key: t => 'w' + t, props: () => ({ api }) },
        graph: { comp: NativeGraphView, key: t => 'g' + t, props: () => ({ api, wsKey, statsApi: api, onGo: (v: any, params?: any) => setView(v, params || {}) }) },
        obs: { comp: NativeObsView, key: t => 'o' + t, props: () => ({ api, onReload: () => setTick(t => t + 1) }) },
        papers: { comp: NativePapersView, key: t => 'pp' + t, props: () => ({ api, initialSubject: viewParams.subject || '' }) },
        exam: { comp: NativeExamView, key: t => 'ex' + t, props: () => ({ api }) },
        practice: { comp: NativePracticeView, key: t => 'pr' + t + JSON.stringify(viewParams), props: () => ({ api, initialModule: viewParams.module || '', onGoWrongbook: () => setView('wrongbook') }) },
        deepbank: { comp: NativeDeepBankView, key: t => 'dp' + t, props: () => ({ api, initialModule: viewParams.module || '', initialCategory: viewParams.category || '' }) },
        tuxing: { comp: NativeTuxingView, key: t => 'tx' + t, props: () => ({ api }) },
        repos: { comp: NativeReposView, key: t => 'rp' + t, props: () => ({ api }) },
        huasheng13: { comp: NativeHuasheng13View, key: t => 'hs13' + t, props: () => ({ api, initialSection: viewParams.section || '', onGo: (v: any, params?: any) => setView(v, params || {}) }) },
        topics: { comp: NativeTopicsView, key: t => 'tp' + t, props: () => ({ api, onGo: (v: any, params?: any) => setView(v, params || {}), initialModule: viewParams.module || '' }) },
        essay: { comp: NativeEssayView, key: t => 'es' + t + JSON.stringify(viewParams), props: () => ({ api, initialType: viewParams.type || '' }) },
      }
      const route = VIEW_ROUTES[view]
      const routeEl = route ? h(route.comp, { key: route.key(tick), ...route.props() }) : null

      // 通道未就绪守卫（cycle-24 取数下沉时曾误删 → channel.kind 崩溃进 ErrorBoundary，render 实测抓住）
      if (!channel) {
        return h('div', { className: 'kg-page', role: 'main', 'aria-label': t('title') },
          h('div', { className: 'kg-load', style: { flex: 1 } },
            h('div', { className: 'kg-spin', role: 'status' }), t('loading')))
      }

      // cycle-13 导航精简（用户明确要求）：移除「刷题 / 深度题库 / 图形推理 / 申论」四个一级入口，
      // 这四项全部收敛进「专题」页的练习枢纽分区（papers-view.ts NativeTopicsView）；
      // 路由可达性保留：setView('practice'/'deepbank'/'tuxing'/'essay') 仍有效（下方视图分发未删）。
      // cycle-18：花生十三体系同理不外挂一级入口（用户明确要求「不要单独弄导航入口，
      // 放在专题下的方法论下即可」）——它的入口在专题枢纽「📖 方法论」分区内；
      // view==='huasheng13' 的分发保留，用于深链与枢纽内跳转。
      const NAV_GROUPS: Array<{ id: string; label: string; items: Array<[string, string]> }> = [
        { id: 'learn', label: '学习', items: [['dashboard', '📊 仪表盘'], ['exam', '⏱ 模考']] },
        { id: 'bank', label: '题库', items: [['papers', '📚 真题卷'], ['topics', '🎯 专题']] },
        { id: 'review', label: '复盘', items: [['wrongbook', '📕 错题本'], ['graph', '🕸️ 图谱'], ['obs', '📡 可观测']] },
        { id: 'admin', label: '管理', items: [['repos', '📦 题库管理']] },
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
          // cycle-24 P0-2：唯一分发点 —— 注册表驱动，未知视图渲染 null（导航只暴露已登记 id）
          // R9 保留：routeEl 经 h(Comp, props) 挂载（key 含 tick → 切换/重入干净重挂载）
          routeEl))
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
    /**
     * cycle-13 对话窗口瘦身：右侧 tab 精简正文（引导卡 + 学习摘要 + 快捷入口）。
     * 此前同源通道直接把完整 KaogongMainPanel（七视图全家桶）塞进右侧 tab，
     * 空间局促且与左栏面板功能重复。现在：完整功能收敛到左栏「考公学习」沉浸面板，
     * 右侧只做轻量摘要 —— /api/stats 单端点取数，字段全部可选降级（缺什么藏什么）。
     * R9：真组件 + h() 挂载，hook 数恒定（useState×2 + useEffect×1）。
     */
    function KaogongTabHome({ wsKey, t, channel, reloadKey }) {
      const [stats, setStats] = React.useState(null)
      const [goHint, setGoHint] = React.useState('')
      React.useEffect(() => {
        let cancelled = false
        setStats(null)
        ;(async () => {
          try {
            const r = await fetch(`${channel.base}/api/stats?ws=${encodeURIComponent(wsKey)}`, { signal: AbortSignal.timeout(4000) })
            const j = await r.json()
            if (!cancelled) setStats(j && typeof j === 'object' ? j : null)
          } catch { if (!cancelled) setStats(null) }
        })()
        return () => { cancelled = true }
      }, [channel, wsKey, reloadKey])
      // 快捷入口：写入视图偏好（左栏面板挂载时读取同一 localStorage 键）+ 提示语
      const go = (view: string, label: string) => {
        try { localStorage.setItem('kg-native-view', view) } catch { /* 隐私模式等场景静默 */ }
        setGoHint('已定位「' + label + '」— 打开左栏「考公学习」面板即可直达')
      }
      const wrongOpen = stats && stats.wrong && typeof stats.wrong.open === 'number' ? stats.wrong.open : null
      const SUMMARY = [
        stats && typeof stats.answered === 'number' ? [stats.answered, '累计答题', '#10b981'] : null,
        stats && typeof stats.rate === 'number' ? [stats.rate + '%', '总体正确率', '#6366f1'] : null,
        stats && typeof stats.day === 'number' ? ['D' + stats.day, '计划进度', '#f59e0b'] : null,
        wrongOpen !== null ? [wrongOpen, '待消灭错题', '#ef4444'] : null,
      ].filter(Boolean)
      const QUICK = [
        ['topics', '🎯 专题练习', '专题'],
        ['papers', '📚 真题卷', '真题卷'],
        ['exam', '⏱ 整卷模考', '模考'],
        ['wrongbook', '📕 错题本', '错题本'],
        ['graph', '🕸️ 知识图谱', '图谱'],
      ]
      return h('div', { className: 'kg-tabhome' },
        // 引导卡
        h('div', { style: { background: 'linear-gradient(135deg,rgba(99,102,241,.10),rgba(139,92,246,.08))', border: '1px solid rgba(99,102,241,.25)', borderRadius: 12, padding: '14px 16px', margin: 12 } },
          h('div', { style: { fontWeight: 800, fontSize: 14.5 } }, '📚 ' + t('title')),
          h('div', { style: { fontSize: 11.5, color: '#64748b', marginTop: 5, lineHeight: 1.7 } }, t('guideDesc')),
          h('div', { style: { fontSize: 11, color: '#4f46e5', marginTop: 8, fontWeight: 600 } }, '完整功能（刷题 · 深度题库 · 申论评改 · 方法论 · 可观测）请打开左栏「考公学习」面板')),
        // 学习摘要（字段可选降级：无数据时整块隐藏）
        SUMMARY.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(72px,1fr))', gap: 8, margin: '0 12px 12px' } },
          SUMMARY.map(([v, l, c]: any, i: number) => h('div', { key: i, style: { background: 'var(--surface-card,#fff)', border: '1px solid rgba(148,163,184,.15)', borderRadius: 10, padding: '10px 4px', textAlign: 'center' } },
            h('div', { style: { fontSize: 17, fontWeight: 800, color: c } }, String(v)),
            h('div', { style: { fontSize: 10, color: '#64748b', marginTop: 2 } }, l))))
          : h('div', { style: { fontSize: 11.5, color: '#94a3b8', margin: '0 12px 12px' } }, '学习摘要暂不可用（服务未就绪或暂无数据）'),
        // 快捷入口
        h('div', { style: { margin: '0 12px 12px' } },
          h('div', { style: { fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 } }, '快捷入口'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            QUICK.map(([view, label, short]) => h('button', {
              key: view, className: 'kg-navbtn', onClick: () => go(view, short),
            }, label))),
          goHint ? h('div', { style: { fontSize: 11, color: '#10b981', marginTop: 8 } }, goHint) : null))
    }
    /** 右侧 tab 正文：同源优先原生精简体，端口兜底 iframe */
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
          // cycle-13 对话窗口瘦身：不再内嵌完整面板，改为引导卡 + 摘要 + 快捷入口
          h('div', { className: 'kg-frame', style: { overflowY: 'auto' } },
            h(KaogongTabHome, { wsKey, t, channel, reloadKey, key: reloadKey })))
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
          .kg-tabhome{flex:1;min-height:0;display:block;width:100%}
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

        // ── cycle-13 对话窗口瘦身：会话输入区「练题」控件（conversation.input.left）已随
        // 对应组件一并下线 —— 对话窗口回归纯对话，练题全部收敛到左栏面板 ──

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