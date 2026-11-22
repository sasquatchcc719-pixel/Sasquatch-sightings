import { createAdminClient } from '@/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export type VoiceTurn = {
  sequence?: number
  role: 'assistant' | 'user'
  content: string
}
export type VoiceSession = {
  callSid: string
  callerPhone: string
  providerCallId: string | null
  pilot: boolean
  startedAt: string
  answeredAt: string | null
  endedAt: string | null
  status: 'active' | 'ended'
  turns: VoiceTurn[]
  summary: string | null
}
const recordTable = 'phone_assistant_sessions'

export async function getVoiceSessionDetails(
  callSid: string,
  db = createAdminClient(),
): Promise<Omit<VoiceSession, 'turns'> | null> {
  const { data, error } = await db
    .from(recordTable)
    .select(
      'call_sid, caller_phone, provider_call_id, pilot, started_at, answered_at, ended_at, summary',
    )
    .eq('call_sid', callSid)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    callSid: data.call_sid,
    callerPhone: data.caller_phone,
    providerCallId: data.provider_call_id,
    pilot: data.pilot,
    startedAt: data.started_at,
    answeredAt: data.answered_at,
    endedAt: data.ended_at,
    status: data.ended_at ? 'ended' : 'active',
    summary: data.summary,
  }
}

export async function getVoiceSession(
  callSid: string,
  db = createAdminClient(),
): Promise<VoiceSession | null> {
  const session = await getVoiceSessionDetails(callSid, db)
  if (!session) return null
  // PostgREST caps each response. Long calls still need every final turn.
  const turns: VoiceTurn[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const page = await db
      .from('phone_assistant_transcript')
      .select('sequence,role,content')
      .eq('call_sid', callSid)
      .order('sequence')
      .range(offset, offset + pageSize - 1)
    if (page.error) throw page.error
    turns.push(...(page.data as VoiceTurn[]))
    if (page.data.length < pageSize) break
  }
  return { ...session, turns }
}

export async function beginVoiceSession(input: {
  callSid: string
  callerPhone: string
  pilot: boolean
}): Promise<void> {
  const db = createAdminClient()
  const { error } = await db.rpc('begin_phone_assistant_session', {
    p_sid: input.callSid,
    p_phone: input.callerPhone,
    p_pilot: input.pilot,
  })
  if (error) throw error
}

export async function appendVoiceTranscript(input: {
  callSid: string
  sequence: number
  role: VoiceTurn['role']
  content: string
}): Promise<void> {
  const { error } = await createAdminClient().rpc(
    'append_phone_assistant_transcript',
    {
      p_sid: input.callSid,
      p_seq: input.sequence,
      p_role: input.role,
      p_content: input.content,
    },
  )
  if (error) throw error
}

export async function finalizeVoiceSession(
  callSid: string,
  db: SupabaseClient = createAdminClient(),
): Promise<boolean> {
  const { data, error } = await db.rpc('finalize_phone_assistant_session', {
    p_sid: callSid,
  })
  if (error) throw error
  return data === true
}

export function formatVoiceTranscript(
  session: Pick<VoiceSession, 'turns' | 'pilot'>,
): string {
  const body = session.turns
    .map(
      (turn) =>
        (turn.role === 'user' ? 'Caller: ' : 'Phone assistant: ') +
        turn.content,
    )
    .join('\n')
  return (
    (session.pilot ? 'Private preview\n' : '') +
    (body || 'No transcribed speech was received.')
  )
}

export async function bindVoiceProviderCall(
  callSid: string,
  providerId: string,
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc(
    'bind_phone_assistant_provider',
    { p_sid: callSid, p_provider_id: providerId },
  )
  if (error) throw error
  return data === true
}

export async function markVoiceAnswered(
  callSid: string,
  providerId: string,
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc(
    'mark_phone_assistant_answered',
    { p_sid: callSid, p_provider_id: providerId },
  )
  if (error) throw error
  return data === true
}

export async function latestCallerTurn(
  callSid: string,
  db = createAdminClient(),
) {
  const { data, error } = await db
    .from('phone_assistant_transcript')
    .select('sequence')
    .eq('call_sid', callSid)
    .eq('role', 'user')
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.sequence ?? null) as number | null
}

// Both emergency keypad routing and hanging up end the assistant leg. Only
// release a claim before dispatch; a provider timeout has an ambiguous outcome.
export async function claimVoiceExit(
  callSid: string,
  db = createAdminClient(),
) {
  const key = 'leave_assistant'
  const inserted = await db
    .from('phone_assistant_actions')
    .insert({ call_sid: callSid, action_key: key })
  if (!inserted.error) return true
  if (inserted.error.code !== '23505') throw inserted.error
  const result = await db
    .from('phone_assistant_actions')
    .update({ status: 'pending', completed_at: null })
    .eq('call_sid', callSid)
    .eq('action_key', key)
    .eq('status', 'failed')
    .select('call_sid')
    .maybeSingle()
  if (result.error) throw result.error
  return Boolean(result.data)
}
export async function finishVoiceExit(
  callSid: string,
  dispatched: boolean,
  db = createAdminClient(),
) {
  const { error } = await db
    .from('phone_assistant_actions')
    .update({
      status: dispatched ? 'succeeded' : 'failed',
      completed_at: new Date().toISOString(),
    })
    .eq('call_sid', callSid)
    .eq('action_key', 'leave_assistant')
    .eq('status', 'pending')
  if (error) throw error
}
