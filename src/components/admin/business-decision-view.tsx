'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import {
  businessDecisionSnapshotSchema,
  type BusinessDecisionSnapshot,
  type DecisionTotals,
} from '@/lib/ops/business-decision-schema'

const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const invoiceValue = (value: number, completed: number, covered: number) =>
  completed > 0 && covered === 0
    ? 'Unavailable (no invoice coverage)'
    : money(value)
const totalValue = (totals: DecisionTotals) =>
  invoiceValue(
    totals.invoiced_value,
    totals.completed_visits,
    totals.invoice_covered_visits,
  )
const date = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
const period = (value: { start: string; end: string }) =>
  `${date(value.start)} – ${date(value.end)}`
const captured = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    timeZoneName: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
const panel = 'rounded-2xl border border-white/10 bg-slate-950/70 p-5 sm:p-6'

type EvidenceLink =
  BusinessDecisionSnapshot['decisions'][number]['links'][number]
function RecordLinks({ links }: { links: EvidenceLink[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
      {links
        .filter((link) =>
          link.url.startsWith('https://sightings.sasquatchcarpet.com/'),
        )
        .map((link, index) => (
          <a
            key={`${link.url}-${index}`}
            href={link.url}
            className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-emerald-300 underline-offset-4 hover:underline"
          >
            {link.label}
            <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
          </a>
        ))}
    </div>
  )
}

function Coverage({ totals }: { totals: DecisionTotals }) {
  return (
    <p className="mt-2 text-xs leading-5 text-slate-400">
      {totals.invoice_covered_visits} of {totals.completed_visits} eligible
      completed visits covered.
      {totals.consolidated_billing_visits > 0 &&
        ` ${totals.consolidated_billing_visits} consolidated-billing visits separate.`}
      {totals.restoration_visits > 0 &&
        ` ${totals.restoration_visits} restoration visits separate.`}
    </p>
  )
}

export function DecisionSnapshotContent({
  data,
}: {
  data: BusinessDecisionSnapshot
}) {
  const performance = data.performance
  const delta = performance?.invoiced_value_change_pct
  return (
    <div className="space-y-6">
      {data.coverage.status === 'partial' && (
        <div
          role="status"
          className="rounded-xl border border-amber-400/25 bg-amber-950/25 px-4 py-3 text-sm text-amber-100"
        >
          <strong>Partial coverage.</strong> Some sources or invoices are
          missing. Totals below cover only the records available; review the
          coverage details before comparing.
        </div>
      )}

      <section aria-labelledby="decisions-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="decisions-heading"
            className="text-lg font-semibold text-white"
          >
            What needs a decision
          </h2>
          <span className="text-xs text-slate-400">
            Review records before taking action
          </span>
        </div>
        {data.decisions.length ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {data.decisions.slice(0, 3).map((decision, index) => (
              <article
                key={decision.id}
                className={`${panel} border-emerald-400/20`}
              >
                <p className="mb-3 text-xs font-semibold tracking-widest text-emerald-400">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <h3 className="text-base leading-6 font-semibold text-white">
                  {decision.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {decision.evidence}
                </p>
                <p className="mt-3 border-t border-white/10 pt-3 text-sm leading-6 text-white">
                  <span className="font-semibold text-emerald-300">Next: </span>
                  {decision.next_step}
                </p>
                <RecordLinks links={decision.links} />
              </article>
            ))}
          </div>
        ) : (
          <div className={panel}>
            <p className="text-sm text-slate-300">
              No decision items returned from the checked sources. This is not a
              guarantee that every part of the business is clear.
            </p>
          </div>
        )}
      </section>

      <section
        aria-label="Business snapshot"
        className="grid gap-3 lg:grid-cols-3"
      >
        <article className={panel}>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
            Last completed week
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {period(data.periods.last_week)}
          </p>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-white">
            {performance ? totalValue(performance.last_week) : 'Unavailable'}
          </p>
          <p className="mt-1 text-sm text-slate-300">Per-visit invoice value</p>
          {performance && <Coverage totals={performance.last_week} />}
        </article>
        <article className={panel}>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
            Last 4 completed weeks
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {period(data.periods.current)}
          </p>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-white">
            {performance ? totalValue(performance.current) : 'Unavailable'}
          </p>
          {performance && (
            <>
              <p className="mt-1 text-sm text-slate-300">
                {delta == null
                  ? 'Comparable change unavailable'
                  : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}% versus previous 4 weeks`}
              </p>
              <Coverage totals={performance.current} />
              <p className="mt-3 text-xs leading-5 text-slate-400">
                Previous: {totalValue(performance.previous)} ·{' '}
                {period(data.periods.previous)} ·{' '}
                {performance.previous.invoice_covered_visits}/
                {performance.previous.completed_visits} visits covered
              </p>
            </>
          )}
        </article>
        <article className={panel}>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
            Booked next 7 days
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {period(data.periods.upcoming)}
          </p>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-white">
            {data.upcoming
              ? `${data.upcoming.scheduled_visits} visits`
              : 'Unavailable'}
          </p>
          {data.upcoming && (
            <>
              <p className="mt-1 text-sm text-slate-300">
                {money(data.upcoming.quoted_value)} quoted ·{' '}
                {data.upcoming.unassigned_visits} unassigned
              </p>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                {data.upcoming.note}
              </p>
            </>
          )}
        </article>
      </section>
      <p className="-mt-2 text-xs leading-5 text-slate-400">
        Invoice value is not company-wide revenue, profit, or cash received in
        this period. Consolidated billing and restoration are kept separate.
      </p>

      <section className={panel} aria-labelledby="sources-heading">
        <h2 id="sources-heading" className="text-lg font-semibold text-white">
          Where completed work came from
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Recorded lead-source labels, not proof of advertising return. Compare
          the same 4-week windows above.
        </p>
        {data.lead_sources.length ? (
          <div className="mt-5 divide-y divide-white/10">
            {data.lead_sources.map((source) => (
              <article
                key={source.key}
                className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_1fr_1fr]"
              >
                <div>
                  <h3 className="font-medium text-white">{source.label}</h3>
                  <RecordLinks links={source.links} />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Current 4 weeks</p>
                  <p className="mt-1 font-medium text-white">
                    {source.completed_visits} visits ·{' '}
                    {invoiceValue(
                      source.invoiced_value,
                      source.completed_visits,
                      source.invoice_covered_visits,
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {source.invoice_covered_visits}/{source.completed_visits}{' '}
                    visits invoice-covered
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Previous 4 weeks</p>
                  <p className="mt-1 font-medium text-slate-300">
                    {source.previous_completed_visits} visits ·{' '}
                    {invoiceValue(
                      source.previous_invoiced_value,
                      source.previous_completed_visits,
                      source.previous_invoice_covered_visits,
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {source.previous_invoice_covered_visits}/
                    {source.previous_completed_visits} visits invoice-covered
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            {performance
              ? 'No recorded source rows in these periods.'
              : 'Lead-source comparison unavailable.'}
          </p>
        )}
      </section>

      <details className={panel}>
        <summary className="cursor-pointer text-base font-semibold text-white">
          Coverage, definitions and record checks
        </summary>
        <div className="mt-5 space-y-6 text-sm leading-6 text-slate-300">
          {data.coverage.missing.length > 0 && (
            <section>
              <h3 className="font-semibold text-amber-200">Coverage limits</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {data.coverage.missing.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="font-semibold text-white">
              What these numbers mean
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.coverage.definitions.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </section>
          {performance && (
            <section>
              <h3 className="font-semibold text-white">
                Last 4 weeks: separated from invoice totals
              </h3>
              <p className="mt-2">
                {performance.current.consolidated_billing_visits} consolidated
                billing · {performance.current.restoration_visits} restoration ·{' '}
                {performance.current.warranty_visits} warranty ·{' '}
                {performance.current.internal_visits} internal visits
              </p>
              <p>
                {performance.current.missing_invoice_visits} missing invoice ·{' '}
                {performance.current.draft_invoice_visits} draft invoice ·{' '}
                {performance.current.ambiguous_invoice_visits} ambiguous invoice
              </p>
              <p>
                Quote minus invoice value on covered visits:{' '}
                {money(performance.current.quote_invoice_difference)}. A
                difference can be an expected price change, not an unpaid
                balance.
              </p>
              <p>
                Invoices marked paid:{' '}
                {money(performance.current.marked_paid_value)}. This is a status
                total, not payment-date cash flow.
              </p>
            </section>
          )}
          {data.reconciliation.length > 0 && (
            <section>
              <h3 className="font-semibold text-white">Record checks</h3>
              <div className="mt-2 divide-y divide-white/10">
                {data.reconciliation.map((row, i) => (
                  <article key={`${row.appointment_id}-${i}`} className="py-3">
                    <p className="font-medium text-white">
                      {date(row.date)} · {row.issue.replaceAll('_', ' ')}
                    </p>
                    <p>
                      Quote {money(row.quote)} · invoice{' '}
                      {row.invoice == null
                        ? 'not established'
                        : money(row.invoice)}
                    </p>
                    <RecordLinks links={row.links} />
                  </article>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3 className="font-semibold text-white">
              Operational queue scope
            </h3>
            <div className="mt-2 divide-y divide-white/10">
              {data.queues.map((queue) => (
                <article key={queue.name} className="py-3">
                  <p className="font-medium text-white">
                    {queue.label}:{' '}
                    {queue.count == null
                      ? 'unavailable'
                      : `${queue.count}${queue.status === 'partial' ? '+' : ''}`}
                  </p>
                  <p className="text-xs text-slate-400">{queue.window}</p>
                  {queue.note && (
                    <p className="mt-1 text-xs text-slate-400">{queue.note}</p>
                  )}
                  <RecordLinks links={queue.links} />
                </article>
              ))}
            </div>
          </section>
        </div>
      </details>
    </div>
  )
}

export function BusinessDecisionView() {
  const [data, setData] = useState<BusinessDecisionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const currentRequest = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    const id = ++currentRequest.current
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setLoading(true)
    setError(false)
    try {
      const response = await fetch('/api/admin/stats/business-decisions', {
        cache: 'no-store',
        signal: next.signal,
      })
      if (!response.ok) throw new Error('Snapshot unavailable')
      const parsed = businessDecisionSnapshotSchema.parse(await response.json())
      if (id === currentRequest.current) setData(parsed)
    } catch {
      if (id === currentRequest.current && !next.signal.aborted) setError(true)
    } finally {
      if (id === currentRequest.current) setLoading(false)
    }
  }, [])
  const cancel = useCallback(() => {
    currentRequest.current++
    controller.current?.abort()
  }, [])
  useEffect(() => {
    void load()
    return cancel
  }, [load, cancel])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header
        className={`${panel} relative overflow-hidden bg-gradient-to-br from-emerald-950/60 via-slate-950/90 to-slate-900/80`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">
              Owner workspace
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Business decisions
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              What needs attention, what completed work is worth, and where it
              came from.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-400">
          Read-only · Weekly Telegram briefing off
          {data ? ` · Snapshot ${captured(data.generated_at)}` : ''}
        </p>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-amber-400/30 bg-amber-950/30 p-4 text-sm text-amber-100"
        >
          Could not refresh the business snapshot.
          {data
            ? ` Showing the previous snapshot from ${captured(data.generated_at)}. It may be out of date.`
            : ' No business totals are available.'}{' '}
          Try Refresh again.
        </div>
      )}
      {loading && !data && (
        <p role="status" className="p-6 text-sm text-slate-300">
          Loading source-backed decisions…
        </p>
      )}
      {data && <DecisionSnapshotContent data={data} />}
    </div>
  )
}
