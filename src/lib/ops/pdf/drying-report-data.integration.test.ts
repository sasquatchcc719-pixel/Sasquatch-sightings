// @vitest-environment node
/**
 * Proves the drying report's totals apply the deductible split, matching
 * getRestorationBalanceCents exactly — Charles caught the report quoting a
 * balance $700 higher than the Money card because the split was never
 * subtracted here.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { buildDryingReportData } from '@/lib/ops/pdf/drying-report-data'
import { getRestorationBalanceCents } from '@/lib/ops/restoration-balance'

const MARKER = 'DRYING_REPORT_DEDUCTIBLE_TEST'
const supabase = createAdminClient()

let customerId = ''
let addressId = ''
let projectId = ''
let visitId = ''

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

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
      source_of_loss: 'appliance_supply_line',
      cause_narrative: MARKER,
      deductible_credit: 700,
    })
    .select('id')
    .single()
  projectId = project!.id

  const { data: visit } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      booking_channel: 'admin',
      source: 'integration_test',
      status: 'completed',
      payment_status: 'unpaid',
      quickbooks_sync_status: 'held',
      appointment_date: futureDate(1),
      start_time: '09:00',
      end_time: '13:00',
      quoted_total: 0,
      kind: 'restoration',
      restoration_project_id: projectId,
      visit_type: 'mitigation',
      visit_sequence: 1,
      internal_notes: MARKER,
    })
    .select('id')
    .single()
  visitId = visit!.id

  await supabase.from('ops_appointment_line_items').insert({
    appointment_id: visitId,
    name_snapshot:
      'EXTS - Water extraction from carpeted floor - Category 2 water',
    quantity: 1,
    unit_price: 2000,
    line_total: 2000,
  })

  await supabase.from('ops_payments').insert({
    appointment_id: visitId,
    kind: 'deposit',
    method: 'square_tap',
    amount_cents: 100_000,
    paid_at: new Date().toISOString(),
  })
})

afterAll(async () => {
  await supabase.from('ops_payments').delete().eq('appointment_id', visitId)
  await supabase
    .from('ops_appointment_line_items')
    .delete()
    .eq('appointment_id', visitId)
  await supabase.from('ops_appointments').delete().eq('id', visitId)
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

describe('drying report totals', () => {
  it('subtracts the deductible split and matches the Money card balance exactly', async () => {
    const built = await buildDryingReportData(supabase, projectId, false)
    const balance = await getRestorationBalanceCents(supabase, projectId)

    expect(built).not.toBeNull()
    // $2,000 work, -$700 deductible split, -$1,000 deposit = $300 owed.
    expect(built!.data.totals.grossSubtotal).toBe(2000)
    expect(built!.data.totals.deductibleCredit).toBe(700)
    expect(built!.data.totals.subtotal).toBe(1300)
    expect(built!.data.totals.balance).toBe(300)

    expect(balance?.balanceCents).toBe(30_000)
    expect(built!.data.totals.balance * 100).toBe(balance?.balanceCents)
  })
})
