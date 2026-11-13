import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { trackerStatus } from '@/lib/fleet-tracking'
import { DAVID_CANVASS_USER_ID } from '@/lib/gps/canvassAutoStop'
import {
  loadCustomerArrivalByHash,
  type CustomerArrival,
} from '@/lib/ops/customer-arrival'
import { BOX_TRUCK_NAME } from '@/lib/truck-temperature'
import { createAdminClient } from '@/supabase/server'

export type BoxTruckStatus = {
  vehicleStatus: string
  arrival:
    | { status: 'idle' | 'waiting' | 'arrived' }
    | Pick<
        Extract<CustomerArrival, { status: 'en_route' }>,
        'status' | 'earliest' | 'latest' | 'arrivingSoon'
      >
}

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const access = await requireAnyRole(['admin', 'owner', 'tech']).catch(
    () => null,
  )
  if (access?.id !== DAVID_CANVASS_USER_ID || !access.staff?.is_active) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers },
    )
  }

  const db = createAdminClient()
  try {
    const { data: truck, error } = await db
      .from('fleet_trackers')
      .select(
        'id,enabled,last_seen_at,gps_fix,gps_at,speed_mps,fleet_dispatch_tracking!inner(staff_user_id)',
      )
      .eq('name', BOX_TRUCK_NAME)
      .eq('fleet_dispatch_tracking.staff_user_id', access.staff.id)
      .maybeSingle()
    if (error) throw error
    if (!truck) return NextResponse.json(null, { headers })

    const { data: link, error: linkError } = await db
      .from('customer_arrival_links')
      .select('token_hash,ops_appointments!inner(assigned_staff_user_id)')
      .eq('tracker_id', truck.id)
      .in('ops_appointments.assigned_staff_user_id', [
        access.staff.id,
        access.id,
      ])
      .gte('started_at', new Date(Date.now() - 2 * 60 * 60_000).toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (linkError) throw linkError

    const trip = link && (await loadCustomerArrivalByHash(db, link.token_hash))
    const data: BoxTruckStatus = {
      vehicleStatus: trackerStatus(truck),
      arrival:
        trip?.status === 'en_route'
          ? {
              status: 'en_route',
              earliest: trip.earliest,
              latest: trip.latest,
              arrivingSoon: trip.arrivingSoon,
            }
          : {
              status: !trip || trip.status === 'ended' ? 'idle' : trip.status,
            },
    }
    return NextResponse.json(data, { headers })
  } catch {
    return NextResponse.json(
      { error: 'Truck status unavailable' },
      { status: 503, headers },
    )
  }
}
