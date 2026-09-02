// @vitest-environment node
/**
 * Charles: "we probably don't wanna send Carpet cleaning marketing emails to
 * flood victims."
 *
 * The post-job drip is carpet marketing — "how are the floors looking?" then
 * an upholstery offer. Five places enrol a customer into it and exactly one
 * was missing the restoration check, so Jill Benns was booked for a carpet
 * email five days after her basement flooded.
 *
 * This test creates its own customer. An earlier version borrowed the first
 * row of ops_service_addresses, which is a real person — it put test jobs on
 * his live calendar and made the test pass alone but fail in the suite, since
 * enrollCustomerInDrip only enrols a customer's most recent completed job and
 * other tests kept creating newer ones against whoever was borrowed.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { enrollCustomerInDrip } from '@/lib/ops/drip-campaign'

const MARK = 'DRIP_RESTORATION_GUARD_TEST'
const supabase = createAdminClient()
let customerId = ''
let addressId = ''
let projectId = ''
let floodId = ''
let carpetId = ''

const today = new Date().toISOString().slice(0, 10)

beforeAll(async () => {
  const { data: cust, error: cErr } = await supabase
    .from('ops_customers')
    .insert({
      full_name: `Drip Guard ${Date.now()}`,
      email: `drip-guard-${Date.now()}@example.com`,
      phone: '+17195550137',
    })
    .select('id')
    .single()
  expect(cErr).toBeNull()
  customerId = cust!.id

  const { data: addr, error: aErr } = await supabase
    .from('ops_service_addresses')
    .insert({
      customer_id: customerId,
      street_1: '1 Test Way',
      city: 'Monument',
      state: 'CO',
      zip_code: '80132',
    })
    .select('id')
    .single()
  expect(aErr).toBeNull()
  addressId = addr!.id

  const { data: project } = await supabase
    .from('restoration_projects')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      water_category: 2,
      source_of_loss: 'supply_line',
      cause_narrative: MARK,
    })
    .select('id')
    .single()
  projectId = project!.id

  const base = {
    customer_id: customerId,
    service_address_id: addressId,
    booking_channel: 'admin',
    source: 'integration_test',
    status: 'completed',
    payment_status: 'unpaid',
    quickbooks_sync_status: 'held',
    appointment_date: today,
    start_time: '09:00',
    end_time: '11:00',
    quoted_total: 100,
    internal_notes: MARK,
  }

  const { data: flood, error: fErr } = await supabase
    .from('ops_appointments')
    .insert({
      ...base,
      kind: 'restoration',
      restoration_project_id: projectId,
      visit_type: 'mitigation',
      visit_sequence: 1,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  expect(fErr).toBeNull()
  floodId = flood!.id

  // Later than the flood visit: enrollCustomerInDrip only enrols the
  // customer's most recent completed job, so a tie would make the second
  // assertion a no-op for reasons unrelated to the guard under test.
  const { data: carpet, error: kErr } = await supabase
    .from('ops_appointments')
    .insert({
      ...base,
      kind: 'service',
      completed_at: new Date(Date.now() + 60_000).toISOString(),
    })
    .select('id')
    .single()
  expect(kErr).toBeNull()
  carpetId = carpet!.id
})

afterAll(async () => {
  await supabase
    .from('drip_campaign_enrollments')
    .delete()
    .eq('customer_id', customerId)
  await supabase.from('ops_appointments').delete().in('id', [floodId, carpetId])
  await supabase.from('restoration_projects').delete().eq('id', projectId)
  await supabase.from('ops_service_addresses').delete().eq('id', addressId)
  await supabase.from('ops_customers').delete().eq('id', customerId)
})

async function activeEnrollments(): Promise<number> {
  const { data } = await supabase
    .from('drip_campaign_enrollments')
    .select('id')
    .eq('customer_id', customerId)
    .eq('status', 'active')
  return (data ?? []).length
}

describe('carpet drip on a flood job', () => {
  it('does not enrol a water-loss customer', async () => {
    await enrollCustomerInDrip(floodId)
    expect(await activeEnrollments()).toBe(0)
  })

  it('still enrols an ordinary carpet job', async () => {
    // A guard that quietly switched the drip off for everyone would be a worse
    // bug than the one it fixes.
    await enrollCustomerInDrip(carpetId)
    expect(await activeEnrollments()).toBeGreaterThan(0)
  })
})
