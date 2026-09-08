import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createAdminClient } from '@/supabase/server'
import { reconcileEndedCall } from '@/lib/twilio/call-history'

export const maxDuration = 60

// Configured as the business number's call-ended callback. This still fires
// when the caller hangs up during the greeting or before a Dial action runs.
export async function POST(request: NextRequest) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN)
    return new NextResponse('Not configured', { status: 503 })
  const form = await request.formData()
  const params = Object.fromEntries(
    [...form.entries()].map(([key, value]) => [key, String(value)]),
  )
  if (
    !twilio.validateRequest(
      TWILIO_AUTH_TOKEN,
      request.headers.get('x-twilio-signature') || '',
      request.url,
      params,
    ) ||
    params.AccountSid !== TWILIO_ACCOUNT_SID
  )
    return new NextResponse('Forbidden', { status: 403 })
  if (!/^CA[0-9a-f]{32}$/i.test(params.CallSid || ''))
    return new NextResponse('Invalid call SID', { status: 400 })
  if (
    !['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(
      params.CallStatus,
    )
  )
    return new NextResponse(null, { status: 204 })
  try {
    await reconcileEndedCall(
      createAdminClient(),
      twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
      params.CallSid,
    )
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[Call Status] Reconciliation failed:', error)
    return new NextResponse('Could not save call outcome', { status: 500 })
  }
}
