import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ areaId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { areaId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const field of [
      'name',
      'floor_sqft',
      'affected_sqft',
      'wall_linear_ft',
      'ceiling_height_ft',
      'flooring_type',
      'carpet_glue_down',
      'plan_x',
      'plan_y',
      'rotation_deg',
      'points',
    ]) {
      if (field in body) patch[field] = body[field]
    }

    const { data, error } = await supabase
      .from('restoration_areas')
      .update(patch)
      .eq('id', areaId)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'area_not_found' }, { status: 404 })
    return NextResponse.json({ area: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update area'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ areaId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { areaId } = await params
    const supabase = createAdminClient()
    const { error } = await supabase.from('restoration_areas').delete().eq('id', areaId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove area'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
