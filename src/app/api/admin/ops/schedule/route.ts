import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const APPOINTMENT_SELECT = `
  *,
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
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
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

    const [appointmentsResult, eventsResult] = await Promise.all([
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
    ])

    if (appointmentsResult.error) throw appointmentsResult.error
    if (eventsResult.error) throw eventsResult.error

    return NextResponse.json({
      appointments: appointmentsResult.data || [],
      events: eventsResult.data || [],
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
