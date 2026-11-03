/**
 * dsh-kaogong E2E 冒烟测试 — 白盒验证 v1.1
 * 运行: node smoke.test.mjs
 * 覆盖: 信标发现 / adopt复用 / 崩溃安全(EADDRINUSE不逃逸) / 工作区隔离 /
 *       抽题判分 / 计划结构化 / 检索方法论 / 图谱指标 / 遥测 / 能力矩阵
 */
import fs from 'node:fs'
import { startServer } from './dist/server/http.js'

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
const { server, port, adopted } = await startServer(TP, { publishRuntime: false })
check('server 启动返回 port', typeof port === 'number', `got ${port}`)
const B = `http://127.0.0.1:${port}`

// ── 2. 信标自描述 ──
const st = await J(`${B}/api/status?ws=PROJ_A`)
check('status.app 信标字段', st.app === 'dsh-kaogong', JSON.stringify(st).slice(0, 80))
check('status 含 pid/uptime/port', st.pid > 0 && st.uptimeSec >= 0 && st.port === port)

// ── 3. adopt 复用（二次启动不应崩、不应新绑端口）──
const second = await startServer(TP, { publishRuntime: false })
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
check('能力矩阵 5 工具', caps.tools?.length === 5, `${caps.tools?.length}`)
check('能力矩阵端点≥14', caps.endpoints?.length >= 14, `${caps.endpoints?.length}`)
check('双入口声明（左沉浸+右并排）', caps.entries?.length === 2 && caps.entries.some(e => e.kind === 'left-immersive') && caps.entries.some(e => e.kind === 'right-docked'), JSON.stringify(caps.entries || []))
check('双通道声明（同源优先）', caps.channels?.length === 2 && caps.channels.find(c => c.id === 'same-origin')?.preferred === true, JSON.stringify(caps.channels || []))
const wss = await J(`${B}/api/workspaces`)
check('命名空间清单含 PROJ_A', (wss.workspaces || []).some(w => w.ns.includes('PROJ_A')), JSON.stringify(wss.workspaces?.map(w => w.ns)))

// ── 11. 错题本 SRS 闭环（收集→回炉→升箱→掌握→移除→统计；独立 PROJ_S 命名空间）──
{
  const W = '?ws=PROJ_S'
  // 取一道"干净"错题：循环抽题直到 stem 不在错题本（同文件重复题会致签名计数>1，flaky 根因）
  let q1 = null, wrongAns = null
  for (let i = 0; i < 6; i++) {
    const cand = (await J(`${B}/api/questions?module=常识判断&count=1`)).questions[0]
    const existing = (await J(`${B}/api/wrong${W}`)).wrong.find(w => w.stem === cand.stem)
    if (!existing || existing.wrongCount === 0) { q1 = cand; break }
    // 撞重复题：把它从错题本清掉再重测
    if (existing) await P(`${B}/api/wrong/remove${W}`, { sig: existing.sig })
  }
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
  const third = await startServer(TPORT, { publishRuntime: false }) // 应跳过被 foreign(非本应用)占用的 8490
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
  const client = fs.readFileSync(new URL('./dist/client/client.js', import.meta.url), 'utf8')
  const directCalls = [...client.matchAll(/(?:^|[^.\w$])(Native\w+|KaogongMainPanel|KaogongTabBody|KaogongMainBounded|KaogongTabBounded)\(\s*[A-Za-z${]/gm)]
    .filter(m => !/function|=>/.test(client.slice(Math.max(0, m.index - 40), m.index)))
  check('client 无组件函数直调（R9 条件hook守卫）', directCalls.length === 0, directCalls.map(m => m[1]).join(','))
  // combo 版用 h(...) 简写挂载（等价 createElement）；两种形态都认
  check('client 子视图经组件挂载（h/createElement）',
    /h\(NativePracticeView/.test(client) && /h\(NativeDashboardView/.test(client) &&
    /h\(NativeGraphView, \{ key: 'g' \+ tick, data: data\.g/.test(client))
  check('client 有错误边界', /class KaogongErrorBoundary extends React\.Component/.test(client))
  // R11 combo 格式守卫：必须走 __ModuleLoader__.load 且 factory 返回 {inject, apply}
  check('client 为 combo 格式（非裸 ESM）', /window\.__ModuleLoader__\.load\(\{/.test(client) && !/^export /m.test(client))
  check('combo factory 返回 {inject, apply}', /return \{\s*inject: \[[^\]]*\],\s*apply\(ctx\)/.test(client))
  // 兼容性声明守卫（guardian「未声明版本范围 → 兼容性未知」取证）
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  check('peerDependencies 声明 dsh 范围', !!pkg.peerDependencies?.['@deepseek-ai/dsh'], JSON.stringify(pkg.peerDependencies || {}))
  check('engines.dsh 声明', !!pkg.engines?.dsh, JSON.stringify(pkg.engines || {}))
  // R8：独立端口畸形请求防线（回调整体 try + clientError 兜底）
  const httpSrc = fs.readFileSync(new URL('./dist/server/http.js', import.meta.url), 'utf8')
  check('独立端口 clientError 兜底', httpSrc.includes("server.on('clientError'"))
  check('独立端口回调整体 try 包裹', /createServer\(\(req, res\) => \{\s*(?:\/\/[^\n]*\n\s*)*try \{/.test(httpSrc))
}

// ── 清理测试命名空间产物（避免污染真实进度事实）──
{
  const fs = await import('node:fs')
  const { join } = await import('node:path')
  const dir = join(process.cwd(), 'data', 'progress')
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
    if (f.includes('PROJ_A') || f.includes('PROJ_B') || f.includes('PROJ_S')) fs.rmSync(join(dir, f))
  }
}

// ── 汇总 ──
console.log(`\n═══ 结果: ${results.length - failed}/${results.length} 通过 ═══`)
if (server) server.close()
process.exit(failed ? 1 : 0)
