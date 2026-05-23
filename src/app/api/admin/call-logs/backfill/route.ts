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

    // Fetch calls and recordings in parallel
    const [calls, recordings] = await Promise.all([
      client.calls.list({ to: twilioPhone, startTimeAfter: since, limit: 500 }),
      client.recordings.list({ dateCreatedAfter: since, limit: 500 }),
    ])

    // Build callSid -> recording URL map
    const recordingMap = new Map<string, string>()
    for (const rec of recordings) {
      if (rec.callSid && !recordingMap.has(rec.callSid)) {
        recordingMap.set(
          rec.callSid,
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${rec.sid}.mp3`,
        )
      }
    }

    const rows = calls.map((call) => {
      const duration = parseInt(call.duration ?? '0', 10)
      const recordingUrl = recordingMap.get(call.sid) ?? null

      let outcome: string
      if (call.status === 'completed' && duration > 30 && !recordingUrl) {
        outcome = 'answered'
      } else if (recordingUrl) {
        outcome = 'voicemail'
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
        recording_url: recordingUrl,
        raw_dial_status: call.status,
        created_at: call.startTime?.toISOString() ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    })

    if (rows.length === 0) {
      return NextResponse.json({ inserted: 0, message: 'No calls found' })
    }

    const supabase = createAdminClient()
    // Use ignoreDuplicates: false so re-running updates recording_url on existing rows
    const { error } = await supabase
      .from('call_logs')
      .upsert(rows, { onConflict: 'call_sid', ignoreDuplicates: false })

    if (error) throw error

    const withRecordings = rows.filter((r) => r.recording_url).length
    return NextResponse.json({
      inserted: rows.length,
      with_recordings: withRecordings,
    })
  } catch (err) {
    console.error('[admin/call-logs/backfill][POST]', err)
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 })
  }
}
