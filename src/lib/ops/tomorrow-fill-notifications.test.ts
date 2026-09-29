import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getAllStaffSlots: vi.fn(),
  sendTelegramNotification: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/ops/staff-availability', () => ({
  getAllStaffSlots: mocks.getAllStaffSlots,
}))

vi.mock('@/lib/telegram', () => ({
  answerTelegramCallback: vi.fn(),
  clearTelegramActionButtons: vi.fn(),
  sendTelegramActionMessage: vi.fn(),
  sendTelegramNotification: mocks.sendTelegramNotification,
}))

import { recordTomorrowFillReply, scanTomorrowFill } from './tomorrow-fill'

describe('Tomorrow Fill notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stays quiet when tomorrow has no openings', async () => {
    mocks.getAllStaffSlots.mockResolvedValue([])

    const appointmentsQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    }
    appointmentsQuery.select.mockReturnValue(appointmentsQuery)
    appointmentsQuery.eq.mockReturnValue(appointmentsQuery)
    appointmentsQuery.in.mockReturnValue(appointmentsQuery)

    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tomorrow_fill_settings') {
          const query = {
            select: vi.fn(),
            eq: vi.fn(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { engine_enabled: true },
              error: null,
            }),
          }
          query.select.mockReturnValue(query)
          query.eq.mockReturnValue(query)
          return query
        }
        if (table === 'tomorrow_fill_campaigns') {
          const query = {
            select: vi.fn(),
            eq: vi.fn(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }
          query.select.mockReturnValue(query)
          query.eq.mockReturnValue(query)
          return query
        }
        if (table === 'ops_appointments') return appointmentsQuery
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await scanTomorrowFill({ targetDate: '2026-09-30' })

    expect(result).toMatchObject({
      skipped: true,
      reason: 'no_open_capacity',
      telegramSent: false,
    })
    expect(mocks.sendTelegramNotification).not.toHaveBeenCalled()
  })

  it('alerts the owner when a recipient opts out', async () => {
    const recipientQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      not: vi.fn(),
      gte: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'recipient-1',
          campaign_id: 'campaign-1',
          status: 'sent',
        },
        error: null,
      }),
    }
    recipientQuery.select.mockReturnValue(recipientQuery)
    recipientQuery.eq.mockReturnValue(recipientQuery)
    recipientQuery.not.mockReturnValue(recipientQuery)
    recipientQuery.gte.mockReturnValue(recipientQuery)
    recipientQuery.order.mockReturnValue(recipientQuery)
    recipientQuery.limit.mockReturnValue(recipientQuery)

    const updateEq = vi.fn().mockResolvedValue({ error: null })
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'sms_marketing_consents') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'tomorrow_fill_recipients') {
          return {
            ...recipientQuery,
            update: vi.fn(() => ({ eq: updateEq })),
          }
        }
        if (table === 'tomorrow_fill_events') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    await recordTomorrowFillReply({
      customerId: 'customer-1',
      phone: '(719) 555-0123',
      message: 'STOP',
      twilioSid: 'SM123',
    })

    expect(mocks.sendTelegramNotification).toHaveBeenCalledWith(
      expect.stringContaining('+17195550123 opted out'),
      { disablePreview: true },
    )
  })
})
