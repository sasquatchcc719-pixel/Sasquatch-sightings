import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import {
  applyCallHistoryRepair,
  planCallHistoryRepair,
} from '@/lib/twilio/call-history'

export const maxDuration = 300

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
    const supabase = createAdminClient()
    const plan = await planCallHistoryRepair(supabase, client, twilioPhone)
    return NextResponse.json(await applyCallHistoryRepair(supabase, plan))
  } catch (err) {
    console.error('[admin/call-logs/backfill][POST]', err)
    return NextResponse.json(
      { error: 'History sync failed. Retry to finish any remaining records.' },
      { status: 500 },
    )
  }
}
