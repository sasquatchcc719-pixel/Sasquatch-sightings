import type { SupabaseClient } from '@supabase/supabase-js'
import type { Twilio } from 'twilio'
import type { CallInstance } from 'twilio/lib/rest/api/v2010/account/call'
import type { RecordingInstance } from 'twilio/lib/rest/api/v2010/account/recording'
import {
  getCallRoutingConfig,
  type CallRoutingConfig,
} from './call-routing-config'
import { getForwardNumbers } from './forward-numbers'
import { sendTelegramNotification } from '@/lib/telegram'

const BASE_URL = 'https://sightings.sasquatchcarpet.com'
const LIMIT = 1000
const GRACE_MS = 5 * 60_000
const FINAL_STATUSES = new Set([
  'completed',
  'busy',
  'no-answer',
  'failed',
  'canceled',
])
type Call = Pick<
  CallInstance,
  | 'sid'
  | 'parentCallSid'
  | 'from'
  | 'to'
  | 'direction'
  | 'status'
  | 'startTime'
  | 'endTime'
  | 'duration'
>
type Recording = Pick<
  RecordingInstance,
  'sid' | 'callSid' | 'source' | 'status' | 'duration' | 'dateCreated'
>
type StoredCall = {
  outcome: string
  recording_url: string | null
  forwarding_required?: boolean
  caller_screening_status?:
    | 'pending'
    | 'passed'
    | 'voicemail'
    | 'bypassed'
    | null
  forwarding_accepted_at?: string | null
  appointment_queued_at?: string | null
}
export type PhoneHealthIssue = {
  key: string
  issue: string
  details: Record<string, unknown>
}

export function forwardingExpectedAt(
  start: Date,
  config: CallRoutingConfig,
): boolean {
  if (config.temporaryOpenLineMode) return true
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
  }).format(start)
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(start),
  )
  return (
    config.businessDays.some(
      (d) => d.toLowerCase() === weekday.toLowerCase(),
    ) &&
    hour >= config.businessHoursStart &&
    hour < config.businessHoursEnd
  )
}

/** Provider evidence is independent of whether our webhook logged the call. */
export function inspectPhoneCall(
  parent: Call,
  children: Call[],
  recordings: Recording[],
  stored: StoredCall | null,
  config: CallRoutingConfig,
  now: Date,
): {
  issues: PhoneHealthIssue[]
  skipped: 'active' | 'blacklisted' | 'short' | null
} {
  const issues: PhoneHealthIssue[] = []
  if (stored?.outcome === 'blacklisted')
    return { issues, skipped: 'blacklisted' }
  if (
    !FINAL_STATUSES.has(parent.status) ||
    children.some((c) => !FINAL_STATUSES.has(c.status))
  )
    return { issues, skipped: 'active' }
  const start = parent.startTime
  if (!start || !parent.endTime)
    throw new Error(`Missing provider timestamps for ${parent.sid}`)
  const elapsed = (parent.endTime.getTime() - start.getTime()) / 1000
  const add = (issue: string, details: Record<string, unknown> = {}) =>
    issues.push({
      key: `${parent.sid}:${issue}`,
      issue,
      details: {
        callSid: parent.sid,
        caller: parent.from,
        startedAt: start.toISOString(),
        ...details,
      },
    })
  // Do not classify callers who hang up before a phone could reasonably ring.
  if (elapsed < 5) return { issues, skipped: 'short' }
  // The menu intentionally filters callers who do not select a valid option.
  // A saved pass also requires forwarding for after-hours water-damage calls.
  const screening = stored?.caller_screening_status
  const expected =
    screening == null
      ? forwardingExpectedAt(start, config)
      : screening === 'passed' || screening === 'bypassed'
  const targets = getForwardNumbers(config)
  const actual = children.filter((c) => targets.includes(c.to))
  if (expected && !stored?.appointment_queued_at && actual.length === 0)
    add(
      screening == null
        ? 'No forwarding attempt during business hours'
        : 'Required forwarding was not attempted',
      {
        elapsedSeconds: elapsed,
        ...(screening ? { callerScreeningStatus: screening } : {}),
      },
    )
  for (const child of children) {
    if (child.status === 'failed')
      add('Forwarding leg failed', { childSid: child.sid, target: child.to })
    if (
      !targets.includes(child.to) &&
      child.to !== config.failoverForwardNumber &&
      child.to !== 'client:admin_charles' &&
      child.to !== 'admin_charles'
    )
      add('Unexpected forwarding destination', {
        childSid: child.sid,
        target: child.to,
      })
  }
  const primary = actual.find((c) => c.to === targets[0])
  const retryable =
    primary &&
    (['no-answer', 'busy', 'failed'].includes(primary.status) ||
      (primary.status === 'completed' &&
        stored?.forwarding_required &&
        !stored.forwarding_accepted_at))
  if (
    targets[1] &&
    retryable &&
    primary.endTime &&
    parent.endTime.getTime() - primary.endTime.getTime() >= 5_000 &&
    !actual.some((c) => c.to === targets[1])
  )
    add('Secondary phone was not attempted', { primaryStatus: primary.status })
  if (now.getTime() - parent.endTime.getTime() >= GRACE_MS) {
    if (!stored) add('Inbound call missing from call log')
    else if (stored.outcome === 'inbound')
      add('Call outcome callback was not saved')
    const voicemail = recordings.find(
      (r) =>
        r.source === 'RecordVerb' &&
        r.status === 'completed' &&
        Number(r.duration) > 0,
    )
    if (
      voicemail &&
      (!stored?.recording_url?.includes(voicemail.sid) ||
        stored.outcome !== 'voicemail')
    )
      add('Voicemail recording missing from call log', {
        recordingSid: voicemail.sid,
      })
  }
  return { issues, skipped: null }
}

/** A database lease prevents concurrent cron invocations from duplicating alerts. */
export async function deliverPhoneHealthAlert(
  db: SupabaseClient,
  item: PhoneHealthIssue,
): Promise<boolean> {
  const claim = await db.rpc('claim_phone_health_alert', {
    p_key: item.key,
    p_issue: item.issue,
    p_details: item.details,
  })
  if (claim.error) {
    // If the database itself is down, the monitor must still reach the owner.
    // There is no durable deduplication available until storage recovers.
    if (item.key.startsWith('monitor-error:')) {
      const sent = await sendTelegramNotification(
        `PHONE MONITOR ERROR\n${item.issue}\nAlert storage is unavailable. Check the phone system and server logs.`,
      )
      if (!sent)
        throw new Error(
          'Phone monitor storage and Telegram delivery both failed',
        )
    }
    throw claim.error
  }
  if (!claim.data) return false
  const sent = await sendTelegramNotification(
    `PHONE SYSTEM ALERT\n${item.issue}\n${Object.entries(item.details)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n')}\nCheck: ${BASE_URL}/admin/phone`,
  )
  const result = await db
    .from('phone_health_alerts')
    .update({
      lease_until: null,
      ...(sent ? { sent_at: new Date().toISOString() } : {}),
    })
    .eq('alert_key', item.key)
  if (result.error) throw result.error
  if (!sent)
    throw new Error(
      'Phone health Telegram alert was not delivered; retry is pending',
    )
  return true
}

export async function runPhoneHealthCheck(
  db: SupabaseClient,
  client: Twilio,
  phone: string,
  now = new Date(),
) {
  const summary = {
    checkedAt: now.toISOString(),
    configChecked: false,
    callsChecked: 0,
    active: 0,
    blacklisted: 0,
    shortCalls: 0,
    issues: 0,
    alertsSent: 0,
    errors: [] as string[],
  }
  const issues: PhoneHealthIssue[] = []
  try {
    const [rollout, settings] = await Promise.all([
      db
        .from('phone_health_state')
        .select('checked_at')
        .eq('key', 'rollout')
        .single(),
      db.from('phone_settings').select('id').limit(1).single(),
    ])
    if (rollout.error) throw rollout.error
    if (settings.error) throw settings.error
    const rolloutTime = Date.parse(rollout.data.checked_at)
    if (!Number.isFinite(rolloutTime))
      throw new Error('Phone monitoring rollout timestamp is invalid')
    const since = new Date(Math.max(now.getTime() - 60 * 60_000, rolloutTime))
    const [numbers, calls, recordings, providerAlerts, config] =
      await Promise.all([
        client.incomingPhoneNumbers.list({ phoneNumber: phone, limit: 2 }),
        client.calls.list({
          startTimeAfter: since,
          pageSize: LIMIT,
          limit: LIMIT,
        }),
        client.recordings.list({
          dateCreatedAfter: since,
          pageSize: LIMIT,
          limit: LIMIT,
        }),
        client.monitor.v1.alerts.list({
          startDate: since,
          logLevel: 'error',
          pageSize: LIMIT,
          limit: LIMIT,
        }),
        getCallRoutingConfig(),
      ])
    if (
      calls.length >= LIMIT ||
      recordings.length >= LIMIT ||
      providerAlerts.length >= LIMIT
    )
      throw new Error(
        'Provider phone health response reached its safety cap; results are incomplete',
      )
    const number = numbers.find((n) => n.phoneNumber === phone)
    if (!number || numbers.length !== 1)
      throw new Error('Business phone number was not uniquely found in Twilio')
    const expectedConfig = {
      voiceUrl: `${BASE_URL}/api/twilio/call-router`,
      voiceMethod: 'POST',
      statusCallback: `${BASE_URL}/api/twilio/call-status`,
      statusCallbackMethod: 'POST',
      voiceFallbackUrl: `${BASE_URL}/api/twilio/call-fallback`,
      voiceFallbackMethod: 'POST',
    } as const
    for (const [field, expected] of Object.entries(expectedConfig)) {
      const actual = number[field as keyof typeof expectedConfig]
      if (actual !== expected)
        issues.push({
          key: `configuration:${field}:${now.toISOString().slice(0, 10)}`,
          issue: `Business phone ${field} is misconfigured`,
          details: { expected, actual },
        })
    }
    if (
      getForwardNumbers(config).filter((target) =>
        /^\+[1-9]\d{7,14}$/.test(target),
      ).length < 2
    ) {
      issues.push({
        key: `configuration:forward-targets:${now.toISOString().slice(0, 10)}`,
        issue: 'Business phone requires two distinct valid forwarding numbers',
        details: {
          primary: config.primaryForwardNumber,
          secondary: config.secondaryForwardNumber,
        },
      })
    }
    summary.configChecked = true
    const parents = calls.filter(
      (c) =>
        c.direction === 'inbound' &&
        !c.parentCallSid &&
        c.to === phone &&
        c.startTime &&
        c.startTime.getTime() >= since.getTime(),
    )
    const callSids = new Set(parents.map((p) => p.sid))
    for (const alert of providerAlerts) {
      if (alert.dateCreated.getTime() < since.getTime()) continue
      if (
        !callSids.has(alert.resourceSid) &&
        !alert.requestUrl?.startsWith(`${BASE_URL}/api/twilio/`)
      )
        continue
      issues.push({
        key: `provider-error:${alert.sid}`,
        issue: 'Twilio reported a phone webhook error',
        details: {
          errorCode: alert.errorCode,
          callSid: alert.resourceSid,
          requestUrl: alert.requestUrl,
        },
      })
    }
    for (const parent of parents) {
      const stored = await db
        .from('call_logs')
        .select(
          'outcome,recording_url,forwarding_required,forwarding_accepted_at,caller_screening_status,appointment_queued_at',
        )
        .eq('call_sid', parent.sid)
        .maybeSingle()
      if (stored.error) throw stored.error
      const callRecordings = recordings.filter((r) => r.callSid === parent.sid)
      const inspection = inspectPhoneCall(
        parent,
        calls.filter((c) => c.parentCallSid === parent.sid),
        callRecordings,
        stored.data,
        config,
        now,
      )
      summary.callsChecked++
      if (inspection.skipped === 'active') summary.active++
      if (inspection.skipped === 'blacklisted') summary.blacklisted++
      if (inspection.skipped === 'short') summary.shortCalls++
      issues.push(...inspection.issues)
      if (
        inspection.skipped ||
        !parent.endTime ||
        now.getTime() - parent.endTime.getTime() < GRACE_MS
      )
        continue
      for (const recording of callRecordings.filter(
        (r) =>
          r.source === 'RecordVerb' &&
          r.status === 'completed' &&
          Number(r.duration) > 0,
      )) {
        // Check recording identity in the real caller's thread, not merely any
        // conversation containing the SID (the former bug saved it under '+').
        const conversation = await db
          .from('conversations')
          .select('id,messages')
          .eq('phone_number', parent.from)
          .eq('source', 'inbound')
          .contains('messages', [
            { metadata: { recording_sid: recording.sid } },
          ])
          .limit(1)
        if (conversation.error) throw conversation.error
        if (!conversation.data?.length)
          issues.push({
            key: `${parent.sid}:conversation:${recording.sid}`,
            issue: 'Voicemail missing from the correct caller conversation',
            details: {
              callSid: parent.sid,
              caller: parent.from,
              recordingSid: recording.sid,
            },
          })
        else {
          const messages = conversation.data.flatMap((row) =>
            Array.isArray(row.messages) ? row.messages : [],
          )
          const message = messages.find(
            (message) => message?.metadata?.recording_sid === recording.sid,
          )
          if (
            message?.metadata?.recording_completed === true &&
            message.metadata.email_sent !== true
          ) {
            issues.push({
              key: `${parent.sid}:notification:${recording.sid}`,
              issue:
                'Owner voicemail recording notification was not confirmed delivered',
              details: {
                callSid: parent.sid,
                caller: parent.from,
                recordingSid: recording.sid,
              },
            })
          }
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    summary.errors.push(message)
    issues.push({
      key: `monitor-error:${now.toISOString().slice(0, 10)}`,
      issue: 'Phone monitor could not complete its checks',
      details: { error: message },
    })
  }
  // Retry unsent alerts even if their original call has left the hourly window.
  const pending = await db
    .from('phone_health_alerts')
    .select('alert_key,issue,details')
    .is('sent_at', null)
    .limit(LIMIT)
  if (pending.error) summary.errors.push(pending.error.message)
  else if (pending.data.length >= LIMIT)
    summary.errors.push('Pending phone health alerts reached the safety cap')
  else
    for (const alert of pending.data) {
      if (!issues.some((item) => item.key === alert.alert_key))
        issues.push({
          key: alert.alert_key,
          issue: alert.issue,
          details: alert.details,
        })
    }
  summary.issues = issues.length
  for (const issue of issues) {
    try {
      if (await deliverPhoneHealthAlert(db, issue)) summary.alertsSent++
    } catch (error) {
      summary.errors.push(
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  const saved = await db
    .from('phone_health_state')
    .upsert(
      { key: 'latest', checked_at: now.toISOString(), summary },
      { onConflict: 'key' },
    )
  if (saved.error) throw saved.error
  return summary
}
