#!/usr/bin/env tsx
// Integration test for the reschedule_job slot-token fix (Michelle Tsirlis
// incident, 2026-06-12). Reproduces her exact data shape: an appointment with
// a 120-minute stored window whose line items sum to only 26 minutes, then
// runs the real Harry tool flow (list -> slots -> reschedule) against the
// live DB. Cleans up all test rows afterward.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { executeHarrySmsTool } from '../src/lib/ops/sms-harry-tools'

const TEST_PHONE = '+15005550006' // Twilio magic number, not routable
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const created: { table: string; id: string }[] = []

async function cleanup() {
  for (const { table, id } of created.reverse()) {
    const del = await supabase.from(table).delete().eq('id', id)
    if (del.error) console.error(`cleanup ${table} ${id}:`, del.error.message)
  }
  // line items / status events keyed by appointment are removed before the
  // appointment row itself via reverse order, but sweep any stragglers:
  console.log('Cleanup done.')
}

function fail(msg: string, detail?: unknown): never {
  console.error('FAIL:', msg, detail ?? '')
  cleanup().finally(() => process.exit(1))
  throw new Error(msg)
}

async function main() {
  // 1. Seed test customer + address + appointment (Tue 2026-06-23 13:00-15:00)
  const { data: cust, error: cErr } = await supabase
    .from('ops_customers')
    .insert({
      full_name: 'Harry SlotToken Test',
      first_name: 'Harry',
      last_name: 'SlotToken Test',
      phone: TEST_PHONE,
      email: 'slot-token-test@example.com',
    })
    .select('id')
    .single()
  if (cErr) fail('insert customer', cErr)
  created.push({ table: 'ops_customers', id: cust!.id })

  const { data: addr, error: aErr } = await supabase
    .from('ops_service_addresses')
    .insert({
      customer_id: cust!.id,
      street_1: '123 Test Loop',
      city: 'Monument',
      state: 'CO',
      zip_code: '80132',
    })
    .select('id')
    .single()
  if (aErr) fail('insert address', aErr)
  created.push({ table: 'ops_service_addresses', id: addr!.id })

  const { data: appt, error: apErr } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: cust!.id,
      service_address_id: addr!.id,
      appointment_date: '2026-06-23',
      start_time: '13:00:00',
      end_time: '15:00:00',
      status: 'booked',
      assigned_staff_user_id: '06e69748-a923-4840-b06b-742dd6a6d092',
    })
    .select('id')
    .single()
  if (apErr) fail('insert appointment', apErr)
  created.push({ table: 'ops_appointments', id: appt!.id })

  // Michelle's exact line-item durations: 10 + 1 + 5 + 10 = 26 minutes,
  // wildly different from the 120-minute stored window. Pre-fix this is what
  // made the slot grids disagree and every token check fail.
  const lineItems = [
    {
      name_snapshot: 'Regular Size Room (100 to 200 Sqft)',
      quantity: 1,
      unit_price: 46,
      duration_minutes: 10,
    },
    {
      name_snapshot: 'Step Carpet Cleaning (Per Step Charge)',
      quantity: 15,
      unit_price: 4,
      duration_minutes: 1,
    },
    {
      name_snapshot: 'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
      quantity: 1,
      unit_price: 25,
      duration_minutes: 5,
    },
    {
      name_snapshot: 'Regular Size Room (100 to 200 Sqft)',
      quantity: 1,
      unit_price: 46,
      duration_minutes: 10,
    },
  ]
  const { data: liRows, error: liErr } = await supabase
    .from('ops_appointment_line_items')
    .insert(lineItems.map((l) => ({ ...l, appointment_id: appt!.id })))
    .select('id')
  if (liErr) fail('insert line items', liErr)
  for (const r of liRows || [])
    created.push({ table: 'ops_appointment_line_items', id: r.id })

  const ctx = { supabase: supabase as never, customerPhoneE164: TEST_PHONE }

  // 2. list_my_upcoming_appointments — must expose duration_minutes: 120
  const listRaw = await executeHarrySmsTool(
    'list_my_upcoming_appointments',
    '{}',
    ctx,
  )
  const list = JSON.parse(listRaw)
  const upcoming = (list.upcoming || []).find(
    (u: { appointment_id: string }) => u.appointment_id === appt!.id,
  )
  if (!upcoming) fail('test appointment not in upcoming list', list)
  if (upcoming.duration_minutes !== 120)
    fail(`expected duration_minutes 120, got ${upcoming.duration_minutes}`)
  console.log(
    'PASS list_my_upcoming_appointments duration_minutes:',
    upcoming.duration_minutes,
  )

  // 3. get_calendar_slots with Harry's default duration (no duration param),
  //    exactly like the live failure.
  const slotsRaw = await executeHarrySmsTool(
    'get_calendar_slots',
    JSON.stringify({ date: '2026-06-24' }),
    ctx,
  )
  const slotsRes = JSON.parse(slotsRaw)
  const slot = (slotsRes.slots || [])[0]
  if (!slot) fail('no slots available on 2026-06-24', slotsRes)
  console.log(
    `Using slot ${slot.start_time}-${slot.end_time} on 2026-06-24 (${slotsRes.technician})`,
  )

  // 4. reschedule_job — the call that failed 3x for Michelle.
  const resRaw = await executeHarrySmsTool(
    'reschedule_job',
    JSON.stringify({
      appointment_id: appt!.id,
      new_appointment_date: '2026-06-24',
      new_start_time: slot.start_time,
      slot_token: slot.slot_token,
    }),
    ctx,
  )
  const res = JSON.parse(resRaw)
  if (!res.success) fail('reschedule_job returned error', res)
  console.log('PASS reschedule_job:', resRaw)

  // 5. Verify the DB row moved and kept its 120-minute window.
  const { data: after } = await supabase
    .from('ops_appointments')
    .select('appointment_date, start_time, end_time')
    .eq('id', appt!.id)
    .single()
  if (!after || after.appointment_date !== '2026-06-24')
    fail('appointment date did not move', after)
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const windowMins = mins(after.end_time) - mins(after.start_time)
  if (windowMins !== 120) fail(`window resized to ${windowMins} minutes`, after)
  console.log(
    `PASS window preserved: ${after.start_time}-${after.end_time} (${windowMins} min)`,
  )

  // 6. Negative checks: forged/cross-customer tokens must still be rejected.
  const forged = await executeHarrySmsTool(
    'reschedule_job',
    JSON.stringify({
      appointment_id: appt!.id,
      new_appointment_date: '2026-06-24',
      new_start_time: slot.start_time,
      slot_token: slot.slot_token.slice(0, -4) + 'AAAA',
    }),
    ctx,
  )
  if (!JSON.parse(forged).error) fail('forged token was accepted!', forged)
  console.log('PASS forged token rejected')

  const wrongOwner = await executeHarrySmsTool(
    'reschedule_job',
    JSON.stringify({
      appointment_id: appt!.id,
      new_appointment_date: '2026-06-24',
      new_start_time: slot.start_time,
      slot_token: slot.slot_token,
    }),
    { ...ctx, customerPhoneE164: '+15005550009' },
  )
  if (!JSON.parse(wrongOwner).error)
    fail('cross-customer token was accepted!', wrongOwner)
  console.log('PASS cross-customer token rejected')

  // Status events from the successful reschedule reference the appointment;
  // remove them before the appointment row.
  const { data: evts } = await supabase
    .from('ops_appointment_status_events')
    .select('id')
    .eq('appointment_id', appt!.id)
  for (const e of evts || [])
    created.push({ table: 'ops_appointment_status_events', id: e.id })

  await cleanup()
  console.log('\nALL CHECKS PASSED')
}

main().catch((e) => {
  console.error(e)
  cleanup().finally(() => process.exit(1))
})
