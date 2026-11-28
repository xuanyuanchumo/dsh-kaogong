/**
 * ai-bridge.test.mjs — 宿主 AI 桥单测（issue #4 阶段 4）
 *
 * 覆盖 collectText：text-delta 拼接 / reasoning 忽略 / finish 错误（reason 对象 + 旧 kind 双形状）。
 * 这是 M1 修复的回归守卫——确保「真实模型 finish 错误」不会被静默吞掉变成空文本。
 */
import { test, expect } from 'vitest'
import { collectText } from '../../dist/host/ai-bridge.js'

const stream = (chunks) => (async function* () { for (const c of chunks) yield c })()

test('BRIDGE-01 只拼 text-delta，忽略 reasoning-delta/tool/usage', async () => {
  const out = await collectText(stream([
    { type: 'text-delta', index: 0, text: '{"stem":' },
    { type: 'reasoning-delta', index: 1, text: '思考过程不应出现' },
    { type: 'usage', usage: {} },
    { type: 'text-delta', index: 0, text: '"题干"}' },
    { type: 'finish', reason: 'stop' },
  ]))
  expect(out).toBe('{"stem":"题干"}')
  expect(out).not.toContain('思考过程')
})

test('BRIDGE-02 finish.reason={kind:error,failure} 必须抛错（权威形状）', async () => {
  await expect(collectText(stream([
    { type: 'text-delta', index: 0, text: '部分文本' },
    { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '限流' } } },
  ]))).rejects.toThrow('RATE_LIMIT')
})

test('BRIDGE-03 finish.reason=aborted 必须抛错', async () => {
  await expect(collectText(stream([
    { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED' } } },
  ]))).rejects.toThrow('ABORTED')
})

test('BRIDGE-04 兼容旧顶层 kind/failure 形态（KB prose 形态）', async () => {
  await expect(collectText(stream([
    { type: 'finish', kind: 'error', failure: { code: 'AUTH' } },
  ]))).rejects.toThrow('AUTH')
})

test('BRIDGE-05 正常 stop 不抛错', async () => {
  const out = await collectText(stream([{ type: 'text-delta', index: 0, text: 'ok' }, { type: 'finish', reason: 'stop' }]))
  expect(out).toBe('ok')
})
