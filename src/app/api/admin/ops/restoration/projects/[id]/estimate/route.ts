import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadEnabledCatalog } from '@/lib/ops/restoration-line-entry'
import { resolveVariant, type WaterCategory } from '@/lib/ops/restoration-catalog'
import { isDailyBilled } from '@/lib/ops/restoration-daily-billing'

const round2 = (n: number) => Math.round(n * 100) / 100

/** A quantity a caller sent, or null — never a zero or a NaN that prices to nothing. */
function positive(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

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

    const requested: Array<{
      concept_code: string
      quantity?: number | null
      units?: number | null
      days?: number | null
    }> = Array.isArray(body.lines) ? body.lines : []
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
      // Equipment is rented by the day, so it carries the two numbers a person
      // actually says — how many, for how long — and the quantity is their
      // product. Everything else has one number and keeps it.
      const daily = isDailyBilled(hit.description, hit.unit)
      const units = positive(line.units)
      const days = daily ? positive(line.days) ?? 1 : null
      const quantity = units != null ? units * (days ?? 1) : positive(line.quantity) ?? 1

      rows.push({
        project_id: id,
        restoration_catalog_code: hit.code,
        name_snapshot: `${hit.code} - ${hit.description}`,
        quantity,
        units,
        days: units != null ? days : null,
        unit_price: hit.unit_price,
        line_total: round2(quantity * hit.unit_price),
        unit: hit.unit,
      })
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'no_resolvable_lines', rejected }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('restoration_estimate_lines')
      .insert(rows)
      .select(
        'id, name_snapshot, quantity, units, days, unit_price, line_total, unit, restoration_catalog_code',
      )

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
      .select(
        'restoration_catalog_code, name_snapshot, quantity, units, unit_price, line_total, unit',
      )
      .eq('project_id', id)
      .order('sort_order')

    if (!lines || lines.length === 0) {
      return NextResponse.json({ error: 'estimate_is_empty' }, { status: 400 })
    }

    // Equipment never becomes a work line — on the work side it is billed from
    // what is actually running and for how long, so a quoted "3 days" copied
    // here would bill the same fans twice, once as a guess and once as the real
    // thing. Instead the quoted units are PLACED: eight air movers quoted
    // become eight air movers running, clock started now, no map position yet.
    // The quote said three days; the invoice will say what they ran.
    const work = lines.filter((line) => !isDailyBilled(line.name_snapshot, line.unit))
    const equipment = lines.filter((line) => isDailyBilled(line.name_snapshot, line.unit))

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

    // Placing what was quoted, once. A second press must not double the fans,
    // so anything already running for this project is left alone.
    const { data: alreadyRunning } = await supabase
      .from('restoration_equipment_placements')
      .select('catalog_code')
      .eq('project_id', id)
      .is('removed_at', null)
    const runningByCode = new Map<string, number>()
    for (const row of alreadyRunning ?? []) {
      const code = String(row.catalog_code)
      runningByCode.set(code, (runningByCode.get(code) ?? 0) + 1)
    }

    const placedAt = new Date().toISOString()

    // Seeded equipment goes in on DAY ONE of the job, like everything else.
    // This path predated that rule and dated units to the moment the button was
    // pressed — which, since estimates are often copied a day or two in, billed
    // fans from the wrong day. Same default as the equipment route: the
    // project's first visit, falling back to today for a job with no visits.
    const { data: firstVisit } = await supabase
      .from('ops_appointments')
      .select('appointment_date')
      .eq('restoration_project_id', id)
      .order('appointment_date')
      .limit(1)
      .maybeSingle()
    const placedOn =
      firstVisit?.appointment_date ??
      new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })

    let equipmentPlaced = 0
    for (const line of equipment) {
      const code = line.restoration_catalog_code
      if (!code) continue
      // Units quoted, not the unit-days: eight fans for three days is eight.
      const quoted = Math.round(Number(line.units ?? line.quantity ?? 0))
      const shortfall = quoted - (runningByCode.get(code) ?? 0)
      if (shortfall <= 0) continue

      const { error: placeError } = await supabase
        .from('restoration_equipment_placements')
        .insert(
          Array.from({ length: Math.min(60, shortfall) }, () => ({
            project_id: id,
            catalog_code: code,
            placed_at: placedAt,
            placed_on: placedOn,
          })),
        )
      if (placeError) throw placeError
      equipmentPlaced += Math.min(60, shortfall)
    }

    if (work.length === 0) {
      return NextResponse.json(
        { copied: 0, equipment_placed: equipmentPlaced },
        { status: 200 },
      )
    }

    const { data: inserted, error } = await supabase
      .from('ops_appointment_line_items')
      .insert(
        work.map((line) => ({
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

    return NextResponse.json({
      copied: inserted?.length ?? 0,
      equipment_placed: equipmentPlaced,
      appointment_id: visit.id,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to copy the estimate'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
