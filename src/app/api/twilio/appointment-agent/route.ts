import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import { escapeTwiml } from '@/lib/twilio/forward-twiml'
import {
  APPOINTMENT_QUEUE,
  bindQueueWorker,
  getQueueDispatch,
  queueBaseUrl,
  queueClient,
  queueResponse,
  releaseQueueDispatch,
} from '@/lib/twilio/appointment-queue'

export async function POST(request: NextRequest) {
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]),
  )
  if (!validateTwilioInboundRequest({ request, form }))
    return new NextResponse('Forbidden', { status: 403 })
  const token = request.nextUrl.searchParams.get('token') || ''
  if (
    !/^[0-9a-f-]{36}$/i.test(token) ||
    !/^CA[0-9a-f]{32}$/i.test(form.CallSid || '')
  )
    return new NextResponse('Invalid attempt', { status: 400 })
  const xml = (body: string) =>
    new NextResponse(queueResponse(body), {
      headers: { 'Content-Type': 'text/xml' },
    })
  const db = createAdminClient()
  try {
    if (request.nextUrl.searchParams.get('event') === 'status') {
      if (
        ['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(
          form.CallStatus,
        )
      ) {
        // Bind first: a very fast terminal callback can beat calls.create's response.
        if (await bindQueueWorker(db, token, form.CallSid))
          await releaseQueueDispatch(db, token, form.CallSid)
      }
      return new NextResponse(null, { status: 204 })
    }
    if (request.nextUrl.searchParams.get('event') === 'done')
      return xml('<Hangup/>')
    if (!(await bindQueueWorker(db, token, form.CallSid)))
      return xml('<Hangup/>')
    const state = await getQueueDispatch(db)
    const queue = await queueClient().queues(state.queue_sid).fetch()
    if (!queue.currentSize) return xml('<Hangup/>')
    if (form.Digits === '1') {
      const bridge = `${queueBaseUrl()}/api/twilio/appointment-queue?event=bridge&token=${token}`
      const done = `${queueBaseUrl()}/api/twilio/appointment-agent?token=${token}&event=done`
      return xml(
        `<Dial timeout="5" action="${escapeTwiml(done)}" method="POST"><Queue url="${escapeTwiml(bridge)}" method="POST">${APPOINTMENT_QUEUE}</Queue></Dial>`,
      )
    }
    if (request.nextUrl.searchParams.get('attempt') === '1')
      return xml('<Hangup/>')
    const action = `${queueBaseUrl()}/api/twilio/appointment-agent?token=${token}&attempt=1`
    return xml(
      `<Gather action="${escapeTwiml(action)}" method="POST" numDigits="1" timeout="5" actionOnEmptyResult="true"><Say>Sasquatch appointment call. Press 1 to accept.</Say></Gather><Hangup/>`,
    )
  } catch (error) {
    console.error('[Appointment Agent] Error:', error)
    return new NextResponse('Could not handle appointment call', {
      status: 503,
    })
  }
}
