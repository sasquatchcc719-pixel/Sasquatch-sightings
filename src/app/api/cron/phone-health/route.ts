import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'
import { runPhoneHealthCheck } from '@/lib/twilio/phone-health'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } =
    process.env
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER)
    return NextResponse.json(
      { error: 'Phone monitor credentials are not configured' },
      { status: 503 },
    )
  try {
    const summary = await runPhoneHealthCheck(
      createAdminClient(),
      twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
      TWILIO_PHONE_NUMBER,
    )
    return NextResponse.json(summary, {
      status: summary.errors.length ? 500 : 200,
    })
  } catch (error) {
    console.error('[Phone Health] Check failed:', error)
    return NextResponse.json(
      { error: 'Phone monitor failed; check server logs' },
      { status: 500 },
    )
  }
}
