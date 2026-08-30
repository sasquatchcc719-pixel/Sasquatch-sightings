import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ openingId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { openingId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const patch: Record<string, unknown> = {}
    for (const field of ['kind', 'wall_index', 'offset_ft', 'width_ft', 'connects_area_id']) {
      if (field in body) patch[field] = body[field]
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('restoration_area_openings')
      .update(patch)
      .eq('id', openingId)
      .select('id, area_id, kind, wall_index, offset_ft, width_ft, connects_area_id')
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'opening_not_found' }, { status: 404 })
    return NextResponse.json({ opening: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update opening'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ openingId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { openingId } = await params
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('restoration_area_openings')
      .delete()
      .eq('id', openingId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove opening'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
