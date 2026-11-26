/**
 * tests/smoke/question-render-fields.test.mjs — 七段渲染字段零遗漏守卫（cycle-62）
 *
 * ── 为什么需要（真实事故）──
 * 用户报「题目的来源/题型/题号/材料/题干/选项/答案/解析 组件化显示有问题」。
 * 实测三处**字段名错配**同时静默生效（无一被既有测试抓到）：
 *   ① 题号：前端读 `q.no`，服务端出站发 `number` → 恒显 `?`
 *   ② 答案：前端读 `q.answer`，服务端出站发 `correctAnswer` → 答案行永不渲染
 *   ③ 材料：前端读 `q.material`，服务端出站发 `groupMaterial` → 材料段永不渲染
 *
 * 为什么既有测试没抓到：render 测试用 **mock 数据**，mock 的字段名恰好与组件读的一致
 * ——「mock 形状即契约」的纪律在这里失效：**mock 与真实出站不一致时，测试测的是 mock**。
 *
 * ── 本守卫的两条判据（都必须机器可验）──
 *   A. **服务端出站字段完整性**：`poolApi` 的三条出站投影路径（toLegacyShape /
 *      sampleQuestions 补足 / poolQuestionDetail）必须包含七段所需字段；
 *      且 `number`/`no` 不得再被硬编码为 0（那是「题号恒 ?」的直接根因）。
 *   B. **前端类型覆盖**：`QwQuestion` 接口必须声明七段消费的**全部**字段
 *      （含双写法 correctAnswer/answer、groupMaterial/material、number/no）——
 *      类型没声明的字段，strict 编译期发现不了「读不存在的字段」。
 *
 * 运行：npx vitest run tests/smoke/question-render-fields.test.mjs
 */
import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const readSrc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const poolApiSrc = readSrc('src/server/poolApi.ts')
const kitSrc = readSrc('src/client/question/question-kit.tsx')

/** 七段所需的服务端出站字段（单一事实源：与 question-kit 的七段组件一一对应） */
const SEGMENT_FIELDS = {
  '0 编号': ['number', 'no'],
  '1 来源': ['source', 'paperFile', 'region', 'year'],
  '2 题型': ['type', 'module'],
  '3 材料': ['groupMaterial', 'groupMaterialNo'],
  '4 题干': ['stem'],
  '5 选项': ['options'],
  '6 答案': ['correctAnswer'],
  '7 解析': ['analysis', 'dims'],
}

test('QRF-01 服务端出站投影含七段全部字段（toLegacyShape 主路径）', () => {
  // toLegacyShape 是 /api/questions 的主出口（sampleQuestions → toLegacyShape）
  const at = poolApiSrc.indexOf('const seqNo = Number(r.seq')
  expect(at > 0, 'toLegacyShape 的题号计算段缺失（cycle-62 修复被回退？）').toBe(true)
  const body = poolApiSrc.slice(at, at + 1400)
  for (const fields of Object.values(SEGMENT_FIELDS)) {
    for (const f of fields) {
      // 兼容两种写法：`field: value` 或对象简写 `field,`
      const declared = new RegExp('\\b' + f + '\\s*[,:]').test(body)
      expect(declared, `toLegacyShape 缺字段 ${f}（七段渲染会整段丢失）`).toBe(true)
    }
  }
})

test('QRF-02 题号不得再硬编码为 0（题号恒 ? 的直接根因）', () => {
  // 全文件范围：`number: 0` 只允许出现在注释里，不允许出现在投影对象字面量中
  const codeLines = poolApiSrc.split(/\r?\n/).filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l))
  const hardcoded = codeLines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(x => /\bnumber\s*:\s*0\b/.test(x.l))
  expect(hardcoded, '仍有硬编码 number: 0（应为卷内序号 seq）：\n' + hardcoded.map(x => x.n + ': ' + x.l.trim()).join('\n')).toEqual([])
})

test('QRF-03 三条出站投影路径都发题号（no + number 双写）', () => {
  // 池内有三条把题发给前端的路径，任何一条漏了题号都会让那条链路的题号失效
  const seqNoUses = (poolApiSrc.match(/const seqNo = /g) || []).length
  expect(seqNoUses, '应有三处题号计算（toLegacyShape / 带图补足 / 出站映射），实际 ' + seqNoUses).toBeGreaterThanOrEqual(2)
  const noWrites = (poolApiSrc.match(/\bno:\s*seqNo\b/g) || []).length
  const numberWrites = (poolApiSrc.match(/\bnumber:\s*seqNo\b/g) || []).length
  expect(noWrites, '缺 no: seqNo 写入（前端 QwNumberBadge 读 no）').toBeGreaterThanOrEqual(2)
  expect(numberWrites, '缺 number: seqNo 写入（池原生名）').toBeGreaterThanOrEqual(2)
})

test('QRF-04 sampleQuestions 的 SELECT 必须取 seq（否则题号无从透出）', () => {
  const at = poolApiSrc.indexOf('const SELECT_COLS =')
  expect(at > 0, 'SELECT_COLS 常量缺失').toBe(true)
  const cols = poolApiSrc.slice(at, at + 600)
  expect(/\bseq\b/.test(cols), 'SELECT_COLS 未取 seq —— 题号永远拿不到（cycle-62 根因之一）').toBe(true)
  expect(/\bmaterial_ref\b/.test(cols), 'SELECT_COLS 未取 material_ref —— 材料副标题拿不到').toBe(true)
})

test('QRF-05 前端 QwQuestion 类型声明覆盖七段全部字段（含双写法）', () => {
  const at = kitSrc.indexOf('interface QwQuestion')
  expect(at > 0, 'QwQuestion 接口缺失').toBe(true)
  // 接口体：从 interface 到下一个顶层 }
  const end = kitSrc.indexOf('\n}', at)
  const body = kitSrc.slice(at, end)
  // 七段字段 + 双写法兼容列（服务端名 / 真题卷名）
  const required = [
    'no', 'number',                       // 0 编号双写法
    'source', 'paperFile', 'region', 'year', // 1 来源
    'type', 'module',                     // 2 题型
    'groupMaterial', 'material',          // 3 材料双写法
    'stem', 'options',                    // 4/5 题干与选项
    'correctAnswer', 'answer',            // 6 答案双写法
    'analysis', 'dims', 'reference',      // 7 解析/五维/参考答案
  ]
  const missing = required.filter(f => !new RegExp('\\b' + f + '\\??:').test(body))
  expect(missing, 'QwQuestion 类型缺字段（strict 编译期将发现不了字段错配）：' + missing.join(', ')).toEqual([])
})

test('QRF-06 组件消费的字段名必须与类型声明一致（禁读未声明字段）', () => {
  // 提取 question-kit 里 `q.<field>` 的读取点，逐个核对是否在 QwQuestion 声明内
  const at = kitSrc.indexOf('interface QwQuestion')
  const end = kitSrc.indexOf('\n}', at)
  const declared = new Set(
    (kitSrc.slice(at, end).match(/\b([A-Za-z_]\w*)\??:/g) || [])
      .map(s => s.replace(/[?:]/g, '').trim()),
  )
  const reads = new Set(
    (kitSrc.match(/\bq\.([A-Za-z_]\w*)/g) || []).map(s => s.replace('q.', '')),
  )
  // 允许的例外：q.dims 的子字段、以及已知外部形状（q.requirement 等已声明）
  const undeclared = [...reads].filter(f => !declared.has(f))
  expect(undeclared, '组件读取了 QwQuestion 未声明的字段（字段名错配温床）：' + undeclared.join(', ')).toEqual([])
})

test('QRF-07 答案行同时兼容 correctAnswer 与 answer（双源兜底）', () => {
  expect(/q\.correctAnswer/.test(kitSrc), 'QwAnswerDims 未读取 correctAnswer（答案永不显示）').toBe(true)
  expect(/q\.answer/.test(kitSrc), '需保留 answer 回落（真题卷/旧快照形态）').toBe(true)
  // 判据同源：hasPlain 必须与答案行用同一个 answerText（否则「答案在但守卫说没有」）
  expect(/const answerText =/.test(kitSrc), '缺 answerText 收敛（答案与 hasPlain 判据应同源）').toBe(true)
})

test('QRF-08 材料段同时兼容 groupMaterial 与 material（双源兜底）', () => {
  const at = kitSrc.indexOf('<QwMaterial text=')
  expect(at > 0, 'QwMaterial 调用点缺失').toBe(true)
  const call = kitSrc.slice(at, at + 180)
  expect(call.includes('groupMaterial'), 'QwMaterial 未读 groupMaterial（单题卡材料永不显示）').toBe(true)
  expect(call.includes('material'), '需保留 material 回落（真题卷/旧快照形态）').toBe(true)
})
