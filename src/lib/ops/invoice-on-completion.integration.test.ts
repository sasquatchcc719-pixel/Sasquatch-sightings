// @vitest-environment node
/**
 * A job finished from the tech portal must be billed the same as one finished
 * from operations. It was not: Recovery Village's 8 July job sat in draft for
 * two months, never sent and never in QuickBooks, because only the admin route
 * promoted the invoice.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { promoteInvoiceOnJobCompletion } from '@/lib/ops/invoice-on-completion'

const MARK = 'INVOICE_ON_COMPLETION_TEST'
const supabase = createAdminClient()
let customerId = '',
  addressId = '',
  apptId = '',
  invoiceId = '',
  userId = ''

beforeAll(async () => {
  const { data: addr } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()
  addressId = addr!.id
  customerId = addr!.customer_id
  const { data: staff } = await supabase
    .from('staff_users')
    .select('user_id')
    .limit(1)
    .single()
  userId = staff!.user_id

  const { data: appt, error: aErr } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      booking_channel: 'admin',
      source: 'integration_test',
      status: 'booked',
      payment_status: 'unpaid',
      quickbooks_sync_status: 'held',
      appointment_date: new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10),
      start_time: '09:00',
      end_time: '11:00',
      quoted_total: 250,
      internal_notes: MARK,
    })
    .select('id')
    .single()
  expect(aErr).toBeNull()
  apptId = appt!.id

  const { data: inv, error: iErr } = await supabase
    .from('ops_invoices')
    .insert({
      appointment_id: apptId,
      status: 'draft',
      payment_status: 'unpaid',
      subtotal: 250,
      total: 250,
      sync_status: 'held',
    })
    .select('id')
    .single()
  expect(iErr).toBeNull()
  invoiceId = inv!.id
})

afterAll(async () => {
  await supabase
    .from('ops_quickbooks_sync_jobs')
    .delete()
    .eq('entity_id', invoiceId)
  await supabase
    .from('ops_invoice_status_events')
    .delete()
    .eq('invoice_id', invoiceId)
  await supabase.from('ops_invoices').delete().eq('id', invoiceId)
  await supabase
    .from('ops_appointment_status_events')
    .delete()
    .eq('appointment_id', apptId)
  await supabase.from('ops_appointments').delete().eq('id', apptId)
})

describe('billing a job finished from the tech portal', () => {
  it('raises the invoice out of draft and queues QuickBooks', async () => {
    const result = await promoteInvoiceOnJobCompletion(supabase, {
      appointmentId: apptId,
      userId,
      note: 'Job completed from tech portal',
    })
    expect(result).toEqual({ promoted: true, invoiceId })

    const { data: inv } = await supabase
      .from('ops_invoices')
      .select('status, sync_status')
      .eq('id', invoiceId)
      .single()
    expect(inv!.status).toBe('ready')

    // The thing that was actually missing: without a queued job the invoice
    // never reaches QuickBooks no matter what its status says.
    const { data: jobs } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .select('id')
      .eq('entity_id', invoiceId)
    expect((jobs ?? []).length).toBeGreaterThan(0)
  })

  it('is safe to run twice — a job can be completed more than once', async () => {
    const again = await promoteInvoiceOnJobCompletion(supabase, {
      appointmentId: apptId,
      userId,
      note: 'Job completed from tech portal',
    })
    expect(again).toEqual({ promoted: false, reason: 'not_draft' })
    const { data: jobs } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .select('id')
      .eq('entity_id', invoiceId)
    expect((jobs ?? []).length).toBe(1)
  })
})
