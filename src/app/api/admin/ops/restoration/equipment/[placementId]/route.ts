import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/** Pull a unit off the job (stops its per-day accrual), or put it back. */
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
