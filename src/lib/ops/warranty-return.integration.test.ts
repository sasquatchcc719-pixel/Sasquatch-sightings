// @vitest-environment node
import { config as loadEnv } from 'dotenv'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

loadEnv({ path: '.env.local' })

import { promoteInvoiceOnJobCompletion } from '@/lib/ops/invoice-on-completion'
import { createAdminClient } from '@/supabase/server'

const supabase = createAdminClient()
const suffix = Date.now()
let customerId = ''
let addressId = ''
let originalJobId = ''
let concernId = ''
let returnJobId = ''
let invoiceId = ''
let userId = ''

beforeAll(async () => {
  const { data: staff } = await supabase
    .from('staff_users')
    .select('user_id')
    .limit(1)
    .single()
  userId = staff!.user_id

  const { data: customer, error: customerError } = await supabase
    .from('ops_customers')
    .insert({
      full_name: `Warranty Test ${suffix}`,
      first_name: 'Warranty',
      last_name: `Test ${suffix}`,
      email: `warranty-test-${suffix}@example.com`,
      phone: `+1719${String(suffix).slice(-7)}`,
    })
    .select('id')
    .single()
  expect(customerError).toBeNull()
  customerId = customer!.id

  const { data: address, error: addressError } = await supabase
    .from('ops_service_addresses')
    .insert({
      customer_id: customerId,
      label: 'Integration test',
      street_1: '1 Warranty Test Way',
      city: 'Colorado Springs',
      state: 'CO',
      zip_code: '80903',
    })
    .select('id')
    .single()
  expect(addressError).toBeNull()
  addressId = address!.id

  const baseJob = {
    customer_id: customerId,
    service_address_id: addressId,
    booking_channel: 'admin',
    source: 'integration_test',
    payment_status: 'waived',
    quickbooks_sync_status: 'held',
    appointment_date: '2026-09-03',
    start_time: '09:00',
    end_time: '11:00',
    quoted_total: 0,
  }
  const { data: originalJob, error: originalError } = await supabase
    .from('ops_appointments')
    .insert({ ...baseJob, status: 'completed' })
    .select('id')
    .single()
  expect(originalError).toBeNull()
  originalJobId = originalJob!.id

  const { data: concern, error: concernError } = await supabase
    .from('ops_service_concerns')
    .insert({
      customer_id: customerId,
      appointment_id: originalJobId,
      status: 'approved_return',
      category: 'odor',
      source: 'admin',
      initial_message: 'Integration test concern',
    })
    .select('id')
    .single()
  expect(concernError).toBeNull()
  concernId = concern!.id

  const { data: returnJob, error: returnError } = await supabase
    .from('ops_appointments')
    .insert({
      ...baseJob,
      status: 'in_progress',
      appointment_date: '2026-09-04',
      service_concern_id: concernId,
    })
    .select('id')
    .single()
  expect(returnError).toBeNull()
  returnJobId = returnJob!.id

  const { data: invoice, error: invoiceError } = await supabase
    .from('ops_invoices')
    .insert({
      appointment_id: returnJobId,
      status: 'draft',
      payment_status: 'waived',
      subtotal: 0,
      total: 0,
      sync_status: 'held',
    })
    .select('id')
    .single()
  expect(invoiceError).toBeNull()
  invoiceId = invoice!.id
})

afterAll(async () => {
  if (invoiceId) {
    await supabase
      .from('ops_quickbooks_sync_jobs')
      .delete()
      .eq('entity_id', invoiceId)
    await supabase
      .from('ops_invoice_status_events')
      .delete()
      .eq('invoice_id', invoiceId)
    await supabase.from('ops_invoices').delete().eq('id', invoiceId)
  }
  if (returnJobId) {
    await supabase.from('ops_appointments').delete().eq('id', returnJobId)
  }
  if (concernId) {
    await supabase.from('ops_service_concerns').delete().eq('id', concernId)
  }
  if (originalJobId) {
    await supabase.from('ops_appointments').delete().eq('id', originalJobId)
  }
  if (addressId) {
    await supabase.from('ops_service_addresses').delete().eq('id', addressId)
  }
  if (customerId) {
    await supabase.from('ops_customers').delete().eq('id', customerId)
  }
})

describe('warranty return completion', () => {
  it('resolves the concern and keeps the zero invoice out of QuickBooks', async () => {
    const result = await promoteInvoiceOnJobCompletion(supabase, {
      appointmentId: returnJobId,
      userId,
      note: 'Warranty integration test completed',
    })
    expect(result).toEqual({ promoted: true, invoiceId })

    const [{ data: concern }, { data: invoice }, { data: qbJobs }] =
      await Promise.all([
        supabase
          .from('ops_service_concerns')
          .select('status, resolved_at')
          .eq('id', concernId)
          .single(),
        supabase
          .from('ops_invoices')
          .select('status, payment_status, sync_status')
          .eq('id', invoiceId)
          .single(),
        supabase
          .from('ops_quickbooks_sync_jobs')
          .select('id')
          .eq('entity_id', invoiceId),
      ])

    expect(concern).toMatchObject({ status: 'resolved' })
    expect(concern?.resolved_at).toBeTruthy()
    expect(invoice).toEqual({
      status: 'ready',
      payment_status: 'waived',
      sync_status: 'held',
    })
    expect(qbJobs).toEqual([])
  })
})
