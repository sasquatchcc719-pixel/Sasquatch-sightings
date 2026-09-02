// @vitest-environment node
/**
 * Charles: "we probably don't wanna send Carpet cleaning marketing emails to
 * flood victims."
 *
 * The post-job drip is carpet marketing — "how are the floors looking?" then
 * an upholstery offer. Five places enrol a customer into it and exactly one
 * was missing the restoration check, so Jill Benns was booked for a carpet
 * email four days after her basement flooded. The guard now lives inside
 * enrollCustomerInDrip, where no call site can skip it.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { enrollCustomerInDrip } from '@/lib/ops/drip-campaign'

const MARK = 'DRIP_RESTORATION_GUARD_TEST'
const supabase = createAdminClient()
let customerId = '',
  addressId = '',
  projectId = '',
  floodId = '',
  carpetId = ''

beforeAll(async () => {
  const { data: addr } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()
  addressId = addr!.id
  customerId = addr!.customer_id

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
    appointment_date: new Date().toISOString().slice(0, 10),
    start_time: '09:00',
    end_time: '11:00',
    quoted_total: 100,
    completed_at: new Date().toISOString(),
    internal_notes: MARK,
  }
  const { data: flood } = await supabase
    .from('ops_appointments')
    .insert({
      ...base,
      kind: 'restoration',
      restoration_project_id: projectId,
      visit_type: 'mitigation',
      visit_sequence: 1,
    })
    .select('id')
    .single()
  floodId = flood!.id

  // Later than the flood visit: enrollCustomerInDrip only enrols the
  // customer's most recent completed job, so a tie would make this a no-op for
  // reasons that have nothing to do with the guard under test.
  const { data: carpet } = await supabase
    .from('ops_appointments')
    .insert({
      ...base,
      kind: 'service',
      completed_at: new Date(Date.now() + 60_000).toISOString(),
    })
    .select('id')
    .single()
  carpetId = carpet!.id
})

afterAll(async () => {
  await supabase
    .from('drip_campaign_enrollments')
    .delete()
    .eq('customer_id', customerId)
  await supabase.from('ops_appointments').delete().in('id', [floodId, carpetId])
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

async function activeEnrollments() {
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
    // The guard must not quietly switch the drip off for everyone.
    await enrollCustomerInDrip(carpetId)
    expect(await activeEnrollments()).toBeGreaterThan(0)
  })
})
