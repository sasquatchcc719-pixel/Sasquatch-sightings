import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Affected areas. One room's dimensions drive extraction, tear-out and
 * antimicrobial quantities, and its volume drives how much drying equipment the
 * job needs — so the measurement is taken once and reused.
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

    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const lengthFt = Number(body.length_ft)
    const widthFt = Number(body.width_ft)
    const derivedSqft =
      Number.isFinite(lengthFt) && Number.isFinite(widthFt) && lengthFt > 0 && widthFt > 0
        ? Math.round(lengthFt * widthFt * 100) / 100
        : null
    // Perimeter is what baseboard, trim and flood cuts are measured along.
    const derivedPerimeter =
      derivedSqft != null ? Math.round((lengthFt + widthFt) * 2 * 100) / 100 : null

    const { data, error } = await supabase
      .from('restoration_areas')
      .insert({
        project_id: id,
        name,
        floor_sqft: body.floor_sqft ?? derivedSqft,
        affected_sqft: body.affected_sqft ?? derivedSqft,
        wall_linear_ft: body.wall_linear_ft ?? derivedPerimeter,
        ceiling_height_ft: body.ceiling_height_ft ?? 8,
        flooring_type: body.flooring_type ?? null,
        carpet_glue_down: body.carpet_glue_down ?? null,
        geometry:
          derivedSqft != null ? { length_ft: lengthFt, width_ft: widthFt } : null,
      })
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ area: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to add area'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('restoration_areas')
      .select('*')
      .eq('project_id', id)
      .order('sort_order')
      .order('created_at')
    if (error) throw error
    return NextResponse.json({ areas: data ?? [] })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load areas'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
