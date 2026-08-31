import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { AIR_ROLES } from '@/lib/ops/restoration-psychrometry'
import { readingTimestamp } from '@/lib/ops/restoration-reading-time'
import { defaultDryStandard } from '@/lib/ops/restoration-moisture'

/**
 * Monitor-day readings. Three kinds, deliberately separate:
 *  - material  : a moisture percentage at a point placed on day 1
 *  - dehu      : inlet/outlet temp and RH at a dehumidifier
 *  - air       : ambient readings, which are not spatial and so are not on the map
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()
    const appointmentId = body.appointment_id ? String(body.appointment_id) : null
    const kind = String(body.kind ?? '')

    /**
     * A reading is dated by the VISIT it belongs to, not by the moment it was
     * typed. Readings get entered in the truck afterwards, or the next morning,
     * or on Monday for Sunday's monitor — and `now()` puts Sunday's numbers on
     * Monday, where they collapse two visits into one column of the drying
     * chart and print the wrong date in a report an adjuster reads.
     *
     * Clamped to now, so a reading entered against a visit still in the future
     * cannot be stamped ahead of today.
     */
    const { data: visit } = appointmentId
      ? await supabase
          .from('ops_appointments')
          .select('appointment_date, start_time')
          .eq('id', appointmentId)
          .maybeSingle()
      : { data: null }
    const takenAt = readingTimestamp(visit, new Date())

    if (kind === 'material') {
      const value = Number(body.value)
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: 'value is required' }, { status: 400 })
      }
      const { data, error } = await supabase
        .from('restoration_readings')
        .insert({
          reading_point_id: String(body.reading_point_id),
          appointment_id: appointmentId,
          value,
          taken_at: takenAt,
          note: body.note ?? null,
          recorded_by_user_id: access.id,
        })
        .select('id, reading_point_id, value, taken_at')
        .single()
      if (error) throw error
      return NextResponse.json({ reading: data })
    }

    if (kind === 'dehu') {
      const { data, error } = await supabase
        .from('restoration_dehu_readings')
        .insert({
          equipment_placement_id: String(body.equipment_placement_id),
          appointment_id: appointmentId,
          inlet_temp_f: body.inlet_temp_f ?? null,
          inlet_rh_pct: body.inlet_rh_pct ?? null,
          outlet_temp_f: body.outlet_temp_f ?? null,
          outlet_rh_pct: body.outlet_rh_pct ?? null,
          taken_at: takenAt,
          note: body.note ?? null,
        })
        .select('id, equipment_placement_id, taken_at')
        .single()
      if (error) throw error
      return NextResponse.json({ reading: data })
    }

    if (kind === 'air') {
      // The role is what makes the reading usable: outlet air from a dehu and
      // ambient air in the same room are the same two numbers, and only the
      // role says which is which.
      const role = String(body.role ?? '')
      if (!AIR_ROLES.some((r) => r.value === role)) {
        return NextResponse.json(
          { error: `role must be one of ${AIR_ROLES.map((r) => r.value).join(', ')}` },
          { status: 400 },
        )
      }

      const tempF = body.temp_f == null ? null : Number(body.temp_f)
      const rhPct = body.rh_pct == null ? null : Number(body.rh_pct)
      if (tempF == null || rhPct == null || !Number.isFinite(tempF) || !Number.isFinite(rhPct)) {
        return NextResponse.json(
          { error: 'temperature and relative humidity are both required' },
          { status: 400 },
        )
      }
      if (rhPct < 0 || rhPct > 100) {
        return NextResponse.json({ error: 'relative humidity must be 0-100' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('restoration_air_readings')
        .insert({
          project_id: id,
          appointment_id: appointmentId,
          role,
          equipment_placement_id: body.equipment_placement_id ?? null,
          // Kept for the human reading the report: "Basement", "Dehu by stairs".
          location: String(body.location ?? '').trim() || role,
          temp_f: tempF,
          rh_pct: rhPct,
          taken_at: takenAt,
          note: body.note ?? null,
        })
        .select('id, role, location, temp_f, rh_pct, taken_at')
        .single()
      if (error) throw error
      return NextResponse.json({ reading: data })
    }

    return NextResponse.json({ error: 'kind must be material, dehu, or air' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to record reading'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

/** Create a material reading point. Placed once, tapped on every later visit. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const label = String(body.label ?? '').trim()
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })

    const { data, error } = await supabase
      .from('restoration_reading_points')
      .insert({
        project_id: id,
        area_id: body.area_id ?? null,
        label,
        material: body.material ?? null,
        map_x: body.map_x ?? null,
        map_y: body.map_y ?? null,
        // Without a standard the pin has no colour, so the material's usual
        // number is filled in and stays editable. On a real job it should be a
        // meter reading from unaffected material of the same kind.
        dry_standard: body.dry_standard ?? defaultDryStandard(body.material),
      })
      .select('id, label, material, dry_standard, map_x, map_y')
      .single()

    if (error) throw error
    return NextResponse.json({ point: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create point'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
