import { afterEach, expect, it, vi } from 'vitest'
import { openingGuard } from './preview-opening'
import {
  dispatcherInstructions,
  previewOpening,
  previewCallbacksLocal,
  testProfile,
  testVoice,
  turnDetector,
} from './preview-profile'
import { phoneInstructions } from './engine'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

it('requires an isolated environment and a pilot call', () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-medium')
  vi.stubEnv('VERCEL_ENV', 'production')
  expect(testProfile(true)).toBe('current')
  vi.stubEnv('VERCEL_ENV', 'preview')
  expect(testProfile(false)).toBe('current')
  expect(testProfile(true)).toBe('dispatcher-medium')
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'invalid')
  expect(testProfile(true)).toBe('current')
})
it('uses disjoint server and semantic schemas and holds voice fixed for detector trials', () => {
  const common = { create_response: true, interrupt_response: true }
  expect(turnDetector('dispatcher-server')).toEqual({
    ...common,
    type: 'server_vad',
    silence_duration_ms: 500,
    idle_timeout_ms: 12000,
  })
  expect(turnDetector('detector-medium')).toEqual({
    ...common,
    type: 'semantic_vad',
    eagerness: 'medium',
  })
  expect(turnDetector('detector-low')).toEqual({
    ...common,
    type: 'semantic_vad',
    eagerness: 'low',
  })
  vi.stubEnv('HARRY_VOICE_TEST_VOICE', 'echo')
  expect(testVoice('detector-medium')).toBe('cedar')
  expect(testVoice('dispatcher-server')).toBe('echo')
  vi.stubEnv('HARRY_VOICE_TEST_VOICE', 'unknown')
  expect(testVoice('dispatcher-low')).toBe('cedar')
})
it('reserves the exact opening for its one-shot trigger', () => {
  expect(previewOpening).toContain('nothing will be booked')
  expect(dispatcherInstructions([])).not.toContain(previewOpening)
  expect(dispatcherInstructions([])).toContain('The opening plays once')
  expect(phoneInstructions(false)).not.toContain('The opening plays once')
})
it.each([
  'input_audio_buffer.speech_started',
  'input_audio_buffer.committed',
  'response.created',
])('yields the opening to %s', (type) => {
  vi.useFakeTimers()
  const send = vi.fn(),
    finish = vi.fn()
  const guard = openingGuard(send, finish)
  guard.event('connected')
  vi.advanceTimersByTime(220)
  guard.event(type)
  guard.event('session.updated')
  vi.runAllTimers()
  expect(send).not.toHaveBeenCalled()
  expect(finish).toHaveBeenCalledOnce()
})
it('opens once after the grace period, and disposes on disconnect', () => {
  vi.useFakeTimers()
  const send = vi.fn()
  for (const disconnected of [true, false]) {
    const guard = openingGuard(send, vi.fn())
    guard.event('connected')
    guard.event('session.created')
    if (disconnected) guard.dispose()
    vi.runAllTimers()
    guard.event('session.updated')
    vi.runAllTimers()
  }
  expect(send).toHaveBeenCalledOnce()
})

it('rejects production and cross-environment callback destinations', () => {
  const prod = 'https://sightings.sasquatchcarpet.com'
  const staging = 'https://test.example.com'
  expect(previewCallbacksLocal(staging, prod)).toBe(false)
  expect(previewCallbacksLocal(prod, prod)).toBe(false)
  expect(previewCallbacksLocal(staging + '/incoming', staging)).toBe(true)
})

it('distinguishes a coupon never submitted from a rejection', async () => {
  const { previewToolResult } = await import('./preview-profile')
  const price = { total: 240, coupon: { code: null, amount: 0 } }
  expect(previewToolResult('phone_quote', price)).toMatchObject({
    ...price,
    price_guidance: expect.stringContaining('No coupon was submitted'),
  })
  expect(
    previewToolResult('phone_quote', {
      total: 205,
      coupon: { code: 'THANKS35', amount: 35 },
    }),
  ).toMatchObject({
    total: 205,
    price_guidance: expect.stringContaining('returned coupon decision'),
  })
})
it('attaches the date of the verified slot and preserves actual failures', async () => {
  const { previewToolResult } = await import('./preview-profile')
  const wed = { date: '2099-12-02', times: ['14:30'] }
  expect(previewToolResult('phone_quoted_openings', wed)).toMatchObject({
    verified_opening: { date: wed.date, time: '14:30' },
  })
  expect(previewToolResult('phone_openings', { error: 'timeout' })).toEqual({
    error: 'timeout',
  })
})

it('keeps a verified coupon distinct from a final price when attribution is missing', async () => {
  const { previewToolResult } = await import('./preview-profile')
  expect(
    previewToolResult('phone_quote', {
      status: 'standard_estimate',
      total: 205,
      coupon: { code: 'THANKS35', amount: 35 },
    }),
  ).toMatchObject({
    total: 205,
    price_guidance: expect.stringContaining('Standard estimate only'),
  })
})
