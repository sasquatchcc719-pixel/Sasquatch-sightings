import type { SupabaseClient } from '@supabase/supabase-js'
import type { Twilio } from 'twilio'
import type { CallInstance } from 'twilio/lib/rest/api/v2010/account/call'
import type { RecordingInstance } from 'twilio/lib/rest/api/v2010/account/recording'

type Call = Pick<CallInstance, 'sid' | 'status' | 'duration'>
type Recording = Pick<
  RecordingInstance,
  'status' | 'source' | 'duration' | 'uri'
>
export type CallLogRow = {
  call_sid: string
  caller_phone: string | null
  outcome: string
  duration_seconds: number | null
  raw_dial_status: string | null
  recording_url: string | null
  transcription: string | null
  created_at: string
  updated_at: string
}

const activeStatuses = new Set(['queued', 'ringing', 'in-progress'])
const finalStatuses = new Set([
  'completed',
  'busy',
  'no-answer',
  'failed',
  'canceled',
])

// The inbound call includes the IVR and ringing time. Only a completed CHILD
// call proves the forwarding destination answered (possibly carrier voicemail).
export function resolveCallHistory(
  parent: Call,
  children: Call[],
  recordings: Recording[],
  existing?: Pick<CallLogRow, 'recording_url' | 'transcription'> &
    Partial<Pick<CallLogRow, 'duration_seconds'>>,
) {
  if (
    activeStatuses.has(parent.status) ||
    children.some((c) => activeStatuses.has(c.status))
  )
    return null
  if (!finalStatuses.has(parent.status)) return null
  const recording = recordings.find(
    (r) =>
      r.source === 'RecordVerb' &&
      r.status === 'completed' &&
      Number(r.duration) > 0,
  )
  // A processing recording will be finalized by its recording callback or sync.
  if (
    !recording &&
    recordings.some(
      (r) =>
        r.source === 'RecordVerb' &&
        ['processing', 'in-progress', 'paused', 'stopped'].includes(r.status),
    )
  )
    return null
  const answered = children.filter((c) => c.status === 'completed')
  const outcome =
    recording || existing?.recording_url || existing?.transcription
      ? 'voicemail'
      : answered.length
        ? 'answered'
        : 'no-answer'
  return {
    outcome,
    duration_seconds: recording
      ? Number(recording.duration)
      : outcome === 'voicemail'
        ? (existing?.duration_seconds ?? null)
        : answered.length
          ? answered.reduce(
              (seconds, c) => seconds + Number(c.duration || 0),
              0,
            )
          : null,
    raw_dial_status: answered.length ? 'completed' : parent.status,
    ...(recording
      ? {
          recording_url: `https://api.twilio.com${recording.uri.replace(/\.json$/, '.mp3')}`,
        }
      : {}),
  }
}

// Always await writes. Unawaited requests can be terminated with a serverless
// response. Late callbacks may enrich a voicemail, but cannot erase one.
export async function writeCallLog(
  db: SupabaseClient,
  row: {
    call_sid: string
    caller_phone?: string | null
    outcome: string
    duration_seconds?: number | null
    raw_dial_status?: string | null
    recording_url?: string
    transcription?: string
  },
) {
  const values = { ...row, updated_at: new Date().toISOString() }
  const { error: insertError } = await db
    .from('call_logs')
    .upsert(values, { onConflict: 'call_sid', ignoreDuplicates: true })
  if (insertError) throw insertError
  let update = db
    .from('call_logs')
    .update(values)
    .eq('call_sid', row.call_sid)
    .neq('outcome', 'blacklisted')
  if (row.outcome !== 'voicemail') update = update.neq('outcome', 'voicemail')
  if (row.outcome === 'no-answer') update = update.neq('outcome', 'answered')
  const { error } = await update
  if (error) throw error
}

export async function reconcileEndedCall(
  db: SupabaseClient,
  client: Twilio,
  callSid: string,
) {
  const [parent, children, recordings, stored] = await Promise.all([
    client.calls(callSid).fetch(),
    client.calls.list({ parentCallSid: callSid, pageSize: 1000 }),
    client.recordings.list({ callSid, pageSize: 1000 }),
    db
      .from('call_logs')
      .select('recording_url,transcription,outcome,duration_seconds')
      .eq('call_sid', callSid)
      .maybeSingle(),
  ])
  if (stored.error) throw stored.error
  if (parent.direction !== 'inbound' || stored.data?.outcome === 'blacklisted')
    return
  const result = resolveCallHistory(
    parent,
    children,
    recordings,
    stored.data ?? undefined,
  )
  if (!result) return
  await writeCallLog(db, {
    call_sid: callSid,
    caller_phone: parent.from,
    ...result,
  })
}

// Fetch complete dated snapshots, including child legs, instead of guessing from
// the duration of the IVR call. A capped response is an error, never a partial repair.
export async function planCallHistoryRepair(
  db: SupabaseClient,
  client: Twilio,
  phone: string,
) {
  const existing: CallLogRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from('call_logs')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id')
      .range(offset, offset + 999)
    if (error) throw error
    existing.push(...data)
    if (data.length < 1000) break
  }
  const since = new Date(
    Math.min(
      Date.now() - 90 * 86400000,
      ...existing.map((r) => Date.parse(r.created_at)),
    ),
  )
  const [calls, recordings] = await Promise.all([
    client.calls.list({ startTimeAfter: since, pageSize: 1000, limit: 10000 }),
    client.recordings.list({
      dateCreatedAfter: since,
      pageSize: 1000,
      limit: 10000,
    }),
  ])
  if (calls.length >= 10000 || recordings.length >= 10000)
    throw new Error(
      'Call history exceeded the safe batch size; use a narrower date range.',
    )
  const bySid = new Map(existing.map((r) => [r.call_sid, r]))
  const children = new Map<string, CallInstance[]>()
  const recordingsByCall = new Map<string, RecordingInstance[]>()
  for (const call of calls)
    if (call.parentCallSid)
      children.set(call.parentCallSid, [
        ...(children.get(call.parentCallSid) ?? []),
        call,
      ])
  for (const recording of recordings)
    recordingsByCall.set(recording.callSid, [
      ...(recordingsByCall.get(recording.callSid) ?? []),
      recording,
    ])
  const parents = calls.filter(
    (c) => c.direction === 'inbound' && (c.to === phone || bySid.has(c.sid)),
  )
  const changes = []
  let active = 0
  for (const parent of parents) {
    const before = bySid.get(parent.sid)
    if (before?.outcome === 'blacklisted') continue
    const result = resolveCallHistory(
      parent,
      children.get(parent.sid) ?? [],
      recordingsByCall.get(parent.sid) ?? [],
      before,
    )
    if (!result) {
      active++
      continue
    }
    const values = {
      ...result,
      call_sid: parent.sid,
      caller_phone: parent.from,
      created_at:
        before?.created_at ??
        (parent.startTime ?? parent.dateCreated).toISOString(),
    }
    if (
      !before ||
      Object.entries(values).some(
        ([k, v]) => before[k as keyof CallLogRow] !== v,
      )
    )
      changes.push({ before, values })
  }
  const found = new Set(parents.map((c) => c.sid))
  return {
    existing,
    changes,
    active,
    unavailable: existing
      .filter((r) => r.outcome === 'inbound' && !found.has(r.call_sid))
      .map((r) => r.call_sid),
  }
}

export async function applyCallHistoryRepair(
  db: SupabaseClient,
  plan: Awaited<ReturnType<typeof planCallHistoryRepair>>,
) {
  let inserted = 0,
    updated = 0,
    skipped = 0
  for (const { before, values } of plan.changes) {
    const row = { ...values, updated_at: new Date().toISOString() }
    // Compare-and-set keeps a live callback arriving during the snapshot from
    // losing its newer data. New rows do not overwrite concurrently inserted ones.
    const query = before
      ? db
          .from('call_logs')
          .update(row)
          .eq('call_sid', before.call_sid)
          .eq('updated_at', before.updated_at)
      : db
          .from('call_logs')
          .upsert(row, { onConflict: 'call_sid', ignoreDuplicates: true })
    const { data, error } = await query.select('call_sid')
    if (error) throw error
    if (!data.length) skipped++
    else if (before) updated++
    else inserted++
  }
  return {
    inserted,
    updated,
    skipped,
    active: plan.active,
    unavailable: plan.unavailable.length,
  }
}
