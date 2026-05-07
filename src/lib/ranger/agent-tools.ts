import type { SupabaseClient } from '@supabase/supabase-js'
import { runRangerBulkAction, runRangerTelegramAction } from './actions'
import { createRangerPendingAction, updateRangerThreadState } from './memory'
import { rebuildCandidateReport } from './reports'
import { sendRangerApplicantSms } from './sms'
import { sendRangerTelegramMessage } from './telegram'
import type {
  RangerApplicant,
  RangerCommandThread,
  RangerEvidence,
} from './types'

export type RangerAgentToolName =
  | 'find_applicant'
  | 'inspect_applicant'
  | 'queue_research'
  | 'queue_public_records'
  | 'send_screening_sms'
  | 'send_screening_email'
  | 'set_reminder'
  | 'add_owner_note'
  | 'record_outcome'
  | 'schedule_phone_screen'
  | 'request_pass_approval'
  | 'request_hire_approval'
  | 'draft_custom_sms_approval'
  | 'run_records_all'
  | 'run_research_all'
  | 'text_missing_screening'
  | 'cleanup_stale_applicants'
  | 'show_top_candidates'

export type RangerAgentToolContext = {
  supabase: SupabaseClient
  thread: RangerCommandThread
  actor: string
  chatId: string | number | null
}

type ToolPayload = Record<string, unknown>

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

function stringValue(payload: ToolPayload, key: string) {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function findApplicantByQuery(
  supabase: SupabaseClient,
  query: string,
  fallbackApplicantId?: string | null,
) {
  const trimmed = query.trim()
  if (!trimmed && fallbackApplicantId) {
    const { data, error } = await supabase
      .from('ranger_applicants')
      .select('*')
      .eq('id', fallbackApplicantId)
      .maybeSingle()
    if (error) throw error
    return data as RangerApplicant | null
  }
  if (!trimmed) return null

  const { data: applicants, error } = await supabase
    .from('ranger_applicants')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(75)

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

async function loadApplicantContext(
  supabase: SupabaseClient,
  applicant: RangerApplicant,
) {
  const [
    { data: report, error: reportError },
    { data: evidence, error: evidenceError },
  ] = await Promise.all([
    supabase
      .from('ranger_candidate_reports')
      .select('*')
      .eq('applicant_id', applicant.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ranger_evidence')
      .select('*')
      .eq('applicant_id', applicant.id)
      .order('created_at', { ascending: false })
      .limit(12),
  ])

  if (reportError) throw reportError
  if (evidenceError) throw evidenceError

  return {
    applicant,
    report,
    evidence: (evidence || []) as RangerEvidence[],
  }
}

async function requireApplicant(params: {
  supabase: SupabaseClient
  thread: RangerCommandThread
  query: string
}): Promise<
  { ok: false; summary: string } | { ok: true; applicant: RangerApplicant }
> {
  const applicant = await findApplicantByQuery(
    params.supabase,
    params.query,
    params.thread.last_applicant_id,
  )
  if (!applicant) {
    return {
      ok: false,
      summary: params.query
        ? `I could not find an applicant matching "${params.query}".`
        : 'I need to know which applicant you mean.',
    }
  }

  await updateRangerThreadState({
    supabase: params.supabase,
    threadId: params.thread.id,
    lastApplicantId: applicant.id,
  })

  return { ok: true, applicant }
}

async function createApprovalCard(params: {
  context: RangerAgentToolContext
  applicant: RangerApplicant | null
  actionType: string
  payload: ToolPayload
  label: string
}) {
  const pending = await createRangerPendingAction({
    supabase: params.context.supabase,
    threadId: params.context.thread.id,
    applicantId: params.applicant?.id || null,
    actionType: params.actionType,
    payload: params.payload,
    requestedBy: params.context.actor,
  })

  await sendRangerTelegramMessage({
    chatId: params.context.chatId,
    text: `Approval needed: ${params.label}

${params.applicant ? `Applicant: ${applicantLabel(params.applicant)}` : ''}
Action: ${params.actionType}

Approve only if this is what you want Ranger to do.`,
    buttons: [
      [
        { text: 'Approve', callback_data: `ranger:approve:${pending.id}` },
        { text: 'Cancel', callback_data: `ranger:cancel:${pending.id}` },
      ],
    ],
  })

  return {
    ok: true,
    pendingActionId: pending.id,
    requiresApproval: true,
    summary: `I queued an approval card for ${params.label}.`,
  }
}

export const RANGER_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'find_applicant',
      description:
        'Find an applicant by name, email, or phone and remember them as the current applicant.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_applicant',
      description:
        'Load detailed applicant, latest report, and sourced evidence.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queue_research',
      description: 'Queue deep public research for an applicant.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queue_public_records',
      description: 'Queue a public-records search for an applicant.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_screening_sms',
      description:
        'Send routine screening questions by SMS. This is allowed without approval.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_screening_email',
      description:
        'Send routine screening questions by Gmail. This is allowed without approval.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a follow-up reminder for an applicant.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_owner_note',
      description: 'Add a note from Chuck/Ranger to an applicant record.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, note: { type: 'string' } },
        required: ['query', 'note'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_outcome',
      description:
        'Record a hiring pipeline or employment outcome for learning.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, outcome: { type: 'string' } },
        required: ['query', 'outcome'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_phone_screen',
      description: 'Record a lightweight phone screen window for an applicant.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, window: { type: 'string' } },
        required: ['query', 'window'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_pass_approval',
      description: 'Create an approval card before passing on an applicant.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, reason: { type: 'string' } },
        required: ['query', 'reason'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_hire_approval',
      description: 'Create an approval card before marking an applicant hired.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, reason: { type: 'string' } },
        required: ['query', 'reason'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_custom_sms_approval',
      description:
        'Create an approval card for a non-routine custom SMS message.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, message: { type: 'string' } },
        required: ['query', 'message'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_records_all',
      description: 'Queue public-records checks for all active applicants.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_research_all',
      description: 'Queue deep research for all active applicants.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'text_missing_screening',
      description:
        'Text routine screening questions to active applicants with phone numbers who are missing required info.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cleanup_stale_applicants',
      description:
        'Mark stale applicants as ghosted when they have not replied after the cleanup window.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_top_candidates',
      description: 'Rank and summarize the best current candidates.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
] as const

export async function executeRangerAgentTool(params: {
  context: RangerAgentToolContext
  name: string
  payload: ToolPayload
}) {
  const { context, name, payload } = params
  const bulkActions: Record<string, string> = {
    run_records_all: 'records_all',
    run_research_all: 'research_all',
    text_missing_screening: 'text_missing',
    cleanup_stale_applicants: 'stale_cleanup',
    show_top_candidates: 'top_candidates',
  }
  if (bulkActions[name]) {
    return {
      ok: true,
      summary: await runRangerBulkAction({
        supabase: context.supabase,
        action: bulkActions[name],
        actor: context.actor,
      }),
      specialist:
        name === 'show_top_candidates'
          ? 'owner_briefing_writer'
          : name === 'cleanup_stale_applicants'
            ? 'outcome_learning_coach'
            : 'ranger_bulk_operator',
    }
  }

  const query = stringValue(payload, 'query')
  const applicantResult = await requireApplicant({
    supabase: context.supabase,
    thread: context.thread,
    query,
  })

  if (
    !applicantResult.ok &&
    name !== 'find_applicant' &&
    name !== 'inspect_applicant'
  ) {
    return applicantResult
  }

  if (name === 'find_applicant') return applicantResult
  if (name === 'inspect_applicant') {
    if (!applicantResult.ok) return applicantResult
    return {
      ok: true,
      summary: `Loaded ${applicantLabel(applicantResult.applicant)}.`,
      ...(await loadApplicantContext(
        context.supabase,
        applicantResult.applicant,
      )),
    }
  }

  if (!applicantResult.ok) return applicantResult
  const applicant = applicantResult.applicant

  if (name === 'queue_research') {
    return {
      ok: true,
      summary: await runRangerTelegramAction({
        supabase: context.supabase,
        action: 'deep',
        applicantId: applicant.id,
        actor: context.actor,
      }),
      applicantId: applicant.id,
      specialist: 'research_scout',
    }
  }

  if (name === 'queue_public_records') {
    return {
      ok: true,
      summary: await runRangerTelegramAction({
        supabase: context.supabase,
        action: 'records',
        applicantId: applicant.id,
        actor: context.actor,
      }),
      applicantId: applicant.id,
      specialist: 'public_records_clerk',
    }
  }

  if (name === 'send_screening_sms') {
    return {
      ok: true,
      summary: await sendRangerApplicantSms({
        supabase: context.supabase,
        applicant,
        actor: context.actor,
      }),
      applicantId: applicant.id,
      specialist: 'screening_liaison',
    }
  }

  if (name === 'send_screening_email') {
    return {
      ok: true,
      summary: await runRangerTelegramAction({
        supabase: context.supabase,
        action: 'send',
        applicantId: applicant.id,
        actor: context.actor,
      }),
      applicantId: applicant.id,
      specialist: 'screening_liaison',
    }
  }

  if (name === 'set_reminder') {
    return {
      ok: true,
      summary: await runRangerTelegramAction({
        supabase: context.supabase,
        action: 'remind',
        applicantId: applicant.id,
        actor: context.actor,
      }),
      applicantId: applicant.id,
    }
  }

  if (name === 'add_owner_note') {
    const note = stringValue(payload, 'note')
    return {
      ok: true,
      summary: await import('./actions').then((module) =>
        module.runRangerTextAction({
          supabase: context.supabase,
          text: `/note ${applicantLabel(applicant)} | ${note}`,
          actor: context.actor,
        }),
      ),
      applicantId: applicant.id,
    }
  }

  if (name === 'record_outcome') {
    const outcome = stringValue(payload, 'outcome')
    return {
      ok: true,
      summary: await import('./actions').then((module) =>
        module.runRangerTextAction({
          supabase: context.supabase,
          text: `/outcome ${applicantLabel(applicant)} | ${outcome}`,
          actor: context.actor,
        }),
      ),
      applicantId: applicant.id,
      specialist: 'outcome_learning_coach',
    }
  }

  if (name === 'schedule_phone_screen') {
    const window = stringValue(payload, 'window')
    return {
      ok: true,
      summary: await import('./actions').then((module) =>
        module.runRangerTextAction({
          supabase: context.supabase,
          text: `/schedule ${applicantLabel(applicant)} | ${window}`,
          actor: context.actor,
        }),
      ),
      applicantId: applicant.id,
      specialist: 'screening_liaison',
    }
  }

  if (name === 'request_pass_approval') {
    return createApprovalCard({
      context,
      applicant,
      actionType: 'pass',
      label: `pass on ${applicantLabel(applicant)}`,
      payload: {
        action: 'pass',
        applicantId: applicant.id,
        reason: stringValue(payload, 'reason'),
      },
    })
  }

  if (name === 'request_hire_approval') {
    return createApprovalCard({
      context,
      applicant,
      actionType: 'hire',
      label: `mark ${applicantLabel(applicant)} hired`,
      payload: {
        action: 'hire',
        applicantId: applicant.id,
        reason: stringValue(payload, 'reason'),
      },
    })
  }

  if (name === 'draft_custom_sms_approval') {
    return createApprovalCard({
      context,
      applicant,
      actionType: 'custom_sms',
      label: `send custom SMS to ${applicantLabel(applicant)}`,
      payload: {
        action: 'custom_sms',
        applicantId: applicant.id,
        message: stringValue(payload, 'message'),
      },
    })
  }

  return { ok: false, summary: `Unknown Ranger agent tool: ${name}` }
}
