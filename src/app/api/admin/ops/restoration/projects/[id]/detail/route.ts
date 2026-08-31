import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/** Everything the restoration project screen needs, in one round trip. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()

    const { data: project } = await supabase
      .from('restoration_projects')
      .select(
        `*,
         ops_customers!restoration_projects_customer_id_fkey (
           id, full_name, first_name, last_name, business_name, email, phone
         ),
         ops_service_addresses (
           id, label, street_1, street_2, city, state, zip_code, gate_code, notes
         )`,
      )
      .eq('id', id)
      .maybeSingle()

    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })

    const { data: visits } = await supabase
      .from('ops_appointments')
      .select(
        `id, appointment_date, start_time, end_time, status, visit_type, visit_sequence,
         completed_at, on_my_way_at, arrived_at, assigned_staff_user_id, internal_notes,
         restoration_visit_note,
         ops_appointment_line_items (
           id, name_snapshot, quantity, unit_price, line_total,
           restoration_catalog_code, pricing_unit_snapshot
         )`,
      )
      .eq('restoration_project_id', id)
      // Chronological, not by sequence number. Monitors are placed by dragging
      // them onto whatever slot fits, so the third one queued is often the
      // second one worked — and a list that reads 8/29, 8/31, 8/30 is a list
      // nobody can pick the right visit out of.
      .order('appointment_date')
      .order('start_time')

    const visitIds = (visits ?? []).map((v) => v.id)

    const [
      { data: queue },
      { data: equipment },
      { data: openings },
      { data: estimateLines },
      { data: areas },
      { data: billing },
      { data: points },
      { data: air },
      { data: categoryEvents },
      { data: payments },
      { data: photos },
    ] = await Promise.all([
      supabase
        .from('restoration_visit_queue')
        .select('id, visit_type, visit_sequence, duration_minutes, status, scheduled_appointment_id')
        .eq('project_id', id)
        .order('visit_sequence'),
      supabase
        .from('restoration_equipment_placements')
        .select('id, catalog_code, label, placed_at, removed_at, area_id, map_x, map_y')
        .eq('project_id', id)
        .order('placed_at'),
      supabase
        .from('restoration_area_openings')
        .select('id, area_id, kind, wall_index, offset_ft, width_ft, connects_area_id')
        .in(
          'area_id',
          (
            await supabase
              .from('restoration_areas')
              .select('id')
              .eq('project_id', id)
          ).data?.map((a) => a.id) ?? [],
        ),
      supabase
        .from('restoration_estimate_lines')
        .select(
          'id, name_snapshot, quantity, units, days, unit_price, line_total, unit, restoration_catalog_code',
        )
        .eq('project_id', id)
        .order('sort_order')
        .order('created_at'),
      supabase
        .from('restoration_areas')
        .select('id, name, floor_sqft, affected_sqft, wall_linear_ft, ceiling_height_ft, affected_wall_ceiling_sqft, insets_offsets, geometry, plan_x, plan_y, points')
        .eq('project_id', id)
        .order('sort_order')
        .order('created_at'),
      supabase
        .from('restoration_equipment_billing')
        .select('catalog_code, description, unit_price, units, unit_days, line_total')
        .eq('project_id', id),
      supabase
        .from('restoration_reading_points')
        .select(
          'id, label, material, dry_standard, map_x, map_y, area_id, restoration_readings ( id, value, taken_at, appointment_id )',
        )
        .eq('project_id', id)
        .is('retired_at', null),
      supabase
        .from('restoration_air_readings')
        .select('id, role, location, temp_f, rh_pct, taken_at, appointment_id, equipment_placement_id')
        .eq('project_id', id)
        .order('taken_at'),
      supabase
        .from('restoration_category_events')
        .select('id, water_category, effective_at, reason')
        .eq('project_id', id)
        .order('effective_at'),
      visitIds.length
        ? supabase
            .from('ops_payments')
            .select('id, kind, method, amount_cents, paid_at, invoice_id, appointment_id')
            .in('appointment_id', visitIds)
        : Promise.resolve({ data: [] as unknown[] }),
      visitIds.length
        ? supabase
            .from('ops_job_photos')
            .select('id, public_url, label, restoration_phase, restoration_area_id, appointment_id, created_at')
            .in('appointment_id', visitIds)
            .order('created_at')
        : Promise.resolve({ data: [] as unknown[] }),
    ])

    const lineTotal = (visits ?? []).reduce((sum, visit) => {
      const lines = (visit.ops_appointment_line_items ?? []) as Array<{ line_total: number }>
      return sum + lines.reduce((s, l) => s + Number(l.line_total), 0)
    }, 0)
    const equipmentTotal = (billing ?? []).reduce(
      (sum, b) => sum + Number((b as { line_total: number }).line_total),
      0,
    )
    const paidCents = ((payments ?? []) as Array<{ amount_cents: number }>).reduce(
      (sum, p) => sum + Number(p.amount_cents),
      0,
    )

    return NextResponse.json({
      project,
      visits: visits ?? [],
      queue: queue ?? [],
      equipment: equipment ?? [],
      areas: areas ?? [],
      estimate_lines: estimateLines ?? [],
      openings: openings ?? [],
      equipment_billing: billing ?? [],
      reading_points: points ?? [],
      air_readings: air ?? [],
      category_events: categoryEvents ?? [],
      payments: payments ?? [],
      photos: photos ?? [],
      totals: (() => {
        // Splitting the deductible is a discount off our own work, so it comes
        // off the bottom line and out of what the customer still owes — not
        // off any one line item, which is not where the concession lives.
        const gross = Math.round((lineTotal + equipmentTotal) * 100) / 100
        const credit = Math.max(
          0,
          Math.min(gross, Number(project.deductible_credit ?? 0) || 0),
        )
        const net = Math.round((gross - credit) * 100) / 100
        return {
          work: Math.round(lineTotal * 100) / 100,
          equipment: Math.round(equipmentTotal * 100) / 100,
          gross_subtotal: gross,
          deductible_credit: credit,
          subtotal: net,
          paid_cents: paidCents,
          balance_cents: Math.round(net * 100) - paidCents,
        }
      })(),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load project'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
