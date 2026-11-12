import { describe, expect, it, vi } from 'vitest'
import { getBookingAlertHistory } from './booking-alert-context'

function client(params: {
  priorCount?: number
  priorError?: Error
  sms?: {
    message_type: string
    sent_at: string | null
    created_at: string
  } | null
  smsError?: Error
}) {
  return {
    from(table: string) {
      const query: any = {
        select() {
          return query
        },
        eq() {
          return query
        },
        in() {
          return query
        },
        gte() {
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        async maybeSingle() {
          return {
            data: params.sms ?? null,
            error: params.smsError ?? null,
          }
        },
        then(resolve: (value: unknown) => void) {
          if (table !== 'ops_appointments') throw new Error('Unexpected query')
          resolve({
            count: params.priorCount ?? 0,
            error: params.priorError ?? null,
          })
        },
      }
      return query
    },
  } as any
}

describe('booking owner-alert context', () => {
  it('identifies a new customer with no tracked promotional text', async () => {
    await expect(
      getBookingAlertHistory({
        supabase: client({ priorCount: 0, sms: null }),
        customerId: 'customer',
        phone: '7202726871',
        now: new Date('2026-11-12T16:00:00Z'),
      }),
    ).resolves.toEqual({
      customerHistory: 'New customer — no prior appointments',
      recentSmsTouch: null,
    })
  })

  it('summarizes returning history and the latest tracked promotional text', async () => {
    await expect(
      getBookingAlertHistory({
        supabase: client({
          priorCount: 2,
          sms: {
            message_type: 'gap_outreach',
            sent_at: '2026-11-10T18:00:00Z',
            created_at: '2026-11-10T18:00:00Z',
          },
        }),
        customerId: 'customer',
        phone: '+17202726871',
        now: new Date('2026-11-12T16:00:00Z'),
      }),
    ).resolves.toEqual({
      customerHistory: 'Returning customer — 2 prior appointments',
      recentSmsTouch:
        'LIKELY: received a tracked schedule-gap offer text on Nov 10 (no exact booking-link match)',
    })
  })

  it('fails closed when the history lookups are unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      getBookingAlertHistory({
        supabase: client({
          priorError: new Error('history unavailable'),
          smsError: new Error('SMS unavailable'),
        }),
        customerId: 'customer',
        phone: '7202726871',
      }),
    ).resolves.toEqual({
      customerHistory: 'Unknown — history check unavailable',
      recentSmsTouch: null,
    })
    expect(consoleError).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })
})
