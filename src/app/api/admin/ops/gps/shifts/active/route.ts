import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const staffUserId = access.staff?.id ?? null

    const { data: shift, error } = await supabase
      .from('gps_shifts')
      .select('id, started_at, status')
      .eq('user_id', access.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error

    if (!shift) {
      return NextResponse.json({ shift: null, fences: [] })
    }

    // Fetch today's fences filtered to this tech's assigned appointments
    const today = new Date().toISOString().split('T')[0]
    let apptsQuery = supabase
      .from('ops_appointments')
      .select(
        `
        id,
        status,
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

    if (staffUserId) {
      apptsQuery = apptsQuery.eq('assigned_staff_user_id', staffUserId)
    }

    const { data: appts } = await apptsQuery

    const fences = (appts ?? [])
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

    return NextResponse.json({ shift, fences })
  } catch (error) {
    console.error('[gps/shifts/active][GET]', error)
    return NextResponse.json(
      { error: 'Failed to fetch active shift' },
      { status: 500 },
    )
  }
}
