/**
 * adapters/poolSourceImpls.ts — 各源的摄入实现（L2 适配层）
 *
 * cycle-34 阶段 1 · 可扩展性：源清单在 `poolSources.ts` 注册表，本文件只放**实现**。
 * 新增一个源 = 写一个 `ingestXxxSource(ctx)` + 注册表加一条，主流程零改动。
 *
 * ── 分层纪律 ──
 *   本文件是「知道上游具体格式」的合法位置（文件名/字段名/正则/编码都在这里）。
 *   存储层（poolDb）与内核层（srs/图谱算法）不认识任何具体上游。
 *
 * ── 归一铁律（设计 §9c.3）──
 *   ① 图片只引用不复制    ② HTML 剥除必须枚举字段（img 占位保留）   ③ 可空字段不臆造
 */
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deriveCanonicalId, putRelation, putQuestionSource, setMeta, withTx } from './poolDb.js'
import { parseQuestions, XINGCE_MODULES } from './repoData.js'

const entries = (o: any): Array<[string, any]> => Object.entries(o || {})

/** HTML 归一：剥标签但**保留 img 为中立占位**（铁律②；cycle-22 教训⑩） */
export function stripHtmlKeepImg(s: any): string {
  const raw = String(s ?? '')
  if (!raw) return ''
  const IMG_RE = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*\/?>/gi
  return raw
    .replace(IMG_RE, (_full, src) => {
      const rel = String(src || '').replace(/\\/g, '/')
      if (!rel || /^https?:/i.test(rel)) return _full
      return `【图:kgimg://${rel.replace(/^(\.\.\/)+/, '')}】`
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** 提取 img src 列表（图片只引用不复制——存 {source, relPath}） */
export function extractImages(s: any): Array<{ source: string, relPath: string }> {
  const out: Array<{ source: string, relPath: string }> = []
  const IMG_RE = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*\/?>/gi
  let m: RegExpExecArray | null
  const raw = String(s ?? '')
  while ((m = IMG_RE.exec(raw)) !== null) {
    const rel = String(m[1] || '').replace(/\\/g, '/')
    if (!rel || /^https?:/i.test(rel)) continue
    out.push({ source: 'naoku', relPath: rel.replace(/^(\.\.\/)+/, '') })
  }
  return out
}

/** options 归一：上游 JSON 数组 → 规范 JSON（保留 img 占位） */
function normalizeOptions(raw: any): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  try {
    const arr = JSON.parse(s)
    if (!Array.isArray(arr)) return s
    return JSON.stringify(arr.map((o: any) => ({
      key: String(o && o.key || ''),
      label: String(o && o.label || ''),
      html: stripHtmlKeepImg(o && o.html),
      is_answer: !!(o && o.is_answer),
    })))
  } catch { return s }
}

/**
 * 摄入 `.naoku.db` → `.kaogong.db`。
 * 只读打开上游（**绝不写上游库**——载体隔离守卫 SMOKE-KGDB-05）。
 */
export async function ingestNaokuSource(ctx: any): Promise<any> {
  const { db, repoRoot, dataDir } = ctx
  const src = join(dataDir, '.naoku.db')
  if (!existsSync(src)) return { source: 'naoku', skipped: true, reason: '上游投影库不存在（.naoku.db）' }
  let upstream: any = null
  try {
    const mod = await import('node:sqlite')
    const DatabaseSync = mod.DatabaseSync || (mod.default && mod.default.DatabaseSync)
    if (!DatabaseSync) return { source: 'naoku', skipped: true, reason: 'node:sqlite 不可用' }
    upstream = new DatabaseSync(src, { readOnly: true })
  } catch (e: any) {
    return { source: 'naoku', skipped: true, reason: '上游库打开失败: ' + (e && e.message) }
  }

  const stats = { questions: 0, relations: 0, materials: 0, appearances: 0, reviews: 0, skipped: false }
  try {
    // ① 源登记
    const upstreamUrl = 'https://github.com/Hongyy177/GongkaoNaoku'
    setMeta(db, 'naoku_source_url', upstreamUrl)
    try {
      db.prepare(
        `INSERT INTO source(id,tier,upstream_url,local_root,head_sha,cloned_at,file_count,byte_size,content_hash)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET local_root=excluded.local_root, byte_size=excluded.byte_size`,
      ).run('naoku', 'required', upstreamUrl, join(repoRoot, 'GongkaoNaoku'), '', new Date().toISOString(), 0, 0, '')
    } catch { /* 源登记失败不阻塞 */ }

    // ② 题目主表（qid 是主身份；fp 从 appearances 反查）
    const fpByQid = new Map<string, string>()
    try {
      for (const r of upstream.prepare('SELECT qid, fp FROM appearances WHERE fp IS NOT NULL AND LENGTH(fp) > 0').all()) {
        if (!fpByQid.has(String(r.qid))) fpByQid.set(String(r.qid), String(r.fp))
      }
    } catch { /* fp 缺失不影响摄入 */ }

    // ②a 出处覆盖的卷名集合（孤儿题兜底的判据）：
    // 上游 appearances 覆盖了哪些卷 —— 若某题的 paper 不在此集合，
    // 说明该题在上游就没有 appearance 行 → 用题自身字段兜底登记出处。
    const appearancePapers = new Set<string>()
    try {
      for (const r of upstream.prepare('SELECT DISTINCT paper FROM appearances WHERE LENGTH(paper) > 0').all() as any[]) {
        appearancePapers.add(String(r.paper).trim())
      }
    } catch { /* 集合缺失 → 全部走兜底 */ }

    const insQ = db.prepare(
      `INSERT INTO question(qid,fp,canonical_id,source_id,local_key,module,category,kadian,rule_type,qtype,ask_model,
        stem,options,answer,analysis,reasoning,fastest,pitfalls,mother,doubt,related,
        group_material,group_material_no,material_ref,images,has_image,freq,paper,region,year,seq,n_paper,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(canonical_id) DO UPDATE SET
         -- 同上：只填空位，不覆盖已有富字段（跨源合并语义）
         stem=CASE WHEN LENGTH(question.stem) > 0 THEN question.stem ELSE excluded.stem END,
         options=CASE WHEN LENGTH(question.options) > 0 THEN question.options ELSE excluded.options END,
         answer=CASE WHEN LENGTH(question.answer) > 0 THEN question.answer ELSE excluded.answer END,
         analysis=CASE WHEN LENGTH(question.analysis) > 0 THEN question.analysis ELSE excluded.analysis END,
         reasoning=CASE WHEN LENGTH(question.reasoning) > 0 THEN question.reasoning ELSE excluded.reasoning END,
         fastest=CASE WHEN LENGTH(question.fastest) > 0 THEN question.fastest ELSE excluded.fastest END,
         pitfalls=CASE WHEN LENGTH(question.pitfalls) > 0 THEN question.pitfalls ELSE excluded.pitfalls END,
         mother=CASE WHEN LENGTH(question.mother) > 0 THEN question.mother ELSE excluded.mother END,
         doubt=CASE WHEN LENGTH(question.doubt) > 0 THEN question.doubt ELSE excluded.doubt END,
         related=CASE WHEN LENGTH(question.related) > 0 THEN question.related ELSE excluded.related END,
         images=CASE WHEN LENGTH(question.images) > 2 THEN question.images ELSE excluded.images END,
         has_image=CASE WHEN question.has_image = 1 THEN 1 ELSE excluded.has_image END,
         freq=CASE WHEN question.freq > 0 THEN question.freq ELSE excluded.freq END,
         paper=CASE WHEN LENGTH(question.paper) > 0 THEN question.paper ELSE excluded.paper END,
         region=CASE WHEN LENGTH(question.region) > 0 THEN question.region ELSE excluded.region END,
         year=CASE WHEN LENGTH(question.year) > 0 THEN question.year ELSE excluded.year END,
         n_paper=CASE WHEN question.n_paper > 0 THEN question.n_paper ELSE excluded.n_paper END,
         updated_at=excluded.updated_at`,
    )

    const rows = upstream.prepare('SELECT * FROM questions').all()
    // 单源一个事务（设计 §9c.5；性能关键：无事务时逐条 fsync → 421s，事务内 → 秒级）
    withTx(db, () => {
    for (const r of rows as any[]) {
      const qid = String(r.qid ?? '').trim()
      const fp = fpByQid.get(qid) || ''
      const stem = stripHtmlKeepImg(r.stem)
      const canon = deriveCanonicalId(qid, fp, stem)
      const imgs = extractImages(r.stem)
      const materialRef = String(r.material_ref ?? '').trim()
      try {
        insQ.run(
          qid, fp, canon, 'naoku', qid,
          String(r.module ?? ''), String(r.category ?? ''), String(r.kadian ?? ''), '', String(r.qtype ?? ''),
          String(r.ask_model ?? ''),
          stem, normalizeOptions(r.options), String(r.answer ?? ''), stripHtmlKeepImg(r.analysis),
          stripHtmlKeepImg(r.reasoning), stripHtmlKeepImg(r.fastest), stripHtmlKeepImg(r.pitfalls), stripHtmlKeepImg(r.mother),
          stripHtmlKeepImg(r.doubt), String(r.related ?? ''),
          '', 0, materialRef,
          JSON.stringify(imgs), imgs.length ? 1 : 0,
          Number(r.freq || 0), String(r.paper ?? ''), String(r.region ?? ''), String(r.year ?? ''),
          0, Number(r.n_paper || 0), new Date().toISOString(),
        )
        stats.questions++
      } catch { /* 单条失败不阻塞整轮 */ }

      // ②b 出处兜底登记（孤儿题治理）：上游 `appearances` 表并非覆盖全部题——
      // 实测 48 题无 appearance 行（多为早年卷/联考卷），若只依赖 appearances
      // 登记出处，这些题就成了「孤儿题」（有题无出处）。
      // 兜底 = 用题自身的 paper/region/year 登记一条出处（数据真实存在，非臆造）。
      // 判据：先查 appearances 映射是否已有该卷；没有才兜底。
      {
        const paper = String(r.paper ?? '').trim()
        if (paper && !appearancePapers.has(paper)) {
          putQuestionSource(db, canon, 'naoku', paper + '#q', paper, String(r.region ?? ''), String(r.year ?? ''), 0, String(r.path ?? ''))
          stats.appearances++
        }
      }

      // ③ 关系边（每条边带 evidence——审计友好）
      const ev = JSON.stringify({ src: 'naoku.db', rule: 'field' })
      if (String(r.kadian ?? '').trim()) { putRelation(db, 'BELONGS_TO', 'question', canon, 'kadian', String(r.kadian).trim(), 1.0, ev); stats.relations++ }
      if (String(r.module ?? '').trim()) { putRelation(db, 'IN_MODULE', 'question', canon, 'module', String(r.module).trim(), 1.0, ev); stats.relations++ }
      if (String(r.category ?? '').trim()) { putRelation(db, 'IN_MODULE', 'question', canon, 'category', String(r.category).trim(), 1.0, ev); stats.relations++ }
      if (String(r.related ?? '').trim()) {
        for (const rid of String(r.related).split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
          const rc = deriveCanonicalId(rid, '', '')
          putRelation(db, 'RELATED_TO', 'question', canon, 'question', rc, 1.0, ev); stats.relations++
        }
      }
      if (String(r.mother ?? '').trim()) {
        const mid = String(r.mother).trim()
        putRelation(db, 'DERIVED_FROM', 'question', canon, 'question', deriveCanonicalId(mid, '', ''), 1.0, ev); stats.relations++
      }
      if (String(r.doubt ?? '').trim()) { putRelation(db, 'HAS_DOUBT', 'question', canon, 'doubt', canon, 1.0, ev); stats.relations++ }
      if (materialRef) { putRelation(db, 'HAS_MATERIAL', 'question', canon, 'material', materialRef, 1.0, ev); stats.relations++ }
      if (String(r.paper ?? '').trim()) { putRelation(db, 'APPEARS_IN', 'question', canon, 'paper', String(r.paper).trim(), 1.0, ev); stats.relations++ }
      if (String(r.region ?? '').trim()) { putRelation(db, 'SAME_REGION', 'question', canon, 'region', String(r.region).trim(), 1.0, ev); stats.relations++ }
    }

    // ④ appearances：题 → 卷 出处（含 seq）+ 一题多出处登记
    try {
      const seen = new Set<string>()
      for (const r of upstream.prepare('SELECT qid,fp,paper,region,year,module,category,seq,path FROM appearances').all() as any[]) {
        const qid = String(r.qid ?? '').trim()
        if (!qid) continue
        const canon = deriveCanonicalId(qid, String(r.fp ?? ''), '')
        const paper = String(r.paper ?? '').trim()
        if (!paper) continue
        const key = canon + '|' + paper
        if (seen.has(key)) continue
        seen.add(key)
        putRelation(db, 'APPEARS_IN', 'question', canon, 'paper', paper, 1.0, JSON.stringify({ src: 'naoku.appearances', seq: Number(r.seq || 0) }))
        // 一题多出处（跨源聚合）：同一题在不同卷出现 → 多行出处
        putQuestionSource(db, canon, 'naoku', paper + '#' + Number(r.seq || 0), paper, String(r.region ?? ''), String(r.year ?? ''), Number(r.seq || 0), String(r.path ?? ''))
        stats.appearances++
      }
    } catch { /* appearances 缺失不影响主摄入 */ }

    // ⑤ materials：共享材料实体
    try {
      const insM = db.prepare('INSERT INTO material(mid,title,body,path) VALUES(?,?,?,?) ON CONFLICT(mid) DO UPDATE SET title=excluded.title, body=excluded.body')
      for (const r of upstream.prepare('SELECT mid,title,body,path FROM materials').all() as any[]) {
        const mid = String(r.mid ?? '').trim()
        if (!mid) continue
        try { insM.run(mid, String(r.title ?? ''), stripHtmlKeepImg(r.body), String(r.path ?? '')); stats.materials++ } catch { /* 单条失败不阻塞 */ }
      }
    } catch { /* materials 缺失不影响 */ }

    // ⑥ review：人工校验
    try {
      const insR = db.prepare('INSERT INTO review(canonical_id,official_answer,verified_answer,status,at) VALUES(?,?,?,?,?) ON CONFLICT(canonical_id) DO UPDATE SET official_answer=excluded.official_answer, verified_answer=excluded.verified_answer, status=excluded.status')
      for (const r of upstream.prepare('SELECT qid,official_answer,verified_answer,status,verified_at FROM review_verified').all() as any[]) {
        const qid = String(r.qid ?? '').trim()
        if (!qid) continue
        const canon = deriveCanonicalId(qid, '', '')
        try {
          insR.run(canon, String(r.official_answer ?? ''), String(r.verified_answer ?? ''), String(r.status ?? ''), String(r.verified_at || new Date().toISOString()))
          stats.reviews++
          putRelation(db, 'REVIEWED', 'question', canon, 'review', canon, 1.0, JSON.stringify({ src: 'naoku.review_verified' }))
          stats.relations++
        } catch { /* 单条失败不阻塞 */ }
      }
    } catch { /* review 缺失不影响 */ }
    })  // ← 事务闭合（单源一个事务；失败回滚该源，不留半成品源）
  } finally {
    try { if (upstream && upstream.close) upstream.close() } catch { /* 已关闭 */ }
  }
  return { source: 'naoku', ...stats }
}

/* ══ 摄入：xingcezhenti（md 目录）══ */

/**
 * 摄入 xingcezhenti 题库 → `.kaogong.db`。
 * qid **直取上游**（`<sub>qid N · 类型</sub>`）——跨仓 100% 一致（实测 327/327），
 * 于是同一道题在两个源自然落到同一 canonical_id → SAME_AS 边自动成立。
 */
export function ingestXingceSource(ctx: any): any {
  const { repoRoot, db, opts = {} } = ctx
  const srcDir = join(repoRoot, 'xingcezhenti')
  if (!existsSync(srcDir)) return { source: 'xingcezhenti', skipped: true, reason: '源目录不存在' }
  const stats = { questions: 0, relations: 0, files: 0, skipped: false }

  const insQ = db.prepare(
    `INSERT INTO question(qid,fp,canonical_id,source_id,local_key,module,category,kadian,rule_type,qtype,ask_model,
      stem,options,answer,analysis,reasoning,fastest,pitfalls,mother,doubt,related,
      group_material,group_material_no,material_ref,images,has_image,freq,paper,region,year,seq,n_paper,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(canonical_id) DO UPDATE SET
       -- 【合并语义·只填空位】同一 canonical_id 的跨源命中（qid 相同），
       -- naoku 先入库且带五维标注（reasoning/fastest/pitfalls/mother）；
       -- xingcezhenti 后到，**只能填空位，不得覆盖**已有富字段——
       -- 否则「统一题目模型」会退化成「最后写入者赢」，把深度标注洗掉。
       -- 判据：现有值非空则保留（LENGTH(...) > 0），空则取本源值。
       stem=CASE WHEN LENGTH(question.stem) > 0 THEN question.stem ELSE excluded.stem END,
       options=CASE WHEN LENGTH(question.options) > 0 THEN question.options ELSE excluded.options END,
       answer=CASE WHEN LENGTH(question.answer) > 0 THEN question.answer ELSE excluded.answer END,
       analysis=CASE WHEN LENGTH(question.analysis) > 0 THEN question.analysis ELSE excluded.analysis END,
       group_material=CASE WHEN LENGTH(question.group_material) > 0 THEN question.group_material ELSE excluded.group_material END,
       images=CASE WHEN LENGTH(question.images) > 2 THEN question.images ELSE excluded.images END,
       has_image=CASE WHEN question.has_image = 1 THEN 1 ELSE excluded.has_image END,
       category=CASE WHEN LENGTH(question.category) > 0 THEN question.category ELSE excluded.category END,
       paper=CASE WHEN LENGTH(question.paper) > 0 THEN question.paper ELSE excluded.paper END,
       region=CASE WHEN LENGTH(question.region) > 0 THEN question.region ELSE excluded.region END,
       year=CASE WHEN LENGTH(question.year) > 0 THEN question.year ELSE excluded.year END,
       qtype=CASE WHEN LENGTH(question.qtype) > 0 THEN question.qtype ELSE excluded.qtype END,
       updated_at=excluded.updated_at`,
  )

  // 全量默认不限（maxFiles=0 表示不限）；smoke/测试用小值提速。
  // ⚠️ 教训（cycle-34 实测）：原先的 `break` 只跳出**内层**文件循环，
  // 外层模块循环继续 → maxFiles 被当成「每模块配额」而非「全局配额」，
  // 表现为「8 个文件只摄入 17 题」（政治理论模块每文件仅 ~2 题）。
  // 正解：全局配额用**标签 break**同时跳出两层循环。
  const maxFiles = opts.maxFiles && opts.maxFiles > 0 ? opts.maxFiles : Infinity
  const ev = JSON.stringify({ src: 'xingcezhenti', rule: 'parseQuestions' })

  // 白盒可观测（项目核心价值观）：吞掉的异常必须留痕，否则「静默少摄入」无法排查
  let lastError = ''

  outer:
  for (const [moduleName, dirName] of entries(XINGCE_MODULES)) {
    const modPath = join(srcDir, dirName)
    if (!existsSync(modPath)) continue
    let files: string[] = []
    try { files = readdirSync(modPath).filter(f => f.endsWith('.md') && !/README|说明|目录/i.test(f)) } catch { continue }
    for (const f of files) {
      if (stats.files >= maxFiles) break outer
      const full = join(modPath, f)
      let qs: any[] = []
      try { qs = parseQuestions(full, 200) } catch (e: any) { lastError = 'parse: ' + (e && e.message); continue }
      if (!qs.length) continue
      stats.files++
      for (const q of qs) {
        // qid：parseQuestions 已从 `<sub>qid N · 类型</sub>` 直取上游 qid（cycle-34 加字段）
        const qid = String((q as any).qid || '').trim()
        const canon = deriveCanonicalId(qid, '', q.stem)
        const imgs = extractImages(q.stem)
        try {
          insQ.run(
            qid, '', canon, 'xingcezhenti', f + '#' + q.number,
            String(q.module || moduleName), '', '', '', String(q.type || ''), '',
            String(q.stem || ''), JSON.stringify(q.options || {}), String(q.correctAnswer || ''),
            String(q.analysis || ''), '', '', '', '', '', '',
            String(q.groupMaterial || ''), Number(q.groupMaterialNo || 0), '',
            JSON.stringify(imgs), imgs.length ? 1 : 0,
            0, String(q.paperFile || ''), String(q.region || ''), String(q.year || ''),
            Number(q.number || 0), 0, new Date().toISOString(),
          )
          stats.questions++
        } catch (e: any) { lastError = 'insert: ' + (e && e.message) }
        // 一题多出处：登记本源出处（跨源聚合——同一 canonical_id 可有 N 行）
        putQuestionSource(db, canon, 'xingcezhenti', f + '#' + q.number, String(q.paperFile || f), String(q.region || ''), String(q.year || ''), Number(q.number || 0), full)
        // 跨源 SAME_AS：qid 命中 ⇒ 与 naoku 同一 canonical_id ⇒ 关系边自动成立
        if (qid) {
          putRelation(db, 'SAME_AS', 'question', canon, 'question', canon, 1.0, ev)
          stats.relations++
        }
        if (String(q.module || moduleName)) { putRelation(db, 'IN_MODULE', 'question', canon, 'module', String(q.module || moduleName), 1.0, ev); stats.relations++ }
        if (String(q.groupMaterial || '').trim()) { putRelation(db, 'HAS_MATERIAL', 'question', canon, 'material', String(q.paperFile || f), 1.0, ev); stats.relations++ }
      }
    }
  }
  return { source: 'xingcezhenti', ...stats, ...(lastError ? { lastError } : {}) }
}

