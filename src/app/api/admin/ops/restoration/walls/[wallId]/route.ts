import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ wallId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { wallId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const patch: Record<string, unknown> = {}
    for (const field of ['thickness_in', 'height_ft', 'is_partial_height', 'label']) {
      if (field in body) patch[field] = body[field]
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('restoration_plan_walls')
      .update(patch)
      .eq('id', wallId)
      .select('id, is_partial_height, label')
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'wall_not_found' }, { status: 404 })
    return NextResponse.json({ wall: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update wall'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

/** Remove a wall. Nodes left attached to nothing are cleaned up with it. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ wallId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { wallId } = await params
    const supabase = createAdminClient()

    const { data: wall } = await supabase
      .from('restoration_plan_walls')
      .select('id, project_id, start_node_id, end_node_id')
      .eq('id', wallId)
      .maybeSingle()
    if (!wall) return NextResponse.json({ error: 'wall_not_found' }, { status: 404 })

    const { error } = await supabase.from('restoration_plan_walls').delete().eq('id', wallId)
    if (error) throw error

    for (const nodeId of [wall.start_node_id, wall.end_node_id]) {
      const { data: stillUsed } = await supabase
        .from('restoration_plan_walls')
        .select('id')
        .or(`start_node_id.eq.${nodeId},end_node_id.eq.${nodeId}`)
        .limit(1)
      if (!stillUsed || stillUsed.length === 0) {
        await supabase.from('restoration_plan_nodes').delete().eq('id', nodeId)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove wall'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
