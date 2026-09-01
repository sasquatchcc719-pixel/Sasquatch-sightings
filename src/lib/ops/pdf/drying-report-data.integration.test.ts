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

describe('drying report floor plan', () => {
  const nodeIds: string[] = []
  const wallIds: string[] = []
  const openingIds: string[] = []
  const placementIds: string[] = []

  afterAll(async () => {
    await supabase
      .from('restoration_area_openings')
      .delete()
      .in('id', openingIds)
    await supabase
      .from('restoration_equipment_positions')
      .delete()
      .in('placement_id', placementIds)
    await supabase
      .from('restoration_equipment_placements')
      .delete()
      .in('id', placementIds)
    await supabase.from('restoration_plan_walls').delete().in('id', wallIds)
    await supabase.from('restoration_plan_nodes').delete().in('id', nodeIds)
  })

  it('resolves walls, an opening, and equipment at its most recent position', async () => {
    // A 10x8 rectangle room, corners at (0,0) (10,0) (10,8) (0,8).
    const { data: nodes } = await supabase
      .from('restoration_plan_nodes')
      .insert(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 8 },
          { x: 0, y: 8 },
        ].map((n) => ({ ...n, project_id: projectId })),
      )
      .select('id, x, y')
    nodeIds.push(...nodes!.map((n) => n.id))

    const [a, b, c, d] = nodes!
    const { data: walls } = await supabase
      .from('restoration_plan_walls')
      .insert(
        [
          { start_node_id: a.id, end_node_id: b.id },
          { start_node_id: b.id, end_node_id: c.id },
          { start_node_id: c.id, end_node_id: d.id },
          { start_node_id: d.id, end_node_id: a.id },
        ].map((w) => ({ ...w, project_id: projectId })),
      )
      .select('id')
    wallIds.push(...walls!.map((w) => w.id))

    const { data: opening } = await supabase
      .from('restoration_area_openings')
      .insert({
        wall_id: walls![0].id,
        kind: 'doorway',
        offset_ft: 3,
        width_ft: 3,
      })
      .select('id')
      .single()
    openingIds.push(opening!.id)

    // Placed at (1,1), then moved to (5,5) — the report should show it at (5,5).
    const { data: placement } = await supabase
      .from('restoration_equipment_placements')
      .insert({
        project_id: projectId,
        catalog_code: 'DHM>>',
        map_x: 1,
        map_y: 1,
        placed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      })
      .select('id')
      .single()
    placementIds.push(placement!.id)

    await supabase.from('restoration_equipment_positions').insert({
      placement_id: placement!.id,
      appointment_id: visitId,
      map_x: 5,
      map_y: 5,
      moved_at: new Date().toISOString(),
    })

    const built = await buildDryingReportData(supabase, projectId, false)
    const plan = built!.data.floorPlan

    expect(plan).not.toBeNull()
    expect(plan!.walls).toHaveLength(4)
    // Every wall is either 10ft or 8ft, matching the rectangle drawn.
    for (const w of plan!.walls) {
      const length = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
      expect([8, 10]).toContain(length)
    }

    expect(plan!.openings).toHaveLength(1)
    expect(plan!.openings[0].x).toBeCloseTo(3)
    expect(plan!.openings[0].y).toBeCloseTo(0)

    expect(plan!.equipment).toHaveLength(1)
    expect(plan!.equipment[0].shape).toBe('box')
    expect(plan!.equipment[0].glyph).toBe('LG')
    expect(plan!.equipment[0].x).toBe(5)
    expect(plan!.equipment[0].y).toBe(5)
  })
})

describe('drying report visit order', () => {
  const visitIds: string[] = []

  afterAll(async () => {
    await supabase.from('ops_appointments').delete().in('id', visitIds)
  })

  it('orders the daily monitoring notes by calendar date, not queue sequence', async () => {
    // Queued out of calendar order: sequence 1 lands on the 29th, sequence 3
    // on the 30th, sequence 2 on the 31st — exactly what dragging a monitor
    // onto whatever slot fits produces.
    const rows = [
      { date: '2026-08-29', sequence: 1, note: 'day one' },
      { date: '2026-08-31', sequence: 2, note: 'day three' },
      { date: '2026-08-30', sequence: 3, note: 'day two' },
    ]
    const { data: inserted } = await supabase
      .from('ops_appointments')
      .insert(
        rows.map((r) => ({
          customer_id: customerId,
          service_address_id: addressId,
          booking_channel: 'admin',
          source: 'integration_test',
          status: 'completed',
          payment_status: 'unpaid',
          quickbooks_sync_status: 'held',
          appointment_date: r.date,
          start_time: '09:00',
          end_time: '13:00',
          quoted_total: 0,
          kind: 'restoration',
          restoration_project_id: projectId,
          visit_type: 'monitor',
          visit_sequence: r.sequence,
          restoration_visit_note: r.note,
          internal_notes: MARKER,
        })),
      )
      .select('id')
    visitIds.push(...inserted!.map((v) => v.id))

    const built = await buildDryingReportData(supabase, projectId, false)
    const notedVisits = built!.data.visits.filter((v) => v.note)

    expect(notedVisits.map((v) => v.date)).toEqual([
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
    ])
  })
})
