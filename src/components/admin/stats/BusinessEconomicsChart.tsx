'use client'

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
  ownerFieldHours: number
  ownerReplacementCost: number
  revenuePerHour: number
  bookCostPerHour: number
  ownerAdjustedCostPerHour: number
  bookCostPct: number
  ownerAdjustedCostPct: number
  ownerAdjustedMarginPct: number
  expenseBreakdown: Record<string, number>
}

const money = (value: number) => `$${Math.round(value).toLocaleString()}`

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
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
          <span>Owner-adjusted cost</span>
          <strong>{money(point.ownerAdjustedCostPerHour)}</strong>
        </div>
        <div className="text-muted-foreground flex justify-between gap-5">
          <span>QuickBooks cost</span>
          <strong>{money(point.bookCostPerHour)}</strong>
        </div>
        <div className="border-border mt-2 flex justify-between gap-5 border-t pt-2">
          <span>Cost share</span>
          <strong>{point.ownerAdjustedCostPct.toFixed(1)}%</strong>
        </div>
        <div className="flex justify-between gap-5">
          <span>Tracked margin</span>
          <strong>{point.ownerAdjustedMarginPct.toFixed(1)}%</strong>
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
  if (weeklySnapshots.length === 0) return null
  const latest = weeklySnapshots[weeklySnapshots.length - 1]
  const previous = weeklySnapshots[weeklySnapshots.length - 2]
  const costShare = Math.max(0, Math.min(100, latest.ownerAdjustedCostPct))
  const marginShare = Math.max(0, 100 - costShare)
  const topExpenses = Object.entries(latest.expenseBreakdown)
    .filter(([label, amount]) =>
      Boolean(label && amount > 0 && label !== 'Reconciliation Discrepancies'),
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
  const chartData = weeklySnapshots.map((snapshot) => ({
    ...snapshot,
    hourlyGapRange: [
      Math.min(snapshot.revenuePerHour, snapshot.ownerAdjustedCostPerHour),
      Math.max(snapshot.revenuePerHour, snapshot.ownerAdjustedCostPerHour),
    ],
    profitable: snapshot.revenuePerHour >= snapshot.ownerAdjustedCostPerHour,
  }))
  const gapColor = (profitable: boolean) => (profitable ? '#22c55e' : '#f43f5e')
  const gapStops = chartData.flatMap((point, index) => {
    if (index === 0) {
      return [{ offset: 0, color: gapColor(point.profitable) }]
    }
    const boundary = ((index - 0.5) / (chartData.length - 1)) * 100
    return [
      {
        offset: boundary,
        color: gapColor(chartData[index - 1].profitable),
      },
      { offset: boundary, color: gapColor(point.profitable) },
      ...(index === chartData.length - 1
        ? [{ offset: 100, color: gapColor(point.profitable) }]
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
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
                Owner-adjusted cost/hour
              </p>
              <p className="mt-1 text-3xl font-bold text-orange-300">
                {money(yearToDate.ownerAdjustedCostPerHour)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Tracked margin</p>
              <p className="mt-1 text-3xl font-bold text-violet-300">
                {yearToDate.ownerAdjustedMarginPct.toFixed(1)}%
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {yearToDate.ownerAdjustedCostPct.toFixed(1)}% cost share
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
          more sharply than the annual average. Weekly history begins in May,
          when complete operational time records became available.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-emerald-500/25 bg-emerald-500/[0.05] p-4">
          <p className="text-muted-foreground text-xs">Revenue/hour</p>
          <p className="mt-1 text-2xl font-bold text-emerald-300">
            {money(latest.revenuePerHour)}
          </p>
          {previous && (
            <Trend value={latest.revenuePerHour - previous.revenuePerHour} />
          )}
        </Card>
        <Card className="border-slate-500/25 bg-slate-500/[0.05] p-4">
          <p className="text-muted-foreground text-xs">QuickBooks cost/hour</p>
          <p className="mt-1 text-2xl font-bold text-slate-200">
            {money(latest.bookCostPerHour)}
          </p>
          {previous && (
            <Trend
              value={latest.bookCostPerHour - previous.bookCostPerHour}
              inverse
            />
          )}
        </Card>
        <Card className="border-orange-500/25 bg-orange-500/[0.05] p-4">
          <p className="text-muted-foreground text-xs">
            Owner-adjusted cost/hour
          </p>
          <p className="mt-1 text-2xl font-bold text-orange-300">
            {money(latest.ownerAdjustedCostPerHour)}
          </p>
          {previous && (
            <Trend
              value={
                latest.ownerAdjustedCostPerHour -
                previous.ownerAdjustedCostPerHour
              }
              inverse
            />
          )}
        </Card>
        <Card className="border-violet-500/25 bg-violet-500/[0.05] p-4">
          <p className="text-muted-foreground text-xs">Tracked margin</p>
          <p className="mt-1 text-2xl font-bold text-violet-300">
            {latest.ownerAdjustedMarginPct.toFixed(1)}%
          </p>
          {previous && (
            <Trend
              value={
                latest.ownerAdjustedMarginPct - previous.ownerAdjustedMarginPct
              }
            />
          )}
        </Card>
      </div>

      <Card className="border-border/60 bg-card/80 mt-4 overflow-hidden p-4 backdrop-blur sm:p-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="flex items-center gap-2 text-emerald-400">
            <span className="h-0.5 w-5 bg-emerald-400" /> Revenue/hour
          </span>
          <span className="flex items-center gap-2 text-orange-400">
            <span className="h-0.5 w-5 bg-orange-400" /> Owner-adjusted cost
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

        <div className="mt-3 h-72 w-full sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 12, right: 4, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id="business-hourly-gap"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="0"
                >
                  {gapStops.map((stop, index) => (
                    <stop
                      key={`${stop.offset}-${index}`}
                      offset={`${stop.offset}%`}
                      stopColor={stop.color}
                      stopOpacity={0.24}
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
                dataKey="windowEnd"
                tickFormatter={dateLabel}
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
                type="monotone"
                dataKey="hourlyGapRange"
                stroke="none"
                fill="url(#business-hourly-gap)"
                isAnimationActive={false}
              />
              <Line
                yAxisId="dollars"
                type="monotone"
                dataKey="revenuePerHour"
                stroke="#34d399"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4, fill: '#34d399', strokeWidth: 0 }}
              />
              <Line
                yAxisId="dollars"
                type="monotone"
                dataKey="ownerAdjustedCostPerHour"
                stroke="#fb923c"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4, fill: '#fb923c', strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-orange-300">
              {latest.ownerAdjustedCostPct.toFixed(1)}% cost
            </span>
            <span className="font-medium text-emerald-300">
              {latest.ownerAdjustedMarginPct.toFixed(1)}% tracked margin
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
              Largest QuickBooks costs in the latest week
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
          Both views use the cash-basis QuickBooks P&amp;L and remove
          reconciliation discrepancies. Owner-adjusted cost adds recorded owner
          field hours at $31/hour. They do not guess at depreciation, Square
          fees, loan principal, owner draws, income-tax payments, or untracked
          office time.
        </p>
      </Card>
    </section>
  )
}
