'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

type ChannelRow = {
  channel: string
  jobs: number
  revenue: number
  laborCost: number
  laborHours: number
  adCost: number | null
  kept: number
  marginPct: number | null
  costPerJob: number | null
  isCommercial: boolean
}

type Response = {
  days: number
  since: string
  rows: ChannelRow[]
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
  other: 'Commercial / other',
  unknown: 'Unknown',
}

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

function money(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

async function fetchPnl(days: number): Promise<Response> {
  const res = await fetch(`/api/admin/marketing/channel-pnl?days=${days}`)
  if (!res.ok) throw new Error('Failed to load channel P&L')
  return res.json()
}

export function ChannelPnlView() {
  const [days, setDays] = useState(90)

  const { data, isLoading, error } = useQuery({
    queryKey: ['channel-pnl', days],
    queryFn: () => fetchPnl(days),
  })

  const rows = data?.rows || []
  const residential = rows.filter((r) => !r.isCommercial)
  const commercial = rows.filter((r) => r.isCommercial)

  const totals = residential.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      adCost: acc.adCost + (r.adCost || 0),
      labor: acc.labor + r.laborCost,
      kept: acc.kept + r.kept,
      jobs: acc.jobs + r.jobs,
    }),
    { revenue: 0, adCost: 0, labor: 0, kept: 0, jobs: 0 },
  )

  function renderRow(r: ChannelRow) {
    const isPaid = r.adCost !== null && r.adCost > 0
    return (
      <tr key={r.channel} className="border-b border-white/5">
        <td className="py-2 pl-3 pr-2 text-sm text-white">
          {CHANNEL_LABELS[r.channel] || r.channel}
          {isPaid ? (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
              paid
            </span>
          ) : null}
        </td>
        <td className="px-2 py-2 text-right text-sm text-slate-300">{r.jobs}</td>
        <td className="px-2 py-2 text-right text-sm text-white">
          {money(r.revenue)}
        </td>
        <td className="px-2 py-2 text-right text-sm">
          {r.adCost === null ? (
            <span className="text-slate-600" title="No ad spend tracked">
              —
            </span>
          ) : (
            <span className="text-amber-300">{money(r.adCost)}</span>
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
        <td className="py-2 pl-2 pr-3 text-right text-sm font-semibold text-white">
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
          <span className="text-xs text-slate-500">since {data.since}</span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-300">Could not load the numbers.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Revenue', money(totals.revenue)],
              ['Ad spend', money(totals.adCost)],
              ['Labor', money(totals.labor)],
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
                <tr className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pl-3 pr-2 text-left font-medium">
                    Where they came from
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Jobs</th>
                  <th className="px-2 py-2 text-right font-medium">Money in</th>
                  <th className="px-2 py-2 text-right font-medium">Ads</th>
                  <th className="px-2 py-2 text-right font-medium">Labor</th>
                  <th className="px-2 py-2 text-right font-medium">Ads/job</th>
                  <th className="py-2 pl-2 pr-3 text-right font-medium">Kept</th>
                </tr>
              </thead>
              <tbody>
                {residential.map(renderRow)}
                {commercial.length > 0 ? (
                  <>
                    <tr>
                      <td
                        colSpan={7}
                        className="bg-slate-900/40 px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-500"
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
              A dash under Ads means no spend is tracked for that channel — not
              that it is free.
            </p>
            <p>
              Labor counts paid techs only, from clock-out back to
              &ldquo;on my way&rdquo;, so drive time is included. Your own hours
              are not billed as a cost.
            </p>
            {data && (data.excluded.noTiming || data.excluded.overMaxHours) ? (
              <p>
                Labor excludes {data.excluded.noTiming} job(s) with no timing and{' '}
                {data.excluded.overMaxHours} left open over 12 hours. Their
                revenue is still counted.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
