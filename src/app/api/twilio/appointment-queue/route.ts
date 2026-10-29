import { after, NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { validateTwilioInboundRequest } from '@/lib/twilio/inbound-auth'
import { escapeTwiml } from '@/lib/twilio/forward-twiml'
import { writeCallLog } from '@/lib/twilio/call-history'
import {
  bindQueueWorker,
  dispatchAppointmentCall,
  getQueueDispatch,
  queueBaseUrl,
  queueResponse,
  queueWaitAudio,
} from '@/lib/twilio/appointment-queue'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const form = Object.fromEntries(
    [...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]),
  )
  if (!validateTwilioInboundRequest({ request, form }))
    return new NextResponse('Forbidden', { status: 403 })
  if (!/^CA[0-9a-f]{32}$/i.test(form.CallSid || ''))
    return new NextResponse('Invalid call', { status: 400 })
  const event = request.nextUrl.searchParams.get('event')
  const db = createAdminClient()
  const xml = (body: string) =>
    new NextResponse(queueResponse(body), {
      headers: { 'Content-Type': 'text/xml' },
    })
  const voicemail = () =>
    xml(
      `<Redirect method="POST">${escapeTwiml(`${queueBaseUrl()}/api/twilio/call-after-hours`)}</Redirect>`,
    )
  try {
    if (event === 'bridge') {
      const token = request.nextUrl.searchParams.get('token') || ''
      const state = await getQueueDispatch(db)
      if (
        state.queue_sid !== form.QueueSid ||
        !/^CA[0-9a-f]{32}$/i.test(form.DequeingCallSid || '') ||
        !(await bindQueueWorker(db, token, form.DequeingCallSid || ''))
      )
        return new NextResponse('Invalid dispatcher', { status: 403 })
      // This provider callback identifies the actual FIFO caller being bridged.
      await writeCallLog(db, {
        call_sid: form.CallSid,
        outcome: 'answered',
        forwarding_required: true,
        forwarding_accepted_at: new Date().toISOString(),
        queue_worker_sid: form.DequeingCallSid,
      })
      return xml('<Say>Connecting.</Say>')
    }
    if (event === 'result') {
      // The REST dequeue now continues at appointment-forward. This callback
      // only reports departure; it must not start voicemail over that call.
      if (form.QueueResult === 'redirected') return xml('')
      if (['bridged', 'redirected-from-bridged'].includes(form.QueueResult)) {
        const { data, error } = await db
          .from('call_logs')
          .select('forwarding_accepted_at')
          .eq('call_sid', form.CallSid)
          .maybeSingle()
        if (error) throw error
        await writeCallLog(db, {
          call_sid: form.CallSid,
          outcome: 'answered',
          duration_seconds: data?.forwarding_accepted_at
            ? Math.max(
                0,
                Math.round(
                  (Date.now() - Date.parse(data.forwarding_accepted_at)) / 1000,
                ),
              )
            : null,
          raw_dial_status: 'completed',
        })
        return xml('<Hangup/>')
      }
      if (form.QueueResult === 'hangup') return xml('<Hangup/>')
      return voicemail()
    }
    if (event !== 'wait')
      return new NextResponse('Invalid event', { status: 400 })
    const elapsed = Number(form.QueueTime)
    const audio = queueWaitAudio(queueBaseUrl(), elapsed)
    if (audio !== '<Leave/>') {
      // Deliver music immediately. Provider delays must not extend the timer
      // or exceed Twilio's voice webhook deadline.
      after(async () => {
        try {
          await dispatchAppointmentCall(db)
        } catch (error) {
          console.error(
            '[Appointment Queue] Dispatch failed; will retry:',
            error,
          )
        }
      })
    }
    return xml(audio)
  } catch (error) {
    console.error('[Appointment Queue] Error:', error)
    // Once a conversation has ended, a logging outage must not start voicemail.
    if (
      ['bridged', 'redirected-from-bridged', 'hangup'].includes(
        form.QueueResult,
      )
    )
      return xml('<Hangup/>')
    return event === 'bridge'
      ? new NextResponse('Could not connect caller', { status: 503 })
      : event === 'wait'
        ? xml('<Leave/>')
        : voicemail()
  }
}
