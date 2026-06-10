import { mountainDateKey } from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

export class GpsShiftCompletionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function completeGpsShift(params: {
  supabase: ReturnType<typeof createAdminClient>
  shiftId: string
  endedAt: string
  actorUserId: string
  notes?: string
}) {
  const { supabase, shiftId, endedAt, actorUserId } = params
  const { data: shift, error: shiftError } = await supabase
    .from('gps_shifts')
    .select('id, started_at, user_id, status')
    .eq('id', shiftId)
    .maybeSingle()

  if (shiftError) throw shiftError
  if (!shift) throw new GpsShiftCompletionError('Shift was not found', 404)
  if (shift.status !== 'active') {
    throw new GpsShiftCompletionError('Shift is no longer active', 409)
  }

  const startMs = new Date(shift.started_at).getTime()
  const endMs = new Date(endedAt).getTime()
  if (!Number.isFinite(endMs)) {
    throw new GpsShiftCompletionError('Clock-out time is invalid', 400)
  }
  if (endMs <= startMs) {
    throw new GpsShiftCompletionError(
      'Clock-out time must be after clock-in time',
      400,
    )
  }
  if (endMs > Date.now() + 60_000) {
    throw new GpsShiftCompletionError(
      'Clock-out time cannot be in the future',
      400,
    )
  }

  const { data: staff, error: staffError } = await supabase
    .from('staff_users')
    .select('id')
    .eq('user_id', shift.user_id)
    .eq('is_active', true)
    .maybeSingle()

  if (staffError) throw staffError
  if (!staff) {
    throw new GpsShiftCompletionError(
      'No active staff record exists for this shift',
      409,
    )
  }

  const { data: points, error: pointsError } = await supabase
    .from('gps_points')
    .select('lat, lng')
    .eq('shift_id', shift.id)
    .order('captured_at')

  if (pointsError) throw pointsError

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

  const payableMinutes = Math.max(0, Math.round((endMs - startMs) / 60000))
  const { data: latestRate, error: rateError } = await supabase
    .from('ops_timesheet_entries')
    .select('hourly_rate')
    .eq('staff_user_id', staff.id)
    .gt('hourly_rate', 0)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (rateError) throw rateError

  const hourlyRate = Number(latestRate?.hourly_rate || 0)
  const baseNotes =
    params.notes ?? 'Created automatically from Clock In/Out.'
  const notes =
    hourlyRate > 0 ? baseNotes : `${baseNotes} Hourly rate needs review.`

  const { data: payrollEntry, error: payrollError } = await supabase
    .from('ops_timesheet_entries')
    .upsert(
      {
        staff_user_id: staff.id,
        gps_shift_id: shift.id,
        work_date: mountainDateKey(shift.started_at),
        started_at: shift.started_at,
        ended_at: endedAt,
        break_minutes: 0,
        payable_minutes: payableMinutes,
        hourly_rate: hourlyRate,
        work_type: 'job',
        source: 'calculated',
        status: 'draft',
        notes,
        created_by: actorUserId,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'gps_shift_id' },
    )
    .select()
    .single()

  if (payrollError) throw payrollError

  const { data: completedShift, error: updateError } = await supabase
    .from('gps_shifts')
    .update({
      ended_at: endedAt,
      status: 'completed',
      total_distance_m: Math.round(totalDistanceM),
    })
    .eq('id', shift.id)
    .eq('status', 'active')
    .select()
    .maybeSingle()

  if (updateError) throw updateError
  if (!completedShift) {
    throw new GpsShiftCompletionError('Shift is no longer active', 409)
  }

  void rollUpVisits(supabase, shift.id).catch((error) =>
    console.error('[gps/shift-completion] visit rollup error:', error),
  )

  return { shift: completedShift, payrollEntry }
}

async function rollUpVisits(
  supabase: ReturnType<typeof createAdminClient>,
  shiftId: string,
) {
  const { data: pointGroups } = await supabase
    .from('gps_points')
    .select('appointment_id, captured_at, segment_type')
    .eq('shift_id', shiftId)
    .not('appointment_id', 'is', null)
    .order('captured_at')

  if (!pointGroups || pointGroups.length === 0) return

  const byAppointment = new Map<
    string,
    { capturedAt: string; segmentType: string }[]
  >()
  for (const point of pointGroups) {
    if (!point.appointment_id) continue
    const existing = byAppointment.get(point.appointment_id) ?? []
    existing.push({
      capturedAt: point.captured_at,
      segmentType: point.segment_type,
    })
    byAppointment.set(point.appointment_id, existing)
  }

  for (const [appointmentId, points] of byAppointment.entries()) {
    const onSitePoints = points.filter(
      (point) => point.segmentType === 'on_site',
    )
    if (onSitePoints.length === 0) continue

    const arrivedAt = onSitePoints[0].capturedAt
    const departedAt = onSitePoints[onSitePoints.length - 1].capturedAt
    const onSiteMinutes = Math.round(
      (new Date(departedAt).getTime() - new Date(arrivedAt).getTime()) / 60000,
    )

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
