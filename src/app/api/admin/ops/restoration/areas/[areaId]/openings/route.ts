import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const KINDS = ['doorway', 'opening', 'window', 'stairs']

/** Place a doorway or opening on a wall of a room. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ areaId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { areaId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const kind = String(body.kind ?? 'doorway')
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: 'unknown opening kind' }, { status: 400 })
    }

    // Openings host on a WALL now. The old room-edge index drifted whenever a
    // room shape changed, which is why doors ended up mid-room.
    const wallId = body.wall_id ? String(body.wall_id) : null
    if (!wallId) {
      return NextResponse.json({ error: 'wall_id is required' }, { status: 400 })
    }

    const offsetFt = Number(body.offset_ft ?? 0)
    const widthFt = Number(body.width_ft ?? 3)

    const { data, error } = await supabase
      .from('restoration_area_openings')
      .insert({
        area_id: areaId === 'none' ? null : areaId,
        wall_id: wallId,
        kind,
        wall_index: 0,
        offset_ft: Number.isFinite(offsetFt) ? Math.max(0, offsetFt) : 0,
        width_ft: Number.isFinite(widthFt) && widthFt > 0 ? widthFt : 3,
        connects_area_id: body.connects_area_id ?? null,
      })
      .select('id, area_id, wall_id, kind, offset_ft, width_ft, connects_area_id')
      .single()

    if (error) throw error
    return NextResponse.json({ opening: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to add opening'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
