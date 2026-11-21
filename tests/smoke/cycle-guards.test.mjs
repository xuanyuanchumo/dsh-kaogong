/**
 * tests/smoke/cycle-guards.test.mjs — cycle-26..33 形态守卫域（cycle-47 阶段 10 迁移·批二修正版）
 *
 * 从 smoke.test.mjs C29/C30/C30b/C31/C32/C33/C26/C28 段迁移（L2310-2474）。
 * 纯静态段（零 server）。判定逐字等价——判据事实源以旧文件为准（批二首版多处
 * 凭印象写判据导致假红，全部对照旧文件原文修正——「迁移=判据逐字等价+事实源同一」）。
 *
 * 运行：npx vitest run tests/smoke/cycle-guards.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const readSrc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const hostSrc29 = readSrc('src/host/index.ts')
const graphViewSrc = readSrc('src/client/views/graph-view.tsx')
const kitSrc30 = readSrc('src/client/question/question-kit.tsx')
const pvSrc30 = readSrc('src/client/views/papers-view.tsx')
const schedSrc30 = readSrc('src/server/planSchedule.ts')
const rmSrc31 = readSrc('src/server/repoManager.ts')
const pvSrc32 = pvSrc30
const histSrc33 = readSrc('src/server/historyApi.ts')
const svSrc33 = readSrc('src/client/views/study-view.tsx')
const ppSrc26 = readSrc('src/adapters/paperParse.ts')
const paSrc26 = readSrc('src/server/paperApi.ts')

test('C29-01..03 工具展示契约：kgToolCard 工厂 + 6 工具接线 + 纯函数防御 + 隐藏隔离键', () => {
  const cardCalls = (hostSrc29.match(/\.\.\.kgToolCard/g) || []).length
  expect(hostSrc29.includes('function kgToolCard') && hostSrc29.includes('presentCall') && hostSrc29.includes('presentResult') && cardCalls === 6,
    '接线数=' + cardCalls + '（应为 6）').toBe(true)
  expect((hostSrc29.match(/catch \{ return undefined \}/g) || []).length).toBeGreaterThanOrEqual(2)
  expect(hostSrc29.includes("k === 'workspace'")).toBe(true)
})

test('C29-04..08 图谱子图：消费闭环 + 面包屑 + 引擎换源 + 抽屉入口 + manifest 计数=6', () => {
  expect(graphViewSrc.includes('loadSubgraph') && graphViewSrc.includes('/graph/neighborhood') && graphViewSrc.includes('/graph/impact')).toBe(true)
  expect(graphViewSrc.includes('返回全图') && graphViewSrc.includes('子图模式') && graphViewSrc.includes('仍按全图口径')).toBe(true)
  expect(graphViewSrc.includes('nodes: activeNodes, edges: activeEdges') && graphViewSrc.includes('[raw, activeNodes, activeEdges]')).toBe(true)
  expect(graphViewSrc.includes('1跳邻域') && graphViewSrc.includes('2跳邻域') && graphViewSrc.includes('影响面')).toBe(true)
  const manifestSrc29 = readSrc('src/shared/manifest.ts')
  const manifestTools29 = (manifestSrc29.match(/name: 'kaogong_/g) || []).length
  expect(manifestTools29).toBe(6)
})

test('C30-01..05 browse 自答对照：交互分支 + 宿主态 + 对照条 + 答题卡同步 + 双源答案', () => {
  expect(kitSrc30.includes('interactive={isExam || isPractice || isBrowse}')).toBe(true)
  expect(kitSrc30.includes('isExam || isPractice || isBrowse ? onSelect')).toBe(true)
  expect(pvSrc30.includes('browseSel') && pvSrc30.includes('browseReveal') && pvSrc30.includes('setBrowseSel({})')).toBe(true)
  expect(pvSrc30.includes('data-kg-browse-reveal') && pvSrc30.includes('对照答案') && pvSrc30.includes('重做此题')).toBe(true)
  expect(kitSrc30.includes('browseAnswers') && kitSrc30.includes('(isBrowse && browseAnswers) ? browseAnswers')).toBe(true)
  expect(pvSrc30.includes('curQ.correctAnswer') && pvSrc30.includes('test(curQ.answer.toUpperCase())')).toBe(true)
})

test('C30b-01..04 排程纪律：SRS 同源弱度模型 + 纯函数确定性 + 四步纪律 + 崩溃安全', () => {
  expect(schedSrc30.includes('1 / (r + 0.15)') && schedSrc30.includes('(1 + (openTotal') && schedSrc30.includes('弱点×积压加权')).toBe(true)
  expect(!schedSrc30.includes('Math.random') && !schedSrc30.includes('Date.now')).toBe(true)
  const manifestSrc30 = readSrc('src/shared/manifest.ts')
  const httpSrc30 = readSrc('src/server/http.ts')
  const uiSrc30 = readSrc('src/ui/index.html')
  expect(manifestSrc30.includes('/api/plan/schedule') && httpSrc30.includes('/api/plan/schedule') && uiSrc30.includes('/api/plan/schedule')).toBe(true)
  expect(schedSrc30.includes('catch (e: any)') && schedSrc30.includes('计划为空')).toBe(true)
})

test('C31-01..03 解析 mode 分流 + 镜像回落直连 + 防环', () => {
  const kitSrc31 = kitSrc30
  expect(kitSrc31.includes("hideBeforeAnswer={mode === 'practice' || mode === 'exam'}") && kitSrc31.includes('if (!revealed && hideBeforeAnswer) {')).toBe(true)
  expect(rmSrc31.includes('auto-retry') && rmSrc31.includes('{ direct: true }') && rmSrc31.includes('opts.direct')).toBe(true)
  expect(rmSrc31.includes('!job.retriedFrom') && rmSrc31.includes('.retriedFrom = job.url')).toBe(true)
})

test('C32-01..04 三模式：切换条 + exam 域复用 + 学习揭示 + 换卷重置', () => {
  expect(pvSrc32.includes("useState('browse')") && pvSrc32.includes("setPaperMode('answer')") && pvSrc32.includes("setPaperMode('learn')") && pvSrc32.includes('data-kg-paper-mode')).toBe(true)
  expect(pvSrc32.includes('/paper/exam/start?id=') && pvSrc32.includes('/paper/exam/submit') && pvSrc32.includes('data-kg-answer-start') && pvSrc32.includes('data-kg-answer-submit')).toBe(true)
  expect(pvSrc32.includes('if (learnReveal) return') && pvSrc32.includes('data-kg-learn-next') && pvSrc32.includes('不支持在线判分')).toBe(true)
  expect(pvSrc32.includes('setLearnIdx(0)') && pvSrc32.includes('setAnswerExam(null)') && pvSrc32.includes('setLearnCorrectCount(0)')).toBe(true)
})

test('C33-01..04 补录真题卷通道 + 溯源元数据 + 错题本工作台', () => {
  expect(histSrc33.includes("matchSource: 'papers'") && histSrc33.includes('buildPaperIndex')).toBe(true)
  expect(histSrc33.includes('paperId: pp.id') && histSrc33.includes('paperFile: pp.id.split')).toBe(true)
  expect(svSrc33.includes('setModFilter') && svSrc33.includes("stateFilter === 'open'") && svSrc33.includes('当前筛选无条目')).toBe(true)
  expect(svSrc33.includes('<KgHistoryImport api={api} />') && svSrc33.includes('data-kg-wb-srs') && svSrc33.includes('data-kg-wb-import')).toBe(true)
  expect(svSrc33.includes('setExpanded') && svSrc33.includes('📥 纸质补录')).toBe(true)
})

test('C26-01..04 材料双形态 + rewriteImages + 消费链 + 加载死循环根治', () => {
  expect(/export function parseGroupMaterials/.test(ppSrc26) && ppSrc26.includes('groupMaterial')).toBe(true)
  expect(paSrc26.includes('q.groupMaterial = rewriteImages')).toBe(true)
  const pvSrc26 = pvSrc30
  const kitSrc26 = kitSrc30
  expect(kitSrc26.includes('q.groupMaterial') && kitSrc26.includes('function QwPaperMode') && svSrc33.includes('x.groupMaterial') && /QwPaperMode/.test(pvSrc26) && /mode="practice"/.test(svSrc33) && kitSrc26.includes('wordCount > 500')).toBe(true)
  expect(!/\}, \[openId, detail, api\]\)/.test(pvSrc26) && /}, \[openId, api\]\)/.test(pvSrc26)).toBe(true)
})

test('C28-01..02 材料段终止于题头 + 专题四区对齐', () => {
  expect(/export function parseGroupMaterials/.test(ppSrc26) && ppSrc26.includes('###\\s*第\\s*\\d+\\s*题')).toBe(true)
  expect(svSrc33.includes('mode="practice"') && svSrc33.includes('<QwPaperMode')).toBe(true)
})
