// @vitest-environment node
/**
 * Monitor-day readings against the real database: points are created once and
 * re-read on later visits, and the three reading kinds stay separate.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'

const MARKER = 'RESTORATION_READINGS_TEST'
const supabase = createAdminClient()

let projectId = ''
let pointId = ''

beforeAll(async () => {
  const { data: addr } = await supabase
    .from('ops_service_addresses')
    .select('id, customer_id')
    .limit(1)
    .single()

  const { data: project } = await supabase
    .from('restoration_projects')
    .select('id')
    .limit(0)
  void project

  const { data: created } = await supabase
    .from('restoration_projects')
    .insert({
      customer_id: addr!.customer_id,
      service_address_id: addr!.id,
      water_category: 3,
      cause_narrative: MARKER,
    })
    .select('id')
    .single()
  projectId = created!.id

  const { data: point } = await supabase
    .from('restoration_reading_points')
    .insert({
      project_id: projectId,
      label: 'North wall, base',
      material: 'Drywall',
      dry_standard: 16,
    })
    .select('id')
    .single()
  pointId = point!.id
})

afterAll(async () => {
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

describe('restoration readings', () => {
  it('records a drying trend against one point', async () => {
    const base = Date.now()
    for (const [index, value] of [24.5, 19.2, 14.1].entries()) {
      const { error } = await supabase.from('restoration_readings').insert({
        reading_point_id: pointId,
        value,
        taken_at: new Date(base + index * 86_400_000).toISOString(),
      })
      expect(error).toBeNull()
    }

    const { data: readings } = await supabase
      .from('restoration_readings')
      .select('value, taken_at')
      .eq('reading_point_id', pointId)
      .order('taken_at')

    expect(readings!.map((r) => Number(r.value))).toEqual([24.5, 19.2, 14.1])

    // The last reading is at or below the dry standard, which is what closes a job.
    const { data: point } = await supabase
      .from('restoration_reading_points')
      .select('dry_standard')
      .eq('id', pointId)
      .single()
    expect(Number(readings!.at(-1)!.value)).toBeLessThan(Number(point!.dry_standard))
  })

  it('keeps ambient readings off the map, and lets the label be a place', async () => {
    // This test used to assert that 'basement' was REJECTED — back when
    // `location` carried the meaning and had to be one of three values. `role`
    // carries it now, and that old constraint went on rejecting every reading
    // whose role was not literally 'affected'. The test was defending the bug
    // that cost Charles eleven readings in a customer's basement.
    const { error: ok } = await supabase.from('restoration_air_readings').insert([
      { project_id: projectId, role: 'affected', location: 'Basement', temp_f: 78, rh_pct: 62 },
      { project_id: projectId, role: 'unaffected', location: 'Upstairs hall', temp_f: 71, rh_pct: 44 },
      { project_id: projectId, role: 'outside', location: 'Front porch', temp_f: 66, rh_pct: 38 },
    ])
    expect(ok).toBeNull()

    // A label may be anything a person would write, but not nothing.
    const { error: blank } = await supabase
      .from('restoration_air_readings')
      .insert({ project_id: projectId, role: 'outside', location: '  ', temp_f: 70 })
    expect(blank).not.toBeNull()

    const { data: air } = await supabase
      .from('restoration_air_readings')
      .select('location')
      .eq('project_id', projectId)
    expect(air).toHaveLength(3)
  })

  it('removes points and readings with the project', async () => {
    const { data: scratch } = await supabase
      .from('restoration_projects')
      .select('id, service_address_id, customer_id')
      .eq('id', projectId)
      .single()

    const { data: clone } = await supabase
      .from('restoration_projects')
      .insert({
        customer_id: scratch!.customer_id,
        service_address_id: scratch!.service_address_id,
        cause_narrative: `${MARKER}_CASCADE`,
      })
      .select('id')
      .single()

    await supabase.from('restoration_reading_points').insert({
      project_id: clone!.id,
      label: 'scratch point',
    })

    await supabase.from('restoration_projects').delete().eq('id', clone!.id)

    const { data: orphans } = await supabase
      .from('restoration_reading_points')
      .select('id')
      .eq('project_id', clone!.id)
    expect(orphans).toHaveLength(0)
  })
})

describe('correcting a moisture reading', () => {
  it('changes one reading without touching the rest of the point', async () => {
    const { data: point } = await supabase
      .from('restoration_reading_points')
      .insert({ project_id: projectId, label: 'Correction test', material: 'Framing' })
      .select('id')
      .single()

    const { data: readings } = await supabase
      .from('restoration_readings')
      .insert([
        { reading_point_id: point!.id, value: 28 },
        { reading_point_id: point!.id, value: 340 }, // meant 34
      ])
      .select('id, value')

    const wrong = readings!.find((r) => Number(r.value) === 340)!
    await supabase.from('restoration_readings').update({ value: 34 }).eq('id', wrong.id)

    const { data: after } = await supabase
      .from('restoration_readings')
      .select('value')
      .eq('reading_point_id', point!.id)
      .order('value')
    expect(after!.map((r) => Number(r.value))).toEqual([28, 34])

    // Removing one leaves the other, which deleting the point would not.
    await supabase.from('restoration_readings').delete().eq('id', wrong.id)
    const { data: left } = await supabase
      .from('restoration_readings')
      .select('value')
      .eq('reading_point_id', point!.id)
    expect(left).toHaveLength(1)

    await supabase.from('restoration_reading_points').delete().eq('id', point!.id)
  })
})
