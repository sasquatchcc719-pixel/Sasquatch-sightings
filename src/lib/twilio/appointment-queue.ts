import { randomUUID } from 'node:crypto'
import twilio, { type Twilio } from 'twilio'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/supabase/server'
import { escapeTwiml } from './forward-twiml'
import { getCallRoutingConfig } from './call-routing-config'

export const APPOINTMENT_QUEUE = 'sasquatch-appointments'
export const QUEUE_WAIT_SECONDS = 180
export const QUEUE_POLL_SECONDS = 8
const PENDING_DISPATCH_SECONDS = 30
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
  caller_sid: string | null
  stage: 'primary' | 'secondary'
  accepted: boolean
  claimed_at: string | null
}

export async function getQueueDispatch(db: SupabaseClient) {
  const { data, error } = await db
    .from('appointment_call_dispatch')
    .select('queue_sid,token,worker_sid,caller_sid,stage,accepted,claimed_at')
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
    .update({
      token: null,
      worker_sid: null,
      caller_sid: null,
      stage: 'primary',
      accepted: false,
      claimed_at: null,
    })
    .eq('id', true)
    .eq('token', token)
    .eq('worker_sid', workerSid)
  if (error) throw error
}

export async function acceptQueueDispatch(
  db: SupabaseClient,
  token: string,
  workerSid: string,
) {
  const { data, error } = await db.rpc('accept_appointment_dispatch', {
    p_token: token,
    p_worker_sid: workerSid,
  })
  if (error) throw error
  return data === true
}

async function startAppointmentWorker(
  db: SupabaseClient,
  client: Twilio,
  token: string,
  stage: Dispatch['stage'],
) {
  const config = await getCallRoutingConfig()
  const to =
    stage === 'secondary'
      ? config.secondaryForwardNumber
      : config.primaryForwardNumber
  if (!to) return false
  const base = queueBaseUrl()
  const worker = await client.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER!,
    timeout: config.ivrScheduleTimeoutSeconds,
    url: `${base}/api/twilio/appointment-agent?token=${token}`,
    method: 'POST',
    statusCallback: `${base}/api/twilio/appointment-agent?token=${token}&event=status`,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['completed'],
  })
  await bindQueueWorker(db, token, worker.sid)
  return true
}

async function sendQueuedCallerToVoicemail(client: Twilio, state: Dispatch) {
  if (!state.caller_sid) return
  try {
    await client
      .queues(state.queue_sid)
      .members(state.caller_sid)
      .update({
        url: `${queueBaseUrl()}/api/twilio/call-after-hours`,
        method: 'POST',
      })
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error
  }
}

export async function completeAppointmentAttempt(
  db: SupabaseClient,
  client: Twilio,
  token: string,
  workerSid: string,
) {
  const state = await getQueueDispatch(db)
  if (state.token !== token || state.worker_sid !== workerSid) return false
  if (state.accepted) {
    await releaseQueueDispatch(db, token, workerSid)
    return true
  }
  const config = await getCallRoutingConfig()
  if (state.stage === 'primary' && config.secondaryForwardNumber) {
    const nextToken = randomUUID()
    const { data, error } = await db.rpc('advance_appointment_dispatch', {
      p_token: token,
      p_worker_sid: workerSid,
      p_next_token: nextToken,
    })
    if (error) throw error
    if (data === true)
      await startAppointmentWorker(db, client, nextToken, 'secondary')
    return data === true
  }
  await sendQueuedCallerToVoicemail(client, state)
  await releaseQueueDispatch(db, token, workerSid)
  return true
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
    await completeAppointmentAttempt(db, client, state.token, state.worker_sid)
    return
  }
  let stage: Dispatch['stage'] = 'primary'
  let callerSid = ''
  if (state.token) {
    const claimedAt = Date.parse(state.claimed_at || '')
    if (
      Number.isFinite(claimedAt) &&
      Date.now() - claimedAt < PENDING_DISPATCH_SECONDS * 1000
    )
      return
    stage = state.stage
    callerSid = state.caller_sid || ''
  }
  if (callerSid) {
    try {
      await client.queues(state.queue_sid).members(callerSid).fetch()
    } catch (error) {
      if ((error as { status?: number }).status === 404) return
      throw error
    }
  } else {
    const member = await client.queues(state.queue_sid).members('Front').fetch()
    callerSid = /^CA[0-9a-f]{32}$/i.test(member.callSid)
      ? member.callSid
      : member.uri.match(/Members\/(CA[0-9a-f]{32})\.json$/i)?.[1] || ''
  }
  if (!/^CA[0-9a-f]{32}$/i.test(callerSid))
    throw new Error('Invalid queued caller')
  const token = randomUUID()
  const claim = await db.rpc('claim_appointment_dispatch_v2', {
    p_token: token,
    p_caller_sid: callerSid,
    p_stage: stage,
  })
  if (claim.error) throw claim.error
  if (!claim.data) return
  await startAppointmentWorker(db, client, token, stage)
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
