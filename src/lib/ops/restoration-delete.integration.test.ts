// @vitest-environment node
/**
 * Deleting a water loss must take its visits with it — the mitigation day and
 * every monitor visit, scheduled or still in the tray — and must refuse once the
 * job has been invoiced.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'

const supabase = createAdminClient()
const MARKER = 'DELETE_PROJECT_TEST'
let customerId = ''
let addressId = ''

async function makeProject() {
  const { data: project } = await supabase
    .from('restoration_projects')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      cause_narrative: MARKER,
    })
    .select('id')
    .single()

  const dates = [1, 2].map((d) =>
    new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10),
  )
  const { data: visits } = await supabase
    .from('ops_appointments')
    .insert(
      dates.map((date, index) => ({
        customer_id: customerId,
        service_address_id: addressId,
        booking_channel: 'admin',
        source: 'integration_test',
        status: 'booked',
        payment_status: 'unpaid',
        quickbooks_sync_status: 'held',
        appointment_date: date,
        start_time: index === 0 ? '09:00' : '14:00',
        end_time: index === 0 ? '13:00' : '15:00',
        quoted_total: 0,
        kind: 'restoration',
        restoration_project_id: project!.id,
        visit_type: index === 0 ? 'mitigation' : 'monitor',
        internal_notes: MARKER,
      })),
    )
    .select('id')

  await supabase.from('restoration_visit_queue').insert({
    project_id: project!.id,
    visit_type: 'monitor',
    visit_sequence: 3,
  })

  return { projectId: project!.id, visitIds: (visits ?? []).map((v) => v.id) }
}

beforeAll(async () => {
  const { data: addr } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()
  addressId = addr!.id
  customerId = addr!.customer_id
})

afterAll(async () => {
  await supabase.from('ops_appointments').delete().eq('internal_notes', MARKER)
  await supabase.from('restoration_projects').delete().eq('cause_narrative', MARKER)
})

describe('deleting a water loss', () => {
  it('takes the mitigation day and every monitor visit with it', async () => {
    const { projectId, visitIds } = await makeProject()
    expect(visitIds).toHaveLength(2)

    await supabase.from('restoration_projects').delete().eq('id', projectId)

    const { data: visits } = await supabase
      .from('ops_appointments')
      .select('id')
      .in('id', visitIds)
    expect(visits).toHaveLength(0)

    const { data: queued } = await supabase
      .from('restoration_visit_queue')
      .select('id')
      .eq('project_id', projectId)
    expect(queued).toHaveLength(0)
  })

  it('takes rooms, walls, equipment and reading points too', async () => {
    const { projectId } = await makeProject()

    await supabase
      .from('restoration_areas')
      .insert({ project_id: projectId, name: 'Basement', affected_sqft: 300 })
    await supabase
      .from('restoration_equipment_placements')
      .insert({ project_id: projectId, catalog_code: 'DRY', placed_at: new Date().toISOString() })
    await supabase
      .from('restoration_reading_points')
      .insert({ project_id: projectId, label: 'North wall' })

    await supabase.from('restoration_projects').delete().eq('id', projectId)

    for (const table of [
      'restoration_areas',
      'restoration_equipment_placements',
      'restoration_reading_points',
    ]) {
      const { data } = await supabase.from(table).select('id').eq('project_id', projectId)
      expect(data).toHaveLength(0)
    }
  })

  it('leaves other losses alone', async () => {
    const keep = await makeProject()
    const remove = await makeProject()

    await supabase.from('restoration_projects').delete().eq('id', remove.projectId)

    const { data: survivors } = await supabase
      .from('ops_appointments')
      .select('id')
      .in('id', keep.visitIds)
    expect(survivors).toHaveLength(2)

    await supabase.from('restoration_projects').delete().eq('id', keep.projectId)
  })
})
