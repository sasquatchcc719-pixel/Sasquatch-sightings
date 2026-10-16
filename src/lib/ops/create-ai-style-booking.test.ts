import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ blacklist: vi.fn() }))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklist }))
import {
  calculateAiStyleBookingDiscount,
  createAiStyleBooking,
} from './create-ai-style-booking'

const promo = { enabled: true, discount: 20, minimum: 220 }

describe('AI-style booking blacklist enforcement', () => {
  it.each([false, true])(
    'rejects blacklisted customers before records or notifications (preview: %s)',
    async (previewOnly) => {
      mocks.blacklist.mockResolvedValue(true)
      const from = vi.fn()

      const result = await createAiStyleBooking({
        supabase: { from } as never,
        customer: {
          first_name: 'Blocked',
          last_name: 'Customer',
          email: 'customer@example.com',
          phone: '+17195550123',
        },
        address: {
          street_1: '123 Main St',
          city: 'Colorado Springs',
          state: 'CO',
          zip_code: '80903',
        },
        appointment_date: '2026-10-20',
        start_time: '09:00',
        line_items: [{ service_id: 'carpet', quantity: 1 }],
        booking_mode: 'direct',
        booking_channel: 'ai_agent',
        source_label: 'Scout Website Chat',
        lead_source: 'google',
        actor_label: 'Scout Web',
        admin_heading: 'Scout website booking',
        preview_only: previewOnly,
      })

      expect(result).toEqual({
        ok: false,
        error: 'We are unable to accept this booking.',
      })
      expect(mocks.blacklist).toHaveBeenCalledWith('+17195550123')
      expect(from).not.toHaveBeenCalled()
    },
  )
})

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
