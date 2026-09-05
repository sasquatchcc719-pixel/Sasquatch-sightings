// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  strictSend: vi.fn(),
  legacySend: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/twilio', () => ({
  sendCustomerSMSWithResult: mocks.strictSend,
  sendCustomerSMS: mocks.legacySend,
}))
vi.mock('@/lib/blacklist', () => ({
  isBlacklisted: vi.fn().mockResolvedValue(false),
  normalizePhone: (phone: string) => phone,
}))
import { sendOpsLifecycleCommunications } from './communications'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.strictSend.mockResolvedValue({ sid: 'mock-sid' })
  mocks.db.mockReturnValue({
    from: (table: string) => {
      const result = {
        data:
          table === 'ops_communication_templates'
            ? [
                {
                  template_key: 'on_my_way_estimate_sms',
                  channel: 'sms',
                  is_enabled: true,
                  body_template:
                    '{{tech_name}} is on the way for your estimate.',
                },
              ]
            : null,
        error: null,
      }
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'estimate-a',
            kind: 'estimate',
            customer_id: 'customer-a',
            appointment_date: '2026-09-04',
            start_time: '10:00',
            end_time: '11:00',
            assigned_staff_user_id: 'staff-a',
            ops_customers: { first_name: 'Customer', phone: '+15005550006' },
            ops_appointment_line_items: [],
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { display_name: 'Charles' },
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      }
      return builder
    },
  })
})
describe('estimate arrival SMS confirmation', () => {
  it('requires a confirmed provider send, with estimate wording', async () => {
    const result = await sendOpsLifecycleCommunications({
      event: 'on_my_way',
      appointmentId: 'estimate-a',
    })
    expect(mocks.strictSend).toHaveBeenCalledWith(
      '+15005550006',
      'Charles is on the way for your estimate.',
      undefined,
      'ops_on_my_way_estimate_sms',
      process.env.TWILIO_PHONE_NUMBER,
    )
    expect(mocks.legacySend).not.toHaveBeenCalled()
    expect(result.sent).toEqual([
      expect.objectContaining({ actually_sent: true, channel: 'sms' }),
    ])
  })
  it('propagates provider rejection instead of reporting a successful text', async () => {
    mocks.strictSend.mockRejectedValue(new Error('Provider rejected message'))
    await expect(
      sendOpsLifecycleCommunications({
        event: 'on_my_way',
        appointmentId: 'estimate-a',
      }),
    ).rejects.toThrow('Provider rejected message')
  })
})
