import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'

export async function POST() {
  try {
    await requireAnyRole(['admin', 'owner'])

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER

    if (!accountSid || !authToken || !twilioPhone) {
      return NextResponse.json(
        { error: 'Twilio credentials not configured' },
        { status: 500 },
      )
    }

    const client = twilio(accountSid, authToken)
    const since = new Date(Date.now() - 45 * 86400000)
    const supabase = createAdminClient()

    // Pull last ~45 days of inbound calls from Twilio
    const calls = await client.calls.list({
      to: twilioPhone,
      startTimeAfter: since,
      limit: 500,
    })

    const rows = calls.map((call) => {
      const duration = parseInt(call.duration ?? '0', 10)
      let outcome: string
      if (call.status === 'completed' && duration > 30) {
        outcome = 'answered'
      } else if (call.status === 'no-answer' || call.status === 'busy') {
        outcome = 'no-answer'
      } else {
        outcome = 'voicemail'
      }

      return {
        call_sid: call.sid,
        caller_phone: call.from,
        direction: 'inbound',
        outcome,
        duration_seconds: duration || null,
        raw_dial_status: call.status,
        created_at: call.startTime?.toISOString() ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    })

    if (rows.length > 0) {
      // ignoreDuplicates: true so we don't overwrite recording_url already set
      const { error } = await supabase
        .from('call_logs')
        .upsert(rows, { onConflict: 'call_sid', ignoreDuplicates: true })
      if (error) throw error
    }

    // Cross-reference sms_logs to populate recording_url + transcription
    // for voicemail rows that don't have them yet. Twilio recording SIDs differ
    // from call SIDs so we match by phone + time window instead.
    const { data: updated } = await supabase.rpc('backfill_call_log_recordings')

    const withRecordings = (updated as { count: number } | null)?.count ?? 0

    return NextResponse.json({
      inserted: rows.length,
      with_recordings: withRecordings,
    })
  } catch (err) {
    console.error('[admin/call-logs/backfill][POST]', err)
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 })
  }
}
