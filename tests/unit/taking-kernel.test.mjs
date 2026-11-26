/**
 * tests/unit/taking-kernel.test.mjs — 统一取题层内核单测（cycle-61 v9）
 *
 * 覆盖配额守恒/让渡（quotaPlan）、加权无放回抽样（weightedPickIndex）、
 * 模块弱点向量（moduleWeakness 的先验语义）。
 *
 * 这些算法此前散在 poolApi.sampleQuestions 与 srs.srsQuestions 两处各写一份；
 * v9 收敛到 kernel 后，本文件是它们的唯一回归面。
 */
import { test, expect } from 'vitest'
import {
  quotaPlan, weightedPickIndex, moduleWeakness, weaknessWeight,
} from '../../dist/shared/kernel.js'

test('QUOTA-01 配额守恒：Σ 名额 ≤ 总题数（count=1 不得返回 2 题）', () => {
  for (const n of [1, 2, 3, 5, 10, 50]) {
    const half = Math.ceil(n / 2)
    const plan = quotaPlan(n, [
      { name: 'material', cap: half },
      { name: 'image', cap: half },
      { name: 'dims', cap: n },
      { name: 'fallback', cap: n },
    ])
    expect(plan.reduce((s, x) => s + x, 0), `n=${n} 配额超限 ${JSON.stringify(plan)}`).toBeLessThanOrEqual(n)
    expect(plan.every(x => x >= 0)).toBe(true)
  }
})

test('QUOTA-02 让渡规则：高优先层占满则低优先层拿剩余（不出现负名额）', () => {
  // 材料组吃满一半 → 带图层也拿一半 → 后两层只剩互补名额
  const plan = quotaPlan(6, [
    { name: 'material', cap: 3 },
    { name: 'image', cap: 3 },
    { name: 'dims', cap: 6 },
    { name: 'fallback', cap: 6 },
  ])
  expect(plan).toEqual([3, 3, 0, 0])
  // 材料组没吃到（0）→ 名额全部让给后面
  const plan2 = quotaPlan(6, [
    { name: 'material', cap: 0 },
    { name: 'image', cap: 3 },
    { name: 'dims', cap: 6 },
    { name: 'fallback', cap: 6 },
  ])
  expect(plan2).toEqual([0, 3, 3, 0])
})

test('QUOTA-03 确定性：同输入两次输出深相等（无随机）', () => {
  const layers = [{ cap: 4 }, { cap: 4 }, { cap: 9 }, { cap: 9 }]
  expect(quotaPlan(9, layers)).toEqual(quotaPlan(9, layers))
})

test('PICK-01 加权无放回：不重复取同一下标，且长度不超过请求数', () => {
  const idx = weightedPickIndex([1, 2, 3, 4, 5], 3)
  expect(idx.length).toBe(3)
  expect(new Set(idx).size).toBe(3)
  for (const i of idx) expect(i >= 0 && i < 5).toBe(true)
})

test('PICK-02 权重语义：高权重更容易被选中（固定随机源下的确定性验证）', () => {
  // rand 恒 0.99：每次都落在「累计权重末尾」→ 抽的是当前最高的那个未用项。
  // 第一次：总权重 100.02 → 0.99*total 落在第 3 项（权重 100）区间 → 选 2。
  // 第二次：剩 [0.01, 0.01] → 0.99*0.02 落在第 2 项 → 选 1。
  let k = 0
  const rand = () => 0.99
  const idx = weightedPickIndex([0.01, 0.01, 100], 2, rand)
  void k
  expect(idx[0]).toBe(2)          // 最大权重先被选中
  expect(idx.length).toBe(2)
  expect(new Set(idx).size).toBe(2)
})

test('PICK-03 全零权重退化为确定性取前 n（不返回短数组）', () => {
  const idx = weightedPickIndex([0, 0, 0, 0], 2)
  expect(idx).toEqual([0, 1])
})

test('PICK-04 请求数超过候选项：最多取全部（不越界、不重复）', () => {
  const idx = weightedPickIndex([1, 1, 1], 10)
  expect(idx.length).toBe(3)
  expect(new Set(idx).size).toBe(3)
})

test('PICK-05 非法输入收敛：负数/NaN 权重与负 n 不抛错', () => {
  expect(weightedPickIndex([-1, NaN, 2], -3)).toEqual([])
  const idx = weightedPickIndex([-1, NaN, 2], 2)
  expect(idx[0]).toBe(2)          // 唯一正权项优先
  expect(idx.length).toBeLessThanOrEqual(3)
})

test('WEAK-01 模块弱点向量：先验 rate 由调用方声明（0.5 中性 vs 0 新模块优先）', () => {
  const byModule = { 判断推理: { answered: 10, correct: 9 }, 数量关系: { answered: 4, correct: 1 } }
  const mods = ['判断推理', '数量关系', '资料分析']
  const neutral = moduleWeakness(mods, byModule, 0.5)
  const aggressive = moduleWeakness(mods, byModule, 0)
  // 已作答模块：两种先验结果相同（公式一致）
  expect(neutral[0]).toBeCloseTo(weaknessWeight(0.9), 6)
  expect(neutral[1]).toBeCloseTo(weaknessWeight(0.25), 6)
  // 无数据模块：先验不同 → 权重不同（这正是「业务语义留调用侧」的证据）
  expect(neutral[2]).not.toBe(aggressive[2])
  expect(aggressive[2]).toBeGreaterThan(neutral[2])   // rate=0 → 权重更高（更优先）
})

test('WEAK-02 弱模块权重更高（1/(rate+0.15) 单调递减）', () => {
  const w1 = moduleWeakness(['a'], { a: { answered: 10, correct: 1 } }, 0.5)[0]
  const w2 = moduleWeakness(['b'], { b: { answered: 10, correct: 9 } }, 0.5)[0]
  expect(w1).toBeGreaterThan(w2)
})
