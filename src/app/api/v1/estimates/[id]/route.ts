import { NextRequest, NextResponse } from 'next/server'
import {
  ApiRequestError,
  handleApiV1Get,
  methodNotAllowed,
} from '@/lib/api-v1/http'
import { serializeEstimateDetail } from '@/lib/api-v1/serializers'

const ESTIMATE_DETAIL_SELECT = `
  id,
  estimate_status,
  quoted_total,
  internal_notes,
  customer:ops_customers!ops_appointments_customer_id_fkey (
    id, full_name, first_name, last_name, business_name, email, phone, notes
  ),
  address:ops_service_addresses!ops_appointments_service_address_id_fkey (
    id, label, street_1, street_2, city, state, zip_code, gate_code, notes
  ),
  line_items:ops_appointment_line_items (
    id, service_catalog_item_id, name_snapshot, quantity, unit_price,
    duration_minutes, line_total, notes
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
      .select(ESTIMATE_DETAIL_SELECT)
      .eq('id', id)
      .eq('kind', 'estimate')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new ApiRequestError('Estimate not found', 404)

    return NextResponse.json({ data: serializeEstimateDetail(data) })
  })
}

export const POST = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const HEAD = methodNotAllowed
export const OPTIONS = methodNotAllowed
