import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import { createAdminClient } from '@/supabase/server'

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
  if (!form.ParentCallSid) {
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
  // A database outage must not disconnect an answered forwarded call.
  // The signed Dial action's DialBridged flag is the independent fallback.
  try {
    const { error } = await createAdminClient()
      .from('call_logs')
      .update({
        forwarding_required: true,
        forwarding_accepted_at: new Date().toISOString(),
      })
      .eq('call_sid', parent)
      .select('call_sid')
    if (error) console.error('[Call Accept] Could not save acceptance:', error)
  } catch (error) {
    console.error('[Call Accept] Could not save acceptance:', error)
  }
  return xml('')
}
