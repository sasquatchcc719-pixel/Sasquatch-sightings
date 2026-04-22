import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Returns the latest GPS point for each active tech.
 * Used by the admin dispatch map. Cached 10s server-side.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    // Get all active shifts
    const { data: activeShifts, error: shiftsError } = await supabase
      .from('gps_shifts')
      .select(
        `
        id,
        user_id,
        started_at
      `,
      )
      .eq('status', 'active')

    if (shiftsError) throw shiftsError
    if (!activeShifts || activeShifts.length === 0) {
      return NextResponse.json(
        { techs: [] },
        {
          headers: { 'Cache-Control': 'private, max-age=10' },
        },
      )
    }

    const shiftIds = activeShifts.map((s) => s.id)

    // Latest point per shift using a simple approach: get all recent points and keep last per shift
    const { data: recentPoints, error: pointsError } = await supabase
      .from('gps_points')
      .select(
        'shift_id, lat, lng, accuracy_m, speed_mps, segment_type, appointment_id, captured_at',
      )
      .in('shift_id', shiftIds)
      .gte('captured_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()) // last 10 min
      .order('captured_at', { ascending: false })

    if (pointsError) throw pointsError

    // Keep only the most recent point per shift
    const latestByShift = new Map<string, (typeof recentPoints)[0]>()
    for (const pt of recentPoints ?? []) {
      if (!latestByShift.has(pt.shift_id)) {
        latestByShift.set(pt.shift_id, pt)
      }
    }

    // Get user metadata for display names
    const userIds = activeShifts.map((s) => s.user_id)
    const { data: staffUsers } = await supabase
      .from('staff_users')
      .select('user_id, display_name, role')
      .in('user_id', userIds)

    const staffMap = new Map((staffUsers ?? []).map((s) => [s.user_id, s]))

    // Build response
    const techs = activeShifts
      .filter((s) => latestByShift.has(s.id))
      .map((shift) => {
        const pt = latestByShift.get(shift.id)!
        const staff = staffMap.get(shift.user_id)
        return {
          shiftId: shift.id,
          userId: shift.user_id,
          displayName: staff?.display_name ?? 'Unknown',
          role: staff?.role ?? 'tech',
          shiftStartedAt: shift.started_at,
          lat: pt.lat,
          lng: pt.lng,
          accuracyM: pt.accuracy_m,
          speedMps: pt.speed_mps,
          segmentType: pt.segment_type,
          appointmentId: pt.appointment_id,
          lastSeenAt: pt.captured_at,
        }
      })

    return NextResponse.json(
      { techs },
      { headers: { 'Cache-Control': 'private, max-age=10' } },
    )
  } catch (error) {
    console.error('[gps/live][GET]', error)
    return NextResponse.json(
      { error: 'Failed to fetch live positions' },
      { status: 500 },
    )
  }
}
