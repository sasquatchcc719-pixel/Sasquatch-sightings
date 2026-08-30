import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadEnabledCatalog } from '@/lib/ops/restoration-line-entry'
import { resolveVariant, type WaterCategory } from '@/lib/ops/restoration-catalog'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Add work to a restoration visit.
 *
 * The caller sends CONCEPTS and quantities, never prices. The variant and unit
 * price are resolved server-side from the project's loss context, so a stale or
 * tampered client cannot put a Category 1 rate on a Category 3 job.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { appointmentId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const requested: Array<{ concept_code: string; quantity?: number | null }> =
      Array.isArray(body.lines) ? body.lines : []
    if (requested.length === 0) {
      return NextResponse.json({ error: 'lines is required' }, { status: 400 })
    }

    const { data: appointment } = await supabase
      .from('ops_appointments')
      .select('id, restoration_project_id, kind')
      .eq('id', appointmentId)
      .maybeSingle()

    if (!appointment) return NextResponse.json({ error: 'visit_not_found' }, { status: 404 })
    if (appointment.kind !== 'restoration' || !appointment.restoration_project_id) {
      return NextResponse.json({ error: 'not_a_restoration_visit' }, { status: 409 })
    }

    const { data: project } = await supabase
      .from('restoration_projects')
      .select('id, status, water_category, after_hours_call')
      .eq('id', appointment.restoration_project_id)
      .maybeSingle()

    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    if (project.status !== 'active') {
      return NextResponse.json({ error: 'project_not_active' }, { status: 409 })
    }

    const context = {
      waterCategory: ((project.water_category ?? 1) || 1) as WaterCategory,
      afterHours: Boolean(project.after_hours_call),
    }

    const items = await loadEnabledCatalog(supabase)
    const rows = []
    const rejected: string[] = []

    for (const line of requested) {
      const hit = resolveVariant(items, String(line.concept_code), context)
      if (!hit) {
        rejected.push(String(line.concept_code))
        continue
      }
      const quantity = Number(line.quantity ?? 1)
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
      rows.push({
        appointment_id: appointmentId,
        // name_snapshot deliberately matches the QuickBooks item name so the
        // existing name-based Product/Service resolution finds the right item.
        name_snapshot: `${hit.code} - ${hit.description}`,
        restoration_catalog_code: hit.code,
        quantity: safeQuantity,
        unit_price: hit.unit_price,
        line_total: round2(safeQuantity * hit.unit_price),
        pricing_unit_snapshot: hit.unit,
        duration_minutes: 0,
        buffer_minutes: 0,
      })
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'no_resolvable_lines', rejected }, { status: 400 })
    }

    const { data: inserted, error } = await supabase
      .from('ops_appointment_line_items')
      .insert(rows)
      .select('id, name_snapshot, quantity, unit_price, line_total, restoration_catalog_code, pricing_unit_snapshot')

    if (error) throw error
    return NextResponse.json({ lines: inserted ?? [], rejected })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to add lines'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
