// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  planGaps,
  digest,
  rankGapCandidates,
  type Calendar,
  type GapCustomer,
} from './gap-planning'
import { calculateGapOffer, type GapOfferTerms } from './gap-offer'
const calendar: Calendar = {
  date: '2026-10-27',
  staff_id: 'staff',
  staff_name: 'David',
  open: true,
  templates: [
    {
      day_of_week: 2,
      start_time: '09:00',
      end_time: '18:00',
      slot_interval_minutes: 120,
      is_active: true,
    },
  ],
  overrides: [],
  events: [],
  appointments: [
    {
      id: 'denise',
      zip: '80923',
      appointment_date: '2026-10-27',
      start_time: '09:00',
      end_time: '10:00',
      status: 'booked',
    },
    {
      id: 'donna',
      zip: '80132',
      appointment_date: '2026-10-27',
      start_time: '13:00',
      end_time: '15:00',
      status: 'booked',
    },
  ],
}
const gap = planGaps(calendar, 180)[0]
const now = new Date('2026-10-25T12:00:00Z')
const settings = {
  dormancy_months: 8,
  customer_cooldown_days: 14,
  unanswered_limit: 4,
  rest_days: 60,
}
const customer: GapCustomer = {
  id: 'customer',
  name: 'Past Customer',
  phone: '7195550100',
  internal: false,
  commercial: false,
  address: {
    id: 'address',
    street: '1 Main',
    city: 'Monument',
    zip: '80132',
    latitude: null,
    longitude: null,
    geocode_source: null,
  },
  history: [
    {
      source: 'operations',
      record_id: 'pastjob',
      date: '2024-01-01',
      date_kind: 'completed_service',
      verified: true,
      duration_minutes: 180,
      value: 400,
    },
  ],
  contacts: [],
  conversation_id: null,
  conversation_updated_at: null,
  blocked: false,
  do_not_contact: false,
  future_booking: false,
  unresolved_job: false,
  open_estimate: false,
  consent: {
    status: 'opted_in',
    source: 'signed_consent',
    consented_at: '2024-01-01T00:00:00Z',
    disclosure: 'Marketing SMS approved',
  },
}
function rank(c: Partial<GapCustomer> = {}) {
  return rankGapCandidates([{ ...customer, ...c }], gap, now, settings)
    .candidates[0]
}
describe('gap-first planning without schedule changes', () => {
  it('keeps approval hashes stable across JSONB object ordering but not recipient ordering', () => {
    expect(digest({ gap: { z: 1, a: 2 }, recipients: ['one', 'two'] })).toBe(
      digest({ recipients: ['one', 'two'], gap: { a: 2, z: 1 } }),
    )
    expect(digest({ recipients: ['one', 'two'] })).not.toBe(
      digest({ recipients: ['two', 'one'] }),
    )
  })
  it('fits the whole three-hour Tuesday gap and preserves both anchors', () => {
    const before = JSON.stringify(calendar)
    expect(gap).toMatchObject({
      start_time: '10:00:00',
      end_time: '13:00:00',
      minutes: 180,
      internal: true,
      before: { id: 'denise' },
      after: { id: 'donna' },
    })
    expect(gap.slots).toContainEqual({
      start_time: '10:00:00',
      end_time: '13:00:00',
    })
    expect(JSON.stringify(calendar)).toBe(before)
  })
  it('does not count overlapping two-hour alternatives as separate gaps', () => {
    const gaps = planGaps(calendar, 120)
    expect(gaps.filter((g) => g.internal)).toHaveLength(1)
    expect(gaps[0].minutes).toBe(180)
    expect(gaps[0].slots).toHaveLength(2)
  })
  it('allows a non-adjacent customer-requested time that fits', () =>
    expect(planGaps(calendar, 120, '15:30')[1].slots).toContainEqual({
      start_time: '15:30:00',
      end_time: '17:30:00',
    }))
  it('rejects full-duration conflicts and closed staff, without extra travel buffers', () => {
    expect(planGaps(calendar, 240)).toEqual([])
    expect(planGaps({ ...calendar, open: false }, 120)).toEqual([])
    expect(planGaps(calendar, 180)[0].start_time).toBe('10:00:00')
  })
  it('keeps a five-hour continuous opening distinct from requested job duration', () =>
    expect(
      planGaps(
        { ...calendar, appointments: calendar.appointments.slice(0, 1) },
        120,
      )[0].minutes,
    ).toBe(480))
  it('honors multi-day blocking events', () =>
    expect(
      planGaps(
        {
          ...calendar,
          events: [
            {
              start_date: '2026-10-26',
              end_date: '2026-10-28',
              start_time: '12:00',
              end_time: '12:00',
              is_all_day: false,
              event_kind: 'block',
            },
          ],
        },
        120,
      ),
    ).toEqual([]))
})
describe('eligible oldest customers with evidence', () => {
  it('does not manufacture consent from existing-customer status', () =>
    expect(
      rank({
        consent: {
          status: 'opted_in',
          source: 'existing_customer_terms',
          consented_at: null,
          disclosure: 'assumed',
        },
      }).exclusions,
    ).toContain('consent_unverified'))
  it('blocks opt-outs, jobs, do-not-contact, and latest inbound reply', () => {
    expect(
      rank({ consent: { ...customer.consent!, status: 'opted_out' } })
        .exclusions,
    ).toContain('opted_out')
    expect(rank({ future_booking: true }).exclusions).toContain(
      'future_booking',
    )
    expect(rank({ unresolved_job: true }).exclusions).toContain(
      'unresolved_job',
    )
    expect(rank({ do_not_contact: true }).exclusions).toContain(
      'do_not_contact',
    )
    expect(
      rank({
        contacts: [
          {
            channel: 'sms',
            at: '2026-10-24T00:00:00Z',
            source_id: 'reply',
            direction: 'inbound',
          },
        ],
      }).exclusions,
    ).toContain('reply_requires_owner_review')
  })
  it('uses actual send date for cooldown across email and SMS', () => {
    for (const channel of ['sms', 'email', 'conversation'])
      expect(
        rank({
          contacts: [
            {
              channel,
              at: '2026-10-20T00:00:00Z',
              source_id: 'sent',
              direction: 'outbound',
            },
          ],
        }).exclusions,
      ).toContain('cooldown')
  })
  it('reports unknown job duration and geography as review, not route proof', () => {
    expect(rank()).toMatchObject({
      route_fit: 'neighbor_zip',
      duration_confirmed: false,
    })
    expect(
      rank({
        history: [
          {
            ...customer.history[0],
            source: 'quickbooks',
            date_kind: 'accounting_transaction',
            verified: false,
            duration_minutes: null,
          },
        ],
      }).last_service?.verified,
    ).toBe(false)
  })
  it('deduplicates eligible phone and household identities', () => {
    const c = rankGapCandidates(
      [customer, { ...customer, id: 'duplicate' }],
      gap,
      now,
      settings,
    )
    expect(c.candidates.filter((c) => !c.exclusions.length)).toHaveLength(1)
  })
})
const terms: GapOfferTerms = {
  id: 'offer',
  customer_id: 'customer',
  phone: '+17195550100',
  gap_date: gap.date,
  gap_start: gap.start_time,
  gap_end: gap.end_time,
  minimum_service_cents: 30000,
  amount: 35,
  code: 'TF35',
}
describe('one TF35 rule from quote to invoice', () => {
  it.each([175, 299.99])(
    'rejects $%s, even when travel pushes gross over $300',
    (service_subtotal) =>
      expect(() =>
        calculateGapOffer({ terms, service_subtotal, fees: 150 }),
      ).toThrow(),
  )
  it('qualifies exactly $300 and excludes travel/tax from qualification', () =>
    expect(
      calculateGapOffer({ terms, service_subtotal: 300, fees: 50, tax: 10 }),
    ).toMatchObject({
      service_subtotal: 300,
      subtotal: 350,
      discount_amount: 35,
      total: 325,
      discount_metadata: {
        promo: { code: 'TF35', amount: 35 },
        gap_offer: {
          id: 'offer',
          minimum_service_cents: 30000,
          stacking: false,
        },
      },
    }))
  it('quotes $300 as $265 before charges', () =>
    expect(calculateGapOffer({ terms, service_subtotal: 300 }).total).toBe(265))
  it('rejects stacked discounts and credits', () => {
    expect(() =>
      calculateGapOffer({
        terms,
        service_subtotal: 400,
        existing_discount: 10,
      }),
    ).toThrow()
    expect(() =>
      calculateGapOffer({ terms, service_subtotal: 400, negative_lines: true }),
    ).toThrow()
  })
  it('rejects invalid money and altered offer terms', () => {
    expect(() =>
      calculateGapOffer({ terms, service_subtotal: 400, fees: NaN }),
    ).toThrow()
    expect(() =>
      calculateGapOffer({
        terms: { ...terms, amount: 40 },
        service_subtotal: 400,
      }),
    ).toThrow()
  })
})
