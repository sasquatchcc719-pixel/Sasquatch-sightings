// @vitest-environment node
/**
 * Cancelling a job parks it: off the calendar, still whole, waiting for a date.
 * The job Charles described — booked, never happened, needs rescheduling — must
 * survive the round trip with its invoice and line items intact.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'

const supabase = createAdminClient()
const MARKER = 'PARKED_JOB_TEST'
let appointmentId = ''
let invoiceId = ''

beforeAll(async () => {
  const { data: addr } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()

  const { data: appointment } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: addr!.customer_id,
      service_address_id: addr!.id,
      booking_channel: 'admin',
      source: 'integration_test',
      status: 'booked',
      payment_status: 'unpaid',
      quickbooks_sync_status: 'held',
      appointment_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      start_time: '11:00',
      end_time: '13:00',
      quoted_total: 302,
      kind: 'service',
      internal_notes: MARKER,
    })
    .select('id')
    .single()
  appointmentId = appointment!.id

  await supabase.from('ops_appointment_line_items').insert({
    appointment_id: appointmentId,
    name_snapshot: 'Carpet cleaning',
    quantity: 1,
    unit_price: 302,
    line_total: 302,
  })

  const { data: invoice } = await supabase
    .from('ops_invoices')
    .insert({
      appointment_id: appointmentId,
      status: 'draft',
      payment_status: 'unpaid',
      subtotal: 302,
      total: 302,
    })
    .select('id')
    .single()
  invoiceId = invoice!.id
})

afterAll(async () => {
  await supabase.from('ops_invoices').delete().eq('id', invoiceId)
  await supabase.from('ops_appointments').delete().eq('internal_notes', MARKER)
})

describe('parking a job', () => {
  it('keeps the invoice and line items when parked', async () => {
    await supabase
      .from('ops_appointments')
      .update({ status: 'cancelled', parked_at: new Date().toISOString() })
      .eq('id', appointmentId)

    const { data: job } = await supabase
      .from('ops_appointments')
      .select('parked_at, status, quoted_total')
      .eq('id', appointmentId)
      .single()
    expect(job!.parked_at).not.toBeNull()
    expect(Number(job!.quoted_total)).toBe(302)

    const { data: lines } = await supabase
      .from('ops_appointment_line_items')
      .select('id')
      .eq('appointment_id', appointmentId)
    expect(lines).toHaveLength(1)

    const { data: invoice } = await supabase
      .from('ops_invoices')
      .select('id')
      .eq('id', invoiceId)
      .maybeSingle()
    expect(invoice).not.toBeNull()
  })

  it('is listed as parked', async () => {
    const { data } = await supabase
      .from('ops_appointments')
      .select('id')
      .not('parked_at', 'is', null)
      .eq('id', appointmentId)
    expect(data).toHaveLength(1)
  })

  it('comes back to the schedule with everything intact', async () => {
    const newDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    await supabase
      .from('ops_appointments')
      .update({
        appointment_date: newDate,
        start_time: '09:00',
        end_time: '11:00',
        status: 'booked',
        parked_at: null,
      })
      .eq('id', appointmentId)

    const { data: job } = await supabase
      .from('ops_appointments')
      .select('parked_at, status, appointment_date, quoted_total')
      .eq('id', appointmentId)
      .single()

    expect(job!.parked_at).toBeNull()
    expect(job!.status).toBe('booked')
    expect(job!.appointment_date).toBe(newDate)
    expect(Number(job!.quoted_total)).toBe(302)

    // Same invoice, not a second one.
    const { data: invoices } = await supabase
      .from('ops_invoices')
      .select('id')
      .eq('appointment_id', appointmentId)
    expect(invoices).toHaveLength(1)
    expect(invoices![0].id).toBe(invoiceId)
  })
})
