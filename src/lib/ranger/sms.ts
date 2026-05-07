import type { SupabaseClient } from '@supabase/supabase-js'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import { buildRangerSmsScreeningDraft } from './skills'
import type { RangerApplicant } from './types'

type ConversationMessage = {
  role: string
  content: string
  timestamp: string
  twilio_sid?: string
  metadata?: Record<string, unknown>
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

function applicantLabel(applicant: RangerApplicant) {
  return (
    applicant.full_name ||
    applicant.email ||
    applicant.phone ||
    'Unknown applicant'
  )
}

function followUpDueAt() {
  const due = new Date()
  due.setDate(due.getDate() + 2)
  return due.toISOString()
}

export async function ensureHarryAwareRangerConversation(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  message: string
  twilioSid?: string
}) {
  const { supabase, applicant, message, twilioSid } = params
  if (!applicant.phone) throw new Error('Applicant has no phone number')

  const phone = normalizePhone(applicant.phone)
  const metadata = {
    ranger_hiring: true,
    ranger_applicant_id: applicant.id,
    ranger_applicant_name: applicantLabel(applicant),
  }
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, messages, metadata')
    .eq('phone_number', phone)
    .eq('source', 'inbound')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const outboundMessage: ConversationMessage = {
    role: 'assistant',
    content: message,
    timestamp: new Date().toISOString(),
    twilio_sid: twilioSid,
    metadata,
  }

  if (existing) {
    const messages = (
      (existing.messages as ConversationMessage[]) || []
    ).concat(outboundMessage)
    const existingMetadata =
      (existing.metadata as Record<string, unknown>) || {}
    const { error } = await supabase
      .from('conversations')
      .update({
        messages,
        metadata: { ...existingMetadata, ...metadata },
        ai_enabled: false,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (error) throw error
    return existing.id as string
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      phone_number: phone,
      source: 'inbound',
      lead_id: null,
      messages: [outboundMessage],
      ai_enabled: false,
      status: 'active',
      metadata,
    })
    .select('id')
    .single()

  if (error) throw error
  return created.id as string
}

export async function sendRangerApplicantSms(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
  message?: string
}) {
  const { supabase, applicant, actor } = params
  if (!applicant.phone) {
    return `I can’t text ${applicantLabel(applicant)} because I don’t have a phone number.`
  }

  const body = params.message || buildRangerSmsScreeningDraft(applicant)
  const sent = await sendCustomerSMSWithResult(
    applicant.phone,
    body,
    undefined,
    'ranger_hiring_sms',
  )
  const sentAt = new Date().toISOString()
  const conversationId = await ensureHarryAwareRangerConversation({
    supabase,
    applicant,
    message: body,
    twilioSid: sent.sid,
  })

  const { error: messageError } = await supabase
    .from('ranger_messages')
    .insert({
      applicant_id: applicant.id,
      channel: 'sms',
      direction: 'outbound',
      subject: null,
      body,
      external_message_id: sent.sid,
      status: 'sent',
      requires_approval: false,
      approved_by: actor,
      approved_at: sentAt,
      sent_at: sentAt,
      metadata: {
        to: sent.to,
        from: sent.from,
        conversationId,
        harryAware: true,
        generated_by: 'ranger_sms_tool',
      },
    })

  if (messageError) throw messageError

  const { error: applicantError } = await supabase
    .from('ranger_applicants')
    .update({
      status: 'awaiting_reply',
      next_action: 'Waiting for applicant SMS reply.',
      follow_up_due_at: followUpDueAt(),
      last_contact_at: sentAt,
    })
    .eq('id', applicant.id)

  if (applicantError) throw applicantError

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor,
    event_type: 'sms_sent',
    event_summary:
      'Ranger sent applicant SMS and linked the thread for Harry awareness.',
    payload: { twilioSid: sent.sid, conversationId, to: sent.to },
  })

  return `Text sent to ${applicantLabel(applicant)} (${sent.to}). Harry is aware this is a Ranger hiring thread.`
}
