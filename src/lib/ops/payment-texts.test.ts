import { describe, expect, it } from 'vitest'
import {
  formatPaymentTextPhone,
  formatPaymentTextStamp,
  lastPaymentText,
  paymentTextSenderName,
  paymentTextTypeLabel,
} from './payment-texts'

describe('payment text history helpers', () => {
  it('labels Square and Venmo sends for the invoice card', () => {
    expect(paymentTextTypeLabel('square_payment_link')).toBe('Square Pay')
    expect(paymentTextTypeLabel('venmo_payment_link')).toBe('Venmo Pay')
  })

  it('formats US phones the way techs already read them', () => {
    expect(formatPaymentTextPhone('+17603155411')).toBe('(760) 315-5411')
    expect(formatPaymentTextPhone('7603155411')).toBe('(760) 315-5411')
  })

  it('picks the latest send for a provider', () => {
    const last = lastPaymentText(
      [
        {
          id: 'failed',
          message_type: 'square_payment_link',
          recipient_phone: '+17603155411',
          status: 'failed',
          twilio_sid: null,
          sent_at: '2026-08-24T20:10:00.000Z',
          sent_by: 'David',
        },
        {
          id: 'ok',
          message_type: 'square_payment_link',
          recipient_phone: '+17603155411',
          status: 'sent',
          twilio_sid: 'SM123',
          sent_at: '2026-08-24T20:05:00.000Z',
          sent_by: 'David',
        },
        {
          id: 'venmo',
          message_type: 'venmo_payment_link',
          recipient_phone: '+17603155411',
          status: 'sent',
          twilio_sid: 'SM456',
          sent_at: '2026-08-24T20:00:00.000Z',
          sent_by: 'David',
        },
      ],
      'square_payment_link',
    )
    expect(last?.id).toBe('failed')
  })

  it('prefers the staff display name so David shows as David', () => {
    expect(
      paymentTextSenderName({
        email: 'david@example.com',
        staff: { display_name: 'David' },
      }),
    ).toBe('David')
  })

  it('formats a send timestamp', () => {
    expect(formatPaymentTextStamp('2026-08-24T20:12:00.000Z')).toMatch(/Aug 24/)
  })
})
