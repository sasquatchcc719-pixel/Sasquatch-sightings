'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  Building2,
  DollarSign,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { TOWNS, townLabel } from '@/lib/geo/towns'
import type { MarketingWeeklyRollupRow } from '@/lib/ops/marketing-rollup'

type Response = {
  ok: true
  weeks: number
  rows: MarketingWeeklyRollupRow[]
  builtAt: string
}

const BUSINESS_WIDE = 'business-wide'
const UNKNOWN_TOWN = 'unknown'
const EMPTY_ROWS: MarketingWeeklyRollupRow[] = []
const RANGES = [
  { weeks: 4, label: '4 weeks' },
  { weeks: 12, label: '12 weeks' },
  { weeks: 26, label: '6 months' },
  { weeks: 52, label: '1 year' },
]

function money(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function shortWeek(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function scopeLabel(slug: string): string {
  if (slug === BUSINESS_WIDE) return 'Business-wide'
  if (slug === UNKNOWN_TOWN) return 'Unknown town'
  return townLabel(slug)
}

function hasSignal(row: MarketingWeeklyRollupRow): boolean {
  return Boolean(
    row.spend ||
    row.rank_points ||
    row.gsc_impressions ||
    row.gsc_clicks ||
    row.quote_sessions ||
    row.residential_jobs ||
    row.commercial_jobs ||
    row.review_delta ||
    row.events.length,
  )
}

async function fetchRollup(weeks: number, town: string): Promise<Response> {
  const params = new URLSearchParams({ weeks: String(weeks) })
  if (town !== 'all') params.set('town', town)
  const response = await fetch(`/api/admin/marketing/rollup?${params}`)
  if (!response.ok) throw new Error('Failed to load weekly rollup')
  return response.json()
}

export function WeeklyRollupView() {
  const [weeks, setWeeks] = useState(12)
  const [town, setTown] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['marketing-weekly-rollup', weeks, town],
    queryFn: () => fetchRollup(weeks, town),
  })
  const rows = data?.rows ?? EMPTY_ROWS

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          spend: sum.spend + row.spend,
          residentialJobs: sum.residentialJobs + row.residential_jobs,
          residentialRevenue: sum.residentialRevenue + row.residential_revenue,
          commercialJobs: sum.commercialJobs + row.commercial_jobs,
          commercialRevenue: sum.commercialRevenue + row.commercial_revenue,
          impressions: sum.impressions + row.gsc_impressions,
          clicks: sum.clicks + row.gsc_clicks,
          quotes: sum.quotes + row.quote_sessions,
          rankPoints: sum.rankPoints + row.rank_points,
          rankFound: sum.rankFound + row.rank_found,
        }),
        {
          spend: 0,
          residentialJobs: 0,
          residentialRevenue: 0,
          commercialJobs: 0,
          commercialRevenue: 0,
          impressions: 0,
          clicks: 0,
          quotes: 0,
          rankPoints: 0,
          rankFound: 0,
        },
      ),
    [rows],
  )

  const chartData = useMemo(() => {
    const weeksByStart = new Map<
      string,
      { week: string; spend: number; revenue: number }
    >()
    for (const row of rows) {
      const item = weeksByStart.get(row.week_start) ?? {
        week: shortWeek(row.week_start),
        spend: 0,
        revenue: 0,
      }
      item.spend += row.spend
      item.revenue += row.residential_revenue
      weeksByStart.set(row.week_start, item)
    }
    return [...weeksByStart.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, item]) => ({
        ...item,
        spend: Math.round(item.spend),
        revenue: Math.round(item.revenue),
      }))
  }, [rows])

  const visibleRows = rows.filter((row) => town !== 'all' || hasSignal(row))
  const returnOnSpend =
    totals.spend > 0 ? totals.residentialRevenue / totals.spend : null
  const coverage =
    totals.rankPoints > 0 ? (totals.rankFound / totals.rankPoints) * 100 : null

  async function refresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const response = await fetch(
        `/api/admin/marketing/rollup?weeks=${Math.min(weeks, 16)}`,
        { method: 'POST' },
      )
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Refresh failed')
      }
      await refetch()
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-slate-950/70 p-5 shadow-[0_0_40px_rgba(16,185,129,0.08)] sm:p-6">
        <div className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-emerald-300 uppercase">
              <BarChart3 className="h-3.5 w-3.5" />
              Marketing intelligence
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Weekly town rollup
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              What marketing cost, what it returned, and where demand is moving
              — reconciled by Monday–Sunday week and town.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
              />
              {refreshing ? 'Reconciling…' : 'Refresh recent weeks'}
            </button>
            {data?.builtAt ? (
              <span className="text-xs text-slate-500">
                Built {new Date(data.builtAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap rounded-lg border border-white/10 bg-slate-900/60 p-1">
          {RANGES.map((range) => (
            <button
              key={range.weeks}
              type="button"
              onClick={() => setWeeks(range.weeks)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                weeks === range.weeks
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <MapPin className="h-4 w-4 text-cyan-400" />
          <select
            value={town}
            onChange={(event) => setTown(event.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-500/50"
          >
            <option value="all">All towns + business-wide</option>
            <option value={BUSINESS_WIDE}>Business-wide only</option>
            {TOWNS.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
            <option value={UNKNOWN_TOWN}>Unknown town</option>
          </select>
        </label>
      </div>

      {refreshError ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {refreshError}
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-slate-400">Loading the rollup…</p>
      ) : error ? (
        <p className="text-sm text-red-300">Could not load the rollup.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
            <StatCard
              label="Tracked spend"
              value={money(totals.spend)}
              icon={DollarSign}
              color="text-amber-300"
            />
            <StatCard
              label="Residential return"
              value={money(totals.residentialRevenue)}
              detail={`${totals.residentialJobs} completed jobs`}
              icon={Building2}
              color="text-emerald-300"
            />
            <StatCard
              label="Revenue ÷ tracked spend"
              value={
                returnOnSpend === null ? '—' : `${returnOnSpend.toFixed(2)}×`
              }
              detail={
                totals.spend > 0 && totals.residentialJobs > 0
                  ? `${money(totals.spend / totals.residentialJobs)} per completed job · not attributed ROAS`
                  : 'No tracked spend in view'
              }
              icon={BarChart3}
              color="text-cyan-300"
            />
            <StatCard
              label="Search demand"
              value={totals.impressions.toLocaleString()}
              detail={`${totals.clicks} clicks`}
              icon={Search}
              color="text-sky-300"
            />
            <StatCard
              label="Quotes built"
              value={totals.quotes.toLocaleString()}
              detail="Internal tests excluded"
              icon={MousePointerClick}
              color="text-violet-300"
            />
            <StatCard
              label="Maps coverage"
              value={coverage === null ? '—' : `${coverage.toFixed(0)}%`}
              detail={
                coverage === null
                  ? 'No grid points in view'
                  : `${totals.rankFound}/${totals.rankPoints} points found`
              }
              icon={MapPin}
              color="text-rose-300"
            />
          </div>

          <section className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
            <div className="mb-3">
              <h2 className="font-semibold text-white">
                Spend vs residential revenue
              </h2>
              <p className="text-xs text-slate-500">
                Commercial revenue stays out of this comparison.
              </p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid
                    stroke="rgba(148,163,184,0.12)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="week"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={(value) =>
                      `$${Math.round(Number(value) / 1000)}k`
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#020617',
                      border: '1px solid rgba(255,255,255,.12)',
                      borderRadius: 10,
                    }}
                    formatter={(value) => money(Number(value))}
                  />
                  <Bar
                    dataKey="spend"
                    name="Spend"
                    fill="#f59e0b"
                    fillOpacity={0.55}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    dataKey="revenue"
                    name="Residential revenue"
                    stroke="#34d399"
                    strokeWidth={2.5}
                    dot={{ fill: '#34d399', r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/55">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-900/70 text-[11px] tracking-wide text-slate-400 uppercase">
                    <th className="px-3 py-3 text-left font-medium">
                      Week / town
                    </th>
                    <th className="px-2 py-3 text-right font-medium">Spend</th>
                    <th className="px-2 py-3 text-right font-medium">
                      Maps best / median
                    </th>
                    <th className="px-2 py-3 text-right font-medium">
                      Coverage
                    </th>
                    <th className="px-2 py-3 text-right font-medium">
                      GSC impr / clicks
                    </th>
                    <th className="px-2 py-3 text-right font-medium">Quotes</th>
                    <th className="px-2 py-3 text-right font-medium">
                      Residential
                    </th>
                    <th className="px-2 py-3 text-right font-medium">
                      Commercial
                    </th>
                    <th className="px-2 py-3 text-right font-medium">
                      Reviews
                    </th>
                    <th className="px-3 py-3 text-left font-medium">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const coveragePct = row.rank_points
                      ? (row.rank_found / row.rank_points) * 100
                      : null
                    return (
                      <tr
                        key={`${row.week_start}:${row.town_slug}`}
                        className="border-b border-white/5 align-top hover:bg-white/[0.025]"
                      >
                        <td className="px-3 py-3">
                          <p className="text-sm font-medium text-white">
                            {scopeLabel(row.town_slug)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {shortWeek(row.week_start)}–
                            {shortWeek(row.week_end)}
                          </p>
                        </td>
                        <td className="px-2 py-3 text-right text-sm text-amber-300">
                          {row.spend ? money(row.spend) : '—'}
                        </td>
                        <td className="px-2 py-3 text-right text-sm text-white">
                          {row.rank_points ? (
                            <>
                              {row.rank_best ?? 'Out'} /{' '}
                              {row.rank_median === 21 ? 'Out' : row.rank_median}
                            </>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-right text-sm text-slate-300">
                          {coveragePct === null
                            ? '—'
                            : `${coveragePct.toFixed(0)}% (${row.rank_found}/${row.rank_points})`}
                        </td>
                        <td className="px-2 py-3 text-right text-sm text-slate-300">
                          {row.gsc_impressions || row.gsc_clicks ? (
                            <>
                              {row.gsc_impressions.toLocaleString()} /{' '}
                              {row.gsc_clicks}
                              {row.gsc_data_through ? (
                                <span className="block text-[10px] text-slate-600">
                                  through {shortWeek(row.gsc_data_through)}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-3 text-right text-sm text-violet-300">
                          {row.quote_sessions || '—'}
                        </td>
                        <td className="px-2 py-3 text-right text-sm text-emerald-300">
                          {row.residential_jobs ? (
                            <>
                              {row.residential_jobs} /{' '}
                              {money(row.residential_revenue)}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-3 text-right text-sm text-cyan-300">
                          {row.commercial_jobs ? (
                            <>
                              {row.commercial_jobs} /{' '}
                              {money(row.commercial_revenue)}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-3 text-right text-sm text-slate-300">
                          {row.review_delta === null
                            ? '—'
                            : `${row.review_delta > 0 ? '+' : ''}${row.review_delta}`}
                        </td>
                        <td className="max-w-[250px] px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {row.events.slice(0, 3).map((event) => (
                              <span
                                key={event.id}
                                title={event.detail ?? event.title}
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                  event.category === 'instrument'
                                    ? 'border-violet-400/30 bg-violet-400/10 text-violet-300'
                                    : 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300'
                                }`}
                              >
                                {event.title}
                              </span>
                            ))}
                            {!row.events.length ? (
                              <span className="text-sm text-slate-600">—</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="space-y-1 text-xs leading-5 text-slate-500">
            <p>
              Business-wide metrics are stored once, not repeated across towns.
              Multi-town campaign costs are split once so the spend column still
              reconciles to QuickBooks.
            </p>
            <p>
              Revenue ÷ tracked spend is a directional operating ratio. It does
              not claim every job was caused by that week&apos;s campaigns.
            </p>
            <p>
              Jobs are completed service appointments over $1. Commercial
              accounts are separated from residential. Maps median counts a miss
              as rank 21; coverage shows how often Sasquatch was actually found.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  detail?: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
          {label}
        </p>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </div>
  )
}
