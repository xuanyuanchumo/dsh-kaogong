/**
 * tests/unit/pool-naoku.test.mjs — 深度题库统一读层单测（cycle-60 R2）
 *
 * 覆盖：
 *  · 字段映射（pool 行 → naoku 同形题目：options/answer/dims/images/material/id 前缀）
 *  · 无臆造：缺失字段降级为空串/空数组，不用 0 冒充「无判定」
 *  · 崩溃安全：畸形 JSON（options/images）不抛错
 */
import { test, expect } from 'vitest'
import { poolRowToNaoku } from '../../dist/server/poolNaoku.js'

test('NAOKU-MAP-01 字段映射：answer→correctAnswer / dims / material / id 前缀 / source 真实源名', () => {
  const row = {
    id: 42, qid: '12100998', module: '判断推理', category: '图形推理', kadian: '数量规律',
    region: '甘肃', year: '2024', paper: '甘肃卷', stem: '从所给四个选项中选择',
    options: JSON.stringify({ A: '甲', B: '乙', C: '丙', D: '丁' }),
    answer: 'B', analysis: '元素组成相同', reasoning: '第1步', fastest: '⚡ 做和法',
    pitfalls: '- ⚠ 只看黑球', mother: '🧩 母题', group_material: '材料一', material_ref: 'MAT1',
    has_image: 1, images: JSON.stringify(['a.png']), qtype: 'single',
  }
  const q = poolRowToNaoku(row)
  expect(q.id).toBe('naoku-42')
  expect(q.qid).toBe('12100998')
  expect(q.options).toEqual({ A: '甲', B: '乙', C: '丙', D: '丁' })
  expect(q.answer).toBe('B')
  expect(q.correctAnswer).toBe('B')
  expect(q.reasoning).toBe('第1步')
  expect(q.fastest).toBe('⚡ 做和法')
  expect(q.pitfalls).toBe('- ⚠ 只看黑球')
  expect(q.mother).toBe('🧩 母题')
  expect(q.material).toBe('材料一')
  expect(q.materialRef).toBe('MAT1')
  expect(q.imgRefs).toEqual(['a.png'])
  expect(q.source).toBe('naoku')
})

test('NAOKU-MAP-02 无臆造/崩溃安全：缺字段与畸形 JSON 不抛错、降级为空', () => {
  const q = poolRowToNaoku({ id: 7, options: '{bad json', images: 'not-json' })
  expect(q.options).toEqual({})
  expect(q.imgRefs).toEqual([])
  expect(q.stem).toBe('')
  expect(q.answer).toBe('')
  expect(q.material).toBe('')
  expect(q.source).toBe('naoku')
})
