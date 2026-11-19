import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { previewToolResume } from './tool-resume'
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
function setup() {
  const resume = vi.fn()
  const c = previewToolResume(new Set(['read']), resume)
  const start = (id: string, name = 'read') =>
    c.event({
      type: 'response.output_item.added',
      response_id: 'r',
      item: { id, name, type: 'mcp_call' },
    })
  const output = (id: string) =>
    c.event({
      type: 'conversation.item.done',
      item: { type: 'mcp_call', id, output: 'ok' },
    })
  const done = () =>
    c.event({
      type: 'response.done',
      response: { id: 'r', status: 'completed' },
    })
  c.event({ type: 'response.created', response: { id: 'r' } })
  return { c, start, output, done, resume }
}
it('resumes once after a completed response and the entire read batch', () => {
  const x = setup()
  x.start('a')
  x.start('b')
  x.output('a')
  x.done()
  vi.runAllTimers()
  expect(x.resume).not.toHaveBeenCalled()
  x.output('b')
  x.output('a')
  vi.runAllTimers()
  x.output('b')
  vi.runAllTimers()
  expect(x.resume).toHaveBeenCalledTimes(1)
})
it.each([
  'input_audio_buffer.speech_started',
  'response.created',
  'input_audio_buffer.timeout_triggered',
])('discards stale results on %s', (type) => {
  const x = setup()
  x.start('a')
  x.done()
  x.output('a')
  x.c.event({ type, response: { id: 'new' } })
  x.start('delayed')
  x.output('delayed')
  vi.runAllTimers()
  expect(x.resume).not.toHaveBeenCalled()
})
it('does not speak again for an untracked or terminal action or after close', () => {
  const x = setup()
  x.start('a', 'end_call')
  x.output('a')
  x.output('unknown')
  x.done()
  vi.runAllTimers()
  expect(x.resume).not.toHaveBeenCalled()
  const y = setup()
  y.start('a')
  y.output('a')
  y.done()
  y.c.dispose()
  vi.runAllTimers()
  expect(y.resume).not.toHaveBeenCalled()
})

it('ignores a cancelled read and an automatic response started by the provider', () => {
  const x = setup()
  x.start('a')
  x.c.event({
    type: 'response.done',
    response: { id: 'r', status: 'cancelled' },
  })
  x.output('a')
  vi.runAllTimers()
  expect(x.resume).not.toHaveBeenCalled()
  const y = setup()
  y.start('b')
  y.done()
  y.output('b')
  y.c.event({ type: 'response.created', response: { id: 'provider' } })
  vi.runAllTimers()
  expect(y.resume).not.toHaveBeenCalled()
})
