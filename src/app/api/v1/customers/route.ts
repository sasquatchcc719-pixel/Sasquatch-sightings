import { NextRequest, NextResponse } from 'next/server'
import { handleApiV1Get, methodNotAllowed } from '@/lib/api-v1/http'
import {
  ilikePattern,
  paginationPayload,
  parsePagination,
} from '@/lib/api-v1/query'
import { serializeCustomerSearchResult } from '@/lib/api-v1/serializers'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'

const CUSTOMER_SELECT = `
  id,
  full_name,
  first_name,
  last_name,
  business_name,
  email,
  phone,
  notes,
  addresses:ops_service_addresses (
    id, label, street_1, street_2, city, state, zip_code, gate_code, notes
  )
`

export async function GET(request: NextRequest) {
  return handleApiV1Get(request, async ({ supabase }) => {
    const searchParams = request.nextUrl.searchParams
    const pagination = parsePagination(searchParams)
    const phone = String(searchParams.get('phone') || '').trim()
    const email = String(searchParams.get('email') || '').trim()
    const name = String(searchParams.get('name') || '').trim()

    let query = supabase
      .from('ops_customers')
      .select(CUSTOMER_SELECT, { count: 'exact' })
      .order('updated_at', { ascending: false })

    if (phone) query = query.in('phone', opsPhoneLookupVariants(phone))
    if (email) query = query.ilike('email', email)
    if (name) query = query.ilike('full_name', ilikePattern(name))

    const { data, error, count } = await query.range(
      pagination.offset,
      pagination.offset + pagination.limit - 1,
    )
    if (error) throw error

    return NextResponse.json({
      data: (data || []).map(serializeCustomerSearchResult),
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
