/**
 * tests/unit/pool-tuxing.test.mjs — 图形推理统一读层单测（cycle-60 T-038 无损换源）
 *
 * 覆盖：
 *  · shape 齐全：与 adapters/tuxing.ts 的 TuxingQuestion 逐字段对齐
 *    （id/group/no/img/src/cat/catName/fmt/ans/exp/acc/trap + source/imgUrl）；
 *  · 无损：cat 代码 / fmt / acc / trap / g / n 从 source_extras 原样重建；
 *  · 无 extras 的旧行走兜底（rule_type 中文反查 cat 代码 / images / paper）；
 *  · 崩溃安全：畸形 JSON 不抛、诚实降级。
 * 用 dist 导入（.mjs 禁 TS 类型注解）；mock DB 不碰生产 ~/.dsh/kaogong/.kaogong.db。
 */
import { test, expect } from 'vitest'
import { poolRowToTuxing, makePoolTuxingReader } from '../../dist/server/poolTuxing.js'

/** mock DB：只需 .prepare().all() 返回预置行（读层不写库） */
function mockDb(rows) {
  return { prepare: () => ({ all: () => rows }) }
}

const UPSTREAM = {
  id: 'g1_01', g: '历年真题精选·第一组', n: 1, img: 'assets/q/g1_01.png',
  src: '2022 重庆选调', cat: 'symmetry', fmt: '分组分类', ans: 'b',
  exp: '参考答案：B。解题思路：数对称轴……', acc: '易错在把中心对称当轴对称', trap: '漏数斜向对称轴',
}
const ROW = {
  id: 12, qid: 'q:gk-tuxing:g1_01', source_id: 'gk-tuxing',
  rule_type: '对称性', answer: 'B', analysis: UPSTREAM.exp, paper: UPSTREAM.src,
  images: JSON.stringify([{ source: 'gk-tuxing', relPath: UPSTREAM.img }]),
  source_extras: JSON.stringify(UPSTREAM),
}

test('TUXING-MAP-01 shape 齐全：上游全字段无损重建 + catName/imgUrl/source 派生', () => {
  const q = poolRowToTuxing(ROW)
  expect(q.id).toBe('g1_01')
  expect(q.group).toBe(UPSTREAM.g)
  expect(q.no).toBe(1)
  expect(q.img).toBe(UPSTREAM.img)
  expect(q.src).toBe(UPSTREAM.src)
  expect(q.cat).toBe('symmetry')                 // 代码原样（不丢成中文）
  expect(q.catName).toBe('对称性')
  expect(q.fmt).toBe('分组分类')
  expect(q.ans).toBe('B')
  expect(q.exp).toBe(UPSTREAM.exp)
  expect(q.acc).toBe(UPSTREAM.acc)
  expect(q.trap).toBe(UPSTREAM.trap)
  const d = makePoolTuxingReader(mockDb([ROW])).question('g1_01')
  expect(d.source).toBe('gk-tuxing')
  expect(d.imgUrl).toBe('/kaogong/api/tuxing-img?p=' + encodeURIComponent(UPSTREAM.img))
})

test('TUXING-MAP-02 旧库兜底：无 source_extras 时 rule_type 中文反查 cat + images/paper/answer 回填', () => {
  const q = poolRowToTuxing({
    qid: 'q:gk-tuxing:g1_07', rule_type: '位置规律', answer: 'a', analysis: '解析',
    paper: '2021 浙江', images: JSON.stringify([{ relPath: 'assets/q/g1_07.png' }]),
  })
  expect(q.id).toBe('q:gk-tuxing:g1_07')
  expect(q.cat).toBe('position')
  expect(q.catName).toBe('位置规律')
  expect(q.fmt).toBe('')
  expect(q.acc).toBe('')
  expect(q.trap).toBe('')
  expect(q.img).toBe('assets/q/g1_07.png')
  expect(q.src).toBe('2021 浙江')
  expect(q.ans).toBe('A')
})

test('TUXING-MAP-03 reader 三端点同形：cats/list/question + 崩溃安全（畸形 JSON 不抛）', () => {
  const r = makePoolTuxingReader(mockDb([ROW, {
    ...ROW, qid: 'q:gk-tuxing:g1_02',
    source_extras: JSON.stringify({ ...UPSTREAM, id: 'g1_02', cat: 'position', n: 2 }),
  }]))
  expect(r.ready()).toBe(true)
  const cats = r.cats()
  expect(cats.length).toBe(2)
  expect(cats.some(c => c.cat === 'symmetry' && c.name === '对称性')).toBe(true)
  const list = r.questions({ cat: 'symmetry', limit: 2 })
  expect(list.total).toBe(1)
  expect(list.questions[0].trap).toBe(UPSTREAM.trap)   // 列表也带无损字段
  expect(r.question('missing').error).toBe('题目不存在: missing')
  // 畸形 JSON：不抛，降级为空
  const bad = poolRowToTuxing({ qid: 'x', source_extras: '{bad', images: 'nope' })
  expect(bad.cat).toBe('')
  expect(bad.img).toBe('')
  expect(bad.trap).toBe('')
})
