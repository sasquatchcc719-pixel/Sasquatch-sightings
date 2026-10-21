import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_CONFIG } from '@/lib/twilio/call-routing-config'
import { buildForwardDial } from '@/lib/twilio/forward-twiml'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import { isBlacklisted } from '@/lib/blacklist'
import { createAdminClient } from '@/supabase/server'

// Twilio invokes this if the primary webhook times out or returns an error.
export async function POST(request: NextRequest) {
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]),
  )
  if (!validateTwilioInboundRequest({ request, form }))
    return new NextResponse('Forbidden', { status: 403 })
  if (await isBlacklisted(form.From, { throwOnError: true }))
    return new NextResponse('<Response><Reject/></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  const { error } = await createAdminClient().from('call_logs').upsert(
    {
      call_sid: form.CallSid,
      caller_phone: form.From,
      outcome: 'inbound',
      forwarding_required: true,
    },
    { onConflict: 'call_sid', ignoreDuplicates: true },
  )
  if (error) console.error('[Call Fallback] Could not log call', error)
  console.error(
    '[Call Fallback] Primary router failed; using emergency forwarding',
    form.CallSid,
  )
  return new NextResponse(
    buildForwardDial({
      config: DEFAULT_CONFIG,
      callerPhone: form.From,
      callSid: form.CallSid,
      baseUrl: 'https://sightings.sasquatchcarpet.com',
      mode: 'open-line',
    }),
    { headers: { 'Content-Type': 'text/xml' } },
  )
}
