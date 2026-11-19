import { afterEach, expect, it, vi } from 'vitest'
import { openingGuard } from './preview-opening'
import {
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
  expect(phoneInstructions(true, true)).not.toContain(previewOpening)
  expect(phoneInstructions(true, true)).toContain('Never repeat the opening')
  expect(phoneInstructions(false)).not.toContain('Never repeat the opening')
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
