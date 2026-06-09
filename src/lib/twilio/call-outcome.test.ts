import { describe, expect, it } from 'vitest'
import {
  classifyCallOutcome,
  parseDialCallDuration,
  wasForwardedCallHandled,
} from './call-outcome'

describe('forwarded call outcome', () => {
  it('treats a five-second completed forwarding leg as missed', () => {
    expect(wasForwardedCallHandled('completed', 5)).toBe(false)
    expect(classifyCallOutcome('completed', 5)).toBe('no-answer')
  })

  it('treats a sustained completed forwarding leg as answered', () => {
    expect(wasForwardedCallHandled('completed', 45)).toBe(true)
    expect(classifyCallOutcome('completed', 45)).toBe('answered')
  })

  it('keeps a completed call conservative when duration is unavailable', () => {
    expect(wasForwardedCallHandled('completed', null)).toBe(true)
    expect(classifyCallOutcome('completed', null)).toBe('answered')
  })

  it('treats missing dial status as voicemail', () => {
    expect(classifyCallOutcome('', null)).toBe('voicemail')
  })

  it('parses Twilio duration fields safely', () => {
    expect(parseDialCallDuration('10')).toBe(10)
    expect(parseDialCallDuration('')).toBeNull()
    expect(parseDialCallDuration(null)).toBeNull()
  })
})
