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

    const calls = data || []
    const voiceSids = calls
      .filter((call) => call.outcome === 'assistant-answered')
      .map((call) => call.call_sid)
    if (voiceSids.length) {
      const transcripts = await supabase.rpc(
        'phone_assistant_transcripts_for_calls',
        { p_sids: voiceSids },
      )
      if (transcripts.error) throw transcripts.error
      const byCall = new Map<string, string>(
        (transcripts.data || []).map(
          (row: { call_sid: string; transcription: string }) => [
            row.call_sid,
            row.transcription,
          ],
        ),
      )
      for (const call of calls)
        call.transcription = byCall.get(call.call_sid) ?? call.transcription
    }
    return NextResponse.json({
      data: calls,
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
