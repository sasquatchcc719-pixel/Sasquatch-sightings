import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
const ESTIMATE_SELECT = `
  id,
  appointment_date,
  start_time,
  end_time,
  status,
  estimate_status,
  converted_appointment_id,
  quoted_total,
  internal_notes,
  kind,
  created_at,
  updated_at,
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
  )
`

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const customerId = searchParams.get('customer_id')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    let query = supabase
      .from('ops_appointments')
      .select(ESTIMATE_SELECT)
      .eq('kind', 'estimate')
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: false })

    if (status) {
      query = query.eq('estimate_status', status)
    }
    if (customerId) {
      query = query.eq('customer_id', customerId)
    }
    if (dateFrom) {
      query = query.gte('appointment_date', dateFrom)
    }
    if (dateTo) {
      query = query.lte('appointment_date', dateTo)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ estimates: data || [] })
  } catch (error) {
    console.error('[ops/estimates][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load estimates' },
      { status: 500 },
    )
  }
}

export async function POST() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    return NextResponse.json(
      {
        error:
          'The old estimate creator has been retired. Use Email estimate in Book Job.',
        redirect_url: '/admin/operations/new-job?mode=estimate',
      },
      { status: 410 },
    )
  } catch (error) {
    console.error('[ops/estimates][POST] Error:', error)
    return NextResponse.json(
      { error: 'Unable to access estimate creation' },
      { status: 403 },
    )
  }
}
