import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeLeadSource } from '@/lib/lead-sources'
import { getOperationalSummary } from '@/lib/mcp/operations'
import { isWarrantyAppointment } from '@/lib/ops/warranty-appointment'
import {
  businessDecisionSnapshotSchema,
  type BusinessDecisionSnapshot,
  type DecisionTotals,
} from './business-decision-schema'

const ORIGIN = 'https://sightings.sasquatchcarpet.com'
const DAY = 86_400_000
const FINAL_INVOICE_STATUSES = new Set(['ready', 'pending', 'sent', 'paid'])
type Related<T> = T | T[] | null
export type DecisionJob = {
  id: string
  appointment_date: string
  status: string
  kind: string
  quoted_total: number | string | null
  batch_billing_customer_id?: string | null
  assigned_staff_user_id?: string | null
  parked_at?: string | null
  restoration_project_id?: string | null
  visit_type?: string | null
  service_concern_id?: string | null
  lead_source?: string | null
  lead_source_key?: string | null
  customer: Related<{ is_internal: boolean; billing_mode?: string | null }>
  recurring?: Related<{ invoice_mode: string | null }>
  batch_entries?: Related<{ id: string }>
  ops_appointment_line_items?: Parameters<
    typeof isWarrantyAppointment
  >[0]['ops_appointment_line_items']
  invoices: Related<{
    id: string
    total: number | string | null
    status: string
    payment_status: string | null
  }>
}
type QueueInput = Awaited<
  ReturnType<typeof getOperationalSummary>
>['queues'][number]
const one = <T>(v: Related<T> | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
// PostgREST embeds one-to-one relations as objects and one-to-many as arrays.
const many = <T>(v: Related<T> | undefined): T[] =>
  Array.isArray(v) ? v : v ? [v] : []
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const money = (v: number) =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })

export function decisionPeriods(
  now = new Date(),
): BusinessDecisionSnapshot['periods'] {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const day = new Date(`${today}T12:00:00Z`).getUTCDay()
  const monday = addDays(today, -((day + 6) % 7))
  return {
    last_week: { start: addDays(monday, -7), end: addDays(monday, -1) },
    current: { start: addDays(monday, -28), end: addDays(monday, -1) },
    previous: { start: addDays(monday, -56), end: addDays(monday, -29) },
    upcoming: { start: today, end: addDays(today, 6) },
  }
}
const within = (date: string, window: { start: string; end: string }) =>
  date >= window.start && date <= window.end
function emptyTotals(): DecisionTotals {
  return {
    completed_visits: 0,
    invoice_covered_visits: 0,
    invoiced_value: 0,
    marked_paid_value: 0,
    quoted_value: 0,
    quote_invoice_difference: 0,
    missing_invoice_visits: 0,
    draft_invoice_visits: 0,
    ambiguous_invoice_visits: 0,
    consolidated_billing_visits: 0,
    restoration_visits: 0,
    warranty_visits: 0,
    internal_visits: 0,
  }
}
function excluded(job: DecisionJob): keyof DecisionTotals | null {
  if (one(job.customer)?.is_internal) return 'internal_visits'
  if (
    job.kind === 'restoration' ||
    job.restoration_project_id ||
    job.visit_type
  )
    return 'restoration_visits'
  if (isWarrantyAppointment(job)) return 'warranty_visits'
  if (
    job.batch_billing_customer_id ||
    one(job.customer)?.billing_mode === 'monthly_consolidated' ||
    one(job.recurring)?.invoice_mode === 'batch_monthly' ||
    many(job.batch_entries).length
  )
    return 'consolidated_billing_visits'
  return null
}
function invoiceEvidence(job: DecisionJob) {
  const invoices = many(job.invoices)
  if (!invoices.length)
    return { issue: 'missing_invoice' as const, invoice: null }
  if (invoices.length !== 1)
    return { issue: 'ambiguous_invoice' as const, invoice: null }
  const invoice = invoices[0]
  if (invoice.status === 'draft')
    return { issue: 'draft_invoice' as const, invoice: null }
  if (
    !FINAL_INVOICE_STATUSES.has(invoice.status) ||
    invoice.total === null ||
    !Number.isFinite(Number(invoice.total)) ||
    Number(invoice.total) < 0
  )
    return { issue: 'ambiguous_invoice' as const, invoice: null }
  return { issue: null, invoice }
}
function summarize(
  jobs: DecisionJob[],
  window: { start: string; end: string },
) {
  const result = emptyTotals()
  for (const job of jobs) {
    if (
      job.status !== 'completed' ||
      job.kind === 'estimate' ||
      !within(job.appointment_date, window)
    )
      continue
    const exclusion = excluded(job)
    if (exclusion) {
      result[exclusion]++
      continue
    }
    result.completed_visits++
    result.quoted_value += Number(job.quoted_total ?? 0)
    const evidence = invoiceEvidence(job)
    if (evidence.issue) {
      const field = {
        missing_invoice: 'missing_invoice_visits',
        draft_invoice: 'draft_invoice_visits',
        ambiguous_invoice: 'ambiguous_invoice_visits',
      } as const
      result[field[evidence.issue]]++
      continue
    }
    const invoice = evidence.invoice!
    const value = Number(invoice.total)
    result.invoice_covered_visits++
    result.invoiced_value += value
    if (invoice.status === 'paid' || invoice.payment_status === 'paid')
      result.marked_paid_value += value
    result.quote_invoice_difference += Number(job.quoted_total ?? 0) - value
  }
  for (const key of [
    'invoiced_value',
    'marked_paid_value',
    'quoted_value',
    'quote_invoice_difference',
  ] as const)
    result[key] = round(result[key])
  return result
}
function jobLinks(job: DecisionJob) {
  const links: BusinessDecisionSnapshot['decisions'][number]['links'] = [
    {
      record_id: job.id,
      entity: 'appointment',
      label: `Visit ${job.appointment_date}`,
      url: `${ORIGIN}/admin/operations/appointments/${job.id}`,
    },
  ]
  const invoices = many(job.invoices)
  if (invoices.length === 1)
    links.push({
      label: 'Invoice',
      record_id: invoices[0].id,
      entity: 'invoice',
      url: `${ORIGIN}/admin/operations/invoices/${invoices[0].id}`,
    })
  return links
}
const QUEUES: Record<
  string,
  { label: string; next: string; priority: number }
> = {
  unassigned_jobs: {
    label: 'Unassigned scheduled jobs',
    next: 'Review each job and assign a suitable technician after checking the complete job duration and live calendar.',
    priority: 1,
  },
  service_concerns: {
    label: 'Open service concerns',
    next: 'Read the latest concern and customer history; decide whether staff or the owner needs to respond. Do not infer an unresolved complaint from status alone.',
    priority: 2,
  },
  unanswered_messages: {
    label: 'Unread conversation threads',
    next: 'Read the latest customer and staff messages before deciding whether a reply is still needed. Unread is not the same as unanswered.',
    priority: 3,
  },
  pending_estimates: {
    label: 'Draft or sent estimates',
    next: 'Check estimate status and the latest contact history. Finish a draft or plan a follow-up only when the record supports it.',
    priority: 4,
  },
  unpaid_invoices: {
    label: 'Invoices needing payment-status review',
    next: 'Review payment evidence, due dates and billing arrangements before following up. This queue can include waived or zero-value records; its count does not mean these invoices are overdue.',
    priority: 5,
  },
  overdue_followups: {
    label: 'Due customer-requested reminders',
    next: 'Check the requested reminder and recent contact history before planning the next action.',
    priority: 6,
  },
  failed_notifications: {
    label: 'Failed notification records',
    next: 'Check provider outcome and later delivery attempts before retrying; never duplicate an uncertain send.',
    priority: 7,
  },
  missed_calls: {
    label: 'Voicemail or missed-call records',
    next: 'Check the full call, text and email history for prior handling before deciding whether follow-up is needed.',
    priority: 8,
  },
}

export function buildBusinessDecisionSnapshot(input: {
  jobs: DecisionJob[] | null
  queues: QueueInput[]
  missing?: string[]
  now?: Date
}): BusinessDecisionSnapshot {
  const now = input.now ?? new Date()
  const periods = decisionPeriods(now)
  const missing = [...(input.missing ?? [])]
  const unclassified = (input.jobs ?? []).filter(
    (j) =>
      !one(j.customer) &&
      j.kind !== 'estimate' &&
      !['cancelled'].includes(j.status),
  )
  const jobs = unclassified.length ? null : input.jobs
  if (unclassified.length)
    missing.push(
      `${unclassified.length} visits have no customer classification; monetary and upcoming totals are unavailable.`,
    )
  const performance = jobs
    ? {
        last_week: summarize(jobs, periods.last_week),
        current: summarize(jobs, periods.current),
        previous: summarize(jobs, periods.previous),
        invoiced_value_change: null as number | null,
        invoiced_value_change_pct: null as number | null,
      }
    : null
  if (performance) {
    for (const period of ['current', 'previous'] as const) {
      const total = performance[period]
      if (total.invoice_covered_visits < total.completed_visits)
        missing.push(
          `${period} four-week invoice coverage: ${total.invoice_covered_visits} of ${total.completed_visits} ordinary completed visits.`,
        )
    }
    // Only compare complete, identically defined per-visit invoice cohorts.
    const comparable = [performance.current, performance.previous].every(
      (p) => p.completed_visits === p.invoice_covered_visits,
    )
    if (comparable) {
      performance.invoiced_value_change = round(
        performance.current.invoiced_value -
          performance.previous.invoiced_value,
      )
      if (performance.previous.invoiced_value > 0)
        performance.invoiced_value_change_pct = round(
          (performance.invoiced_value_change /
            performance.previous.invoiced_value) *
            100,
        )
    }
  }
  const eligible = (jobs ?? []).filter(
    (j) => j.status === 'completed' && j.kind !== 'estimate' && !excluded(j),
  )
  const sourceMap = new Map<
    string,
    BusinessDecisionSnapshot['lead_sources'][number]
  >()
  for (const job of eligible) {
    if (
      !within(job.appointment_date, periods.current) &&
      !within(job.appointment_date, periods.previous)
    )
      continue
    const raw = job.lead_source_key?.trim() || job.lead_source?.trim()
    const source = raw ? normalizeLeadSource(raw) : null
    const key = source?.source_key ?? 'unknown'
    const row = sourceMap.get(key) ?? {
      key,
      label: source?.customer_label ?? 'Not recorded',
      completed_visits: 0,
      invoice_covered_visits: 0,
      invoiced_value: 0,
      previous_completed_visits: 0,
      previous_invoice_covered_visits: 0,
      previous_invoiced_value: 0,
      links: [],
    }
    const invoice = invoiceEvidence(job).invoice
    if (within(job.appointment_date, periods.current)) {
      row.completed_visits++
      if (invoice) {
        row.invoice_covered_visits++
        row.invoiced_value += Number(invoice.total)
      }
      if (row.links.length < 3) row.links.push(...jobLinks(job).slice(0, 1))
    } else {
      row.previous_completed_visits++
      if (invoice) {
        row.previous_invoice_covered_visits++
        row.previous_invoiced_value += Number(invoice.total)
      }
    }
    sourceMap.set(key, row)
  }
  const lead_sources = [...sourceMap.values()]
    .map((r) => ({
      ...r,
      invoiced_value: round(r.invoiced_value),
      previous_invoiced_value: round(r.previous_invoiced_value),
    }))
    .sort(
      (a, b) =>
        b.invoiced_value - a.invoiced_value || a.label.localeCompare(b.label),
    )
  const future = (jobs ?? []).filter(
    (j) =>
      within(j.appointment_date, periods.upcoming) &&
      !['completed', 'cancelled'].includes(j.status) &&
      j.kind === 'service' &&
      !j.parked_at &&
      !excluded(j),
  )
  const upcoming = jobs
    ? {
        scheduled_visits: future.length,
        quoted_value: round(
          future.reduce((s, j) => s + Number(j.quoted_total ?? 0), 0),
        ),
        unassigned_visits: future.filter((j) => !j.assigned_staff_user_id)
          .length,
        note: 'Scheduled per-visit service work for the next seven calendar dates. Quotes are not earned revenue, and booked totals do not measure remaining availability. Recheck the live calendar for a specific job duration.',
      }
    : null
  const queues: BusinessDecisionSnapshot['queues'] = input.queues
    .filter((q) => QUEUES[q.name])
    .map((q) => {
      if (q.status !== 'available') missing.push(`${q.name}: ${q.status}`)
      return {
        name: q.name,
        label: QUEUES[q.name].label,
        count: q.count,
        status: q.status,
        window: q.window,
        note: q.note,
        links: q.items
          .filter((item) => typeof item.app_url === 'string')
          .map((item) => ({
            label:
              typeof item.invoice_number === 'number' ||
              typeof item.invoice_number === 'string'
                ? `Invoice ${item.invoice_number}`
                : `${QUEUES[q.name].label} ${String(item.id).slice(0, 8)}`,
            record_id: String(item.id),
            ...(typeof item.customer_id === 'string'
              ? { customer_id: item.customer_id }
              : {}),
            ...(typeof item.appointment_id === 'string'
              ? { appointment_id: item.appointment_id }
              : {}),
            ...(typeof item.status === 'string' ? { status: item.status } : {}),
            ...([item.updated_at, item.sent_at, item.created_at].some(
              (value) => typeof value === 'string',
            )
              ? {
                  updated_at: [
                    item.updated_at,
                    item.sent_at,
                    item.created_at,
                  ].find((value) => typeof value === 'string') as string,
                }
              : {}),
            entity: {
              unanswered_messages: 'conversation',
              missed_calls: 'call',
              pending_estimates: 'estimate',
              unassigned_jobs: 'appointment',
              failed_notifications: 'notification',
              service_concerns: 'service_concern',
              overdue_followups: 'cleaning_reminder',
              unpaid_invoices: 'invoice',
              scheduling_conflicts: 'appointment',
            }[q.name],
            url:
              q.name === 'unanswered_messages' &&
              typeof item.phone === 'string' &&
              /^\+?\d{7,15}$/.test(item.phone)
                ? `${ORIGIN}/admin/conversations?phone=${encodeURIComponent(item.phone)}`
                : String(item.app_url),
          })),
      }
    })
  const decisions: BusinessDecisionSnapshot['decisions'] = queues
    .filter(
      (q) => q.status !== 'unavailable' && q.count !== null && q.count > 0,
    )
    .sort((a, b) => QUEUES[a.name].priority - QUEUES[b.name].priority)
    .slice(0, 3)
    .map((q) => {
      const links = q.links.slice(0, 3)
      const timestamps = links
        .map((l) => Date.parse(l.updated_at ?? ''))
        .filter(Number.isFinite)
      const latest = timestamps.length
        ? new Date(Math.max(...timestamps)).toLocaleDateString('en-CA', {
            timeZone: 'America/Denver',
          })
        : null
      return {
        id: q.name,
        title: `Review ${q.label.toLowerCase()}`,
        evidence: `${q.status === 'partial' ? 'At least ' : ''}${q.count} records. ${q.window}${latest ? ` Most recent linked record: ${latest}.` : ''}`,
        next_step: QUEUES[q.name].next,
        links,
      }
    })
  const reconciliation: BusinessDecisionSnapshot['reconciliation'] = []
  for (const job of eligible.filter((j) =>
    within(j.appointment_date, periods.current),
  )) {
    const evidence = invoiceEvidence(job)
    const quote = Number(job.quoted_total ?? 0)
    const invoice = evidence.invoice ? Number(evidence.invoice.total) : null
    const issue =
      evidence.issue ??
      (invoice !== null && Math.abs(quote - invoice) > 0.009
        ? 'quote_difference'
        : null)
    if (issue)
      reconciliation.push({
        appointment_id: job.id,
        date: job.appointment_date,
        issue,
        quote,
        invoice,
        links: jobLinks(job),
      })
  }
  const incomplete =
    performance &&
    [performance.current, performance.previous].some(
      (p) => p.invoice_covered_visits < p.completed_visits,
    )
  if (incomplete && performance) {
    // Imminent scheduling and service issues stay ahead of historical bookkeeping.
    const priorityIndex = decisions.findIndex(
      (d) => !['unassigned_jobs', 'service_concerns'].includes(d.id),
    )
    decisions.splice(priorityIndex < 0 ? decisions.length : priorityIndex, 0, {
      id: 'invoice_coverage',
      title: 'Reconcile completed visits before comparing sales',
      evidence: `Current four weeks: ${performance.current.invoice_covered_visits} of ${performance.current.completed_visits} ordinary completed visits have one final per-visit invoice. Previous four weeks: ${performance.previous.invoice_covered_visits} of ${performance.previous.completed_visits}. A sales comparison is withheld until both cohorts have complete invoice coverage.`,
      next_step:
        'Review the linked visits and billing records. Missing coverage is not proof that a customer owes money; do not replace missing invoices with quotes.',
      links: eligible
        .filter(
          (j) =>
            (within(j.appointment_date, periods.current) ||
              within(j.appointment_date, periods.previous)) &&
            invoiceEvidence(j).issue,
        )
        .slice(0, 3)
        .flatMap((j) => jobLinks(j).slice(0, 1)),
    })
  }
  // A price/mix signal, not a claim about demand, profit or available capacity.
  if (
    performance?.invoiced_value_change !== null &&
    performance &&
    performance.current.completed_visits > 0 &&
    performance.previous.completed_visits > 0
  ) {
    const current = performance.current
    const previous = performance.previous
    const visitChange = current.completed_visits - previous.completed_visits
    if (visitChange * performance.invoiced_value_change < 0) {
      const insertAt = decisions.findIndex(
        (d) =>
          !['unassigned_jobs', 'service_concerns', 'invoice_coverage'].includes(
            d.id,
          ),
      )
      decisions.splice(insertAt < 0 ? decisions.length : insertAt, 0, {
        id: 'volume_value_mix',
        title:
          visitChange < 0
            ? 'Fewer visits, higher average invoice'
            : 'More visits, lower average invoice',
        evidence: `${current.completed_visits} completed visits versus ${previous.completed_visits}; ${money(current.invoiced_value)} invoiced versus ${money(previous.invoiced_value)}. Average covered invoice: ${money(current.invoiced_value / current.completed_visits)} versus ${money(previous.invoiced_value / previous.completed_visits)} across equal four-week periods.`,
        next_step:
          'Compare the service mix and recorded lead-source counts, starting with the linked larger visits. Decide whether the higher-value work is repeatable before changing pricing or advertising. These figures do not measure profit or remaining capacity.',
        links: eligible
          .filter((j) => within(j.appointment_date, periods.current))
          .sort(
            (a, b) =>
              Number(invoiceEvidence(b).invoice?.total ?? 0) -
              Number(invoiceEvidence(a).invoice?.total ?? 0),
          )
          .slice(0, 3)
          .flatMap((j) => jobLinks(j).slice(0, 1)),
      })
    }
  }
  // A compact measured finding, not a claim of ROI or instruction to spend.
  if (decisions.length < 3 && lead_sources.some((s) => s.completed_visits)) {
    const leader = lead_sources
      .filter(
        (s) =>
          s.completed_visits &&
          !['other', 'unknown', 'repeat_customer'].includes(s.key),
      )
      .sort((a, b) => b.completed_visits - a.completed_visits)[0]
    if (leader)
      decisions.push({
        id: 'source_evidence',
        title: `${leader.label} is a leading recorded acquisition source`,
        evidence: `${leader.completed_visits} completed per-visit jobs and ${money(leader.invoiced_value)} in covered invoice totals over four completed weeks.`,
        next_step:
          'Inspect the linked jobs and source details, then match campaign spending over a comparable period before changing a budget. Recorded source labels do not establish causal return on ad spend.',
        links: leader.links,
      })
  }
  return businessDecisionSnapshotSchema.parse({
    version: '1',
    generated_at: now.toISOString(),
    timezone: 'America/Denver',
    currency: 'USD',
    read_only: true,
    coverage: {
      status: missing.length ? 'partial' : 'complete',
      missing: [...new Set(missing)],
      definitions: [
        'Performance uses appointment service dates in America/Denver: last completed Monday–Sunday and four completed weeks versus the preceding four. The current partial week is excluded.',
        'Invoiced value is one ready/pending/sent/paid invoice header total per ordinary completed visit, including tax and valid $0 totals. Quotes, drafts, missing or multiple invoices never substitute for this amount.',
        'Marked paid means invoice status or payment_status says paid now. It is not cash collected in the reporting period, net profit, or bank reconciliation.',
        'Internal jobs, estimates, warranty returns, restoration/project visits and consolidated billing are excluded from per-visit monetary totals and counted separately where applicable. This is not total company revenue.',
        'Lead sources are recorded labels on completed visits, not new-lead conversion rates, causal attribution or ROI. Repeat customers and missing source labels remain separate.',
        'Queue counts are review candidates, not proof that a response is owed or payment overdue. Each queue has its own window and cap. No message is sent, record changed, or calendar slot reserved.',
        'Record links are bounded previews: up to three per source/decision and twenty reconciliation examples. A quote/invoice difference can be a valid discount or on-site scope change.',
      ],
    },
    periods,
    performance,
    lead_sources,
    upcoming,
    decisions: decisions.slice(0, 3),
    queues,
    reconciliation: reconciliation.slice(0, 20),
  })
}

/** Read-only, bounded, ordered pagination. Fail closed instead of reporting a partial sum as a total. */
export async function loadBusinessDecisionSnapshot(
  db: SupabaseClient,
  now = new Date(),
): Promise<BusinessDecisionSnapshot> {
  const periods = decisionPeriods(now)
  const missing: string[] = []
  const jobsTask = (async () => {
    const rows: DecisionJob[] = []
    for (let from = 0; from < 10000; from += 500) {
      const { data, error } = await db
        .from('ops_appointments')
        .select(
          `id, appointment_date, status, kind, quoted_total, batch_billing_customer_id, assigned_staff_user_id, parked_at, restoration_project_id, visit_type, service_concern_id, lead_source, lead_source_key,
        customer:ops_customers!ops_appointments_customer_id_fkey(is_internal,billing_mode),
        recurring:ops_recurring_templates(invoice_mode), batch_entries:ops_batch_invoice_entries(id),
        ops_appointment_line_items(name_snapshot,service_catalog_items(slug)),
        invoices:ops_invoices(id,total,status,payment_status)`,
        )
        .gte('appointment_date', periods.previous.start)
        .lte('appointment_date', periods.upcoming.end)
        .order('appointment_date')
        .order('id')
        .range(from, from + 499)
      if (error) throw error
      rows.push(...((data ?? []) as unknown as DecisionJob[]))
      if (!data || data.length < 500) return rows
    }
    throw new Error('Appointment reporting bound exceeded')
  })().catch((error) => {
    console.error('[business-decisions] appointments unavailable', error)
    missing.push(
      'Completed and upcoming work unavailable; no totals were inferred.',
    )
    return null
  })
  const queuesTask = getOperationalSummary({ days: 7, item_limit: 5 }, db, now)
    .then((r) => r.queues)
    .catch((error) => {
      console.error('[business-decisions] queues unavailable', error)
      missing.push('Operational attention queues unavailable.')
      return [] as QueueInput[]
    })
  const [jobs, queues] = await Promise.all([jobsTask, queuesTask])
  return buildBusinessDecisionSnapshot({ jobs, queues, missing, now })
}
