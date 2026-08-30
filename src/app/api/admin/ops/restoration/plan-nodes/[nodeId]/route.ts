import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { snapToGrid } from '@/lib/ops/restoration-walls'

/** Move a corner. Every wall attached to it follows, because they share it. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { nodeId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const x = snapToGrid(Number(body.x))
    const y = snapToGrid(Number(body.y))
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return NextResponse.json({ error: 'x and y are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('restoration_plan_nodes')
      .update({ x, y })
      .eq('id', nodeId)
      .select('id, x, y')
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'node_not_found' }, { status: 404 })
    return NextResponse.json({ node: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to move corner'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
