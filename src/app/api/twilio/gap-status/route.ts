import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'

export async function POST(request: NextRequest) {
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]),
  )
  if (!validateTwilioInboundRequest({ request, form }))
    return new NextResponse('Forbidden', { status: 403 })
  const recipient = request.nextUrl.searchParams.get('recipient') || ''
  if (
    !/^[a-f0-9-]{36}$/i.test(recipient) ||
    !/^SM[a-f0-9]{32}$/i.test(form.MessageSid || '') ||
    !['queued', 'sent', 'delivered', 'undelivered', 'failed'].includes(
      form.MessageStatus || '',
    )
  )
    return new NextResponse('Invalid callback', { status: 400 })
  const { error } = await createAdminClient().rpc(
    'record_gap_outreach_delivery',
    {
      p_recipient: recipient,
      p_sid: form.MessageSid,
      p_status: form.MessageStatus,
    },
  )
  if (error) return new NextResponse('Retry callback', { status: 503 })
  return new NextResponse(null, { status: 204 })
}
