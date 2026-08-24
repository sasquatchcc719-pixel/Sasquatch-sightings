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
  BriefcaseBusiness,
  CircleAlert,
  CircleCheck,
  DollarSign,
  Eye,
  HelpCircle,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { townLabel } from '@/lib/geo/towns'
import type { MarketingWeeklyRollupRow } from '@/lib/ops/marketing-rollup'
import {
  ACTIVE_SERVICE_TOWNS,
  buildBusinessInsights,
  completedWeekStarts,
  isActiveServiceTown,
  latestMapWeekRows,
  mapVisibility,
  scopedWeekRows,
  summarizeRollup,
  type BusinessInsight,
} from '@/lib/ops/marketing-rollup-insights'

type Response = {
  ok: true
  weeks: number
  rows: MarketingWeeklyRollupRow[]
  builtAt: string
}

const BUSINESS_WIDE = 'business-wide'
const EMPTY_ROWS: MarketingWeeklyRollupRow[] = []
const RANGES = [
  { weeks: 5, label: 'Last 4 weeks' },
  { weeks: 13, label: 'Last 12 weeks' },
  { weeks: 27, label: '6 months' },
  { weeks: 53, label: '1 year' },
]

type TrendPoint = {
  week: string
  spend: number
  spendLineCount: number
  spendBreakdown: Record<string, number>
  revenue: number
  jobs: number
}

function money(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function fullDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function weekLabel(start: string, end: string): string {
  return `${shortDate(start)}–${shortDate(end)}`
}

function sortedBreakdown(breakdown: Record<string, number>) {
  return Object.entries(breakdown).sort((a, b) => b[1] - a[1])
}

function mountainToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function scopeLabel(slug: string): string {
  if (slug === BUSINESS_WIDE) return 'Business-wide (not tied to one town)'
  if (slug === 'unknown') return 'Unmapped jobs'
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

async function fetchRollup(weeks: number): Promise<Response> {
  const response = await fetch(`/api/admin/marketing/rollup?weeks=${weeks}`)
  if (!response.ok) throw new Error('Failed to load weekly rollup')
  return response.json()
}

export function WeeklyRollupView({ embedded = false }: { embedded?: boolean }) {
  const [weeks, setWeeks] = useState(53)
  const [town, setTown] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['marketing-weekly-rollup', weeks],
    queryFn: () => fetchRollup(weeks),
  })
  const rows = data?.rows ?? EMPTY_ROWS
  const today = mountainToday()

  const completedStarts = useMemo(
    () => completedWeekStarts(rows, today),
    [rows, today],
  )
  const latestStart = completedStarts[0]
  const previousStart = completedStarts[1]
  const latestRows = useMemo(
    () => scopedWeekRows(rows, latestStart, town),
    [rows, latestStart, town],
  )
  const previousRows = useMemo(
    () => scopedWeekRows(rows, previousStart, town),
    [rows, previousStart, town],
  )
  const latestSummary = useMemo(() => summarizeRollup(latestRows), [latestRows])
  const previousSummary = useMemo(
    () => (previousRows.length ? summarizeRollup(previousRows) : null),
    [previousRows],
  )
  const latestBusinessSummary = useMemo(
    () => summarizeRollup(scopedWeekRows(rows, latestStart, 'all')),
    [rows, latestStart],
  )
  const previousBusinessSummary = useMemo(
    () =>
      previousStart
        ? summarizeRollup(scopedWeekRows(rows, previousStart, 'all'))
        : null,
    [rows, previousStart],
  )
  const serviceRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.week_start === latestStart &&
          isActiveServiceTown(row.town_slug) &&
          (town === 'all' || row.town_slug === town),
      ),
    [rows, latestStart, town],
  )
  const mapRows = useMemo(() => latestMapWeekRows(rows, town), [rows, town])
  const insights = useMemo(() => {
    const current =
      town === 'all'
        ? latestSummary
        : {
            ...latestSummary,
            spend: latestBusinessSummary.spend,
            spendBreakdown: latestBusinessSummary.spendBreakdown,
            spendLineCount: latestBusinessSummary.spendLineCount,
          }
    const previous =
      town === 'all' || !previousSummary || !previousBusinessSummary
        ? previousSummary
        : {
            ...previousSummary,
            spend: previousBusinessSummary.spend,
            spendBreakdown: previousBusinessSummary.spendBreakdown,
            spendLineCount: previousBusinessSummary.spendLineCount,
          }
    return buildBusinessInsights({
      current,
      previous,
      serviceRows,
      mapRows,
      allServiceAreas: town === 'all',
    })
  }, [
    latestSummary,
    latestBusinessSummary,
    previousSummary,
    previousBusinessSummary,
    serviceRows,
    mapRows,
    town,
  ])

  const trendData = useMemo(
    () =>
      completedStarts
        .map((weekStart) => {
          const workSummary = summarizeRollup(
            scopedWeekRows(rows, weekStart, town),
          )
          const spendSummary = summarizeRollup(
            scopedWeekRows(rows, weekStart, 'all'),
          )
          return {
            week: shortDate(weekStart),
            spend: Math.round(spendSummary.spend),
            spendLineCount: spendSummary.spendLineCount,
            spendBreakdown: spendSummary.spendBreakdown,
            revenue: Math.round(workSummary.residentialRevenue),
            jobs: workSummary.residentialJobs,
          }
        })
        .reverse(),
    [completedStarts, rows, town],
  )

  const periodSpendSummary = useMemo(
    () =>
      summarizeRollup(
        completedStarts.flatMap((weekStart) =>
          scopedWeekRows(rows, weekStart, 'all'),
        ),
      ),
    [completedStarts, rows],
  )
  const periodSpendCategories = useMemo(
    () => sortedBreakdown(periodSpendSummary.spendBreakdown),
    [periodSpendSummary.spendBreakdown],
  )
  const latestSpendCategories = sortedBreakdown(
    latestBusinessSummary.spendBreakdown,
  )

  const rawRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          hasSignal(row) &&
          (town === 'all'
            ? row.town_slug === BUSINESS_WIDE ||
              row.town_slug === 'unknown' ||
              isActiveServiceTown(row.town_slug)
            : row.town_slug === town),
      ),
    [rows, town],
  )

  const latestWeekEnd = latestRows[0]?.week_end
  const periodStart = completedStarts.at(-1)
  const latestMapStart = mapRows[0]?.week_start
  const latestMapEnd = mapRows[0]?.week_end
  const clickRate = latestSummary.searchAppearances
    ? (latestSummary.googleVisits / latestSummary.searchAppearances) * 100
    : null

  async function refresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const response = await fetch(
        `/api/admin/marketing/rollup?weeks=${weeks}`,
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
      {!embedded ? (
        <section className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-slate-950/70 p-5 shadow-[0_0_40px_rgba(16,185,129,0.08)] sm:p-6">
          <div className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-emerald-300 uppercase">
                <Sparkles className="h-3.5 w-3.5" />
                Weekly business briefing
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white">
                What happened, what it means, and what to do next
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                A plain-English view of the last completed week. It connects
                search visibility, website activity, completed work, and known
                costs without pretending that one automatically caused another.
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
                {refreshing ? 'Updating the numbers…' : 'Update this report'}
              </button>
              {data?.builtAt ? (
                <span className="text-xs text-slate-500">
                  Data assembled {new Date(data.builtAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

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
          <span>Show:</span>
          <select
            value={town}
            onChange={(event) => setTown(event.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-500/50"
          >
            <option value="all">All active service areas</option>
            {ACTIVE_SERVICE_TOWNS.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {embedded ? (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
            />
            {refreshing ? 'Updating…' : 'Update this report'}
          </button>
        ) : null}
      </div>

      {refreshError ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {refreshError}
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-slate-400">
          Building the plain-English briefing…
        </p>
      ) : error ? (
        <p className="text-sm text-red-300">Could not load the briefing.</p>
      ) : !latestStart || !latestWeekEnd ? (
        <p className="text-sm text-slate-400">
          There is not yet a completed week to explain.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <section className="rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/[0.08] via-slate-950/80 to-emerald-500/[0.06] p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold tracking-[0.16em] text-cyan-300 uppercase">
                  Last completed week
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-white">
                  {weekLabel(latestStart, latestWeekEnd)}
                </h2>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                {town === 'all' ? 'All active service areas' : townLabel(town)}
              </span>
            </div>

            <div className="space-y-3 text-base leading-7 text-slate-200">
              <p>
                Sasquatch completed{' '}
                <strong className="text-white">
                  {latestSummary.residentialJobs} residential jobs worth{' '}
                  {money(latestSummary.residentialRevenue)}
                </strong>
                {latestSummary.commercialJobs
                  ? `, plus ${latestSummary.commercialJobs} commercial jobs worth ${money(latestSummary.commercialRevenue)}`
                  : ''}
                .
              </p>
              <p>
                Google showed Sasquatch pages in search results{' '}
                <strong className="text-white">
                  {latestSummary.searchAppearances.toLocaleString()} times
                </strong>
                , and{' '}
                <strong className="text-white">
                  {latestSummary.googleVisits} people clicked through to the
                  website
                </strong>
                .{' '}
                <strong className="text-white">
                  {latestSummary.quoteSessions} website sessions reached the
                  online quote step
                </strong>
                —that means a quote was started, not necessarily finished or
                booked.
              </p>
              <p>
                The reconciled marketing ledger shows{' '}
                <strong className="text-white">
                  {money(latestBusinessSummary.spend)} in spending
                </strong>
                {latestBusinessSummary.spendLineCount
                  ? `, anchored by ${latestBusinessSummary.spendLineCount} QuickBooks expense ${latestBusinessSummary.spendLineCount === 1 ? 'line' : 'lines'}`
                  : ''}
                , plus any separately recorded campaign costs. These costs are
                business-wide and are not assigned to one town.
              </p>
              {latestSummary.reviewDelta !== null ? (
                <p>
                  The Google review count changed by{' '}
                  <strong className="text-white">
                    {latestSummary.reviewDelta > 0 ? '+' : ''}
                    {latestSummary.reviewDelta}
                  </strong>{' '}
                  during the week.
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-4">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <div>
                <p className="font-medium text-amber-100">
                  Do not read this as “marketing caused all of that revenue.”
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-100/70">
                  These things happened in the same week. Completed jobs may
                  have been booked earlier, while QuickBooks expenses land when
                  a card charge or bill posts. The report provides clues; it
                  does not manufacture attribution.
                </p>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h2 className="text-xl font-semibold text-white">
                The important numbers, explained
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Each number says exactly what was counted and what it cannot
                prove.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                label="Completed residential work"
                value={`${latestSummary.residentialJobs} jobs`}
                detail={`${money(latestSummary.residentialRevenue)} in completed residential revenue`}
                explanation="Jobs whose service date fell inside this week and were marked completed. This is operational output, not attributed marketing revenue."
                icon={BriefcaseBusiness}
                color="text-emerald-300"
              />
              <MetricCard
                label="Completed commercial work"
                value={`${latestSummary.commercialJobs} jobs`}
                detail={`${money(latestSummary.commercialRevenue)} kept separate from residential`}
                explanation="Commercial accounts can have very different job sizes and buying cycles, so they are not mixed into residential performance."
                icon={BarChart3}
                color="text-cyan-300"
              />
              <MetricCard
                label="Google search appearances"
                value={`${latestSummary.searchAppearances.toLocaleString()} times`}
                detail={`${latestSummary.googleVisits} website visits${clickRate === null ? '' : ` · ${clickRate.toFixed(1)}% chose to click`}`}
                explanation={`An appearance means a Sasquatch page was shown in a Google result. It does not mean the person noticed it. Google data is delayed${latestSummary.gscDataThrough ? ` and currently runs through ${shortDate(latestSummary.gscDataThrough)}` : ''}.`}
                icon={Search}
                color="text-sky-300"
              />
              <MetricCard
                label="Website sessions reaching the quote step"
                value={`${latestSummary.quoteSessions} sessions`}
                detail="A quote was started—not necessarily submitted or booked"
                explanation="Internal testing is removed. One person can return in another session, and this event alone is not a qualified lead."
                icon={MousePointerClick}
                color="text-violet-300"
              />
              <MetricCard
                label="Reconciled marketing spend"
                value={money(latestBusinessSummary.spend)}
                detail={
                  latestSpendCategories[0]
                    ? `${latestBusinessSummary.spendLineCount} QuickBooks expense ${latestBusinessSummary.spendLineCount === 1 ? 'line' : 'lines'} + linked campaign costs · largest: ${latestSpendCategories[0][0]}`
                    : 'No marketing expense posted during this week'
                }
                explanation="Reconciled from read-only QuickBooks marketing expenses and separately recorded campaign costs. Duplicate links are removed. This is expense timing, not attributed return."
                icon={DollarSign}
                color="text-amber-300"
              />
              <MetricCard
                label="Change in Google review count"
                value={
                  latestSummary.reviewDelta === null
                    ? 'Not available'
                    : `${latestSummary.reviewDelta > 0 ? '+' : ''}${latestSummary.reviewDelta}`
                }
                detail="Net change during the completed week"
                explanation="This compares recorded Google review-count snapshots. It measures count, not sentiment or which jobs produced the reviews."
                icon={CircleCheck}
                color="text-rose-300"
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <TrendingUp className="mt-0.5 h-5 w-5 text-emerald-300" />
              <div>
                <h2 className="text-xl font-semibold text-white">
                  What deserves attention
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  These are evidence-based clues and next checks—not automated
                  orders to change the business.
                </p>
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {insights.map((insight) => (
                <InsightCard key={insight.title} insight={insight} />
              ))}
            </div>
          </section>

          {mapRows.length && latestMapStart && latestMapEnd ? (
            <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 sm:p-5">
              <div className="mb-4">
                <p className="text-xs font-semibold tracking-[0.14em] text-rose-300 uppercase">
                  Latest Google Maps visibility check ·{' '}
                  {weekLabel(latestMapStart, latestMapEnd)}
                  {latestMapEnd >= today ? ' (week still in progress)' : ''}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-white">
                  Could a nearby customer find Sasquatch in Google Maps?
                </h2>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
                  The scanner searched “carpet cleaning” from many sample map
                  locations. “Found at 64 of 87” means Sasquatch appeared in the
                  first 20 Maps results at 64 locations. It is not service
                  coverage, customer share, or population coverage. Castle
                  Pines, Manitou Springs, and other scanner-only benchmark areas
                  are intentionally hidden from this business view.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {mapRows.map((row) => {
                  const visibility = mapVisibility(row)
                  const tone =
                    visibility.status === 'Strong'
                      ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300'
                      : visibility.status === 'Mixed'
                        ? 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300'
                        : 'border-rose-400/20 bg-rose-400/[0.06] text-rose-300'
                  return (
                    <article
                      key={row.town_slug}
                      className={`rounded-xl border p-4 ${tone}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-white">
                          {townLabel(row.town_slug)} area
                        </h3>
                        <span className="rounded-full border border-current/25 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                          {visibility.status}
                        </span>
                      </div>
                      <p className="mt-3 text-2xl font-semibold text-white">
                        Found at {row.rank_found} of {row.rank_points}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        {visibility.percent.toFixed(0)}% of sampled search
                        locations; {visibility.typical}.
                        {row.rank_best
                          ? ` Best observed position: ${row.rank_best}.`
                          : ' No first-20 position was observed.'}
                      </p>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section className="order-first rounded-xl border border-white/10 bg-slate-950/55 p-4">
            <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
              <div>
                <h2 className="font-semibold text-white">
                  Reconciled marketing spend vs completed residential revenue
                </h2>
                <p className="mt-1 text-xs font-medium text-amber-300">
                  {periodStart
                    ? `${fullDate(periodStart)}–${fullDate(latestWeekEnd)} · ${completedStarts.length} completed weeks`
                    : 'Selected completed weeks'}
                </p>
              </div>
              <span className="w-fit rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-200">
                Changing the range changes every total below
              </span>
            </div>
            <div className="mb-3">
              <p className="text-xs leading-5 text-slate-500">
                Amber bars = business-wide marketing expenses reconciled from
                QuickBooks and separately recorded campaign costs. Green line =
                completed residential revenue{' '}
                {town === 'all'
                  ? 'from completed jobs (including jobs whose address was never tagged to a town)'
                  : `in ${townLabel(town)}`}
                . The timing comparison can reveal patterns, but it is not ROAS:
                jobs often close weeks after the marketing that produced them.
              </p>
              {weeks === 27 && periodStart && periodStart > '2026-01-20' ? (
                <p className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-2 text-xs leading-5 text-cyan-100/80">
                  Vehicle-wrap note: this six-month window starts after the
                  January 20 deposit, so it shows three payments. Choose “1
                  year” to include all four 2026 wrap payments totaling $6,381.
                </p>
              ) : null}
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData}>
                  <CartesianGrid
                    stroke="rgba(148,163,184,0.12)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="week"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="money"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={(value) =>
                      `$${Math.round(Number(value) / 1000)}k`
                    }
                  />
                  <Tooltip content={<SpendRevenueTooltip />} />
                  <Bar
                    yAxisId="money"
                    dataKey="spend"
                    name="Reconciled marketing spend"
                    fill="#f59e0b"
                    fillOpacity={0.72}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="money"
                    dataKey="revenue"
                    name="Completed residential revenue"
                    stroke="#34d399"
                    strokeWidth={2.5}
                    dot={{ fill: '#34d399', r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="font-medium text-white">
                    Where the marketing money went in this selected period
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {money(periodSpendSummary.spend)} total, anchored by{' '}
                    {periodSpendSummary.spendLineCount} QuickBooks expense lines
                    plus separately recorded campaign costs. “Other marketing”
                    means the source was recognized as marketing but did not
                    match a named category.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {periodSpendCategories.map(([channel, amount]) => {
                  const percent = periodSpendSummary.spend
                    ? (amount / periodSpendSummary.spend) * 100
                    : 0
                  return (
                    <div
                      key={channel}
                      className="rounded-lg border border-white/8 bg-white/[0.025] p-3"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-slate-300">
                          {channel}
                        </span>
                        <span className="font-medium text-amber-300">
                          {money(amount)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-amber-400/70"
                          style={{
                            width: `${Math.min(100, Math.max(2, percent))}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600">
                        {percent.toFixed(0)}% of selected-period marketing spend
                      </p>
                    </div>
                  )
                })}
                {!periodSpendCategories.length ? (
                  <p className="text-sm text-slate-500">
                    No reconciled marketing expense landed in this period.
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <HelpCircle className="mt-0.5 h-5 w-5 text-cyan-300" />
              <div>
                <h2 className="text-xl font-semibold text-white">
                  How to read this report
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  The definitions that matter before making a business change.
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Definition
                term="Google search appearance"
                definition="A Sasquatch page appeared somewhere in a person’s Google results. The technical system calls this an impression. It is not a visit."
              />
              <Definition
                term="Website visit from Google"
                definition="A person clicked a Sasquatch result and opened the website. The technical system calls this a click."
              />
              <Definition
                term="Online quote session"
                definition="A website session reached the quote-building step. It is not necessarily a submitted quote, unique person, phone lead, or booked job."
              />
              <Definition
                term="Google Maps visibility check"
                definition="A sample search from a specific map location. Found means Sasquatch appeared in the first 20 results. It is not geographic service coverage."
              />
              <Definition
                term="Reconciled marketing spend"
                definition="Expense lines in QuickBooks marketing or printing accounts, recognized marketing vendors found under other accounts, and separately recorded campaign costs. Duplicate links are counted once. The transaction date is expense timing, not the date a customer was acquired."
              />
              <Definition
                term="Completed revenue"
                definition="The quoted value of service appointments completed during the week. It can come from customers acquired days, months, or years earlier."
              />
            </div>
          </section>

          <details className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/55">
            <summary className="cursor-pointer px-4 py-4 text-sm font-medium text-slate-200 hover:bg-white/[0.03]">
              Open the underlying weekly numbers for auditing
            </summary>
            <div className="border-t border-white/10 px-4 py-3 text-sm leading-6 text-slate-400">
              This is supporting evidence, not the main decision screen.
              Completed jobs still count if the address was never tagged to a
              town. Scanner-only benchmark towns stay out of the business
              report.
            </div>
            <div className="overflow-x-auto border-t border-white/10">
              <table className="w-full min-w-[1280px] border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-900/70 text-[11px] tracking-wide text-slate-400 uppercase">
                    <th className="px-3 py-3 text-left font-medium">
                      Week and area
                    </th>
                    <th className="px-3 py-3 text-left font-medium">
                      Reconciled marketing spend
                    </th>
                    <th className="px-3 py-3 text-left font-medium">
                      Google Maps visibility check
                    </th>
                    <th className="px-3 py-3 text-left font-medium">
                      Google search → website
                    </th>
                    <th className="px-3 py-3 text-left font-medium">
                      Online quote step
                    </th>
                    <th className="px-3 py-3 text-left font-medium">
                      Completed residential work
                    </th>
                    <th className="px-3 py-3 text-left font-medium">
                      Completed commercial work
                    </th>
                    <th className="px-3 py-3 text-left font-medium">
                      Review count change
                    </th>
                    <th className="px-3 py-3 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rawRows.map((row) => {
                    const visibility = row.rank_points
                      ? mapVisibility(row)
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
                            {weekLabel(row.week_start, row.week_end)}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-sm text-amber-300">
                          {row.spend ? (
                            <>
                              <span className="block text-white">
                                {money(row.spend)}
                              </span>
                              <span className="text-xs text-slate-500">
                                {row.spend_line_count
                                  ? `${row.spend_line_count} QuickBooks ${row.spend_line_count === 1 ? 'line' : 'lines'} + any linked campaign costs`
                                  : 'Non-QuickBooks campaign cost'}
                              </span>
                            </>
                          ) : (
                            'No expense posted'
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-300">
                          {visibility ? (
                            <>
                              <span className="block text-white">
                                Found at {row.rank_found} of {row.rank_points}
                              </span>
                              <span className="text-xs text-slate-500">
                                {visibility.typical}
                                {row.rank_best
                                  ? `; best position ${row.rank_best}`
                                  : ''}
                              </span>
                            </>
                          ) : (
                            'No scan assigned'
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-300">
                          {row.gsc_impressions || row.gsc_clicks ? (
                            <>
                              <span className="block text-white">
                                {row.gsc_impressions.toLocaleString()}{' '}
                                appearances
                              </span>
                              <span className="text-xs text-slate-500">
                                {row.gsc_clicks} website visits
                                {row.gsc_data_through
                                  ? ` · data through ${shortDate(row.gsc_data_through)}`
                                  : ''}
                              </span>
                            </>
                          ) : (
                            'No recorded activity'
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm text-violet-300">
                          {row.quote_sessions
                            ? `${row.quote_sessions} sessions reached the step`
                            : 'None recorded'}
                        </td>
                        <td className="px-3 py-3 text-sm text-emerald-300">
                          {row.residential_jobs
                            ? `${row.residential_jobs} jobs · ${money(row.residential_revenue)}`
                            : 'No completed jobs'}
                        </td>
                        <td className="px-3 py-3 text-sm text-cyan-300">
                          {row.commercial_jobs
                            ? `${row.commercial_jobs} jobs · ${money(row.commercial_revenue)}`
                            : 'No completed jobs'}
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-300">
                          {row.review_delta === null
                            ? 'Not assigned'
                            : `${row.review_delta > 0 ? '+' : ''}${row.review_delta}`}
                        </td>
                        <td className="max-w-[280px] px-3 py-3">
                          <div className="space-y-1">
                            {row.events.slice(0, 3).map((event) => (
                              <p
                                key={event.id}
                                title={event.detail ?? event.title}
                                className="text-xs leading-5 text-slate-300"
                              >
                                {event.title}
                              </p>
                            ))}
                            {!row.events.length ? (
                              <span className="text-sm text-slate-600">
                                No recorded business change
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

function SpendRevenueTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: TrendPoint }>
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const categories = sortedBreakdown(point.spendBreakdown).slice(0, 4)

  return (
    <div className="min-w-64 rounded-xl border border-white/15 bg-slate-950 p-3 shadow-2xl">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        Week of {point.week}
      </p>
      <div className="mt-2 space-y-1 text-sm">
        <p className="flex justify-between gap-6 text-amber-300">
          <span>Reconciled marketing spend</span>
          <strong>{money(point.spend)}</strong>
        </p>
        <p className="flex justify-between gap-6 text-emerald-300">
          <span>Completed residential revenue</span>
          <strong>{money(point.revenue)}</strong>
        </p>
        <p className="flex justify-between gap-6 text-slate-400">
          <span>Completed residential jobs</span>
          <strong>{point.jobs}</strong>
        </p>
      </div>
      {categories.length ? (
        <div className="mt-3 border-t border-white/10 pt-2">
          <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            Spend details · {point.spendLineCount} QuickBooks lines + linked
            campaign costs
          </p>
          {categories.map(([channel, amount]) => (
            <p
              key={channel}
              className="flex justify-between gap-6 text-xs leading-5 text-slate-400"
            >
              <span>{channel}</span>
              <span>{money(amount)}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
  explanation,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  detail: string
  explanation: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-300">{label}</p>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>
      <p className="mt-1 text-sm text-slate-400">{detail}</p>
      <p className="mt-3 border-t border-white/5 pt-3 text-xs leading-5 text-slate-500">
        {explanation}
      </p>
    </article>
  )
}

function InsightCard({ insight }: { insight: BusinessInsight }) {
  const styles = {
    positive: {
      shell: 'border-emerald-400/20 bg-emerald-400/[0.05]',
      badge: 'text-emerald-300',
      icon: CircleCheck,
      badgeText: 'Positive signal',
    },
    attention: {
      shell: 'border-amber-400/20 bg-amber-400/[0.05]',
      badge: 'text-amber-300',
      icon: CircleAlert,
      badgeText: 'Worth investigating',
    },
    context: {
      shell: 'border-cyan-400/20 bg-cyan-400/[0.05]',
      badge: 'text-cyan-300',
      icon: Eye,
      badgeText: 'Important context',
    },
  }[insight.tone]
  const Icon = styles.icon

  return (
    <article className={`rounded-xl border p-4 ${styles.shell}`}>
      <div className={`flex items-center gap-2 text-xs ${styles.badge}`}>
        <Icon className="h-4 w-4" />
        <span className="font-semibold tracking-wide uppercase">
          {styles.badgeText}
        </span>
      </div>
      <h3 className="mt-2 text-base font-semibold text-white">
        {insight.title}
      </h3>
      <div className="mt-3 space-y-3 text-sm leading-6">
        <p className="text-slate-300">
          <strong className="text-slate-100">Evidence:</strong>{' '}
          {insight.evidence}
        </p>
        <p className="text-slate-400">
          <strong className="text-slate-200">What it may mean:</strong>{' '}
          {insight.meaning}
        </p>
        <p className="rounded-lg border border-white/10 bg-black/15 p-3 text-slate-300">
          <strong className="text-white">Useful next check:</strong>{' '}
          {insight.nextStep}
        </p>
      </div>
    </article>
  )
}

function Definition({
  term,
  definition,
}: {
  term: string
  definition: string
}) {
  return (
    <article className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
      <h3 className="font-medium text-white">{term}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{definition}</p>
    </article>
  )
}
