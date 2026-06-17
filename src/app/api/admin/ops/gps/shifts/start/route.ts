import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const staffUserId = access.staff?.id ?? null

    // Check for an existing active shift
    const { data: existing } = await supabase
      .from('gps_shifts')
      .select('id, started_at, break_started_at, break_minutes')
      .eq('user_id', access.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Resume the existing shift instead of rejecting
      const fences = await fetchTodayFences(supabase, staffUserId)
      return NextResponse.json({ shift: existing, fences })
    }

    // Create a new shift
    const { data: shift, error } = await supabase
      .from('gps_shifts')
      .insert({
        user_id: access.id,
        status: 'active',
        device_info: body.deviceInfo ?? null,
      })
      .select()
      .single()

    if (error) throw error

    const fences = await fetchTodayFences(supabase, staffUserId)

    return NextResponse.json({ shift, fences }, { status: 201 })
  } catch (error) {
    console.error('[gps/shifts/start][POST]', error)
    return NextResponse.json(
      { error: 'Failed to start shift' },
      { status: 500 },
    )
  }
}

async function fetchTodayFences(
  supabase: ReturnType<typeof createAdminClient>,
  staffUserId: string | null,
) {
  const today = new Date().toISOString().split('T')[0]

  let query = supabase
    .from('ops_appointments')
    .select(
      `
      id,
      status,
      start_time,
      on_my_way_at,
      ops_customers!ops_appointments_customer_id_fkey (
        full_name,
        first_name
      ),
      ops_service_addresses (
        latitude,
        longitude
      )
    `,
    )
    .eq('appointment_date', today)
    .not('status', 'in', '("cancelled")')
    .order('start_time')

  if (staffUserId) {
    query = query.eq('assigned_staff_user_id', staffUserId)
  }

  const { data } = await query

  if (!data) return []

  return data
    .filter((appt) => {
      const addr = Array.isArray(appt.ops_service_addresses)
        ? appt.ops_service_addresses[0]
        : appt.ops_service_addresses
      return addr?.latitude != null && addr?.longitude != null
    })
    .map((appt) => {
      const addr = Array.isArray(appt.ops_service_addresses)
        ? appt.ops_service_addresses[0]
        : appt.ops_service_addresses
      const cust = Array.isArray(appt.ops_customers)
        ? appt.ops_customers[0]
        : appt.ops_customers
      const name =
        (cust as { first_name?: string; full_name?: string } | null)
          ?.first_name ||
        (cust as { full_name?: string } | null)?.full_name ||
        'Customer'

      return {
        id: appt.id,
        lat: (addr as { latitude: number }).latitude,
        lng: (addr as { longitude: number }).longitude,
        customerName: name,
        status: appt.status,
      }
    })
}
