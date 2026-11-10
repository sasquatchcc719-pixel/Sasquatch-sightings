import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'

/** Provider evidence only. This endpoint never sends or retries an SMS. */
export async function POST(request: NextRequest) {
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]),
  )
  // Match the fixed URL used by the review sender, including the signed query.
  const publicUrl = `https://sightings.sasquatchcarpet.com/api/twilio/review-status${request.nextUrl.search}`
  if (!validateTwilioInboundRequest({ request, form, publicUrl }))
    return new NextResponse('Forbidden', { status: 403 })
  const requestId = request.nextUrl.searchParams.get('request') || ''
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      requestId,
    ) ||
    !/^SM[a-f0-9]{32}$/i.test(form.MessageSid || '') ||
    ![
      'accepted',
      'queued',
      'sending',
      'sent',
      'delivered',
      'undelivered',
      'failed',
      'canceled',
    ].includes(form.MessageStatus || '') ||
    (form.ErrorCode && !/^\d{1,10}$/.test(form.ErrorCode))
  )
    return new NextResponse('Invalid callback', { status: 400 })
  const { error } = await createAdminClient().rpc(
    'record_review_request_delivery',
    {
      p_request: requestId,
      p_sid: form.MessageSid,
      p_status: form.MessageStatus,
      p_error_code: form.ErrorCode || null,
      p_is_callback: true,
    },
  )
  if (error) return new NextResponse('Retry callback', { status: 503 })
  return new NextResponse(null, { status: 204 })
}
