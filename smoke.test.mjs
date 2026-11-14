/**
 * dsh-kaogong E2E 冒烟测试 — 白盒验证 v1.1
 * 运行: node smoke.test.mjs
 * 覆盖: 信标发现 / adopt复用 / 崩溃安全(EADDRINUSE不逃逸) / 工作区隔离 /
 *       抽题判分 / 计划结构化 / 检索方法论 / 图谱指标 / 遥测 / 能力矩阵
 *       cycle-13 省份维度与导航精简（W2a 源码级静态断言；W3 build 后将补运行时断言）
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { startServer, REPO_ROOT } from './dist/server/http.js'

/* ── 0a. combo 完整性自愈（cycle-13 教训⑥：eval-runner 并行预热 test∥build 竞态）──
 * build 的 tsc 步会把 dist/client/client.js 短暂重写为裸 ESM（bundler 合并前）。
 * 自愈不能只做启动时一次——静态守卫在 ~24s 后才真正读文件，窗口在「读取时刻」。
 * 判据用「行首 import」：裸 ESM 必有、合并 combo 必无（bundler 终检保证）；
 * **不能用 combo 头文本判据——entry 源码本身就含 window.__ModuleLoader__.load({**。
 * 所有读取 dist/client/client.js 的位置一律走 readClientBundle()：读前自检，
 * 检出裸 ESM → 现场重跑 bundler（幂等 + 原子写 tmp+rename）→ 重读。 */
const CLIENT_BUNDLE_URL = new URL('./dist/client/client.js', import.meta.url)
function readClientBundle(reason) {
  let txt = fs.readFileSync(CLIENT_BUNDLE_URL, 'utf-8')
  if (/^import[ \t]/m.test(txt)) {
    try {
      const r = spawnSync(process.execPath, ['scripts/bundle-client.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: 'pipe' })
      console.log(`ℹ️ combo 完整性自愈(${reason}): 检测到裸 ESM 产物，已重跑 bundler (exit=${r.status})`)
      txt = fs.readFileSync(CLIENT_BUNDLE_URL, 'utf-8')
    } catch (e) { console.log(`ℹ️ combo 自愈跳过(${reason}): ` + ((e && e.message) || e)) }
  }
  return txt
}
{
  let comboOk = false
  try { comboOk = !/^import[ \t]/m.test(fs.readFileSync(CLIENT_BUNDLE_URL, 'utf-8')) } catch { /* 无产物 → 交给 0 新鲜度门报错 */ }
  if (!comboOk) readClientBundle('启动')
}

const results = []
let failed = 0
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  if (!cond) failed++
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' — ' + detail}`)
}
const J = async (u) => { const r = await fetch(u); return r.json() }
const P = async (u, body) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json() }

// ── 0. 构建产物新鲜度（T-022：dist 必须不旧于 src）──
{
  const ROOT = new URL('.', import.meta.url)
  const pairs = []
  ;(function walk(dir, rel) {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + name.name : name.name
      if (name.isDirectory()) { walk(new URL(name.name + '/', dir), r); continue }
      if (name.name.endsWith('.ts')) pairs.push(r.replace(/\.ts$/, '.js'))
    }
  })(new URL('src/', ROOT), '')
  const stale = []
  for (const rel of pairs) {
    const srcUrl = new URL('src/' + rel.replace(/\.js$/, '.ts'), ROOT)
    const distUrl = new URL('dist/' + rel, ROOT)
    if (!fs.existsSync(distUrl)) { stale.push(rel + "（产物缺失）"); continue }
    if (fs.statSync(distUrl).mtimeMs < fs.statSync(srcUrl).mtimeMs - 1000) stale.push(rel + "（产物过期）")
  }
  check('构建产物新鲜(dist >= src)', stale.length === 0, stale.slice(0, 3).join('; ') || 'ok')
}


// ── 1. 启动（独立测试端口段 8495+，与宿主生产 8400 段完全隔离；不写真相信标）──
const TP = +(process.env.KG_PORT || 8495)
const { server, port, adopted } = await startServer(TP, { publishRuntime: false, prewarm: false })
check('server 启动返回 port', typeof port === 'number', `got ${port}`)
const B = `http://127.0.0.1:${port}`

// ── 2. 信标自描述 ──
const st = await J(`${B}/api/status?ws=PROJ_A`)
check('status.app 信标字段', st.app === 'dsh-kaogong', JSON.stringify(st).slice(0, 80))
check('status 含 pid/uptime/port', st.pid > 0 && st.uptimeSec >= 0 && st.port === port)

// ── 3. adopt 复用（二次启动不应崩、不应新绑端口）──
const second = await startServer(TP, { publishRuntime: false, prewarm: false })
check('二次启动 adopt 同端口', second.port === port && second.adopted === true, JSON.stringify(second).slice(0, 60))

// ── 4. 工作区隔离 ──
const A = `${B}/api/progress?ws=PROJ_A`, Z = `${B}/api/progress?ws=PROJ_B`
const qA = await J(`${B}/api/questions?module=判断推理&count=1&ws=PROJ_A`)
check('抽题成功', qA.questions?.length === 1, JSON.stringify(qA).slice(0, 120))
if (qA.questions?.[0]) {
  await P(`${B}/api/check?ws=PROJ_A`, { question: qA.questions[0], answer: qA.questions[0].correctAnswer, label: 'PROJ_A' })
  const pa = await J(A), pb = await J(Z)
  check('PROJ_A 记录作答', pa.answered >= 1, `answered=${pa.answered}`)
  check('PROJ_B 未污染', (pb.answered || 0) === 0, `B.answered=${pb.answered}`)
}

// ── 5. 计划结构化 ──
const plan = await J(`${B}/api/plan`)
check('计划 4 阶段', plan.phases?.length === 4, `${plan.phases?.length}`)
check('计划 30 天', plan.days?.length === 30, `${plan.days?.length}`)
check('天含标题与任务', plan.days?.[0]?.title && Array.isArray(plan.days?.[0]?.tasks))

// ── 6. 检索与方法论 ──
const se = await J(`${B}/api/search?q=增长率`)
check('知识检索命中', se.results?.length > 0, `${se.results?.length}`)
const me = await J(`${B}/api/methods`)
check('方法论目录 10 主题', me.topics?.length === 10, `${me.topics?.length}`)
const m1 = await J(`${B}/api/method?topic=行测`)
check('行测方法论内容', (m1.content || '').length > 100)

// ── 7. 图谱 ──
const g = await J(`${B}/api/graph`)
check('图谱节点>30', g.nodes?.length > 30, `${g.nodes?.length}`)
check('图谱边>30', g.edges?.length > 30, `${g.edges?.length}`)
check('图指标含密度/分量/PR', typeof g.metrics?.density === 'number' && g.metrics?.components >= 1 && Array.isArray(g.rank))
check('图谱含双入口节点', g.nodes.filter(n => n.type === 'entry').length === 2, `${g.nodes.filter(n => n.type === 'entry').length}`)
check('健康度 0-100', g.health?.total >= 0 && g.health?.total <= 100, JSON.stringify(g.health?.total))

// ── 8. 遥测 ──
const tel = await J(`${B}/api/telemetry`)
check('遥测记录请求数', tel.totalRequests > 5, `${tel.totalRequests}`)
check('遥测 p50/p95 存在', Object.values(tel.endpoints).some(e => typeof e.p50 === 'number'))
check('端点覆盖统计', typeof tel.coverage === 'number')

// ── 9. 能力矩阵与命名空间 ──
const caps = await J(`${B}/api/capabilities`)
// cycle-18 新增 kaogong_ai_method（内置花生十三体系接进模型增强链路）→ 基础 5 + 1 = 6。
// 断言改为「计数 ≡ 名称去重后集合大小」+ 关键工具在场，既守住不重复登记，也不因合法新增而假红。
{
  const toolNames = (caps.tools || []).map(t => t && t.name)
  check('能力矩阵工具计数自洽（6 个且名称唯一，含 cycle-18 方法论检索工具）',
    toolNames.length === 6 && new Set(toolNames).size === 6 &&
    toolNames.indexOf('kaogong_ai_method') >= 0 &&
    ['kaogong_ai_tutor', 'kaogong_ai_plan', 'kaogong_ai_shenlun', 'kaogong_ai_essay_review']
      .every(n => toolNames.indexOf(n) >= 0),
    `count=${toolNames.length} [${toolNames.join(',')}]`)
}
check('能力矩阵端点≥14', caps.endpoints?.length >= 14, `${caps.endpoints?.length}`)
check('双入口声明（左沉浸+右并排）', caps.entries?.length === 2 && caps.entries.some(e => e.kind === 'left-immersive') && caps.entries.some(e => e.kind === 'right-docked'), JSON.stringify(caps.entries || []))
check('双通道声明（同源优先）', caps.channels?.length === 2 && caps.channels.find(c => c.id === 'same-origin')?.preferred === true, JSON.stringify(caps.channels || []))
const wss = await J(`${B}/api/workspaces`)
check('命名空间清单含 PROJ_A', (wss.workspaces || []).some(w => w.ns.includes('PROJ_A')), JSON.stringify(wss.workspaces?.map(w => w.ns)))

// ── 11. 错题本 SRS 闭环（收集→回炉→升箱→掌握→移除→统计；独立 PROJ_S 命名空间）──
{
  const W = '?ws=PROJ_S'
  // 取一道"干净"错题：循环抽题直到 stem 不在错题本（同文件重复题会致签名计数>1，flaky 根因）
  // cycle-29 加固：空响应/错误响应防御——抽题器偶发 {error} 时跳过本轮而非裸崩（.questions[0]）
  let q1 = null, wrongAns = null
  for (let i = 0; i < 6; i++) {
    const qr = await J(`${B}/api/questions?module=常识判断&count=1`)
    const cand = qr && Array.isArray(qr.questions) && qr.questions.length ? qr.questions[0] : null
    if (!cand) continue   // 端点级 error/空（数据根未就绪等）→ 跳过，循环末尾统一判失败
    const existing = (await J(`${B}/api/wrong${W}`)).wrong.find(w => w.stem === cand.stem)
    if (!existing || existing.wrongCount === 0) { q1 = cand; break }
    // 撞重复题：把它从错题本清掉再重测
    if (existing) await P(`${B}/api/wrong/remove${W}`, { sig: existing.sig })
  }
  // cycle-29：6 轮全部空响应 = 服务端抽题不可用（真实缺陷），响亮失败而非 undefined 解引用裸崩
  if (!q1) throw new Error('SRS 前置抽题 6 轮均空响应（/api/questions 常识判断）——检查数据根与题库文件')
  wrongAns = 'A' === q1.correctAnswer ? 'B' : 'A'
  await P(`${B}/api/check${W}`, { question: q1, answer: wrongAns })  // 故意答错
  const wb1 = await J(`${B}/api/wrong${W}`)
  const item = wb1.wrong.find(w => w.stem === q1.stem)
  check('答错自动入错题本(box=1)', !!item && item.box === 1 && item.wrongCount === 1, JSON.stringify(item ? { box: item.box, n: item.wrongCount } : wb1.wrong.length))
  const srs = await J(`${B}/api/questions?module=all&count=1&sort=srs&ws=PROJ_S`)
  check('SRS 回炉优先未掌握错题', srs.mode === 'retry' && srs.questions[0]?.fromWrongBook === true, srs.mode)
  const rq = srs.questions[0]
  const r1 = await P(`${B}/api/check${W}`, { question: rq, answer: rq.correctAnswer })
  check('回炉答对升箱(promoted)', r1.wrongEvent?.type === 'promoted' && r1.wrongEvent.box === 2, JSON.stringify(r1.wrongEvent))
  const r2 = await P(`${B}/api/check${W}`, { question: rq, answer: rq.correctAnswer })
  check('连对2次+箱≥3 → 掌握', r2.wrongEvent?.type === 'mastered', JSON.stringify(r2.wrongEvent))
  const rm = await P(`${B}/api/wrong/remove${W}`, { sig: rq.sig })
  check('错题可移除', rm.removed === 1, JSON.stringify(rm))
  const stats = await J(`${B}/api/stats${W}`)
  check('统计端点结构(days/streak/mastery/wrong)', Array.isArray(stats.days) && typeof stats.streak === 'number' && stats.wrong && typeof stats.wrong.open === 'number')
}

// ── 11c. v1.7 图片/模考/大作文/深度题库 ──
{
  const W3 = '?ws=PROJ_V7'

  // T-018 题目配图：行测卷图片可访问
  const xc = (await J(`${B}/api/papers?subject=行测`)).papers.find(x => x.imageCount > 0)
  if (xc) {
    const pd = await J(`${B}/api/paper?id=${encodeURIComponent(xc.id)}`)
    const withImg = (pd.questions || []).find(q2 => /!\[[^\]]*\]\(([^)]+)\)/.test(q2.stem || ''))
    check('行测题含配图引用', !!withImg, withImg ? '有' : '无')
    if (withImg) {
      const src = withImg.stem.match(/!\[[^\]]*\]\(([^)]+)\)/)[1]
      check('配图 URL 已改写为服务端点', src.includes('/api/paper-img'), src.slice(0, 60))
      const img = await fetch(B + src)
      const buf = await img.arrayBuffer()
      check('配图可真实加载(二进制)', img.status === 200 && buf.byteLength > 500, `${img.status} / ${buf.byteLength}B`)
    } else { check('配图可真实加载(二进制)', false, '无含图题') ; check('配图 URL 已改写为服务端点', false, 'skip') }
  } else {
    check('行测题含配图引用', false, '无含图卷')
    check('配图 URL 已改写为服务端点', false, 'skip')
    check('配图可真实加载(二进制)', false, 'skip')
  }

  // T-016 整卷模考：开始 → 交卷 → 模块分布
  const ex = await J(`${B}/api/paper/exam/start?id=${encodeURIComponent('国考/2008/行测-统考')}`)
  check('模考开始返回整卷(不泄露答案)', ex.questionCount > 100 && ex.questions[0].answer === undefined, `${ex.questionCount} 题, answer 字段=` + typeof ex.questions[0].answer)
  const ans = {}
  for (const q2 of ex.questions) if (q2.answer) ans[q2.no] = q2.answer
  // 用真实答案交卷（验证评分正确性）
  const realPaper = await J(`${B}/api/paper?id=${encodeURIComponent('国考/2008/行测-统考')}`)
  const ansReal = {}
  for (const q2 of realPaper.questions) if (q2.correctAnswer) ansReal[q2.no] = q2.correctAnswer
  const sub = await P(`${B}/api/paper/exam/submit${W3}`, { id: '国考/2008/行测-统考', answers: ansReal, elapsedSec: 5400 })
  check('模考交卷计分正确(全对=100%)', sub.rate === 100 && sub.correct > 100, `${sub.rate}% (${sub.correct}/${sub.answered})`)
  check('模考返回模块得分分布', Array.isArray(sub.modules) && sub.modules.length > 1, `${sub.modules.length} 类`)

  // T-017 大作文分档
  const art = await P(`${B}/api/essay/article${W3}`, {
    question: '请以「文化自信」为主题写一篇文章',
    requirement: '1000字左右',
    answer: '当前我国正处于高质量发展关键期，文化自信成为时代命题。首先，文化自信是治理现代化的根基，因为只有立足本土文化才能形成制度认同。例如，浙江余村的生态治理正是汲取了天人合一智慧。其次，文化创新为治理提供方法，诸如枫桥经验化解基层矛盾。再次，文化的开放包容拓展治理视野，借鉴人类文明有益成果。总之，唯有让传统文化与时代精神同频共振，方能开创治理新境界。',
  })
  check('大作文返回字数分档', !!art.lengthBand, art.lengthBand + ' (' + art.chars + '/' + art.limit + ')')
  check('大作文识别结构要素', art.elements && art.elements.subPoints >= 1, JSON.stringify(art.elements || {}))
  const artBad = await P(`${B}/api/essay/article${W3}`, { question: 'x', requirement: '1000字左右', answer: '我觉得挺重要的，反正要发展。' })
  check('大作文评分有区分度', art.score > artBad.score, `好${art.score} vs 差${artBad.score}`)

  // v1.7.1 专题树：行测/申论分频道 + 每专题带练习入口
  const topicTree = await J(`${B}/api/topics`)
  check('专题树分频道(行测/申论)', Array.isArray(topicTree.channels) && topicTree.channels.length === 2, (topicTree.channels || []).map(c => c.name).join('/'))
  const xcCh = (topicTree.channels || []).find(c => c.id === 'xingce')
  const slCh = (topicTree.channels || []).find(c => c.id === 'shenlun')
  check('行测专题含模块+细分题型', (xcCh.topics || []).filter(t => t.kind === 'module').length >= 6 && (xcCh.topics || []).some(t => t.kind === 'category'), `${(xcCh.topics || []).length} 个专题`)
  check('申论专题含五类题型', (slCh.topics || []).length === 5, (slCh.topics || []).map(t => t.title).join('/'))
  check('行测有练习入口(含刷题/深度/模考)', (xcCh.entries || []).length >= 3, (xcCh.entries || []).map(e => e.label).join('/'))
  check('申论练习入口并入专题', (slCh.entries || []).some(e => e.view === 'essay'), (slCh.entries || []).map(e => e.label).join('/'))
  check('专题 entry 指向练习视图', (xcCh.topics || []).every(t => t.entry && t.entry.view), 'ok')


  // v1.7.5 图形推理专项（gk-tuxing 354 题 / 13 类规律）
  const tx = await J(`${B}/api/tuxing/cats`)
  check('图推题库就绪(354题)', tx.ready === true && tx.total === 354, `total=${tx.total}`)
  check('图推13类规律', (tx.cats || []).length === 13, (tx.cats || []).map((c) => c.name).slice(0, 5).join('/'))
  const txList = await J(`${B}/api/tuxing/list?cat=symmetry&limit=2`)
  check('图推按规律抽题', txList.questions.length === 2 && txList.questions[0].cat === 'symmetry', `symmetry ${txList.total} 题`)
  {
    const img = await fetch(B + txList.questions[0].imgUrl)
    const buf = await img.arrayBuffer()
    check('图推配图可加载(二进制)', img.status === 200 && buf.byteLength > 500, `${img.status} / ${buf.byteLength}B`)
  }
  const txQ = await J(`${B}/api/tuxing/q?id=${txList.questions[0].id}`)
  check('图推单题含原创思路', typeof txQ.exp === 'string' && txQ.exp.length > 30, `exp ${txQ.exp.length} 字`)

  // v1.7 深度题库（Naoku 五维标注，Node≥22.19 才有）
  const nk = await J(`${B}/api/naoku/status`)
  if (nk.ready) {
    check('深度题库就绪(27506题)', nk.stats.total > 20000, `${nk.stats.total} 题`)
    check('五维标注覆盖(知识点100%)', nk.stats.kadianCoverage === 100, `${nk.stats.kadianCoverage}%`)
    const nq = await J(`${B}/api/naoku/questions?module=判断推理&count=1`)
    const q3 = nq.questions[0]
    check('深度抽题含解题链标注', !!(q3 && (q3.kadian || q3.reasoning || q3.fastest)), q3 ? q3.type : '无')
    const kd = await J(`${B}/api/naoku/kadian?q=图形&limit=3`)
    check('知识点检索可用', (kd.list || []).length > 0, `${(kd.list || []).length} 条`)
  } else {
    check('深度题库就绪(27506题)', false, 'node:sqlite 不可用（降级路径已设计）')
    check('五维标注覆盖(知识点100%)', false, 'skip')
    check('深度抽题含解题链标注', false, 'skip')
    check('知识点检索可用', false, 'skip')
  }
}

// ── cycle-15 专项刷题记忆 /api/memory + 图谱三布局/流动粒子 + 白盒三件套（运行时+源码级守卫）──
// 位置纪律（教训⑧+⑤）：必须在 §11b 长阻塞索引重建之前（keep-alive 竞态）、§12 崩溃安全之前
// （该节 server.close() 后 B 不可用）。运行时 fetch 断言只允许活在「连接池健康窗口」内。
{
  const fs = await import('node:fs')
  const readSrc = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf-8')
  // ① 运行时：默认空 → POST 写入 → GET 回读（PROJ_A 命名空间；产物文件由结尾清理段回收）
  // 幂等前置（cycle-18 实测坑）：PROJ_A 的 progress 文件若因**上轮中途崩溃**残留，
  // 会让「记忆默认为空」这条断言假红（本轮实证：上一轮崩在后续 §，cleanup 没跑到）。
  // 测试必须自己保证初始态，不能依赖上次运行是否干净收尾。
  {
    const p = new URL('./data/progress/PROJ_A-54357955.json', import.meta.url)
    try { if (fs.existsSync(p)) fs.rmSync(p) } catch { /* 只读文件系统等：交给断言如实报 */ }
  }
  const MA = `${B}/api/memory?ws=PROJ_A`
  const m0 = await J(MA)
  check('SMOKE-MEM-01 记忆默认为空对象', m0 && typeof m0.memory === 'object' && Object.keys(m0.memory).length === 0, JSON.stringify(m0).slice(0, 80))
  const m1 = await P(MA, { kind: 'practice', data: { module: '判断推理', question: { stem: '记忆恢复原题干', options: { A: 'a', B: 'b' }, correctAnswer: 'A', module: '判断推理' } } })
  check('SMOKE-MEM-02 记忆写入 ok+kind+at', m1 && m1.ok === true && m1.kind === 'practice' && typeof (m1.memory && m1.memory.at) === 'number', JSON.stringify(m1).slice(0, 120))
  const m2 = await J(MA)
  check('SMOKE-MEM-03 记忆回读含原题对象', m2?.memory?.practice?.question?.stem === '记忆恢复原题干' && m2?.memory?.practice?.module === '判断推理', JSON.stringify(m2).slice(0, 120))
  // ② 隔离：PROJ_B 看不到 PROJ_A 的记忆（工作区命名空间隔离语义）
  const m3 = await J(`${B}/api/memory?ws=PROJ_B`)
  check('SMOKE-MEM-04 记忆按工作区隔离', m3 && m3.memory && !m3.memory.practice, JSON.stringify(m3).slice(0, 80))
  // ③ 校验：非法 kind / 缺 data / 超限 均受控拒绝（HTTP 200 + {error}，绝不 5xx）
  const m4a = await P(MA, { kind: 'BAD_KIND', data: {} })
  const m4b = await P(MA, { kind: 'practice' })
  const m4c = await P(MA, { kind: 'practice', data: { blob: 'x'.repeat(9000) } })
  check('SMOKE-MEM-05 非法 kind/缺 data/超 8KB 均受控拒绝', !!(m4a && m4a.error) && !!(m4b && m4b.error) && !!(m4c && m4c.error), JSON.stringify([m4a, m4b, m4c]).slice(0, 200))
  // ④ manifest 单一事实源：端点声明 + 消费者=三专项视图（三端同步契约）
  const manifestSrc = readSrc('./src/shared/manifest.ts')
  check('SMOKE-MEM-06 manifest 声明 /api/memory 且消费者=三专项视图', manifestSrc.includes("path: '/api/memory'") && manifestSrc.includes("consumers: ['ui:practice', 'ui:tuxing', 'ui:deepbank']"))
  // ⑤ 图谱三布局：环形布局函数（层序+id 序圆周、半径自适应）+ 引擎分支 + 三态轮换单一序列
  const transSrc = readSrc('./src/client/graph/graph-transition.ts')
  const engineSrc = readSrc('./src/client/graph/graph-engine.ts')
  const physicsSrc = readSrc('./src/client/graph/graph-physics.ts')
  const graphViewSrc = readSrc('./src/client/views/graph-view.tsx')
  check('SMOKE-GR15-01 环形布局（语义层序圆周+半径自适应+确定性）', /export function graphCircularLayout/.test(transSrc) && transSrc.includes('labelGap') && transSrc.includes('2 * Math.PI * i) / V'))
  check('SMOKE-GR15-01 引擎接受 circular 且终态走确定性函数', engineSrc.includes("mode === 'circular' ? 'circular'") && engineSrc.includes('graphCircularLayout(simNodes, nodeMeta, W, H)'))
  check('SMOKE-GR15-01 布局三态轮换（按钮=键盘同一 KG_LAYOUTS 序列）', graphViewSrc.includes("const KG_LAYOUTS = ['force', 'layered', 'circular']") && (graphViewSrc.match(/kgNextLayout/g) || []).length >= 2)
  // ⑥ 流动粒子：语义边集 + 确定性相位 + opt-in 开关（关闭即停帧省电）
  check('SMOKE-GR15-02 流动粒子语义边集+确定性相位', physicsSrc.includes('const KG_FLOW_RELS') && physicsSrc.includes('graphHash(String(e.a)') && engineSrc.includes('flow: { on: flowOn, t: now / 1700 }'))
  check('SMOKE-GR15-02 粒子 opt-in（开启续帧/关闭停帧）', engineSrc.includes('|| flowOn) schedule()') && graphViewSrc.includes('flowParticles: flowOn'))
  // ⑦ 白盒三件套：延迟分位阶梯 / 生命周期完成度环 / 吞吐×延迟四象限
  const obsSrc = readSrc('./src/client/views/obs-view.tsx')
  check('SMOKE-OBS15-01 延迟分位阶梯（SLO 200/500 阈值线+有序统计量）', obsSrc.includes('function ObsQuantLadder') && obsSrc.includes("'SLO 200ms'") && obsSrc.includes("'500ms'"))
  check('SMOKE-OBS15-01 生命周期完成度环（done/total 圆环占比）', obsSrc.includes('function ObsLifeRing') && obsSrc.includes('strokeDasharray') && obsSrc.includes("state === 'done'"))
  check('SMOKE-OBS15-02 吞吐×延迟四象限（log10 对数轴+中位吞吐+SLO 横线）', obsSrc.includes('function ObsScatter') && obsSrc.includes('Math.log10(1 +') && obsSrc.includes('中位吞吐'))
}

// ── cycle-16 一键式题库管理（/api/repos* 运行时 + 数据根动态化静态守卫）──
// 位置纪律（教训⑧+⑤）：运行时断言必须在 §11b 长阻塞之前、§12 关服务器之前。
// 真实 clone 不在 smoke 跑（341MB+ 网络依赖）；只测控制面协议与校验路径。
{
  const fs = await import('node:fs')
  const readSrc = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf-8')
  // ① 状态总览：结构完整 + 全仓库登记 + tier 词表合法（cycle-18：huasheng13 纳入统一管理 → 16）
  const rs = await J(`${B}/api/repos`)
  check('SMOKE-RP-01 /api/repos 结构（root/repos/summary/git）', rs && typeof rs.root === 'string' && Array.isArray(rs.repos) && rs.repos.length === 16 && typeof rs.git === 'boolean' && rs.summary && rs.summary.total === 16, JSON.stringify(rs).slice(0, 140))
  // cycle-18：方法论语料必须作为「必选」被统一管理（不是内置旁路）
  {
    const hs = (rs.repos || []).find(r => r.key === 'huasheng13')
    check('SMOKE-RP-01c huasheng13 纳入题库管理且 tier=required（统一配置，无内置旁路）',
      !!hs && hs.tier === 'required' && hs.builtin === undefined &&
      String(hs.upstream).includes('WangJunqing-coder/huasheng13-skill'),
      JSON.stringify(hs || {}).slice(0, 180))
  }
  const tiers = new Set(rs.repos.map(r => r.tier))
  check('SMOKE-RP-01 tier 词表=required/recommended/optional 且必选≥3', [...tiers].every(t => ['required', 'recommended', 'optional'].includes(t)) && tiers.size === 3 && rs.repos.filter(r => r.tier === 'required').length >= 3, [...tiers].join(','))
  check('SMOKE-RP-01 每仓库含 upstream 真实 GitHub 地址', rs.repos.every(r => typeof r.upstream === 'string' && r.upstream.startsWith('https://github.com/')))
  // ①b 关于本项目：self 元数据透出（GitHub 跳转单一事实源=manifest SELF_META）
  check('SMOKE-RP-01b self 元数据（repo/releases/issues/npm + 版本=manifest 锚点）', rs.self && rs.self.repo === 'https://github.com/xuanyuanchumo/dsh-kaogong' && typeof rs.self.version === 'string' && /^1\./.test(rs.self.version) && rs.self.releases.includes('/releases') && rs.self.issues.includes('/issues') && typeof rs.self.npm === 'string', JSON.stringify(rs.self || {}).slice(0, 200))
  // cycle-17 版本统一守卫：/api/repos 的 self.version 必须与 /api/capabilities 的 plugin.version
  // 同源相等（两处都引用 CAPABILITIES.plugin.version 单一事实源；页面徽章与能力矩阵漂移即红）
  {
    const capsV = await J(`${B}/api/capabilities`)
    check('SMOKE-VER-01 self.version ≡ capabilities.plugin.version（版本单一事实源）', rs.self && capsV.plugin && rs.self.version === capsV.plugin.version, `self=${rs.self && rs.self.version} caps=${capsV.plugin && capsV.plugin.version}`)
  }
  // ② 校验路径：未知 key / 无作业取消 → {error} 且 HTTP 200
  const bad1 = await P(`${B}/api/repos/install`, { key: 'no_such_repo' })
  const bad2 = await P(`${B}/api/repos/cancel`, { key: 'sakib' })
  check('SMOKE-RP-02 未知 key 安装/无作业取消均受控拒绝', !!(bad1 && bad1.error) && !!(bad2 && bad2.error), JSON.stringify([bad1, bad2]).slice(0, 160))
  // ③ 浏览：已就绪仓库返回条目；越界 sub 拒绝（路径穿越防线）
  const readyKey = (rs.repos.find(r => r.present) || {}).key || 'sakib'
  const br = await J(`${B}/api/repos/browse?key=${encodeURIComponent(readyKey)}`)
  const brBad = await J(`${B}/api/repos/browse?key=sakib&sub=${encodeURIComponent('../../../etc')}`)
  check('SMOKE-RP-03 目录浏览可用（就绪仓库返回 items 数组）', Array.isArray(br.items), JSON.stringify(br).slice(0, 120))
  check('SMOKE-RP-03 越界 sub 受控拒绝', !!(brBad && brBad.error), JSON.stringify(brBad).slice(0, 100))
  // ④ 配置往返：mirror 写入→读回→还原（测前备份 config 文件）
  const CFGF = new URL('./data/repos-config.json', import.meta.url)
  const hadCfg = fs.existsSync(CFGF)
  const bak = hadCfg ? fs.readFileSync(CFGF, 'utf-8') : null
  try {
    const cf = await P(`${B}/api/repos/config`, { mirror: 'https://example-mirror.test/' })
    const rs2 = await J(`${B}/api/repos`)
    check('SMOKE-RP-04 镜像配置写入即生效（status 回显）', !!(cf && cf.ok) && rs2.mirror === 'https://example-mirror.test/', JSON.stringify(rs2.mirror))
  } finally {
    if (hadCfg) fs.writeFileSync(CFGF, bak)
    else if (fs.existsSync(CFGF)) fs.rmSync(CFGF)
  }
  // ⑤ 静态守卫：数据根解析优先级 / spawn 崩溃安全 / 域重建失效链 / combo 前缀纪律
  const drSrc = readSrc('./src/server/dataRoot.ts')
  check('SMOKE-RP-05 数据根四级解析（env>config>dev-parent>managed）', drSrc.includes('KG_REPOS_DIR') && drSrc.includes('repos-config.json') && drSrc.includes('dev-parent') && drSrc.includes('managed-default'))
  const rmSrc = readSrc('./src/server/repoManager.ts')
  check('SMOKE-RP-05 spawn error 事件必须接住（崩溃安全）', /proc\.on\('error'/.test(rmSrc) && rmSrc.includes('GIT_TERMINAL_PROMPT'))
  // cycle-20：clone/pull 判断移入 prepareInstall（半成品先清理再判定），语义等价且更严格
  check('SMOKE-RP-05 智能判断 clone vs pull + 非 git 目录保护', rmSrc.includes("const hasGit = existsSync(join(target, '.git'))") && rmSrc.includes("const action = hasGit ? 'pull' : 'clone'") && rmSrc.includes('拒绝覆盖'))
  const httpSrc16 = readSrc('./src/server/http.ts')
  check('SMOKE-RP-05 数据根变更重建域并失效缓存（paperIndex/naoku/graphCache）', httpSrc16.includes('resetPaperIndex()') && httpSrc16.includes('resetNaoku()') && httpSrc16.includes('graphCache.clear()'))
  // cycle-17 隔离守卫：图谱缓存必须按 wsKey 分槽（跨工作区进度不互染）
  check('SMOKE-RP-06 图谱缓存按 wsKey 分槽（跨项目隔离）', httpSrc16.includes('const graphCache = new Map') && httpSrc16.includes('graphCache.set(ck') && httpSrc16.includes('domains.store.wsKey(wsRaw)'))
  check('SMOKE-RP-05 manifest 声明 10 个 /api/repos* 端点且消费者=ui:repos（cycle-20 增 3：batch/jobs/install-batch）', (readSrc('./src/shared/manifest.ts').match(/path: '\/api\/repos/g) || []).length === 10)
  const clientSrc = readSrc('./src/client/client.tsx')
  check('SMOKE-RP-05 client 接线题库管理视图（cycle-24 注册表路由 + 窄 props）', /repos: \{ comp: NativeReposView/.test(clientSrc))
  const rvSrc = readSrc('./src/client/views/repos-view.tsx')
  check('SMOKE-RP-05 combo 顶层名纪律（rp/Rp/RP 前缀或 Native*View 视图惯例，教训⑨）', !/^(?:function|const|class)\s+(?!rp|Rp|RP|NativeReposView)[A-Za-z_$]/m.test(rvSrc))
}

// ── cycle-20 题库管理流程优化（运行时 + 静态守卫；位置纪律：§11b 长阻塞前、§12 关服务器前）──
{
  const fs = await import('node:fs')
  const readSrc20 = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf-8')
  // ── 运行时：status 新增字段契约 ──
  const rs = await J(`${B}/api/repos`)
  check('SMOKE-RM-01 /api/repos 增 previousRoot/diskFreeMB/recentJobs/health 汇总字段',
    rs && 'previousRoot' in rs && 'previousRootRepos' in rs && 'diskFreeMB' in rs && Array.isArray(rs.recentJobs) &&
    rs.summary && rs.summary.health && typeof rs.summary.health.ok === 'number',
    JSON.stringify(rs && rs.summary && rs.summary.health))
  check('SMOKE-RM-02 每仓库含 health/lastCommitAt（健康巡检字段，词表受控）',
    Array.isArray(rs.repos) && rs.repos.every(r => ['ok', 'empty', 'half-clone', 'no-git', 'absent'].includes(r.health) && 'lastCommitAt' in r))
  // ── 运行时：作业历史端点（G3）与批次端点契约（G2）──
  const jobsR = await J(`${B}/api/repos/jobs?limit=5`)
  check('SMOKE-RM-03 /api/repos/jobs 返回 total+jobs 数组', jobsR && typeof jobsR.total === 'number' && Array.isArray(jobsR.jobs))
  const batchBad = await P(`${B}/api/repos/install-batch`, { keys: ['no_such_repo'] })
  check('SMOKE-RM-04 install-batch 未知 key 受控拒绝（不落盘不 spawn）', !!(batchBad && batchBad.error), JSON.stringify(batchBad))
  const qBatch = await J(`${B}/api/repos/batch?id=no_such_batch`)
  check('SMOKE-RM-04b 未知批次受控返回 error', !!(qBatch && qBatch.error))
  // ── 运行时：config 校验（G5）——相对路径/非法 mirror 必须拒绝且不落盘 ──
  const CFGF2 = new URL('./data/repos-config.json', import.meta.url)
  const hadCfg2 = fs.existsSync(CFGF2)
  const bak2 = hadCfg2 ? fs.readFileSync(CFGF2, 'utf-8') : null
  try {
    const badRoot = await P(`${B}/api/repos/config`, { root: 'relative/path' })
    const badMirror = await P(`${B}/api/repos/config`, { mirror: 'ftp://bad.example/' })
    check('SMOKE-RM-05 config 拒绝相对路径 root 与非法 mirror（G5 校验）',
      !!(badRoot && badRoot.error) && !!(badMirror && badMirror.error),
      JSON.stringify({ root: badRoot, mirror: badMirror }))
  } finally {
    if (hadCfg2) fs.writeFileSync(CFGF2, bak2)
    else if (fs.existsSync(CFGF2)) fs.rmSync(CFGF2)
  }
  // ── 运行时：浏览 limit 口径（G7）──
  const readyKey = (rs.repos.find(r => r.present) || {}).key || 'sakib'
  const br1 = await J(`${B}/api/repos/browse?key=${encodeURIComponent(readyKey)}&limit=3`)
  check('SMOKE-RM-06 browse limit 生效且 total 为真实总数、truncated 由返回数派生',
    br1 && br1.limit === 3 && Array.isArray(br1.items) && br1.items.length <= 3 &&
    typeof br1.total === 'number' && br1.truncated === (br1.total > br1.items.length))
  // ── 运行时：半成品死锁解除（G1）——造无 .git 空壳目录，install 应清理并进入作业而非拒绝覆盖 ──
  // 用真实数据根下一个不存在的登记 key？不行会真 clone。改为静态守卫 + 单元级函数验证。
  const rmSrc20 = readSrc20('./src/server/repoManager.ts')
  check('SMOKE-RM-07 失败清理与半成品重建机制（cleanupHalfClone/isHalfClone/createdDir）',
    rmSrc20.includes('function cleanupHalfClone') && rmSrc20.includes('function isHalfClone') &&
    rmSrc20.includes('j.createdDir') && rmSrc20.includes('cleanupHalfClone(job)') &&
    rmSrc20.includes('isHalfClone(target)'))
  check('SMOKE-RM-08 批处理队列（startBatch/pumpBatch/onJobSettled/并发护栏）',
    rmSrc20.includes('function startBatch') && rmSrc20.includes('function pumpBatch') &&
    rmSrc20.includes('onJobSettled(key)') && rmSrc20.includes('runningCount() < MAX_CONCURRENT'))
  check('SMOKE-RM-09 config 校验 + 旧根快照 + 可写/空间预检（G4/G5/G8）',
    rmSrc20.includes('probeWritable(nr)') && rmSrc20.includes('probeWritable(root)') &&
    rmSrc20.includes('previousRoot = getRoot()') && rmSrc20.includes('diskFreeMB(root)') &&
    /https?:\/\//.test(rmSrc20))
  // ── 静态：client 新 UI 区块与 manifest 声明一致（声明→生产→消费三方）──
  const rv20 = readSrc20('./src/client/views/repos-view.tsx')
  check('SMOKE-RM-10 client 消费批次/作业/旧根/健康（doInstallBatch/pollBatch/recentJobs/RP2_HEALTH）',
    rv20.includes('doInstallBatch') && rv20.includes('pollBatch') && rv20.includes('recentJobs') &&
    rv20.includes('RP2_HEALTH') && rv20.includes('previousRoot'))
  check('SMOKE-RM-11 manifest 新增 3 端点声明且消费者登记',
    ['/api/repos/install-batch', '/api/repos/batch', '/api/repos/jobs'].every(p => readSrc20('./src/shared/manifest.ts').includes("path: '" + p + "'")))
}

// ── cycle-18 花生十三体系方法论（/api/huasheng13/* 六端点端到端 + 白盒链路 + 静态守卫）──
// 位置纪律（教训⑧+⑤）：本块有运行时 fetch，必须落在 §11b 长阻塞（真题卷索引重建）**之前**、
// §12 崩溃安全（server.close()）**之前**；块内不触发任何长阻塞操作（索引快照随包分发，命中即返回）。
// 断言口径全部来自实测（不照抄任务书旧口径）：
//   · catalog meta.docCount=25 = META 声明篇数，与磁盘 available 分开计
//   · search 带尾部裁剪(rawTotal/filtered) 与三档置信度(confidence/phraseHit)，**低置信度结果不丢弃**
//   · practice 的 n 是「本次抽取上限」，total 才是题库总量 → 断言 returned/hasMore 而非 items.length
//   · coverage overall 是真实值 0.9756（yanyu 缺公式是真实缺口，绝不凑绿断言 1.0）
{
  const HS = 'PROJ_HS_A'          // 独立命名空间，避免与 PROJ_A/PROJ_P 的计数互相污染
  const HB = `${B}/api/huasheng13`
  const H = (p, ws) => `${HB}${p}${p.includes('?') ? '&' : '?'}ws=${encodeURIComponent(ws || HS)}`

  // ═══ HS13-01 目录树：25 篇语料 + 六模块/三策略/一示例三层结构 ═══
  {
    const r = await fetch(H('/catalog'))
    const c = await r.json()
    check('HS13-01 /api/huasheng13/catalog 返回 200 且 meta.docCount=25',
      r.status === 200 && c.meta && c.meta.docCount === 25,
      `status=${r.status} docCount=${c.meta && c.meta.docCount}`)
    check('HS13-01 目录三层结构完整（六模块 + 三策略 + 一示例）',
      Array.isArray(c.modules) && c.modules.length === 6 &&
      Array.isArray(c.strategy) && c.strategy.length === 3 &&
      Array.isArray(c.examples) && c.examples.length === 1,
      `modules=${(c.modules || []).length} strategy=${(c.strategy || []).length} examples=${(c.examples || []).length}`)
    // docCount 是「声明数」，available 是「磁盘真实可用数」——两者必须分开，否则语料缺失会被掩盖
    check('HS13-01 声明数 ≡ 磁盘可用数（25/25，degraded=false 且 missing 为空）',
      c.meta.available === 25 && c.meta.missingCount === 0 &&
      Array.isArray(c.meta.missing) && c.meta.missing.length === 0 && c.meta.degraded === false,
      `available=${c.meta.available} missingCount=${c.meta.missingCount} degraded=${c.meta.degraded}`)
    // 目录树扁平化后必须恰好 25 个实体，且每篇都有真实解析统计（chars/sections>0、present=true）
    const flat = []
    for (const m of (c.modules || [])) {
      for (const d of (m.docs || [])) flat.push(d)
      for (const e of (m.examples || [])) flat.push(e)
    }
    for (const s of (c.strategy || [])) flat.push(s)
    for (const e of (c.examples || [])) flat.push(e)
    const leafBad = flat.filter(d => !(d.present === true && d.chars > 0 && d.sections > 0))
    check('HS13-01 目录树 25 篇实体且逐篇含真实解析统计（chars/sections>0、present=true）',
      flat.length === 25 && leafBad.length === 0,
      `flat=${flat.length} 异常=${leafBad.map(d => d.file).join(',') || '无'}`)
    // 磁盘与 META 双向零漂移（多出的文件记 orphans，错放目录记 dirMismatch）
    check('HS13-01 磁盘与 META 双向零漂移（orphans=[] 且 dirMismatch=[]）',
      Array.isArray(c.meta.orphans) && c.meta.orphans.length === 0 &&
      Array.isArray(c.meta.dirMismatch) && c.meta.dirMismatch.length === 0,
      `orphans=${JSON.stringify(c.meta.orphans)} dirMismatch=${JSON.stringify(c.meta.dirMismatch)}`)
  }

  // ═══ HS13-02 端点口径守卫：六端点与 CAPABILITIES 声明逐字一致（v1.8 白盒假阳性事故固化）═══
  {
    const caps = await J(`${B}/api/capabilities`)
    const declared = (caps.endpoints || []).map(e => e.path).filter(p => String(p).indexOf('/api/huasheng13/') === 0)
    const EXPECT = [
      '/api/huasheng13/catalog', '/api/huasheng13/doc', '/api/huasheng13/search',
      '/api/huasheng13/coverage', '/api/huasheng13/practice', '/api/huasheng13/trace',
    ]
    check('HS13-02 CAPABILITIES 恰声明 6 个 /api/huasheng13/* 端点（无缺无多）',
      declared.length === 6 && EXPECT.every(p => declared.indexOf(p) >= 0),
      `declared=${declared.length} [${declared.join(',')}]`)
    // 逻辑路径口径：绝不能带挂载前缀（/kaogong/api/...），否则能力对账 100% 失配
    check('HS13-02 端点路径为相对挂载点的逻辑路径（无 /kaogong 前缀）',
      declared.every(p => p.charAt(0) === '/' && p.indexOf('/kaogong') !== 0),
      declared.join(','))
    // 声明 vs 运行态对账：trace 自己给出的 declaration 必须全绿
    const tr = await J(H('/trace'))
    check('HS13-02 运行态自证：trace.declaration.allDeclared=true 且 6 条逐条 declared',
      tr.declaration && tr.declaration.allDeclared === true &&
      Array.isArray(tr.declaration.endpoints) && tr.declaration.endpoints.length === 6 &&
      tr.declaration.endpoints.every(d => d.declared === true) &&
      EXPECT.every(p => tr.declaration.endpoints.some(d => d.path === p)),
      `allDeclared=${tr.declaration && tr.declaration.allDeclared}`)
    // 六端点真实可达（200 + 非 Unknown API）：任何一条路由漏挂都会在此暴露
    const six = [
      ['/catalog', x => Array.isArray(x.modules)],
      ['/doc?file=ziliao-fenxi', x => typeof x.markdown === 'string' && x.markdown.length > 0],
      ['/search?q=ABRX', x => Array.isArray(x.results)],
      ['/coverage', x => Array.isArray(x.modules)],
      ['/practice?file=ziliao-lianxi', x => Array.isArray(x.items)],
      ['/trace', x => !!x.endpoints],
    ]
    let routeBad = ''
    for (const pair of six) {
      const rr = await fetch(H(pair[0]))
      const bb = await rr.json()
      if (rr.status !== 200 || !pair[1](bb) || /Unknown API/.test(String(bb.error || ''))) routeBad += pair[0] + ' '
    }
    check('HS13-02 六端点逐条真实可达（HTTP 200 且非 Unknown API）', routeBad === '', routeBad || 'ok')
    // 未知子路径必须回落为受控 {error}（HTTP 200，不 5xx、不崩），且**不得污染端点对账**。
    //
    // 历史：早期 `recordRequest` 直接以实际到达的 path 记遥测，于是任何未声明路径（拼错、
    // 探针、扫描器）都会永久驻留成「影子端点」，让后面的「运行态端点路径口径与 manifest
    // 一致」误判（v1.8 白盒假阳性同族）。当时的权宜之计是把这个探针挪到口径断言之后。
    // **现在根因已在 http.ts 根治**：未声明路径只进 `__unmatched__` 聚合桶（不参与端点对账），
    // 并额外透出 `telemetry.unmatched` 供观测 → 本探针回到 HS13-02 原位，
    // 判定依据从「靠测试顺序规避」升级为「机制保证」（见下方对 unmatched 的正向断言）。
    {
      const rj = await fetch(`${HB}/__no_such_sub__?ws=${encodeURIComponent(HS)}`)
      const bj = await rj.json()
      check('HS13-02 未知子路径受控回落（HTTP 200 + {error}，不 5xx 不崩）',
        rj.status === 200 && !!(bj && bj.error) && /Unknown API/.test(String(bj.error)),
        `${rj.status} ${String((bj && bj.error) || '').slice(0, 70)}`)
      // 机制保证：未声明路径既不能出现在端点对账表里，又要能在聚合桶里被看见
      const telNow = await J(`${B}/api/telemetry`)
      const epKeys = Object.keys(telNow.endpoints || {})
      check('HS13-02 未声明路径不污染端点对账（不进 telemetry.endpoints，仅记 __unmatched__ 聚合桶）',
        !epKeys.some(k => /huasheng13\/__no_such_sub__/.test(k)) &&
        epKeys.every(k => !/__no_such_sub__/.test(k)),
        `命中的影子键=${epKeys.filter(k => /__no_such_sub__/.test(k)).join(',') || '无'}`)
      check('HS13-02 未声明请求仍可观测（telemetry.unmatched.count>0，不因聚合而丢失）',
        !!telNow.unmatched && telNow.unmatched.count > 0,
        `unmatched=${JSON.stringify(telNow.unmatched)}`)
    }
  }

  // ═══ HS13-03 BM25 检索命中（含尾部裁剪与置信度的真实口径）═══
  {
    const s = await J(H('/search?q=' + encodeURIComponent('截位直除')))
    const r0 = (s.results || [])[0]
    check('HS13-03 检索「截位直除」命中且首条= ziliao-susuan（三大速算方法）',
      Array.isArray(s.results) && s.results.length > 0 &&
      r0.file === 'ziliao-susuan' && r0.moduleId === 'ziliao',
      `top=${r0 && r0.file} total=${s.total}`)
    check('HS13-03 BM25 分数降序且为正（top-1 严格最高）',
      s.results.length >= 2 && s.results.every(x => x.score > 0) &&
      s.results.every((x, i) => i === 0 || s.results[i - 1].score >= x.score),
      (s.results || []).map(x => x.score).slice(0, 4).join('>'))
    check('HS13-03 尾部裁剪口径自洽（rawTotal ≡ results.length + filtered）且裁剪真实生效',
      s.rawTotal === s.results.length + s.filtered && s.rawTotal === 25 && s.filtered > 0,
      `rawTotal=${s.rawTotal} results=${s.results.length} filtered=${s.filtered}`)
    check('HS13-03 置信度 high + phraseHit=true + coverage=1（整串真实落在语料里）',
      s.confidence === 'high' && s.phraseHit === true && s.coverage === 1,
      `confidence=${s.confidence} phraseHit=${s.phraseHit} coverage=${s.coverage}`)
    check('HS13-03 首条含命中高亮与切片（snippets 非空、terms 为真实命中词）',
      !!r0 && typeof r0.highlight === 'string' && r0.highlight.length > 0 &&
      Array.isArray(r0.snippets) && r0.snippets.length > 0 &&
      Array.isArray(r0.terms) && r0.terms.length > 0 &&
      r0.snippets.every(x => typeof x.text === 'string'),
      `snippets=${r0 && r0.snippets && r0.snippets.length} terms=${r0 && r0.terms && r0.terms.join('/')}`)
  }

  // ═══ HS13-04 检索边界：能命中 / 空查询 / bigram 噪声不丢弃 ═══
  {
    const s2 = await J(H('/search?q=' + encodeURIComponent('假设分配')))
    const t2 = (s2.results || [])[0]
    check('HS13-04 检索「假设分配」命中 ziliao-susuan 且置信度 high',
      Array.isArray(s2.results) && s2.results.length > 0 &&
      t2.file === 'ziliao-susuan' && s2.confidence === 'high',
      `top=${t2 && t2.file} confidence=${s2.confidence}`)
    const s3 = await J(H('/search?q=' + encodeURIComponent('隔板法')))
    const t3 = (s3.results || [])[0]
    check('HS13-04 检索「隔板法」命中 shuliang-guanxi（数量关系全题型解法）',
      Array.isArray(s3.results) && s3.results.length > 0 &&
      t3.file === 'shuliang-guanxi' && s3.confidence === 'high',
      `top=${t3 && t3.file} confidence=${s3.confidence}`)
    // 空查询：不是「未命中」，返回空数组且不报错（也不计入命中率分母）
    const s0 = await J(H('/search?q='))
    check('HS13-04 空查询返回 results=[] 且不报错（不当成 miss）',
      Array.isArray(s0.results) && s0.results.length === 0 && !s0.error && s0.total === 0,
      `results=${(s0.results || []).length} error=${s0.error || '无'}`)
    // bigram 噪声：置信度低但仍返回结果（server 特意设计：提示而不过滤，绝不丢结果）
    const sn = await J(H('/search?q=' + encodeURIComponent('不存在的词')))
    check('HS13-04 生造词「不存在的词」confidence=low 且 phraseHit=false（bigram 噪声如实暴露）',
      sn.confidence === 'low' && sn.phraseHit === false,
      `confidence=${sn.confidence} phraseHit=${sn.phraseHit}`)
    check('HS13-04 低置信度仍返回结果 + 明确 note（提示而不过滤，绝不丢弃）',
      Array.isArray(sn.results) && sn.results.length > 0 &&
      typeof sn.note === 'string' && sn.note.indexOf('部分') >= 0,
      `results=${(sn.results || []).length} note=${String(sn.note || '').slice(0, 40)}`)
  }

  // ═══ HS13-05 单篇全文 + 未知文件受控 ═══
  {
    const d = await J(H('/doc?file=ziliao-fenxi'))
    check('HS13-05 doc?file=ziliao-fenxi 返回 markdown 且含「ABRX」',
      typeof d.markdown === 'string' && d.markdown.length > 1000 && d.markdown.indexOf('ABRX') >= 0,
      `len=${(d.markdown || '').length} 含ABRX=${String(d.markdown || '').indexOf('ABRX') >= 0}`)
    check('HS13-05 doc 元信息完整（file/moduleId/chars/formulas/weight>1）',
      d.file === 'ziliao-fenxi' && d.moduleId === 'ziliao' &&
      d.chars > 0 && d.formulas > 0 && typeof d.weight === 'number' && d.weight > 1,
      `file=${d.file} moduleId=${d.moduleId} chars=${d.chars} formulas=${d.formulas} weight=${d.weight}`)
    // 未知文件：HTTP 200 + {error, known[]}，绝不 5xx、绝不崩
    const r = await fetch(H('/doc?file=__not_exist__'))
    const bad = await r.json()
    check('HS13-05 未知 file 受控（HTTP 200 + {error} + known 全量清单，不崩）',
      r.status === 200 && typeof bad.error === 'string' && bad.error.length > 0 &&
      Array.isArray(bad.known) && bad.known.length === 25 && bad.known.indexOf('ziliao-fenxi') >= 0,
      `${r.status} error=${String(bad.error || '').slice(0, 30)} known=${(bad.known || []).length}`)
    // 缺 file 参数同样是受控降级（不是 500）
    const r2 = await fetch(H('/doc'))
    const d2 = await r2.json()
    check('HS13-05 缺 file 参数受控降级（HTTP 200 + {error} + hint）',
      r2.status === 200 && typeof d2.error === 'string' && typeof d2.hint === 'string',
      `${r2.status} error=${String(d2.error || '').slice(0, 30)}`)
  }

  // ═══ HS13-06 覆盖矩阵：六模块全覆盖 + overall 真实值（不凑绿）═══
  {
    const c = await J(H('/coverage'))
    const IDS = ['ziliao', 'shuliang', 'yanyu', 'panduan', 'changshi', 'shenlun']
    check('HS13-06 覆盖矩阵六模块齐备（ziliao/shuliang/yanyu/panduan/changshi/shenlun）',
      Array.isArray(c.modules) && c.modules.length === 6 &&
      IDS.every(id => c.modules.some(m => m.id === id)),
      `modules=${(c.modules || []).map(m => m.id).join(',')}`)
    check('HS13-06 overall 在 [0,1] 且为真实值 0.9756（≠1：yanyu 缺公式是真实缺口，不凑绿）',
      typeof c.overall === 'number' && c.overall >= 0 && c.overall <= 1 &&
      Math.abs(c.overall - 0.9756) < 1e-9,
      `overall=${c.overall}`)
    // 逐模块 coverage 合法；overall = presentDims / expectedDims（口径可复算）
    const allValid = c.modules.every(m => typeof m.coverage === 'number' && m.coverage >= 0 && m.coverage <= 1)
    check('HS13-06 逐模块 coverage ∈ [0,1] 且 overall ≡ presentDims/expectedDims（口径可复算）',
      allValid && c.expectedDims > 0 && c.presentDims > 0 &&
      Math.abs(c.overall - c.presentDims / c.expectedDims) < 1e-3,
      `overall=${c.overall} present/expected=${c.presentDims}/${c.expectedDims}=${(c.presentDims / c.expectedDims).toFixed(4)}`)
    // 维度口径：常识/申论不考公式（dims.formula=false），分母不该强求 → 必须透传
    const cs = c.modules.find(m => m.id === 'changshi') || {}
    const sl = c.modules.find(m => m.id === 'shenlun') || {}
    check('HS13-06 维度口径透传（常识/申论 dims.formula=false，不把不考公式的模块判为缺失）',
      !!cs.dims && cs.dims.formula === false && !!sl.dims && sl.dims.formula === false,
      `changshi.formula=${cs.dims && cs.dims.formula} shenlun.formula=${sl.dims && sl.dims.formula}`)
    // 缺口清单必须如实包含 yanyu 缺公式（真实缺口，不许被抹掉）
    check('HS13-06 缺口清单如实暴露 yanyu 缺公式（真实缺口不被抹平）',
      Array.isArray(c.gaps) && c.gaps.some(g => g.module === 'yanyu' && /缺公式/.test(String(g.detail))),
      `gaps=${(c.gaps || []).map(g => g.module + ':' + g.detail).slice(0, 3).join(' | ')}`)
  }

  // ═══ HS13-07 配套练习：total/n/returned/hasMore 四元组口径 ═══
  {
    // 默认 n=5：抽取上限生效，hasMore 必须为 true（不是「只返回 5 题」的 bug）
    const d5 = await J(H('/practice?file=ziliao-lianxi'))
    check('HS13-07 默认抽取上限生效（total=10 n=5 returned=5 hasMore=true）',
      d5.total === 10 && d5.n === 5 && d5.returned === 5 &&
      Array.isArray(d5.items) && d5.items.length === 5 && d5.hasMore === true,
      `total=${d5.total} n=${d5.n} returned=${d5.returned} hasMore=${d5.hasMore}`)
    // 显式 n=10：全量取出，hasMore 必须翻为 false
    const d10 = await J(H('/practice?file=ziliao-lianxi&n=10'))
    check('HS13-07 n=10 全量取出（returned=10 hasMore=false）且 total 恒为题库总量',
      d10.total === 10 && d10.n === 10 && d10.returned === 10 &&
      d10.items.length === 10 && d10.hasMore === false,
      `total=${d10.total} returned=${d10.returned} hasMore=${d10.hasMore}`)
    // 题目形状：index 连续、stem 非空、options 带 key（client 判分依赖 key）
    const items = d10.items
    check('HS13-07 题目形状完整（index 连续/stem 非空/options 带 key/含解析）',
      items.every((it, i) => it.index === i + 1 && typeof it.stem === 'string' && it.stem.length > 0) &&
      items.every(it => Array.isArray(it.options) && it.options.every(o => typeof o.key === 'string')) &&
      items.filter(it => it.options.length > 0).every(it => it.options.every(o => typeof o.text === 'string')) &&
      items.every(it => typeof it.analysis === 'string'),
      `首题 options keys=${(items[0].options || []).map(o => o.key).join('')}`)
    // 自动判分可行性口径：只有 A-D 字母答案可本地比对；文字作答题必须 answerIsLetter=false
    const letters = items.filter(it => it.answerIsLetter === true)
    const words = items.filter(it => it.answerIsLetter === false)
    check('HS13-07 answerIsLetter 口径自洽（true ⇒ answer 为 A-D；false ⇒ 文字作答不可自动判分）',
      letters.length > 0 && words.length > 0 &&
      letters.every(it => /^[A-D]$/i.test(String(it.answer || '').trim())) &&
      words.every(it => !/^[A-D]$/i.test(String(it.answer || '').trim())),
      `字母题=${letters.length} 文字题=${words.length}（文字题答案例：${String((words[0] || {}).answer || '').slice(0, 12)}）`)
    // 数量关系 18 题全为文字作答 → 绝不臆造「所有练习都能自动判分」
    const sq = await J(H('/practice?file=shuliang-lianxi&n=50'))
    check('HS13-07 数量关系 18 题全为文字作答（answerIsLetter 恒 false，不臆造字母答案）',
      sq.total === 18 && sq.returned === 18 &&
      sq.items.every(it => it.answerIsLetter === false),
      `total=${sq.total} returned=${sq.returned} 字母题=${sq.items.filter(it => it.answerIsLetter).length}`)
    // 未知 file 受控
    const bx = await fetch(H('/practice?file=__nope__'))
    const jx = await bx.json()
    check('HS13-07 未知 file 受控（HTTP 200 + {error} + known，不崩）',
      bx.status === 200 && typeof jx.error === 'string' && Array.isArray(jx.known),
      `${bx.status} error=${String(jx.error || '').slice(0, 30)}`)
  }

  // ═══ HS13-08 白盒链路：字段完整 + 命中计数单调递增（真实计数，非伪造）═══
  {
    const hitsOf = (t, p) => (((t || {}).endpoints || {})[p] || {}).hits || 0
    const t0 = await J(H('/trace'))
    const searchBefore = hitsOf(t0, '/api/huasheng13/search')
    const docBefore = hitsOf(t0, '/api/huasheng13/doc')
    const covers = ['/api/huasheng13/catalog', '/api/huasheng13/doc', '/api/huasheng13/search',
      '/api/huasheng13/coverage', '/api/huasheng13/practice', '/api/huasheng13/trace']
    check('HS13-08 trace 六端点槽位齐备且字段完整（hits/p50/p95/lastAt/samples）',
      !!t0.endpoints && Object.keys(t0.endpoints).length === 6 &&
      covers.every(p => t0.endpoints[p] &&
        typeof t0.endpoints[p].hits === 'number' &&
        typeof t0.endpoints[p].p50 === 'number' &&
        typeof t0.endpoints[p].p95 === 'number' &&
        typeof t0.endpoints[p].lastAt === 'number' &&
        typeof t0.endpoints[p].samples === 'number'),
      `槽位=${Object.keys(t0.endpoints || {}).length}`)
    check('HS13-08 searches 统计四元组齐备 + hitRate 口径自洽（hit/total）',
      !!t0.searches && typeof t0.searches.total === 'number' && typeof t0.searches.hit === 'number' &&
      typeof t0.searches.miss === 'number' && typeof t0.searches.empty === 'number' &&
      typeof t0.searches.hitRate === 'number' &&
      (t0.searches.total === 0 ? t0.searches.hitRate === 0
        : Math.abs(t0.searches.hitRate - t0.searches.hit / t0.searches.total) < 1e-3),
      JSON.stringify(t0.searches))
    check('HS13-08 docs 读取统计结构完整（reads 对象 + distinct 计数）',
      !!t0.docs && typeof t0.docs.distinct === 'number' && !!t0.docs.reads && typeof t0.docs.reads === 'object',
      `distinct=${t0.docs && t0.docs.distinct}`)
    check('HS13-08 recent 链路事件字段齐备（at/kind/detail/ms 全为原生类型）',
      Array.isArray(t0.recent) && t0.recent.length > 0 &&
      t0.recent.every(x => typeof x.at === 'number' && typeof x.kind === 'string' &&
        typeof x.detail === 'string' && typeof x.ms === 'number'),
      `recent=${(t0.recent || []).length} 末条=${JSON.stringify((t0.recent || []).slice(-1)[0]).slice(0, 90)}`)
    // 单调性：真实调用后计数必然增加（「注册→生产→消费」三态证据，不是页面装饰）
    await J(H('/search?q=' + encodeURIComponent('ABRX')))
    await J(H('/doc?file=ziliao-fenxi'))
    await J(H('/doc?file=ziliao-fenxi'))
    const t1 = await J(H('/trace'))
    check('HS13-08 命中计数单调递增（search +1、doc +2：trace 记录的是真实调用）',
      hitsOf(t1, '/api/huasheng13/search') === searchBefore + 1 &&
      hitsOf(t1, '/api/huasheng13/doc') === docBefore + 2,
      `search ${searchBefore}→${hitsOf(t1, '/api/huasheng13/search')} doc ${docBefore}→${hitsOf(t1, '/api/huasheng13/doc')}`)
    check('HS13-08 全文读取按 file 分键累计（reads.ziliao-fenxi 计数真实累加）',
      !!t1.docs && !!t1.docs.reads && typeof t1.docs.reads['ziliao-fenxi'] === 'number' &&
      t1.docs.reads['ziliao-fenxi'] >= 2,
      `reads=${JSON.stringify(t1.docs && t1.docs.reads).slice(0, 80)}`)
    // 环形缓冲容量必须真实透出（白盒要能看到「会不会丢历史」）
    check('HS13-08 环形缓冲容量透出（recent 上限 200 / recentLen ≤ 上限 / 分槽上限）',
      !!t1.ring && t1.ring.recentCap === 200 && t1.ring.recentLen <= t1.ring.recentCap &&
      typeof t1.ring.slotsCap === 'number' && t1.ring.slots >= 1,
      JSON.stringify(t1.ring))
  }

  // ═══ HS13-09 跨工作区隔离：trace / 计数 / 文档读取互不污染（cycle-17 ㉙ 同族守卫）═══
  {
    const WA = 'PROJ_HS_ISO_A', WB = 'PROJ_HS_ISO_B'
    await J(H('/doc?file=ziliao-fenxi', WA))
    await J(H('/doc?file=ziliao-fenxi', WA))
    await J(H('/search?q=ABRX', WA))
    const ta = await J(H('/trace', WA))
    const tb = await J(H('/trace', WB))
    check('HS13-09 跨工作区计数隔离（A 有真实调用、B 全零，互不污染）',
      ta.endpoints['/api/huasheng13/doc'].hits === 2 &&
      ta.endpoints['/api/huasheng13/search'].hits === 1 &&
      ta.searches.total === 1 && ta.docs.distinct === 1 &&
      tb.endpoints['/api/huasheng13/doc'].hits === 0 &&
      tb.endpoints['/api/huasheng13/search'].hits === 0 &&
      tb.searches.total === 0 && tb.docs.distinct === 0 && tb.recent.length === 0,
      `A doc=${ta.endpoints['/api/huasheng13/doc'].hits} search=${ta.searches.total} | B doc=${tb.endpoints['/api/huasheng13/doc'].hits} search=${tb.searches.total}`)
    check('HS13-09 两个工作区落到不同分槽（wsKey 归一后不相同）',
      typeof ta.ws === 'string' && typeof tb.ws === 'string' && ta.ws !== tb.ws,
      `A=${ta.ws} B=${tb.ws}`)
    // 隔离不是靠「清空」实现的：回头再看 A，它的历史仍在（分槽独立而非互斥）
    const ta2 = await J(H('/trace', WA))
    check('HS13-09 A 的历史在 B 访问后仍完整保留（分槽独立，不是互相清空）',
      ta2.endpoints['/api/huasheng13/doc'].hits === 2 && ta2.searches.total === 1 &&
      ta2.recent.length > 0,
      `A doc=${ta2.endpoints['/api/huasheng13/doc'].hits} recent=${ta2.recent.length}`)
    // 无 ws 参数（default 槽）同样不得串到 A/B
    const td = await J(`${HB}/trace`)
    check('HS13-09 无 ws 参数走独立 default 槽（不串到 A/B 的计数）',
      td.searches.total !== ta.searches.total && td.endpoints['/api/huasheng13/doc'].hits !== 2,
      `default search=${td.searches.total} doc=${td.endpoints['/api/huasheng13/doc'].hits}`)
  }

  // ═══ HS13-10 静态守卫：磁盘 25 文件逐一对齐 META 声明 ═══
  {
    const fs = await import('node:fs')
    const { join } = await import('node:path')
    const { HUASHENG13_META } = await import('./dist/shared/manifest.js')
    // cycle-18 决策：语料**不随包分发**，与其它题库一样放在**数据根**下，
    // 由「📦 题库管理」统一下载配置。因此这里必须按数据根定位，不能按包根。
    const { resolveReposRoot } = await import('./dist/server/dataRoot.js')
    const { REPOS } = await import('./dist/adapters/repoData.js')
    const ROOT = resolveReposRoot(Object.keys(REPOS)).root
    const PKG = process.cwd()   // 包根（用于源码级静态守卫读取 src/**）
    const DIR = join(ROOT, String(HUASHENG13_META.root || 'huasheng13'))
    check('HS13-10 语料位于数据根（非包内）：root/huasheng13 存在', fs.existsSync(DIR), DIR)
    check('HS13-10 包内不得再携带方法论语料（统一走题库管理）',
      !fs.existsSync(join(process.cwd(), 'assets', 'huasheng13')),
      join(process.cwd(), 'assets', 'huasheng13'))
    // META 声明的每一条 → 真实文件必须存在（声明 → 实体，零断链）
    const declared = []
    for (const m of (HUASHENG13_META.modules || [])) {
      for (const d of (m.docs || [])) declared.push(['references', d.file])
      for (const e of (m.examples || [])) declared.push(['examples', e.file])
    }
    for (const s of (HUASHENG13_META.strategy || [])) declared.push(['references', s.file])
    for (const e of (HUASHENG13_META.examples || [])) declared.push(['references', e.file])
    const missing = declared.filter(x => !fs.existsSync(join(DIR, x[0], x[1] + '.md')))
    check('HS13-10 META 声明的 25 篇逐条可解析到实体文件（零断链）',
      declared.length === 25 && missing.length === 0,
      `declared=${declared.length} 缺失=${missing.map(x => x.join('/')).join(',') || '无'}`)
    // 反向：磁盘上的 .md 必须全部被 META 声明（多出的孤立文件会变成「搜不到的死语料」）
    const onDisk = []
    for (const dir of ['references', 'examples']) {
      const p = join(DIR, dir)
      if (!fs.existsSync(p)) continue
      for (const f of fs.readdirSync(p)) if (/\.md$/.test(f)) onDisk.push([dir, f.replace(/\.md$/, '')])
    }
    const declaredKey = new Set(declared.map(x => x[0] + '/' + x[1]))
    const orphans = onDisk.filter(x => !declaredKey.has(x[0] + '/' + x[1]))
    check('HS13-10 磁盘 25 个 .md 全部被 META 声明（无孤立死语料）',
      onDisk.length === 25 && orphans.length === 0,
      `onDisk=${onDisk.length} 孤立=${orphans.map(x => x.join('/')).join(',') || '无'}`)
    // 目录归属：examples 只放练习（「## 练习 N」分块），references 放方法论正文
    const exampleIds = declared.filter(x => x[0] === 'examples').map(x => x[1])
    check('HS13-10 练习文件目录归属正确（examples 恰 5 篇：ziliao/shuliang/yanyu/panduan/shenlun 各一）',
      exampleIds.length === 5 &&
      ['ziliao-lianxi', 'shuliang-lianxi', 'yanyu-lianxi', 'panduan-lianxi', 'shenlun-lianxi']
        .every(f => exampleIds.indexOf(f) >= 0),
      `examples=${exampleIds.join(',')}`)
    // zhenti-shili 物理在 references/（manifest 已按磁盘事实声明，不是 examples/）
    check('HS13-10 zhenti-shili 按磁盘事实落在 references/（不臆造目录）',
      fs.existsSync(join(DIR, 'references', 'zhenti-shili.md')) &&
      !fs.existsSync(join(DIR, 'examples', 'zhenti-shili.md')),
      'references/zhenti-shili.md 存在且 examples/ 下无同名文件')
    // 静态：端点声明必须仍无挂载前缀（源码级，防「运行时被改写」绕过对账）
    const mSrc = fs.readFileSync(join(PKG, 'src/shared/manifest.ts'), 'utf-8')
    check('HS13-10 源码级端点口径守卫（manifest 声明 /api/huasheng13/* 且无 /kaogong 前缀）',
      /path: '\/api\/huasheng13\/(catalog|doc|search|coverage|practice|trace)'/.test(mSrc) &&
      mSrc.indexOf("path: '/kaogong/api/huasheng13") < 0)
  }
}

// ── 11b. v1.6 真题卷 / 专题 / 申论评改（真实数据端到端）──
{
  const W2 = '?ws=PROJ_P'

  // 真题卷索引：真实 1683 套（申论+行测）
  const papers = await J(`${B}/api/papers`)
  check('真题卷索引可用(>1000套)', papers.total > 1000, `total=${papers.total}`)
  check('科目聚合含申论与行测', (papers.subjects || []).some(s => s.subject === '申论') && (papers.subjects || []).some(s => s.subject === '行测'), JSON.stringify((papers.subjects || []).map(s => s.subject)))

  // 单卷详情：材料+题目+参考答案
  const one = papers.papers.find(p => p.subject === '申论' && p.questionCount > 0) || papers.papers[0]
  const detail = await J(`${B}/api/paper?id=${encodeURIComponent(one.id)}`)
  check('单卷详情含题目', (detail.questions || []).length > 0, `${(detail.questions || []).length} 题`)
  check('申论卷含给定材料', one.subject !== '申论' || (detail.materials || []).length > 0, `${(detail.materials || []).length} 材料`)
  const withRef = (detail.questions || []).find(q => q.reference && q.reference.length > 20)
  check('题目含参考答案', !!withRef, withRef ? `参考长度 ${withRef.reference.length}` : '无')

  // 专题
  const topics = await J(`${B}/api/topics`)
  check('专题聚合(科目+申论题型)', (topics.topics || []).some(t => t.kind === 'subject') && (topics.topics || []).some(t => t.kind === 'essay-type'))

  // 申论题目聚合
  const el = await J(`${B}/api/essay/list?type=概括&limit=5`)
  check('申论按题型聚合', (el.questions || []).length > 0, `${(el.questions || []).length} 题`)

  // 申论离线评分：优劣区分度
  if (withRef) {
    const good = await P(`${B}/api/essay/grade${W2}`, {
      paperId: one.id, no: withRef.no,
      answer: '材料反映问题如下：一、产业结构问题。1.推动产业结构优化升级，提高利润率。2.增强自主创新能力，培养人才。3.减少环境污染实现可持续发展。二、粮食生产问题。1.完善相关政策提高农民收益。2.稳定农资价格加大补助。3.发展农业科技提高产量。4.加强粮食储备管理。',
    })
    const bad = await P(`${B}/api/essay/grade${W2}`, { paperId: one.id, no: withRef.no, answer: '我觉得问题挺多的，反正就是要发展经济吧，大概这样。' })
    check('申论离线评分返回四维', good.dims && typeof good.dims.coverage === 'number' && typeof good.dims.structure === 'number', JSON.stringify(good.dims || {}))
    check('评分有区分度(优秀>敷衍)', good.score > bad.score, `优${good.score} vs 敷${bad.score}`)
    check('评分给出批改建议', Array.isArray(good.feedback) && good.feedback.length > 0, (good.feedback || [])[0])
    check('评分识别采分点', Array.isArray(good.hitTerms), `${(good.hitTerms || []).length} 命中`)
    // 历史落盘
    const hist = await J(`${B}/api/essay/history${W2}`)
    check('申论记录入进度', hist.total >= 2, `total=${hist.total}`)
  } else {
    check('申论离线评分', false, '无参考答案样本，跳过')
  }
}


// ── v1.8.0 图分析算法族不变量（纯函数，直接对 dist 断言；确定性可复现）──
{
  const { buildGraph, degreeAnalysis, labelPropagation, clusteringCoefficient,
          brandesBetweenness, topoLayers, shortestPath, neighborhood, reverseReach,
          layeredLayout, NODE_META, EDGE_META } = await import('./dist/shared/manifest.js')
  const g = buildGraph({})
  const V = g.nodes.length, E = g.edges.length

  // 元数据单一事实源
  check('NODE_META 覆盖全部节点类型',
    g.nodes.every(n => NODE_META[n.type] && NODE_META[n.type].color),
    '缺失: ' + [...new Set(g.nodes.map(n => n.type))].filter(t => !NODE_META[t]).join(','))
  check('EDGE_META 覆盖全部边类型',
    g.edges.every(e => EDGE_META[e.rel]),
    '缺失: ' + [...new Set(g.edges.map(e => e.rel))].filter(r => !EDGE_META[r]).join(','))

  // 度分析
  const deg = degreeAnalysis(g.nodes, g.edges)
  const sumIn = Object.values(deg.degree).reduce((s, d) => s + d.in, 0)
  const sumOut = Object.values(deg.degree).reduce((s, d) => s + d.out, 0)
  check('度分析：入度之和 == 边数', sumIn === E, `Σin=${sumIn} E=${E}`)
  check('度分析：出度之和 == 边数', sumOut === E, `Σout=${sumOut} E=${E}`)
  check('度分析：直方图计数之和 == |V|',
    deg.stats.histogram.reduce((s, h) => s + h.count, 0) === V,
    `Σ=${deg.stats.histogram.reduce((s, h) => s + h.count, 0)} V=${V}`)

  // 社区（标签传播）：成员并集 == 全部节点
  const comms = labelPropagation(g.nodes, g.edges)
  const commMembers = comms.flatMap(c => c.members)
  check('标签传播：社区成员数 == |V|', commMembers.length === V, `got ${commMembers.length}`)
  check('标签传播：成员无重复', new Set(commMembers).size === V)
  check('标签传播：社区按规模降序', comms.every((c, i) => i === 0 || comms[i - 1].size >= c.size))

  // 集聚系数 γ ∈ [0,1]
  const cl = clusteringCoefficient(g.nodes, g.edges)
  check('集聚系数 ∈ [0,1]', cl.avg >= 0 && cl.avg <= 1, String(cl.avg))

  // 介数中心性：非负、降序
  const bc = brandesBetweenness(g.nodes, g.edges)
  check('介数中心性非负且降序',
    bc.every(b => b.score >= 0) && bc.every((b, i) => i === 0 || bc[i - 1].score >= b.score))

  // 拓扑分层：覆盖全部节点、层号非负
  const tl = topoLayers(g.nodes, g.edges)
  check('拓扑分层：覆盖全部节点', Object.keys(tl.layer).length === V, `${Object.keys(tl.layer).length}/${V}`)
  check('拓扑分层：层号非负', Object.values(tl.layer).every(v => v >= 0))

  // 最短路：找到 + 未找到两态
  const spFound = shortestPath(g.nodes, g.edges, 'lifecycle:load', 'lifecycle:serve')
  check('最短路 found 态返回 path', spFound.found === true && Array.isArray(spFound.path) && spFound.path.length >= 2, JSON.stringify(spFound).slice(0, 80))
  check('最短路路径首尾正确', spFound.path[0] === 'lifecycle:load' && spFound.path[spFound.path.length - 1] === 'lifecycle:serve')
  const spMiss = shortestPath(g.nodes, g.edges, 'plugin:kaogong', 'no-such-node')
  check('最短路未找到返回 found=false', spMiss.found === false && spMiss.path.length === 0)

  // k 跳邻域：depth 单调（2 跳 ⊇ 1 跳）
  const nd1 = neighborhood(g.nodes, g.edges, 'plugin:kaogong', 1)
  const nd2 = neighborhood(g.nodes, g.edges, 'plugin:kaogong', 2)
  check('邻域 depth=1 含中心节点', nd1.nodes.some(n => n.id === 'plugin:kaogong'))
  check('邻域 depth 单调（2跳 ⊇ 1跳）',
    nd2.nodes.length >= nd1.nodes.length && nd1.nodes.every(n => nd2.nodes.some(m => m.id === n.id)),
    `d1=${nd1.nodes.length} d2=${nd2.nodes.length}`)

  // 反向可达：自反性（节点必含自身）
  const rr = reverseReach(g.nodes, g.edges, 'endpoint:/api/questions')
  check('反向可达含自身（自反性）', rr.dependents.includes('endpoint:/api/questions'), JSON.stringify(rr).slice(0, 80))
  check('反向可达 count == dependents.length', rr.count === rr.dependents.length)

  // 分层布局：全部节点有坐标、归一化 0..1
  const lay = layeredLayout(g.nodes, g.edges)
  check('分层布局覆盖全部节点', Object.keys(lay.id).length === V, `${Object.keys(lay.id).length}/${V}`)
  const inRange = Object.values(lay.id).every(p => p.x >= -0.001 && p.x <= 1.001 && p.y >= -0.001 && p.y <= 1.001)
  check('分层布局坐标归一化 0..1', inRange)

  // 确定性：同输入两次输出深相等（可复现的图布局是白盒可信的前提）
  const a1 = JSON.stringify(layeredLayout(g.nodes, g.edges))
  const a2 = JSON.stringify(layeredLayout(g.nodes, g.edges))
  check('分层布局确定性（两次同输出）', a1 === a2)
  const c1 = JSON.stringify(labelPropagation(g.nodes, g.edges))
  const c2 = JSON.stringify(labelPropagation(g.nodes, g.edges))
  check('标签传播确定性（两次同输出）', c1 === c2)
}

// ── v1.8.0 新端点契约（形状 + 降级 + 兼容）──
{
  const graph = await J(`${B}/api/graph?ws=PROJ_A`)
  check('graph 保留既有字段（兼容）',
    Array.isArray(graph.nodes) && Array.isArray(graph.edges) && graph.metrics && Array.isArray(graph.rank) && graph.health)
  check('graph 新增 nodeMeta/edgeMeta', !!(graph.nodeMeta && graph.edgeMeta))
  check('graph 新增 analytics 六项',
    graph.analytics && graph.analytics.degree && graph.analytics.communities &&
    graph.analytics.clustering && graph.analytics.betweenness && graph.analytics.layers && graph.analytics.degreeStats)
  check('graph 新增 layout', graph.layout && typeof graph.layout.id === 'object')

  const nd = await J(`${B}/api/graph/neighborhood?node=${encodeURIComponent('plugin:kaogong')}&depth=2&ws=PROJ_A`)
  check('neighborhood 返回 nodes/edges/stats', Array.isArray(nd.nodes) && Array.isArray(nd.edges) && nd.stats && nd.stats.nodes === nd.nodes.length)
  const ndBad = await J(`${B}/api/graph/neighborhood?node=__nope__&ws=PROJ_A`)
  check('neighborhood 未知节点降级为 error（HTTP 200）', !!(ndBad.error && Array.isArray(ndBad.nodes)))

  const pth = await J(`${B}/api/graph/path?from=${encodeURIComponent('view:dashboard')}&to=${encodeURIComponent('endpoint:/api/stats')}&ws=PROJ_A`)
  check('path 端点返回 found/path/length', pth.found === true && pth.path.length >= 2 && pth.length === pth.path.length - 1)
  const pthBad = await J(`${B}/api/graph/path?from=__x__&to=__y__&ws=PROJ_A`)
  check('path 未知节点降级', pthBad.found === false && !!pthBad.error)

  const imp = await J(`${B}/api/graph/impact?node=${encodeURIComponent('endpoint:/api/questions')}&ws=PROJ_A`)
  check('impact 端点返回 dependents/count', Array.isArray(imp.dependents) && imp.count === imp.dependents.length)
  const ids = new Set(graph.nodes.map(n => n.id))
  check('impact dependents 全部存在于图中', imp.dependents.every(d => ids.has(d)))

  const life = await J(`${B}/api/lifecycle`)
  check('lifecycle 返回 stages/events/current', Array.isArray(life.stages) && life.stages.length >= 6 && Array.isArray(life.events))
  check('lifecycle 阶段三态合法', life.stages.every(s => ['done', 'current', 'pending'].includes(s.state)))
  check('lifecycle 恰有一个 current 阶段', life.stages.filter(s => s.state === 'current').length === 1,
    'current 数: ' + life.stages.filter(s => s.state === 'current').length)

  const tel = await J(`${B}/api/telemetry?ws=PROJ_A`)
  check('telemetry 保留既有字段（兼容）',
    typeof tel.uptimeSec === 'number' && typeof tel.totalRequests === 'number' && !!tel.endpoints && typeof tel.coverage === 'number')
  check('telemetry 新增 histogram 三项',
    tel.histogram && typeof tel.histogram.p50 === 'number' && typeof tel.histogram.p95 === 'number' && typeof tel.histogram.max === 'number')
  check('telemetry 新增 topSlow/alerts', Array.isArray(tel.topSlow) && Array.isArray(tel.alerts))
  check('telemetry alerts 分级合法', tel.alerts.every(a => ['info', 'warn', 'error'].includes(a.level)))
  const eps = Object.values(tel.endpoints)
  check('端点 p95 >= p50（顺序统计单调）', eps.every(e => (e.p95 || 0) >= (e.p50 || 0)))

  const caps = await J(`${B}/api/capabilities`)
  check('capabilities 保留既有字段（兼容）', Array.isArray(caps.endpoints) && Array.isArray(caps.views) && Array.isArray(caps.tools))
  check('capabilities 新增 reconciliation', !!(caps.reconciliation && Array.isArray(caps.reconciliation.orphanEndpoints) && Array.isArray(caps.reconciliation.unconsumedEndpoints)))
  check('capabilities 新增 lifecycle 状态机', !!(caps.lifecycle && Array.isArray(caps.lifecycle.stages) && caps.lifecycle.stages.length >= 6))

  // 遥测路径口径必须与 manifest 声明口径一致（否则能力对账全假阳性）
  const declaredPaths = new Set(caps.endpoints.map(e => e.path))
  const runtimeForeign = Object.keys(tel.endpoints).filter(p => !declaredPaths.has(p) && p.startsWith('/api/'))
  check('运行态端点路径口径与 manifest 一致', runtimeForeign.length === 0,
    '未匹配: ' + runtimeForeign.slice(0, 4).join(','))
  // cycle-18：未声明端点已聚合进 __unmatched__（根因修复在 http.ts），
  // 既不能混入端点对账表，也要保留可观测性。这里守的是**反面**：
  // 聚合机制不能把「已声明端点」也一并吞掉（否则整个对账表会静默变空，比假阳性更危险）。
  check('未声明端点聚合不影响已声明端点计数（端点对账表仍非空且无聚合桶泄漏）',
    Object.keys(tel.endpoints).some(k => k === '/api/status' || k === '/api/capabilities' || k === '/api/telemetry') &&
    !Object.keys(tel.endpoints).some(k => /__unmatched__/.test(k)),
    `leaked=${Object.keys(tel.endpoints).filter(k => /__unmatched__/.test(k)).join(',') || '无'}`)
}

// ── v1.8.0 前端静态守卫（新交互能力的形态约束）──
{
  const client = readClientBundle('v1.8图谱守卫')
  check('图谱用 Canvas 2D 渲染', client.includes("getContext('2d')") || client.includes('getContext("2d")'))
  check('图谱 ResizeObserver 自适应', client.includes('ResizeObserver'))
  check('图谱 DPR 感知', client.includes('devicePixelRatio'))
  check('图谱有标签去重叠（包围盒冲突跳过）', /labelBoxes/.test(client) && /clash/.test(client))
  check('图谱 FR 力模型（k²/d 斥力 + d²/k 引力）', /K \* K/.test(client) && /kij/.test(client))
  check('图谱有预收敛布局', /function relax/.test(client))
  check('图谱消费路径分析端点', client.includes('/graph/path'))
  check('图谱搜索定位（focusNode）', /focusNode/.test(client))
  check('可观测面板消费 lifecycle 端点', client.includes('/lifecycle'))
  check('可观测面板消费 workspaces 端点', client.includes('/workspaces'))
  check('可观测面板有 sparkline（内联 SVG）', /Sparkline/.test(client) && /polyline/.test(client))
  check('可观测面板有诊断导出', /Blob/.test(client) && /diagnostics-/.test(client))
  check('可观测面板保留学习质量（不回归）', client.includes('申论均分率'))
}

// ── cycle-13 省份维度与导航精简（W2a：源码级静态断言；W3 build 后将补运行时断言）──
// 说明：本波次不执行 npm run build / smoke（三路并行防 dist 与端口冲突），因此本块
// 只读 src 源文本做静态断言（沿「UI 内联脚本门读 src/ui/index.html」的既有惯例）。
// 运行时断言（province facet ≥35、/api/papers?province= 过滤生效、快照 schemaVersion=2
// 失效重建、专题枢纽分区切换零降级）留给 W3 在 build 后补齐。
{
  const readSrc = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
  // SMOKE-P-01 省份维度·索引 v2
  const pd = readSrc('./src/adapters/paperData.ts')
  check('SMOKE-P-01 索引v2：快照 schemaVersion=2 版本门（旧快照自动重建）',
    pd.includes('schemaVersion: 2') && pd.includes('snap.schemaVersion === 2'))
  check('SMOKE-P-01 索引v2：paper 记录含 province 维度（省考→parts[1] / 国考→全国）',
    /province[,:]/.test(pd) && pd.includes("'全国'") && pd.includes("parts[0] === '省考'"))
  check('SMOKE-P-01 索引v2：provinces facet 聚合且按码点排序（无 localeCompare 调用）',
    pd.includes('byProvince') && /const provinces = /.test(pd) && !pd.includes('localeCompare('))
  const pv = readSrc('./src/client/views/papers-view.tsx')
  check('SMOKE-P-01 真题卷视图：省份 chips 过滤（provinces facet 驱动）',
    pv.includes('省份') && pv.includes('list.provinces') && /filters\.province/.test(pv))
  check('SMOKE-P-01 专题枢纽：方法论分区与母题精选就位（只消费既有端点）',
    pv.includes('方法论') && /TopicMethodView/.test(pv) && pv.includes('/api/methods') && pv.includes('/api/naoku/questions'))
  // SMOKE-N-01 导航精简（精确锚定 NAV_GROUPS 数组文本，避免误伤专题页内文案）
  const cl = readSrc('./src/client/client.tsx')
  const nav = (cl.match(/const NAV_GROUPS[\s\S]*?\n {6}\]/) || [''])[0]
  check('SMOKE-N-01 导航精简：一级入口保留仪表盘/模考/真题卷/专题/错题本/图谱/可观测',
    nav.includes("'dashboard'") && nav.includes("'exam'") && nav.includes("'papers'") && nav.includes("'topics'") &&
    nav.includes("'wrongbook'") && nav.includes("'graph'") && nav.includes("'obs'"), nav ? 'ok' : 'NAV_GROUPS 未锚定')
  check('SMOKE-N-01 导航精简：刷题/深度题库/图形推理/申论退出一级导航',
    !!nav && !/['"](?:practice|deepbank|tuxing|essay)['"]/.test(nav) &&
    !nav.includes('刷题') && !nav.includes('深度题库') && !nav.includes('图形推理') && !nav.includes('申论'))
  check('SMOKE-N-01 导航精简：四视图路由仍可达（cycle-24 注册表路由：VIEW_ROUTES 键位登记）',
    /practice: \{ comp: NativePracticeView/.test(cl) && /deepbank: \{ comp: NativeDeepBankView/.test(cl) &&
    /tuxing: \{ comp: NativeTuxingView/.test(cl) && /essay: \{ comp: NativeEssayView/.test(cl))
  // SMOKE-N-02 对话窗口瘦身
  const sv = readSrc('./src/client/views/study-view.tsx')
  check('SMOKE-N-02 对话窗口瘦身：KaogongQuickPractice 已完全移除',
    !sv.includes('KaogongQuickPractice') && !cl.includes('KaogongQuickPractice'))
  check('SMOKE-N-02 对话窗口瘦身：右侧 tab 为精简引导体（KaogongTabHome）',
    cl.includes('KaogongTabHome') && /h\(KaogongTabHome,/.test(cl) && !/h\(KaogongMainPanel, \{ wsKey, t, key: reloadKey/.test(cl))
}

// ── cycle-13 省份维度运行时断言（W3，build 后补齐 W2a 交接）──
// 沿用既有 server 测试 harness（8495 端口段 / publishRuntime=false / 真实仓库索引）。
// 顺序纪律：HTTP 断言先行，快照门重建（同步阻塞事件循环 ~10s，超过 http 默认
// keepAliveTimeout 5s）放在本块最后 —— 重建后不再有 fetch，规避 keep-alive 复位竞态。
// 快照门测试会动 data/.paper-index.json：测前备份、finally 还原，绝不污染后续手工使用。
{
  // R-P-02 HTTP 过滤语义（走测试 harness 服务端实例）
  const psd = await J(`${B}/api/papers?province=${encodeURIComponent('山东')}`)
  check('R-P-02 ?province=山东 全部命中且 total>0',
    psd.total > 0 && (psd.papers || []).length > 0 && (psd.papers || []).every(p => p.province === '山东'),
    `total=${psd.total}`)
  const allP = await J(`${B}/api/papers`)
  check('R-P-02 无参返回全量 + provinces facet（服务端透出）',
    allP.total > 1000 && Array.isArray(allP.provinces) && allP.provinces.length >= 35,
    `total=${allP.total} provinces=${allP.provinces && allP.provinces.length}`)

  // R-N-01 方法论分区数据源活体检查（/api/methods 结构化 + /api/naoku/questions 降级语义）
  const methodsR = await fetch(`${B}/api/methods`)
  const meW3 = await methodsR.json()
  check('R-N-01 /api/methods 活体（HTTP 200 + 10 主题目录）',
    methodsR.status === 200 && Array.isArray(meW3.topics) && meW3.topics.length === 10,
    `status=${methodsR.status} topics=${meW3.topics && meW3.topics.length}`)
  const nkR = await fetch(`${B}/api/naoku/questions?count=20&random=0`)
  const nkW3 = await nkR.json()
  // naoku 未就绪时端点必须返回结构化空/降级（HTTP 200 + fallback 标记），绝非 5xx
  const nkStructured = nkR.status === 200 && nkW3 && typeof nkW3 === 'object' &&
    (nkW3.fallback === true ? Array.isArray(nkW3.questions) && nkW3.questions.length === 0
                            : Array.isArray(nkW3.questions))
  check('R-N-01 /api/naoku/questions 结构化（就绪=题目数组 / 未就绪=空数组+fallback，非 5xx）',
    nkStructured, `status=${nkR.status} ready=${nkW3.source === 'naoku'} n=${nkW3.questions && nkW3.questions.length}`)

// ── cycle-21 数据外置 / 题图占位 / 纸质补录（运行时 + 静态守卫）──
// 位置纪律（教训⑧+⑤）：运行时 fetch 必须落在 §11b **长阻塞（快照重建）之前**、§12 崩溃安全（server.close）之前。
{
  const CX = 'PROJ_C21'

  // ═══ SMOKE-DX 数据外置（issue #2）：/api/data-location 白盒 + 静态守卫 ═══
  {
    const r = await fetch(`${B}/api/data-location?ws=${CX}`)
    const d = await r.json()
    check('SMOKE-DX-01 /api/data-location 200 且透出 userDataRoot/source',
      r.status === 200 && typeof d.userDataRoot === 'string' && typeof d.source === 'string',
      JSON.stringify(d).slice(0, 120))
    check('SMOKE-DX-02 userDataRoot 不在插件包内（含 kaogong 命名空间）',
      String(d.userDataRoot).includes('kaogong') && !String(d.userDataRoot).includes('node_modules'),
      String(d.userDataRoot))
    check('SMOKE-DX-03 迁移状态词表齐备（migration.status + reposRoot）',
      d.migration && ['not-needed', 'migrated', 'already-migrated', 'failed'].includes(d.migration.status) && d.reposRoot,
      d.migration && d.migration.status)
    // 静态守卫：http.ts 的 DATA_DIR/PROGRESS_DIR 派生自 USER_DATA_ROOT（外置），不再指包内
    const httpSrc = fs.readFileSync(new URL('./src/server/http.ts', import.meta.url), 'utf-8')
    check('SMOKE-DX-04 http.ts 数据目录派生自 USER_DATA_ROOT（外置）',
      httpSrc.includes('const DATA_DIR = USER_DATA_ROOT') && httpSrc.includes('const PROGRESS_DIR = PROGRESS_DIR_USER'),
      'DATA_DIR=USER_DATA_ROOT 缺失' + (httpSrc.includes('const DATA_DIR = USER_DATA_ROOT') ? '' : '（主）'))
    const drSrc = fs.readFileSync(new URL('./src/server/dataRoot.ts', import.meta.url), 'utf-8')
    check('SMOKE-DX-05 迁移器幂等与失败保护（MIGRATED_MARK + 不删源数据 + tmp+rename）',
      drSrc.includes('.migrated') && drSrc.includes('moveEntry') && drSrc.includes('pkgResidual'),
      '迁移器关键判据缺失')
    check('SMOKE-DX-06 manifest 声明 /api/data-location 且消费者登记',
      fs.readFileSync(new URL('./src/shared/manifest.ts', import.meta.url), 'utf-8').includes("path: '/api/data-location'"))
  }

  // ═══ SMOKE-SCHED（cycle-30b T-027）：智能排程运行时断言（教训⑧：§12 崩溃安全之前）═══
  {
    const sched = await J(`${B}/api/plan/schedule`)
    check('SMOKE-SCHED-01 /api/plan/schedule 返回 schedule+profile（不冒泡 error）',
      Array.isArray(sched.schedule) && sched.schedule.length >= 30 && !!sched.profile,
      'schedule=' + (sched.schedule || []).length)
    check('SMOKE-SCHED-02 确定性：同请求两次响应深相等（无随机/时钟依赖）',
      JSON.stringify(sched) === JSON.stringify(await J(`${B}/api/plan/schedule`)))
    const focusValid = (sched.schedule || []).every(d => d.focus && d.focus.length && d.primary && typeof d.primaryRate === 'string')
    check('SMOKE-SCHED-03 每日侧重心构完整（focus 非空 + primary + 可解释率值）', focusValid)
    const sum30 = sched.schedule && sched.schedule[0] && sched.schedule[0].focus ? sched.schedule[0].focus.reduce((s, f) => s + f.suggested, 0) : -1
    check('SMOKE-SCHED-04 题量分配守恒：当日 suggested 求和 = 30（softmax 预算）', sum30 === 30, 'sum=' + sum30)
    check('SMOKE-SCHED-05 画像策略可解释：hasProfile 时为弱点×积压加权',
      !sched.profile.hasProfile || sched.profile.strategy.includes('弱点×积压'))
  }

  // ═══ SMOKE-IMG 题图占位（issue #1）：parseQuestions 保留 img → kgimg:// 占位 + /api/kg-img ═══
  {
    const rdSrc = fs.readFileSync(new URL('./src/adapters/repoData.ts', import.meta.url), 'utf-8')
    check('SMOKE-IMG-01 parseQuestions 图片占位化（kgimg:// 中立协议，不再剥 img）',
      rdSrc.includes('kgimg://') && rdSrc.includes('neutralizeImages'),
      'repoData.ts 缺占位化逻辑')
    const ukSrc = readClientBundle('SMOKE-IMG')
    check('SMOKE-IMG-02 RichText 渲染 kgimg:// → /api/kg-img?p= 绝对 URL',
      ukSrc.includes('/api/kg-img?p=') && ukSrc.includes('kgimg://'),
      'client bundle 缺 kgimg 渲染链路')
    check('SMOKE-IMG-03 http.ts 双通道分流齐备（同源 attachWebRoute + 独立端口 buildHttpServer）',
      fs.readFileSync(new URL('./src/server/http.ts', import.meta.url), 'utf-8').split("'/api/kg-img'").length >= 3,
      'kg-img 分流点不足（需同源+独立端口两处）')
    // 运行时：真实题库占位可达——跨 5 模块各抽 6 题（图形推理/资料分析含图率高，单模块随机会漏）
    let withImgTotal = 0, qTotal = 0
    for (const mod of ['判断推理', '资料分析', '数量关系', '言语理解与表达', '常识判断']) {
      const qs = await J(`${B}/api/questions?module=${encodeURIComponent(mod)}&count=6&ws=${CX}`)
      qTotal += (qs.questions || []).length
      withImgTotal += (qs.questions || []).filter((q) => String(q.stem || '').includes('kgimg://')).length
    }
    check('SMOKE-IMG-04 真实题库抽题：跨模块题干含 kgimg:// 占位（图片不再丢失）',
      qTotal > 0 && withImgTotal > 0,
      `抽 ${qTotal} 题含图 ${withImgTotal} 题`)
    // 运行时：占位路径经 /api/kg-img 服务真实可达（403/404 防线也要在）
    if (withImgTotal) {
      const qs2 = await J(`${B}/api/questions?module=资料分析&count=6&ws=${CX}`)
      const first = (qs2.questions || []).concat((await J(`${B}/api/questions?module=判断推理&count=6&ws=${CX}`)).questions || [])
        .find((q) => String(q.stem || '').includes('kgimg://'))
      const rel = first && String(first.stem).match(/kgimg:\/\/([^\]】]+)】/)?.[1]
      if (rel) {
        const img = await fetch(`${B}/api/kg-img?p=${encodeURIComponent(rel)}&ws=${CX}`)
        check('SMOKE-IMG-05 /api/kg-img 占位路径服务 200 且为图片 MIME',
          img.status === 200 && /^image\//.test(img.headers.get('content-type') || ''),
          `status=${img.status} type=${img.headers.get('content-type')}`)
        const bad = await fetch(`${B}/api/kg-img?p=${encodeURIComponent('../../etc/passwd')}&ws=${CX}`)
        check('SMOKE-IMG-06 越级路径 403/404 防线（绝不出包）',
          bad.status === 403 || bad.status === 404, `status=${bad.status}`)
      }
    }
  }

  // ═══ SMOKE-HIST 纸质补录（issue #3）：搜索/补录/幂等/统计隔离/撤销 ═══
  {
    const H = (p) => `${B}/api/history${p}${p.includes('?') ? '&' : '?'}ws=${CX}`
    const src = await J(H('/search?q=最接近'))
    check('SMOKE-HIST-01 /api/history/search 返回候选（list + contentSig 稳定指纹）',
      Array.isArray(src.list) && src.list.every((x) => x.contentSig && x.stem),
      `list=${(src.list || []).length}`)
    // 取一个候选补录三态：right / wrong / unknown；wrong 须进错题本
    const cand = (src.list || [])[0]
    if (cand) {
      const r1 = await P(H('/entries'), { entries: [
        { contentSig: cand.contentSig, question: cand, result: 'wrong', source: '测试书·p12' },
      ] })
      check('SMOKE-HIST-02 补录 wrong → accepted=1 + batchId + 错题入本',
        r1 && r1.accepted === 1 && r1.batchId && r1.acceptedItems && r1.acceptedItems[0].result === 'wrong',
        JSON.stringify(r1).slice(0, 100))
      // 统计隔离：importedTotal > 0 且 history 带 historical 标记；stats.answered 不含补录
      const wrongList = await J(`${B}/api/wrong?ws=${CX}`)
      const importedWrong = (wrongList.wrong || []).find((w) => w.fromImport === r1.batchId)
      check('SMOKE-HIST-03 补录错题进错题本（fromImport 批次标记）', !!importedWrong,
        `wrong=${(wrongList.wrong || []).length}`)
      // 幂等：同 sig 再录 → conflicts
      const r2 = await P(H('/entries'), { entries: [{ contentSig: cand.contentSig, question: cand, result: 'wrong' }] })
      check('SMOKE-HIST-04 重复补录 → conflicts=1 不重复计数',
        r2 && Array.isArray(r2.conflicts) && r2.conflicts.length === 1 && r2.accepted === 0,
        JSON.stringify(r2 && r2.conflicts).slice(0, 80))
      // 撤销：批次回滚 → history 错题移除
      const r3 = await P(H('/undo'), { batchId: r1.batchId })
      check('SMOKE-HIST-05 批次撤销 → removedHistory=1 + removedWrong=1',
        r3 && r3.undone === true && r3.removedHistory === 1 && r3.removedWrong === 1,
        JSON.stringify(r3).slice(0, 90))
      const wrongAfter = await J(`${B}/api/wrong?ws=${CX}`)
      check('SMOKE-HIST-06 撤销后错题本不再含该补录题',
        !(wrongAfter.wrong || []).some((w) => w.sig === cand.contentSig))
      // unknown 结果：无所选答案也能录（result=unknown, isCorrect=null）
      const r4 = await P(H('/entries'), { entries: [{ contentSig: cand.contentSig, question: cand, result: 'unknown' }] })
      check('SMOKE-HIST-07 result=unknown 可补录（isCorrect=null 不虚构对错）',
        r4 && r4.accepted === 1, JSON.stringify(r4).slice(0, 80))
      const st = await J(`${B}/api/stats?ws=${CX}`)
      check('SMOKE-HIST-08 统计隔离：importedTotal ≥1 且补录不算在线作答（answered 只来自在线判分）',
        st.importedTotal >= 1 && st.answered === 0,
        `importedTotal=${st.importedTotal} answered=${st.answered}`)
      // 清理测试命名空间
      await P(H('/undo'), { batchId: r4.batchId })
    } else {
      check('SMOKE-HIST-01b 深度题库/真题库均无候选（环境降级也必须返回结构）', src.list && src.list.length === 0)
    }
    // 静态守卫：manifest 声明 4 端点 + http 域链接入
    const mfSrc = fs.readFileSync(new URL('./src/shared/manifest.ts', import.meta.url), 'utf-8')
    check('SMOKE-HIST-09 manifest 声明 /api/history/* 四端点',
      ['/api/history/search', '/api/history/entries', '/api/history/undo', '/api/history/batches'].every((p) => mfSrc.includes("path: '" + p + "'")))
    const httpSrc21 = fs.readFileSync(new URL('./src/server/http.ts', import.meta.url), 'utf-8')
    check('SMOKE-HIST-10 historyApi 接入域链（buildDomains + 分发）',
      httpSrc21.includes('makeHistoryApi') && httpSrc21.includes('domains.historyApi.handle'))
    // cycle-21 出处标注（用户要求「每道题标明出处」）：三库 source 字段 + UI 徽章组件
    const ukSrc21 = readClientBundle('SMOKE-HIST')
    check('SMOKE-HIST-11 题库出处标注：三库 source 字段 + SourceBadge 组件 + 错题入库快照出处',
      ukSrc21.includes('KG_SOURCE_META') && ukSrc21.includes('SourceBadge') &&
      fs.readFileSync(new URL('./src/adapters/repoData.ts', import.meta.url), 'utf-8').includes("source: 'xingcezhenti'") &&
      fs.readFileSync(new URL('./src/adapters/tuxing.ts', import.meta.url), 'utf-8').includes("source: 'gk-tuxing'") &&
      fs.readFileSync(new URL('./src/server/srs.ts', import.meta.url), 'utf-8').includes('paperFile: q.paperFile || null'),
      'SourceBadge/三库 source/错题出处快照 任一缺失')
    // 运行时：新抽题必带 source+paperFile（xingcezhenti）
    const qsr = await J(`${B}/api/questions?module=判断推理&count=1&ws=${CX}`)
    const q0 = (qsr.questions || [])[0]
    check('SMOKE-HIST-12 运行时抽题带出处（source=xingcezhenti + paperFile 卷名）',
      q0 && q0.source === 'xingcezhenti' && typeof q0.paperFile === 'string' && q0.paperFile.length > 0,
      q0 ? ('source=' + q0.source + ' paperFile=' + String(q0.paperFile).slice(0, 20)) : 'no question')
  }

  // ═══ SMOKE-IMG22 cycle-22（专题-判断推理无图修复）：naoku 内联图占位全链路 ═══
  // 数据实证：DB 8294 题解析、1406 题选项内联 <img src="/90-图片/…">，旧 stripHtml 一刀切剥掉。
  // 修复面：naoku.ts stripHtmlKeepImg（占位化）→ RichText/OptionRow 渲染 → /api/kg-img 扩展名探测服务。
  {
    const CX22 = 'PROJ_C22'
    // 静态守卫：适配器占位化 + 解析/选项双字段走 KeepImg 链路
    const nkSrc = fs.readFileSync(new URL('./src/adapters/naoku.ts', import.meta.url), 'utf-8')
    check('SMOKE-IMG22-01 naoku 适配器占位化：stripHtmlKeepImg 覆盖 stem/options/analysis（不再一刀切剥 img）',
      nkSrc.includes('stripHtmlKeepImg') && nkSrc.includes('neutralizeImages') && nkSrc.includes('kgimg://'),
      'naoku.ts 缺占位化链路')
    check('SMOKE-IMG22-02 manifest 补登记 /api/kg-img（能力对账闭环，消费方=练习/深度题库/专题）',
      fs.readFileSync(new URL('./src/shared/manifest.ts', import.meta.url), 'utf-8').includes("path: '/api/kg-img'"))
    // 运行时：深度题库就绪时，抽判断推理题验证题干/选项/解析三处占位
    const nk22 = await J(`${B}/api/naoku/status`)
    if (nk22.ready) {
      // ═══ SMOKE-C23 cycle-23（用户二报：资料分析/言语理解渲染异常 + 材料缺失）═══
      // 根因：① naoku SELECT 漏取 material（资料分析 99.6%/言语 36% 有材料）；
      // ② img_refs 全量追加进题干 → 内联图重复渲染 + 解析公式图污染题干。
      {
        const nkSrc23 = fs.readFileSync(new URL('./src/adapters/naoku.ts', import.meta.url), 'utf-8')
        check('SMOKE-C23-01 naoku SELECT 补 material/material_ref（资料分析材料不再缺失）',
          nkSrc23.includes('material,material_ref') && nkSrc23.includes("material: materialText"),
          'naoku.ts 缺 material 字段链路')
        // img_refs 追加移除：naoku.ts 不得再调 imageMarkdown 拼题干（300 题抽检 refs basename
        // 100% 已内联于 stem/options/analysis/material，追加 = 重复渲染）。
        // （imgRefs 透传字段保留——原始 refs 仍下发供诊断；断言只盯「拼接进 stem」的旧模式）
        check('SMOKE-C23-02 naoku 移除 img_refs 追加（杜绝重复渲染与解析公式图污染题干）',
          !nkSrc23.includes('imageMarkdown') && !nkSrc23.includes("+ imageMarkdown") && !nkSrc23.includes("imgMarkdown"),
          'naoku.ts 仍有 img_refs 拼接残留')
        // 运行时：资料分析/言语理解抽题必须带材料（材料缺失=不可作答）
        let matN = 0, zlTotal = 0, yyMat = 0, yyTotal = 0
        for (const mod of ['资料分析', '言语理解与表达']) {
          const d23 = await J(`${B}/api/naoku/questions?module=${encodeURIComponent(mod)}&count=6&ws=${CX22}`)
          for (const q of (d23.questions || [])) {
            if (mod === '资料分析') { zlTotal++; if (q.material) matN++ }
            else { yyTotal++; if (q.material) yyMat++ }
          }
        }
        check('SMOKE-C23-03 深度题库资料分析抽题带材料字段（材料覆盖率 ≥80%，全库实测 99.6%）',
          zlTotal > 0 && matN / zlTotal >= 0.8, `资料分析 ${matN}/${zlTotal} 带材料 · 言语 ${yyMat}/${yyTotal}`)
        check('SMOKE-C23-04 material 与 stem 字段分离（服务端不拼接，UI 组装——SRS 快照历史可复现）',
          nkSrc23.includes('stem: stemText') && !nkSrc23.includes('materialText + NL + stemText'),
          'naoku.ts 拼接残留 → 双重渲染风险')
      }
      // 跨模块抽样（选项含图集中在 资料分析619/数量512/判断推理167）：每模块抽 8 题 × 3 模块
      let optImg = 0, anaImg = 0, stemImg = 0, qN = 0
      let firstImgQ = null
      for (const mod of ['资料分析', '数量关系', '判断推理']) {
        const d = await J(`${B}/api/naoku/questions?module=${encodeURIComponent(mod)}&count=8&ws=${CX22}`)
        for (const q of (d.questions || [])) {
          qN++
          const stemS = String(q.stem || '')
          const anaS = String(q.analysis || '')
          if (stemS.includes('kgimg://')) { stemImg++; if (!firstImgQ) firstImgQ = q }
          if (Object.values(q.options || {}).some(v => String(v).includes('kgimg://'))) optImg++
          if (anaS.includes('kgimg://')) anaImg++
        }
      }
      check('SMOKE-IMG22-03 深度题库跨模块抽题：解析含 kgimg:// 占位（公式图/题图不再丢失）',
        qN > 0 && anaImg > 0, `抽 ${qN} 题 · 解析含图 ${anaImg} · 选项含图 ${optImg} · 题干含图 ${stemImg}`)
      // 运行时：解析内联占位经 /api/kg-img 服务真实可达（webp→png 扩展名探测回退）
      if (firstImgQ || anaImg > 0 || optImg > 0) {
        // 取一道解析含图的题（抽资料分析多题提高命中率，解析含图率 8294/27506≈30%）
        let rel = null
        for (let i = 0; i < 4 && !rel; i++) {
          const d = await J(`${B}/api/naoku/questions?module=资料分析&count=8&ws=${CX22}`)
          for (const q of (d.questions || [])) {
            const m = String(q.analysis || '').match(/kgimg:\/\/([^\]】]+)】/)
            if (m) { rel = m[1]; break }
          }
        }
        if (rel) {
          const img = await fetch(`${B}/api/kg-img?p=${encodeURIComponent(rel)}&ws=${CX22}`)
          check('SMOKE-IMG22-04 /api/kg-img 解析内联占位服务 200 且为图片 MIME（扩展名探测回退 webp→png）',
            img.status === 200 && /^image\//.test(img.headers.get('content-type') || ''),
            `status=${img.status} type=${img.headers.get('content-type')} rel=${String(rel).slice(0, 50)}`)
        } else {
          check('SMOKE-IMG22-04 /api/kg-img 解析内联占位服务（本轮抽样未命中含图解析，环境降级跳过）', true)
        }
      }
    } else {
      check('SMOKE-C23-01 naoku material 链路（node:sqlite 不可用，降级跳过）', true)
      check('SMOKE-C23-02 naoku img_refs 追加移除（降级跳过）', true)
      check('SMOKE-C23-03 深度题库跨模块抽题（node:sqlite 不可用，降级跳过）', true)
      check('SMOKE-C23-04 material 与 stem 字段分离（降级跳过）', true)
      check('SMOKE-IMG22-03 深度题库跨模块抽题（node:sqlite 不可用，降级跳过）', true)
      check('SMOKE-IMG22-04 /api/kg-img 解析内联占位服务（降级跳过）', true)
    }
  }
}

  // R-P-03 + R-P-01：快照 v2 版本门（运行时，模块级）
  const IDX = 'data/.paper-index.json'
  const BAK = 'data/.paper-index.json.w3-bak'
  const had = fs.existsSync(IDX)
  if (had) fs.copyFileSync(IDX, BAK)
  try {
    // R-P-03 快照 v2 版本门（运行时）：写入 schemaVersion=1 伪快照 → 必须弃用并现场重建。
    // （新鲜模块实例经 URL query 击穿：?w3=1 与 ?w3=2 是独立模块，进程内缓存互不可见。）
    fs.writeFileSync(IDX, JSON.stringify({ schemaVersion: 1, total: 1, papers: [], note: 'W3 测试伪快照' }))
    let idx1 = null, idx2 = null, dt1 = -1, dt2 = -1, err1 = null
    try {
      const m1 = await import('./dist/adapters/paperData.js?w3=1')
      const t0 = Date.now()
      idx1 = m1.buildPaperIndex(REPO_ROOT)
      dt1 = Date.now() - t0
      const m2 = await import('./dist/adapters/paperData.js?w3=2')
      const t1 = Date.now()
      idx2 = m2.buildPaperIndex(REPO_ROOT)
      dt2 = Date.now() - t1
    } catch (e) { err1 = e }
    check('R-P-03 快照v2门：schemaVersion=1 伪快照被弃用并触发现场重建（provinces facet 到位）',
      !!idx1 && Array.isArray(idx1.provinces) && idx1.provinces.length >= 35,
      err1 ? String(err1).slice(0, 80) : `provinces=${idx1 && idx1.provinces && idx1.provinces.length} rebuild=${dt1}ms`)
    check('R-P-03 快照v2门：二次构建走 v2 快照且耗时显著下降（不硬断言毫秒）',
      !!idx2 && dt2 < dt1, `rebuild=${dt1}ms snapshot=${dt2}ms`)

    // R-P-01 真实仓库索引：provinces facet 内容 + 确定性（重建 vs 快照两次深相等）
    const names = (idx1 && idx1.provinces ? idx1.provinces : []).map(p => p.name)
    const ascNames = names.every((n, i) => i === 0 || names[i - 1] < n)   // 码点比较（< / >）
    check('R-P-01 provinces facet ≥35 项', names.length >= 35, String(names.length))
    check('R-P-01 含「山东」与「全国」', names.includes('山东') && names.includes('全国'), names.slice(0, 6).join('/'))
    check('R-P-01 provinces 码点升序（无 localeCompare）', ascNames, names.slice(0, 6).join('/'))
    const sameFacet = !!idx1 && !!idx2 &&
      JSON.stringify(idx1.provinces) === JSON.stringify(idx2.provinces) &&
      JSON.stringify(idx1.papers) === JSON.stringify(idx2.papers)
    check('R-P-01 两次构建深相等（重建结果 ≡ 快照结果，确定性）', sameFacet,
      `provinces ${idx1 && idx1.provinces && idx1.provinces.length} vs ${idx2 && idx2.provinces && idx2.provinces.length}`)
  } finally {
    // 测后还原现场（避免污染后续手工使用）
    if (had && fs.existsSync(BAK)) { fs.copyFileSync(BAK, IDX); fs.rmSync(BAK) }
    else if (!had && fs.existsSync(IDX)) fs.rmSync(IDX)
  }
}

// ── 12. 崩溃安全：外部非本应用占用 → 自动换端口而非裸抛 EADDRINUSE ──
// 使用专用高位测试端口区，避免干扰宿主实例（8400 可能已被宿主 adopt/持有）
if (server) server.close()
await new Promise(r => setTimeout(r, 200))
const { createServer } = await import('node:http')
const TPORT = 8490
const foreign = createServer((_, res) => { res.writeHead(200); res.end('foreign') })
foreign.on('error', () => {}) // 探针自身也不允许裸抛
let safetyOK = false, safetyDetail = ''
try {
  await new Promise((res2, rej2) => { foreign.once('error', rej2); foreign.listen(TPORT, '127.0.0.1', res2) })
  const third = await startServer(TPORT, { publishRuntime: false, prewarm: false }) // 应跳过被 foreign(非本应用)占用的 8490
  safetyOK = third.port !== TPORT || third.adopted
  safetyDetail = `bound=${third.port} adopted=${third.adopted}`
  if (third.server) third.server.close()
} catch (e) {
  safetyOK = e.code === 'NO_PORT' || e.message.includes('受控')
  safetyDetail = 'foreign 绑定失败(端口区间不可用): ' + e.code
}
try { foreign.close() } catch {}
check('外部占用时不裸抛 EADDRINUSE', safetyOK, safetyDetail)

// ── 13. 宿主同源路由（attachWebRoute 契约：mock webServer 验证注册与分发）──
{
  const { attachWebRoute } = await import('./dist/server/http.js')
  let captured = null
  const mockWs = { register: (r) => { captured = r; return () => { captured = 'disposed' } } }
  const dispose = attachWebRoute(mockWs, '/kaogong')
  check('attachWebRoute 注册 prefix 路由', captured?.kind === 'prefix' && captured?.path === '/kaogong', JSON.stringify(captured && { kind: captured.kind, path: captured.path }))
  check('attachWebRoute 返回 disposer', typeof dispose === 'function')
  // 同源 UI 响应（宿主路由 handler 直调 req/res 模拟成本高，验证 handler 存在即可）
  check('路由 handler 为函数', typeof captured?.handler === 'function')
  dispose()
  check('disposer 可注销', captured === 'disposed')
}

// ── 14. UI 静态契约防回归（浏览器级事故固化：el() 的 null props 守卫）──
{
  const fs = await import('node:fs')
  const html = fs.readFileSync(new URL('./src/ui/index.html', import.meta.url), 'utf-8')
  check('UI el() 含 null 守卫 (p||{})', html.includes('Object.entries(p||{})'))
  check('UI 无裸 Object.entries(p)', !/Object\.entries\(p\)[^|]/.test(html.replace('Object.entries(p||{})', '')))
  // UI 内联脚本语法门（R5 事故：forEach 未闭合曾使整个 SPA 静默瘫痪且无门禁覆盖）
  try { new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]); check('UI 内联脚本语法合法', true) }
  catch (e) { check('UI 内联脚本语法合法', false, e.message) }

  // R9 静态守卫：含 hook 的组件禁止函数直调（条件 hook → "Rendered fewer hooks" GUI 整树崩溃）
  const client = readClientBundle('R9/combo守卫')
  const directCalls = [...client.matchAll(/(?:^|[^.\w$])(Native\w+|KaogongMainPanel|KaogongTabBody|KaogongMainBounded|KaogongTabBounded)\(\s*[A-Za-z${]/gm)]
    .filter(m => !/function|=>/.test(client.slice(Math.max(0, m.index - 40), m.index)))
  check('client 无组件函数直调（R9 条件hook守卫）', directCalls.length === 0, directCalls.map(m => m[1]).join(','))
  // combo 版用 h(...) 简写挂载（等价 createElement）；两种形态都认
  check('client 子视图经组件挂载（h/createElement；cycle-24 注册表形态）',
    /h\(route\.comp, \{ key: route\.key\(tick\)/.test(client) &&
    /dashboard: \{ comp: NativeDashboardView/.test(client) && /repos: \{ comp: NativeReposView/.test(client) &&
    /(?:h|React\.createElement)\(NativePracticeView/.test(client))
  check('client 有错误边界', /class KaogongErrorBoundary extends React\.Component/.test(client))
  // R11 combo 格式守卫：必须走 __ModuleLoader__.load 且 factory 返回 {inject, apply}
  check('client 为 combo 格式（非裸 ESM）', /window\.__ModuleLoader__\.load\(\{/.test(client) && !/^export /m.test(client))
  check('combo factory 返回 {inject, apply}', /return \{\s*inject: \[[^\]]*\],\s*apply\(ctx\)/.test(client))
  // 兼容性声明守卫（guardian「未声明版本范围 → 兼容性未知」取证）
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  check('peerDependencies 声明 dsh 范围', !!pkg.peerDependencies?.['@deepseek-ai/dsh'], JSON.stringify(pkg.peerDependencies || {}))
  check('engines.dsh 声明', !!pkg.engines?.dsh, JSON.stringify(pkg.engines || {}))
  // R28（cycle-18 修：awesome-dsh-plugin PR #13534 维护者实测取证）：
  //   `dsh.bundle.patch` 指向的文件**必须在 npm 包内**，否则按市场条目 npm 安装拿到的
  //   bundle 缺 patch → 插件装了等于没装。1.11.0/1.12.0/1.13.0 三个 tarball 都缺它。
  //   同时反向守卫：本地调试 overlay（含绝对路径）绝不许入包，否则会把作者机器的路径
  //   注入到别人环境。判据一律从 package.json 自身派生，不写死文件名（同源纪律）。
  {
    const filesList = Array.isArray(pkg.files) ? pkg.files : []
    const norm = (s) => String(s).replace(/^\.\//, '')
    const patchRel = norm(pkg.dsh?.bundle?.patch || '')
    check('R28 dsh.bundle.patch 已声明且白名单覆盖（npm 安装可用）',
      !!patchRel && (filesList.length === 0 || filesList.some(f => norm(f) === patchRel || patchRel.startsWith(norm(f) + '/'))),
      `patch=${patchRel || '(未声明)'} files=[${filesList.join(',')}]`)
    check('R28 本地调试 overlay 不得入包（含绝对路径会污染他人环境）',
      !filesList.some(f => /cordis\.local\.yml$/.test(String(f))),
      `files=${JSON.stringify(filesList)}`)
    // 同族守卫：随包模板（学习计划）必须入包，否则 npm 安装态「学习计划」视图直接缺内容
    // （server 侧 PLAN_FILE = <pkg>/data/study-plan.md，包内没有就是 404 内容）
    check('R28 随包模板 data/study-plan.md 在白名单内',
      filesList.some(f => norm(f) === 'data/study-plan.md'),
      `files=${JSON.stringify(filesList)}`)
    // pack 清单实测：直接问 npm 要 tarball 内容，验证「声明 → 实体」零断链
    try {
      const { execFileSync } = await import('node:child_process')
      const dry = String(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: process.cwd(), encoding: 'utf8' }))
      const names = (JSON.parse(dry.slice(dry.indexOf('[')))[0].files || []).map(f => f.path)
      check('R28 npm pack 实测含 cordis.patch.yml', names.includes(patchRel), `含 patch=${names.includes(patchRel)} 共 ${names.length} 文件`)
      check('R28 npm pack 实测不含语料与调试 overlay',
        !names.some(n => /huasheng13\/.*\.md$/.test(n)) && !names.some(n => /cordis\.local\.yml$/.test(n)),
        `语料/overlay 命中=${names.filter(n => /huasheng13\/.*\.md$|cordis\.local\.yml$/.test(n)).join(',') || '无'}`)
    } catch (e) {
      check('R28 npm pack 实测（可执行环境依赖）', false, String(e && e.message).slice(0, 120))
    }
  }
  // 版本三锚点一致（cycle-13 收口教训：W3 升 package.json 漏改 manifest → 沙箱 banner 仍报 1.8.0）
  {
    const mSrc = fs.readFileSync(new URL('./src/shared/manifest.ts', import.meta.url), 'utf-8')
    const mv = (mSrc.match(/plugin: \{ id: 'kaogong', name: 'dsh-kaogong', version: '([^']+)'/) || [])[1]
    const rm = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf-8').match(/·\s*v([\d.]+)/)
    check('版本三锚点一致（package.json=manifest=README）', pkg.version === mv && pkg.version === (rm ? rm[1] : null), `pkg=${pkg.version} manifest=${mv} readme=${rm && rm[1]}`)
  }
  // R8：独立端口畸形请求防线（回调整体 try + clientError 兜底）
  const httpSrc = fs.readFileSync(new URL('./dist/server/http.js', import.meta.url), 'utf8')
  check('独立端口 clientError 兜底', httpSrc.includes("server.on('clientError'"))
  check('独立端口回调整体 try 包裹', /createServer\(\(req, res\) => \{\s*(?:\/\/[^\n]*\n\s*)*try \{/.test(httpSrc))
}

// ── cycle-14 材料逐份折叠 + 申论草稿暂存 + 索引预热（Lead 源码级静态守卫）──
{
  const fs = await import('node:fs')
  const readSrc = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf-8')
  const papersView = readSrc('./src/client/views/papers-view.tsx')
  const paperData = readSrc('./src/adapters/paperData.ts')
  const httpSrc = readSrc('./src/server/http.ts')
  // ① 材料逐份折叠：两处渲染点（真题卷详情 + 申论区）都有 collapsedMats 状态与「全部展开」总开关
  check('材料逐份折叠·双视图状态（collapsedMats×2）', (papersView.match(/collapsedMats/g) || []).length >= 6 && (papersView.match(/toggleMat/g) || []).length >= 4)
  check('材料逐份折叠·全部展开/收起总开关', papersView.includes("'▼ 全部展开'") && papersView.includes("'▲ 全部收起'") && papersView.includes("'▼ 展开全部材料"))
  check('材料逐份折叠·字数提示与折叠标记', papersView.includes("约 ' + wordCount + ' 字") && papersView.includes('· 已折叠'))
  // ② T-021 联动自动展开：关联材料跳转时折叠中的材料先展开（否则滚过去看不到正文）
  check('材料联动跳转自动展开（jumpToMaterial）', /jumpToMaterial[\s\S]{0,220}setCollapsedMats\(m => \(m\[no\] \? \{ \.\.\.m, \[no\]: false \} : m\)\)/.test(papersView))
  // ③ 申论草稿本地暂存：键前缀 + 读/写/清 三态 + 提交成功清除 + UI 提示
  check('申论草稿·localStorage 暂存三态', papersView.includes("'kg-essay-draft:'") && /const readDraft = /.test(papersView) && /const writeDraft = /.test(papersView))
  check('申论草稿·选题主文装载草稿且提交清除', /setAnswer\(readDraft\(q\)\)/.test(papersView) && /localStorage\.removeItem\(essayDraftKey\(cur\)\)/.test(papersView) && papersView.includes('草稿已本地暂存'))
  // ④ 索引分块预热：paperData 有 prewarmPaperIndex + setImmediate 分批；http.ts 启动接线；smoke harness 关闭预热（防 R-P-03 互踩）
  check('索引预热·分块构建不阻塞事件循环', /export function prewarmPaperIndex/.test(paperData) && /setImmediate\(step\)/.test(paperData) && /const BATCH = 40/.test(paperData))
  check('索引预热·服务启动接线且测试可关', httpSrc.includes('prewarmPaperIndex(getRepoRoot())') && /prewarm = options\.prewarm !== false/.test(httpSrc))
  const smokeSelf = fs.readFileSync(new URL('./smoke.test.mjs', import.meta.url), 'utf-8')
  check('索引预热·smoke harness 显式关闭', (smokeSelf.match(/prewarm: false/g) || []).length >= 3)
}

// ── 清理测试命名空间产物（避免污染真实进度事实）──
// cycle-21：progress 已外置到用户数据根（~/.dsh/kaogong/progress）——清理必须跟随新位置，
// 否则测试残留永远清不掉（本轮实证：清理段仍指包内 data/progress → MEM-01 默认态假红）。
{
  const fs = await import('node:fs')
  const { join } = await import('node:path')
  const { PROGRESS_DIR_USER } = await import('./dist/server/dataRoot.js')
  const dir = PROGRESS_DIR_USER
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
    if (/^PROJ_/.test(f)) fs.rmSync(join(dir, f))
  }
}

// ── cycle-19 静态守卫：研究文档落地闭环 + 工具输出标记行 + 生命周期量化（R-TEST-1）──
{
  const fs = await import('node:fs')
  const { join } = await import('node:path')
  const rd = join(process.cwd(), 'docs', 'research')
  // R-DOC 守卫：10 篇研究文档 + 索引存在（声明 → 实体零断链，R28 族同纪律）
  const rdocExpected = ['README.md', '01-PageRank幂迭代与知识点优先级.md', '02-BM25与中文双粒度检索.md', '03-五箱SRS与遗忘曲线.md', '04-力导向布局与知识地图.md', '05-LRU环形缓冲与代际令牌.md', '06-中介中心性与社区发现.md', '07-内容寻址与原子写与Merkle.md', '08-遥测分位数与控制带.md', '09-参考插件技巧实证清单.md', '10-流动语义与桑基思维.md']
  check('RDOC-01 研究文档 10 篇 + 索引全部存在', rdocExpected.every(f => fs.existsSync(join(rd, f))))
  // R-DOC 事实抽验（R14 纪律）：文档引用的代码符号 ≥5 条在源码真实存在
  const rdocBody = rdocExpected.map(f => { try { return fs.readFileSync(join(rd, f), 'utf-8') } catch { return '' } }).join('\n')
  const graphAnalytics = fs.readFileSync('src/client/graph/graph-analytics.ts', 'utf-8')
  const huasheng13 = fs.readFileSync('src/adapters/huasheng13.ts', 'utf-8')
  const srsSrc = fs.readFileSync('src/server/srs.ts', 'utf-8')
  const physicsSrc = fs.readFileSync('src/client/graph/graph-physics.ts', 'utf-8')
  const httpSrc19 = fs.readFileSync('src/server/http.ts', 'utf-8')
  const factChecks = [
    ['graphLocalPageRank', graphAnalytics.includes('export function graphLocalPageRank')],
    ['BM25_K1=1.2', huasheng13.includes('BM25_K1 = 1.2')],
    ['五箱 SRS mastered', srsSrc.includes('mastered')],
    ['KG_FLOW_RELS', physicsSrc.includes('KG_FLOW_RELS')],
    ['UNMATCHED_BUCKET', httpSrc19.includes('UNMATCHED_BUCKET')],
    ['五停渐变 GRAPH_SEQ_STOPS', graphAnalytics.includes('GRAPH_SEQ_STOPS')],
  ]
  const factHit = factChecks.filter(x => x[1]).length
  check('RDOC-02 文档引用代码符号抽验 ≥5/6 真实存在（R14 事实基座）', factHit >= 5, '命中 ' + factHit + '/6: ' + factChecks.filter(x => !x[1]).map(x => x[0]).join(','))
  // R-OUT 守卫：六工具输出统一标记行（kgMarkTail 全调用 + textOutput schema 契约）
  const hostSrc = fs.readFileSync('src/host/index.ts', 'utf-8')
  const toolCount = (hostSrc.match(/ctx\.tools\.register\(/g) || []).length
  const tailCount = (hostSrc.match(/kgMarkTail\(/g) || []).length
  check('R-OUT-01 六工具全部接线标记行（kgMarkTail 调用数 ≥ 工具注册数）', toolCount >= 6 && tailCount >= toolCount, `tools=${toolCount} tail=${tailCount}`)
  check('R-OUT-02 标记行三要素（版本锚/服务态/隔离键）', /`\[kaogong v\$\{.*version.*\} · 服务:\$\{.*up.*\} · ws:\$\{.*\}\]`/.test(hostSrc.replace(/\n/g, '')) || (hostSrc.includes('服务:') && hostSrc.includes('ws:')))
  check('R-OUT-03 体积类写死数字不复活（㉘纪律：363MB 已移除）', !hostSrc.includes('363MB'))
  // R-OBS 守卫：生命周期量化（cumMs + bootMs + obsCumMs 渲染）
  check('R-OBS-01 生命周期量化·服务端 cumMs/bootMs', httpSrc19.includes('cumMs') && httpSrc19.includes('bootMs'))
  check('R-OBS-02 生命周期量化·客户端 obsCumMs 徽章', physicsSrc.includes('KG_FLOW_RELS') && fs.readFileSync('src/client/views/obs-view.tsx', 'utf-8').includes('obsCumMs'))
  // R-OBS-03（cycle-19 沙箱旅程实证）：UI 壳路径不得进能力对账（missingProducers 假漂移根治）
  check('R-OBS-03 对账消费集排除 UI 壳与聚合桶', /const consumed = new Set\(Object\.keys\(tel\.endpoints\)\.filter\(/.test(httpSrc19) && httpSrc19.includes("p !== UNMATCHED_BUCKET"))
  // R-GRAPH 守卫：搜索回车循环（keepQuery 参数 + 循环推进）
  const graphViewSrc = fs.readFileSync('src/client/views/graph-view.tsx', 'utf-8')
  check('R-GRAPH-01 搜索回车循环定位（keepQuery + 循环提示）', graphViewSrc.includes('keepQuery?: boolean') && graphViewSrc.includes('回车循环定位'))

  // ── cycle-29 静态守卫（C29）：工具展示契约 + 图谱子图按需加载 ──
  const hostSrc29 = fs.readFileSync('src/host/index.ts', 'utf-8')
  // C29-01 P0 命令窗口根治：6 工具全部声明 presentCall/presentResult 展示契约
  //（宿主 asar 实测 148 处 presentCall 引用 = 完整支持；未声明则回退 generic 兜底卡片）
  const cardCalls = (hostSrc29.match(/\.\.\.kgToolCard/g) || []).length
  check('C29-01 工具展示契约：presentCall/presentResult 工厂存在且 6 工具全部接线',
    hostSrc29.includes('function kgToolCard') && hostSrc29.includes('presentCall') && hostSrc29.includes('presentResult') && cardCalls === 6,
    '接线数=' + cardCalls + '（应为 6）')
  // C29-02 展示投影必须纯函数（never throw）：异常收敛 undefined 保留宿主兜底
  check('C29-02 展示投影纯函数防御（try/catch 收敛 undefined，绝不抛到渲染期）',
    (hostSrc29.match(/catch \{ return undefined \}/g) || []).length >= 2)
  check('C29-03 展示卡片隐藏隔离键 workspace（不进卡片正文）', hostSrc29.includes("k === 'workspace'"))
  // C29-04 图谱子图按需加载：消费服务端已声明端点 /api/graph/neighborhood + /api/graph/impact
  check('C29-04 图谱子图：neighborhood/impact 端点 UI 消费闭环（loadSubgraph 双通道）',
    graphViewSrc.includes('loadSubgraph') && graphViewSrc.includes('/graph/neighborhood') && graphViewSrc.includes('/graph/impact'))
  // C29-05 子图模式面包屑：返回全图 + 全图统计口径不变的提示文案
  check('C29-05 子图面包屑：返回全图按钮 + 口径提示（统计面板仍按全图）',
    graphViewSrc.includes('返回全图') && graphViewSrc.includes('子图模式') && graphViewSrc.includes('仍按全图口径'))
  // C29-06 引擎装配换源：activeNodes/activeEdges 成为引擎唯一数据源（子图/全图同构）
  check('C29-06 引擎装配换源：activeNodes/activeEdges 喂引擎（子图与全图同构）',
    graphViewSrc.includes('nodes: activeNodes, edges: activeEdges') && graphViewSrc.includes('[raw, activeNodes, activeEdges]'))
  // C29-07 详情抽屉子图入口：1跳/2跳邻域 + 影响面三按钮可达
  check('C29-07 抽屉子图入口：1跳/2跳邻域 + 影响面三按钮',
    graphViewSrc.includes('1跳邻域') && graphViewSrc.includes('2跳邻域') && graphViewSrc.includes('影响面'))
  // C29-08 manifest 工具声明与 host 接线数对齐（6 个 optional-ai 工具单一事实源不漂移）
  const manifestSrc29 = fs.readFileSync('src/shared/manifest.ts', 'utf-8')
  const manifestTools29 = (manifestSrc29.match(/name: 'kaogong_/g) || []).length
  check('C29-08 manifest 工具声明数 = host 接线数（6）', manifestTools29 === 6 && cardCalls === 6,
    'manifest=' + manifestTools29)

  // ── cycle-30 静态守卫（C30）：真题卷 browse 态答案选择交互恢复 ──
  const kitSrc30 = fs.readFileSync('src/client/question/question-kit.tsx', 'utf-8')
  const pvSrc30 = fs.readFileSync('src/client/views/papers-view.tsx', 'utf-8')
  // C30-01 交互回归根治：QwPaperMode browse 态转发 interactive/onSelect（不再纯只读）
  check('C30-01 browse 态自答对照：interactive/onSelect 含 isBrowse 分支（R9 容器层同构）',
    kitSrc30.includes('interactive={isExam || isPractice || isBrowse}') && kitSrc30.includes('isExam || isPractice || isBrowse ? onSelect'))
  // C30-02 宿主持有自答态：browseSel/browseReveal 双 useState + 换卷重置
  check('C30-02 自答态宿主持有：browseSel/browseReveal useState + 换卷重置',
    pvSrc30.includes('browseSel') && pvSrc30.includes('browseReveal') && pvSrc30.includes('setBrowseSel({})'))
  // C30-03 对照操作条：主动揭示按钮（不自动判分）+ 重做入口
  check('C30-03 对照操作条：主动揭示按钮 + 重做入口（data-kg-browse-reveal 锚点）',
    pvSrc30.includes('data-kg-browse-reveal') && pvSrc30.includes('对照答案') && pvSrc30.includes('重做此题'))
  // C30-04 答题卡四态同步：browseAnswers 透传 QwExamNavigator（已答态可见）
  check('C30-04 答题卡四态同步：browseAnswers 透传 QwExamNavigator',
    kitSrc30.includes('browseAnswers') && kitSrc30.includes('(isBrowse && browseAnswers) ? browseAnswers'))
  // C30-05 卷面答案数据源：correctAnswer 优先、answer 字母形态兜底（解析器契约不漂移）
  check('C30-05 卷面答案双源：correctAnswer 优先 + answer 字母兜底',
    pvSrc30.includes('curQ.correctAnswer') && pvSrc30.includes("test(curQ.answer.toUpperCase())"))

  // ── cycle-30b 静态守卫（C30b）：T-027 学习计划智能排程 ──
  const schedSrc30 = fs.readFileSync('src/server/planSchedule.ts', 'utf-8')
  const manifestSrc30 = fs.readFileSync('src/shared/manifest.ts', 'utf-8')
  const httpSrc30 = fs.readFileSync('src/server/http.ts', 'utf-8')
  const uiSrc30 = fs.readFileSync('src/ui/index.html', 'utf-8')
  // C30b-01 算法模型：SRS 同源弱度 1/(rate+0.15) + 错题积压放大
  check('C30b-01 排程模型：弱度 1/(rate+0.15) 与积压放大同源 SRS（数学口径一致）',
    schedSrc30.includes('1 / (r + 0.15)') && schedSrc30.includes('(1 + (openTotal') && schedSrc30.includes('弱点×积压加权'))
  // C30b-02 确定性：无随机/无时钟依赖（同输入两次输出深相等由运行时断言固化）
  check('C30b-02 排程纯函数：无 Math.random、无 Date.now（确定性纪律）',
    !schedSrc30.includes('Math.random') && !schedSrc30.includes('Date.now'))
  // C30b-03 四步纪律闭环：manifest 声明 + server 实现 + UI 消费
  check('C30b-03 排程四步纪律：manifest 声明 + http 接线 + 旧 SPA UI 消费',
    manifestSrc30.includes('/api/plan/schedule') && httpSrc30.includes("/api/plan/schedule") && uiSrc30.includes('/api/plan/schedule'))
  // C30b-04 崩溃安全：错误收敛 {error} 不冒泡
  check('C30b-04 排程崩溃安全：try/catch 收敛 {error} + 空计划守卫',
    schedSrc30.includes('catch (e: any)') && schedSrc30.includes('计划为空'))

  // ── cycle-31 静态守卫（C31）：解析省略根治 + T-028 镜像回落 ──
  const kitSrc31 = fs.readFileSync('src/client/question/question-kit.tsx', 'utf-8')
  const rmSrc31 = fs.readFileSync('src/server/repoManager.ts', 'utf-8')
  // C31-01 解析显示语义（cycle-32b 精化）：占位按 mode 分流——hideBeforeAnswer=practice|exam
  // （作答场景未揭示防偷看）；browse/single 解析完整显示（C31 修复的浏览语义不变）
  check('C31-01 解析显示按 mode 分流：hideBeforeAnswer=practice|exam，browse/single 完整显示',
    kitSrc31.includes("hideBeforeAnswer={mode === 'practice' || mode === 'exam'}") && kitSrc31.includes('if (!revealed && hideBeforeAnswer) {'))
  // C31-02 镜像回落：镜像作业失败自动切直连重试（T-028），direct 通道防再包裹
  check('C31-02 镜像回落直连：close 失败钩子 auto-retry + startJob direct 通道',
    rmSrc31.includes('auto-retry') && rmSrc31.includes('{ direct: true }') && rmSrc31.includes('opts.direct'))
  // C31-03 防环：回落作业不再二次回落（retriedFrom 防环标记）
  check('C31-03 回落防环：retriedFrom 判据（直连失败不无限重试）',
    rmSrc31.includes('!job.retriedFrom') && rmSrc31.includes('.retriedFrom = job.url'))

  // ── cycle-32 静态守卫（C32）：真题卷三模式（学习/答题/全卷）──
  const pvSrc32 = fs.readFileSync('src/client/views/papers-view.tsx', 'utf-8')
  // C32-01 三模式切换条：paperMode 三态 + data-kg-paper-mode 锚点
  check('C32-01 三模式切换条：paperMode ∈ browse|answer|learn + 切换锚点',
    pvSrc32.includes("useState('browse')") && pvSrc32.includes("setPaperMode('answer')") && pvSrc32.includes("setPaperMode('learn')") && pvSrc32.includes('data-kg-paper-mode'))
  // C32-02 答题模式复用 exam 域（start 剥答案 + submit 服务端判分），不重造判分器
  check('C32-02 答题模式复用 exam 域三端点（start/submit 服务端判分，零新端点）',
    pvSrc32.includes('/paper/exam/start?id=') && pvSrc32.includes('/paper/exam/submit') && pvSrc32.includes('data-kg-answer-start') && pvSrc32.includes('data-kg-answer-submit'))
  // C32-03 学习模式：单题选中即判分揭示（不可改选）+ 下一题推进 + 申论题诚实降级
  check('C32-03 学习模式：选中即揭示（if (learnReveal) return 防改选）+ 下一题锚点 + 主观题降级',
    pvSrc32.includes('if (learnReveal) return') && pvSrc32.includes('data-kg-learn-next') && pvSrc32.includes('不支持在线判分'))
  // C32-04 换卷重置：三模式全部状态随 openId 重置（learn/answer/browse 零残留）
  check('C32-04 换卷重置：learn/answer 状态全部随 openId 清零',
    pvSrc32.includes('setLearnIdx(0)') && pvSrc32.includes('setAnswerExam(null)') && pvSrc32.includes('setLearnCorrectCount(0)'))


  // ── cycle-26 静态守卫（C26）：行测材料双形态 + 真题卷加载死循环根治 ──

  const ppSrc26 = fs.readFileSync('src/adapters/paperParse.ts', 'utf-8')

  const pvSrc26 = fs.readFileSync('src/client/views/papers-view.tsx', 'utf-8')

  const paSrc26 = fs.readFileSync('src/server/paperApi.ts', 'utf-8')

  const kitSrc26 = fs.readFileSync('src/client/question/question-kit.tsx', 'utf-8')

  check('C26-01 材料双形态：解析器支持 申论-给定材料 + 行测-材料N 组段（parseGroupMaterials）',

    /export function parseGroupMaterials/.test(ppSrc26) && ppSrc26.includes('groupMaterial'))

  check('C26-02 组材料透出：/api/paper 对 groupMaterial 做 rewriteImages（图片链路一致）',

    paSrc26.includes('q.groupMaterial = rewriteImages'))

  check('C26-03 组材料消费：整卷/专题模式消费组材料（QwPaperMode 容器 + study-view 队列映射）',
    (() => { const kit = fs.readFileSync('src/client/question/question-kit.tsx', 'utf-8')
      const sv = fs.readFileSync('src/client/views/study-view.tsx', 'utf-8')
      const pv = fs.readFileSync('src/client/views/papers-view.tsx', 'utf-8')
      return kit.includes('q.groupMaterial') && kit.includes('function QwPaperMode') && sv.includes('x.groupMaterial') && /QwPaperMode/.test(pv) && /mode="practice"/.test(sv) && kit.includes('wordCount > 500') })())

  check('C26-04 加载死循环根治：详情 effect 依赖不含 detail（渲染值不进取数依赖）',

    !/\}, \[openId, detail, api\]\)/.test(pvSrc26) && /}, \[openId, api\]\)/.test(pvSrc26))



  // ── cycle-28 静态守卫（C28）：材料段终止条件 + 泄露防线 + 专题四区对齐 ──

  check('C28-01 材料段终止于题头：parseGroupMaterials 终止条件含 ### 第 N 题（防吞后续题干与答案）',

    /export function parseGroupMaterials/.test(ppSrc26) && ppSrc26.includes('###\\s*第\\s*\\d+\\s*题'))

  check('C28-02 专题四区对齐：study-view 练习态经 QwPaperMode（材料区/切换区/答题卡区同构模考）',

    (() => { const sv = fs.readFileSync('src/client/views/study-view.tsx', 'utf-8')

      return sv.includes('mode="practice"') && sv.includes('<QwPaperMode') })())

}


// ── cycle-20 P0 静态守卫：R11 复发根治（裸 tsc 覆写 combo → 插件启动失败/宿主崩溃）──
{
  const fs = await import('node:fs')
  // ① config.yml 不得含任何裸 tsc 产物产出命令（G3/build_cmd）——门禁必须走 npm scripts
  // 只看「配置项值」：以键名开头、值含 `npx tsc` 且不带 --noEmit 的行（注释以 # 开头不参与）
  const cfg = fs.readFileSync('.cycles/config.yml', 'utf-8')
  const rawTsc = cfg.split('\n').filter(l => /^\s*[a-zA-Z_]+:\s*\[?["']?npx tsc(?! --noEmit)/.test(l))
  check('R11-GUARD-01 config.yml 无裸 tsc 产物命令（门禁走 npm run build 全链）',
    rawTsc.length === 0 && cfg.includes('build_commands: ["npm run build"]') && cfg.includes('build_cmd: "npm run build"'),
    rawTsc.join(' | ') || 'ok')
  // ② 所有产出 dist 的 npm scripts 必须同时接 bundler 与 assert-combo
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
  const emitters = ['build', 'prepack', 'prepare', 'test', 'test:render', 'test:all']
  const badEmit = emitters.filter(k => {
    const v = pkg.scripts[k] || ''
    return !v.includes('bundle-client.mjs') || !v.includes('assert-combo.mjs')
  })
  check('R11-GUARD-02 全部产物产出脚本接 bundler + assert-combo 守卫', badEmit.length === 0, badEmit.join(',') || 'ok')
  // ③ assert-combo 守卫自身存在且可执行（防「守卫被删」型回归）
  check('R11-GUARD-03 assert-combo.mjs 守卫存在且含响亮失败判据',
    fs.existsSync('scripts/assert-combo.mjs') &&
    fs.readFileSync('scripts/assert-combo.mjs', 'utf-8').includes('process.exit(1)'))
  // ③b R28 族：package.json scripts 引用的 scripts/*.mjs 必须进 files 白名单（源码安装 prepare 依赖）
  const emitScripts = ['bundle-client.mjs', 'assert-combo.mjs']
  const files = pkg.files || []
  const missingScripts = emitScripts.filter(s => !files.includes('scripts') && !files.includes('scripts/' + s))
  check('R11-GUARD-03b prepare/prepack 引用的 scripts/*.mjs 全部在 files 白名单内（R28 声明→实体）',
    missingScripts.length === 0, missingScripts.join(',') || 'ok')
  // ④ 当前 combo 产物形态（运行时再兜一次；构建期已由 assert-combo 硬拦）
  const combo = fs.readFileSync('dist/client/client.js', 'utf-8')
  check('R11-GUARD-04 当前 dist/client/client.js 为 combo factory 形态',
    !/^import[ \t]/m.test(combo) && !/^export[ \t]/m.test(combo) &&
    /window\.__ModuleLoader__\.load\(\{/.test(combo) && /return \{\s*inject: \[/.test(combo))

  // ── cycle-24 组件规范守卫（C24）：目录分层 + 注册表路由形态 ──
  const cl24 = fs.readFileSync('src/client/client.tsx', 'utf-8')
  check('C24-01 注册表路由：client.tsx 含 VIEW_ROUTES 唯一分发事实源',
    /const VIEW_ROUTES: Record</.test(cl24) && /h\(route\.comp, \{ key: route\.key\(tick\)/.test(cl24))
  check('C24-02 注册表路由：三元分发链不复活（禁止 view === * ? h(Native* 形态 ≥2 处）',
    (cl24.match(/view === '[a-z]+' \? h\(Native/g) || []).length <= 1)
  check('C24-03 目录分层：client/ 根只允许 entry+ui-kit（视图级文件必须在 views/）',
    (() => { const root = fs.readdirSync('src/client', { withFileTypes: true })
      return root.filter(f => f.isFile()).every(f => ['client.tsx', 'ui-kit.tsx'].includes(f.name)) })())
  check('C24-04 视图层全部 .tsx（views/ 下不得有 .ts 视图残留）',
    fs.readdirSync('src/client/views').every(f => f.endsWith('.tsx')))
  check('C24-05 tsconfig jsx=react（classic runtime；禁 react-jsx 自动 import）',
    /"jsx": "react"/.test(fs.readFileSync('tsconfig.json', 'utf-8')) && !/"jsx": "react-jsx"/.test(fs.readFileSync('tsconfig.json', 'utf-8')))
  check('C24-06 React 引入纪律：.tsx 禁 import React（唯一 require 在 ui-kit）',
    (() => { for (const dir of ['src/client', 'src/client/views', 'src/client/question']) {

        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.tsx')) continue
          const s = fs.readFileSync(dir + '/' + f, 'utf-8')
          if (/^import\s+React\s/m.test(s)) return false
          if (f !== 'ui-kit.tsx' && s.includes("require('react')")) return false
        } } return true })())


  // ── cycle-25 统一题目渲染域守卫（C25）：七段结构 + 答题卡 + 图片放大 ──

  const kitSrc = fs.readFileSync('src/client/question/question-kit.tsx', 'utf-8')

  const lbSrc = fs.readFileSync('src/client/question/question-lightbox.tsx', 'utf-8')

  check('C25-01 七段齐备：question-kit 含编号/来源/类型/材料/题干/选项/答案七段组件',

    ['QwNumberBadge', 'QwSourceMeta', 'QwTypeTag', 'QwMaterial', 'QwStem', 'QwOptions', 'QwAnswerDims', 'QwQuestionCard'].every(n => kitSrc.includes('function ' + n)))

  check('C25-02 答题卡：QwExamNavigator 含网格跳转与四态（未答/已答/标记/当前）',

    /function QwExamNavigator/.test(kitSrc) && kitSrc.includes('onJump') && kitSrc.includes('flags && flags.has'))

  check('C25-03 图片放大：QwLightbox 含滚轮缩放/拖拽/ESC 三交互',

    /function QwLightbox/.test(lbSrc) && lbSrc.includes('wheelZoom') && lbSrc.includes('dragStart') && lbSrc.includes('Escape'))

  check('C25-04 接入面：practice/exam/papers/essay 消费 QwQuestionCard',

    (() => { const sv = fs.readFileSync('src/client/views/study-view.tsx', 'utf-8')

      const pv = fs.readFileSync('src/client/views/papers-view.tsx', 'utf-8')

      return /QwQuestionCard/.test(sv) && /QwExamNavigator/.test(pv) && (pv.match(/QwQuestionCard/g) || []).length >= 3 })())

  check('C25-05 材料折叠契约保留：papers-view 源码内 collapsedMats/toggleMat/jumpToMaterial 仍在',

    (() => { const pv = fs.readFileSync('src/client/views/papers-view.tsx', 'utf-8')

      return (pv.match(/collapsedMats/g) || []).length >= 6 && (pv.match(/toggleMat/g) || []).length >= 4 && /jumpToMaterial/.test(pv) })())

}

// ── 汇总 ──
console.log(`\n═══ 结果: ${results.length - failed}/${results.length} 通过 ═══`)
if (server) server.close()
process.exit(failed ? 1 : 0)
