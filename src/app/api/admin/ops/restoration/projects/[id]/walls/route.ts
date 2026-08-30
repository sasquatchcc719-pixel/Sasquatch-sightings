import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { findNodeNear, snapToGrid, type PlanNode } from '@/lib/ops/restoration-walls'

/** Nodes, walls and their openings for a project. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()

    const [{ data: nodes }, { data: walls }] = await Promise.all([
      supabase.from('restoration_plan_nodes').select('id, x, y').eq('project_id', id),
      supabase
        .from('restoration_plan_walls')
        .select('id, start_node_id, end_node_id, thickness_in, is_partial_height, label')
        .eq('project_id', id),
    ])

    const wallIds = (walls ?? []).map((w) => w.id)
    const { data: openings } = wallIds.length
      ? await supabase
          .from('restoration_area_openings')
          .select('id, wall_id, kind, offset_ft, width_ft')
          .in('wall_id', wallIds)
      : { data: [] as unknown[] }

    return NextResponse.json({
      nodes: nodes ?? [],
      walls: walls ?? [],
      openings: openings ?? [],
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load plan'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

/**
 * Draw a wall between two points.
 *
 * Each end reuses a nearby existing node when there is one, so walls drawn to
 * an existing corner actually join it instead of leaving two nodes an inch
 * apart — which is what keeps a room closed when a corner is later dragged.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> =
      Array.isArray(body.segments)
        ? body.segments
        : [{ x1: body.x1, y1: body.y1, x2: body.x2, y2: body.y2 }]

    const { data: existing } = await supabase
      .from('restoration_plan_nodes')
      .select('id, x, y')
      .eq('project_id', id)

    const nodes: PlanNode[] = (existing ?? []).map((n) => ({
      id: n.id,
      x: Number(n.x),
      y: Number(n.y),
    }))

    async function nodeAt(rawX: number, rawY: number): Promise<string | null> {
      const x = snapToGrid(Number(rawX))
      const y = snapToGrid(Number(rawY))
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null

      const near = findNodeNear(nodes, x, y)
      if (near) return near.id

      const { data: created, error } = await supabase
        .from('restoration_plan_nodes')
        .insert({ project_id: id, x, y })
        .select('id, x, y')
        .single()
      if (error || !created) return null
      nodes.push({ id: created.id, x: Number(created.x), y: Number(created.y) })
      return created.id
    }

    const createdWalls = []
    for (const segment of segments) {
      const startId = await nodeAt(segment.x1, segment.y1)
      const endId = await nodeAt(segment.x2, segment.y2)
      // A zero-length wall is a mis-tap, not a wall.
      if (!startId || !endId || startId === endId) continue

      const { data: wall, error } = await supabase
        .from('restoration_plan_walls')
        .insert({
          project_id: id,
          start_node_id: startId,
          end_node_id: endId,
          is_partial_height: Boolean(body.is_partial_height),
          label: body.label ?? null,
        })
        .select('id, start_node_id, end_node_id, is_partial_height, label')
        .single()
      if (error) throw error
      createdWalls.push(wall)
    }

    return NextResponse.json({ walls: createdWalls })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to draw wall'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
