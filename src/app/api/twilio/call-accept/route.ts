import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import { createAdminClient } from '@/supabase/server'
import { escapeTwiml } from '@/lib/twilio/forward-twiml'

export async function POST(request: NextRequest) {
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([key, value]) => [
      key,
      String(value),
    ]),
  )
  if (!validateTwilioInboundRequest({ request, form }))
    return new NextResponse('Forbidden', { status: 403 })
  const parent = request.nextUrl.searchParams.get('parent') || ''
  if (!/^CA[0-9a-f]{32}$/i.test(parent))
    return new NextResponse('Invalid call', { status: 400 })
  // Bind acceptance to the signed child call; never trust a caller-supplied SID.
  if (form.ParentCallSid && form.ParentCallSid !== parent)
    return new NextResponse('Invalid parent', { status: 403 })
  if (form.Digits === '1' && !form.ParentCallSid) {
    const child = await twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    )
      .calls(form.CallSid)
      .fetch()
    if (child.parentCallSid !== parent)
      return new NextResponse('Invalid parent', { status: 403 })
  }
  const xml = (body: string) =>
    new NextResponse(`<Response>${body}</Response>`, {
      headers: { 'Content-Type': 'text/xml' },
    })
  if (form.Digits === '1') {
    const { data, error } = await createAdminClient()
      .from('call_logs')
      .update({
        forwarding_required: true,
        forwarding_accepted_at: new Date().toISOString(),
      })
      .eq('call_sid', parent)
      .select('call_sid')
    if (error || !data?.length)
      return new NextResponse('Could not accept call', { status: 503 })
    return xml('<Say>Connecting.</Say>')
  }
  if (request.nextUrl.searchParams.get('attempt') === '1')
    return xml('<Hangup/>')
  const action = new URL(request.url)
  action.searchParams.set('attempt', '1')
  return xml(
    `<Gather action="${escapeTwiml(action.toString())}" method="POST" numDigits="1" timeout="5" actionOnEmptyResult="true"><Say>Sasquatch customer call. Press 1 to accept.</Say></Gather><Hangup/>`,
  )
}
