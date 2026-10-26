import type { SupabaseClient } from '@supabase/supabase-js'
import type { Twilio } from 'twilio'

export type VoicemailMessage = {
  role?: string
  content?: string
  timestamp?: string
  twilio_sid?: string
  metadata?: {
    type?: string
    transcription?: string | null
    recording_url?: string | null
    recording_sid?: string | null
    duration?: string | null
    voicemail_harry_reply_for?: string | null
    recording_completed?: boolean
    email_sent?: boolean
    transcription_email_text?: string | null
    transcription_email_id?: string | null
  } | null
}

export function normalizeVoicemailPhone(phone: string | null | undefined) {
  const value = phone?.trim() ?? ''
  if (!/^[+\d().\s-]+$/.test(value)) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (value.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits))
    return `+${digits}`
  return null
}

// Recording/transcription callbacks can omit From. Resolve the original inbound
// caller from its parent CallSid before creating or touching a conversation.
export async function resolveVoicemailCaller(
  db: SupabaseClient,
  client: Twilio,
  callSid: string,
  from: string | null,
) {
  const supplied = normalizeVoicemailPhone(from)
  if (supplied) return supplied
  const { data, error } = await db
    .from('call_logs')
    .select('caller_phone')
    .eq('call_sid', callSid)
    .maybeSingle()
  if (error) throw error
  const stored = normalizeVoicemailPhone(data?.caller_phone)
  if (stored) return stored
  const parent = await client.calls(callSid).fetch()
  return parent.direction === 'inbound'
    ? normalizeVoicemailPhone(parent.from)
    : null
}

export type VoicemailCallback = {
  phone: string
  callSid: string
  recordingSid: string
  audioUrl: string | null
  duration: string | null
  transcription: string | null
  completed: boolean
}

export async function mergeVoicemailCallback(
  db: SupabaseClient,
  callback: VoicemailCallback,
  emailSent = false,
  transcriptionEmailId: string | null = null,
) {
  // SQL serializes callbacks for this phone and merges by RecordingSid. A
  // read/replace messages update here loses data when callbacks overlap.
  const { data, error } = await db.rpc('merge_voicemail_callback', {
    p_phone_number: callback.phone,
    p_call_sid: callback.callSid,
    p_recording_sid: callback.recordingSid,
    p_recording_url: callback.audioUrl,
    p_duration: callback.duration,
    p_transcription: callback.transcription,
    p_recording_completed: callback.completed,
    p_email_sent: emailSent,
    p_transcription_email_id: transcriptionEmailId,
  })
  if (error) throw error
  const result = data as {
    conversation_id: string
    messages: VoicemailMessage[]
  } | null
  const voicemail = result?.messages?.find(
    (message) =>
      message.role === 'user' &&
      message.metadata?.type === 'voicemail' &&
      message.metadata.recording_sid === callback.recordingSid,
  )
  if (!result?.conversation_id || !voicemail)
    throw new Error('Voicemail callback was not persisted')
  return { ...result, voicemail }
}
