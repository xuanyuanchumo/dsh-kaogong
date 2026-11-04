/**
 * 重构专题体系（v1.7.1）：行测/申论各自的专题 + 统一练习入口
 *
 * 用户诉求：专题应分「行测专题」与「申论专题」，且练习入口应在专题内（申论练习不再单独存在，行测练习也要有）。
 *
 * 结构：
 *  - channels: [行测, 申论] 两个练习频道
 *  - 行测专题：按六大模块 + naoku 题型（图形推理/逻辑判断/资料分析…）
 *  - 申论专题：按五类题型（概括/分析/对策/应用文/大作文）
 *  - 每个专题带 entry：{ view, params } 指向对应练习视图（统一路由）
 */
import { buildPaperIndex, buildTopics } from '../adapters/paperData.js'
import { naokuStats } from '../adapters/naoku.js'

/** 行测专题：模块 + 细分题型（有 naoku 数据时用真实题量） */
function xingceTopics(idx, stats) {
  const MODULES = ['判断推理', '言语理解与表达', '数量关系', '资料分析', '常识判断', '政治理论']
  const out: any[] = []
  // 模块级
  for (const m of MODULES) {
    const subj = (idx.subjects || []).find(s => s.subject === '行测')
    const nk = stats ? (stats.modules || []).find(x => x.m === m) : null
    out.push({
      id: 'xc:module:' + m, channel: '行测', kind: 'module', title: m,
      desc: nk ? `深度题库 ${nk.c} 题（含解题链标注）` : '考纲六大模块之一',
      questionCount: nk ? nk.c : null,
      papers: subj ? subj.count : null,
      entry: { view: 'practice', params: { module: m } },
    })
  }
  // 题型级（来自 naoku categories，取行测相关高频）
  const CATS = ['图形推理', '逻辑判断', '定义判断', '类比推理', '逻辑填空', '片段阅读', '语句表达', '数学运算', '资料分析', '人文常识', '科技常识', '法律常识', '政治常识']
  for (const c of CATS) {
    const nk = stats ? (stats.categories || []).find(x => x.k === c) : null
    if (!nk) continue
    out.push({
      id: 'xc:cat:' + c, channel: '行测', kind: 'category', title: c,
      desc: `深度标注 ${nk.c} 题`, questionCount: nk.c,
      entry: c === '图形推理' ? { view: 'tuxing', params: {} } : { view: 'deepbank', params: { category: c } },
    })
  }
  return out
}

/** 申论专题：五类题型，每类给真题检索入口 */
function shenlunTopics() {
  const TYPES = [
    { key: '概括', desc: '概括归纳：提炼要点、分条作答（采分点制）' },
    { key: '分析', desc: '综合分析：解释含义、分析原因影响' },
    { key: '对策', desc: '提出对策：针对问题给可执行方案' },
    { key: '应用文', desc: '应用文写作：格式规范 + 内容完整双评分' },
    { key: '大作文', desc: '大作文：标题+总分总结构+论证（40 分权重，字数分档）' },
  ]
  return TYPES.map(t2 => ({
    id: 'sl:' + t2.key, channel: '申论', kind: 'essay-type', title: '申论 · ' + t2.key,
    desc: t2.desc,
    entry: { view: 'essay', params: { type: t2.key } },
  }))
}

/**
 * 统一专题树
 * @returns { channels, topics, stats }
 */
export function buildTopicTree(repoRoot) {
  const idx = buildPaperIndex(repoRoot)
  const naoku = naokuStats()
  const xc = xingceTopics(idx, naoku)
  const sl = shenlunTopics()

  const essayPapers = (idx.subjects || []).find(s => s.subject === '申论')
  const xcPapers = (idx.subjects || []).find(s => s.subject === '行测')

  return {
    channels: [
      {
        id: 'xingce', name: '行测', icon: '📐',
        desc: naoku ? `深度题库 ${naoku.total} 题 + 真题卷 ${xcPapers ? xcPapers.count : 0} 套` : `真题卷 ${xcPapers ? xcPapers.count : 0} 套`,
        topics: xc,
        entries: [
          { label: '刷题（SRS）', view: 'practice', params: {} },
          { label: '深度题库', view: 'deepbank', params: {} },
          { label: '图形推理专项', view: 'tuxing', params: {} },
          { label: '整卷模考', view: 'exam', params: {} },
          { label: '真题卷库', view: 'papers', params: { subject: '行测' } },
        ],
      },
      {
        id: 'shenlun', name: '申论', icon: '✍️',
        desc: `真题卷 ${essayPapers ? essayPapers.count : 0} 套 · 离线评改（小题采分点制 / 大作文分档）`,
        topics: sl,
        entries: [
          { label: '申论练习', view: 'essay', params: {} },
          { label: '真题卷库', view: 'papers', params: { subject: '申论' } },
        ],
      },
    ],
    stats: {
      paperTotal: idx.total || 0,
      essayPapers: essayPapers ? essayPapers.count : 0,
      xingcePapers: xcPapers ? xcPapers.count : 0,
      naokuTotal: naoku ? naoku.total : 0,
      kadianCoverage: naoku ? naoku.kadianCoverage : 0,
    },
  }
}
