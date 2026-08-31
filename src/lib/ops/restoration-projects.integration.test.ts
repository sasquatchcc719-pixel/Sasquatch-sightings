// @vitest-environment node
/**
 * Full restoration project lifecycle against the real Supabase DB:
 * mitigation day -> queued monitor visits -> place one on the calendar ->
 * deposit on day 1 -> close from a monitor day -> one invoice.
 *
 * Seeds throwaway rows and deletes everything it creates.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import {
  closeRestorationProject,
  scheduleQueuedVisit,
  MONITOR_VISIT_MINUTES,
} from '@/lib/ops/restoration-projects'

const MARKER = 'RESTORATION_LIFECYCLE_TEST'
const supabase = createAdminClient()

let customerId = ''
let addressId = ''
let projectId = ''
let mitigationId = ''
const createdAppointments: string[] = []

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10)
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
      water_category: 3,
      source_of_loss: 'exterior_groundwater',
      cause_narrative: MARKER,
    })
    .select('id')
    .single()
  projectId = project!.id

  const { data: mitigation } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      booking_channel: 'admin',
      // Ignored by the booked-webhook trigger, so seeding a test does not
      // send a fake booking alert carrying a real customer's details.
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
  mitigationId = mitigation!.id
  createdAppointments.push(mitigationId)

  // Day 1 work: Cat 3 extraction on 400 SF and carpet tear-out.
  await supabase.from('ops_appointment_line_items').insert([
    {
      appointment_id: mitigationId,
      name_snapshot: 'EXTS - Water extraction from carpeted floor - Category 3 water',
      quantity: 400,
      unit_price: 1.47,
      line_total: 588,
    },
    {
      appointment_id: mitigationId,
      name_snapshot: 'FCCS - Tear out wet non-salvageable carpet, cut/bag - Cat 3 water',
      quantity: 400,
      unit_price: 1.1,
      line_total: 440,
    },
  ])

  // Six 1 HP axial fans placed on day 1, three days ago.
  await supabase.from('restoration_equipment_placements').insert(
    Array.from({ length: 6 }, () => ({
      project_id: projectId,
      catalog_code: 'DRY++',
      placed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    })),
  )

  // Three monitor visits queued, not scheduled.
  await supabase.from('restoration_visit_queue').insert(
    [2, 3, 4].map((seq) => ({
      project_id: projectId,
      visit_type: 'monitor' as const,
      visit_sequence: seq,
      duration_minutes: MONITOR_VISIT_MINUTES,
    })),
  )
})

afterAll(async () => {
  for (const id of createdAppointments) {
    await supabase.from('ops_invoices').delete().eq('appointment_id', id)
    await supabase.from('ops_appointments').delete().eq('id', id)
  }
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

describe('restoration project lifecycle', () => {
  it('queues monitor visits without putting them on the calendar', async () => {
    const { data: queued } = await supabase
      .from('restoration_visit_queue')
      .select('id, status')
      .eq('project_id', projectId)
    expect(queued).toHaveLength(3)
    expect(queued!.every((q) => q.status === 'queued')).toBe(true)

    const { data: onCalendar } = await supabase
      .from('ops_appointments')
      .select('id')
      .eq('restoration_project_id', projectId)
    expect(onCalendar).toHaveLength(1) // only the mitigation day
  })

  it('refuses to close on the mitigation day', async () => {
    const result = await closeRestorationProject(supabase, {
      projectId,
      closingAppointmentId: mitigationId,
      userId: '00000000-0000-0000-0000-000000000000',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('cannot_close_on_mitigation_day')
  })

  it('places a queued visit on the calendar', async () => {
    const { data: queued } = await supabase
      .from('restoration_visit_queue')
      .select('id')
      .eq('project_id', projectId)
      .eq('visit_sequence', 2)
      .single()

    const result = await scheduleQueuedVisit(supabase, {
      queueId: queued!.id,
      appointmentDate: futureDate(2),
      startTime: '14:00',
      source: 'integration_test',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    createdAppointments.push(result.appointmentId)

    const { data: appt } = await supabase
      .from('ops_appointments')
      .select('start_time, end_time, visit_type, kind')
      .eq('id', result.appointmentId)
      .single()
    expect(appt!.kind).toBe('restoration')
    expect(appt!.visit_type).toBe('monitor')
    expect(appt!.start_time).toBe('14:00:00')
    expect(appt!.end_time).toBe('15:00:00') // one hour: 15 min of work plus drive
  })

  it('closes from the monitor day into one invoice, crediting the deposit', async () => {
    const monitorId = createdAppointments[1]

    // $1,000 collected on day 1, before any invoice exists.
    await supabase.from('ops_payments').insert({
      appointment_id: mitigationId,
      kind: 'deposit',
      method: 'square_tap',
      amount_cents: 100000,
      paid_at: new Date().toISOString(),
      note: MARKER,
    })

    const result = await closeRestorationProject(supabase, {
      projectId,
      closingAppointmentId: monitorId,
      userId: '00000000-0000-0000-0000-000000000000',
      dryStandardNotes: 'all points at or below dry standard',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 588 extraction + 440 tear-out + 6 fans x 3 days x $35 = 630
    expect(result.subtotal).toBeCloseTo(1658, 2)
    expect(result.depositCents).toBe(100000)
    expect(result.balanceCents).toBe(65800)
    // The deposit is credited on the invoice itself, so a job already part
    // paid never goes out asking for the full amount again.
    expect(result.paymentStatus).toBe('partial')
    expect(result.refundDueCents).toBe(0)

    // Exactly one invoice for the whole loss, on the closing visit.
    const { data: invoices } = await supabase
      .from('ops_invoices')
      .select('id, appointment_id, status')
      .in(
        'appointment_id',
        createdAppointments,
      )
    expect(invoices).toHaveLength(1)
    expect(invoices![0].appointment_id).toBe(monitorId)
    expect(invoices![0].status).toBe('ready')

    // Equipment billed as unit-days, all work carried across from day 1.
    const { data: lines } = await supabase
      .from('ops_invoice_line_items')
      .select('description, quantity, line_total')
      .eq('invoice_id', result.invoiceId)
    expect(lines).toHaveLength(3)
    const fans = lines!.find((l) => l.description.includes('Axial fan'))
    expect(Number(fans!.quantity)).toBe(18)
    expect(Number(fans!.line_total)).toBeCloseTo(630, 2)

    // The remaining two queued visits are gone.
    const { data: stillQueued } = await supabase
      .from('restoration_visit_queue')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'queued')
    expect(stillQueued).toHaveLength(0)
    expect(result.cancelledQueued).toBe(2)

    // The project is closed and the deposit now belongs to the invoice.
    const { data: project } = await supabase
      .from('restoration_projects')
      .select('status, invoice_id')
      .eq('id', projectId)
      .single()
    expect(project!.status).toBe('closed')
    expect(project!.invoice_id).toBe(result.invoiceId)

    const { data: payment } = await supabase
      .from('ops_payments')
      .select('invoice_id')
      .eq('appointment_id', mitigationId)
      .single()
    expect(payment!.invoice_id).toBe(result.invoiceId)
  })

  it('refuses to close twice', async () => {
    const result = await closeRestorationProject(supabase, {
      projectId,
      closingAppointmentId: createdAppointments[1],
      userId: '00000000-0000-0000-0000-000000000000',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('project_already_closed')
  })
})
