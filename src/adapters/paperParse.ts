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

/**
 * 给定材料段：双形态（cycle-26 D-1）。
 *  - 申论形态：`## 给定材料` 总段 → `### 材料 N` 逐份（整卷材料区在题目之前）
 *  - 行测形态：`## 材料 N` 独立 H2 段直接夹在题目流中（资料分析题组：每段材料后跟 4-6 题）
 * 行测形态由 parsePaperText 的 H2 流扫描处理（材料归属「其后第一题」的题组），
 * 本函数仍只负责申论形态（向后兼容，返回值语义不变）。
 */
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

/**
 * cycle-26 D-1：行测形态材料段扫描——收集全部 `## 材料 N` H2 段（不吞正文）。
 * 返回 Map<材料号, 正文>，供 parsePaperText 注入题组材料。
 * cycle-28 修正（用户二报「44 题材料过度+答案泄露」）：段终止条件除下一个 H2 外
 * **必须含下一个题头（H3 `### 第 N 题`）**——浙江卷「材料 1」后无 H2 时段文本会
 * 吞到文末，把后续全部题干与 <details> 答案解析吞进材料（泄露事故）。
 */
export function parseGroupMaterials(content) {
  const out = new Map()
  const re = /^##\s*材料\s*(\d+)\s*$/gm
  const marks = []
  let m
  while ((m = re.exec(content)) !== null) marks.push({ no: +m[1], at: m.index, after: m.index + m[0].length })
  for (let i = 0; i < marks.length; i++) {
    const seg = content.slice(marks[i].after)
    // 终止于：下一个 H2（## xxx）或下一个题头（### 第 N 题）——取更近者
    const nextH2 = seg.search(/^##\s+/m)
    const nextQ = seg.search(/^###\s*第\s*\d+\s*题/m)
    let end = nextH2 >= 0 ? nextH2 : -1
    if (nextQ >= 0 && (end < 0 || nextQ < end)) end = nextQ
    const text = (end >= 0 ? seg.slice(0, end) : seg).trim().slice(0, 20000)
    if (text) out.set(marks[i].no, text)
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

/** 解析单题：按科目形态分流。groupMaterial = 行测题组共享材料（cycle-26 D-1，可选注入） */
export function parseQuestion(no, body, subject, groupMaterial) {
  let beforeDetails = body.split(/<details>/)[0] || ''
  const isXingce = subject === '行测'
  // cycle-26 D-1：`## 材料 N` 段文本会残留在「上一题块」尾部（split 以题头为界）——
  // 本题题干若包含下一个材料段头，则从这里裁剪（材料正文由位置扫描注入下一题组）
  const cutAt = beforeDetails.search(/^##\s*材料\s*\d+\s*$/m)
  if (cutAt >= 0) beforeDetails = beforeDetails.slice(0, cutAt)
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
    // cycle-26 D-1：行测题组共享材料（`## 材料 N` 形态）——归属「其后第一题」起的题组；
    // 无组材料的题此字段为空串（不臆造空段，QwQuestionCard 按有则渲染跳段）
    groupMaterial: String(groupMaterial || ''),
  }
}

/** 整卷解析：materials（申论形态）+ questions（含行测题组材料注入） */
export function parsePaperText(content, meta) {
  const materials = parseMaterials(content)
  // cycle-26 D-1：行测 `## 材料 N` 组材料段（资料分析形态，夹在题目流中）
  const groupMats = parseGroupMaterials(content)
  const qStart = content.search(/^##\s*题目\s*$/m)
  const qText = qStart >= 0 ? content.slice(qStart) : content
  const blocks = qText.split(/\n###\s*第\s*(\d+)\s*题\s*\n/)
  const questions = []
  for (let i = 1; i < blocks.length; i += 2) {
    questions.push(parseQuestion(+blocks[i], blocks[i + 1] || '', meta.科目 || '', null))
  }
  // 组材料归属修正：blocks 切分以 `### 第 N 题` 为界，`## 材料 N` 段文本会残留在
  // 「上一题块的尾部」。改为对全文做一次位置扫描，把每个 `## 材料 N` 的正文及其后
  // 题号范围计算出来，再按题号注入。
  if (groupMats.size) {
    const reMat = /^##\s*材料\s*(\d+)\s*$/gm
    const reQ = /^###\s*第\s*(\d+)\s*题/gm
    const qPositions = []
    let qm
    while ((qm = reQ.exec(content)) !== null) qPositions.push({ no: +qm[1], at: qm.index })
    const matRanges = []
    let mm
    reMat.lastIndex = 0
    while ((mm = reMat.exec(content)) !== null) matRanges.push({ no: +mm[1], at: mm.index, after: mm.index + mm[0].length })
    for (let i = 0; i < matRanges.length; i++) {
      const rangeEnd = i + 1 < matRanges.length ? matRanges[i + 1].at : content.length
      const text = groupMats.get(matRanges[i].no) || ''
      if (!text) continue
      // cycle-28c 归属修正（用户三报：浙江卷材料 1 被划给 44-105 共 62 题）：
      // 位置扫描只能定「组起点」，不能定「组终点」——篇章材料（2 题）与资料分析材料（5 题）
      // 之后可能隔着大量无材料普通题才到下一个材料段。**引用链判据**：材料组内的题，
      // 其题干或解析必然引用材料正文关键词（实测 44/45 命中 3-4 词、106-110 命中 2-4 词；
      // 组外题命中 0）。从材料后第一题起逐题检测，引用链断开即组结束——
      // 关键词 = 材料正文切分出的 ≥2 字词元（去停用位），取前 12 个高频词做指纹。
      const nosAll = qPositions.filter(q => q.at > matRanges[i].after && q.at < rangeEnd).map(q => q.no)
      // 材料指纹（cycle-28c 修正）：均匀切分会把「良渚古城遗址」切成不相交长块，
      // 题干引用的「良渚」子词匹配不上 → 45 题断链。改滑窗 2-4 字 n-gram 去重，
      // 频次排序取 top 24（确定性：频次降序、首现位置次序）
      const toks: string[] = []
      const seenTok = new Set<string>()
      for (let win = 4; win >= 2; win--) {
        const reTok = new RegExp('[\\u4e00-\\u9fa5]{' + win + '}', 'g')
        let tm2
        while ((tm2 = reTok.exec(text)) !== null) {
          const w = tm2[0]
          if (!seenTok.has(w)) { seenTok.add(w); toks.push(w) }
        }
      }
      const freq: Record<string, number> = {}
      for (const w of toks) { let n = 0, idx = -1; while ((idx = text.indexOf(w, idx + 1)) > 0) n++; freq[w] = n }
      const top = toks.sort((a, b) => (freq[b] - freq[a]) || (text.indexOf(a) - text.indexOf(b))).slice(0, 24)
      const bodyOf = (no) => {
        const at = qPositions.find(x => x.no === no)
        if (!at) return ''
        const nxt = qPositions.find(x => x.no > no)
        return content.slice(at.at, nxt ? nxt.at : rangeEnd)
      }
      const hits = (body) => top.reduce((n, w) => n + (body.includes(w) ? 1 : 0), 0)
      // 引用链：材料后第一题必须命中（≥2 词）——首题就不引用说明材料段解析异常，整组放弃；
      // 后续题命中 ≥1 维持链路，命中 0 = 组结束
      const nos: number[] = []
      for (const no of nosAll) {
        const h = hits(bodyOf(no))
        if (!nos.length) { if (h >= 2) nos.push(no); else break }
        else if (h >= 1) nos.push(no)
        else break
      }
      if (!nos.length) continue
      for (const q of questions) {
        if (nos.includes(q.no)) { q.groupMaterial = text; q.groupMaterialNo = matRanges[i].no }
      }
    }
  }
  return { materials, questions }
}
