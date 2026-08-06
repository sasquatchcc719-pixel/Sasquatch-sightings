'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { LsaSpendEntry } from './LsaSpendEntry'

type ThreadMessage = { role?: string; content?: string; timestamp?: string }

type BookedJob = {
  id: string
  date: string
  status: string
  revenue: number
  customer: string
  source?: string
}

type Thread = {
  id: string
  phone: string
  startedAt: string
  lastActivityAt: string
  messageCount: number
  inboundCount: number
  outboundCount: number
  status: 'never_answered' | 'ghosted' | 'engaged'
  preview: string
  messages: ThreadMessage[]
  identifiedAs: string | null
  bookedJob: BookedJob | null
}

type LedgerRow = {
  date: string
  leads: number
  cost: number
  credits: number
  costPerLead: number | null
  matchConfidence: 'exact' | 'likely' | 'none'
  matches: {
    threadId: string
    phone: string
    status: string
    identifiedAs: string | null
    bookedJob: BookedJob | null
  }[]
}

type Response = {
  days: number
  since: string
  summary: {
    spend: number
    credits: number
    leads: number
    costPerLead: number | null
    jobs: number
    revenue: number
    roas: number | null
    costPerJob: number | null
    ghosted: number
    neverAnswered: number
  }
  ledger: LedgerRow[]
  threads: Thread[]
  jobs: BookedJob[]
  notes: { unmatchedCharges: number }
}

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  engaged: {
    label: 'Talking',
    className: 'bg-emerald-500/15 text-emerald-300',
  },
  ghosted: {
    label: 'They went quiet',
    className: 'bg-amber-500/15 text-amber-300',
  },
  never_answered: {
    label: 'You never replied',
    className: 'bg-red-500/15 text-red-300',
  },
}

function money(n: number, cents = false): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents ? 2 : 0,
  })
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function prettyPhone(value: string): string {
  const d = (value || '').replace(/\D/g, '').slice(-10)
  return d.length === 10
    ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    : value
}

async function fetchLsa(days: number): Promise<Response> {
  const res = await fetch(`/api/admin/marketing/lsa?days=${days}`)
  if (!res.ok) throw new Error('Failed to load LSA dashboard')
  return res.json()
}

export function LsaDashboardView() {
  const [days, setDays] = useState(90)
  const [openThread, setOpenThread] = useState<string | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['lsa-dashboard', days],
    queryFn: () => fetchLsa(days),
  })

  return (
    <div className="space-y-5">
      <LsaSpendEntry onSaved={() => refetch()} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-white/10 bg-slate-900/50 p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-md px-3 py-1 text-sm ${
                days === r.days
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {data ? (
          <span className="text-xs text-slate-500">since {data.since}</span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : error || !data ? (
        <p className="text-sm text-red-300">Could not load the numbers.</p>
      ) : (
        <>
          {/* ── Is it worth it ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Spent', value: money(data.summary.spend) },
              {
                label: 'Cost per lead',
                value:
                  data.summary.costPerLead === null
                    ? '—'
                    : money(data.summary.costPerLead, true),
                sub: `${data.summary.leads} leads`,
              },
              {
                label: 'Cost per job',
                value:
                  data.summary.costPerJob === null
                    ? '—'
                    : money(data.summary.costPerJob, true),
                sub: `${data.summary.jobs} booked`,
              },
              {
                label: 'Made back',
                value: money(data.summary.revenue),
                sub:
                  data.summary.roas === null
                    ? undefined
                    : `${data.summary.roas}x return`,
                good: (data.summary.roas || 0) >= 2,
              },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2"
              >
                <p className="text-xs text-slate-400">{tile.label}</p>
                <p
                  className={`text-lg font-semibold ${
                    tile.good ? 'text-emerald-300' : 'text-white'
                  }`}
                >
                  {tile.value}
                </p>
                {tile.sub ? (
                  <p className="text-[11px] text-slate-500">{tile.sub}</p>
                ) : null}
              </div>
            ))}
          </div>

          {/* ── Things that need attention ─────────────────────────────── */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2">
              <p className="text-xs text-slate-400">Credits from Google</p>
              <p
                className={`text-lg font-semibold ${
                  data.summary.credits > 0 ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {money(data.summary.credits, true)}
              </p>
              <p className="text-[11px] text-slate-500">
                {data.summary.credits === 0
                  ? 'Google has never credited a lead'
                  : 'Auto-credited by Google'}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2">
              <p className="text-xs text-slate-400">Went quiet on you</p>
              <p className="text-lg font-semibold text-amber-300">
                {data.summary.ghosted}
              </p>
              <p className="text-[11px] text-slate-500">
                Paid for, replied to, no answer back
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2">
              <p className="text-xs text-slate-400">You never replied</p>
              <p
                className={`text-lg font-semibold ${
                  data.summary.neverAnswered > 0
                    ? 'text-red-300'
                    : 'text-emerald-300'
                }`}
              >
                {data.summary.neverAnswered}
              </p>
              <p className="text-[11px] text-slate-500">
                Money spent, nobody answered
              </p>
            </div>
          </div>

          {/* ── Every charge ──────────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              What Google charged you
            </h3>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pl-3 pr-2 text-left font-medium">
                      Date
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Leads</th>
                    <th className="px-2 py-2 text-right font-medium">Cost</th>
                    <th className="px-2 py-2 text-right font-medium">
                      Per lead
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Credit</th>
                    <th className="py-2 pl-2 pr-3 text-left font-medium">
                      Who it was
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((row) => (
                    <tr
                      key={row.date}
                      className="border-b border-white/5 align-top"
                    >
                      <td className="py-2 pl-3 pr-2 text-sm text-white">
                        {shortDate(row.date)}
                      </td>
                      <td className="px-2 py-2 text-right text-sm text-slate-300">
                        {row.leads}
                      </td>
                      <td className="px-2 py-2 text-right text-sm text-white">
                        {money(row.cost, true)}
                      </td>
                      <td className="px-2 py-2 text-right text-sm">
                        <span
                          className={
                            (row.costPerLead || 0) > 75
                              ? 'text-red-300'
                              : 'text-slate-300'
                          }
                        >
                          {row.costPerLead === null
                            ? '—'
                            : money(row.costPerLead, true)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right text-sm text-slate-500">
                        {row.credits > 0 ? money(row.credits, true) : '—'}
                      </td>
                      <td className="py-2 pl-2 pr-3 text-sm">
                        {row.matchConfidence === 'none' ? (
                          <span className="text-slate-500">
                            No text thread — phone lead
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {row.matches.map((m) => (
                              <div key={m.threadId}>
                                <button
                                  type="button"
                                  onClick={() => setOpenThread(m.threadId)}
                                  className="text-emerald-300 hover:underline"
                                >
                                  {m.identifiedAs || prettyPhone(m.phone)}
                                </button>
                                {m.bookedJob ? (
                                  <>
                                    <span className="ml-2 text-emerald-400">
                                      → {money(m.bookedJob.revenue)} job
                                    </span>
                                    {m.bookedJob.source &&
                                    m.bookedJob.source !== 'google_lsa' ? (
                                      <span
                                        className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-red-300"
                                        title="Google charged you for a lead your system booked as existing business"
                                      >
                                        already your customer
                                      </span>
                                    ) : null}
                                  </>
                                ) : null}
                              </div>
                            ))}
                            {row.matchConfidence === 'likely' ? (
                              <span className="text-[11px] text-slate-500">
                                more than one lead this day
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              Google never says which lead it charged for — only a date, a count
              and a price. Anything in the last column is matched by date, so
              treat &ldquo;best guess&rdquo; rows as exactly that.
            </p>
          </section>

          {/* ── Message center ────────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              Conversations ({data.threads.length})
            </h3>
            <div className="space-y-2">
              {data.threads.map((t) => {
                const style = STATUS_STYLES[t.status]
                const isOpen = openThread === t.id
                return (
                  <div
                    key={t.id}
                    className="rounded-xl border border-white/10 bg-slate-900/40"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenThread(isOpen ? null : t.id)}
                      className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
                    >
                      <span className="text-sm font-medium text-white">
                        {t.identifiedAs || prettyPhone(t.phone)}
                      </span>
                      {t.identifiedAs ? null : (
                        <span
                          className="text-[10px] text-slate-500"
                          title="Google relay number — the customer never gave us theirs"
                        >
                          unidentified
                        </span>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${style.className}`}
                      >
                        {style.label}
                      </span>
                      {t.bookedJob ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                          booked {money(t.bookedJob.revenue)}
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-slate-500">
                        {shortDate(t.startedAt)} · {t.messageCount} msgs
                      </span>
                    </button>
                    {!isOpen && t.preview ? (
                      <p className="px-3 pb-2 text-xs text-slate-400">
                        {t.preview}
                      </p>
                    ) : null}
                    {isOpen ? (
                      <div className="space-y-2 border-t border-white/10 px-3 py-3">
                        {t.messages.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            No messages stored.
                          </p>
                        ) : (
                          t.messages.map((m, i) => {
                            const mine = m.role === 'assistant'
                            return (
                              <div
                                key={i}
                                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                              >
                                <div
                                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                                    mine
                                      ? 'bg-emerald-800/60 text-white'
                                      : 'bg-slate-800/80 text-slate-200'
                                  }`}
                                >
                                  <p className="whitespace-pre-wrap">
                                    {m.content}
                                  </p>
                                  {m.timestamp ? (
                                    <p className="mt-1 text-[10px] text-slate-400">
                                      {new Date(
                                        m.timestamp,
                                      ).toLocaleString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                      })}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
