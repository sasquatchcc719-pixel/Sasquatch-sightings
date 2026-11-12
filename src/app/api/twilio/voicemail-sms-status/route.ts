import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'

const statuses = [
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
] as const

/** Provider delivery evidence only. This endpoint never sends or retries SMS. */
export async function POST(request: NextRequest) {
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([key, value]) => [
      key,
      String(value),
    ]),
  )
  if (!validateTwilioInboundRequest({ request, form }))
    return new NextResponse('Forbidden', { status: 403 })
  if (
    !/^SM[a-f0-9]{32}$/i.test(form.MessageSid || '') ||
    !statuses.includes(form.MessageStatus as (typeof statuses)[number])
  )
    return new NextResponse('Invalid callback', { status: 400 })

  const { error } = await createAdminClient()
    .from('sms_logs')
    .update({ status: form.MessageStatus })
    .eq('twilio_sid', form.MessageSid)
    .like('message_type', 'voicemail_harry_reply:%')
  if (error) return new NextResponse('Retry callback', { status: 503 })
  return new NextResponse(null, { status: 204 })
}
