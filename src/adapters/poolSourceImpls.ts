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
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deriveCanonicalId, putRelation, putQuestionSource, putSource, putAnalysis, contentFingerprint, setMeta, withTx } from './poolDb.js'
import { prepareQuestionUpsert, upsertQuestionBundle } from './poolUpsert.js'
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

  const stats: any = { questions: 0, relations: 0, materials: 0, appearances: 0, reviews: 0, skipped: false, lastError: '', errorCount: 0, dbgIns: 0, dbgMerge: 0 }
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

    // cycle-40b：换共享 prepareQuestionUpsert（34 列含 content_fp——研究 21 去重合并键）。
    // 原 33 列私有版与新 schema（35 列含 content_fp）错位：updated_at 位收到 cfOwn → 全量 27506 行
    // 「column index out of range」被 catch 吞 → naoku 行 0（R45）。
    const insQ = prepareQuestionUpsert(db)

    const rows = upstream.prepare('SELECT * FROM questions').all()
    // 单源一个事务（设计 §9c.5；性能关键：无事务时逐条 fsync → 421s，事务内 → 秒级）
    withTx(db, () => {
    for (const r of rows as any[]) {
      const qid = String(r.qid ?? '').trim()
      const fp = fpByQid.get(qid) || ''
      const stem = stripHtmlKeepImg(r.stem)
      // cycle-40b：naoku 也走 cf 合并（与 xingce-app/gwy 同题内容归一）——
      // naoku 排在注册表首位，是「主行持有者」；其后源命中 cf 挂到 naoku 行下。
      // naoku 自身内部姊妹题（上游同文双题）也归并——cf 指纹首见为准。
      const cfOwn = contentFingerprint(stem, normalizeOptions(r.options))
      const canon0 = deriveCanonicalId(qid, fp, stem)
      let mergeTarget: string | null = null
      if (cfOwn) {
        try {
          const ex = db.prepare('SELECT canonical_id FROM question WHERE content_fp = ? LIMIT 1').get(cfOwn)
          if (ex && ex.canonical_id && String(ex.canonical_id) !== canon0) mergeTarget = String(ex.canonical_id)
        } catch { /* 查重失败 → 正常 */ }
      }
      const canon = mergeTarget || canon0
      void canon0
      const imgs = extractImages(r.stem)
      const materialRef = String(r.material_ref ?? '').trim()
      // cycle-43（材料保真·用户报修「抽到题目没有对应的材料」）：
      // 上游 naoku 的 `material` 列是**材料正文**（99.6% 资料分析题带：3636/3649 实测），
      // `material_ref` 是**材料标题/身份键**（非正文）。旧实现 insQ 传 `''` → 主行材料全空；
      // 归并回填也不含材料列 → 3643 条资料分析题在统一池里恒无材料（不可作答的死题）。
      // 正解：正文占位化后进 group_material（与 xingce-app 摄入同语义）；ref 保持身份键。
      const matText = stripHtmlKeepImg(r.material ?? '')
      // 材料号：上游 naoku 无材料序号（material_ref 头部数字是上游内部 ID，非序号——
      // 臆造会渲染出「材料 3680726」这类误导徽章）→ 恒 0，UI 徽章降级与 xingce-app 同形态
      const matNo = 0
      // 材料段内的统计图表也要可作答（cycle-22 教训同族：剥 HTML 必须保留 img 占位）
      const matImgs = extractImages(r.material ?? '')
      try {
        if (mergeTarget) {
          stats.dbgMerge++
          // ── cycle-40b 修复：归并分支**绝不 insQ.run**——
          // 原实现 canonical=mergeTarget 仍走 INSERT → canonical_id UNIQUE 冲突 →
          // DO UPDATE「吸进」主行（source_id 保持主行值）→ naoku 行全部消失（实测 0 行）。
          // 正解 = 归并只做**贡献合并**：出处挂载 + 解析版本 + **富字段回填**——
          // naoku 是富源（五维标注/fp/n_paper），主行（xingce-app 先入库）缺的 dims
          // 正好由 naoku 补齐（跨源合并的第二重红利：富源后到也能 enrich 主行）。
          putQuestionSource(db, mergeTarget, 'naoku', qid, String(r.paper ?? ''), String(r.region ?? ''), String(r.year ?? ''), 0, String(r.path ?? ''))
          putAnalysis(db, mergeTarget, 'naoku', qid, stripHtmlKeepImg(r.analysis), String(r.answer ?? ''))
          // 富字段回填（只填空位——与 UPSERT 合并语义一致）
          // cycle-43（本分支）：回填列**补 group_material/has_image**——上游 naoku 99.6%
          // 资料分析题带 material 正文（3636/3649 实测），归并行若此前由无材料源先入库，
          // 不回填 = 用户抽到「有题无材料」的死题（本缺陷的用户报修点①）。
          db.prepare(
            `UPDATE question SET
               fp=CASE WHEN LENGTH(question.fp) = 0 THEN ? ELSE question.fp END,
               reasoning=CASE WHEN LENGTH(question.reasoning) = 0 THEN ? ELSE question.reasoning END,
               fastest=CASE WHEN LENGTH(question.fastest) = 0 THEN ? ELSE question.fastest END,
               pitfalls=CASE WHEN LENGTH(question.pitfalls) = 0 THEN ? ELSE question.pitfalls END,
               mother=CASE WHEN LENGTH(question.mother) = 0 THEN ? ELSE question.mother END,
               doubt=CASE WHEN LENGTH(question.doubt) = 0 THEN ? ELSE question.doubt END,
               kadian=CASE WHEN LENGTH(question.kadian) = 0 THEN ? ELSE question.kadian END,
               n_paper=CASE WHEN question.n_paper = 0 THEN ? ELSE question.n_paper END,
               group_material=CASE WHEN LENGTH(question.group_material) = 0 THEN ? ELSE question.group_material END,
               group_material_no=CASE WHEN question.group_material_no = 0 THEN ? ELSE question.group_material_no END,
               has_image=CASE WHEN question.has_image = 1 THEN 1 ELSE ? END
             WHERE canonical_id = ?`,
          ).run(fp, stripHtmlKeepImg(r.reasoning), stripHtmlKeepImg(r.fastest), stripHtmlKeepImg(r.pitfalls),
            stripHtmlKeepImg(r.mother), stripHtmlKeepImg(r.doubt), String(r.kadian ?? ''),
            Number(r.n_paper || 0), matText, matNo, matImgs.length ? 1 : 0, mergeTarget)
          // 归并行也登记 HAS_MATERIAL 边（材料真实存在即登记；putRelation 唯一键幂等，重复登记无害）
          const evMerge = JSON.stringify({ src: 'naoku.db', rule: 'field' })
          if (matText) { putRelation(db, 'HAS_MATERIAL', 'question', mergeTarget, 'material', materialRef || mergeTarget, 1.0, evMerge); stats.relations++ }
          stats.questions++
          continue
        }
        insQ.run(
          qid, fp, canon, 'naoku', qid,
          String(r.module ?? ''), String(r.category ?? ''), String(r.kadian ?? ''), '', String(r.qtype ?? ''),
          String(r.ask_model ?? ''),
          stem, normalizeOptions(r.options), String(r.answer ?? ''), stripHtmlKeepImg(r.analysis),
          stripHtmlKeepImg(r.reasoning), stripHtmlKeepImg(r.fastest), stripHtmlKeepImg(r.pitfalls), stripHtmlKeepImg(r.mother),
          stripHtmlKeepImg(r.doubt), String(r.related ?? ''),
          matText, matNo, materialRef,
          JSON.stringify(imgs), imgs.length ? 1 : 0,
          Number(r.freq || 0), String(r.paper ?? ''), String(r.region ?? ''), String(r.year ?? ''),
          0, Number(r.n_paper || 0), new Date().toISOString(), cfOwn,
        )
        stats.dbgIns++
        stats.questions++
        putAnalysis(db, canon, 'naoku', qid, stripHtmlKeepImg(r.analysis), String(r.answer ?? ''))
      } catch (e: any) {
        if (stats.errorCount === 0) console.error('[naoku-dbg] 首错行详情:', JSON.stringify({ qid, fp: (fp || '').slice(0, 8), cfOwn: (cfOwn || '').slice(0, 8), stemLen: stem.length, optsLen: String(normalizeOptions(r.options) || '').length, argsLen: 34 }))
        if (!stats.errorCount) stats.errorCount = 0
        stats.errorCount++
        if (stats.errorCount <= 3) console.error('[naoku-ingest] 首批插入失败详情:', e && e.message)
      }

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
    })
    console.log('[naoku-dbg] insert=' + stats.dbgIns + ' merge=' + stats.dbgMerge + ' rows=' + rows.length)
    // ← 事务闭合（单源一个事务；失败回滚该源，不留半成品源）
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

  // cycle-40b：换共享 prepareQuestionUpsert（34 列含 content_fp；原 33 列私有版
  // 列序与新 schema 错位 → xingcezhenti 全量 1636 题 R45 复发（column index out of range）。
  const insQ = prepareQuestionUpsert(db)

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
        // cycle-40：内容指纹（粉笔系 qid 命中已合并 naoku；与 gwy/xingce-app 内容同题走 cf 合并）
        const cfp = contentFingerprint(q.stem, JSON.stringify(q.options || {}))
        const canon = deriveCanonicalId(qid, '', q.stem, { contentFp: cfp || undefined })
        const imgs = extractImages(q.stem)
        try {
          // cycle-40：跨源去重第二层——content_fp 命中已有 canonical（他源已入库同题）→ 归并
          let mergeTarget: string | null = null
          if (cfp) {
            try {
              const ex = db.prepare('SELECT canonical_id FROM question WHERE content_fp = ? LIMIT 1').get(cfp)
              if (ex && ex.canonical_id && String(ex.canonical_id) !== canon) mergeTarget = String(ex.canonical_id)
            } catch { /* 查重失败 → 正常插入 */ }
          }
          // cycle-40b：cf 命中跨源主行时**不 insQ.run**（同 naoku 修复——UPSERT 会吸进主行）
          if (mergeTarget) {
            putQuestionSource(db, mergeTarget, 'xingcezhenti', f + '#' + q.number, String(q.paperFile || f), String(q.region || ''), String(q.year || ''), Number(q.number || 0), full)
            putAnalysis(db, mergeTarget, 'xingcezhenti', f + '#' + q.number, String(q.analysis || ''), String(q.correctAnswer || ''))
            stats.questions++
            continue
          }
          const finalCanon = canon
          insQ.run(
            qid, '', finalCanon, 'xingcezhenti', f + '#' + q.number,
            String(q.module || moduleName), '', '', '', String(q.type || ''), '',
            String(q.stem || ''), JSON.stringify(q.options || {}), String(q.correctAnswer || ''),
            String(q.analysis || ''), '', '', '', '', '', '',
            String(q.groupMaterial || ''), Number(q.groupMaterialNo || 0), '',
            JSON.stringify(imgs), imgs.length ? 1 : 0,
            0, String(q.paperFile || ''), String(q.region || ''), String(q.year || ''),
            Number(q.number || 0), 0, cfp, new Date().toISOString(),
          )
          putAnalysis(db, finalCanon, 'xingcezhenti', f + '#' + q.number, String(q.analysis || ''), String(q.correctAnswer || ''))
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

/* ══ P6 · gwy-zhenti（真题卷 md 全量入池 · cycle-39）══ */

/**
 * 摄入 gwy-zhenti 真题卷 → `.kaogong.db`。
 *
 * ── 动机（研究 20 §1 端到端审计）──
 *   此前真题卷/专题视图走 paperApi **直读第三方目录**（loadPaper 逐卷 readFileSync）——
 *   题目未进存储层（研究 15 C6「两跳退化」最后一个未收敛源）。
 *   入池后：真题卷题与 naoku/xingce-app **同池可查**（SAME_AS 由 qid 命中自动成立——
 *   粉笔系同 qid 命名空间），统一检索覆盖全部 7 题源。
 *
 * ── 形状对齐 ──
 *   loadPaper 题目形状（no/stem/type/options{A:文本}/correctAnswer/analysis/groupMaterial）
 *   与练习链路同形——直接映射。无 qid → canonical_id = `q:gwy-zhenti:<paperId>#<no>`
 *   （源内唯一键：卷+题号；namespace 隔离防撞库）。
 *   题面保留 `<details>`/img 占位（stripHtmlKeepImg 同模板）。
 *   申论题（无 options）入池：options 空、answer=空、reference 保留——与练习链路降级一致。
 *
 * ── 性能 ──
 *   loadPaper 首查触发 paperIndex 构建（快照命中 ~ms/卷）；1683 卷全量摄入走单事务。
 */
export async function ingestGwyZhentiSource(ctx: any): Promise<any> {
  const { repoRoot, db, opts = {} } = ctx
  // 动态 import（paperData 体量大；R33 教训：必须在事务外 await）
  let loadPaper: any = null, buildPaperIndex: any = null
  try {
    ;({ loadPaper, buildPaperIndex } = await import('./paperData.js'))
  } catch (e: any) {
    return { source: 'gwy-zhenti', skipped: true, reason: 'paperData 模块加载失败: ' + (e && e.message), questions: 0, relations: 0 }
  }
  let papers: any[] = []
  try {
    const idx = buildPaperIndex(repoRoot)
    papers = idx.papers || []
  } catch (e: any) {
    return { source: 'gwy-zhenti', skipped: true, reason: '卷索引构建失败: ' + (e && e.message), questions: 0, relations: 0 }
  }
  if (!papers.length) return { source: 'gwy-zhenti', skipped: true, reason: '卷索引为空（数据根无 gwy-zhenti）', questions: 0, relations: 0 }

  const maxPapers = opts.maxPapers && opts.maxPapers > 0 ? opts.maxPapers : papers.length
  const stats = { questions: 0, relations: 0, papers: 0, skipped: false, files: 0, lastError: '' }
  const insQ = prepareQuestionUpsert(db)
  const ev = JSON.stringify({ src: 'gwy-zhenti', rule: 'loadPaper' })

  withTx(db, () => {
    putSource(db, 'gwy-zhenti', 'recommended', 'gwy-zhenti（真题卷 md）', join(repoRoot, 'gwy-zhenti'))
    // 逐卷：loadPaper → 题目映射 → UPSERT（单源一个事务）
    for (const meta of papers.slice(0, maxPapers)) {
      try {
        const paper = loadPaper(repoRoot, meta.id)
        if (!paper || paper.error || !Array.isArray(paper.questions)) continue
        stats.papers++
        for (const q of paper.questions) {
          const no = Number(q.no || 0)
          const qid = 'gwy:' + meta.id + '#' + no   // 源内唯一键（卷+题号）
          // cycle-40：内容指纹——与 xingce-app/naoku 同题内容归一（出处保留，解析多版本）
          const stemNorm = stripHtmlKeepImg(q.stem)
          const cfp = contentFingerprint(stemNorm, q.options)
          const canon = deriveCanonicalId(qid, '', stemNorm || undefined, { namespace: 'gwy-zhenti', contentFp: cfp || undefined })
          // gwy 卷面无 qid 上游键——但与 xingcezhenti/naoku 的同题可能内容一致：
          // SAME_AS 不在此建（无强证据键），留给 fp 命中或人工校验（合并靠认亲）。
          const relations: Array<{ type: any, dstKind: string, dstId: string, weight?: number }> = []
          relations.push({ type: 'IN_MODULE', dstKind: 'module', dstId: String(paper.subject || '行测') })
          if (paper.exam) relations.push({ type: 'APPEARS_IN', dstKind: 'paper', dstId: meta.id })
          if (paper.region) relations.push({ type: 'SAME_REGION', dstKind: 'region', dstId: String(paper.region) })
          if (String(q.type || '').trim()) relations.push({ type: 'IN_MODULE', dstKind: 'category', dstId: String(q.type) })
          const optsMap = q.options && typeof q.options === 'object' && !Array.isArray(q.options) ? JSON.stringify(q.options) : ''
          const imgs = extractImages(q.stem)
          const r = upsertQuestionBundle(insQ, {
            qid, canonicalId: canon, sourceId: 'gwy-zhenti', localKey: meta.id + '#' + no,
            module: String(paper.subject || '行测'), qtype: String(q.type || ''),
            stem: stripHtmlKeepImg(q.stem), options: optsMap,
            answer: String(q.correctAnswer || '').toUpperCase(),
            analysis: stripHtmlKeepImg(q.analysis), contentFp: cfp,
            groupMaterial: stripHtmlKeepImg(q.groupMaterial || ''),
            images: JSON.stringify(imgs), hasImage: imgs.length ? 1 : 0,
            paper: meta.id, region: String(paper.region || ''), year: String(paper.year || ''),
            seq: no,
          }, { evidence: ev, relations }, { db, localKey: meta.id + '#' + no, paper: meta.id, region: String(paper.region || ''), year: String(paper.year || ''), seq: no })
          if (r.ok) stats.questions++
          putAnalysis(db, canon, 'gwy-zhenti', meta.id + '#' + no, String(q.analysis || ''), String(q.correctAnswer || '').toUpperCase())
          stats.relations += relations.length
        }
      } catch (e: any) {
        stats.lastError = '卷 ' + meta.id + ': ' + (e && e.message ? e.message : String(e))
        /* 单卷失败不阻塞整轮（单源内继续） */
      }
    }
  })
  return { source: 'gwy-zhenti', ...stats }
}
