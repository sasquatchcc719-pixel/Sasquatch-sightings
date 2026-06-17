import { describe, expect, it } from 'vitest'
import { buildBookingPayload, extractBookingFields } from './booking-flow'
import type { CatalogItem } from './match-service'
import type { IntentModel } from './read-intent'
import type { BookingFields } from './booking'

function fakeModel(reply: string): IntentModel {
  return async () => reply
}

const catalog: CatalogItem[] = [
  {
    id: 'id-regular',
    name: 'Regular Size Room (100 to 200 Sqft)',
    slug: null,
    basePrice: 46,
    pricingUnit: 'fixed',
  },
  {
    id: 'id-step',
    name: 'Step Carpet Cleaning (Per Step Charge)',
    slug: null,
    basePrice: 4,
    pricingUnit: 'per_step',
  },
]

const completeFields: BookingFields = {
  firstName: 'Jamie',
  lastName: 'Jones',
  email: 'jamie@example.com',
  street1: '123 Main St',
  city: 'Monument',
  zipCode: '80132',
  leadSource: 'Nextdoor',
  services: [
    { description: 'bedroom', quantity: 2 },
    { description: 'stairs', quantity: 10 },
  ],
  preferredDate: '2026-06-20',
  preferredTime: '10:00',
}

describe('extractBookingFields', () => {
  it('pulls structured fields from the transcript', async () => {
    const model = fakeModel(
      JSON.stringify({
        is_booking: true,
        first_name: 'Jamie',
        last_name: 'Jones',
        email: 'jamie@example.com',
        preferred_date: '2026-06-20',
        preferred_time: '10:00',
        services: [{ description: 'bedroom', quantity: 2 }],
      }),
    )
    const { isBooking, fields } = await extractBookingFields({
      transcript: [{ role: 'user', content: "I'd like to book a cleaning" }],
      today: '2026-06-17',
      catalogNames: catalog.map((c) => c.name),
      model,
    })
    expect(isBooking).toBe(true)
    expect(fields.firstName).toBe('Jamie')
    expect(fields.services).toEqual([{ description: 'bedroom', quantity: 2 }])
  })

  it('returns isBooking=false on non-booking or unparseable output', async () => {
    const bad = await extractBookingFields({
      transcript: [],
      today: '2026-06-17',
      catalogNames: [],
      model: fakeModel('I am not sure'),
    })
    expect(bad.isBooking).toBe(false)

    const notBooking = await extractBookingFields({
      transcript: [],
      today: '2026-06-17',
      catalogNames: [],
      model: fakeModel('{"is_booking":false}'),
    })
    expect(notBooking.isBooking).toBe(false)
  })
})

describe('buildBookingPayload', () => {
  it('builds a payload with REAL service ids and the real total (no collapse)', () => {
    const built = buildBookingPayload(catalog, completeFields, '+17195551234')
    if ('unmatched' in built) throw new Error('expected a payload')
    expect(built.payload.line_items).toEqual([
      { service_id: 'id-regular', quantity: 2 },
      { service_id: 'id-step', quantity: 10 },
    ])
    expect(built.payload.expectedTotal).toBe(132) // 2*46 + 10*4 — computed by code
    expect(built.payload.customer.phone).toBe('+17195551234')
    expect(built.summary).toContain('132.00')
  })

  it('reports unmatched services instead of guessing', () => {
    const built = buildBookingPayload(
      catalog,
      {
        ...completeFields,
        services: [{ description: 'gutter cleaning', quantity: 1 }],
      },
      '+17195551234',
    )
    expect('unmatched' in built).toBe(true)
  })
})
