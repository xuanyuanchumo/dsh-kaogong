/**
 * tests/smoke/client-arch.test.mjs — 客户端架构守卫域（cycle-47 阶段 16 迁移·批五）
 *
 * 从 smoke.test.mjs §14 尾段迁移（L2188-2572）：版本三锚点 + 独立端口防线 +
 * cycle-14（材料折叠/申论草稿/索引预热）+ cycle-24 组件规范（C24-01..06）+
 * cycle-25 渲染域（C25-01..05）+ cycle-44 基建组件（C44-01..03）+
 * C29-02/03（批四漏迁的展示契约细项）+ C26-04（加载死循环根治）。
 * 纯静态段（零 server）。判定逐字等价。
 *
  * 旧 ID 对照：C24-02（三元分发链）/C24-04（tsx 全覆盖）/C24-06（React 纪律）/C25-04/05/C44-02/03
 * 运行：npx vitest run tests/smoke/client-arch.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const readSrc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

test('版本三锚点一致（package.json = manifest = README）', () => {
  const pkg = JSON.parse(readSrc('package.json'))
  const mSrc = readSrc('src/shared/manifest.ts')
  const mv = (mSrc.match(/plugin: \{ id: 'kaogong', name: 'dsh-kaogong', version: '([^']+)'/) || [])[1]
  const rm = readSrc('README.md').match(/·\s*v([\d.]+)/)
  expect(pkg.version === mv && pkg.version === (rm ? rm[1] : null),
    `pkg=${pkg.version} manifest=${mv} readme=${rm && rm[1]}`).toBe(true)
})

test('独立端口防线：clientError 兜底 + 回调整体 try 包裹', () => {
  const httpSrc = readSrc('src/server/http.ts')
  expect(httpSrc.includes("server.on('clientError'")).toBe(true)
  expect(/createServer\(\(req, res\) => \{\s*(?:\/\/[^\n]*\n\s*)*try \{/.test(httpSrc)).toBe(true)
})

test('cycle-14 材料逐份折叠：双视图状态 + 总开关 + 字数提示 + 联动自动展开', () => {
  const papersView = readSrc('src/client/views/papers-view.tsx')
  expect((papersView.match(/collapsedMats/g) || []).length >= 6 && (papersView.match(/toggleMat/g) || []).length >= 4).toBe(true)
  expect(papersView.includes("'▼ 全部展开'") && papersView.includes("'▲ 全部收起'") && papersView.includes("'▼ 展开全部材料")).toBe(true)
  expect(papersView.includes("约 ' + wordCount + ' 字") && papersView.includes('· 已折叠')).toBe(true)
  expect(/jumpToMaterial[\s\S]{0,220}setCollapsedMats\(m => \(m\[no\] \? \{ \.\.\.m, \[no\]: false \} : m\)\)/.test(papersView)).toBe(true)
})

test('cycle-14 申论草稿：localStorage 暂存三态 + 装载/清除 + UI 提示', () => {
  const papersView = readSrc('src/client/views/papers-view.tsx')
  expect(papersView.includes("'kg-essay-draft:'") && /const readDraft = /.test(papersView) && /const writeDraft = /.test(papersView)).toBe(true)
  expect(/setAnswer\(readDraft\(q\)\)/.test(papersView) && /localStorage\.removeItem\(essayDraftKey\(cur\)\)/.test(papersView) && papersView.includes('草稿已本地暂存')).toBe(true)
})

test('cycle-14 索引预热：分块构建不阻塞 + 启动接线可关 + harness 显式关闭', () => {
  const paperData = readSrc('src/adapters/paperData.ts')
  const httpSrc = readSrc('src/server/http.ts')
  expect(/export function prewarmPaperIndex/.test(paperData) && /setImmediate\(step\)/.test(paperData) && /const BATCH = 40/.test(paperData)).toBe(true)
  expect(httpSrc.includes('prewarmPaperIndex(getRepoRoot())') && /prewarm = options\.prewarm !== false/.test(httpSrc)).toBe(true)
})

test('C29-02/03 展示契约细项：纯函数防御 ≥2 + 隐藏隔离键', () => {
  const hostSrc29 = readSrc('src/host/index.ts')
  expect((hostSrc29.match(/catch \{ return undefined \}/g) || []).length).toBeGreaterThanOrEqual(2)
  expect(hostSrc29.includes("k === 'workspace'")).toBe(true)
})

test('C26-04 加载死循环根治：详情 effect 依赖不含 detail', () => {
  const pvSrc26 = readSrc('src/client/views/papers-view.tsx')
  expect(!/\}, \[openId, detail, api\]\)/.test(pvSrc26) && /}, \[openId, api\]\)/.test(pvSrc26)).toBe(true)
})

test('C24-01..06 组件规范：注册表路由/目录分层/tsx 全覆盖/jsx classic/React 引入纪律', () => {
  const cl24 = readSrc('src/client/client.tsx')
  expect(/const VIEW_ROUTES: Record</.test(cl24) && /h\(route\.comp, \{ key: route\.key\(tick\)/.test(cl24)).toBe(true)
  expect((cl24.match(/view === '[a-z]+' \? h\(Native/g) || []).length <= 1).toBe(true)
  const root = fs.readdirSync(path.join(REPO, 'src', 'client'), { withFileTypes: true })
  // cycle-48：hooks/ 目录加入白名单（自定义 hooks 基建——非视图级，与 ui-kit 同层；
  // 一 hook 一文件 + index barrel，禁止单文件膨胀）
  expect(root.filter(f => f.isFile()).every(f => ['client.tsx', 'ui-kit.tsx'].includes(f.name))).toBe(true)
  expect(root.filter(f => f.isDirectory()).map(f => f.name)).toContain('hooks');
  // cycle-48：hooks barrel 形态守卫——禁 export-from 带源形态（bundler 剥皮不认，
  // 残留孤立 from 行且函数体不进依赖图 → 组件 undefined）
  const barrel = readSrc('src/client/hooks/index.ts')
  expect(/^export \{ useApiData, useApiMany \}$/m.test(barrel) && !/^export [\w{}, $]+ from/m.test(barrel), 'barrel 必须用 import+独立 export（禁 export-from）').toBe(true)
  expect(fs.readdirSync(path.join(REPO, 'src', 'client', 'views')).every(f => f.endsWith('.tsx'))).toBe(true)
  expect(/"jsx": "react"/.test(readSrc('tsconfig.json')) && !/"jsx": "react-jsx"/.test(readSrc('tsconfig.json'))).toBe(true)
  // .tsx 禁 import React（唯一 require('react') 在 ui-kit）
  let okReact = true
  for (const dir of ['src/client', 'src/client/views', 'src/client/question']) {
    for (const f of fs.readdirSync(path.join(REPO, dir))) {
      if (!f.endsWith('.tsx')) continue
      const s = readSrc(path.join(dir, f))
      if (/^import\s+React\s/m.test(s)) okReact = false
      if (f !== 'ui-kit.tsx' && s.includes("require('react')")) okReact = false
    }
  }
  expect(okReact).toBe(true)
})

test('C25-01..05 渲染域：七段组件 + 答题卡四态 + 图片放大三交互 + 接入面 + 折叠契约', () => {
  const kitSrc = readSrc('src/client/question/question-kit.tsx')
  const lbSrc = readSrc('src/client/question/question-lightbox.tsx')
  expect(['QwNumberBadge', 'QwSourceMeta', 'QwTypeTag', 'QwMaterial', 'QwStem', 'QwOptions', 'QwAnswerDims', 'QwQuestionCard'].every(n => kitSrc.includes('function ' + n))).toBe(true)
  expect(/function QwExamNavigator/.test(kitSrc) && kitSrc.includes('onJump') && kitSrc.includes('flags && flags.has')).toBe(true)
  expect(/function QwLightbox/.test(lbSrc) && lbSrc.includes('wheelZoom') && lbSrc.includes('dragStart') && lbSrc.includes('Escape')).toBe(true)
  const sv = readSrc('src/client/views/study-view.tsx')
  const pv = readSrc('src/client/views/papers-view.tsx')
  // C25-04 接入面：practice/exam/papers/essay 消费 QwQuestionCard——
  // cycle-48 修正：QwExamNavigator 在 papers-view 仅 import 未 JSX 消费（QwPaperMode
  // 内部消费答题卡），接入面断言改为「study-view QwPaperMode 间接接入」
  const svQw = readSrc('src/client/views/study-view.tsx')
  expect(/QwQuestionCard/.test(sv) && /QwPaperMode/.test(pv) && (pv.match(/QwQuestionCard/g) || []).length >= 3).toBe(true)
  expect(/QwPaperMode/.test(svQw), 'study-view 间接接入面（QwPaperMode 内部消费 QwQuestionCard）').toBe(true)
  expect((pv.match(/collapsedMats/g) || []).length >= 6 && (pv.match(/toggleMat/g) || []).length >= 4 && /jumpToMaterial/.test(pv)).toBe(true)
})

test('C44-01..03 三态/chips 基建组件：ui-kit 单一事实源 + 视图零手写 + ≥4 视图消费', () => {
  const kitSrc44 = readSrc('src/client/ui-kit.tsx')
  expect(/export function KgLoad/.test(kitSrc44) && /export function KgErr/.test(kitSrc44) &&
    /export function KgEmpty/.test(kitSrc44) && /export function KgChips/.test(kitSrc44)).toBe(true)
  const viewFiles44 = ['obs-view', 'pool-view', 'repos-view', 'study-view', 'papers-view', 'huasheng13-view']
    .map(n => 'src/client/views/' + n + '.tsx')
  const residual = viewFiles44.filter(f => /className="kg-load"|className: 'kg-load'/.test(readSrc(f)))
  expect(residual, '手写 kg-load 残留').toEqual([])
  const consumers44 = viewFiles44.filter(f => /KgLoad|KgErr|KgEmpty|KgChips/.test(readSrc(f)))
  expect(consumers44.length).toBeGreaterThanOrEqual(4)
})
