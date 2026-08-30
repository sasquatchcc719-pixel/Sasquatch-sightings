import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Equipment placed on the job IS the billing quantity — six fans for three days
 * is eighteen unit-days, computed rather than done in your head. Pulling a unit
 * stops its accrual, which is why removal is a first-class action.
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

    const code = String(body.catalog_code ?? '')
    const count = Math.max(1, Math.min(60, Number(body.count ?? 1)))
    if (!code) return NextResponse.json({ error: 'catalog_code is required' }, { status: 400 })

    const { data: item } = await supabase
      .from('restoration_catalog_items')
      .select('code, is_enabled')
      .eq('code', code)
      .maybeSingle()
    if (!item || !item.is_enabled) {
      return NextResponse.json({ error: 'catalog_item_not_available' }, { status: 400 })
    }

    const { data: project } = await supabase
      .from('restoration_projects')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    if (project.status !== 'active') {
      return NextResponse.json({ error: 'project_not_active' }, { status: 409 })
    }

    const placedAt = body.placed_at ? String(body.placed_at) : new Date().toISOString()
    const { data, error } = await supabase
      .from('restoration_equipment_placements')
      .insert(
        Array.from({ length: count }, () => ({
          project_id: id,
          catalog_code: code,
          area_id: body.area_id ?? null,
          label: body.label ?? null,
          map_x: body.map_x ?? null,
          map_y: body.map_y ?? null,
          placed_at: placedAt,
        })),
      )
      .select('id, catalog_code, placed_at, removed_at')

    if (error) throw error
    return NextResponse.json({ placed: data ?? [] })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to place equipment'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

/** Current placements plus what they have accrued so far. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()

    const [{ data: placements }, { data: billing }] = await Promise.all([
      supabase
        .from('restoration_equipment_placements')
        .select('id, catalog_code, label, placed_at, removed_at, area_id')
        .eq('project_id', id)
        .order('placed_at'),
      supabase
        .from('restoration_equipment_billing')
        .select('catalog_code, description, unit_price, units, unit_days, line_total')
        .eq('project_id', id),
    ])

    return NextResponse.json({
      placements: placements ?? [],
      billing: billing ?? [],
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load equipment'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
