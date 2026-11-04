/**
 * host/index.js — Cordis Host 半 · v1.4
 *
 * 职责（生产/注册侧）：
 *  1. 宿主同源路由：ctx.webServer.register({kind:'prefix',path:'/kaogong'})
 *     → UI/API 走宿主同源（无 CORS、继承宿主认证、无端口依赖）——主通道
 *  2. 兜底独立端口：async startServer（adopt/降级），webServer 缺席（Electron）或测试时用
 *  3. 注册 4 个可选 AI 工具（ToolDefinition.output 为宿主硬约束）
 *  4. 卸载时关自己 new 的 server 并注销路由（adopt 实例归原主）
 * 能力声明唯一来源：shared/manifest.js（UI/可观测/文档三方共用）。
 */

import { startServer, attachWebRoute } from '../server/http.js'
import { CAPABILITIES } from '../shared/manifest.js'

/** T-022：Object.entries 在动态对象上会退化为 unknown，统一走此辅助保持 any 语义 */
const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

const PREFERRED_PORT = 8400
const MOUNT_PATH = '/kaogong'   // 宿主同源路由前缀（与 client 半的契约）
const runtime = { port: null, server: null, adopted: false, boot: 'pending', tools: 0, mounted: false }

// 工具输出契约：canonical JSON {text} → 模型内容块
const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  render(_args, value) { return [{ type: 'text', text: value.text }] },
}

function base() { return `http://127.0.0.1:${runtime.port || PREFERRED_PORT}` }

async function callApi(path: any, ws?: any): Promise<any> {
  const url = new URL(base() + path)
  if (ws) url.searchParams.set('ws', ws)
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  return res.json()
}

export const name = CAPABILITIES.plugin.name
export const inject = ['tools']

export function apply(ctx) {
  // ── 主通道：宿主同源路由 ──
  // R10 修复（沙箱首启取证）：webServer 晚于本 fiber 激活 —— ctx.get 首启拿不到、
  // ctx.on('webServer') 不是事件永不触发 → 路由静默 404。
  // 正解 = ctx.inject(['webServer'], cb)：服务可用后才运行回调；服务变化时框架
  // 先卸载（运行本回调返回的 disposer）再重跑 → 天然消灭热重载双代竞态窗口。
  ctx.inject(['webServer'], (injected) => {
    const ws = injected.get('webServer')
    if (!ws?.register) return
    try {
      const unmount = attachWebRoute(ws, MOUNT_PATH)
      runtime.mounted = true
      console.log(`[dsh-kaogong] 🏠 宿主同源路由已挂载: ${MOUNT_PATH}/*`)
      return () => {
        try { unmount() } catch {}
        runtime.mounted = false
      }
    } catch (e) {
      // 受控降级：独立端口兜底仍在；绝不击杀宿主
      console.error(`[dsh-kaogong] 路由挂载失败(${e.message})，降级独立端口模式`)
    }
  })

  // ── 兜底通道：独立端口（Electron 无 webServer / 测试 / 降级）──
  let myServer = null, myAdopted = false
  startServer(PREFERRED_PORT)
    .then(({ server, port, adopted }) => {
      myServer = server; myAdopted = adopted
      runtime.server = server
      runtime.port = port
      runtime.adopted = adopted
      runtime.boot = 'ready'
      console.log(`[dsh-kaogong] 📚 学习平台就绪: ${base()} (${adopted ? 'adopt 既有实例' : '新绑定'})`)
    })
    .catch((e) => {
      runtime.boot = 'failed'
      console.error(`[dsh-kaogong] 服务启动失败(${e.code || 'ERR'}): ${e.message}`)
    })

  ctx.tools.register({
    name: 'kaogong_launch',
    description: '考公学习平台状态与引导（全部字段实时取自服务，非硬编码）。平台双入口：左栏「考公学习」全屏面板 + 右侧 Sidebar 标签。完全离线可用；题库数据未就绪时引导用户到「📦 题库管理」一键安装。',
    parameters: { type: 'object', properties: { workspace: { type: 'string', description: '可选：当前项目工作区绝对路径（用于隔离进度查询）' } } },
    output: textOutput,
    async execute(args) {
      // cycle-17：消灭「工具输出陈旧显示」——视图/工具/端点/仓库/数据根全部来自
      // /api/capabilities + /api/status + /api/repos 实时数据，杜绝手写模板漂移
      let status: any = { app: 'down' }, caps: any = null, repos: any = null
      try { status = await callApi('/api/status', args.workspace) } catch {}
      try { caps = await callApi('/api/capabilities') } catch {}
      try { repos = await callApi('/api/repos', args.workspace) } catch {}
      const up = status.app === CAPABILITIES.plugin.name
      const views: string[] = ((caps && caps.views) || []).map((v: any) => v.label)
      const toolsN = ((caps && caps.tools) || []).length
      const epN = ((caps && caps.endpoints) || []).length
      const lines = [
        `## 📚 考公学习平台 · v${(caps && caps.plugin && caps.plugin.version) || CAPABILITIES.plugin.version}`,
        `**服务状态**: ${up ? `✅ ${base()}（同源路由 ${MOUNT_PATH}/* · 运行 ${status.uptimeSec}s · pid ${status.pid}）` : `❌ 未就绪（宿主启动=${runtime.boot}；查看 data/runtime.json 与 lifecycle.jsonl）`}`,
        `**数据根**: ${status.repoRoot || '—'}（${repos && repos.rootSource === 'config' ? '自定义' : '自动解析'}）`,
        `**GUI 入口**: 左栏「考公学习」全屏面板（主）+ 右侧边栏标签摘要（引导页亦有入口）`,
        '',
        `### 离线功能（${views.length} 视图 · ${epN} 端点 · 实时清单）`,
        views.length ? '- ' + views.join(' · ') : '- （能力矩阵未就绪）',
        '',
        `### AI 增强（可选 · ${toolsN} 工具）`,
        '- 素材供模型加工模式；离线核心与模型解耦（无模型全部功能可用）',
      ]
      if (up && repos) {
        const miss = (repos.summary && repos.summary.requiredMissing) || []
        lines.push('', `### 题库数据：${repos.summary.present}/${repos.summary.total} 仓库就绪`)
        if (miss.length) lines.push(`⚠️ 必选缺失：${miss.join('、')} —— 打开「📦 题库管理」一键安装必选包（约 363MB，国内可先配 gh-proxy 镜像）`)
        else lines.push('✅ 必选/推荐数据齐备')
      }
      if (up && status.progress) lines.push('', `**当前进度**：第${status.progress.day}天 · ${status.progress.answered}题 · 正确率${status.progress.rate}%`)
      return { text: lines.join('\n') }
    },
  })

  ctx.tools.register({
    name: 'kaogong_ai_tutor',
    description: '【可选·需模型】AI辅导：按模块/题型拉取方法论与知识片段，供模型讲解错题。离线场景请直接使用GUI「方法论」「知识检索」视图。',
    parameters: {
      type: 'object',
      properties: {
        module: { type: 'string', description: '模块：政治理论/常识判断/言语理解与表达/数量关系/判断推理/资料分析' },
        question_type: { type: 'string', description: '具体题型（如图形推理/逻辑填空/截位直除）' },
        error_pattern: { type: 'string', description: '错误模式描述' },
        workspace: { type: 'string', description: '可选：工作区路径（隔离）' },
      },
      required: ['module'],
    },
    output: textOutput,
    async execute(args) {
      let method: any = {}, search = { results: [] }
      try { method = await callApi(`/api/method?topic=${encodeURIComponent('行测')}`, args.workspace) } catch {}
      try { search = await callApi(`/api/search?q=${encodeURIComponent(args.question_type || args.module)}`, args.workspace) } catch {}
      const lines = [
        `## AI辅导素材 — ${args.module}${args.question_type ? ' · ' + args.question_type : ''}\n`,
        '### 方法论参考', method.content ? method.content.slice(0, 3000) : '（服务未就绪）',
        '\n### 相关知识', search.results?.length ? search.results.slice(0, 3).map(r => `**${r.file}**\n${r.snippet}`).join('\n\n') : '（无命中）',
      ]
      if (args.error_pattern) lines.push(`\n### 错误模式\n${args.error_pattern}\n请针对该模式给出可执行的改进建议。`)
      return { text: lines.join('\n') }
    },
  })

  ctx.tools.register({
    name: 'kaogong_ai_plan',
    description: '【可选·需模型】拉取当前工作区的学习进度与各模块正确率，供模型生成个性化建议。离线看GUI仪表盘。',
    parameters: { type: 'object', properties: { workspace: { type: 'string', description: '工作区路径（隔离命名空间）' } } },
    output: textOutput,
    async execute(args) {
      let p: any = {}
      try { p = await callApi('/api/progress', args.workspace) } catch {}
      const lines = ['## 学习进度素材', `第${p.day || 1}天 | 已答${p.answered || 0}题 | 正确率${p.rate || 0}%\n`]
      if (p.byModule && Object.keys(p.byModule).length) {
        const sorted = entries(p.byModule)
          .sort((a, b) => (a[1].answered ? a[1].correct / a[1].answered : 0) - (b[1].answered ? b[1].correct / b[1].answered : 0))
        lines.push('### 各模块（按弱到强）')
        for (const [mod, s] of sorted) {
          const rate = s.answered ? Math.round(s.correct / s.answered * 100) : 0
          lines.push(`- ${mod}: ${s.correct}/${s.answered} (${rate}%) ${rate < 60 ? '⚠️薄弱' : rate < 80 ? '一般' : '良好'}`)
        }
        lines.push(`\n最薄弱: ${sorted[0][0]}，建议今天重点训练并复盘错题。`)
      } else lines.push('暂无练习记录，建议从「判断推理」或「言语理解」开始。')
      return { text: lines.join('\n') }
    },
  })

  ctx.tools.register({
    name: 'kaogong_ai_shenlun',
    description: '【可选·需模型】申论批改素材：提交题目与作答，附带申论方法论参考供模型评分。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '申论题目' },
        answer: { type: 'string', description: '用户作答' },
        workspace: { type: 'string', description: '工作区路径（隔离）' },
      },
      required: ['question', 'answer'],
    },
    output: textOutput,
    async execute(args) {
      let method: any = {}
      try { method = await callApi('/api/method?topic=申论', args.workspace) } catch {}
      const lines = [
        '## 申论批改请求', '### 题目', args.question, '\n### 作答', args.answer,
        '\n### 方法论参考', method.content ? method.content.slice(0, 4000) : '（服务未就绪）',
        '\n请批改：1.采分点 2.结构 3.语言 4.参考要点 5.改进建议',
      ]
      return { text: lines.join('\n') }
    },
  })

  // v1.7 可选模型深度评估：离线规则给基线分，模型给主观题深度点评
  ctx.tools.register({
    name: 'kaogong_ai_essay_review',
    description: '【可选·需模型】申论/大作文深度点评：先取离线规则评分（要点覆盖/结构/论证/字数分档），再连同方法论参考交给模型做主观题深度评估。无模型时请直接用 GUI「申论」视图的离线评分。',
    parameters: {
      type: 'object',
      properties: {
        paperId: { type: 'string', description: '试卷 id（如 国考/2009/申论-副省级）；与 question 二选一' },
        no: { type: 'number', description: '题号（配合 paperId）' },
        question: { type: 'string', description: '直接给题目文本（无试卷时）' },
        answer: { type: 'string', description: '用户作答' },
        mode: { type: 'string', description: 'essay=小题(采分点制) / article=大作文(结构论证制)，默认自动判断' },
        workspace: { type: 'string', description: '工作区路径（隔离）' },
      },
      required: ['answer'],
    },
    output: textOutput,
    async execute(args) {
      const isArticle = args.mode === 'article'
      // 取离线基线分（POST 到本地规则引擎）
      let baseline = null
      try {
        const url = new URL(base() + (isArticle ? '/api/essay/article' : '/api/essay/grade'))
        if (args.workspace) url.searchParams.set('ws', args.workspace)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paperId: args.paperId, no: args.no, question: args.question, answer: args.answer }),
          signal: AbortSignal.timeout(15000),
        })
        baseline = await res.json()
      } catch (e) { baseline = { error: e.message } }

      let method: any = {}
      try { method = await callApi('/api/method?topic=申论', args.workspace) } catch {}

      const lines = [
        '## 申论深度点评请求（离线基线 + 方法论）\n',
        '### 用户作答', args.answer,
        '\n### 离线规则评分（基线）',
        baseline && !baseline.error
          ? [
              `**得分**: ${baseline.score} / ${baseline.max}`,
              `**字数**: ${baseline.chars}${baseline.limit ? ' / 限 ' + baseline.limit : ''}${baseline.lengthBand ? '（' + baseline.lengthBand + '）' : ''}`,
              '**维度**: ' + JSON.stringify(baseline.dims || {}),
              baseline.hitTerms && baseline.hitTerms.length ? '**已覆盖采分点**: ' + baseline.hitTerms.join('、') : '',
              baseline.missingTerms && baseline.missingTerms.length ? '**可能遗漏**: ' + baseline.missingTerms.join('、') : '',
              baseline.elements ? '**结构要素**: ' + JSON.stringify(baseline.elements) : '',
              '**规则建议**: ' + (baseline.feedback || []).join('；'),
            ].filter(Boolean).join('\n')
          : '（离线评分不可用：' + (baseline && baseline.error) + '）',
        '\n### 申论方法论参考', method.content ? method.content.slice(0, 3000) : '（未取到）',
        '\n---\n请基于以上基线分与方法论，做主观题深度点评：',
        '1. 采分点覆盖度复核（规则可能误判，请按题意判断）',
        '2. 结构与逻辑（总分关系、分论点质量）',
        '3. 语言与规范（书面语、字数控制）',
        '4. 参考要点补充（列出应写而未写的）',
        '5. 提分建议（按优先级，可执行）',
      ]
      return { text: lines.filter(Boolean).join('\n') }
    },
  })
  runtime.tools = 5

  // ── 卸载清理：只关本代自己 new 的 server（adopt 归原主）──
  // 路由注销不再需要手动处理：ctx.inject 子 fiber 随本 fiber 卸载，框架先跑其
  // disposer 再销毁（R10：disposer 生命周期归框架，天然无跨代竞态）。
  // 闭包捕获本代 myServer（R7：模块级 runtime 跨代共享，不可用于清理判定）。
  if (ctx.effect) {
    ctx.effect(() => () => {
      try { if (myServer && !myAdopted) myServer.close() } catch {}
    }, 'kaogong server cleanup')
  }

  console.log(`[dsh-kaogong] Host 插件已加载 (${CAPABILITIES.plugin.version}) · 离线UI + ${runtime.tools} 可选AI工具`)
}
