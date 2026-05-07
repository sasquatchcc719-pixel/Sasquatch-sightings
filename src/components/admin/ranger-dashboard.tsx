'use client'

import { Children, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Activity,
  Bot,
  Car,
  CheckCircle2,
  Clock,
  FileSearch,
  MessageSquare,
  Moon,
  Phone,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { buildRangerScreeningDraft } from '@/lib/ranger/intake'
import type {
  RangerApplicant,
  RangerAuditEvent,
  RangerCandidateReport,
  RangerCommandMessage,
  RangerCommandThread,
  RangerDashboardData,
  RangerEvidence,
  RangerMessage,
  RangerOutcome,
  RangerOwnerDecision,
  RangerPendingAction,
  RangerTask,
} from '@/lib/ranger/types'

const EMPTY_APPLICANTS: RangerApplicant[] = []
const EMPTY_REPORTS: RangerCandidateReport[] = []
const EMPTY_MESSAGES: RangerMessage[] = []
const EMPTY_EVIDENCE: RangerEvidence[] = []
const EMPTY_TASKS: RangerTask[] = []
const EMPTY_DECISIONS: RangerOwnerDecision[] = []
const EMPTY_OUTCOMES: RangerOutcome[] = []
const EMPTY_AUDIT_EVENTS: RangerAuditEvent[] = []
const EMPTY_COMMAND_THREADS: RangerCommandThread[] = []
const EMPTY_COMMAND_MESSAGES: RangerCommandMessage[] = []
const EMPTY_PENDING_ACTIONS: RangerPendingAction[] = []

function formatDate(value: string | null) {
  if (!value) return 'Not set'
  return new Date(value).toLocaleString()
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ')
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'hired' || status === 'phone_call_ready') return 'default'
  if (status === 'passed' || status === 'no_show') return 'destructive'
  if (status === 'candidate_report_ready' || status === 'owner_review')
    return 'outline'
  return 'secondary'
}

function latestReportFor(
  applicant: RangerApplicant,
  reports: RangerCandidateReport[],
) {
  return reports.find((report) => report.applicant_id === applicant.id) || null
}

function messagesFor(applicant: RangerApplicant, messages: RangerMessage[]) {
  return messages
    .filter((message) => message.applicant_id === applicant.id)
    .slice(0, 3)
}

function evidenceFor(applicant: RangerApplicant, evidence: RangerEvidence[]) {
  return evidence
    .filter((item) => item.applicant_id === applicant.id)
    .slice(0, 4)
}

function tasksFor(applicant: RangerApplicant, tasks: RangerTask[]) {
  return tasks.filter((task) => task.applicant_id === applicant.id).slice(0, 4)
}

function timelineFor(
  applicant: RangerApplicant,
  outcomes: RangerOutcome[],
  decisions: RangerOwnerDecision[],
  auditEvents: RangerAuditEvent[],
) {
  return [
    ...outcomes
      .filter((outcome) => outcome.applicant_id === applicant.id)
      .map((outcome) => ({
        id: outcome.id,
        label: outcome.outcome_label,
        detail: outcome.notes || outcome.outcome_type,
        at: outcome.recorded_at,
      })),
    ...decisions
      .filter((decision) => decision.applicant_id === applicant.id)
      .map((decision) => ({
        id: decision.id,
        label: decision.decision_value,
        detail: decision.decision_type,
        at: decision.created_at,
      })),
    ...auditEvents
      .filter((event) => event.applicant_id === applicant.id)
      .map((event) => ({
        id: event.id,
        label: event.event_type,
        detail: event.event_summary,
        at: event.created_at,
      })),
  ]
    .sort((first, second) => Date.parse(second.at) - Date.parse(first.at))
    .slice(0, 5)
}

function evidenceClass(sentiment: RangerEvidence['sentiment']) {
  if (sentiment === 'red_flag') return 'border-red-500/30 bg-red-500/10'
  if (sentiment === 'concern') return 'border-amber-500/30 bg-amber-500/10'
  if (sentiment === 'positive') return 'border-emerald-500/30 bg-emerald-500/10'
  return 'border-white/10 bg-white/[0.03]'
}

function RequirementPill({
  label,
  value,
}: {
  label: string
  value: boolean | null
}) {
  const className =
    value === true
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : value === false
        ? 'border-red-500/30 bg-red-500/10 text-red-200'
        : 'border-white/10 bg-white/5 text-slate-300'

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs ${className}`}>
      {label}: {value === null ? 'unknown' : value ? 'yes' : 'no'}
    </span>
  )
}

export function RangerDashboard() {
  const [data, setData] = useState<RangerDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [runningAction, setRunningAction] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ranger?limit=75', {
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load Ranger')
      }
      setData(result)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load Ranger',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function runAction(action: string, applicantId?: string) {
    setRunningAction(applicantId ? `${action}:${applicantId}` : action)
    setActionMessage(null)
    setError(null)
    try {
      const response = await fetch('/api/admin/ranger/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, applicantId }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to run Ranger action')
      }
      setActionMessage(
        typeof result.result === 'string'
          ? result.result
          : 'Ranger action completed.',
      )
      await loadData()
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Failed to run Ranger action',
      )
    } finally {
      setRunningAction(null)
    }
  }

  const stats = data?.stats
  const applicants = data?.applicants || EMPTY_APPLICANTS
  const reports = data?.reports || EMPTY_REPORTS
  const messages = data?.messages || EMPTY_MESSAGES
  const evidence = data?.evidence || EMPTY_EVIDENCE
  const tasks = data?.tasks || EMPTY_TASKS
  const decisions = data?.decisions || EMPTY_DECISIONS
  const outcomes = data?.outcomes || EMPTY_OUTCOMES
  const auditEvents = data?.auditEvents || EMPTY_AUDIT_EVENTS
  const commandThreads = data?.commandThreads || EMPTY_COMMAND_THREADS
  const commandMessages = data?.commandMessages || EMPTY_COMMAND_MESSAGES
  const pendingActions = data?.pendingActions || EMPTY_PENDING_ACTIONS
  const modelState = data?.modelState
  const insights = data?.insights || []
  const pendingApprovalCount = pendingActions.filter(
    (action) => action.status === 'pending',
  ).length

  const readyApplicants = useMemo(() => {
    return applicants.filter((applicant) =>
      ['candidate_report_ready', 'owner_review', 'phone_call_ready'].includes(
        applicant.status,
      ),
    )
  }, [applicants])

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Card className="relative overflow-hidden border-emerald-500/20 bg-slate-950/70 p-6 shadow-[0_0_40px_rgba(16,185,129,0.08)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.14),transparent_30%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
              <Bot className="h-3.5 w-3.5" />
              Ranger Hiring Agent
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Applicant command center
            </h1>
            <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
              Ranger screens Craigslist/Gmail applicants for hard requirements,
              builds Candidate Reports, keeps every action logged, and only
              brings you in when a candidate is vetted enough to matter.
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadData()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {actionMessage ? (
        <Card className="border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          {actionMessage}
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard
          icon={FileSearch}
          label="Applicants"
          value={stats?.total || 0}
        />
        <StatCard
          icon={AlertTriangle}
          label="Hard Misses"
          value={stats?.hardMisses || 0}
        />
        <StatCard
          icon={Clock}
          label="Awaiting Reply"
          value={stats?.awaitingReply || 0}
        />
        <StatCard
          icon={ShieldCheck}
          label="Reports Ready"
          value={stats?.reportsReady || 0}
        />
        <StatCard
          icon={UserRoundCheck}
          label="Phone Ready"
          value={stats?.phoneReady || 0}
        />
        <StatCard icon={CheckCircle2} label="Hired" value={stats?.hired || 0} />
        <StatCard
          icon={AlertTriangle}
          label="Ghosted"
          value={stats?.ghosted || 0}
        />
      </div>

      <Card className="border-cyan-500/20 bg-slate-950/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Bot className="h-4 w-4 text-cyan-300" />
              Agent Command Center
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Memory, approvals, bulk autonomy, and model tiers for Ranger’s
              owner-facing brain.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={ShieldAlert}
              label="Records All"
              running={runningAction === 'records_all'}
              onClick={() => void runAction('records_all')}
            />
            <ActionButton
              icon={FileSearch}
              label="Research All"
              running={runningAction === 'research_all'}
              onClick={() => void runAction('research_all')}
            />
            <ActionButton
              icon={MessageSquare}
              label="Text Missing"
              running={runningAction === 'text_missing'}
              onClick={() => void runAction('text_missing')}
            />
            <ActionButton
              icon={Clock}
              label="Cleanup Stale"
              running={runningAction === 'stale_cleanup'}
              onClick={() => void runAction('stale_cleanup')}
            />
            <ActionButton
              icon={UserRoundCheck}
              label="Top Candidates"
              running={runningAction === 'top_candidates'}
              onClick={() => void runAction('top_candidates')}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-muted-foreground text-xs uppercase">Models</p>
            <p className="mt-2 text-sm">
              Brain: {modelState?.brain || 'unknown'}
            </p>
            <p className="text-muted-foreground text-xs">
              Worker: {modelState?.worker || 'unknown'} · Fast:{' '}
              {modelState?.fast || 'unknown'}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-muted-foreground text-xs uppercase">
              Pending approvals
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {pendingApprovalCount}
            </p>
            <p className="text-muted-foreground text-xs">
              Pass/hire/custom outreach stay gated.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-muted-foreground text-xs uppercase">
              Memory threads
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {commandThreads.length}
            </p>
            <p className="text-muted-foreground text-xs">
              Latest: {commandThreads[0]?.summary || 'active Telegram memory'}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-muted-foreground text-xs uppercase">
              Tool calls
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {
                commandMessages.filter((message) => message.role === 'tool')
                  .length
              }
            </p>
            <p className="text-muted-foreground text-xs">
              Recent agent actions are logged.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <ControlPanel
            icon={Activity}
            title="Recent Agent Memory"
            empty="No Ranger command memory yet."
          >
            {commandMessages.slice(0, 6).map((message) => (
              <div
                key={message.id}
                className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge variant="outline">{message.role}</Badge>
                  <span className="text-muted-foreground text-[11px]">
                    {formatDate(message.created_at)}
                  </span>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap">
                  {message.body}
                </p>
              </div>
            ))}
          </ControlPanel>

          <ControlPanel
            icon={AlertTriangle}
            title="Pending Approvals"
            empty="No approval-gated actions waiting."
          >
            {pendingActions.slice(0, 6).map((action) => (
              <div
                key={action.id}
                className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge variant="outline">{action.action_type}</Badge>
                  <span className="text-muted-foreground text-[11px]">
                    {action.status}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Expires {formatDate(action.expires_at)}
                </p>
              </div>
            ))}
          </ControlPanel>

          <ControlPanel
            icon={ShieldCheck}
            title="Outcome Learning"
            empty="No outcome insights yet."
          >
            {insights.slice(0, 6).map((insight) => (
              <div
                key={insight.applicantId}
                className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
              >
                <p className="font-medium">{insight.outcome}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Fit {insight.fit} · {insight.recommendation}
                </p>
                <p className="mt-2 text-xs">{insight.lesson}</p>
              </div>
            ))}
          </ControlPanel>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Applicant Pipeline</h2>
              <p className="text-muted-foreground text-sm">
                Standard research by default. Phone calls happen only after AI
                vetting and owner approval.
              </p>
            </div>
            <Badge variant="outline">
              {readyApplicants.length} need review
            </Badge>
          </div>

          {loading ? (
            <Card className="text-muted-foreground p-8 text-center text-sm">
              Loading Ranger applicants...
            </Card>
          ) : applicants.length === 0 ? (
            <Card className="p-8 text-center">
              <FileSearch className="mx-auto mb-3 h-8 w-8 text-emerald-300" />
              <h3 className="font-semibold">No applicants yet</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Connect Gmail intake or use the Ranger intake API to create the
                first candidate record.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {applicants.map((applicant) => {
                const report = latestReportFor(applicant, reports)
                const recentMessages = messagesFor(applicant, messages)
                const applicantEvidence = evidenceFor(applicant, evidence)
                const applicantTasks = tasksFor(applicant, tasks)
                const applicantTimeline = timelineFor(
                  applicant,
                  outcomes,
                  decisions,
                  auditEvents,
                )
                const pendingDraft = messages.find(
                  (message) =>
                    message.applicant_id === applicant.id &&
                    message.channel === 'gmail' &&
                    message.direction === 'outbound' &&
                    ['draft', 'pending_approval', 'approved'].includes(
                      message.status,
                    ),
                )
                return (
                  <Card
                    key={applicant.id}
                    className="border-border/60 bg-card/80 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            {applicant.full_name ||
                              applicant.phone ||
                              applicant.email ||
                              'Unknown applicant'}
                          </h3>
                          <Badge variant={statusVariant(applicant.status)}>
                            {statusLabel(applicant.status)}
                          </Badge>
                          {report ? (
                            <Badge variant="outline">
                              {report.overall_fit} fit
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {applicant.email || 'No email'} ·{' '}
                          {applicant.phone || 'No phone'} ·{' '}
                          {applicant.city_area || 'Area unknown'}
                        </p>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {formatDate(applicant.created_at)}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionButton
                        icon={Send}
                        label={pendingDraft ? 'Send Draft' : 'Send Screening'}
                        running={runningAction === `send:${applicant.id}`}
                        onClick={() => void runAction('send', applicant.id)}
                      />
                      <ActionButton
                        icon={MessageSquare}
                        label="Text Screening"
                        running={runningAction === `sms:${applicant.id}`}
                        onClick={() => void runAction('sms', applicant.id)}
                      />
                      <ActionButton
                        icon={FileSearch}
                        label="Deep Research"
                        running={runningAction === `deep:${applicant.id}`}
                        onClick={() => void runAction('deep', applicant.id)}
                      />
                      <ActionButton
                        icon={ShieldAlert}
                        label="Public Records"
                        running={runningAction === `records:${applicant.id}`}
                        onClick={() => void runAction('records', applicant.id)}
                      />
                      <ActionButton
                        icon={Phone}
                        label="Phone Screen"
                        running={runningAction === `late:${applicant.id}`}
                        onClick={() => void runAction('late', applicant.id)}
                      />
                      <ActionButton
                        icon={Clock}
                        label="Reminder"
                        running={runningAction === `remind:${applicant.id}`}
                        onClick={() => void runAction('remind', applicant.id)}
                      />
                      <ActionButton
                        icon={UserRoundCheck}
                        label="Hire"
                        running={runningAction === `hire:${applicant.id}`}
                        onClick={() => void runAction('hire', applicant.id)}
                      />
                      <ActionButton
                        icon={AlertTriangle}
                        label="Pass"
                        running={runningAction === `pass:${applicant.id}`}
                        onClick={() => void runAction('pass', applicant.id)}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <RequirementPill
                        label="transport"
                        value={applicant.has_reliable_transportation}
                      />
                      <RequirementPill
                        label="license"
                        value={applicant.has_valid_driver_license}
                      />
                      <RequirementPill
                        label="nights"
                        value={applicant.can_work_nights}
                      />
                      <RequirementPill
                        label="Saturdays"
                        value={applicant.can_work_saturdays}
                      />
                      <RequirementPill
                        label="physical"
                        value={applicant.can_do_physical_work}
                      />
                    </div>

                    {applicant.hard_requirement_misses.length > 0 ? (
                      <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
                        <p className="font-medium">Hard requirement misses</p>
                        <ul className="mt-1 list-inside list-disc">
                          {applicant.hard_requirement_misses.map((miss) => (
                            <li key={miss}>{miss}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {report ? (
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                          <p className="text-sm font-medium">
                            Candidate Report
                          </p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {report.summary || 'No summary yet.'}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant="outline">
                              {report.overall_recommendation}
                            </Badge>
                            <Badge variant="secondary">
                              identity {report.identity_confidence}
                            </Badge>
                            <Badge variant="secondary">
                              research {report.research_confidence}
                            </Badge>
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                          <p className="text-sm font-medium">Next Action</p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {report.suggested_next_step ||
                              applicant.next_action ||
                              'Owner review'}
                          </p>
                          {report.missing_information.length > 0 ? (
                            <p className="mt-2 text-xs text-amber-200">
                              Missing: {report.missing_information.join(', ')}
                            </p>
                          ) : null}
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 lg:col-span-2">
                          <p className="text-sm font-medium">Scorecard</p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {Object.entries(report.category_scores || {}).map(
                              ([category, score]) => (
                                <div
                                  key={category}
                                  className="rounded-lg border border-white/10 bg-black/20 p-2"
                                >
                                  <p className="text-muted-foreground text-[11px] uppercase">
                                    {statusLabel(category)}
                                  </p>
                                  <p className="mt-1 text-sm font-semibold">
                                    {score.label} · {score.score}
                                  </p>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      <ControlPanel
                        icon={FileSearch}
                        title="Evidence"
                        empty="No sourced evidence yet."
                      >
                        {applicantEvidence.map((item) => (
                          <div
                            key={item.id}
                            className={`rounded-lg border p-3 text-sm ${evidenceClass(item.sentiment)}`}
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{item.category}</Badge>
                              <span className="text-muted-foreground text-xs">
                                {item.sentiment} · {item.confidence}
                              </span>
                            </div>
                            <p>{item.finding}</p>
                            {item.source_url ? (
                              <a
                                href={item.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 block truncate text-xs text-cyan-200 underline-offset-4 hover:underline"
                              >
                                {item.source_label || item.source_url}
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </ControlPanel>

                      <ControlPanel
                        icon={Activity}
                        title="Tasks"
                        empty="No active Ranger tasks."
                      >
                        {applicantTasks.map((task) => (
                          <div
                            key={task.id}
                            className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline">{task.task_type}</Badge>
                              <span className="text-muted-foreground text-xs">
                                {task.priority}
                              </span>
                            </div>
                            <p className="mt-2 text-sm">
                              {statusLabel(task.status)}
                            </p>
                            {task.error_message ? (
                              <p className="mt-1 text-xs text-red-200">
                                {task.error_message}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </ControlPanel>

                      <ControlPanel
                        icon={MessageSquare}
                        title="Timeline"
                        empty="No owner decisions yet."
                      >
                        {applicantTimeline.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                          >
                            <p className="font-medium">
                              {statusLabel(item.label)}
                            </p>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {item.detail}
                            </p>
                            <p className="text-muted-foreground mt-2 text-[11px]">
                              {formatDate(item.at)}
                            </p>
                          </div>
                        ))}
                      </ControlPanel>
                    </div>

                    {recentMessages.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        <p className="text-muted-foreground text-xs font-semibold uppercase">
                          Recent messages
                        </p>
                        {recentMessages.map((message) => (
                          <div
                            key={message.id}
                            className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                              <Badge variant="outline">{message.channel}</Badge>
                              <span className="text-muted-foreground">
                                {message.direction} · {message.status}
                              </span>
                            </div>
                            <p className="line-clamp-3 whitespace-pre-wrap">
                              {message.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card className="border-cyan-500/20 bg-cyan-500/5 p-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Moon className="h-4 w-4 text-cyan-300" />
              Ranger Playbook
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              <PlaybookLine
                icon={Car}
                text="Reliable transportation and valid driver’s license are hard requirements."
              />
              <PlaybookLine
                icon={Moon}
                text="Nighttime commercial jobs and every Saturday are hard requirements."
              />
              <PlaybookLine
                icon={ShieldCheck}
                text="Candidate Reports prioritize practical fit, reliability, trust, and sourced concerns."
              />
              <PlaybookLine
                icon={Bot}
                text="Routine screening can be drafted automatically; sensitive decisions need approval."
              />
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-lg font-semibold">Default Screening Draft</h2>
            <pre className="mt-3 max-h-[520px] overflow-auto rounded-lg bg-black/30 p-3 text-xs whitespace-pre-wrap">
              {buildRangerScreeningDraft()}
            </pre>
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
}) {
  return (
    <Card className="border-border/60 bg-card/80 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-muted-foreground text-xs uppercase">{label}</div>
        <Icon className="h-4 w-4 text-emerald-300" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </Card>
  )
}

function ActionButton({
  icon: Icon,
  label,
  running,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  running: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={running}
      onClick={onClick}
      className="border-white/10 bg-white/[0.03]"
    >
      {running ? (
        <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="mr-2 h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  )
}

function ControlPanel({
  icon: Icon,
  title,
  empty,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  empty: string
  children: ReactNode
}) {
  const items = Children.toArray(children).filter(Boolean)

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-cyan-300" />
        {title}
      </p>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items
        ) : (
          <p className="text-muted-foreground text-sm">{empty}</p>
        )}
      </div>
    </div>
  )
}

function PlaybookLine({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>
  text: string
}) {
  return (
    <div className="flex gap-2">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
      <p className="text-muted-foreground">{text}</p>
    </div>
  )
}
