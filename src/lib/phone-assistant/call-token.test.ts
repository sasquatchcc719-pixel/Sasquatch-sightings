import { afterEach, expect, it, vi } from 'vitest'
import { issueCallToken, verifyCallToken } from './call-token'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
it('binds short-lived SIP invites to one call and separates MCP credentials', () => {
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'test-secret')
  vi.useFakeTimers()
  const sid = 'CA' + 'a'.repeat(32)
  const purpose = 'live-invite:https://example.com'
  const invite = issueCallToken(sid, purpose)
  expect(verifyCallToken(invite, purpose)).toBe(sid)
  expect(verifyCallToken(invite, 'tools')).toBeNull()
  expect(
    verifyCallToken(invite.replace(sid, 'CA' + 'b'.repeat(32)), purpose),
  ).toBeNull()
  vi.advanceTimersByTime(121000)
  expect(verifyCallToken(invite, purpose)).toBeNull()
})
