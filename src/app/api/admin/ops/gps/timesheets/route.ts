import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * GET /api/admin/ops/gps/timesheets
 * Query params:
 *   date=YYYY-MM-DD        (default: today)
 *   userId=<uuid>          (optional filter by user)
 *
 * Returns shifts for the given day with per-appointment time breakdown.
 * Shadow mode: shows both old (on_my_way→completed) and GPS (arrived→completed) splits.
 */
export async function GET(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const date =
      searchParams.get('date') || new Date().toISOString().split('T')[0]
    const userId = searchParams.get('userId') || null

    // Date range: start of day to end of day UTC
    const startOfDay = `${date}T00:00:00.000Z`
    const endOfDay = `${date}T23:59:59.999Z`

    let shiftsQuery = supabase
      .from('gps_shifts')
      .select(
        `
        id,
        user_id,
        started_at,
        ended_at,
        total_distance_m,
        status,
        gps_appointment_visits (
          id,
          appointment_id,
          arrived_at,
          departed_at,
          on_site_minutes,
          travel_in_minutes
        )
      `,
      )
      .gte('started_at', startOfDay)
      .lte('started_at', endOfDay)
      .order('started_at')

    if (userId) {
      shiftsQuery = shiftsQuery.eq('user_id', userId)
    }

    const { data: shifts, error: shiftsError } = await shiftsQuery
    if (shiftsError) throw shiftsError

    if (!shifts || shifts.length === 0) {
      return NextResponse.json({
        date,
        rows: [],
        canManageShifts: access.role === 'admin' || access.role === 'owner',
      })
    }

    // Get staff display names
    const userIds = [...new Set(shifts.map((s) => s.user_id))]
    const { data: staffUsers } = await supabase
      .from('staff_users')
      .select('user_id, display_name, role')
      .in('user_id', userIds)
    const staffMap = new Map((staffUsers ?? []).map((s) => [s.user_id, s]))

    // Get appointment details for all visited appointments
    const allApptIds = shifts
      .flatMap((s) => {
        const visits = Array.isArray(s.gps_appointment_visits)
          ? s.gps_appointment_visits
          : []
        return visits.map((v: { appointment_id: string }) => v.appointment_id)
      })
      .filter(Boolean)

    const uniqueApptIds = [...new Set(allApptIds)]
    let apptMap = new Map<
      string,
      {
        customer: string
        address: string
        on_my_way_at: string | null
        arrived_at: string | null
        completed_at: string | null
        quoted_total: number
      }
    >()

    if (uniqueApptIds.length > 0) {
      const { data: appts } = await supabase
        .from('ops_appointments')
        .select(
          `
          id,
          on_my_way_at,
          arrived_at,
          completed_at,
          quoted_total,
          ops_customers!ops_appointments_customer_id_fkey (
            full_name
          ),
          ops_service_addresses (
            street_1,
            city
          )
        `,
        )
        .in('id', uniqueApptIds)

      for (const appt of appts ?? []) {
        const cust = Array.isArray(appt.ops_customers)
          ? appt.ops_customers[0]
          : appt.ops_customers
        const addr = Array.isArray(appt.ops_service_addresses)
          ? appt.ops_service_addresses[0]
          : appt.ops_service_addresses
        apptMap.set(appt.id, {
          customer:
            (cust as { full_name?: string } | null)?.full_name ?? 'Unknown',
          address: addr
            ? `${(addr as { street_1: string }).street_1}, ${(addr as { city: string }).city}`
            : '',
          on_my_way_at: appt.on_my_way_at,
          arrived_at: appt.arrived_at,
          completed_at: appt.completed_at,
          quoted_total: Number(appt.quoted_total || 0),
        })
      }
    }

    // Build rows
    const rows = shifts.map((shift) => {
      const staff = staffMap.get(shift.user_id)
      const shiftStartMs = new Date(shift.started_at).getTime()
      const shiftEndMs = shift.ended_at
        ? new Date(shift.ended_at).getTime()
        : Date.now()
      const totalShiftMinutes = Math.round((shiftEndMs - shiftStartMs) / 60000)

      const visits = Array.isArray(shift.gps_appointment_visits)
        ? shift.gps_appointment_visits
        : []

      type Visit = {
        appointment_id: string
        arrived_at: string | null
        departed_at: string | null
        on_site_minutes: number
        travel_in_minutes: number
      }

      const appointmentRows = (visits as Visit[]).map((visit) => {
        const appt = apptMap.get(visit.appointment_id)

        // Current billing method: on_my_way_at → completed_at
        let currentBillingMinutes = 0
        if (appt?.on_my_way_at && appt?.completed_at) {
          currentBillingMinutes = Math.round(
            (new Date(appt.completed_at).getTime() -
              new Date(appt.on_my_way_at).getTime()) /
              60000,
          )
        }

        // GPS method: arrived_at → completed_at
        let gpsOnSiteMinutes = visit.on_site_minutes ?? 0
        let gpsTravelMinutes: number | null = null

        if (appt?.on_my_way_at && appt?.arrived_at) {
          gpsTravelMinutes = Math.round(
            (new Date(appt.arrived_at).getTime() -
              new Date(appt.on_my_way_at).getTime()) /
              60000,
          )
        }

        const variance =
          appt?.arrived_at != null
            ? currentBillingMinutes -
              (gpsOnSiteMinutes + (gpsTravelMinutes ?? 0))
            : null

        return {
          appointmentId: visit.appointment_id,
          customer: appt?.customer ?? 'Unknown',
          address: appt?.address ?? '',
          quotedTotal: appt?.quoted_total ?? 0,
          currentBillingMinutes,
          gpsTravelMinutes,
          gpsOnSiteMinutes,
          varianceMinutes: variance,
          arrivedAt: appt?.arrived_at ?? null,
          onMyWayAt: appt?.on_my_way_at ?? null,
          completedAt: appt?.completed_at ?? null,
          hasGpsData: visit.arrived_at != null,
        }
      })

      const totalOnSiteMinutes = appointmentRows.reduce(
        (sum, r) => sum + r.gpsOnSiteMinutes,
        0,
      )
      const totalTravelMinutes = appointmentRows.reduce(
        (sum, r) => sum + (r.gpsTravelMinutes ?? 0),
        0,
      )
      const idleMinutes = Math.max(
        0,
        totalShiftMinutes - totalOnSiteMinutes - totalTravelMinutes,
      )

      return {
        shiftId: shift.id,
        userId: shift.user_id,
        displayName: staff?.display_name ?? 'Unknown',
        role: staff?.role ?? 'tech',
        shiftStartedAt: shift.started_at,
        shiftEndedAt: shift.ended_at,
        shiftStatus: shift.status,
        totalShiftMinutes,
        totalOnSiteMinutes,
        totalTravelMinutes,
        idleMinutes,
        totalDistanceM: shift.total_distance_m ?? 0,
        appointments: appointmentRows,
      }
    })

    return NextResponse.json({
      date,
      rows,
      canManageShifts: access.role === 'admin' || access.role === 'owner',
    })
  } catch (error) {
    console.error('[gps/timesheets][GET]', error)
    return NextResponse.json(
      { error: 'Failed to load timesheets' },
      { status: 500 },
    )
  }
}
