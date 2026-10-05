import { NextRequest, NextResponse } from 'next/server'
import {
  ApiRequestError,
  handleApiV1Get,
  methodNotAllowed,
} from '@/lib/api-v1/http'
import {
  ilikePattern,
  optionalDate,
  paginationPayload,
  parseEnum,
  parsePagination,
} from '@/lib/api-v1/query'
import { serializeAppointmentSummary } from '@/lib/api-v1/serializers'

const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const

const APPOINTMENT_LIST_SELECT = `
  id,
  appointment_date,
  start_time,
  end_time,
  status,
  quoted_total,
  customer:ops_customers!ops_appointments_customer_id_fkey (
    id, full_name, first_name, last_name, business_name, email, phone
  ),
  address:ops_service_addresses!ops_appointments_service_address_id_fkey (
    id, label, street_1, street_2, city, state, zip_code
  ),
  tech:staff_users!ops_appointments_assigned_staff_user_id_fkey (
    id, display_name
  )
`

export async function GET(request: NextRequest) {
  return handleApiV1Get(request, async ({ supabase }) => {
    const searchParams = request.nextUrl.searchParams
    const pagination = parsePagination(searchParams)
    const date = optionalDate(searchParams.get('date'), 'date')
    const start = optionalDate(searchParams.get('start'), 'start')
    const end = optionalDate(searchParams.get('end'), 'end')
    const status = parseEnum(
      searchParams.get('status'),
      'status',
      APPOINTMENT_STATUSES,
    )
    const tech = String(searchParams.get('tech') || '').trim()

    if (date && (start || end)) {
      throw new ApiRequestError('date cannot be combined with start or end')
    }
    if (start && end && start > end) {
      throw new ApiRequestError('start must be on or before end')
    }

    let staffIds: string[] | null = null
    if (tech) {
      const { data: staff, error: staffError } = await supabase
        .from('staff_users')
        .select('id')
        .ilike('display_name', ilikePattern(tech))
      if (staffError) throw staffError
      staffIds = (staff || []).map((row) => row.id)
      if (staffIds.length === 0) {
        return NextResponse.json({
          data: [],
          pagination: paginationPayload(pagination, 0),
        })
      }
    }

    let query = supabase
      .from('ops_appointments')
      .select(APPOINTMENT_LIST_SELECT, { count: 'exact' })
      .neq('kind', 'estimate')
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: false })

    if (date) query = query.eq('appointment_date', date)
    if (start) query = query.gte('appointment_date', start)
    if (end) query = query.lte('appointment_date', end)
    if (status === 'scheduled') {
      query = query.in('status', [
        'booked',
        'confirmed',
        'on_my_way',
        'in_progress',
      ])
    } else if (status) {
      query = query.eq('status', status)
    }
    if (staffIds) query = query.in('assigned_staff_user_id', staffIds)

    const { data, error, count } = await query.range(
      pagination.offset,
      pagination.offset + pagination.limit - 1,
    )
    if (error) throw error

    return NextResponse.json({
      data: (data || []).map(serializeAppointmentSummary),
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
