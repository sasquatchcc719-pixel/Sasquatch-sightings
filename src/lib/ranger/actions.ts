import type { SupabaseClient } from '@supabase/supabase-js'
import { sendRangerGmailMessage } from './gmail'
import { buildRangerScreeningDraft } from './intake'
import { parseRangerNameAndValue } from './skills'
import { sendRangerApplicantSms } from './sms'
import type { RangerApplicant } from './types'

type RangerTelegramAction =
  | 'followup'
  | 'send'
  | 'sms'
  | 'deep'
  | 'records'
  | 'late'
  | 'pass'
  | 'hire'
  | 'remind'

export type RangerBulkAction =
  | 'records_all'
  | 'research_all'
  | 'text_missing'
  | 'stale_cleanup'
  | 'top_candidates'

const RANGER_STATUSES = new Set([
  'new_applicant',
  'needs_screening',
  'screening_sent',
  'awaiting_reply',
  'research_running',
  'candidate_report_ready',
  'owner_review',
  'follow_up_drafting',
  'late_stage_contact',
  'phone_call_ready',
  'interview_scheduled',
  'no_show',
  'passed',
  'hired',
  'ghosted',
  'outcome_tracking',
])

function applicantLabel(
  applicant: Pick<RangerApplicant, 'full_name' | 'phone' | 'email'>,
) {
  return (
    applicant.full_name ||
    applicant.phone ||
    applicant.email ||
    'Unknown applicant'
  )
}

function followUpDueAt() {
  const due = new Date()
  due.setDate(due.getDate() + 2)
  return due.toISOString()
}

async function loadApplicant(supabase: SupabaseClient, applicantId: string) {
  const { data: applicant, error } = await supabase
    .from('ranger_applicants')
    .select('*')
    .eq('id', applicantId)
    .maybeSingle()

  if (error) throw error
  return applicant as RangerApplicant | null
}

async function findApplicantByQuery(supabase: SupabaseClient, query: string) {
  const trimmed = query.trim()
  if (!trimmed) return null

  const { data: applicants, error } = await supabase
    .from('ranger_applicants')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  const needle = trimmed.toLowerCase()
  return (
    ((applicants || []) as RangerApplicant[]).find((applicant) => {
      return [applicant.full_name, applicant.email, applicant.phone]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle))
    }) || null
  )
}

async function loadActiveApplicants(supabase: SupabaseClient, limit = 25) {
  const { data, error } = await supabase
    .from('ranger_applicants')
    .select('*')
    .not('status', 'in', '(passed,hired,ghosted)')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data || []) as RangerApplicant[]
}

async function sendScreeningFollowUp(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
}) {
  const { supabase, applicant, actor } = params
  if (!applicant.email) {
    return `I can’t send ${applicantLabel(applicant)} the screening questions yet because I don’t have an email address.`
  }

  const { data: draft, error: draftError } = await supabase
    .from('ranger_messages')
    .select('*')
    .eq('applicant_id', applicant.id)
    .eq('channel', 'gmail')
    .eq('direction', 'outbound')
    .in('status', ['draft', 'pending_approval', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (draftError) throw draftError

  const subject = draft?.subject || 'Quick questions about your application'
  const body = draft?.body || buildRangerScreeningDraft()

  const messageId = await sendRangerGmailMessage({
    to: applicant.email,
    subject,
    body,
    threadId: applicant.source_thread_id,
  })
  const sentAt = new Date().toISOString()
  const dueAt = followUpDueAt()

  if (draft?.id) {
    const { error: updateDraftError } = await supabase
      .from('ranger_messages')
      .update({
        status: 'sent',
        approved_by: actor,
        approved_at: sentAt,
        sent_at: sentAt,
        external_message_id: messageId,
      })
      .eq('id', draft.id)

    if (updateDraftError) throw updateDraftError
  } else {
    const { error: insertMessageError } = await supabase
      .from('ranger_messages')
      .insert({
        applicant_id: applicant.id,
        channel: 'gmail',
        direction: 'outbound',
        subject,
        body,
        status: 'sent',
        requires_approval: false,
        approved_by: actor,
        approved_at: sentAt,
        sent_at: sentAt,
        external_message_id: messageId,
        metadata: { generated_by: 'ranger_telegram_action' },
      })

    if (insertMessageError) throw insertMessageError
  }

  const { error: applicantError } = await supabase
    .from('ranger_applicants')
    .update({
      status: 'awaiting_reply',
      next_action:
        'Waiting for applicant to answer Ranger screening questions.',
      follow_up_due_at: dueAt,
      last_contact_at: sentAt,
    })
    .eq('id', applicant.id)

  if (applicantError) throw applicantError

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor,
    event_type: 'screening_followup_sent',
    event_summary: 'Ranger sent approved screening questions by Gmail.',
    payload: { gmailMessageId: messageId, followUpDueAt: dueAt },
  })

  return `Done. I sent ${applicantLabel(applicant)} the screening questions by Gmail. I’ll watch for the reply.`
}

async function queueDeepResearch(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
}) {
  const { supabase, applicant, actor } = params
  const now = new Date().toISOString()

  const { error: taskError } = await supabase.from('ranger_tasks').insert({
    applicant_id: applicant.id,
    task_type: 'deep_research',
    status: 'pending',
    priority: 'high',
    payload: {
      research_depth: 'deep',
      requested_by: actor,
      requested_at: now,
    },
  })

  if (taskError) throw taskError

  const { error: applicantError } = await supabase
    .from('ranger_applicants')
    .update({
      status: 'research_running',
      next_action: 'Run deep public research and update the candidate dossier.',
    })
    .eq('id', applicant.id)

  if (applicantError) throw applicantError

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor,
    event_type: 'deep_research_queued',
    event_summary: 'Owner requested deeper Ranger research from Telegram.',
    payload: { requestedAt: now },
  })

  return `Queued. I marked ${applicantLabel(applicant)} for deep research. The research worker will pick it up automatically.`
}

async function queuePublicRecordsCheck(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
}) {
  const { supabase, applicant, actor } = params
  const now = new Date().toISOString()

  const { error: taskError } = await supabase.from('ranger_tasks').insert({
    applicant_id: applicant.id,
    task_type: 'public_records_check',
    status: 'pending',
    priority: 'high',
    payload: {
      requested_by: actor,
      requested_at: now,
      scope: 'public_records_keyword_search',
    },
  })

  if (taskError) throw taskError

  const { error: applicantError } = await supabase
    .from('ranger_applicants')
    .update({
      status: 'research_running',
      next_action:
        'Run public-records check and flag any sourced owner-review leads.',
    })
    .eq('id', applicant.id)

  if (applicantError) throw applicantError

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor,
    event_type: 'public_records_queued',
    event_summary: 'Owner requested Ranger public-records check.',
    payload: { requestedAt: now },
  })

  return `Queued. I’ll run a public-records check for ${applicantLabel(applicant)} and flag any sourced possible matches for owner review.`
}

async function markLateStage(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
}) {
  const { supabase, applicant, actor } = params

  const { error: applicantError } = await supabase
    .from('ranger_applicants')
    .update({
      status: 'phone_call_ready',
      next_action:
        'Owner approved moving this applicant toward a phone screen.',
    })
    .eq('id', applicant.id)

  if (applicantError) throw applicantError

  await supabase.from('ranger_tasks').insert({
    applicant_id: applicant.id,
    task_type: 'phone_screen',
    status: 'waiting_for_owner',
    priority: 'high',
    payload: {
      phone: applicant.phone,
      email: applicant.email,
      requested_by: actor,
    },
  })

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor,
    event_type: 'phone_screen_ready',
    event_summary: 'Owner moved applicant to late-stage phone contact.',
    payload: { phone: applicant.phone, email: applicant.email },
  })

  return `${applicantLabel(applicant)} is marked phone-screen ready. Phone: ${applicant.phone || 'unknown'}. Email: ${applicant.email || 'unknown'}.`
}

async function passApplicant(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
}) {
  const { supabase, applicant, actor } = params
  const now = new Date().toISOString()

  const { error: applicantError } = await supabase
    .from('ranger_applicants')
    .update({
      status: 'passed',
      final_decision: 'owner_passed',
      passed_at: now,
      next_action: 'Applicant passed by owner.',
    })
    .eq('id', applicant.id)

  if (applicantError) throw applicantError

  await supabase.from('ranger_outcomes').insert({
    applicant_id: applicant.id,
    outcome_type: 'pipeline',
    outcome_label: 'passed',
    recorded_by: actor,
    metadata: { source: 'telegram_action' },
  })

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor,
    event_type: 'applicant_passed',
    event_summary: 'Owner passed on applicant from Telegram.',
    payload: { passedAt: now },
  })

  return `Got it. I marked ${applicantLabel(applicant)} as passed.`
}

async function hireApplicant(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
}) {
  const { supabase, applicant, actor } = params
  const now = new Date().toISOString()

  const { error: applicantError } = await supabase
    .from('ranger_applicants')
    .update({
      status: 'hired',
      final_decision: 'hired',
      hired_at: now,
      next_action: 'Track 30/60/90-day hiring outcome.',
    })
    .eq('id', applicant.id)

  if (applicantError) throw applicantError

  await supabase.from('ranger_outcomes').insert({
    applicant_id: applicant.id,
    outcome_type: 'employment',
    outcome_label: 'hired',
    recorded_by: actor,
    metadata: { source: 'ranger_action' },
  })

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor,
    event_type: 'applicant_hired',
    event_summary: 'Owner marked applicant hired.',
    payload: { hiredAt: now },
  })

  return `Marked ${applicantLabel(applicant)} as hired. I’ll keep this record open for outcome tracking.`
}

async function setReminder(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
}) {
  const dueAt = followUpDueAt()
  const { error: taskError } = await params.supabase
    .from('ranger_tasks')
    .insert({
      applicant_id: params.applicant.id,
      task_type: 'followup_reminder',
      status: 'pending',
      priority: 'normal',
      due_at: dueAt,
      payload: { requested_by: params.actor },
    })

  if (taskError) throw taskError

  const { error: applicantError } = await params.supabase
    .from('ranger_applicants')
    .update({
      follow_up_due_at: dueAt,
      next_action: 'Follow-up reminder scheduled.',
    })
    .eq('id', params.applicant.id)

  if (applicantError) throw applicantError

  return `Reminder set for ${applicantLabel(params.applicant)}. I’ll nudge you in about 2 days.`
}

async function addOwnerNote(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
  note: string
}) {
  const current = params.applicant.owner_notes?.trim()
  const stamped = `[${new Date().toLocaleString()}] ${params.actor}: ${params.note}`
  const owner_notes = current ? `${current}\n${stamped}` : stamped

  const { error } = await params.supabase
    .from('ranger_applicants')
    .update({ owner_notes })
    .eq('id', params.applicant.id)

  if (error) throw error

  await params.supabase.from('ranger_audit_events').insert({
    applicant_id: params.applicant.id,
    actor: params.actor,
    event_type: 'owner_note_added',
    event_summary: 'Owner note added to Ranger applicant.',
    payload: { note: params.note },
  })

  return `Added note to ${applicantLabel(params.applicant)}.`
}

async function recordOutcome(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
  outcome: string
}) {
  const { error } = await params.supabase.from('ranger_outcomes').insert({
    applicant_id: params.applicant.id,
    outcome_type: ['good_hire', 'bad_hire', 'hired'].includes(params.outcome)
      ? 'employment'
      : 'pipeline',
    outcome_label: params.outcome,
    recorded_by: params.actor,
    metadata: { source: 'ranger_text_action' },
  })

  if (error) throw error

  await params.supabase.from('ranger_audit_events').insert({
    applicant_id: params.applicant.id,
    actor: params.actor,
    event_type: 'outcome_recorded',
    event_summary: `Outcome recorded: ${params.outcome}`,
    payload: { outcome: params.outcome },
  })

  return `Recorded outcome for ${applicantLabel(params.applicant)}: ${params.outcome}.`
}

async function setApplicantStatus(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
  status: string
}) {
  if (!RANGER_STATUSES.has(params.status)) {
    return `I don’t recognize status "${params.status}". Use one of: ${Array.from(RANGER_STATUSES).join(', ')}`
  }

  const { error } = await params.supabase
    .from('ranger_applicants')
    .update({
      status: params.status,
      next_action: `Status manually set to ${params.status}.`,
    })
    .eq('id', params.applicant.id)

  if (error) throw error

  await params.supabase.from('ranger_audit_events').insert({
    applicant_id: params.applicant.id,
    actor: params.actor,
    event_type: 'status_updated',
    event_summary: `Owner updated Ranger status to ${params.status}.`,
    payload: { status: params.status },
  })

  return `Updated ${applicantLabel(params.applicant)} to ${params.status}.`
}

async function schedulePhoneScreen(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  actor: string
  window: string
}) {
  const { error: applicantError } = await params.supabase
    .from('ranger_applicants')
    .update({
      status: 'interview_scheduled',
      next_action: `Phone screen scheduled: ${params.window}`,
    })
    .eq('id', params.applicant.id)

  if (applicantError) throw applicantError

  const { error: taskError } = await params.supabase
    .from('ranger_tasks')
    .insert({
      applicant_id: params.applicant.id,
      task_type: 'phone_screen_reminder',
      status: 'waiting_for_owner',
      priority: 'high',
      payload: {
        scheduled_window: params.window,
        requested_by: params.actor,
        phone: params.applicant.phone,
        email: params.applicant.email,
      },
    })

  if (taskError) throw taskError

  await params.supabase.from('ranger_audit_events').insert({
    applicant_id: params.applicant.id,
    actor: params.actor,
    event_type: 'phone_screen_scheduled',
    event_summary: `Phone screen scheduled: ${params.window}`,
    payload: { scheduledWindow: params.window },
  })

  return `Scheduled phone screen for ${applicantLabel(params.applicant)}: ${params.window}.`
}

export async function runRangerTelegramAction(params: {
  supabase: SupabaseClient
  action: string | undefined
  applicantId: string | undefined
  actor: string
}): Promise<string> {
  const action = params.action as RangerTelegramAction | undefined
  if (!action || !params.applicantId) {
    return 'I could not read that Ranger action. Try the button again.'
  }

  const applicant = await loadApplicant(params.supabase, params.applicantId)
  if (!applicant) {
    return 'I could not find that applicant anymore.'
  }

  if (action === 'followup' || action === 'send') {
    return sendScreeningFollowUp({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  if (action === 'sms') {
    return sendRangerApplicantSms({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  if (action === 'deep') {
    return queueDeepResearch({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  if (action === 'records') {
    return queuePublicRecordsCheck({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  if (action === 'late') {
    return markLateStage({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  if (action === 'pass') {
    return passApplicant({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  if (action === 'hire') {
    return hireApplicant({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  if (action === 'remind') {
    return setReminder({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  return `I don’t know how to run the "${action}" action yet.`
}

export async function runRangerBulkAction(params: {
  supabase: SupabaseClient
  action: string | undefined
  actor: string
}) {
  const action = params.action as RangerBulkAction | undefined
  if (!action) return 'I could not read that Ranger bulk action.'

  const applicants = await loadActiveApplicants(params.supabase, 40)
  const now = new Date().toISOString()

  if (action === 'records_all' || action === 'research_all') {
    const taskType =
      action === 'records_all' ? 'public_records_check' : 'deep_research'
    const candidates = applicants.filter(
      (applicant) =>
        !['research_running', 'passed', 'hired'].includes(applicant.status),
    )
    if (candidates.length === 0) {
      return `No active applicants need ${action === 'records_all' ? 'public records' : 'deep research'} queued right now.`
    }

    const { error } = await params.supabase.from('ranger_tasks').insert(
      candidates.map((applicant) => ({
        applicant_id: applicant.id,
        task_type: taskType,
        status: 'pending',
        priority: 'high',
        payload: {
          requested_by: params.actor,
          requested_at: now,
          bulk_action: action,
        },
      })),
    )
    if (error) throw error

    await params.supabase.from('ranger_audit_events').insert({
      actor: params.actor,
      event_type: `${action}_queued`,
      event_summary: `Ranger queued ${taskType} for ${candidates.length} active applicants.`,
      payload: {
        applicantIds: candidates.map((applicant) => applicant.id),
        taskType,
      },
    })

    return `Queued ${taskType.replaceAll('_', ' ')} for ${candidates.length} active applicants.`
  }

  if (action === 'text_missing') {
    const candidates = applicants.filter((applicant) => {
      return applicant.phone && (applicant.missing_fields || []).length > 0
    })
    if (candidates.length === 0) {
      return 'No active applicants with phone numbers are missing screening info right now.'
    }

    const results: string[] = []
    for (const applicant of candidates.slice(0, 8)) {
      results.push(
        await sendRangerApplicantSms({
          supabase: params.supabase,
          applicant,
          actor: params.actor,
        }),
      )
    }

    return `Texted screening questions to ${results.length} applicants missing info.`
  }

  if (action === 'stale_cleanup') {
    const staleCutoff = Date.now() - 5 * 24 * 60 * 60 * 1000
    const staleApplicants = applicants.filter((applicant) => {
      const lastContact = applicant.last_contact_at || applicant.created_at
      return (
        ['awaiting_reply', 'screening_sent', 'needs_screening'].includes(
          applicant.status,
        ) && Date.parse(lastContact) < staleCutoff
      )
    })

    if (staleApplicants.length === 0) {
      return 'No stale Ranger applicants need cleanup right now.'
    }

    const { error } = await params.supabase
      .from('ranger_applicants')
      .update({
        status: 'ghosted',
        final_decision: 'ghosted',
        next_action: 'Marked ghosted by Ranger stale cleanup.',
      })
      .in(
        'id',
        staleApplicants.map((applicant) => applicant.id),
      )
    if (error) throw error

    await params.supabase.from('ranger_audit_events').insert({
      actor: params.actor,
      event_type: 'stale_cleanup_completed',
      event_summary: `Ranger marked ${staleApplicants.length} stale applicants as ghosted.`,
      payload: {
        applicantIds: staleApplicants.map((applicant) => applicant.id),
      },
    })

    return `Marked ${staleApplicants.length} stale applicants as ghosted.`
  }

  if (action === 'top_candidates') {
    if (applicants.length === 0) {
      return 'No active Ranger applicants to rank right now.'
    }

    const { data: reports, error } = await params.supabase
      .from('ranger_candidate_reports')
      .select('*')
      .in(
        'applicant_id',
        applicants.map((applicant) => applicant.id),
      )
      .order('generated_at', { ascending: false })
      .limit(100)
    if (error) throw error

    const fitRank: Record<string, number> = {
      high: 4,
      medium_high: 3,
      medium: 2,
      unknown: 1,
      low: 0,
    }
    const ranked = applicants
      .map((applicant) => {
        const report = (reports || []).find(
          (item) => item.applicant_id === applicant.id,
        )
        return {
          applicant,
          report,
          rank: fitRank[report?.overall_fit || 'unknown'] ?? 0,
        }
      })
      .sort((first, second) => second.rank - first.rank)
      .slice(0, 5)

    return `Top Ranger candidates right now:

${ranked
  .map(
    ({ applicant, report }, index) =>
      `${index + 1}. ${applicantLabel(applicant)} - ${report?.overall_fit || 'unknown'} fit; ${report?.suggested_next_step || applicant.next_action || applicant.status}`,
  )
  .join('\n')}`
  }

  return `I don’t know how to run bulk action "${action}".`
}

export async function runRangerTextAction(params: {
  supabase: SupabaseClient
  text: string
  actor: string
}): Promise<string | null> {
  const [command, ...rest] = params.text.trim().split(/\s+/)
  const query = rest.join(' ')
  const normalized = command?.toLowerCase()

  const actionByCommand: Record<string, RangerTelegramAction> = {
    '/research': 'deep',
    '/send': 'send',
    '/sms': 'sms',
    '/text': 'sms',
    '/records': 'records',
    '/publicrecords': 'records',
    '/remind': 'remind',
    '/phone': 'late',
    '/pass': 'pass',
    '/hire': 'hire',
  }
  const bulkActionByCommand: Record<string, RangerBulkAction> = {
    '/recordsall': 'records_all',
    '/records_all': 'records_all',
    '/researchall': 'research_all',
    '/research_all': 'research_all',
    '/textmissing': 'text_missing',
    '/text_missing': 'text_missing',
    '/stalecleanup': 'stale_cleanup',
    '/stale_cleanup': 'stale_cleanup',
    '/top': 'top_candidates',
  }
  const bulkAction = bulkActionByCommand[normalized]
  if (bulkAction) {
    return runRangerBulkAction({
      supabase: params.supabase,
      action: bulkAction,
      actor: params.actor,
    })
  }
  if (normalized === '/note') {
    const parsed = parseRangerNameAndValue(params.text)
    if (!parsed) return 'Use: /note Applicant Name | note text'
    const applicant = await findApplicantByQuery(params.supabase, parsed.query)
    if (!applicant)
      return `I couldn’t find an applicant matching "${parsed.query}".`
    return addOwnerNote({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
      note: parsed.value,
    })
  }

  if (normalized === '/outcome') {
    const parsed = parseRangerNameAndValue(params.text)
    if (!parsed) return 'Use: /outcome Applicant Name | good_hire'
    const applicant = await findApplicantByQuery(params.supabase, parsed.query)
    if (!applicant)
      return `I couldn’t find an applicant matching "${parsed.query}".`
    return recordOutcome({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
      outcome: parsed.value,
    })
  }

  if (normalized === '/setstatus') {
    const parsed = parseRangerNameAndValue(params.text)
    if (!parsed) return 'Use: /setstatus Applicant Name | phone_call_ready'
    const applicant = await findApplicantByQuery(params.supabase, parsed.query)
    if (!applicant)
      return `I couldn’t find an applicant matching "${parsed.query}".`
    return setApplicantStatus({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
      status: parsed.value,
    })
  }

  if (normalized === '/schedule') {
    const parsed = parseRangerNameAndValue(params.text)
    if (!parsed) return 'Use: /schedule Applicant Name | tomorrow 10am'
    const applicant = await findApplicantByQuery(params.supabase, parsed.query)
    if (!applicant)
      return `I couldn’t find an applicant matching "${parsed.query}".`
    return schedulePhoneScreen({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
      window: parsed.value,
    })
  }

  if (normalized === '/sms' || normalized === '/text') {
    const parsed = parseRangerNameAndValue(params.text)
    if (parsed) {
      const applicant = await findApplicantByQuery(
        params.supabase,
        parsed.query,
      )
      if (!applicant)
        return `I couldn’t find an applicant matching "${parsed.query}".`
      return sendRangerApplicantSms({
        supabase: params.supabase,
        applicant,
        actor: params.actor,
        message: parsed.value,
      })
    }
  }

  const action = actionByCommand[normalized]
  if (!action) return null

  if (!query) {
    return `Tell me who. Example: ${normalized} John Smith`
  }

  const applicant = await findApplicantByQuery(params.supabase, query)
  if (!applicant) {
    return `I couldn’t find an applicant matching "${query}".`
  }

  if (normalized === '/remind') {
    return setReminder({
      supabase: params.supabase,
      applicant,
      actor: params.actor,
    })
  }

  return runRangerTelegramAction({
    supabase: params.supabase,
    action,
    applicantId: applicant.id,
    actor: params.actor,
  })
}
