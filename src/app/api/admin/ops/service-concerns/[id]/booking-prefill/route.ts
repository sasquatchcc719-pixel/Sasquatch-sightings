import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('ops_service_concerns')
      .select(
        `
          id,
          status,
          category,
          initial_message,
          internal_notes,
          customer:ops_customers!ops_service_concerns_customer_id_fkey (
            id, full_name, first_name, last_name, business_name,
            is_commercial, email, phone, notes,
            ops_service_addresses (
              id, label, street_1, street_2, city, state, zip_code, gate_code, notes
            )
          ),
          original_job:ops_appointments!ops_service_concerns_appointment_id_fkey (
            id, appointment_date, service_address_id,
            lead_source_key, lead_source_detail, original_lead_source
          ),
          return_appointments:ops_appointments!ops_appointments_service_concern_id_fkey (
            id, appointment_date, start_time, status
          )
        `,
      )
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) {
      return NextResponse.json(
        { error: 'Service concern not found' },
        { status: 404 },
      )
    }
    if (data.status !== 'approved_return') {
      return NextResponse.json(
        { error: 'Approve the return before placing it on the calendar' },
        { status: 409 },
      )
    }
    if (data.return_appointments?.length) {
      return NextResponse.json(
        {
          error: 'A return appointment is already linked to this concern',
          appointment: data.return_appointments[0],
        },
        { status: 409 },
      )
    }
    if (!data.customer || !data.original_job) {
      return NextResponse.json(
        { error: 'This concern is missing its customer or original job' },
        { status: 409 },
      )
    }

    return NextResponse.json({ concern: data })
  } catch (error) {
    console.error('[service-concerns/booking-prefill][GET]', error)
    const unauthorized =
      error instanceof Error && error.message === 'Not authorized'
    return NextResponse.json(
      {
        error: unauthorized ? 'Unauthorized' : 'Failed to load return details',
      },
      { status: unauthorized ? 401 : 500 },
    )
  }
}
