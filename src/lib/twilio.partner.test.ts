// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
}))

vi.mock('twilio', () => ({
  default: () => ({ messages: { create: mocks.create } }),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

vi.mock('@/lib/blacklist', () => ({
  isBlacklisted: vi.fn(),
  notifyBlockedAttempt: vi.fn(),
}))

describe('sendPartnerSMS acceptance result', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'test-account')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    vi.stubEnv('TWILIO_PHONE_NUMBER', '+17195550100')
    mocks.insert.mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ insert: mocks.insert })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns true and logs the partner only after provider acceptance', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM-accepted' })
    const { sendPartnerSMS } = await import('./twilio')

    const accepted = await sendPartnerSMS(
      '+17195550101',
      'Test message',
      'partner-1',
      'station_health',
    )

    expect(accepted).toBe(true)
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        partner_id: 'partner-1',
        message_type: 'station_health',
        twilio_sid: 'SM-accepted',
        status: 'sent',
      }),
    )
  })

  it('returns false and logs failure when the provider rejects the SMS', async () => {
    mocks.create.mockRejectedValue(new Error('provider rejection'))
    const { sendPartnerSMS } = await import('./twilio')

    const accepted = await sendPartnerSMS(
      '+17195550101',
      'Test message',
      'partner-1',
      'station_health',
    )

    expect(accepted).toBe(false)
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        partner_id: 'partner-1',
        message_type: 'station_health',
        status: 'failed',
      }),
    )
  })
})
