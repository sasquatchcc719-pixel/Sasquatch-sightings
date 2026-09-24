'use client'

import { useId, useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

export type BusinessCostSnapshot = {
  periodKind: 'rolling_28_day' | 'weekly' | 'year_to_date'
  windowStart: string
  windowEnd: string
  capturedAt: string
  revenue: number
  productiveHours: number
  quickbooksCost: number
  excludedBookkeepingAdjustments: number
  revenuePerHour: number
  bookCostPerHour: number
  bookCostPct: number
  expenseBreakdown: Record<string, number>
}

const money = (value: number) => `$${Math.round(value).toLocaleString()}`
const DAY_MS = 86_400_000

export type BusinessEconomicsRange = '30d' | '90d' | 'year'

type ChartPoint = BusinessCostSnapshot & {
  timestamp: number
  hourlyGapRange: [number, number]
  profitable: boolean
}

const RANGE_OPTIONS: Array<{
  value: BusinessEconomicsRange
  label: string
}> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'year', label: 'Calendar year' },
]

function dateTimestamp(date: string) {
  return new Date(`${date}T12:00:00Z`).getTime()
}

export function filterBusinessCostSnapshots(
  snapshots: BusinessCostSnapshot[],
  range: BusinessEconomicsRange,
): BusinessCostSnapshot[] {
  const latest = snapshots.at(-1)
  if (!latest) return []
  if (range === 'year') {
    const year = latest.windowEnd.slice(0, 4)
    return snapshots.filter((snapshot) => snapshot.windowEnd.startsWith(year))
  }
  const days = range === '30d' ? 30 : 90
  const cutoff = dateTimestamp(latest.windowEnd) - (days - 1) * DAY_MS
  return snapshots.filter(
    (snapshot) => dateTimestamp(snapshot.windowEnd) >= cutoff,
  )
}

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function axisDateLabel(value: number, range: BusinessEconomicsRange) {
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    ...(range === 'year' ? {} : { day: 'numeric' }),
  })
}

function Trend({
  value,
  inverse = false,
}: {
  value: number
  inverse?: boolean
}) {
  if (Math.abs(value) < 0.05) {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <Minus className="h-3 w-3" /> unchanged
      </span>
    )
  }
  const improved = inverse ? value < 0 : value > 0
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`flex items-center gap-1 text-xs ${improved ? 'text-emerald-400' : 'text-rose-400'}`}
    >
      <Icon className="h-3 w-3" />
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}
    </span>
  )
}

function EconomicsTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: BusinessCostSnapshot }>
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="border-border/70 bg-background/95 min-w-56 rounded-lg border p-3 text-xs shadow-xl backdrop-blur">
      <p className="font-semibold">
        {dateLabel(point.windowStart)}–{dateLabel(point.windowEnd)}
      </p>
      <p className="text-muted-foreground mt-0.5">Thursday–Wednesday week</p>
      <div className="mt-3 space-y-1.5">
        <div className="flex justify-between gap-5 text-emerald-400">
          <span>Revenue/hour</span>
          <strong>{money(point.revenuePerHour)}</strong>
        </div>
        <div className="flex justify-between gap-5 text-orange-400">
          <span>QuickBooks cost/hour</span>
          <strong>{money(point.bookCostPerHour)}</strong>
        </div>
        <div className="border-border mt-2 flex justify-between gap-5 border-t pt-2">
          <span>Cost share</span>
          <strong>{point.bookCostPct.toFixed(1)}%</strong>
        </div>
        <div className="flex justify-between gap-5">
          <span>Margin after costs</span>
          <strong>{(100 - point.bookCostPct).toFixed(1)}%</strong>
        </div>
      </div>
    </div>
  )
}

export function BusinessEconomicsChart({
  weeklySnapshots,
  yearToDate,
}: {
  weeklySnapshots: BusinessCostSnapshot[]
  yearToDate: BusinessCostSnapshot | null
}) {
  const [range, setRange] = useState<BusinessEconomicsRange>('90d')
  const [selectedWindowEnd, setSelectedWindowEnd] = useState<string | null>(
    null,
  )
  const gradientId = `business-hourly-gap-${useId().replaceAll(':', '')}`
  const filteredSnapshots = useMemo(
    () => filterBusinessCostSnapshots(weeklySnapshots, range),
    [range, weeklySnapshots],
  )
  const chartData = useMemo<ChartPoint[]>(
    () =>
      filteredSnapshots.map((snapshot) => ({
        ...snapshot,
        timestamp: dateTimestamp(snapshot.windowEnd),
        hourlyGapRange: [
          Math.min(snapshot.revenuePerHour, snapshot.bookCostPerHour),
          Math.max(snapshot.revenuePerHour, snapshot.bookCostPerHour),
        ],
        profitable: snapshot.revenuePerHour >= snapshot.bookCostPerHour,
      })),
    [filteredSnapshots],
  )

  if (weeklySnapshots.length === 0) return null
  const latest = weeklySnapshots[weeklySnapshots.length - 1]
  const previous = weeklySnapshots[weeklySnapshots.length - 2]
  const selected =
    filteredSnapshots.find(
      (snapshot) => snapshot.windowEnd === selectedWindowEnd,
    ) ||
    filteredSnapshots.at(-1) ||
    latest
  const costShare = Math.max(0, Math.min(100, selected.bookCostPct))
  const marginShare = Math.max(0, 100 - costShare)
  const topExpenses = Object.entries(selected.expenseBreakdown)
    .filter(([label, amount]) =>
      Boolean(label && amount > 0 && label !== 'Reconciliation Discrepancies'),
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
  const latestTimestamp = dateTimestamp(latest.windowEnd)
  const chartDomain: [number, number] =
    range === 'year'
      ? [
          Date.UTC(Number(latest.windowEnd.slice(0, 4)), 0, 1, 12),
          Date.UTC(Number(latest.windowEnd.slice(0, 4)), 11, 31, 12),
        ]
      : [
          latestTimestamp - (range === '30d' ? 29 : 89) * DAY_MS,
          latestTimestamp,
        ]
  const gapColor = (profitable: boolean) => (profitable ? '#22c55e' : '#f43f5e')
  const gapOpacity = (profitable: boolean) => (profitable ? 0.22 : 0.48)
  const gapStops = chartData.flatMap((point, index) => {
    if (index === 0) {
      return [
        {
          offset: 0,
          color: gapColor(point.profitable),
          opacity: gapOpacity(point.profitable),
        },
      ]
    }
    const boundary = ((index - 0.5) / (chartData.length - 1)) * 100
    return [
      {
        offset: boundary,
        color: gapColor(chartData[index - 1].profitable),
        opacity: gapOpacity(chartData[index - 1].profitable),
      },
      {
        offset: boundary,
        color: gapColor(point.profitable),
        opacity: gapOpacity(point.profitable),
      },
      ...(index === chartData.length - 1
        ? [
            {
              offset: 100,
              color: gapColor(point.profitable),
              opacity: gapOpacity(point.profitable),
            },
          ]
        : []),
    ]
  })

  return (
    <section className="mb-8" aria-labelledby="business-economics-heading">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="business-economics-heading"
            className="text-gradient text-xl font-semibold tracking-tight"
          >
            Business Economics
          </h2>
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
            The year-to-date average answers what the business normally earns
            and costs. The weekly view shows what moved in the most recently
            completed Thursday–Wednesday periods.
          </p>
        </div>
        <span className="w-fit rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
          Updated from QuickBooks weekly
        </span>
      </div>

      {yearToDate && (
        <Card className="via-card/85 border-cyan-500/25 bg-gradient-to-br from-cyan-500/[0.08] to-violet-500/[0.06] p-4 sm:p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-cyan-300 uppercase">
                {yearToDate.windowEnd.slice(0, 4)} year-to-date average
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {dateLabel(yearToDate.windowStart)} through{' '}
                {dateLabel(yearToDate.windowEnd)}
              </p>
            </div>
            <p className="text-muted-foreground text-xs">
              Big-picture operating benchmark
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-xs">Revenue/hour</p>
              <p className="mt-1 text-3xl font-bold text-emerald-300">
                {money(yearToDate.revenuePerHour)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">
                QuickBooks cost/hour
              </p>
              <p className="mt-1 text-3xl font-bold text-slate-100">
                {money(yearToDate.bookCostPerHour)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">
                Margin after costs
              </p>
              <p className="mt-1 text-3xl font-bold text-violet-300">
                {(100 - yearToDate.bookCostPct).toFixed(1)}%
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {yearToDate.bookCostPct.toFixed(1)}% cost share
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-6 mb-3">
        <h3 className="text-lg font-semibold text-amber-300">
          Weekly movement
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Latest completed week: {dateLabel(latest.windowStart)}–
          {dateLabel(latest.windowEnd)}. Weekly expenses will naturally move
          more sharply than the annual average. Use the range controls below to
          compare the last 30 days, 90 days, or the calendar year.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card className="border-emerald-500/25 bg-emerald-500/[0.05] p-4">
          <p className="text-muted-foreground text-xs">Revenue/hour</p>
          <p className="mt-1 text-2xl font-bold text-emerald-300">
            {money(latest.revenuePerHour)}
          </p>
          {previous && (
            <Trend value={latest.revenuePerHour - previous.revenuePerHour} />
          )}
        </Card>
        <Card className="border-orange-500/25 bg-orange-500/[0.05] p-4">
          <p className="text-muted-foreground text-xs">QuickBooks cost/hour</p>
          <p className="mt-1 text-2xl font-bold text-orange-300">
            {money(latest.bookCostPerHour)}
          </p>
          {previous && (
            <Trend
              value={latest.bookCostPerHour - previous.bookCostPerHour}
              inverse
            />
          )}
        </Card>
        <Card className="border-violet-500/25 bg-violet-500/[0.05] p-4">
          <p className="text-muted-foreground text-xs">Margin after costs</p>
          <p className="mt-1 text-2xl font-bold text-violet-300">
            {(100 - latest.bookCostPct).toFixed(1)}%
          </p>
          {previous && (
            <Trend value={previous.bookCostPct - latest.bookCostPct} />
          )}
        </Card>
      </div>

      <Card className="border-border/60 bg-card/80 mt-4 overflow-hidden p-4 backdrop-blur sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <span className="flex items-center gap-2 text-emerald-400">
                <span className="h-0.5 w-5 bg-emerald-400" /> Revenue/hour
              </span>
              <span className="flex items-center gap-2 text-orange-400">
                <span className="h-0.5 w-5 bg-orange-400" /> QuickBooks
                cost/hour
              </span>
              <span className="flex items-center gap-2 text-emerald-400">
                <span className="h-2.5 w-5 rounded-sm bg-emerald-500/25" />
                Profitable gap
              </span>
              <span className="flex items-center gap-2 text-rose-400">
                <span className="h-2.5 w-5 rounded-sm bg-rose-500/25" />
                Loss gap
              </span>
            </div>
            <p className="text-muted-foreground mt-2 text-[11px]">
              {filteredSnapshots.length} weekly readings · Click any point for
              its full breakdown
            </p>
          </div>
          <div
            className="bg-background/50 grid grid-cols-3 rounded-lg border border-slate-700/70 p-1"
            role="group"
            aria-label="Business economics chart range"
          >
            {RANGE_OPTIONS.map((option) => {
              const active = range === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setRange(option.value)
                    setSelectedWindowEnd(null)
                  }}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-cyan-500/20 text-cyan-200 shadow-sm'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-slate-100'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-3 h-72 w-full sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 12, right: 4, left: 0, bottom: 0 }}
              accessibilityLayer
              onClick={(state) => {
                const point = state.activePayload?.[0]?.payload as
                  | ChartPoint
                  | undefined
                if (point) setSelectedWindowEnd(point.windowEnd)
              }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                  {gapStops.map((stop, index) => (
                    <stop
                      key={`${stop.offset}-${index}`}
                      offset={`${stop.offset}%`}
                      stopColor={stop.color}
                      stopOpacity={stop.opacity}
                    />
                  ))}
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="rgba(148,163,184,0.14)"
              />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={chartDomain}
                tickFormatter={(value: number) => axisDateLabel(value, range)}
                minTickGap={28}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 10 }}
                className="text-muted-foreground"
              />
              <YAxis
                yAxisId="dollars"
                tickFormatter={(value: number) => `$${Math.round(value)}`}
                width={48}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 10 }}
                className="text-muted-foreground"
              />
              <Tooltip
                content={<EconomicsTooltip />}
                cursor={{ stroke: 'rgba(148,163,184,0.35)' }}
              />
              <Area
                yAxisId="dollars"
                type="linear"
                dataKey="hourlyGapRange"
                stroke="none"
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
              />
              <Line
                yAxisId="dollars"
                type="linear"
                dataKey="revenuePerHour"
                stroke="#34d399"
                strokeWidth={3}
                dot={{
                  r: 3.5,
                  fill: '#07111f',
                  stroke: '#34d399',
                  strokeWidth: 2,
                  cursor: 'pointer',
                }}
                activeDot={{ r: 6, fill: '#34d399', strokeWidth: 0 }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="dollars"
                type="linear"
                dataKey="bookCostPerHour"
                stroke="#fb923c"
                strokeWidth={3}
                dot={{
                  r: 3.5,
                  fill: '#07111f',
                  stroke: '#fb923c',
                  strokeWidth: 2,
                  cursor: 'pointer',
                }}
                activeDot={{ r: 6, fill: '#fb923c', strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div
          id="business-economics-reading"
          className="border-border/60 bg-background/35 mt-4 rounded-xl border p-4"
          aria-live="polite"
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-cyan-300 uppercase">
                Selected weekly reading
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-100">
                {dateLabel(selected.windowStart)}–
                {dateLabel(selected.windowEnd)}
              </p>
            </div>
            <p className="text-muted-foreground text-xs">
              Thursday–Wednesday · {selected.productiveHours.toFixed(1)}{' '}
              productive hours
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-[11px] uppercase">
                Total revenue
              </p>
              <p className="mt-1 text-xl font-bold text-slate-100">
                {money(selected.revenue)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase">
                Revenue/hour
              </p>
              <p className="mt-1 text-xl font-bold text-emerald-300">
                {money(selected.revenuePerHour)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase">
                QuickBooks cost/hour
              </p>
              <p className="mt-1 text-xl font-bold text-slate-200">
                {money(selected.bookCostPerHour)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase">
                QuickBooks cost
              </p>
              <p className="mt-1 text-base font-semibold text-slate-100">
                {money(selected.quickbooksCost)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase">
                Cost share
              </p>
              <p className="mt-1 text-base font-semibold text-orange-300">
                {selected.bookCostPct.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] uppercase">
                Margin after costs
              </p>
              <p
                className={`mt-1 text-base font-semibold ${
                  100 - selected.bookCostPct >= 0
                    ? 'text-emerald-300'
                    : 'text-rose-300'
                }`}
              >
                {(100 - selected.bookCostPct).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-orange-300">
              {selected.bookCostPct.toFixed(1)}% cost
            </span>
            <span className="font-medium text-emerald-300">
              {(100 - selected.bookCostPct).toFixed(1)}% margin after costs
            </span>
          </div>
          <div className="bg-muted flex h-3 overflow-hidden rounded-full">
            <div
              className="bg-gradient-to-r from-amber-500 to-orange-500"
              style={{ width: `${costShare}%` }}
            />
            <div
              className="bg-gradient-to-r from-emerald-600 to-emerald-400"
              style={{ width: `${marginShare}%` }}
            />
          </div>
        </div>

        {topExpenses.length > 0 && (
          <div className="border-border/60 mt-5 border-t pt-4">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Largest QuickBooks costs in the selected week
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {topExpenses.map(([label, amount]) => (
                <span
                  key={label}
                  className="border-border/60 bg-background/40 rounded-full border px-2.5 py-1 text-xs"
                >
                  {label}: <strong>{money(amount)}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-muted-foreground mt-4 text-[11px] leading-relaxed">
          Both views use actual cash-basis QuickBooks P&amp;L expenses and
          remove reconciliation discrepancies. No estimate is added for owner
          labor, depreciation, Square fees, loan principal, owner draws,
          income-tax payments, or untracked office time. The calendar-year chart
          leaves January through early May blank because reliable week-level
          time records begin May 7; the YTD benchmark above still includes
          January onward.
        </p>
      </Card>
    </section>
  )
}
