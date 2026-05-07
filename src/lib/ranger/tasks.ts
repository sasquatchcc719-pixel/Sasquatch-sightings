import type { SupabaseClient } from '@supabase/supabase-js'
import { buildRangerScreeningDraft, parseApplicantIntake } from './intake'
import { rangerFastModel, rangerWorkerModel } from './models'
import { getHardRequirementMisses, getMissingFields } from './playbook'
import { rebuildCandidateReport } from './reports'
import {
  runRangerPublicRecordsCheck,
  runRangerPublicResearch,
} from './research'
import {
  buildCandidateReportTelegramMessage,
  sendRangerTelegramMessage,
} from './telegram'
import type { RangerApplicant, RangerTask } from './types'

type TaskResult = {
  ok: boolean
  summary: string
  [key: string]: unknown
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

function specialistForTask(taskType: string) {
  if (taskType === 'standard_research' || taskType === 'deep_research') {
    return 'research_scout'
  }
  if (taskType === 'public_records_check') return 'public_records_clerk'
  if (taskType === 'parse_gmail_reply') return 'reply_parser'
  if (taskType === 'draft_followup') return 'screening_liaison'
  if (taskType === 'followup_reminder') return 'owner_briefing_writer'
  return 'ranger_worker'
}

function modelTierForTask(taskType: string) {
  if (taskType === 'parse_gmail_reply' || taskType === 'draft_followup') {
    return rangerFastModel()
  }
  return rangerWorkerModel()
}

function applicantLabel(applicant: RangerApplicant) {
  return (
    applicant.full_name ||
    applicant.email ||
    applicant.phone ||
    'Unknown applicant'
  )
}

function formatEvidenceSnippet(value: string | null | undefined) {
  if (!value) return 'No snippet stored.'
  return value.replace(/\s+/g, ' ').trim().slice(0, 280)
}

async function loadApplicant(
  supabase: SupabaseClient,
  applicantId: string | null,
) {
  if (!applicantId) return null

  const { data, error } = await supabase
    .from('ranger_applicants')
    .select('*')
    .eq('id', applicantId)
    .maybeSingle()

  if (error) throw error
  return data as RangerApplicant | null
}

function mergeParsedReply(applicant: RangerApplicant, body: string) {
  const parsed = parseApplicantIntake({
    body,
    fromEmail: applicant.email || undefined,
    fromName: applicant.full_name || undefined,
    sourceThreadId: applicant.source_thread_id || undefined,
  })
  const merged: Partial<RangerApplicant> = {
    city_area: parsed.city_area || applicant.city_area,
    phone: parsed.phone || applicant.phone,
    has_reliable_transportation:
      parsed.has_reliable_transportation ??
      applicant.has_reliable_transportation,
    has_valid_driver_license:
      parsed.has_valid_driver_license ?? applicant.has_valid_driver_license,
    can_work_nights: parsed.can_work_nights ?? applicant.can_work_nights,
    can_work_saturdays:
      parsed.can_work_saturdays ?? applicant.can_work_saturdays,
    can_do_physical_work:
      parsed.can_do_physical_work ?? applicant.can_do_physical_work,
    relevant_experience:
      parsed.relevant_experience || applicant.relevant_experience,
    availability_notes: body.slice(0, 1200),
  }

  merged.missing_fields = getMissingFields({
    ...applicant,
    ...merged,
  })
  merged.hard_requirement_misses = getHardRequirementMisses({
    ...applicant,
    ...merged,
  })
  merged.status =
    merged.hard_requirement_misses.length > 0
      ? 'owner_review'
      : merged.missing_fields.length > 0
        ? 'needs_screening'
        : 'candidate_report_ready'
  merged.next_action =
    merged.missing_fields.length > 0
      ? 'Applicant replied but screening answers are still incomplete.'
      : 'Review updated candidate report and decide next step.'

  return merged
}

async function handleResearchTask(params: {
  supabase: SupabaseClient
  task: RangerTask
  depth: 'standard' | 'deep'
}): Promise<TaskResult> {
  const { supabase, task, depth } = params
  const applicant = await loadApplicant(supabase, task.applicant_id)
  if (!applicant) {
    return { ok: false, summary: 'Applicant no longer exists.' }
  }

  const research = await runRangerPublicResearch({ supabase, applicant, depth })
  const report = await rebuildCandidateReport({ supabase, applicant })

  await supabase
    .from('ranger_applicants')
    .update({
      status:
        report.overall_recommendation === 'ready_for_phone_call'
          ? 'candidate_report_ready'
          : report.overall_recommendation === 'owner_review'
            ? 'owner_review'
            : applicant.status,
      next_action: report.suggested_next_step,
    })
    .eq('id', applicant.id)

  await sendRangerTelegramMessage({
    text: buildCandidateReportTelegramMessage({ applicant, report }),
  })

  return {
    ok: true,
    summary: `Completed ${depth} research for ${applicantLabel(applicant)}.`,
    ...research,
    reportId: report.id,
    specialist: 'research_scout',
    modelTier: modelTierForTask(task.task_type),
  }
}

async function handlePublicRecordsTask(params: {
  supabase: SupabaseClient
  task: RangerTask
}): Promise<TaskResult> {
  const { supabase, task } = params
  const applicant = await loadApplicant(supabase, task.applicant_id)
  if (!applicant) {
    return { ok: false, summary: 'Applicant no longer exists.' }
  }

  const recordsCheck = await runRangerPublicRecordsCheck({
    supabase,
    applicant,
  })
  const report = await rebuildCandidateReport({ supabase, applicant })
  const { data: recordsEvidence, error: recordsEvidenceError } = await supabase
    .from('ranger_evidence')
    .select('source_label, source_url, raw_snippet, confidence, metadata')
    .eq('applicant_id', applicant.id)
    .eq('evidence_type', 'public_records_search')
    .order('created_at', { ascending: false })
    .limit(3)

  if (recordsEvidenceError) throw recordsEvidenceError
  const evidenceSummary = (recordsEvidence || []).length
    ? (recordsEvidence || [])
        .map((item, index) => {
          const identityConfidence =
            typeof item.metadata === 'object' &&
            item.metadata &&
            'identity_confidence' in item.metadata
              ? String(item.metadata.identity_confidence)
              : item.confidence
          return `${index + 1}. ${item.source_label || 'Unknown source'}
Match confidence: ${identityConfidence}
${formatEvidenceSnippet(item.raw_snippet)}
${item.source_url || 'No URL'}`
        })
        .join('\n\n')
    : 'No public-records leads were found from the configured search queries.'

  await supabase
    .from('ranger_applicants')
    .update({
      status:
        recordsCheck.findingsInserted > 0
          ? 'owner_review'
          : applicant.status === 'research_running'
            ? 'candidate_report_ready'
            : applicant.status,
      next_action:
        recordsCheck.findingsInserted > 0
          ? 'Owner review: possible public-records match requires human verification.'
          : report.suggested_next_step,
    })
    .eq('id', applicant.id)

  await sendRangerTelegramMessage({
    text: `Public records check complete: ${applicantLabel(applicant)}

Possible matches found: ${recordsCheck.findingsInserted}
Top leads:
${evidenceSummary}

${
  recordsCheck.findingsInserted > 0
    ? 'Review the source links before taking any action. Ranger treats this as an unverified lead, not a hiring decision.'
    : 'No public-records leads were found from the configured search queries.'
}`,
  })

  return {
    ok: true,
    summary: `Completed public-records check for ${applicantLabel(applicant)}.`,
    ...recordsCheck,
    reportId: report.id,
    specialist: 'public_records_clerk',
    modelTier: modelTierForTask(task.task_type),
  }
}

async function handleParseReplyTask(params: {
  supabase: SupabaseClient
  task: RangerTask
}): Promise<TaskResult> {
  const { supabase, task } = params
  const applicant = await loadApplicant(supabase, task.applicant_id)
  if (!applicant) return { ok: false, summary: 'Applicant no longer exists.' }

  const body = typeof task.payload.body === 'string' ? task.payload.body : ''
  if (!body.trim()) return { ok: false, summary: 'Reply task has no body.' }

  const updatePayload = mergeParsedReply(applicant, body)
  const { data: updatedApplicant, error: updateError } = await supabase
    .from('ranger_applicants')
    .update({
      ...updatePayload,
      last_contact_at: new Date().toISOString(),
    })
    .eq('id', applicant.id)
    .select('*')
    .single()

  if (updateError) throw updateError

  const report = await rebuildCandidateReport({
    supabase,
    applicant: updatedApplicant as RangerApplicant,
  })

  await sendRangerTelegramMessage({
    text: `Applicant replied: ${applicantLabel(updatedApplicant as RangerApplicant)}

Status: ${(updatedApplicant as RangerApplicant).status}
Next: ${report.suggested_next_step || (updatedApplicant as RangerApplicant).next_action || 'Review reply.'}`,
  })

  return {
    ok: true,
    summary: `Parsed Gmail reply for ${applicantLabel(updatedApplicant as RangerApplicant)}.`,
    reportId: report.id,
    specialist: 'reply_parser',
    modelTier: modelTierForTask(task.task_type),
  }
}

async function handleDraftFollowupTask(params: {
  supabase: SupabaseClient
  task: RangerTask
}): Promise<TaskResult> {
  const { supabase, task } = params
  const applicant = await loadApplicant(supabase, task.applicant_id)
  if (!applicant) return { ok: false, summary: 'Applicant no longer exists.' }

  const { error } = await supabase.from('ranger_messages').insert({
    applicant_id: applicant.id,
    channel: 'gmail',
    direction: 'outbound',
    subject: 'Quick questions about your application',
    body: buildRangerScreeningDraft(),
    status: 'pending_approval',
    requires_approval: true,
    metadata: { generated_by: 'ranger_task_worker' },
  })

  if (error) throw error

  return {
    ok: true,
    summary: `Drafted follow-up for ${applicantLabel(applicant)}.`,
    specialist: 'screening_liaison',
    modelTier: modelTierForTask(task.task_type),
  }
}

async function handleFollowupReminderTask(params: {
  supabase: SupabaseClient
  task: RangerTask
}): Promise<TaskResult> {
  const { supabase, task } = params
  const applicant = await loadApplicant(supabase, task.applicant_id)
  if (!applicant) return { ok: false, summary: 'Applicant no longer exists.' }

  await sendRangerTelegramMessage({
    text: `Ranger reminder: ${applicantLabel(applicant)} is due for follow-up.

Status: ${applicant.status}
Next: ${applicant.next_action || 'Review applicant.'}`,
  })

  return {
    ok: true,
    summary: `Sent follow-up reminder for ${applicantLabel(applicant)}.`,
    specialist: 'owner_briefing_writer',
    modelTier: modelTierForTask(task.task_type),
  }
}

async function runTask(params: {
  supabase: SupabaseClient
  task: RangerTask
}): Promise<TaskResult> {
  const { supabase, task } = params
  if (task.task_type === 'standard_research') {
    return handleResearchTask({ supabase, task, depth: 'standard' })
  }
  if (task.task_type === 'deep_research') {
    return handleResearchTask({ supabase, task, depth: 'deep' })
  }
  if (task.task_type === 'public_records_check') {
    return handlePublicRecordsTask({ supabase, task })
  }
  if (task.task_type === 'parse_gmail_reply') {
    return handleParseReplyTask({ supabase, task })
  }
  if (task.task_type === 'draft_followup') {
    return handleDraftFollowupTask({ supabase, task })
  }
  if (task.task_type === 'followup_reminder') {
    return handleFollowupReminderTask({ supabase, task })
  }

  return {
    ok: false,
    summary: `Unknown Ranger task type: ${task.task_type}`,
  }
}

export async function claimPendingRangerTasks(params: {
  supabase: SupabaseClient
  limit: number
}) {
  const now = new Date().toISOString()
  const { data, error } = await params.supabase
    .from('ranger_tasks')
    .select('*')
    .eq('status', 'pending')
    .or(`due_at.is.null,due_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(params.limit)

  if (error) throw error

  const tasks = ((data || []) as RangerTask[]).sort((first, second) => {
    return (
      (PRIORITY_ORDER[first.priority] ?? 9) -
      (PRIORITY_ORDER[second.priority] ?? 9)
    )
  })
  if (tasks.length === 0) return []

  const ids = tasks.map((task) => task.id)
  const { data: claimed, error: claimError } = await params.supabase
    .from('ranger_tasks')
    .update({ status: 'running', locked_at: now, error_message: null })
    .in('id', ids)
    .eq('status', 'pending')
    .select('*')

  if (claimError) throw claimError
  return (claimed || []) as RangerTask[]
}

export async function processRangerTaskBatch(params: {
  supabase: SupabaseClient
  limit?: number
}) {
  const tasks = await claimPendingRangerTasks({
    supabase: params.supabase,
    limit: params.limit ?? 5,
  })
  const results: Array<{
    taskId: string
    taskType: string
    result: TaskResult
  }> = []

  for (const task of tasks) {
    try {
      const result = await runTask({ supabase: params.supabase, task })
      const completedAt = new Date().toISOString()
      await params.supabase
        .from('ranger_tasks')
        .update({
          status: result.ok ? 'completed' : 'failed',
          completed_at: completedAt,
          result,
          error_message: result.ok ? null : result.summary,
        })
        .eq('id', task.id)

      await params.supabase.from('ranger_audit_events').insert({
        applicant_id: task.applicant_id,
        actor: `ranger-${specialistForTask(task.task_type)}`,
        event_type: result.ok ? 'task_completed' : 'task_failed',
        event_summary: result.summary,
        payload: {
          taskId: task.id,
          taskType: task.task_type,
          specialist: specialistForTask(task.task_type),
          modelTier: modelTierForTask(task.task_type),
          result,
        },
      })
      results.push({ taskId: task.id, taskType: task.task_type, result })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown task error'
      await params.supabase
        .from('ranger_tasks')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: message,
          result: { ok: false, summary: message },
        })
        .eq('id', task.id)
      results.push({
        taskId: task.id,
        taskType: task.task_type,
        result: { ok: false, summary: message },
      })
    }
  }

  return {
    claimed: tasks.length,
    completed: results.filter((item) => item.result.ok).length,
    failed: results.filter((item) => !item.result.ok).length,
    results,
  }
}
