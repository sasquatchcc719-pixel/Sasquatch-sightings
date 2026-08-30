// @vitest-environment node
/**
 * Deleting a measured room must take its walls off the plan with it, and must
 * leave hand-drawn walls alone.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'

const supabase = createAdminClient()
const MARKER = 'AREA_WALLS_TEST'
let projectId = ''
let areaId = ''

async function node(x: number, y: number) {
  const { data } = await supabase
    .from('restoration_plan_nodes')
    .insert({ project_id: projectId, x, y })
    .select('id')
    .single()
  return data!.id
}

async function wall(a: string, b: string, area: string | null) {
  const { data } = await supabase
    .from('restoration_plan_walls')
    .insert({ project_id: projectId, start_node_id: a, end_node_id: b, area_id: area })
    .select('id')
    .single()
  return data!.id
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

  const { data: area } = await supabase
    .from('restoration_areas')
    .insert({
      project_id: projectId,
      name: 'Basement',
      affected_sqft: 300,
      geometry: { length_ft: 20, width_ft: 15 },
    })
    .select('id')
    .single()
  areaId = area!.id
})

afterAll(async () => {
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

describe('deleting a room', () => {
  it('takes its walls and corners with it', async () => {
    const a = await node(0, 0)
    const b = await node(20, 0)
    const c = await node(20, 15)
    await wall(a, b, areaId)
    await wall(b, c, areaId)

    const before = await supabase
      .from('restoration_plan_walls')
      .select('id')
      .eq('project_id', projectId)
    expect(before.data).toHaveLength(2)

    await supabase.from('restoration_areas').delete().eq('id', areaId)

    const after = await supabase
      .from('restoration_plan_walls')
      .select('id')
      .eq('project_id', projectId)
    expect(after.data).toHaveLength(0)

    // The corners those walls used are gone too, rather than left as litter.
    const nodes = await supabase
      .from('restoration_plan_nodes')
      .select('id')
      .eq('project_id', projectId)
    expect(nodes.data).toHaveLength(0)
  })

  it('leaves hand-drawn walls alone', async () => {
    const { data: area } = await supabase
      .from('restoration_areas')
      .insert({
        project_id: projectId,
        name: 'Bathroom',
        geometry: { length_ft: 8, width_ft: 4 },
      })
      .select('id')
      .single()

    const a = await node(0, 0)
    const b = await node(8, 0)
    const c = await node(30, 30)
    const roomWall = await wall(a, b, area!.id)
    const freehand = await wall(b, c, null)

    await supabase.from('restoration_areas').delete().eq('id', area!.id)

    const { data: remaining } = await supabase
      .from('restoration_plan_walls')
      .select('id')
      .eq('project_id', projectId)
    expect(remaining!.map((w) => w.id)).toEqual([freehand])
    expect(remaining!.map((w) => w.id)).not.toContain(roomWall)
  })

  it('keeps a corner that another wall still uses', async () => {
    const { data: nodesBefore } = await supabase
      .from('restoration_plan_nodes')
      .select('id')
      .eq('project_id', projectId)
    // The freehand wall still holds both of its corners.
    expect(nodesBefore).toHaveLength(2)
  })
})
