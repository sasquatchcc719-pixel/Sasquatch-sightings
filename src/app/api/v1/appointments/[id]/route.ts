import { NextRequest, NextResponse } from 'next/server'
import {
  ApiRequestError,
  handleApiV1Get,
  methodNotAllowed,
} from '@/lib/api-v1/http'
import { serializeAppointmentDetail } from '@/lib/api-v1/serializers'

const APPOINTMENT_DETAIL_SELECT = `
  id,
  appointment_date,
  start_time,
  end_time,
  status,
  payment_status,
  quoted_total,
  internal_notes,
  visit_type,
  customer:ops_customers!ops_appointments_customer_id_fkey (
    id, full_name, first_name, last_name, business_name, email, phone, notes
  ),
  address:ops_service_addresses!ops_appointments_service_address_id_fkey (
    id, label, street_1, street_2, city, state, zip_code, gate_code, notes
  ),
  tech:staff_users!ops_appointments_assigned_staff_user_id_fkey (
    id, display_name
  ),
  services:ops_appointment_line_items (
    id, service_catalog_item_id, name_snapshot, quantity, unit_price,
    duration_minutes, line_total, notes
  ),
  invoices:ops_invoices (
    id, total, status, payment_status
  )
`

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApiV1Get(request, async ({ supabase }) => {
    const { id } = await params
    const { data, error } = await supabase
      .from('ops_appointments')
      .select(APPOINTMENT_DETAIL_SELECT)
      .eq('id', id)
      .neq('kind', 'estimate')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new ApiRequestError('Appointment not found', 404)

    return NextResponse.json({ data: serializeAppointmentDetail(data) })
  })
}

export const POST = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const HEAD = methodNotAllowed
export const OPTIONS = methodNotAllowed
