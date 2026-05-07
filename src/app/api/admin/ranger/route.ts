import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { rangerModelSummary } from '@/lib/ranger/models'
import { buildRangerOutcomeInsight } from '@/lib/ranger/skills'
import type {
  RangerApplicant,
  RangerCandidateReport,
  RangerOutcome,
} from '@/lib/ranger/types'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 50), 100)
    const supabase = createAdminClient()

    const [
      { data: applicants, error: applicantsError },
      { data: reports, error: reportsError },
    ] = await Promise.all([
      supabase
        .from('ranger_applicants')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('ranger_candidate_reports')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(limit),
    ])

    if (applicantsError) throw applicantsError
    if (reportsError) throw reportsError

    const applicantIds = (applicants || []).map((applicant) => applicant.id)

    const [
      { data: evidence, error: evidenceError },
      { data: messages, error: messagesError },
      { data: tasks, error: tasksError },
      { data: decisions, error: decisionsError },
      { data: outcomes, error: outcomesError },
      { data: auditEvents, error: auditEventsError },
      { data: pendingActions, error: pendingActionsError },
    ] =
      applicantIds.length > 0
        ? await Promise.all([
            supabase
              .from('ranger_evidence')
              .select('*')
              .in('applicant_id', applicantIds)
              .order('created_at', { ascending: false })
              .limit(200),
            supabase
              .from('ranger_messages')
              .select('*')
              .in('applicant_id', applicantIds)
              .order('created_at', { ascending: false })
              .limit(200),
            supabase
              .from('ranger_tasks')
              .select('*')
              .in('applicant_id', applicantIds)
              .order('created_at', { ascending: false })
              .limit(200),
            supabase
              .from('ranger_owner_decisions')
              .select('*')
              .in('applicant_id', applicantIds)
              .order('created_at', { ascending: false })
              .limit(200),
            supabase
              .from('ranger_outcomes')
              .select('*')
              .in('applicant_id', applicantIds)
              .order('recorded_at', { ascending: false })
              .limit(200),
            supabase
              .from('ranger_audit_events')
              .select('*')
              .in('applicant_id', applicantIds)
              .order('created_at', { ascending: false })
              .limit(200),
            supabase
              .from('ranger_pending_actions')
              .select('*')
              .or(
                `applicant_id.in.(${applicantIds.join(',')}),applicant_id.is.null`,
              )
              .order('created_at', { ascending: false })
              .limit(100),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ]
    const [
      { data: commandThreads, error: commandThreadsError },
      { data: commandMessages, error: commandMessagesError },
    ] = await Promise.all([
      supabase
        .from('ranger_command_threads')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(10),
      supabase
        .from('ranger_command_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    if (evidenceError) throw evidenceError
    if (messagesError) throw messagesError
    if (tasksError) throw tasksError
    if (decisionsError) throw decisionsError
    if (outcomesError) throw outcomesError
    if (auditEventsError) throw auditEventsError
    if (pendingActionsError) throw pendingActionsError
    if (commandThreadsError) throw commandThreadsError
    if (commandMessagesError) throw commandMessagesError

    const typedApplicants = (applicants || []) as RangerApplicant[]
    const typedReports = (reports || []) as RangerCandidateReport[]
    const typedOutcomes = (outcomes || []) as RangerOutcome[]
    const insights = typedApplicants.slice(0, 12).map((applicant) => {
      const applicantOutcomes = typedOutcomes.filter(
        (outcome) => outcome.applicant_id === applicant.id,
      )
      const report =
        typedReports.find((item) => item.applicant_id === applicant.id) || null
      return buildRangerOutcomeInsight({
        applicant,
        outcomes: applicantOutcomes,
        report,
      })
    })

    const stats = {
      total: applicants?.length || 0,
      hardMisses:
        applicants?.filter(
          (applicant) => (applicant.hard_requirement_misses || []).length > 0,
        ).length || 0,
      awaitingReply:
        applicants?.filter((applicant) => applicant.status === 'awaiting_reply')
          .length || 0,
      reportsReady:
        applicants?.filter(
          (applicant) => applicant.status === 'candidate_report_ready',
        ).length || 0,
      phoneReady:
        applicants?.filter(
          (applicant) => applicant.status === 'phone_call_ready',
        ).length || 0,
      hired:
        applicants?.filter((applicant) => applicant.status === 'hired')
          .length || 0,
      ghosted:
        applicants?.filter((applicant) => applicant.status === 'ghosted')
          .length || 0,
    }

    return NextResponse.json({
      applicants: applicants || [],
      reports: reports || [],
      evidence: evidence || [],
      messages: messages || [],
      tasks: tasks || [],
      decisions: decisions || [],
      outcomes: outcomes || [],
      auditEvents: auditEvents || [],
      commandThreads: commandThreads || [],
      commandMessages: commandMessages || [],
      pendingActions: pendingActions || [],
      modelState: rangerModelSummary(),
      insights,
      stats,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[admin/ranger] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load Ranger dashboard' },
      { status: 500 },
    )
  }
}
