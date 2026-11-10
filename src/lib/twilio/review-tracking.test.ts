// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  insert: vi.fn(),
  blacklisted: vi.fn(),
}))
vi.mock('twilio', () => ({
  default: () => ({ messages: { create: mocks.create } }),
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}))
vi.mock('@/lib/blacklist', () => ({
  isBlacklisted: mocks.blacklisted,
  notifyBlockedAttempt: vi.fn(),
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC' + '1'.repeat(32))
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'offline-test-token')
  vi.stubEnv('TWILIO_PHONE_NUMBER', '+17195550101')
  vi.stubEnv('TWILIO_MESSAGING_SERVICE_SID', '')
  mocks.create.mockResolvedValue({ sid: 'SM' + '2'.repeat(32) })
  mocks.insert.mockResolvedValue({ error: null })
  mocks.blacklisted.mockResolvedValue(false)
})
afterEach(() => vi.unstubAllEnvs())
describe('review-only tracking options in the shared SMS helper', () => {
  it('keeps ordinary messages and existing sender behavior unchanged', async () => {
    const { sendCustomerSMSWithResult } = await import('../twilio')
    await sendCustomerSMSWithResult('7195550100', 'Existing content')
    expect(mocks.create).toHaveBeenCalledWith({
      body: 'Existing content',
      from: '+17195550101',
      to: '+17195550100',
    })
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({
      status: 'sent',
      customer_id: null,
    })
  })
  it('preserves the existing gap outreach callback', async () => {
    const { sendCustomerSMSWithResult } = await import('../twilio')
    await sendCustomerSMSWithResult(
      '7195550100',
      'Existing content',
      undefined,
      'gap_outreach',
      undefined,
      { gapOutreachRecipientId: 'gap-id' },
    )
    expect(mocks.create.mock.calls[0][0].statusCallback).toBe(
      'https://sightings.sasquatchcarpet.com/api/twilio/gap-status?recipient=gap-id',
    )
  })
  it.each([false, true])(
    'opts reviews into correlation and accepted status (messaging service: %s)',
    async (useService) => {
      if (useService)
        vi.stubEnv('TWILIO_MESSAGING_SERVICE_SID', 'MG' + '3'.repeat(32))
      const { sendCustomerSMSWithResult } = await import('../twilio')
      await sendCustomerSMSWithResult(
        '7195550100',
        'Approved copy',
        undefined,
        'review_request',
        undefined,
        { customerId: 'customer-id', reviewRequestId: 'request-id' },
      )
      expect(mocks.create.mock.calls[0][0]).toMatchObject({
        body: 'Approved copy',
        to: '+17195550100',
        statusCallback:
          'https://sightings.sasquatchcarpet.com/api/twilio/review-status?request=request-id',
      })
      expect(mocks.insert.mock.calls[0][0]).toMatchObject({
        customer_id: 'customer-id',
        twilio_sid: 'SM' + '2'.repeat(32),
        status: 'accepted',
        message_type: 'review_request',
      })
      if (useService)
        expect(mocks.create.mock.calls[0][0]).toHaveProperty(
          'messagingServiceSid',
          'MG' + '3'.repeat(32),
        )
    },
  )
  it('retains the shared blacklist guard', async () => {
    const { sendCustomerSMSWithResult } = await import('../twilio')
    mocks.blacklisted.mockResolvedValue(true)
    await expect(
      sendCustomerSMSWithResult(
        '7195550100',
        'Blocked',
        undefined,
        'review_request',
        undefined,
        { reviewRequestId: 'request-id' },
      ),
    ).rejects.toThrow('blacklisted')
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
