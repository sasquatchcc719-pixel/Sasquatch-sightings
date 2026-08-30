// @vitest-environment node
/**
 * The calendar card reads quoted_total. Restoration lines are added on site
 * after booking, so the total has to follow them or the schedule shows $0 on a
 * job worth thousands.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'

const supabase = createAdminClient()
const MARKER = 'QUOTED_TOTAL_TEST'
let projectId = ''
let appointmentId = ''
let cleaningId = ''

async function quotedTotal(id: string) {
  const { data } = await supabase
    .from('ops_appointments')
    .select('quoted_total')
    .eq('id', id)
    .single()
  return Number(data!.quoted_total)
}

beforeAll(async () => {
  const { data: addr } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()

  const { data: project } = await supabase
    .from('restoration_projects')
    .insert({
      customer_id: addr!.customer_id,
      service_address_id: addr!.id,
      cause_narrative: MARKER,
    })
    .select('id')
    .single()
  projectId = project!.id

  const base = {
    customer_id: addr!.customer_id,
    service_address_id: addr!.id,
    booking_channel: 'admin',
    source: 'integration_test',
    status: 'booked',
    payment_status: 'unpaid',
    quickbooks_sync_status: 'held',
    appointment_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    start_time: '09:00',
    end_time: '13:00',
    internal_notes: MARKER,
  }

  const { data: restoration } = await supabase
    .from('ops_appointments')
    .insert({
      ...base,
      quoted_total: 0,
      kind: 'restoration',
      restoration_project_id: projectId,
      visit_type: 'mitigation',
    })
    .select('id')
    .single()
  appointmentId = restoration!.id

  const { data: cleaning } = await supabase
    .from('ops_appointments')
    .insert({ ...base, start_time: '14:00', end_time: '16:00', quoted_total: 275, kind: 'service' })
    .select('id')
    .single()
  cleaningId = cleaning!.id
})

afterAll(async () => {
  await supabase.from('ops_appointments').delete().eq('internal_notes', MARKER)
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

describe('restoration quoted_total', () => {
  it('follows lines as they are added on site', async () => {
    expect(await quotedTotal(appointmentId)).toBe(0)

    await supabase.from('ops_appointment_line_items').insert([
      {
        appointment_id: appointmentId,
        name_snapshot: 'EXTS - extraction',
        quantity: 400,
        unit_price: 1.47,
        line_total: 588,
      },
      {
        appointment_id: appointmentId,
        name_snapshot: 'FCCS - tear out carpet',
        quantity: 400,
        unit_price: 1.1,
        line_total: 440,
      },
    ])

    expect(await quotedTotal(appointmentId)).toBeCloseTo(1028, 2)
  })

  it('follows a quantity edit', async () => {
    const { data: line } = await supabase
      .from('ops_appointment_line_items')
      .select('id')
      .eq('appointment_id', appointmentId)
      .eq('name_snapshot', 'FCCS - tear out carpet')
      .single()

    await supabase
      .from('ops_appointment_line_items')
      .update({ quantity: 200, line_total: 220 })
      .eq('id', line!.id)

    expect(await quotedTotal(appointmentId)).toBeCloseTo(808, 2)
  })

  it('follows a removal, back to zero', async () => {
    await supabase.from('ops_appointment_line_items').delete().eq('appointment_id', appointmentId)
    expect(await quotedTotal(appointmentId)).toBe(0)
  })

  it('leaves carpet cleaning appointments alone', async () => {
    expect(await quotedTotal(cleaningId)).toBe(275)

    await supabase.from('ops_appointment_line_items').insert({
      appointment_id: cleaningId,
      name_snapshot: 'Carpet cleaning',
      quantity: 1,
      unit_price: 99,
      line_total: 99,
    })

    // Unchanged: carpet cleaning still sets its own total at booking.
    expect(await quotedTotal(cleaningId)).toBe(275)
    await supabase.from('ops_appointment_line_items').delete().eq('appointment_id', cleaningId)
  })
})
