import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import { bindQueueWorker, queueBaseUrl } from '@/lib/twilio/appointment-queue'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'
import { buildForwardDial } from '@/lib/twilio/forward-twiml'

// Twilio dequeues the original inbound caller here, preserving their caller ID.
export async function POST(request: NextRequest) {
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]),
  )
  if (!validateTwilioInboundRequest({ request, form }))
    return new NextResponse('Forbidden', { status: 403 })
  const token = request.nextUrl.searchParams.get('token') || ''
  if (
    !/^[0-9a-f-]{36}$/i.test(token) ||
    !/^CA[0-9a-f]{32}$/i.test(form.CallSid || '') ||
    !form.From
  )
    return new NextResponse('Invalid caller', { status: 400 })
  try {
    if (!(await bindQueueWorker(createAdminClient(), token, form.CallSid)))
      return new NextResponse('<Response><Hangup/></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    const config = await getCallRoutingConfig()
    return new NextResponse(
      buildForwardDial({
        config,
        callerPhone: form.From,
        callSid: form.CallSid,
        baseUrl: queueBaseUrl(),
        mode: 'schedule',
      }),
      { headers: { 'Content-Type': 'text/xml' } },
    )
  } catch (error) {
    console.error('[Appointment Forward] Error:', error)
    return new NextResponse('Could not forward caller', { status: 503 })
  }
}
