import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { snapToGrid } from '@/lib/ops/restoration-walls'

/**
 * Move several corners at once — dragging a whole room.
 *
 * Every corner of the loop has to move in the same write, or the walls tear
 * apart between requests.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const moves: Array<{ id: string; x: number; y: number }> = Array.isArray(body.moves)
      ? body.moves
      : []
    if (moves.length === 0) {
      return NextResponse.json({ error: 'moves is required' }, { status: 400 })
    }

    const updated = []
    for (const move of moves) {
      const x = snapToGrid(Number(move.x))
      const y = snapToGrid(Number(move.y))
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const { data } = await supabase
        .from('restoration_plan_nodes')
        .update({ x, y })
        .eq('id', String(move.id))
        .eq('project_id', id)
        .select('id, x, y')
        .maybeSingle()
      if (data) updated.push(data)
    }

    return NextResponse.json({ nodes: updated })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to move room'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
