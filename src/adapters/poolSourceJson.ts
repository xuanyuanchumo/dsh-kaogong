/**
 * adapters/poolSourceJson.ts — JSON 形态源的摄入实现（cycle-35 · 研究 16 P1/P3/P4/P5）
 *
 * 覆盖四个独立 id 命名空间的源（全部走 `q:<sourceId>:<qid>` canonical_id）：
 *   · xingce-app（22298 题 · 6 模块 JSON · options[{label,text,is_correct}] + material/material_content）
 *   · gk-tuxing（354 题 · QDATA 数组 · 纯图无题干 + cat 13 类规律 + 整图）
 *   · qiuzhao-epi-bank（951 题 · 5 JSON · options[{k,t}] + graphics svg）
 *   · civil-exam-agent（87 题 · options{A:文本} 原生同形）
 *
 * ── 分层纪律 ──
 *   本文件是「知道上游具体格式」的合法位置。存储层与内核层不认识任何具体上游。
 *   全部走 `upsertQuestionBundle` 共享 UPSERT（合并语义只填空位——单一事实源）。
 *
 * ── 归一铁律（设计 §9c.3）──
 *   ① 图片只引用不复制  ② HTML 剥除必须枚举字段（img 占位保留）  ③ 可空字段不臆造
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveCanonicalId, putRelation, putQuestionSource, withTx } from './poolDb.js'
import { prepareQuestionUpsert, upsertQuestionBundle } from './poolUpsert.js'

/** JSON 文件安全读取（损坏/缺失 → null，绝不抛） */
function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return null }
}

/** options 数组（[{label,text,is_correct}] 或 [{k,t}]）→ 练习链路同形 {A:文本}；is_correct → answer 兜底 */
function optionsArrayToMap(arr: any): { options: string, derivedAnswer: string } {
  if (!Array.isArray(arr)) return { options: '', derivedAnswer: '' }
  const out: Record<string, string> = {}
  let derived = ''
  for (const o of arr) {
    if (!o || typeof o !== 'object') continue
    const key = String(o.label ?? o.k ?? o.key ?? '').trim().toUpperCase()
    const text = String(o.text ?? o.t ?? o.html ?? '').trim()
    if (!key) continue
    // SVG 选项图（qiuzhao graphics）：svg 入文本走 RichText 渲染（图片只引用不复制）
    const svg = o.svg ? String(o.svg) : ''
    out[key] = text || (svg ? svg : '')
    if (o.is_correct === true) derived = key
  }
  return { options: JSON.stringify(out), derivedAnswer: derived }
}

/** options 对象（{A:文本} 形态，civil-exam-agent 原生同形）→ 规范 JSON 字符串 */
function optionsObjectToJson(obj: any): string {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ''
  try { return JSON.stringify(obj) } catch { return '' }
}

/** 上游图片相对路径 → kgimg:// 中立占位（落盘与端口/挂载点无关——铁律②） */
function neutralizeUpstreamImages(s: any): string {
  const raw = String(s ?? '')
  if (!raw) return ''
  const IMG_RE = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*\/?>/gi
  return raw
    .replace(IMG_RE, (_full, src) => {
      const rel = String(src || '').replace(/\\/g, '/')
      if (!rel || /^https?:/i.test(rel)) return _full
      return `【图:kgimg://${rel.replace(/^(\.\.\/)+/, '')}】`
    })
    .trim()
}

/** 提取 img src 列表（{source, relPath}；只引用不复制——铁律①） */
function extractImgRefs(s: any, source: string): Array<{ source: string, relPath: string }> {
  const out: Array<{ source: string, relPath: string }> = []
  const IMG_RE = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*\/?>/gi
  let m: RegExpExecArray | null
  const raw = String(s ?? '')
  while ((m = IMG_RE.exec(raw)) !== null) {
    const rel = String(m[1] || '').replace(/\\/g, '/')
    if (!rel || /^https?:/i.test(rel)) continue
    out.push({ source, relPath: rel.replace(/^(\.\.\/)+/, '') })
  }
  return out
}

/** strip HTML 保留 img 占位（与 poolSourceImpls.stripHtmlKeepImg 同语义；本文件自含防循环依赖） */
function stripKeepImg(s: any): string {
  const raw = String(s ?? '')
  if (!raw) return ''
  return neutralizeUpstreamImages(raw).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

/* ══ P1 · xingce-app（22298 题 · 6 模块 JSON）══ */

export function ingestXingceAppSource(ctx: any): any {
  const { repoRoot, db, opts = {} } = ctx
  const dataDir = join(repoRoot, 'xingce-app', 'web', 'public', 'data')
  const manifest = readJson(join(dataDir, 'manifest.json'))
  if (!manifest || !manifest.modules) return { source: 'xingce-app', skipped: true, reason: 'manifest.json 缺失或损坏' }

  const stats = { questions: 0, relations: 0, materials: 0, skipped: false, files: 0 }
  const insQ = prepareQuestionUpsert(db)
  const ev = JSON.stringify({ src: 'xingce-app', rule: 'json-modules' })

  withTx(db, () => {
    for (const [moduleName, mi] of Object.entries(manifest.modules as Record<string, any>)) {
      const rows = readJson(join(dataDir, mi.file))
      const qs: any[] = Array.isArray(rows) ? rows : (rows && rows.questions) || []
      if (!qs.length) continue
      stats.files++
      for (const q of qs) {
        const qid = String(q.id ?? '').trim()
        if (!qid) continue
        const canon = deriveCanonicalId(qid, '', '', { namespace: 'xingce-app' })
        // options [{label,text,is_correct}] → {A:文本} + is_correct 推导 answer（与上游 answer 双源兜底）
        const { options, derivedAnswer } = optionsArrayToMap(q.options)
        const answer = String(q.answer ?? '').trim().toUpperCase() || derivedAnswer
        // material/material_content → 组材料（材料如共用之灯——不可丢弃）
        const matTitle = String(q.material ?? '').trim()
        const matBody = stripKeepImg(q.material_content ?? '')
        const groupMaterial = matBody || ''
        const imgs = extractImgRefs(q.material_content ?? q.stem ?? '', 'xingce-app')
        const stem = stripKeepImg(neutralizeUpstreamImages(q.stem))
        const analysis = stripKeepImg(neutralizeUpstreamImages(q.analysis))
        const paper = String(q.paper_name ?? '').trim()
        const relations: Array<{ type: any, dstKind: string, dstId: string, weight?: number }> = []
        if (moduleName) relations.push({ type: 'IN_MODULE', dstKind: 'module', dstId: moduleName })
        const qtype = String(q.qtype ?? '').trim()
        if (qtype) relations.push({ type: 'IN_MODULE', dstKind: 'category', dstId: qtype })
        if (matTitle) relations.push({ type: 'HAS_MATERIAL', dstKind: 'material', dstId: paper ? paper + '·' + matTitle : matTitle })
        if (paper) relations.push({ type: 'APPEARS_IN', dstKind: 'paper', dstId: paper })
        const region = String(q.region ?? '').trim()
        if (region) relations.push({ type: 'SAME_REGION', dstKind: 'region', dstId: region })
        const r = upsertQuestionBundle(insQ, {
          qid, canonicalId: canon, sourceId: 'xingce-app', localKey: String(q.id),
          module: moduleName, qtype, stem, options, answer, analysis,
          groupMaterial, images: JSON.stringify(imgs), hasImage: imgs.length ? 1 : 0,
          paper, region: String(q.region ?? ''), year: String(q.year ?? ''),
        }, { evidence: ev, relations }, { db, localKey: String(q.id), paper, region: String(q.region ?? ''), year: String(q.year ?? '') })
        if (r.ok) stats.questions++
        stats.relations += relations.length
        if (matTitle && matBody) stats.materials++
      }
    }
  })
  return { source: 'xingce-app', ...stats }
}

/* ══ P3 · gk-tuxing（354 题 · QDATA · 纯图 + cat 规律）══ */

/** gk-tuxing 13 类规律词表（cat → 中文标签；rule_type 维度——tuxingApi 同源） */
const TUXING_CATS: Record<string, string> = {
  symmetry: '对称性', quantity: '数量规律', position: '位置规律', style: '样式规律',
  spatial: '空间重构', cross: '立体图形', fold: '折纸盒', view: '三视图',
  section: '截面图', group: '分类分组', series: '规律序列', analogy: '类比推理',
  attr: '属性规律',
}

export function ingestTuxingSource(ctx: any): any {
  const { repoRoot, db } = ctx
  const dataFile = join(repoRoot, 'gk-tuxing', 'assets', 'data.js')
  let raw = ''
  try { raw = readFileSync(dataFile, 'utf-8') } catch { return { source: 'gk-tuxing', skipped: true, reason: 'data.js 读取失败' } }
  // QDATA 是 window 全局数组（`window.QDATA = [...]`）——不 eval（E6 安全纪律），用受控提取
  const m = raw.match(/window\.QDATA\s*=\s*(\[[\s\S]*?\])\s*;?\s*$/)
  if (!m) return { source: 'gk-tuxing', skipped: true, reason: 'QDATA 形态不识别（window.QDATA = [...]）' }
  let items: any[] = []
  try { items = JSON.parse(m[1].replace(/'/g, '"')) } catch { return { source: 'gk-tuxing', skipped: true, reason: 'QDATA JSON 解析失败' } }
  if (!items.length) return { source: 'gk-tuxing', skipped: true, reason: 'QDATA 为空' }

  const stats = { questions: 0, relations: 0, skipped: false, files: 1 }
  const insQ = prepareQuestionUpsert(db)
  const ev = JSON.stringify({ src: 'gk-tuxing', rule: 'QDATA' })

  withTx(db, () => {
    for (const q of items) {
      const qid = String(q.id ?? '').trim()
      if (!qid) continue
      const canon = deriveCanonicalId(qid, '', '', { namespace: 'gk-tuxing' })
      // 纯图无题干文字（设计 §9b.4）：stem 可空 + 整图入 images + cat → rule_type
      const imgRel = String(q.img ?? '').trim()
      const imgs = imgRel ? [{ source: 'gk-tuxing', relPath: imgRel }] : []
      const cat = String(q.cat ?? '').trim()
      const catLabel = TUXING_CATS[cat] || cat
      const relations: Array<{ type: any, dstKind: string, dstId: string, weight?: number }> = []
      if (catLabel) relations.push({ type: 'BELONGS_TO', dstKind: 'rule_type', dstId: catLabel, weight: 1.0 })
      const group = String(q.g ?? '').trim()
      if (group) relations.push({ type: 'IN_MODULE', dstKind: 'category', dstId: '图形推理/' + group })
      relations.push({ type: 'IN_MODULE', dstKind: 'module', dstId: '判断推理' })
      const src = String(q.src ?? '').trim()
      if (src) relations.push({ type: 'APPEARS_IN', dstKind: 'paper', dstId: src })
      const r = upsertQuestionBundle(insQ, {
        qid, canonicalId: canon, sourceId: 'gk-tuxing', localKey: qid,
        module: '判断推理', ruleType: catLabel,
        // 题干无文字时用「规律标签 + 出处」作为最小可检索文本（检索靠解析特征——cycle-34 事实基线）
        stem: src ? `【图形推理 · ${catLabel}】出处：${src}` : `【图形推理 · ${catLabel}】`,
        answer: String(q.ans ?? '').trim().toUpperCase(),
        analysis: stripKeepImg(q.exp),
        images: JSON.stringify(imgs), hasImage: imgs.length ? 1 : 0,
        paper: src,
      }, { evidence: ev, relations }, { db, localKey: qid, paper: src })
      if (r.ok) stats.questions++
      stats.relations += relations.length
    }
  })
  return { source: 'gk-tuxing', ...stats }
}

/* ══ P4 · qiuzhao-epi-bank（951 题 · 5 JSON）══ */

/** qiuzhao 五个 JSON 文件清单（bankfacts 80 / finance 220 / graphics 117 / questions 134 / strategy 400） */
const QIUZHAO_FILES = ['bankfacts', 'finance', 'graphics', 'questions', 'strategy']

export function ingestQiuzhaoSource(ctx: any): any {
  const { repoRoot, db } = ctx
  const dataDir = join(repoRoot, 'qiuzhao-epi-bank', 'data')
  const stats = { questions: 0, relations: 0, skipped: false, files: 0 }
  const insQ = prepareQuestionUpsert(db)
  const ev = JSON.stringify({ src: 'qiuzhao-epi-bank', rule: 'json' })

  withTx(db, () => {
    for (const name of QIUZHAO_FILES) {
      const j = readJson(join(dataDir, name + '.json'))
      const qs: any[] = Array.isArray(j) ? j : (j && j.questions) || []
      if (!qs.length) continue
      stats.files++
      for (const q of qs) {
        const qid = String(q.id ?? '').trim()
        const stem = String(q.stem ?? '').trim()
        if (!qid && !stem) continue
        const canon = deriveCanonicalId(qid, '', stem || undefined, { namespace: 'qiuzhao' })
        const { options } = optionsArrayToMap(q.options)
        const relations: Array<{ type: any, dstKind: string, dstId: string, weight?: number }> = []
        const moduleName = String(q.module ?? '').trim()
        if (moduleName) relations.push({ type: 'IN_MODULE', dstKind: 'module', dstId: moduleName })
        const topic = String(q.topic ?? '').trim()
        if (topic) relations.push({ type: 'IN_MODULE', dstKind: 'category', dstId: topic })
        const r = upsertQuestionBundle(insQ, {
          qid, canonicalId: canon, sourceId: 'qiuzhao-epi-bank', localKey: qid || name + '#' + stats.questions,
          module: moduleName, qtype: topic,
          stem, options,
          answer: String(q.answer ?? '').trim().toUpperCase(),
          analysis: stripKeepImg(q.analysis),
        }, { evidence: ev, relations }, { db, localKey: qid || name })
        if (r.ok) stats.questions++
        stats.relations += relations.length
      }
    }
  })
  return { source: 'qiuzhao-epi-bank', ...stats }
}

/* ══ P5 · civil-exam-agent（87 题 · options{A:文本} 原生同形）══ */

export function ingestCeaSource(ctx: any): any {
  const { repoRoot, db } = ctx
  const dataFile = join(repoRoot, 'civil-exam-agent', 'data', 'official_85_questions.json')
  const j = readJson(dataFile)
  const qs: any[] = Array.isArray(j) ? j : (j && j.questions) || []
  if (!qs.length) return { source: 'civil-exam-agent', skipped: true, reason: 'official_85_questions.json 空/损坏' }

  const stats = { questions: 0, relations: 0, skipped: false, files: 1 }
  const insQ = prepareQuestionUpsert(db)
  const ev = JSON.stringify({ src: 'civil-exam-agent', rule: 'official-json' })

  withTx(db, () => {
    for (const q of qs) {
      const qid = String(q.id ?? '').trim()
      const stem = stripKeepImg(q.stem)
      if (!qid && !stem) continue
      const canon = deriveCanonicalId(qid, '', stem || undefined, { namespace: 'cea' })
      const relations: Array<{ type: any, dstKind: string, dstId: string, weight?: number }> = []
      const moduleName = String(q.module ?? '').trim()
      if (moduleName) relations.push({ type: 'IN_MODULE', dstKind: 'module', dstId: moduleName })
      const sub = String(q.sub_topic ?? '').trim()
      if (sub) relations.push({ type: 'IN_MODULE', dstKind: 'category', dstId: sub })
      const r = upsertQuestionBundle(insQ, {
        qid, canonicalId: canon, sourceId: 'civil-exam-agent', localKey: qid,
        module: moduleName, qtype: sub,
        stem, options: optionsObjectToJson(q.options),
        answer: String(q.correct ?? '').trim().toUpperCase(),
        analysis: stripKeepImg(q.analysis),
      }, { evidence: ev, relations }, { db, localKey: qid })
      if (r.ok) stats.questions++
      stats.relations += relations.length
    }
  })
  return { source: 'civil-exam-agent', ...stats }
}
