import { describe, expect, it } from 'vitest'
import { calculateAiStyleBookingDiscount } from './create-ai-style-booking'

const promo = { enabled: true, discount: 20, minimum: 220 }

describe('calculateAiStyleBookingDiscount', () => {
  it('does not auto-apply the promo to Rabecca bookings', () => {
    expect(
      calculateAiStyleBookingDiscount({
        booking_channel: 'retell_rabecca',
        subtotal: 300,
        promo,
      }),
    ).toBe(0)
  })

  it('applies the promo to Rabecca only when the caller asked for it', () => {
    expect(
      calculateAiStyleBookingDiscount({
        booking_channel: 'retell_rabecca',
        subtotal: 300,
        promo,
        discount_requested: true,
      }),
    ).toBe(20)
  })

  it('keeps the existing automatic promo behavior for non-Rabecca channels', () => {
    expect(
      calculateAiStyleBookingDiscount({
        booking_channel: 'ai_agent',
        subtotal: 300,
        promo,
      }),
    ).toBe(20)
  })
})
