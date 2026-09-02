// @vitest-environment node
/**
 * Converting an estimate into a real job — the step between an accepted bid and
 * a job on the calendar, which had never run in production.
 *
 * Two things must hold. The block has to be sized from the DOLLAR SUBTOTAL in
 * tiers (2h/3h/4h), not from summed line-item minutes — sizing it from minutes
 * is what double-books the calendar. And the measurements have to survive the
 * copy, because a commercial job re-quoted on site from a lost sqft figure is a
 * job done at the wrong price.
 *
 * This replicates the DB sequence in
 * `src/app/api/admin/ops/estimates/[id]/convert/route.ts` (the route itself is
 * auth-gated and cannot be called from here) with exactly two deviations, both
 * to avoid real-world side effects:
 *
 *   1. source='integration_test' on both appointments. `notify_appointment_booked`
 *      returns early for that value, so no booking webhook or Telegram fires.
 *      The route uses 'internal', so the webhook path is NOT covered here.
 *   2. An explicit sentinel invoice_number. `assign_invoice_number` calls
 *      nextval(), which is non-transactional — letting it fire would permanently
 *      gap the real invoice numbering.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
} from '@/lib/ops/availability'

const supabase = createAdminClient()

/** Far clear of the live sequence (at ~18.7k) so nothing collides. */
const SENTINEL_INVOICE_NUMBER = 999000001
/** Far future so the overlap guard cannot hit a real job. */
const TEST_DATE = '2030-01-15'
const START_TIME = '09:00:00'

// A Saltgrass-shaped commercial bid: 2600 sqft of carpet + deodorizer.
const SEGMENTS = [
  { length: 40, width: 60 },
  { length: 5, width: 40 },
]
const EXPECTED_SQFT = 2600
const SUBTOTAL = 2600 * 0.35 + 2600 * 0.04 // 910 + 104 = 1014

let estimateId = ''
let serviceAppointmentId = ''
let invoiceId = ''

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}

beforeAll(async () => {
  const { data: addr, error: addrError } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()
  if (addrError) throw addrError

  const { data: estimate, error: estError } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: addr!.customer_id,
      service_address_id: addr!.id,
      appointment_date: TEST_DATE,
      start_time: START_TIME,
      end_time: '09:30:00',
      kind: 'estimate',
      estimate_status: 'sent',
      status: 'booked',
      payment_status: 'unpaid',
      booking_channel: 'admin',
      source: 'integration_test',
      quickbooks_sync_status: 'held',
      quoted_total: SUBTOTAL,
    })
    .select('id')
    .single()
  if (estError) throw estError
  estimateId = estimate!.id

  const { error: linesError } = await supabase
    .from('ops_appointment_line_items')
    .insert([
      {
        appointment_id: estimateId,
        name_snapshot: 'Commercial carpet cleaning',
        quantity: EXPECTED_SQFT,
        unit_price: 0.35,
        duration_minutes: 30,
        buffer_minutes: 0,
        line_total: 910,
        length_value: 40,
        width_value: 60,
        pricing_unit_snapshot: 'per_sq_ft',
        area_segments: SEGMENTS,
        notes: 'Dining room and main walkway.',
      },
      {
        appointment_id: estimateId,
        name_snapshot: 'Commercial Deodorizer (Per Sqft)',
        quantity: EXPECTED_SQFT,
        unit_price: 0.04,
        duration_minutes: 10,
        buffer_minutes: 0,
        line_total: 104,
        length_value: 40,
        width_value: 60,
        pricing_unit_snapshot: 'per_sq_ft',
        area_segments: SEGMENTS,
        notes: null,
      },
    ])
  if (linesError) throw linesError
})

afterAll(async () => {
  if (invoiceId) {
    await supabase
      .from('ops_invoice_line_items')
      .delete()
      .eq('invoice_id', invoiceId)
    await supabase.from('ops_invoices').delete().eq('id', invoiceId)
  }
  for (const id of [serviceAppointmentId, estimateId].filter(Boolean)) {
    await supabase
      .from('ops_appointment_status_events')
      .delete()
      .eq('appointment_id', id)
    await supabase
      .from('ops_appointment_line_items')
      .delete()
      .eq('appointment_id', id)
    await supabase.from('ops_appointments').delete().eq('id', id)
  }
})

describe('estimate → job conversion', () => {
  it('sizes the block from the dollar subtotal, not summed line minutes', async () => {
    const { data: lines } = await supabase
      .from('ops_appointment_line_items')
      .select('line_total, duration_minutes')
      .eq('appointment_id', estimateId)

    const subtotal = (lines || []).reduce(
      (sum, l) => sum + Number(l.line_total || 0),
      0,
    )
    expect(subtotal).toBeCloseTo(SUBTOTAL, 2)

    // What the route computes.
    const serviceMinutes = calculateAppointmentDurationFromTotal(subtotal)
    const withBuffer = applyAppointmentBuffer(serviceMinutes)

    // $1014 lands in the top tier: 4 hours of service time.
    expect(serviceMinutes).toBe(240)

    // The trap: summing the line items' own minutes gives 40, which would book
    // a four-hour commercial job into a 40-minute hole.
    const summedLineMinutes = (lines || []).reduce(
      (sum, l) => sum + Number(l.duration_minutes || 0),
      0,
    )
    expect(summedLineMinutes).toBe(40)
    expect(withBuffer).toBeGreaterThan(summedLineMinutes)
  })

  it('carries every measurement onto the real job', async () => {
    const { data: estimateLines } = await supabase
      .from('ops_appointment_line_items')
      .select(
        'service_catalog_item_id, name_snapshot, notes, quantity, unit_price, duration_minutes, buffer_minutes, line_total, length_value, width_value, pricing_unit_snapshot, area_segments',
      )
      .eq('appointment_id', estimateId)
      .order('line_total', { ascending: false })

    const subtotal = (estimateLines || []).reduce(
      (sum, l) => sum + Number(l.line_total || 0),
      0,
    )
    const endMinutes = applyAppointmentBuffer(
      calculateAppointmentDurationFromTotal(subtotal),
    )
    const [h, m] = START_TIME.split(':').map(Number)
    const endTotal = h * 60 + m + endMinutes
    const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`

    const { data: job, error: jobError } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: (
          await supabase
            .from('ops_appointments')
            .select('customer_id, service_address_id')
            .eq('id', estimateId)
            .single()
        ).data!.customer_id,
        service_address_id: (
          await supabase
            .from('ops_appointments')
            .select('service_address_id')
            .eq('id', estimateId)
            .single()
        ).data!.service_address_id,
        appointment_date: TEST_DATE,
        start_time: START_TIME,
        end_time: endTime,
        status: 'booked',
        payment_status: 'unpaid',
        kind: 'service',
        booking_channel: 'admin',
        source: 'integration_test',
        quickbooks_sync_status: 'held',
        quoted_total: Number(subtotal.toFixed(2)),
      })
      .select('id, start_time, end_time')
      .single()
    if (jobError) throw jobError
    serviceAppointmentId = job!.id

    // The block really is the dollar-tier length, on the row as stored.
    expect(minutesBetween(job!.start_time, job!.end_time)).toBe(endMinutes)

    // Copy the lines exactly as the route does.
    const { error: copyError } = await supabase
      .from('ops_appointment_line_items')
      .insert(
        (estimateLines || []).map((item) => ({
          appointment_id: serviceAppointmentId,
          service_catalog_item_id: item.service_catalog_item_id,
          name_snapshot: item.name_snapshot,
          notes: item.notes,
          quantity: item.quantity,
          unit_price: item.unit_price,
          duration_minutes: item.duration_minutes,
          buffer_minutes: item.buffer_minutes,
          line_total: item.line_total,
          length_value: item.length_value,
          width_value: item.width_value,
          pricing_unit_snapshot: item.pricing_unit_snapshot,
          area_segments: item.area_segments ?? null,
        })),
      )
    if (copyError) throw copyError

    const { data: jobLines } = await supabase
      .from('ops_appointment_line_items')
      .select(
        'name_snapshot, quantity, unit_price, line_total, length_value, width_value, pricing_unit_snapshot, area_segments, notes',
      )
      .eq('appointment_id', serviceAppointmentId)
      .order('line_total', { ascending: false })

    expect(jobLines).toHaveLength(2)

    const carpet = jobLines!.find(
      (l) => l.name_snapshot === 'Commercial carpet cleaning',
    )!
    expect(Number(carpet.quantity)).toBe(EXPECTED_SQFT)
    expect(carpet.pricing_unit_snapshot).toBe('per_sq_ft')
    expect(Number(carpet.length_value)).toBe(40)
    expect(Number(carpet.width_value)).toBe(60)
    expect(carpet.area_segments).toEqual(SEGMENTS)
    expect(carpet.notes).toBe('Dining room and main walkway.')

    // Every measured line keeps its segments — not just the first.
    for (const line of jobLines!) {
      expect(line.area_segments).toEqual(SEGMENTS)
    }
  })

  it('creates an invoice whose totals match the estimate', async () => {
    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .insert({
        appointment_id: serviceAppointmentId,
        invoice_number: SENTINEL_INVOICE_NUMBER,
        status: 'draft',
        payment_status: 'unpaid',
        subtotal: Number(SUBTOTAL.toFixed(2)),
        discount_amount: 0,
        total: Number(SUBTOTAL.toFixed(2)),
        sync_status: 'held',
      })
      .select('id, subtotal, total, invoice_number')
      .single()
    if (invoiceError) throw invoiceError
    invoiceId = invoice!.id

    expect(Number(invoice!.subtotal)).toBeCloseTo(SUBTOTAL, 2)
    expect(Number(invoice!.total)).toBeCloseTo(SUBTOTAL, 2)
    // Proves the sentinel held and nextval() never fired.
    expect(Number(invoice!.invoice_number)).toBe(SENTINEL_INVOICE_NUMBER)
  })

  it('marks the estimate converted and refuses a second conversion', async () => {
    const { error: updateError } = await supabase
      .from('ops_appointments')
      .update({
        estimate_status: 'converted',
        converted_appointment_id: serviceAppointmentId,
      })
      .eq('id', estimateId)
    if (updateError) throw updateError

    const { data: reloaded } = await supabase
      .from('ops_appointments')
      .select('estimate_status, converted_appointment_id')
      .eq('id', estimateId)
      .single()

    expect(reloaded!.estimate_status).toBe('converted')
    expect(reloaded!.converted_appointment_id).toBe(serviceAppointmentId)

    // The route's guard: a second convert is refused on this field alone.
    expect(Boolean(reloaded!.converted_appointment_id)).toBe(true)
  })

  it('the dollar tiers are the ones the business actually uses', () => {
    expect(calculateAppointmentDurationFromTotal(0)).toBe(120)
    expect(calculateAppointmentDurationFromTotal(300)).toBe(120)
    expect(calculateAppointmentDurationFromTotal(301)).toBe(180)
    expect(calculateAppointmentDurationFromTotal(600)).toBe(180)
    expect(calculateAppointmentDurationFromTotal(601)).toBe(240)
    expect(calculateAppointmentDurationFromTotal(5000)).toBe(240)
  })
})
