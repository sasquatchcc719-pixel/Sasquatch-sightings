import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { verifyRetellSignature } from '@/lib/retell/verify'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function timestampValue(value: unknown): string | null {
  const number = numberValue(value)
  if (number) {
    const milliseconds = number > 10_000_000_000 ? number : number * 1000
    return new Date(milliseconds).toISOString()
  }
  const string = stringValue(value)
  return string ? new Date(string).toISOString() : null
}

function getCallPayload(payload: Record<string, unknown>) {
  return asRecord(payload.call || payload.data || payload)
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-retell-signature')

  if (!verifyRetellSignature({ rawBody, signature })) {
    return NextResponse.json(
      { success: false, message: 'Invalid Retell signature.' },
      { status: 401 },
    )
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { success: false, message: 'Invalid JSON body.' },
      { status: 400 },
    )
  }

  const call = getCallPayload(payload)
  const analysis = asRecord(call.call_analysis || call.analysis)
  const start = numberValue(call.start_timestamp || call.start_time)
  const end = numberValue(call.end_timestamp || call.end_time)
  const duration =
    numberValue(call.duration_seconds || call.duration) ||
    (start && end ? Math.max(0, Math.round((end - start) / 1000)) : null)

  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('retell_call_logs').insert({
      call_id: stringValue(call.call_id || payload.call_id),
      caller_phone: stringValue(call.from_number || call.caller_phone),
      agent_id: stringValue(call.agent_id),
      agent_name: stringValue(call.agent_name),
      call_status: stringValue(call.call_status || payload.event),
      call_type: stringValue(call.call_type),
      start_timestamp: timestampValue(call.start_timestamp || call.start_time),
      end_timestamp: timestampValue(call.end_timestamp || call.end_time),
      duration_seconds: duration,
      transcript: stringValue(call.transcript),
      recording_url: stringValue(
        call.recording_url || call.recording_url_signed,
      ),
      disconnection_reason: stringValue(call.disconnection_reason),
      sentiment: stringValue(analysis.user_sentiment || analysis.sentiment),
      call_successful:
        typeof analysis.call_successful === 'boolean'
          ? analysis.call_successful
          : null,
      raw_payload: payload,
    })

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[retell/webhook] Failed to store call log:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to store Retell call log.' },
      { status: 500 },
    )
  }
}
