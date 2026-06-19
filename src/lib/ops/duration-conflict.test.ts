// @vitest-environment node
/**
 * Integration tests for appointment conflict detection (2026-06-12 audit
 * follow-up), run against the real Supabase DB.
 *
 * Covers:
 *  - findAppointmentConflict detects overlaps and clears free windows
 *  - excludeAppointmentId / staffUserId scoping does not self-conflict
 *
 * Seeds throwaway rows and deletes everything it creates.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { findAppointmentConflict } from '@/lib/ops/availability-bundle'

const TEST_PHONE = '+15005550062' // Twilio magic number, not routable
const CHARLES_STAFF_ID = '06e69748-a923-4840-b06b-742dd6a6d092'

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

describe('appointment conflict checks against the real DB', () => {
  const supabase = createAdminClient()

  let clearDate = ''
  let customerId = ''
  let addressId = ''
  let targetApptId = ''
  let neighborApptId = ''

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

    const { data: cust, error: cErr } = await supabase
      .from('ops_customers')
      .insert({
        full_name: 'DurationConflict Test',
        first_name: 'DurationConflict',
        last_name: 'Test',
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
})
