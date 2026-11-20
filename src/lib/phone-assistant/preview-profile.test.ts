import { afterEach, expect, it, vi } from 'vitest'
import { liveVoiceEnabled } from './live-preview'
import { dispatcherInstructions, previewToolResult } from './preview-profile'

afterEach(() => vi.unstubAllEnvs())

it('uses GPT Live for matching production calls and private preview calls only', () => {
  const base = 'https://sightings.example.com'
  vi.stubEnv('VERCEL_ENV', 'production')
  expect(liveVoiceEnabled(false, base + '/incoming', base)).toBe(true)
  expect(liveVoiceEnabled(true, base + '/incoming', base)).toBe(true)
  expect(
    liveVoiceEnabled(true, 'https://elsewhere.example/incoming', base),
  ).toBe(false)

  vi.stubEnv('VERCEL_ENV', 'preview')
  expect(liveVoiceEnabled(true, base + '/incoming', base)).toBe(true)
  expect(liveVoiceEnabled(false, base + '/incoming', base)).toBe(false)
})

it('keeps simulated and future public action claims distinct', () => {
  expect(dispatcherInstructions([], '', true)).toContain('simulated booking')
  expect(dispatcherInstructions([], '', false)).not.toContain(
    'simulated booking',
  )
  expect(dispatcherInstructions([], '', false)).toContain(
    'unless the tool confirms it succeeded',
  )
})

it('distinguishes a coupon never submitted from a rejection', () => {
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

it('attaches the verified slot date and preserves actual failures', () => {
  const wed = { date: '2099-12-02', times: ['14:30'] }
  expect(previewToolResult('phone_quoted_openings', wed)).toMatchObject({
    verified_opening: { date: wed.date, time: '14:30' },
  })
  expect(previewToolResult('phone_openings', { error: 'timeout' })).toEqual({
    error: 'timeout',
  })
})

it('keeps a verified coupon provisional when attribution is missing', () => {
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

it('turns a missing final source into one recoverable question', () => {
  expect(
    previewToolResult('phone_preview_booking', {
      error: 'Confirm the lead source and final price before booking.',
    }),
  ).toMatchObject({
    required_next_step: expect.stringContaining('How did you hear about us?'),
  })
})
