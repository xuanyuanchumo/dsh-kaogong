/**
 * shared/types.ts —— 跨半共享的类型契约（T-022）
 *
 * 约定：本文件只放**类型**，无运行时导出。
 * - host/server/adapters 可用运行时 import（tsc 直接擦除）
 * - client 半必须用 `import type`（verbatimModuleSyntax 保证完全擦除，
 *   使 client.ts 编译产物仍是纯脚本 combo 格式，不产生任何 import 语句）
 *
 * 修改本文件 = 修改跨端契约，必须同步：server 实现 / client 消费 / smoke 断言。
 */

// ── 题目 ────────────────────────────────────────────────────────

/** 选择题选项：{ A: '选项文本', B: ... } */
export type QuestionOptions = Record<string, string>

/** 统一题目形态（题库 / 真题卷 / 深度题库 三方共用） */
export interface Question {
  id?: string | number
  number?: number | null
  no?: number
  module: string
  type?: string
  /** 考点定位（深度题库专有，100% 覆盖） */
  kadian?: string
  region?: string
  year?: string | number
  exam?: string
  stem: string
  options: QuestionOptions
  correctAnswer: string | null
  analysis?: string
  /** 以下为深度题库五维标注 */
  reasoning?: string
  fastest?: string
  pitfalls?: string
  mother?: string
  hasImage?: boolean
  imgRefs?: string
  /** 错题本回炉标记 */
  fromWrongBook?: boolean
  box?: number
  source?: string
  /** 申论专有 */
  score?: number | null
  requirement?: string
  relatedMaterials?: string
  reference?: string
}

// ── 试卷 ────────────────────────────────────────────────────────

export interface PaperMaterial {
  no: number
  text: string
}

export interface PaperMeta {
  id: string
  exam: string
  region: string
  year: number | null
  subject: string
  paperType: string
  questionCount: number
  imageCount: number
  verified: boolean
  source?: string
  relPath?: string
}

export interface PaperDetail extends Partial<PaperMeta> {
  nature?: string
  materials: PaperMaterial[]
  questions: Question[]
  error?: string
}

export interface SubjectAggregate {
  subject: string
  count: number
  questionTotal: number
  years: number[]
  exams: string[]
}

export interface PaperIndex {
  papers: PaperMeta[]
  subjects: SubjectAggregate[]
  total: number
  builtAt?: string
}

// ── 专题树 ──────────────────────────────────────────────────────

/** 统一练习路由：点击专题后跳到哪个视图、带什么参数 */
export interface PracticeEntry {
  view: string
  params?: Record<string, string>
}

export interface Topic {
  id: string
  channel?: string
  kind: 'module' | 'category' | 'essay-type' | 'subject'
  title: string
  desc?: string
  questionCount?: number | null
  papers?: number | null
  years?: number[]
  entry?: PracticeEntry
}

export interface Channel {
  id: string
  name: string
  icon: string
  desc: string
  topics: Topic[]
  entries: Array<{ label: string } & PracticeEntry>
}

export interface TopicTree {
  channels: Channel[]
  stats: {
    paperTotal: number
    essayPapers: number
    xingcePapers: number
    naokuTotal: number
    kadianCoverage?: number
  }
}

// ── 评分 ────────────────────────────────────────────────────────

export interface EssayGradeResult {
  score: number
  max: number
  chars: number
  limit: number | null
  dims: { coverage: number; structure: number; length: number; language: number }
  hitTerms: string[]
  missingTerms: string[]
  feedback: string[]
  referenceAvailable: boolean
  error?: string
}

export interface ArticleGradeResult {
  score: number
  max: number
  chars: number
  limit: number
  lengthBand: string
  lengthPenalty: number
  dims: { structure: number; argument: number; language: number }
  elements: {
    hasOpening: boolean
    subPoints: number
    hasEnding: boolean
    argMarkers: number
    longSentences: number
  }
  feedback: string[]
  error?: string
}

// ── 模考 ────────────────────────────────────────────────────────

export interface ExamSession {
  id: string
  exam: string
  year: number | null
  subject: string
  paperType: string
  questionCount: number
  totalScore: number
  durationSec: number
  /** 注意：题目不含答案（防作弊） */
  questions: Array<Pick<Question, 'no' | 'stem' | 'score' | 'options'>>
  startedAt: string
}

export interface ExamModuleStat {
  type: string
  total: number
  answered: number
  correct: number
  rate: number
  score: number
}

export interface ExamReport {
  id: string
  subject: string
  year: number | null
  answered: number
  correct: number
  rate: number
  scored: number
  totalScore: number
  elapsedSec: number
  durationSec: number
  modules: ExamModuleStat[]
  detail: Array<{
    no: number
    type: string
    mine: string | null
    right: string | null
    isCorrect: boolean
    score: number
  }>
}

// ── 进度 ────────────────────────────────────────────────────────

export interface WrongBookEntry {
  sig: string
  module: string
  stem: string
  box: number
  streak: number
  addedAt: number
  lastAt: number
}

export interface Progress {
  day: number
  answered: number
  correct: number
  wrong: number
  rate: number
  days: Array<{ date: string; count: number; correct: number }>
  mastery: Record<string, { answered: number; correct: number }>
  wrongBook: WrongBookEntry[]
  essayRecords?: Array<{
    ts: number
    paperId: string | null
    no: number | null
    chars: number
    score: number
    max: number
    ratio: number
    mode?: string
  }>
  examRecords?: Array<{
    ts: number
    paperId: string
    subject: string
    year: number | null
    answered: number
    correct: number
    rate: number
    scored: number
    totalScore: number
    elapsedSec: number
  }>
}

// ── 核心响应 ────────────────────────────────────────────────────

export interface StatusResponse {
  app: string
  version: string
  port: number
  pid: number
  uptimeSec: number
  repos: { ready: number; total: number }
  db?: boolean
  ws: string
  progress?: Partial<Progress>
}

export interface CheckResponse {
  isCorrect: boolean
  correctAnswer: string | null
  analysis?: string
  wrongEvent?: { type: 'collected' | 'promoted' | 'mastered'; box?: number } | null
  progress?: Partial<Progress>
}

export interface NaokuStatus {
  ready: boolean
  failed?: boolean
  path?: string | null
  hint?: string | null
  stats?: {
    total: number
    withKadian: number
    withFastest: number
    withPitfalls: number
    withImage: number
    kadianCoverage: number
    fastestCoverage: number
    modules: Array<{ m: string; c: number }>
    categories: Array<{ k: string; c: number }>
  } | null
}

// ── 端点/能力（manifest 消费） ─────────────────────────────────

export interface EndpointDecl {
  path: string
  label: string
  consumers: string[]
}

export interface ViewDecl {
  id: string
  label: string
}

export interface ToolDecl {
  name: string
  class: string
  depends?: string[]
}

/** 域 handler 统一签名：返回对象=响应，返回 undefined=不归我管 */
export type ApiHandler = (
  path: string,
  params: URLSearchParams,
  post: Record<string, unknown>,
  method: string,
  wsRaw?: string,
) => unknown
