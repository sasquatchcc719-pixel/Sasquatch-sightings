// @vitest-environment node
/**
 * Wall drawing against the real database: nodes are reused rather than
 * duplicated, walls persist, and deleting a wall cleans up orphaned corners.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { findNodeNear, resolveWalls, snapToGrid } from '@/lib/ops/restoration-walls'

const supabase = createAdminClient()
const MARKER = 'WALLS_INTEGRATION_TEST'
let projectId = ''

/** Mirrors the walls route: reuse a nearby node, otherwise create one. */
async function nodeAt(rawX: number, rawY: number): Promise<string> {
  const x = snapToGrid(rawX)
  const y = snapToGrid(rawY)
  const { data: existing } = await supabase
    .from('restoration_plan_nodes')
    .select('id, x, y')
    .eq('project_id', projectId)
  const near = findNodeNear(
    (existing ?? []).map((n) => ({ id: n.id, x: Number(n.x), y: Number(n.y) })),
    x,
    y,
  )
  if (near) return near.id
  const { data } = await supabase
    .from('restoration_plan_nodes')
    .insert({ project_id: projectId, x, y })
    .select('id')
    .single()
  return data!.id
}

async function drawWall(x1: number, y1: number, x2: number, y2: number) {
  const startId = await nodeAt(x1, y1)
  const endId = await nodeAt(x2, y2)
  if (startId === endId) return null
  const { data } = await supabase
    .from('restoration_plan_walls')
    .insert({ project_id: projectId, start_node_id: startId, end_node_id: endId })
    .select('id')
    .single()
  return data?.id ?? null
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
})

afterAll(async () => {
  await supabase.from('restoration_projects').delete().eq('id', projectId)
})

describe('drawing walls', () => {
  it('persists a wall and its two corners', async () => {
    const wallId = await drawWall(0, 0, 20, 0)
    expect(wallId).toBeTruthy()

    const { data: nodes } = await supabase
      .from('restoration_plan_nodes')
      .select('id')
      .eq('project_id', projectId)
    expect(nodes).toHaveLength(2)
  })

  it('reuses a corner instead of stacking a second one on top of it', async () => {
    // Second wall starts where the first ended, a few inches off.
    await drawWall(20.2, 0.1, 20, 15)
    const { data: nodes } = await supabase
      .from('restoration_plan_nodes')
      .select('id')
      .eq('project_id', projectId)
    // Three corners, not four: the shared one was reused.
    expect(nodes).toHaveLength(3)
  })

  it('closes a room and measures it', async () => {
    await drawWall(20, 15, 0, 15)
    await drawWall(0, 15, 0, 0)

    const [{ data: nodes }, { data: walls }] = await Promise.all([
      supabase.from('restoration_plan_nodes').select('id, x, y').eq('project_id', projectId),
      supabase
        .from('restoration_plan_walls')
        .select('id, start_node_id, end_node_id')
        .eq('project_id', projectId),
    ])

    expect(nodes).toHaveLength(4)
    expect(walls).toHaveLength(4)

    const resolved = resolveWalls(
      nodes!.map((n) => ({ id: n.id, x: Number(n.x), y: Number(n.y) })),
      walls!.map((w) => ({
        id: w.id,
        startNodeId: w.start_node_id,
        endNodeId: w.end_node_id,
      })),
    )
    const total = resolved.reduce((sum, w) => sum + w.lengthFt, 0)
    expect(total).toBeCloseTo(70, 1)
  })

  it('hosts a door on a wall', async () => {
    const { data: wall } = await supabase
      .from('restoration_plan_walls')
      .select('id')
      .eq('project_id', projectId)
      .limit(1)
      .single()

    const { error } = await supabase.from('restoration_area_openings').insert({
      wall_id: wall!.id,
      kind: 'doorway',
      wall_index: 0,
      offset_ft: 6,
      width_ft: 3,
    })
    expect(error).toBeNull()
  })

  it('refuses a wall with the same node at both ends', async () => {
    const nodeId = await nodeAt(0, 0)
    const { error } = await supabase.from('restoration_plan_walls').insert({
      project_id: projectId,
      start_node_id: nodeId,
      end_node_id: nodeId,
    })
    expect(error).not.toBeNull()
  })

  it('removes walls and nodes with the project', async () => {
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

    const { data: node } = await supabase
      .from('restoration_plan_nodes')
      .insert({ project_id: clone!.id, x: 1, y: 1 })
      .select('id')
      .single()

    await supabase.from('restoration_projects').delete().eq('id', clone!.id)

    const { data: orphans } = await supabase
      .from('restoration_plan_nodes')
      .select('id')
      .eq('id', node!.id)
    expect(orphans).toHaveLength(0)
  })
})
