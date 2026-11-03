// v1.7：行测题型解析（选项纯文本 A. xxx、答案单行 B、题型从 <sub> 或题干前缀）
const fs = require('fs')
const p = 'src/adapters/paperData.js'
let s = fs.readFileSync(p, 'utf8')

const oldBlock = `  for (let i = 1; i < qBlocks.length; i += 2) {
    const no = +qBlocks[i]
    const body = qBlocks[i + 1] || ''
    // 题干：详情块之前的加粗段落
    const beforeDetails = body.split(/<details>/)[0] || ''
    const stemMatch = beforeDetails.match(/\\*\\*([\\s\\S]+?)\\*\\*/)
    const stem = stemMatch ? stemMatch[1].trim() : beforeDetails.trim().slice(0, 400)
    const scoreMatch = stem.match(/[（(]\\s*(\\d+)\\s*分\\s*[）)]/)
    const relMatch = beforeDetails.match(/关联材料：([^\\n]+)/)
    const reqMatch = beforeDetails.match(/作答要求：([^\\n]+)/)`

const newBlock = `  for (let i = 1; i < qBlocks.length; i += 2) {
    const no = +qBlocks[i]
    const body = qBlocks[i + 1] || ''
    const beforeDetails = body.split(/<details>/)[0] || ''
    const isXingce = (meta.科目 || '') === '行测'

    let stem, options = {}, correctAnswer = null
    if (isXingce) {
      // ── 行测形态：题干为纯文本，选项形如「A. xxx」，答案解析在 details 内（单行字母） ──
      const lines = beforeDetails.split('\\n')
      const optLines = []
      const stemLines = []
      for (const ln of lines) {
        const om = ln.match(/^\\s*([A-D])[.、．]\\s*(.+)$/)
        if (om) optLines.push({ key: om[1], text: om[2].trim() })
        else stemLines.push(ln)
      }
      stem = stemLines.join('\\n').trim()
      for (const o of optLines) options[o.key] = o.text
      // 答案：details 内首个独立大写字母行
      const det = body.match(/<details>[\\s\\S]*?<\\/details>/)
      if (det) {
        const inner = det[0].replace(/<[^>]+>/g, '\\n')
        const am = inner.match(/(?:^|\\n)\\s*([A-D])\\s*(?:\\n|$)/)
        if (am) correctAnswer = am[1]
        const anaM = inner.match(/\\*\\*解析\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|$)/)
        if (anaM) analysis2 = anaM[1].trim().slice(0, 4000)
      }
      // 题型：优先 <sub>qid N · 题型</sub>
      const tm = body.match(/<sub>[^<]*?[·・]\\s*([^<]+?)<\\/sub>/)
      qType = tm ? tm[1].trim() : ''
    } else {
      // ── 申论形态：题干加粗，参考答案多段 ──
      const stemMatch = beforeDetails.match(/\\*\\*([\\s\\S]+?)\\*\\*/)
      stem = stemMatch ? stemMatch[1].trim() : beforeDetails.trim().slice(0, 400)
    }
    const scoreMatch = stem.match(/[（(]\\s*(\\d+)\\s*分\\s*[）)]/)
    const relMatch = beforeDetails.match(/关联材料：([^\\n]+)/)
    const reqMatch = beforeDetails.match(/作答要求：([^\\n]+)/)`

if (!s.includes(oldBlock)) { console.error('❌ 锚点未找到'); process.exit(1) }
s = s.replace(oldBlock, newBlock)

// 需要在循环前声明 qType/analysis2
s = s.replace(
  `  const qBlocks = qText.split(/\\n###\\s*第\\s*(\\d+)\\s*题\\s*\\n/)`,
  `  const qBlocks = qText.split(/\\n###\\s*第\\s*(\\d+)\\s*题\\s*\\n/)\n  let qType = '', analysis2 = ''`
)

// 题目对象补 options/correctAnswer
s = s.replace(
  `    questions.push({
      no, stem,
      score: scoreMatch ? +scoreMatch[1] : null,`,
  `    questions.push({
      no, stem,
      type: qType || '',
      options,
      correctAnswer,
      score: scoreMatch ? +scoreMatch[1] : null,`
)
// 申论也带 analysis2
s = s.replace(
  `      reference, analysis,`,
  `      reference, analysis: analysis || analysis2,`
)

fs.writeFileSync(p, s)
console.log('✅ 行测解析已加入')
