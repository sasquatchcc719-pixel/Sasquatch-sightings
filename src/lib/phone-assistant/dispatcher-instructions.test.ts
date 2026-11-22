import { afterEach, expect, it, vi } from 'vitest'
import { liveVoiceEnabled, liveVoiceSession } from './live-session'
import { coachingTopics } from './coaching'
import {
  dispatcherInstructions,
  dispatcherToolResult,
} from './dispatcher-instructions'

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
  expect(dispatcherToolResult('phone_quote', price)).toMatchObject({
    ...price,
    price_guidance: expect.stringContaining('No coupon was submitted'),
  })
  expect(
    dispatcherToolResult('phone_quote', {
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
  expect(dispatcherToolResult('phone_quoted_openings', wed)).toMatchObject({
    verified_opening: { date: wed.date, time: '14:30' },
  })
  expect(dispatcherToolResult('phone_openings', { error: 'timeout' })).toEqual({
    error: 'timeout',
  })
})

it('keeps a verified coupon provisional when attribution is missing', () => {
  expect(
    dispatcherToolResult('phone_quote', {
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
    dispatcherToolResult('phone_preview_booking', {
      error: 'Confirm the lead source and final price before booking.',
    }),
  ).toMatchObject({
    required_next_step: expect.stringContaining('How did you hear about us?'),
  })
})

it('keeps recognition separate from verification and asks for disambiguation only when needed', () => {
  for (const pilot of [true, false]) {
    const prompt = dispatcherInstructions([], '', pilot)
    expect(prompt).toContain('grants no staff privileges')
    expect(prompt).toContain('spell it once')
    expect(prompt).toContain('email only to resolve that ambiguity')
    expect(prompt).toContain('Never suggest a candidate surname or email')
  }
})

it.each([false, true])(
  'starts the returning-caller lookup silently with first name and numbered street in GPT Live and its delegate (private=%s)',
  (pilot) => {
    const session = liveVoiceSession(
      [],
      coachingTopics.lookup_wait.reminder,
      {
        server_url: 'https://sightings.example.com/api/phone-assistant/tools',
        authorization: 'test',
        allowed_tools: ['phone_caller_lookup'],
      },
      { firstName: 'Charlie' },
      pilot,
    )
    for (const prompt of [
      session.instructions,
      session.delegation.responses.instructions,
    ]) {
      expect(prompt).toContain(
        'silently run phone_caller_lookup in the same turn',
      )
      expect(prompt).toContain('first_name and street')
      expect(prompt).toContain(
        'Do not wait for the surname, city, ZIP, unit or email',
      )
      expect(prompt).toContain(
        'reuse the returned city, zip_code, customer_ref and service_address_ref',
      )
      expect(prompt).toContain('Never ask the caller to repeat')
      expect(prompt).toContain('needs_unit_confirmation ask for the unit')
      expect(prompt).toContain(
        'needs_name_confirmation ask for the family name',
      )
      expect(prompt).toContain(
        'missing_field is city, or the ZIP when missing_field is zip_code',
      )
      expect(prompt).toContain(
        'For needs_email_confirmation ask for the caller’s spelled email only',
      )
      expect(prompt).toContain('Do you have my info?”')
      expect(prompt).toContain('answer once and stop')
      expect(prompt).toContain(
        'Do not start booking intake, ask another question',
      )
      expect(prompt).not.toMatch(
        /ask for the (?:service )?city and ZIP|say “(?:just a|one) moment”|short hold line/i,
      )
    }
  },
)

it.each([true, false])(
  'offers one saved street only after the named greeting is accepted (pilot=%s)',
  (pilot) => {
    const mcp = {
      server_url: 'https://sightings.example.com/tools',
      authorization: 'test',
      allowed_tools: ['phone_usual_address', 'phone_caller_lookup'],
    }
    const known = liveVoiceSession([], '', mcp, { firstName: 'Charles' }, pilot)
    expect(known.input[0].content[0].text).toContain(
      'Harry here. Is this Charles?',
    )
    expect(known.input[0].content[0].text).toContain(
      'proceed directly to the usual-street lookup',
    )
    for (const prompt of [
      known.instructions,
      known.delegation.responses.instructions,
    ]) {
      expect(prompt).toContain(
        'wait for an explicit yes to the first name Harry proposed',
      )
      expect(prompt).toContain(
        'silently call phone_usual_address with first_name and first_name_confirmed=true',
      )
      expect(prompt).toContain(
        'confirm_saved_street, ask once: “Is this for [saved street]?”',
      )
      expect(prompt).toContain(
        'If the caller accepts that street, silently call phone_caller_lookup',
      )
      expect(prompt).toContain(
        'If they correct the street, use their correction instead',
      )
      expect(prompt).toContain(
        'already gave a numbered service street, skip the saved-street offer',
      )
      expect(prompt).toContain('Never offer a second saved street')
      expect(prompt).toContain('on a shared number, or for a closing thank-you')
    }
    for (const caller of [null, { firstName: null }]) {
      const other = liveVoiceSession([], '', mcp, caller, pilot)
      expect(other.input[0].content[0].text).toContain(
        'Do not offer a saved street',
      )
    }
  },
)

it('keeps a verified booking number out of an unsolicited spoken confirmation', () => {
  const session = liveVoiceSession(
    [],
    '',
    {
      server_url: 'https://example.com/tools',
      authorization: 'test',
      allowed_tools: ['phone_book_service'],
    },
    null,
    false,
  )
  for (const prompt of [
    session.instructions,
    session.delegation.responses.instructions,
  ]) {
    expect(prompt).toContain(
      'After a verified booking, confirm the saved day and time',
    )
    expect(prompt).toContain('The office finds appointments by customer name')
  }
})
