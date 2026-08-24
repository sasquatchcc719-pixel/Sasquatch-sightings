// @vitest-environment node
/**
 * Regression tests for the 2026-08-23 phantom booking.
 *
 * Root cause: get_calendar_slots sized availability from a duration_minutes the
 * model guessed (120), while book_new_job re-derived it from the priced total
 * ($406 → 180). The 3:00 PM slot Scout honestly offered did not exist at 180
 * minutes, so book_new_job rejected it and no retry could ever succeed — Scout
 * gave up and fabricated a confirmation number.
 *
 * Both tools now price through priceLineItems, so they cannot disagree.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseLineItems, priceLineItems } from './scout-web-tools'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
} from './availability'

/** Cindy Carrington's actual job, as Scout submitted it. */
const LEGENDARY_SASQUATCH = '99b1b5d0-51b1-49d6-af3f-eb9e93468b3f'
const SMALL_AREA = '8a5740a1-2681-438e-9248-0309fe92bc15'
const STEP = '20aa0522-7ce9-4030-88ed-8c895a8f119b'

const CATALOG: Record<string, number> = {
  [LEGENDARY_SASQUATCH]: 145,
  [SMALL_AREA]: 30,
  [STEP]: 4,
}

/** Minimal stand-in for the one query priceLineItems makes. */
function fakeSupabase(catalog: Record<string, number> = CATALOG) {
  return {
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => ({
          eq: () => ({
            data: ids
              .filter((id) => id in catalog)
              .map((id) => ({ id, base_price: catalog[id] })),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

const CINDYS_JOB = [
  { service_id: LEGENDARY_SASQUATCH, quantity: 2 },
  { service_id: SMALL_AREA, quantity: 2 },
  { service_id: STEP, quantity: 14 },
]

describe('priceLineItems', () => {
  it("prices Cindy's job at $406 and requires 180 minutes", async () => {
    const result = await priceLineItems(fakeSupabase(), CINDYS_JOB)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 2×$145 + 2×$30 + 14×$4
    expect(result.serviceTotal).toBe(406)
    expect(result.requiredMinutes).toBe(180)
  })

  it('exposes the mismatch that broke the booking', async () => {
    const result = await priceLineItems(fakeSupabase(), CINDYS_JOB)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // What get_calendar_slots used to ask for, versus what booking demanded.
    const guessedByModel = applyAppointmentBuffer(120)
    expect(guessedByModel).not.toBe(result.requiredMinutes)
  })

  it('agrees with the raw duration formula for every tier boundary', async () => {
    // Both tools derive duration from the dollar total, so this formula is the
    // single source of truth. Guard the boundaries.
    for (const total of [1, 150, 300, 301, 406, 600, 601, 5000]) {
      const items = [{ service_id: 'x', quantity: 1 }]
      const result = await priceLineItems(fakeSupabase({ x: total }), items)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.requiredMinutes).toBe(
        applyAppointmentBuffer(calculateAppointmentDurationFromTotal(total)),
      )
    }
  })

  it('scales duration with quantity, not just unit price', async () => {
    // 14 steps at $4 is $56, but 100 steps is $400 — a different tier. The
    // deprecated per-line-item duration path ignored quantity entirely.
    const few = await priceLineItems(fakeSupabase(), [
      { service_id: STEP, quantity: 14 },
    ])
    const many = await priceLineItems(fakeSupabase(), [
      { service_id: STEP, quantity: 100 },
    ])
    expect(few.ok && many.ok).toBe(true)
    if (!few.ok || !many.ok) return
    expect(few.serviceTotal).toBe(56)
    expect(many.serviceTotal).toBe(400)
    expect(many.requiredMinutes).toBeGreaterThan(few.requiredMinutes)
  })

  it('does not collapse duplicate service ids into one charge', async () => {
    // gpt-4o naturally emits "two Sasquatch rooms" as two quantity-1 rows.
    // Pricing per catalog row instead of per line item halved the total, which
    // sized the calendar block at 120 minutes for a 180-minute job.
    const split = await priceLineItems(fakeSupabase(), [
      { service_id: LEGENDARY_SASQUATCH, quantity: 1 },
      { service_id: LEGENDARY_SASQUATCH, quantity: 1 },
    ])
    const combined = await priceLineItems(fakeSupabase(), [
      { service_id: LEGENDARY_SASQUATCH, quantity: 2 },
    ])
    expect(split.ok && combined.ok).toBe(true)
    if (!split.ok || !combined.ok) return
    expect(split.serviceTotal).toBe(290)
    expect(split.serviceTotal).toBe(combined.serviceTotal)
    expect(split.requiredMinutes).toBe(combined.requiredMinutes)
  })

  it("prices the split-row form of Cindy's job the same as the combined form", async () => {
    const split = await priceLineItems(fakeSupabase(), [
      { service_id: LEGENDARY_SASQUATCH, quantity: 1 },
      { service_id: LEGENDARY_SASQUATCH, quantity: 1 },
      { service_id: SMALL_AREA, quantity: 1 },
      { service_id: SMALL_AREA, quantity: 1 },
      { service_id: STEP, quantity: 14 },
    ])
    expect(split.ok).toBe(true)
    if (!split.ok) return
    expect(split.serviceTotal).toBe(406)
    expect(split.requiredMinutes).toBe(180)
  })

  it('refuses line items that match nothing active', async () => {
    const result = await priceLineItems(fakeSupabase(), [
      { service_id: 'deleted-service', quantity: 1 },
    ])
    expect(result.ok).toBe(false)
  })

  it('refuses an empty list rather than pricing a $0 job', async () => {
    const result = await priceLineItems(fakeSupabase(), [])
    expect(result.ok).toBe(false)
  })
})

describe('parseLineItems', () => {
  it('floors quantity at 1 so a missing count cannot zero out a line', () => {
    expect(
      parseLineItems([
        { service_id: STEP },
        { service_id: SMALL_AREA, quantity: 0 },
        { service_id: STEP, quantity: -5 },
      ]),
    ).toEqual([
      { service_id: STEP, quantity: 1 },
      { service_id: SMALL_AREA, quantity: 1 },
      { service_id: STEP, quantity: 1 },
    ])
  })

  it('returns an empty list for non-array input', () => {
    expect(parseLineItems(undefined)).toEqual([])
    expect(parseLineItems('nope')).toEqual([])
  })
})
