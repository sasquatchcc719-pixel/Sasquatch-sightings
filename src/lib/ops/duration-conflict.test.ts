// @vitest-environment node
/**
 * Integration tests for the unified duration formula + appointment conflict
 * checks (2026-06-12 audit follow-up), run against the real Supabase DB.
 *
 * Covers:
 *  - findAppointmentConflict detects overlaps and clears free windows
 *  - update_job_line_items resizes with dollar tiers and REFUSES a change
 *    that would grow the job into a neighboring appointment
 *  - book_new_job's availability check now runs on the dollar-tier duration
 *    (dry-run that stops at "start time is not available" — no booking made)
 *
 * Seeds throwaway rows and deletes everything it creates.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { findAppointmentConflict } from '@/lib/ops/availability-bundle'
import { executeHarrySmsTool } from '@/lib/ops/sms-harry-tools'

const TEST_PHONE = '+15005550062' // Twilio magic number, not routable
const CHARLES_STAFF_ID = '06e69748-a923-4840-b06b-742dd6a6d092'

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

describe('duration unification + conflict checks against the real DB', () => {
  const supabase = createAdminClient()

  let clearDate = ''
  let customerId = ''
  let addressId = ''
  let targetApptId = ''
  let neighborApptId = ''
  let roomServiceId = ''
  let roomPrice = 0

  beforeAll(async () => {
    // Find a day 20-60 days out whose whole 13:00-17:00 block is genuinely
    // free, so the "no conflict" assertions can't be flaky.
    for (let offset = 20; offset <= 60; offset += 1) {
      const candidate = futureDate(offset)
      const conflict = await findAppointmentConflict(supabase, {
        date: candidate,
        startTime: '13:00:00',
        endTime: '17:00:00',
      })
      if (!conflict) {
        clearDate = candidate
        break
      }
    }
    if (!clearDate) throw new Error('No clear test date found in 60 days')

    const { data: service, error: svcErr } = await supabase
      .from('service_catalog_items')
      .select('id, base_price')
      .ilike('name', 'Regular Size Room%')
      .eq('is_active', true)
      .limit(1)
      .single()
    if (svcErr) throw svcErr
    roomServiceId = service.id
    roomPrice = Number(service.base_price)

    const { data: cust, error: cErr } = await supabase
      .from('ops_customers')
      .insert({
        full_name: 'Harry DurationConflict Test',
        first_name: 'Harry',
        last_name: 'DurationConflict Test',
        phone: TEST_PHONE,
        email: 'duration-conflict-test@example.com',
      })
      .select('id')
      .single()
    if (cErr) throw cErr
    customerId = cust.id

    const { data: addr, error: aErr } = await supabase
      .from('ops_service_addresses')
      .insert({
        customer_id: customerId,
        street_1: '789 Conflict Ct',
        city: 'Monument',
        state: 'CO',
        zip_code: '80132',
      })
      .select('id')
      .single()
    if (aErr) throw aErr
    addressId = addr.id

    const { data: target, error: tErr } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: addressId,
        appointment_date: clearDate,
        start_time: '13:00:00',
        end_time: '15:00:00',
        status: 'booked',
        assigned_staff_user_id: CHARLES_STAFF_ID,
      })
      .select('id')
      .single()
    if (tErr) throw tErr
    targetApptId = target.id

    const { data: neighbor, error: nErr } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: addressId,
        appointment_date: clearDate,
        start_time: '15:00:00',
        end_time: '17:00:00',
        status: 'booked',
        assigned_staff_user_id: CHARLES_STAFF_ID,
      })
      .select('id')
      .single()
    if (nErr) throw nErr
    neighborApptId = neighbor.id
  })

  afterAll(async () => {
    for (const apptId of [targetApptId, neighborApptId]) {
      if (!apptId) continue
      await supabase
        .from('ops_appointment_status_events')
        .delete()
        .eq('appointment_id', apptId)
      await supabase
        .from('ops_appointment_line_items')
        .delete()
        .eq('appointment_id', apptId)
      await supabase.from('ops_appointments').delete().eq('id', apptId)
    }
    if (addressId) {
      await supabase.from('ops_service_addresses').delete().eq('id', addressId)
    }
    if (customerId) {
      await supabase.from('ops_customers').delete().eq('id', customerId)
    }
  })

  it('findAppointmentConflict sees overlaps and clears free windows', async () => {
    const overlapping = await findAppointmentConflict(supabase, {
      date: clearDate,
      startTime: '14:00:00',
      endTime: '16:00:00',
    })
    expect(overlapping).not.toBeNull()

    const clear = await findAppointmentConflict(supabase, {
      date: clearDate,
      startTime: '17:00:00',
      endTime: '18:00:00',
    })
    expect(clear).toBeNull()

    // Excluding the appointment itself must not self-conflict.
    const selfExcluded = await findAppointmentConflict(supabase, {
      date: clearDate,
      startTime: '13:00:00',
      endTime: '15:00:00',
      excludeAppointmentId: targetApptId,
      staffUserId: CHARLES_STAFF_ID,
    })
    expect(selfExcluded).toBeNull()
  })

  it('update_job_line_items refuses growth into a neighboring job', async () => {
    // Enough rooms to push the subtotal over $300 -> 3-hour tier -> the
    // 13:00 job would now end 16:00, inside the neighbor's 15:00-17:00.
    const bigQty = Math.ceil(301 / roomPrice)
    const raw = await executeHarrySmsTool(
      'update_job_line_items',
      JSON.stringify({
        appointment_id: targetApptId,
        line_items: [{ service_id: roomServiceId, quantity: bigQty }],
      }),
      { supabase: supabase as never, customerPhoneE164: TEST_PHONE },
    )
    const res = JSON.parse(raw)
    expect(res.error).toBeTruthy()
    expect(String(res.error)).toContain('no longer fits')

    // Nothing was mutated.
    const { data: after } = await supabase
      .from('ops_appointments')
      .select('end_time')
      .eq('id', targetApptId)
      .single()
    expect(after?.end_time).toBe('15:00:00')
  })

  it('update_job_line_items resizes with dollar tiers when it fits', async () => {
    // Subtotal between $150 and $300 -> 2-hour tier -> ends exactly 15:00,
    // flush against the neighbor without overlapping it.
    const okQty = Math.max(1, Math.ceil(150 / roomPrice))
    expect(okQty * roomPrice).toBeLessThanOrEqual(300)

    const raw = await executeHarrySmsTool(
      'update_job_line_items',
      JSON.stringify({
        appointment_id: targetApptId,
        line_items: [{ service_id: roomServiceId, quantity: okQty }],
      }),
      { supabase: supabase as never, customerPhoneE164: TEST_PHONE },
    )
    const res = JSON.parse(raw)
    expect(res.error).toBeFalsy()
    expect(res.success).toBe(true)

    const { data: after } = await supabase
      .from('ops_appointments')
      .select('end_time, quoted_total')
      .eq('id', targetApptId)
      .single()
    expect(after?.end_time).toBe('15:00:00')
    expect(Number(after?.quoted_total)).toBe(okQty * roomPrice)
  }, 30_000)

  it('book_new_job availability check runs on the tier duration (dry run)', async () => {
    // 23:30 is never an offered start, so this stops at the availability
    // check — which now runs AFTER computing the tier duration — without
    // creating a booking.
    const raw = await executeHarrySmsTool(
      'book_new_job',
      JSON.stringify({
        first_name: 'Harry',
        last_name: 'DurationConflict Test',
        email: 'duration-conflict-test@example.com',
        street_1: '789 Conflict Ct',
        city: 'Monument',
        zip_code: '80132',
        appointment_date: futureDate(61),
        start_time: '23:30',
        slot_token: 'garbage.garbage',
        lead_source: 'integration-test',
        line_items: [{ service_id: roomServiceId, quantity: 4 }],
      }),
      { supabase: supabase as never, customerPhoneE164: TEST_PHONE },
    )
    const res = JSON.parse(raw)
    expect(String(res.error || '')).toContain('not available')
  }, 30_000)
})
