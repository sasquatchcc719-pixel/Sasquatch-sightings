import { NextRequest, NextResponse } from 'next/server'
import { handleApiV1Get, methodNotAllowed } from '@/lib/api-v1/http'
import {
  paginationPayload,
  parsePagination,
  parseSince,
} from '@/lib/api-v1/query'

export async function GET(request: NextRequest) {
  return handleApiV1Get(request, async ({ supabase }) => {
    const searchParams = request.nextUrl.searchParams
    const pagination = parsePagination(searchParams)
    const since = parseSince(searchParams.get('since'))

    const { data, error, count } = await supabase
      .from('call_logs')
      .select(
        'id, call_sid, caller_phone, outcome, duration_seconds, recording_url, transcription, created_at',
        { count: 'exact' },
      )
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(pagination.offset, pagination.offset + pagination.limit - 1)

    if (error) throw error

    return NextResponse.json({
      data: data || [],
      since,
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
