import { describe, expect, it } from 'vitest'
import {
  classifyCallOutcome,
  parseDialCallDuration,
  wasForwardedCallHandled,
} from './call-outcome'

describe('forwarded call outcome', () => {
  it('uses connection status, never a duration threshold, to classify forwarding', () => {
    expect(wasForwardedCallHandled('completed')).toBe(true)
    expect(classifyCallOutcome('completed')).toBe('answered')
    expect(classifyCallOutcome(' ANSWERED ')).toBe('answered')
  })

  it.each(['', 'failed', 'no-answer', 'busy', 'canceled'])(
    'does not invent a voicemail for %s',
    (status) => {
      expect(classifyCallOutcome(status)).toBe('no-answer')
    },
  )

  it('parses Twilio duration fields safely', () => {
    expect(parseDialCallDuration('10')).toBe(10)
    expect(parseDialCallDuration('')).toBeNull()
    expect(parseDialCallDuration(null)).toBeNull()
  })
})
