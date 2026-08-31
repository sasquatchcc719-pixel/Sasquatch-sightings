import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadEnabledCatalog } from '@/lib/ops/restoration-line-entry'
import { resolveVariant, type WaterCategory } from '@/lib/ops/restoration-catalog'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Estimate lines for a water loss.
 *
 * Same resolution rules as the work lines: the caller sends concepts, the server
 * resolves the variant and the price from the project's loss context. A quote
 * and the eventual bill therefore price the same work identically.
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

    const requested: Array<{ concept_code: string; quantity?: number | null }> =
      Array.isArray(body.lines) ? body.lines : []
    if (requested.length === 0) {
      return NextResponse.json({ error: 'lines is required' }, { status: 400 })
    }

    const { data: project } = await supabase
      .from('restoration_projects')
      .select('id, water_category, after_hours_call, estimate_signed_at')
      .eq('id', id)
      .maybeSingle()
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })

    // Once a customer has signed a number, that number stops moving. Revisions
    // belong on the work side, where the invoice is built.
    if (project.estimate_signed_at) {
      return NextResponse.json({ error: 'estimate_already_signed' }, { status: 409 })
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
        project_id: id,
        restoration_catalog_code: hit.code,
        name_snapshot: `${hit.code} - ${hit.description}`,
        quantity: safeQuantity,
        unit_price: hit.unit_price,
        line_total: round2(safeQuantity * hit.unit_price),
        unit: hit.unit,
      })
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'no_resolvable_lines', rejected }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('restoration_estimate_lines')
      .insert(rows)
      .select('id, name_snapshot, quantity, unit_price, line_total, unit, restoration_catalog_code')

    if (error) throw error
    return NextResponse.json({ lines: data ?? [], rejected })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to add estimate lines'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

/**
 * Push the estimate onto the mitigation visit as work lines.
 *
 * Most jobs come in close to the quote with a few lines changed, so the work
 * starts from the estimate and gets corrected, rather than being rebuilt.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const { data: lines } = await supabase
      .from('restoration_estimate_lines')
      .select('restoration_catalog_code, name_snapshot, quantity, unit_price, line_total, unit')
      .eq('project_id', id)
      .order('sort_order')

    if (!lines || lines.length === 0) {
      return NextResponse.json({ error: 'estimate_is_empty' }, { status: 400 })
    }

    const targetVisitId = body.appointment_id ? String(body.appointment_id) : null
    const { data: visit } = targetVisitId
      ? await supabase
          .from('ops_appointments')
          .select('id')
          .eq('id', targetVisitId)
          .maybeSingle()
      : await supabase
          .from('ops_appointments')
          .select('id')
          .eq('restoration_project_id', id)
          .eq('visit_type', 'mitigation')
          .maybeSingle()

    if (!visit) return NextResponse.json({ error: 'visit_not_found' }, { status: 404 })

    const { data: inserted, error } = await supabase
      .from('ops_appointment_line_items')
      .insert(
        lines.map((line) => ({
          appointment_id: visit.id,
          restoration_catalog_code: line.restoration_catalog_code,
          name_snapshot: line.name_snapshot,
          quantity: line.quantity,
          unit_price: line.unit_price,
          line_total: line.line_total,
          pricing_unit_snapshot: line.unit,
          duration_minutes: 0,
          buffer_minutes: 0,
        })),
      )
      .select('id')

    if (error) throw error

    await supabase
      .from('restoration_projects')
      .update({ estimate_copied_at: new Date().toISOString() })
      .eq('id', id)

    return NextResponse.json({ copied: inserted?.length ?? 0, appointment_id: visit.id })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to copy the estimate'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
