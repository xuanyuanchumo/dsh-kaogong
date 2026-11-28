/**
 * host/ai-bridge.ts — 宿主 AI 能力桥（issue #4 阶段 4 · v1.36）
 *
 * ── 定位 ──
 * 把宿主的 `ctx.llm` / `ctx.attachments` 包装成 server 层可注入的 AiBridge（见
 * server/imageSearchApi.ts 的接口）。**唯一**触碰宿主 AI 服务的地方，零 import 宿主包
 * （duck typing），保持插件零 npm 运行时依赖。
 *
 * ── DSH 规范依据（dsh-plugin-dev-kb）──
 * · `ctx.llm.listProviders(): LlmProviderInfo[]` / `listModels(provider): Promise<LlmModelInfo[]>`
 * · `ctx.attachments.admitPromptContent(parts): Promise<AdmittedPromptContentPart[]>`
 *   —— 把 `{type:'image',mediaType,data(base64),name}` 持久化为 `{type:'image',attachment:ref}`
 * · `ctx.llm.stream({provider,model,messages:[{role:'user',content:[...]}]})` → AsyncIterable<StreamChunk>
 *   —— 拼接 `{type:'text-delta',text}` 得到模型输出；`finish {kind:'error'}` 按 code 降级。
 * · 辅助请求用 `RequestUserInput`（无 id/source）+ `system` 提示词，不写会话日志（一次性调用）。
 *
 * ── 可重建性纪律 ──
 * 本桥发起的是**辅助一次性请求**（图片识别），不进会话日志、不冒充 agent loop 请求；
 * purpose 不声明（空 LlmRequestPurposeMap），适配器视为普通辅助调用。
 */

import type { AiBridge } from '../server/imageSearchApi.js'

/** 结构化抽取的系统提示词（要求 JSON-only，字段固定，便于稳健解析） */
const SYSTEM_PROMPT = `你是一名考公题目解析助手。用户上传一道题目的图片，请识别并输出严格的 JSON（不要输出 JSON 以外的任何文字、不要 markdown 围栏）。

字段规范：
- "stem": 题干文字（逐字转录；图形推理通用题干也要写出）
- "chartData": 资料分析图表里的数据（表格/柱状图/折线图的数值与标签；非资料分析填空字符串）
- "figureFeatures": 图形推理的规律特征描述（如"元素组成相同、位置规律-平移"、"面数量0,1,2,3"、"对称+曲直"；非图推填空字符串）
- "module": 从[政治理论,常识判断,言语理解与表达,数量关系,判断推理,资料分析]中选一个最匹配的
- "kind": "ziliao"（资料分析图表题）| "tuxing"（图形推理）| "auto"（其它）

只输出 JSON 对象，五个字段都要有。`

/**
 * 从 llm.stream 的 chunk 流里拼出可见文本（只认 text-delta，忽略 reasoning/tool/usage）。
 *
 * finish 形状以**当前安装版本**的权威类型为准（dsh-llm types.ts）：
 *   { type:'finish', reason: FinishReason }，reason 为 'stop' 等字符串，
 *   或 { kind:'error'|'aborted', failure:{code,...} } 对象。
 * 同时兼容旧形态的顶层 kind/failure（KB prose 与 type-equiv 曾有张力）——两种都识别，绝不吞错。
 */
export async function collectText(stream: AsyncIterable<any>): Promise<string> {
  let out = ''
  let finishError: string | null = null
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
    if (chunk.type === 'finish') {
      const reason = chunk.reason
      const candidate = (reason && typeof reason === 'object') ? reason : chunk
      const kind = candidate && candidate.kind ? candidate.kind : (typeof reason === 'string' ? reason : '')
      if (kind === 'error' || kind === 'aborted') {
        const code = candidate.failure && candidate.failure.code ? candidate.failure.code : 'UNKNOWN'
        finishError = String(code)
      }
    }
  }
  if (finishError) throw new Error('模型调用失败(' + finishError + ')')
  return out
}

/**
 * 装配 AiBridge。ctx 宿主上下文；任一服务缺失时返回 null（上层诚实降级）。
 * 不抛错——服务暂未就绪不能拖垮插件加载。
 */
export function createAiBridge(ctx: any): AiBridge | null {
  let llm: any = null
  try { llm = ctx.get('llm') } catch { /* 未声明/未就绪 */ }
  if (!llm || typeof llm.stream !== 'function') return null
  // attachments 未在 inject 声明（避免 R11b 风险面扩大），延迟到 analyze 调用时才取，
  // 届时宿主 attachment-local 早已激活（base 组合常驻）。
  const getAttachments = () => {
    try { return ctx.get('attachments') } catch { return null }
  }

  return {
    listProviders() {
      try {
        const ps = typeof llm.listProviders === 'function' ? llm.listProviders() : []
        return Array.isArray(ps) ? ps.map((p: any) => ({ id: String(p && p.id || ''), name: p && p.name ? String(p.name) : undefined })).filter((p: any) => p.id) : []
      } catch { return [] }
    },
    async listModels(provider: string) {
      if (typeof llm.listModels !== 'function') return []
      const ms = await llm.listModels(provider)
      return Array.isArray(ms) ? ms.map((m: any) => ({
        id: String(m && m.id || ''),
        name: m && m.name ? String(m.name) : undefined,
        inputModalities: Array.isArray(m && m.inputModalities) ? m.inputModalities.map(String) : undefined,
      })).filter((m: any) => m.id) : []
    },
    async analyze(opts) {
      const attachments = getAttachments()
      if (!attachments || typeof attachments.admitPromptContent !== 'function') {
        throw new Error('宿主未提供附件服务，无法上传图片')
      }
      // 1) 图片持久化：base64 → 不可变 ImageAttachmentRef
      const admitted: any[] = await attachments.admitPromptContent([
        { type: 'image', mediaType: opts.mediaType, data: opts.imageBase64, name: 'question-image' },
      ])
      const imagePart = admitted.find((p: any) => p && p.type === 'image')
      if (!imagePart || !imagePart.attachment) throw new Error('图片持久化失败')

      // 2) 构造一次性辅助请求（system 提示 + 图片块 + 文本指令）
      const kindHint = opts.kind === 'ziliao'
        ? '这是资料分析图表题，请重点读取图表数据到 chartData。'
        : opts.kind === 'tuxing'
          ? '这是图形推理题，请重点描述图形规律特征到 figureFeatures。'
          : '请自动判断题型（资料分析图表 / 图形推理 / 其它）。'
      const content: any[] = [
        imagePart,
        { type: 'text', text: kindHint + (opts.hint ? '\n补充：' + String(opts.hint).slice(0, 500) : '') + '\n请输出 JSON。' },
      ]
      const stream = llm.stream({
        provider: opts.provider,
        model: opts.model,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        maxTokens: 1200,
        temperature: 0,
      })
      return await collectText(stream)
    },
  }
}
