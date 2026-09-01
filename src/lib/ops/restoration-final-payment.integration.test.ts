// @vitest-environment node
/**
 * Proves the final-payment machinery charges the live BALANCE, not the full
 * job total — the exact bug that would double-charge a customer who already
 * paid a deposit. Exercises getRestorationBalanceCents and the webhook's
 * restoration branch against the real Supabase DB; does not call Square.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import {
  getRestorationBalanceCents,
  getMostRecentVisitId,
} from '@/lib/ops/restoration-balance'
import { handleRestorationFinalPayment } from '@/lib/payments/restoration-webhook'

const MARKER = 'RESTORATION_FINAL_PAYMENT_TEST'
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

  // $2,000 of work — a job total the test can assert a balance against.
  await supabase.from('ops_appointment_line_items').insert({
    appointment_id: visitId,
    name_snapshot:
      'EXTS - Water extraction from carpeted floor - Category 2 water',
    quantity: 1,
    unit_price: 2000,
    line_total: 2000,
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

describe('restoration final payment', () => {
  it('owes the full job total before any payment', async () => {
    const balance = await getRestorationBalanceCents(supabase, projectId)
    expect(balance?.balanceCents).toBe(200_000)
  })

  it('drops by exactly the deposit once one is recorded — never re-charges the full total', async () => {
    await supabase.from('ops_payments').insert({
      appointment_id: visitId,
      kind: 'deposit',
      method: 'square_tap',
      amount_cents: 50_000,
      paid_at: new Date().toISOString(),
    })

    const balance = await getRestorationBalanceCents(supabase, projectId)
    expect(balance?.paidCents).toBe(50_000)
    expect(balance?.balanceCents).toBe(150_000)
  })

  it('finds the most recent visit to anchor a final payment against', async () => {
    const anchor = await getMostRecentVisitId(supabase, projectId)
    expect(anchor).toBe(visitId)
  })

  it('rejects a Square payment link webhook for less than the outstanding balance', async () => {
    await supabase
      .from('restoration_projects')
      .update({
        final_payment_link_order_id: `${MARKER}-order-short`,
        final_payment_link_cents: 150_000,
      })
      .eq('id', projectId)

    const result = await handleRestorationFinalPayment(supabase, {
      amountCents: 100_000,
      currency: 'USD',
      eventId: `${MARKER}-event-short`,
      orderId: `${MARKER}-order-short`,
      paidAt: new Date().toISOString(),
      paymentId: `${MARKER}-payment-short`,
    })

    expect(result).toEqual({ outcome: 'amount_mismatch', projectId })

    const balance = await getRestorationBalanceCents(supabase, projectId)
    expect(balance?.balanceCents).toBe(150_000)
  })

  it('records the full balance once a matching webhook confirms payment, and never double-credits a retry', async () => {
    await supabase
      .from('restoration_projects')
      .update({
        final_payment_link_order_id: `${MARKER}-order-full`,
        final_payment_link_cents: 150_000,
        final_payment_paid_at: null,
      })
      .eq('id', projectId)

    const payment = {
      amountCents: 150_000,
      currency: 'USD',
      eventId: `${MARKER}-event-full`,
      orderId: `${MARKER}-order-full`,
      paidAt: new Date().toISOString(),
      paymentId: `${MARKER}-payment-full`,
    }

    const first = await handleRestorationFinalPayment(supabase, payment)
    expect(first).toEqual({ outcome: 'recorded', projectId })

    const balance = await getRestorationBalanceCents(supabase, projectId)
    expect(balance?.paidCents).toBe(200_000)
    expect(balance?.balanceCents).toBe(0)

    // A retried webhook delivery must not add a second credit.
    const retry = await handleRestorationFinalPayment(supabase, payment)
    expect(retry).toEqual({ outcome: 'already_paid', projectId })

    const balanceAfterRetry = await getRestorationBalanceCents(
      supabase,
      projectId,
    )
    expect(balanceAfterRetry?.balanceCents).toBe(0)
  })
})
