import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

interface IncomingPoint {
  shiftId: string
  capturedAt: string
  lat: number
  lng: number
  accuracyM?: number | null
  speedMps?: number | null
  headingDeg?: number | null
  segmentType: 'travel' | 'on_site' | 'idle' | 'unknown'
  appointmentId?: string | null
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const body = await request.json()

    const points: IncomingPoint[] = Array.isArray(body.points)
      ? body.points
      : []

    if (points.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 })
    }

    // Validate all shift_ids belong to this user (security check)
    const shiftIds = [...new Set(points.map((p) => p.shiftId).filter(Boolean))]
    if (shiftIds.length === 0) {
      return NextResponse.json({ error: 'Missing shiftId' }, { status: 400 })
    }

    const { data: validShifts } = await supabase
      .from('gps_shifts')
      .select('id')
      .eq('user_id', access.id)
      .in('id', shiftIds)

    const validIds = new Set((validShifts ?? []).map((s) => s.id))
    const safe = points.filter((p) => validIds.has(p.shiftId))

    if (safe.length === 0) {
      return NextResponse.json({ error: 'No valid shift IDs' }, { status: 403 })
    }

    // Insert GPS points
    const { error: insertError } = await supabase.from('gps_points').insert(
      safe.map((p) => ({
        shift_id: p.shiftId,
        captured_at: p.capturedAt,
        lat: p.lat,
        lng: p.lng,
        accuracy_m: p.accuracyM ?? null,
        speed_mps: p.speedMps ?? null,
        heading_deg: p.headingDeg ?? null,
        segment_type: p.segmentType ?? 'unknown',
        appointment_id: p.appointmentId ?? null,
      })),
    )

    if (insertError) throw insertError

    // Handle geofence arrivals — stamp arrived_at on appointments (shadow mode)
    const arrivals = safe.filter(
      (p) => p.segmentType === 'on_site' && p.appointmentId,
    )

    if (arrivals.length > 0) {
      const uniqueApptIds = [...new Set(arrivals.map((p) => p.appointmentId!))]
      await Promise.allSettled(
        uniqueApptIds.map((apptId) =>
          stampArrival(
            supabase,
            apptId,
            arrivals.find((a) => a.appointmentId === apptId)!.capturedAt,
            access.id,
          ),
        ),
      )
    }

    return NextResponse.json({ ok: true, inserted: safe.length })
  } catch (error) {
    console.error('[gps/points][POST]', error)
    return NextResponse.json(
      { error: 'Failed to store GPS points' },
      { status: 500 },
    )
  }
}

async function stampArrival(
  supabase: ReturnType<typeof import('@/supabase/server').createAdminClient>,
  appointmentId: string,
  capturedAt: string,
  userId: string,
) {
  // Only stamp if on_my_way_at is set and arrived_at is NOT yet set
  const { data: appt } = await supabase
    .from('ops_appointments')
    .select('id, on_my_way_at, arrived_at, status')
    .eq('id', appointmentId)
    .maybeSingle()

  if (!appt || !appt.on_my_way_at || appt.arrived_at) return

  await supabase
    .from('ops_appointments')
    .update({
      arrived_at: capturedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)

  // Audit event
  await supabase.from('ops_appointment_status_events').insert({
    appointment_id: appointmentId,
    from_status: appt.status,
    to_status: appt.status,
    changed_by: userId,
    notes: 'GPS arrival detected at geofence (shadow mode — no billing impact)',
  })
}
