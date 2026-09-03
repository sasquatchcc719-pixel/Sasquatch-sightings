'use client'

import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'

type ChannelRow = {
  channel: string
  jobs: number
  revenue: number
  laborCost: number
  laborHours: number
  marketingLaborCost: number
  marketingLaborHours: number
  marketingLaborSessions: number
  adCost: number | null
  kept: number
  marginPct: number | null
  costPerJob: number | null
  isCommercial: boolean
}

type CampaignTally = {
  channel: string
  name: string
  startsOn: string
  printingCost: number
  marketingLaborCost: number
  marketingLaborHours: number
  marketingLaborSessions: number
  hourlyRate: number | null
  people: string[]
  totalInvested: number
  printSource: string
  printRefreshedAt: string | null
  warning: string | null
}

type Response = {
  days: number
  since: string
  updatedAt: string
  rows: ChannelRow[]
  campaignTallies: CampaignTally[]
  excluded: { noTiming: number; overMaxHours: number }
}

const CHANNEL_LABELS: Record<string, string> = {
  nextdoor: 'Nextdoor',
  repeat_customer: 'Repeat customer',
  google_search: 'Google (organic)',
  google_lsa: 'Google LSA (paid)',
  facebook: 'Facebook',
  referral: 'Referral',
  nfc_partner: 'NFC partner',
  vehicle_wrap: 'Vehicle wrap',
  door_hanger: 'Door hanger',
  chatgpt: 'ChatGPT',
  commercial: 'Commercial',
  other: 'Other',
  unknown: 'Unknown',
}

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

function money(n: number, cents = false): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })
}

async function fetchPnl(days: number, refresh = false): Promise<Response> {
  const params = new URLSearchParams({ days: String(days) })
  if (refresh) params.set('refresh', '1')
  const res = await fetch(`/api/admin/marketing/channel-pnl?${params}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('Failed to load channel P&L')
  return res.json()
}

export function ChannelPnlView() {
  const [days, setDays] = useState(90)
  const forceRefresh = useRef(false)

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['channel-pnl', days],
    queryFn: () => {
      const refresh = forceRefresh.current
      forceRefresh.current = false
      return fetchPnl(days, refresh)
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  })

  const rows = data?.rows || []
  const residential = rows.filter((r) => !r.isCommercial)
  const commercial = rows.filter((r) => r.isCommercial)

  const totals = residential.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      marketingCost: acc.marketingCost + (r.adCost || 0) + r.marketingLaborCost,
      jobLabor: acc.jobLabor + r.laborCost,
      kept: acc.kept + r.kept,
      jobs: acc.jobs + r.jobs,
    }),
    { revenue: 0, marketingCost: 0, jobLabor: 0, kept: 0, jobs: 0 },
  )

  function renderRow(r: ChannelRow) {
    const marketingCost = (r.adCost || 0) + r.marketingLaborCost
    const isPaid = marketingCost > 0
    return (
      <tr key={r.channel} className="border-b border-white/5">
        <td className="py-2 pr-2 pl-3 text-sm text-white">
          {CHANNEL_LABELS[r.channel] || r.channel}
          {isPaid ? (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] tracking-wide text-amber-300 uppercase">
              paid
            </span>
          ) : null}
        </td>
        <td className="px-2 py-2 text-right text-sm text-slate-300">
          {r.jobs}
        </td>
        <td className="px-2 py-2 text-right text-sm text-white">
          {money(r.revenue)}
        </td>
        <td className="px-2 py-2 text-right text-sm">
          {r.adCost === null && r.marketingLaborCost === 0 ? (
            <span className="text-slate-600" title="No ad spend tracked">
              —
            </span>
          ) : (
            <div>
              <span className="text-amber-300">{money(marketingCost)}</span>
              {r.marketingLaborCost > 0 ? (
                <span className="block text-[10px] leading-tight text-slate-500">
                  {money(r.adCost || 0)} print + {money(r.marketingLaborCost)}{' '}
                  canvassing
                </span>
              ) : null}
            </div>
          )}
        </td>
        <td className="px-2 py-2 text-right text-sm text-slate-300">
          {money(r.laborCost)}
        </td>
        <td className="px-2 py-2 text-right text-sm">
          {r.costPerJob === null ? (
            <span className="text-slate-600">—</span>
          ) : (
            <span
              className={
                r.costPerJob > 75 ? 'text-red-300' : 'text-emerald-300'
              }
            >
              {money(r.costPerJob)}
            </span>
          )}
        </td>
        <td className="py-2 pr-3 pl-2 text-right text-sm font-semibold text-white">
          {money(r.kept)}
          {r.marginPct !== null ? (
            <span className="ml-1.5 text-xs font-normal text-slate-400">
              {r.marginPct}%
            </span>
          ) : null}
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-4">
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
          <span className="text-xs text-slate-500">
            Results since {data.since} · updated{' '}
            {new Date(data.updatedAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        ) : null}
        <button
          type="button"
          disabled={isFetching}
          onClick={() => {
            forceRefresh.current = true
            void refetch()
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
          />
          Refresh now
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-300">Could not load the numbers.</p>
      ) : (
        <>
          {(data?.campaignTallies ?? []).map((tally) => (
            <div
              key={tally.channel}
              className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {tally.name} — running total
                  </p>
                  <p className="text-xs text-slate-400">
                    Campaign-to-date since {tally.startsOn}. New QuickBooks
                    bills and completed canvassing sessions are added
                    automatically.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Total invested</p>
                  <p className="text-2xl font-bold text-emerald-300">
                    {money(tally.totalInvested, true)}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-black/15 px-3 py-2">
                  <p className="text-xs text-slate-400">Printing</p>
                  <p className="font-semibold text-white">
                    {money(tally.printingCost, true)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Read from {tally.printSource}
                  </p>
                </div>
                <div className="rounded-lg bg-black/15 px-3 py-2">
                  <p className="text-xs text-slate-400">
                    Paid canvassing labor
                  </p>
                  <p className="font-semibold text-white">
                    {money(tally.marketingLaborCost, true)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {tally.marketingLaborHours.toFixed(2)} hours
                    {tally.hourlyRate !== null
                      ? ` × ${money(tally.hourlyRate, true)}/hour`
                      : ''}{' '}
                    · {tally.marketingLaborSessions} completed sessions
                  </p>
                </div>
              </div>
              {tally.warning ? (
                <p className="mt-2 text-xs text-amber-300">{tally.warning}</p>
              ) : null}
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Revenue', money(totals.revenue)],
              ['Marketing spend', money(totals.marketingCost)],
              ['Job labor', money(totals.jobLabor)],
              ['Kept', money(totals.kept)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2"
              >
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-lg font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="bg-slate-900/60 text-xs tracking-wide text-slate-400 uppercase">
                  <th className="py-2 pr-2 pl-3 text-left font-medium">
                    Where they came from
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Jobs</th>
                  <th className="px-2 py-2 text-right font-medium">Money in</th>
                  <th className="px-2 py-2 text-right font-medium">
                    Marketing cost
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    Job labor
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    Cost to win each job
                  </th>
                  <th className="py-2 pr-3 pl-2 text-right font-medium">
                    Kept
                  </th>
                </tr>
              </thead>
              <tbody>
                {residential.map(renderRow)}
                {commercial.length > 0 ? (
                  <>
                    <tr>
                      <td
                        colSpan={7}
                        className="bg-slate-900/40 px-3 py-1.5 text-[11px] tracking-wide text-slate-500 uppercase"
                      >
                        Commercial — kept separate, these behave nothing like a
                        house
                      </td>
                    </tr>
                    {commercial.map(renderRow)}
                  </>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 text-xs text-slate-500">
            <p>
              Marketing cost means ads, printing, and paid distribution work. A
              dash means the cost is not tracked — not that it was free.
            </p>
            <p>
              Job labor is the paid time spent serving the customer, from
              completion back to &ldquo;on my way&rdquo;, so drive time is
              included. Your own hours are not billed as a cost.
            </p>
            <p>
              The page refreshes automatically every five minutes and whenever
              you return to it. &ldquo;Refresh now&rdquo; also asks QuickBooks
              for the latest print bills immediately.
            </p>
            {data && (data.excluded.noTiming || data.excluded.overMaxHours) ? (
              <p>
                Labor excludes {data.excluded.noTiming} job(s) with no timing
                and {data.excluded.overMaxHours} left open over 12 hours. Their
                revenue is still counted.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
