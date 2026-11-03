/**
 * adapters/paperParse.js — 试卷解析核心（从 paperData 拆出，降复杂度）
 *
 * 单一职责：把 markdown 试卷文本解析成 {meta, materials, questions}。
 * 行测/申论两套形态在此收敛，paperData 只负责索引与 API 编排。
 */
import { basename } from 'node:path'

/** YAML frontmatter（本仓库是简单 key: "value" 形态） */
export function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([^:]+):\s*"?(.*?)"?\s*$/)
    if (kv) meta[kv[1].trim()] = kv[2]
  }
  return meta
}

/** overview 注释块里的「N 题 · 图片 M 处」 */
export function parseOverview(content) {
  const m = content.match(/<!--\s*gwy:overview:start\s*-->([\s\S]*?)<!--\s*gwy:overview:end\s*-->/)
  if (!m) return { questionCount: 0, imageCount: 0 }
  const q = m[1].match(/(\d+)\s*题/)
  const img = m[1].match(/图片\s*(\d+)\s*处/)
  return { questionCount: q ? +q[1] : 0, imageCount: img ? +img[1] : 0 }
}

/** 给定材料段：截到下一个 H2 */
export function parseMaterials(content) {
  const out = []
  const start = content.search(/^##\s*给定材料\s*$/m)
  if (start < 0) return out
  const after = content.slice(start)
  const bodyStart = after.indexOf('\n') + 1
  const nextH2 = after.slice(bodyStart).search(/^##\s+/m)
  const body = nextH2 >= 0 ? after.slice(bodyStart, bodyStart + nextH2) : after
  const blocks = body.split(/\n###\s*材料\s*(\d+)\s*\n/)
  for (let i = 1; i < blocks.length; i += 2) {
    out.push({ no: +blocks[i], text: (blocks[i + 1] || '').trim().slice(0, 20000) })
  }
  return out
}

/** 行测题：选项为 `A. xxx` 纯文本行，答案为 details 内单独字母行 */
function parseXingceBody(body, stemLines, optLines) {
  let correctAnswer = null
  let analysis = ''
  const det = body.match(/<details>[\s\S]*?<\/details>/)
  if (det) {
    const inner = det[0].replace(/<[^>]+>/g, '\n')
    const am = inner.match(/(?:^|\n)\s*([A-D])\s*(?:\n|$)/)
    if (am) correctAnswer = am[1]
    const anaM = inner.match(/\*\*解析\*\*\s*\n([\s\S]*?)(?=\n\*\*|$)/)
    if (anaM) analysis = anaM[1].trim().slice(0, 4000)
  }
  return { stem: stemLines.join('\n').trim(), options: optLines, correctAnswer, analysis }
}

/** 申论题：题干加粗，details 内多段参考答案 */
function parseEssayBody(beforeDetails, body) {
  const stemMatch = beforeDetails.match(/\*\*([\s\S]+?)\*\*/)
  const stem = stemMatch ? stemMatch[1].trim() : beforeDetails.trim().slice(0, 400)
  let reference = ''
  let analysis = ''
  const detMatch = body.match(/<details>[\s\S]*?<\/details>/)
  if (detMatch) {
    const inner = detMatch[0]
    const refM = inner.match(/\*\*参考答案[^*]*\*\*\s*\n([\s\S]*?)(?=\n\*\*|<\/details>|$)/)
    if (refM) reference = refM[1].trim().slice(0, 8000)
    const anaM = inner.match(/\*\*(?:解析|答题思路)[^*]*\*\*\s*\n([\s\S]*?)(?=\n\*\*|<\/details>|$)/)
    if (anaM) analysis = anaM[1].trim().slice(0, 8000)
    if (!reference) reference = inner.replace(/<[^>]+>/g, '').replace(/\*\*[^*]*\*\*/g, '').trim().slice(0, 8000)
  }
  return { stem, options: {}, correctAnswer: null, reference, analysis }
}

/**
 * 行测题型推断：无前置标签的卷靠题干典型问法归类六大模块。
 * 顺序敏感：先匹配强特征（图形/类比/定义/逻辑），再落通用。
 */
export function guessXingceType(stem) {
  const t = String(stem || '')
  if (/图形|折纸|截面|立体|平面拼合|九宫格|规律.*图形/.test(t)) return '图形推理'
  if (/类比|对于.*相当于|相当于/.test(t)) return '类比推理'
  if (/定义.*属于|不属于.*定义|根据上述定义/.test(t)) return '定义判断'
  if (/削弱|加强|假设|前提|结论|能够推出|不能推出|由此可以推出/.test(t)) return '逻辑判断'
  if (/填入.*划横线|依次填入|最恰当的一项|语序|排列组合.*句/.test(t)) return '逻辑填空'
  if (/主要说明|主旨|概括最准确|意在说明|中心|标题|复述|观点/.test(t)) return '片段阅读'
  if (/语句排序|衔接最恰当|下文.*最可能/.test(t)) return '语句表达'
  if (/资料|同比|环比|增长率|比重|百分点|年均/.test(t)) return '资料分析'
  if (/多少|几倍|平均|速度|概率|排列|组合|工程|行程|利润|浓度|年龄/.test(t)) return '数学运算'
  if (/常识|下列.*正确的是|错误的是|属于.*的是/.test(t)) return '常识判断'
  return '综合'
}

/** 解析单题：按科目形态分流 */
export function parseQuestion(no, body, subject) {
  const beforeDetails = body.split(/<details>/)[0] || ''
  const isXingce = subject === '行测'
  let stemLines = []
  let optLines = []
  let parsed
  if (isXingce) {
    for (const ln of beforeDetails.split('\n')) {
      const om = ln.match(/^\s*([A-D])[.、．]\s*(.+)$/)
      if (om) optLines.push({ key: om[1], text: om[2].trim() })
      else stemLines.push(ln)
    }
  }
  parsed = isXingce ? parseXingceBody(body, stemLines, optLines) : parseEssayBody(beforeDetails, body)
  const options = {}
  if (Array.isArray(parsed.options)) for (const o of parsed.options) options[o.key] = o.text
  else Object.assign(options, parsed.options || {})

  const tm = body.match(/<sub>[^<]*?[·・]\s*([^<]+?)<\/sub>/)
  const qType = tm ? tm[1].trim() : (isXingce ? guessXingceType(parsed.stem) : '')
  const scoreMatch = parsed.stem.match(/[（(]\s*(\d+)\s*分\s*[）)]/)
  const relMatch = beforeDetails.match(/关联材料：([^\n]+)/)
  const reqMatch = beforeDetails.match(/作答要求：([^\n]+)/)

  return {
    no, stem: parsed.stem, type: qType, options,
    correctAnswer: parsed.correctAnswer,
    score: scoreMatch ? +scoreMatch[1] : null,
    relatedMaterials: relMatch ? relMatch[1].trim() : '',
    requirement: reqMatch ? reqMatch[1].trim() : '',
    reference: parsed.reference || '',
    analysis: parsed.analysis || '',
  }
}

/** 整卷解析：materials + questions */
export function parsePaperText(content, meta) {
  const materials = parseMaterials(content)
  const qStart = content.search(/^##\s*题目\s*$/m)
  const qText = qStart >= 0 ? content.slice(qStart) : content
  const blocks = qText.split(/\n###\s*第\s*(\d+)\s*题\s*\n/)
  const questions = []
  for (let i = 1; i < blocks.length; i += 2) {
    questions.push(parseQuestion(+blocks[i], blocks[i + 1] || '', meta.科目 || ''))
  }
  return { materials, questions }
}
