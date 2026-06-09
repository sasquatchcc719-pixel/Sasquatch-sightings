import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { mountainDateKey } from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const shiftId = body.shiftId ? String(body.shiftId) : null

    // Find the shift to close (use provided id or the latest active one)
    let shiftQuery = supabase
      .from('gps_shifts')
      .select('id, started_at, user_id')
      .eq('user_id', access.id)
      .eq('status', 'active')

    if (shiftId) {
      shiftQuery = shiftQuery.eq('id', shiftId)
    }

    const { data: shift, error: findError } = await shiftQuery
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (findError) throw findError
    if (!shift) {
      return NextResponse.json(
        { error: 'No active shift found' },
        { status: 404 },
      )
    }

    const nowIso = new Date().toISOString()

    // Compute total distance from gps_points for this shift
    const { data: points } = await supabase
      .from('gps_points')
      .select('lat, lng')
      .eq('shift_id', shift.id)
      .order('captured_at')

    let totalDistanceM = 0
    if (points && points.length > 1) {
      const { haversineDistance } = await import('@/lib/gps/haversine')
      for (let i = 1; i < points.length; i++) {
        totalDistanceM += haversineDistance(
          points[i - 1].lat,
          points[i - 1].lng,
          points[i].lat,
          points[i].lng,
        )
      }
    }

    const payrollEntry = await syncShiftToPayroll({
      supabase,
      shiftId: shift.id,
      userId: access.id,
      startedAt: shift.started_at,
      endedAt: nowIso,
    })

    const { data: updated, error: updateError } = await supabase
      .from('gps_shifts')
      .update({
        ended_at: nowIso,
        status: 'completed',
        total_distance_m: Math.round(totalDistanceM),
      })
      .eq('id', shift.id)
      .select()
      .single()

    if (updateError) throw updateError

    // Roll up gps_appointment_visits for this shift
    void rollUpVisits(supabase, shift.id).catch((err) =>
      console.error('[gps/shifts/end] visit rollup error:', err),
    )

    return NextResponse.json({ shift: updated, payrollEntry })
  } catch (error) {
    console.error('[gps/shifts/end][POST]', error)
    return NextResponse.json({ error: 'Failed to end shift' }, { status: 500 })
  }
}

async function syncShiftToPayroll(params: {
  supabase: ReturnType<typeof createAdminClient>
  shiftId: string
  userId: string
  startedAt: string
  endedAt: string
}) {
  const { supabase, shiftId, userId, startedAt, endedAt } = params
  const { data: staff, error: staffError } = await supabase
    .from('staff_users')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (staffError) throw staffError
  if (!staff) return null

  const payableMinutes = Math.max(
    0,
    Math.round(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000,
    ),
  )

  const { data: latestRate } = await supabase
    .from('ops_timesheet_entries')
    .select('hourly_rate')
    .eq('staff_user_id', staff.id)
    .gt('hourly_rate', 0)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const hourlyRate = Number(latestRate?.hourly_rate || 0)
  const notes =
    hourlyRate > 0
      ? 'Created automatically from Clock In/Out.'
      : 'Created automatically from Clock In/Out. Hourly rate needs review.'

  const { data, error } = await supabase
    .from('ops_timesheet_entries')
    .upsert(
      {
        staff_user_id: staff.id,
        gps_shift_id: shiftId,
        work_date: mountainDateKey(startedAt),
        started_at: startedAt,
        ended_at: endedAt,
        break_minutes: 0,
        payable_minutes: payableMinutes,
        hourly_rate: hourlyRate,
        work_type: 'job',
        source: 'calculated',
        status: 'draft',
        notes,
        created_by: userId,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'gps_shift_id' },
    )
    .select()
    .single()

  if (error) throw error
  return data
}

async function rollUpVisits(
  supabase: ReturnType<typeof createAdminClient>,
  shiftId: string,
) {
  // Get all appointment IDs that appear in gps_points for this shift
  const { data: pointGroups } = await supabase
    .from('gps_points')
    .select('appointment_id, captured_at, segment_type')
    .eq('shift_id', shiftId)
    .not('appointment_id', 'is', null)
    .order('captured_at')

  if (!pointGroups || pointGroups.length === 0) return

  // Group by appointment_id
  const byAppt = new Map<
    string,
    { capturedAt: string; segmentType: string }[]
  >()
  for (const pt of pointGroups) {
    if (!pt.appointment_id) continue
    const existing = byAppt.get(pt.appointment_id) ?? []
    existing.push({ capturedAt: pt.captured_at, segmentType: pt.segment_type })
    byAppt.set(pt.appointment_id, existing)
  }

  for (const [appointmentId, pts] of byAppt.entries()) {
    const onSitePts = pts.filter((p) => p.segmentType === 'on_site')
    if (onSitePts.length === 0) continue

    const arrivedAt = onSitePts[0].capturedAt
    const departedAt = onSitePts[onSitePts.length - 1].capturedAt
    const onSiteMs =
      new Date(departedAt).getTime() - new Date(arrivedAt).getTime()
    const onSiteMinutes = Math.round(onSiteMs / 60000)

    await supabase.from('gps_appointment_visits').upsert(
      {
        shift_id: shiftId,
        appointment_id: appointmentId,
        arrived_at: arrivedAt,
        departed_at: departedAt,
        on_site_minutes: onSiteMinutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shift_id,appointment_id' },
    )
  }
}
