import type { SupabaseClient } from '@supabase/supabase-js'
import { buildInitialCandidateReport } from './reports'
import { buildRangerScreeningDraft, parseApplicantIntake } from './intake'
import {
  buildApplicantReplyTelegramMessage,
  buildNewApplicantTelegramMessage,
  candidateReportButtons,
  sendRangerTelegramMessage,
} from './telegram'
import type { RangerGmailMessage } from './gmail'
import type { RangerApplicantIntake } from './intake'
import type { RangerApplicant, RangerCandidateReport } from './types'

export type CreateRangerApplicantResult = {
  duplicate: boolean
  applicant: Record<string, unknown> | null
  report: Record<string, unknown> | null
}

export type ProcessRangerGmailMessageResult = {
  action: 'created' | 'reply_queued' | 'duplicate'
  applicant: Record<string, unknown> | null
  report: Record<string, unknown> | null
}

export async function createRangerApplicantFromIntake(params: {
  supabase: SupabaseClient
  intake: RangerApplicantIntake
  messageId?: string | null
  actor: string
  auditEventType: string
  auditSummary: string
}): Promise<CreateRangerApplicantResult> {
  const { supabase, intake, messageId, actor, auditEventType, auditSummary } =
    params

  if (messageId) {
    const { data: existingMessage, error: existingMessageError } =
      await supabase
        .from('ranger_messages')
        .select('applicant_id')
        .eq('external_message_id', messageId)
        .maybeSingle()

    if (existingMessageError) throw existingMessageError
    if (existingMessage?.applicant_id) {
      return { duplicate: true, applicant: null, report: null }
    }
  }

  const parsed = parseApplicantIntake(intake)
  const { data: applicant, error: applicantError } = await supabase
    .from('ranger_applicants')
    .insert({
      ...parsed,
      source: parsed.source || 'craigslist',
      source_thread_id:
        parsed.source_thread_id || intake.sourceThreadId || null,
      last_contact_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (applicantError) throw applicantError

  await supabase.from('ranger_messages').insert({
    applicant_id: applicant.id,
    channel: 'gmail',
    direction: 'inbound',
    subject: intake.subject || null,
    body: intake.body || '',
    external_message_id: messageId || null,
    status: 'logged',
    metadata: {
      fromEmail: intake.fromEmail || null,
      fromName: intake.fromName || null,
      threadId: intake.sourceThreadId || null,
    },
  })

  if ((applicant.missing_fields || []).length > 0) {
    await supabase.from('ranger_messages').insert({
      applicant_id: applicant.id,
      channel: 'gmail',
      direction: 'outbound',
      subject: 'Quick questions about your application',
      body: buildRangerScreeningDraft(),
      status: 'draft',
      requires_approval: false,
      metadata: { generated_by: 'ranger_foundation' },
    })
  }

  const reportPayload = buildInitialCandidateReport(applicant)
  const { data: report, error: reportError } = await supabase
    .from('ranger_candidate_reports')
    .insert(reportPayload)
    .select('*')
    .single()

  if (reportError) throw reportError

  await supabase.from('ranger_tasks').insert({
    applicant_id: applicant.id,
    task_type: 'standard_research',
    status: 'pending',
    priority: 'normal',
    payload: {
      research_depth: 'standard',
      source: 'gmail_intake',
    },
  })

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor,
    event_type: auditEventType,
    event_summary: auditSummary,
    payload: {
      threadId: intake.sourceThreadId || null,
      messageId: messageId || null,
      recommendation: report.overall_recommendation,
    },
  })

  void sendRangerTelegramMessage({
    text: buildNewApplicantTelegramMessage({
      applicant: applicant as RangerApplicant,
      report: report as RangerCandidateReport,
      sourceSubject: intake.subject || null,
    }),
    buttons: candidateReportButtons(applicant.id),
  }).then(async (sent) => {
    await supabase.from('ranger_audit_events').insert({
      applicant_id: applicant.id,
      actor: 'ranger',
      event_type: sent
        ? 'telegram_new_applicant_sent'
        : 'telegram_new_applicant_skipped',
      event_summary: sent
        ? 'Ranger sent new applicant alert to Telegram.'
        : 'Ranger did not send new applicant alert to Telegram.',
      payload: { sent },
    })
  })

  return { duplicate: false, applicant, report }
}

export async function processRangerGmailMessage(params: {
  supabase: SupabaseClient
  message: RangerGmailMessage
}): Promise<ProcessRangerGmailMessageResult> {
  const { supabase, message } = params
  const { data: existingMessage, error: existingMessageError } = await supabase
    .from('ranger_messages')
    .select('applicant_id')
    .eq('external_message_id', message.messageId)
    .maybeSingle()

  if (existingMessageError) throw existingMessageError
  if (existingMessage?.applicant_id) {
    return { action: 'duplicate', applicant: null, report: null }
  }

  const { data: existingApplicant, error: applicantError } = await supabase
    .from('ranger_applicants')
    .select('*')
    .eq('source_thread_id', message.threadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (applicantError) throw applicantError

  if (existingApplicant) {
    await supabase.from('ranger_messages').insert({
      applicant_id: existingApplicant.id,
      channel: 'gmail',
      direction: 'inbound',
      subject: message.subject || null,
      body: message.body,
      external_message_id: message.messageId,
      status: 'logged',
      metadata: {
        fromEmail: message.fromEmail,
        fromName: message.fromName,
        threadId: message.threadId,
        receivedAt: message.internalDate,
      },
    })

    await supabase.from('ranger_tasks').insert({
      applicant_id: existingApplicant.id,
      task_type: 'parse_gmail_reply',
      status: 'pending',
      priority: 'high',
      payload: {
        messageId: message.messageId,
        threadId: message.threadId,
        subject: message.subject,
        body: message.body,
      },
    })

    await supabase.from('ranger_audit_events').insert({
      applicant_id: existingApplicant.id,
      actor: 'ranger-gmail-cron',
      event_type: 'gmail_reply_queued',
      event_summary: 'Ranger queued an applicant Gmail reply for parsing.',
      payload: {
        messageId: message.messageId,
        threadId: message.threadId,
      },
    })

    void sendRangerTelegramMessage({
      text: buildApplicantReplyTelegramMessage({
        applicant: existingApplicant as RangerApplicant,
        subject: message.subject,
        body: message.body,
      }),
      buttons: candidateReportButtons(existingApplicant.id),
    })

    return {
      action: 'reply_queued',
      applicant: existingApplicant,
      report: null,
    }
  }

  const result = await createRangerApplicantFromIntake({
    supabase,
    messageId: message.messageId,
    actor: 'ranger-gmail-cron',
    auditEventType: 'gmail_cron_intake_created',
    auditSummary: 'Ranger applicant created from direct Gmail polling.',
    intake: {
      source: 'craigslist',
      sourceThreadId: message.threadId,
      subject: message.subject || undefined,
      body: message.body,
      fromEmail: message.fromEmail || undefined,
      fromName: message.fromName || undefined,
    },
  })

  return {
    action: result.duplicate ? 'duplicate' : 'created',
    applicant: result.applicant,
    report: result.report,
  }
}
