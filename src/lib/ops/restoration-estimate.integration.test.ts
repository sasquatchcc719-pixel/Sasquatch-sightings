// @vitest-environment node
/**
 * The estimate is its own phase on the project: quoted lines held separately
 * from work lines, and pushed onto the mitigation visit when the job starts.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'

const supabase = createAdminClient()
const MARKER = 'ESTIMATE_TEST'
let projectId = ''
let visitId = ''

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
      water_category: 2,
      cause_narrative: MARKER,
    })
    .select('id')
    .single()
  projectId = project!.id

  const { data: visit } = await supabase
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
      start_time: '09:00',
      end_time: '13:00',
      quoted_total: 0,
      kind: 'restoration',
      restoration_project_id: projectId,
      visit_type: 'mitigation',
      internal_notes: MARKER,
    })
    .select('id')
    .single()
  visitId = visit!.id
})

afterAll(async () => {
  await supabase.from('ops_appointments').delete().eq('internal_notes', MARKER)
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

describe('the estimate', () => {
  it('holds quoted lines without touching the work', async () => {
    await supabase.from('restoration_estimate_lines').insert([
      {
        project_id: projectId,
        restoration_catalog_code: 'EXT',
        name_snapshot: 'EXT - Water extraction',
        quantity: 400,
        unit_price: 0.58,
        line_total: 232,
        unit: 'SF',
      },
      {
        project_id: projectId,
        restoration_catalog_code: 'HAULDEBRIS',
        name_snapshot: 'HAULDEBRIS - Haul debris / dump fee',
        quantity: 1,
        unit_price: 195,
        line_total: 195,
        unit: 'EA',
      },
    ])

    const { data: estimate } = await supabase
      .from('restoration_estimate_lines')
      .select('line_total')
      .eq('project_id', projectId)
    expect(estimate).toHaveLength(2)
    expect(
      estimate!.reduce((sum, l) => sum + Number(l.line_total), 0),
    ).toBeCloseTo(427, 2)

    // The work is still empty, and so is the calendar total.
    const { data: work } = await supabase
      .from('ops_appointment_line_items')
      .select('id')
      .eq('appointment_id', visitId)
    expect(work).toHaveLength(0)

    const { data: appointment } = await supabase
      .from('ops_appointments')
      .select('quoted_total')
      .eq('id', visitId)
      .single()
    expect(Number(appointment!.quoted_total)).toBe(0)
  })

  it('starts the work from the estimate', async () => {
    const { data: lines } = await supabase
      .from('restoration_estimate_lines')
      .select('restoration_catalog_code, name_snapshot, quantity, unit_price, line_total, unit')
      .eq('project_id', projectId)

    await supabase.from('ops_appointment_line_items').insert(
      lines!.map((line) => ({
        appointment_id: visitId,
        restoration_catalog_code: line.restoration_catalog_code,
        name_snapshot: line.name_snapshot,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_total: line.line_total,
        pricing_unit_snapshot: line.unit,
      })),
    )

    const { data: work } = await supabase
      .from('ops_appointment_line_items')
      .select('line_total')
      .eq('appointment_id', visitId)
    expect(work).toHaveLength(2)

    // And the calendar card follows, via the quoted_total trigger.
    const { data: appointment } = await supabase
      .from('ops_appointments')
      .select('quoted_total')
      .eq('id', visitId)
      .single()
    expect(Number(appointment!.quoted_total)).toBeCloseTo(427, 2)
  })

  it('lets the work diverge from the estimate afterwards', async () => {
    const { data: line } = await supabase
      .from('ops_appointment_line_items')
      .select('id')
      .eq('appointment_id', visitId)
      .eq('restoration_catalog_code', 'EXT')
      .single()

    await supabase
      .from('ops_appointment_line_items')
      .update({ quantity: 550, line_total: 319 })
      .eq('id', line!.id)

    // The estimate is unchanged — it is the record of what was quoted.
    const { data: estimate } = await supabase
      .from('restoration_estimate_lines')
      .select('quantity')
      .eq('project_id', projectId)
      .eq('restoration_catalog_code', 'EXT')
      .single()
    expect(Number(estimate!.quantity)).toBe(400)

    const { data: appointment } = await supabase
      .from('ops_appointments')
      .select('quoted_total')
      .eq('id', visitId)
      .single()
    expect(Number(appointment!.quoted_total)).toBeCloseTo(514, 2)
  })

  it('goes away with the project', async () => {
    const { data: scratch } = await supabase
      .from('restoration_projects')
      .select('customer_id, service_address_id')
      .eq('id', projectId)
      .single()
    const { data: clone } = await supabase
      .from('restoration_projects')
      .insert({ ...scratch!, cause_narrative: `${MARKER}_CASCADE` })
      .select('id')
      .single()

    await supabase.from('restoration_estimate_lines').insert({
      project_id: clone!.id,
      name_snapshot: 'scratch',
      quantity: 1,
      unit_price: 10,
      line_total: 10,
    })

    await supabase.from('restoration_projects').delete().eq('id', clone!.id)

    const { data: orphans } = await supabase
      .from('restoration_estimate_lines')
      .select('id')
      .eq('project_id', clone!.id)
    expect(orphans).toHaveLength(0)
  })
})
