import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/** Pull a unit off the job (stops its per-day accrual), or put it back. */

/**
 * Record where this unit stands on a given visit.
 *
 * Upserted per (placement, visit): moving a fan twice on the same day is a
 * correction, not a second entry in the history. Moving it on a later visit
 * leaves every earlier day's layout intact, which is the point — the log should
 * show that two fans came off the wall and went into the closet on Monday.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ placementId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { placementId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const appointmentId = body.appointment_id ? String(body.appointment_id) : null
    if (!appointmentId) {
      return NextResponse.json(
        { error: 'appointment_id is required — a move belongs to a visit' },
        { status: 400 },
      )
    }

    const mapX = body.map_x == null ? null : Number(body.map_x)
    const mapY = body.map_y == null ? null : Number(body.map_y)
    if (mapX == null || mapY == null || !Number.isFinite(mapX) || !Number.isFinite(mapY)) {
      return NextResponse.json({ error: 'map_x and map_y are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('restoration_equipment_positions')
      .upsert(
        {
          placement_id: placementId,
          appointment_id: appointmentId,
          map_x: mapX,
          map_y: mapY,
          area_id: body.area_id ?? null,
          moved_at: new Date().toISOString(),
        },
        { onConflict: 'placement_id,appointment_id' },
      )
      .select('placement_id, appointment_id, map_x, map_y, moved_at')
      .single()

    if (error) throw error
    return NextResponse.json({ position: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to move equipment'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ placementId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { placementId } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    // Passing removed_at: null explicitly puts a unit back, for a mis-tap.
    const removedAt =
      body.removed_at === null
        ? null
        : body.removed_at
          ? String(body.removed_at)
          : new Date().toISOString()

    const { data, error } = await supabase
      .from('restoration_equipment_placements')
      .update({ removed_at: removedAt })
      .eq('id', placementId)
      .select('id, catalog_code, placed_at, removed_at')
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'placement_not_found' }, { status: 404 })
    return NextResponse.json({ placement: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update equipment'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ placementId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { placementId } = await params
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('restoration_equipment_placements')
      .delete()
      .eq('id', placementId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove placement'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
