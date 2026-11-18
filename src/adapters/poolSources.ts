/**
 * adapters/poolSources.ts — 摄入源注册表（可扩展性）
 *
 * ── 为什么单独成文件（可扩展性 + 可维护性）──
 *   研究 14 §4.1：「新增一个题库只需写一个 adapter，不改任何内核逻辑」。
 *   ���注册表把「源清单」从摄入主流程里**抽出来**：
 *   新增一个源 = 往注册表加一条 + 写一个 ingest 函数，**主流程零改动**。
 *
 *   若把源清单写死在 poolIngest.ts 的 if/else 里，每加一个源都要改主流程
 *   → 改一个地方 = 十个地方可能漏（可维护性反模式）。
 *
 * ── 源契约（SourceSpec）──
 *   每个源声明：
 *   · id/tier/label —— 身份与展示（面板据此渲染，不硬编码）
 *   · available(ctx) —— 是否可用（探针；不可用**降级**不报错）
 *   · ingest(ctx)    —— 执行摄入（返回计数）
 *
 * ── 边界纪律 ──
 *   源实现**只允许**认识上游格式（适配层职责）；
 *   存储层与内核层不认识任何具体上游。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ingestNaokuSource, ingestXingceSource } from './poolSourceImpls.js'

/** 源上下文（注入给每个源实现；源不应自己去找路径） */
export interface SourceContext {
  /** 题库数据根（上游仓库的父目录） */
  repoRoot: string
  /** 用户数据根（`.naoku.db` 等派生库所在处） */
  dataDir: string
  /** 目标库连接 */
  db: any
  /** 本源摄入选项（maxFiles 等） */
  opts: { maxFiles?: number }
}

/** 源计数（各源统一返回形状——面板可按同一模板渲染） */
export interface SourceCounts {
  questions: number
  relations: number
  files?: number
  materials?: number
  appearances?: number
  reviews?: number
  skipped?: boolean
  reason?: string
  lastError?: string
}

/** 源规格（注册表条目） */
export interface SourceSpec {
  /** 源 id（存储层 source_id / question.source_id 的取值） */
  id: string
  /** 分级：required（必选）/ recommended（推荐）/ optional（可选） */
  tier: 'required' | 'recommended' | 'optional'
  /** 面板展示名 */
  label: string
  /** 上游地址（白盒透出，用户可溯源） */
  upstream?: string
  /** 是否可用（探针；返回 false 时主流程记 skipped 并继续——**不中断整轮**） */
  available(ctx: SourceContext): boolean
  /** 执行摄入（可同步或异步——naoku 需 await import('node:sqlite')） */
  ingest(ctx: SourceContext): SourceCounts | Promise<SourceCounts>
}

/**
 * 源注册表（单一事实源）。
 *
 * 新增源的唯一步骤：
 *   ① 在 `poolSourceImpls.ts` 写 `ingestXxxSource(ctx)`
 *   ② 在此数组加一条 { id, tier, label, available, ingest }
 *   —— 摄入主流程、面板、统计、守卫**全部零改动**。
 */
export const SOURCE_REGISTRY: SourceSpec[] = [
  {
    id: 'naoku',
    tier: 'required',
    label: '深度题库（GongkaoNaoku）',
    upstream: 'https://github.com/Hongyy177/GongkaoNaoku',
    available: (ctx) => existsSync(join(ctx.dataDir, '.naoku.db')),
    ingest: (ctx) => ingestNaokuSource(ctx),
  },
  {
    id: 'xingcezhenti',
    tier: 'required',
    label: '行测真题库（xingcezhenti）',
    upstream: 'https://github.com/HuangJunJie/xingcezhenti',
    available: (ctx) => existsSync(join(ctx.repoRoot, 'xingcezhenti')),
    ingest: (ctx) => ingestXingceSource(ctx),
  },
]

/** 按 id 取源规格 */
export function findSource(id: string): SourceSpec | null {
  return SOURCE_REGISTRY.find(s => s.id === id) || null
}

/**
 * 摄入全部已注册源（主流程）。
 *
 * 纪律：
 * · **单源失败不中断整轮**（记 lastError + 继续）——一个上游格式变了不能拖垮整库；
 * · 每源独立事务（失败回滚该源，不留半成品源——设计 §9c.5）；
 * · 源清单来自注册表，不在此处硬编码（可扩展性）。
 */
export async function ingestAll(ctx: SourceContext): Promise<any> {
  const out: Record<string, any> = {}
  for (const spec of SOURCE_REGISTRY) {
    try {
      if (!spec.available(ctx)) {
        out[spec.id] = { source: spec.id, questions: 0, relations: 0, skipped: true, reason: '源不可用（数据缺失）' }
        continue
      }
      // ⚠️ 必须 await：源实现可能是同步也可能是异步（naoku 需 await import('node:sqlite')）。
      //   若漏 await，展开 Promise 对象只会得到 `{source:'naoku'}` —— 计数全丢、**静默少摄入**。
      //   （cycle-34 实测踩坑：症状是「摄入完成但题数为 0」。）
      out[spec.id] = { source: spec.id, ...(await spec.ingest(ctx)) }
    } catch (e: any) {
      out[spec.id] = {
        source: spec.id, questions: 0, relations: 0, skipped: true,
        reason: '摄入异常: ' + (e && e.message ? e.message : String(e)),
      }
    }
  }
  return out
}

/** 注册表快照（白盒透出：面板显示「已注册哪些源、各自状态」） */
export function registrySnapshot(ctx: { repoRoot: string, dataDir: string }): any[] {
  return SOURCE_REGISTRY.map(s => ({
    id: s.id, tier: s.tier, label: s.label, upstream: s.upstream || null,
    available: (() => { try { return !!s.available({ repoRoot: ctx.repoRoot, dataDir: ctx.dataDir } as any) } catch { return false } })(),
  }))
}
