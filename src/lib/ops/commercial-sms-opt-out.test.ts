import { describe, expect, it, vi } from 'vitest'
import {
  isCommercialSmsOptOut,
  recordCommercialSmsOptOut,
} from './commercial-sms'

describe('commercial scheduling SMS opt-out', () => {
  it('recognizes Twilio and standard reply opt-outs', () => {
    expect(isCommercialSmsOptOut('anything', 'STOP')).toBe(true)
    expect(isCommercialSmsOptOut('unsubscribe')).toBe(true)
    expect(isCommercialSmsOptOut('Please stop by tomorrow')).toBe(false)
  })

  it('records a matching opted-in portal number as opted out', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        scheduling_sms_phone: '+17195550100',
        scheduling_sms_enabled: true,
      },
      error: null,
    })
    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle,
      })),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    }

    await expect(
      recordCommercialSmsOptOut(db as never, {
        customerId: 'customer-a',
        phone: '+1 (719) 555-0100',
        message: 'STOP',
      }),
    ).resolves.toBe(true)
    expect(db.rpc).toHaveBeenCalledWith('set_commercial_sms_preference', {
      p_customer_id: 'customer-a',
      p_user_id: null,
      p_phone: '+17195550100',
      p_enabled: false,
      p_consent_text: '',
      p_source: 'customer_reply',
      p_ip_address: null,
      p_user_agent: 'Twilio inbound SMS',
    })
  })
})
