import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const APPOINTMENT_SELECT = `
  *,
  lead_source,
  ops_customers!ops_appointments_customer_id_fkey (
    id,
    full_name,
    first_name,
    last_name,
    business_name,
    email,
    phone
  ),
  ops_service_addresses (
    id,
    label,
    street_1,
    street_2,
    city,
    state,
    zip_code,
    gate_code,
    notes
  ),
  ops_appointment_line_items (
    id,
    service_catalog_item_id,
    name_snapshot,
    quantity,
    unit_price,
    duration_minutes,
    buffer_minutes,
    line_total,
    notes
  ),
  ops_invoices (
    id,
    status,
    payment_status,
    sync_status,
    subtotal,
    total,
    quickbooks_invoice_id
  )
`

export async function GET(request: NextRequest) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'marketing',
    ])
    const supabase = createAdminClient()

    const searchParams = request.nextUrl.searchParams
    const startDate = String(searchParams.get('start_date') || '').trim()
    const endDate = String(searchParams.get('end_date') || '').trim()

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'start_date and end_date are required' },
        { status: 400 },
      )
    }

    const [
      appointmentsResult,
      eventsResult,
      rulesResult,
      staffResult,
      dailyAvailResult,
    ] = await Promise.all([
      supabase
        .from('ops_appointments')
        .select(APPOINTMENT_SELECT)
        .gte('appointment_date', startDate)
        .lte('appointment_date', endDate)
        .order('appointment_date')
        .order('start_time'),
      supabase
        .from('ops_calendar_events')
        .select('*')
        .lte('start_date', endDate)
        .gte('end_date', startDate)
        .order('start_date')
        .order('start_time'),
      supabase
        .from('ops_recurrence_rules')
        .select('template_id, frequency, interval_days'),
      supabase
        .from('staff_users')
        .select(
          'id, user_id, display_name, role, is_active, default_open, scheduling_priority',
        )
        .eq('is_active', true)
        .order('scheduling_priority', { ascending: true }),
      supabase
        .from('staff_daily_availability')
        .select('staff_user_id, date, is_open')
        .gte('date', startDate)
        .lte('date', endDate),
    ])

    if (appointmentsResult.error) throw appointmentsResult.error
    if (eventsResult.error) throw eventsResult.error

    const appointments = appointmentsResult.data || []
    const customerIds = [
      ...new Set(
        appointments
          .map((appointment) => appointment.customer_id)
          .filter(Boolean),
      ),
    ]
    const appointmentCountByCustomer: Record<string, number> = {}
    if (customerIds.length > 0) {
      const { data: customerAppointmentRows, error: countError } =
        await supabase
          .from('ops_appointments')
          .select('id, customer_id')
          .in('customer_id', customerIds)
          .neq('status', 'cancelled')

      if (countError) throw countError
      for (const row of customerAppointmentRows || []) {
        appointmentCountByCustomer[row.customer_id] =
          (appointmentCountByCustomer[row.customer_id] || 0) + 1
      }
    }

    const recurringFrequencyMap: Record<
      string,
      { frequency: string; interval_days: number | null }
    > = {}
    if (rulesResult.data) {
      for (const rule of rulesResult.data) {
        recurringFrequencyMap[rule.template_id] = {
          frequency: rule.frequency,
          interval_days: rule.interval_days,
        }
      }
    }

    return NextResponse.json({
      appointments: appointments.map((appointment) => ({
        ...appointment,
        is_repeat_customer:
          (appointmentCountByCustomer[appointment.customer_id] || 0) > 1,
      })),
      events: eventsResult.data || [],
      recurringFrequencyMap,
      staff: staffResult.data || [],
      dailyAvailability: dailyAvailResult.data || [],
      currentUserId: access.id,
    })
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null
          ? JSON.stringify(error)
          : String(error)
    console.error('[ops/schedule][GET] Error:', detail)
    return NextResponse.json(
      { error: 'Failed to load schedule data', detail },
      { status: 500 },
    )
  }
}
