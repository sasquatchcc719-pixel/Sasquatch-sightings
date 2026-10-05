import { NextRequest, NextResponse } from 'next/server'
import { handleApiV1Get, methodNotAllowed } from '@/lib/api-v1/http'
import {
  paginationPayload,
  parseEnum,
  parsePagination,
} from '@/lib/api-v1/query'
import { serializeEstimateSummary } from '@/lib/api-v1/serializers'

const ESTIMATE_STATUSES = ['accepted', 'pending', 'declined'] as const

const ESTIMATE_LIST_SELECT = `
  id,
  appointment_date,
  start_time,
  end_time,
  estimate_status,
  quoted_total,
  customer:ops_customers!ops_appointments_customer_id_fkey (
    id, full_name, first_name, last_name, business_name, email, phone
  ),
  address:ops_service_addresses!ops_appointments_service_address_id_fkey (
    id, label, street_1, street_2, city, state, zip_code
  )
`

export async function GET(request: NextRequest) {
  return handleApiV1Get(request, async ({ supabase }) => {
    const searchParams = request.nextUrl.searchParams
    const pagination = parsePagination(searchParams)
    const status = parseEnum(
      searchParams.get('status'),
      'status',
      ESTIMATE_STATUSES,
    )

    let query = supabase
      .from('ops_appointments')
      .select(ESTIMATE_LIST_SELECT, { count: 'exact' })
      .eq('kind', 'estimate')
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: false })

    if (status === 'accepted') {
      query = query.in('estimate_status', ['accepted', 'converted'])
    } else if (status === 'pending') {
      query = query.in('estimate_status', ['draft', 'sent'])
    } else if (status === 'declined') {
      query = query.eq('estimate_status', 'declined')
    }

    const { data, error, count } = await query.range(
      pagination.offset,
      pagination.offset + pagination.limit - 1,
    )
    if (error) throw error

    return NextResponse.json({
      data: (data || []).map(serializeEstimateSummary),
      pagination: paginationPayload(pagination, count),
    })
  })
}

export const POST = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const HEAD = methodNotAllowed
export const OPTIONS = methodNotAllowed
