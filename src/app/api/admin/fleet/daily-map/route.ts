import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadPlannedDriving } from '@/lib/ops/planned-driving'
import {
  dispatchLocation,
  isDispatchDay,
  type DispatchJob,
} from '@/lib/ops/daily-dispatch'

const one = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['owner', 'admin', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const date = request.nextUrl.searchParams.get('date') ?? ''
  if (!isDispatchDay(date))
    return NextResponse.json(
      { error: 'Choose a valid calendar day' },
      { status: 400 },
    )
  const db = createAdminClient()
  const [appointments, staff] = await Promise.all([
    db
      .from('ops_appointments')
      .select(
        `id,appointment_date,start_time,end_time,status,kind,restoration_project_id,recurring_template_id,assigned_staff_user_id,gps_lat,gps_lng,
      ops_customers!ops_appointments_customer_id_fkey(full_name,business_name),
      ops_service_addresses(street_1,street_2,city,state,zip_code,latitude,longitude,geocoded_at,geocode_source),
      ops_invoices(id)`,
      )
      .eq('appointment_date', date)
      .neq('status', 'cancelled')
      .is('parked_at', null)
      .order('start_time')
      .order('id'),
    db
      .from('staff_users')
      .select('id,user_id,display_name')
      .eq('is_active', true)
      .eq('show_on_calendar', true)
      .order('scheduling_priority'),
  ])
  if (appointments.error || staff.error)
    return NextResponse.json(
      { error: 'Unable to load the selected day' },
      { status: 503 },
    )
  const jobs: DispatchJob[] = (appointments.data ?? []).map((appointment) => {
    const customer = one(appointment.ops_customers)
    const address = one(appointment.ops_service_addresses)
    const invoice = one(appointment.ops_invoices)
    const technician = staff.data?.find(
      (person) =>
        person.id === appointment.assigned_staff_user_id ||
        person.user_id === appointment.assigned_staff_user_id,
    )
    const href =
      appointment.kind === 'restoration' && appointment.restoration_project_id
        ? `/admin/operations/restoration/${appointment.restoration_project_id}?visit=${appointment.id}`
        : appointment.kind === 'estimate'
          ? `/admin/operations/estimates/${appointment.id}`
          : invoice?.id
            ? `/admin/operations/invoices/${invoice.id}`
            : appointment.recurring_template_id
              ? `/admin/operations/recurring/visit/${appointment.id}`
              : `/admin/operations/appointments/${appointment.id}`
    return {
      id: appointment.id,
      date: appointment.appointment_date,
      start: appointment.start_time,
      end: appointment.end_time,
      status: appointment.status,
      name: customer?.business_name || customer?.full_name || 'Customer',
      address: address
        ? [
            address.street_1,
            address.street_2,
            address.city,
            address.state,
            address.zip_code,
          ]
            .filter(Boolean)
            .join(', ')
        : '',
      staffId: technician?.id ?? appointment.assigned_staff_user_id ?? null,
      staffName: technician?.display_name ?? 'Unassigned',
      href,
      location: dispatchLocation(
        address,
        appointment.gps_lat,
        appointment.gps_lng,
      ),
    }
  })
  const includeRoutes = request.nextUrl.searchParams.get('routes') === '1'
  const bases = includeRoutes
    ? await db
        .from('fleet_dispatch_tracking')
        .select(
          'staff_user_id,base_latitude,base_longitude,fleet_trackers!inner(enabled)',
        )
        .eq('fleet_trackers.enabled', true)
    : null
  if (bases?.error)
    return NextResponse.json(
      { error: 'Unable to load saved vehicle bases' },
      { status: 503 },
    )
  return NextResponse.json(
    {
      date,
      jobs,
      defaultStaffId: staff.data?.[0]?.id ?? null,
      ...(includeRoutes
        ? {
            plannedDrives: await loadPlannedDriving(
              jobs,
              (bases?.data ?? []).map((base) => ({
                staffId: base.staff_user_id,
                location: {
                  lat: base.base_latitude,
                  lng: base.base_longitude,
                  source: 'Saved vehicle base',
                },
              })),
            ),
          }
        : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
