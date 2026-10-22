import { randomUUID } from 'node:crypto'
import twilio, { type Twilio } from 'twilio'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/supabase/server'
import { getCallRoutingConfig } from './call-routing-config'
import { escapeTwiml } from './forward-twiml'

export const APPOINTMENT_QUEUE = 'sasquatch-appointments'
export const QUEUE_WAIT_SECONDS = 180
export const QUEUE_POLL_SECONDS = 8
const TERMINAL = new Set([
  'completed',
  'busy',
  'no-answer',
  'failed',
  'canceled',
])

export function queueBaseUrl() {
  const url = (
    process.env.TWILIO_WEBHOOK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://sightings.sasquatchcarpet.com'
  ).trim()
  return (url.startsWith('http') ? url : `https://${url}`).replace(/\/$/, '')
}

export function queueClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, {
    timeout: 8000,
    autoRetry: false,
  })
}

export function queueResponse(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`
}

export function buildAppointmentEnqueue(baseUrl: string) {
  return queueResponse(
    `<Say>Please hold while we connect you to schedule your appointment.</Say><Enqueue action="${escapeTwiml(`${baseUrl}/api/twilio/appointment-queue?event=result`)}" method="POST" waitUrl="${escapeTwiml(`${baseUrl}/api/twilio/appointment-queue?event=wait`)}" waitUrlMethod="POST">${APPOINTMENT_QUEUE}</Enqueue>`,
  )
}

type Dispatch = {
  queue_sid: string
  token: string | null
  worker_sid: string | null
  claimed_at: string | null
}

export async function getQueueDispatch(db: SupabaseClient) {
  const { data, error } = await db
    .from('appointment_call_dispatch')
    .select('queue_sid,token,worker_sid,claimed_at')
    .eq('id', true)
    .single()
  if (error) throw error
  if (!/^QU[0-9a-f]{32}$/i.test(data?.queue_sid || ''))
    throw new Error('Appointment queue is not configured')
  return data as Dispatch
}

export async function releaseQueueDispatch(
  db: SupabaseClient,
  token: string,
  workerSid: string,
) {
  const { error } = await db
    .from('appointment_call_dispatch')
    .update({ token: null, worker_sid: null, claimed_at: null })
    .eq('id', true)
    .eq('token', token)
    .eq('worker_sid', workerSid)
  if (error) throw error
}

export async function bindQueueWorker(
  db: SupabaseClient,
  token: string,
  workerSid: string,
) {
  const { data, error } = await db.rpc('bind_appointment_dispatch', {
    p_token: token,
    p_worker_sid: workerSid,
  })
  if (error) throw error
  return data === true
}

// Every waiting caller polls. The atomic claim admits just one outbound call;
// live calls retain the slot for their entire conversation, however long it is.
export async function dispatchAppointmentCall(
  db = createAdminClient(),
  client: Twilio = queueClient(),
) {
  const state = await getQueueDispatch(db)
  const queue = await client.queues(state.queue_sid).fetch()
  if (!queue.currentSize) return
  if (state.worker_sid && state.token) {
    const worker = await client.calls(state.worker_sid).fetch()
    if (!TERMINAL.has(worker.status)) return
    await releaseQueueDispatch(db, state.token, state.worker_sid)
  }
  const token = randomUUID()
  const claim = await db.rpc('claim_appointment_dispatch', { p_token: token })
  if (claim.error) throw claim.error
  if (!claim.data) return
  const config = await getCallRoutingConfig()
  const base = queueBaseUrl()
  // Never auto-retry creation: a network timeout can hide a successful dial.
  // Keep the pending claim for 90s; a late webhook binds/fences its attempt.
  const worker = await client.calls.create({
    to: config.primaryForwardNumber,
    from: process.env.TWILIO_PHONE_NUMBER!,
    timeout: 20,
    url: `${base}/api/twilio/appointment-agent?token=${token}`,
    method: 'POST',
    statusCallback: `${base}/api/twilio/appointment-agent?token=${token}&event=status`,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['completed'],
  })
  if (!(await bindQueueWorker(db, token, worker.sid))) {
    // A delayed creation response must not resurrect an expired attempt.
    const live = await client.calls(worker.sid).fetch()
    if (!TERMINAL.has(live.status))
      await client.calls(worker.sid).update({ status: 'completed' })
  }
}

export function queueWaitAudio(base: string, elapsed: number) {
  if (!Number.isFinite(elapsed) || elapsed < 0)
    throw new Error('Invalid queue time')
  const remaining = QUEUE_WAIT_SECONDS - elapsed
  if (remaining <= 0) return '<Leave/>'
  // Short final waits keep the voicemail cutoff at 180s, not the end of a song.
  return remaining < QUEUE_POLL_SECONDS
    ? `<Pause length="${Math.max(1, Math.floor(remaining))}"/>`
    : `<Play>${escapeTwiml(`${base}/audio/appointment-hold.mp3`)}</Play>`
}
