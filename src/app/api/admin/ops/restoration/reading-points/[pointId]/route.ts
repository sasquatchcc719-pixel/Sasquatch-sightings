import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const MATERIALS = [
  'Drywall',
  'Subfloor',
  'Framing',
  'Hardwood',
  'Concrete',
  'Insulation',
  'Plaster',
  'Tile',
  'Cabinet',
  'Trim',
]

/** Rename a point, change what it is measuring, or set its dry standard. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ pointId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { pointId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const patch: Record<string, unknown> = {}
    if ('label' in body) {
      const label = String(body.label ?? '').trim()
      if (!label) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 })
      patch.label = label
    }
    if ('material' in body) {
      const material = body.material ? String(body.material) : null
      if (material && !MATERIALS.includes(material)) {
        return NextResponse.json({ error: 'unknown material' }, { status: 400 })
      }
      patch.material = material
    }
    if ('dry_standard' in body) {
      patch.dry_standard =
        body.dry_standard === null || body.dry_standard === ''
          ? null
          : Number(body.dry_standard)
    }
    if ('map_x' in body) patch.map_x = body.map_x
    if ('map_y' in body) patch.map_y = body.map_y

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('restoration_reading_points')
      .update(patch)
      .eq('id', pointId)
      .select('id, label, material, dry_standard, map_x, map_y')
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'point_not_found' }, { status: 404 })
    return NextResponse.json({ point: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update point'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

/** Retire a point. Kept rather than deleted so its readings stay in the report. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ pointId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { pointId } = await params
    const supabase = createAdminClient()

    const { data: readings } = await supabase
      .from('restoration_readings')
      .select('id')
      .eq('reading_point_id', pointId)
      .limit(1)

    // A point with history is retired, not removed — deleting it would erase
    // readings that belong in the drying report.
    if (readings && readings.length > 0) {
      const { error } = await supabase
        .from('restoration_reading_points')
        .update({ retired_at: new Date().toISOString() })
        .eq('id', pointId)
      if (error) throw error
      return NextResponse.json({ ok: true, retired: true })
    }

    const { error } = await supabase
      .from('restoration_reading_points')
      .delete()
      .eq('id', pointId)
    if (error) throw error
    return NextResponse.json({ ok: true, retired: false })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove point'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
