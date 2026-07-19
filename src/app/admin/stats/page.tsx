'use client'

import { Fragment, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/supabase/client'
import {
  Loader2,
  DollarSign,
  Clock,
  TrendingUp,
  TrendingDown,
  Target,
  Briefcase,
  Plus,
  Settings as SettingsIcon,
  Rocket,
  CalendarCheck,
  CalendarDays,
  HardHat,
  ChevronDown,
  Mail,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type OpsStats = {
  weekStart: string
  weekEnd: string
  jobCount: number
  invoicedJobCount: number
  totalRevenue: number
  averageTicket: number
  statusCounts: Record<string, number>
  paymentStatusCounts: Record<string, number>
  leadSourceCounts: Record<string, number>
}

type CalendarPipelineMonth = {
  month: number
  label: string
  completedRevenue: number
  completedJobCount: number
  bookedRevenue: number
  bookedJobCount: number
}

type RevenueProjectionData = {
  ytdActual: number
  bookedRemainder: number
  projectedRemainder: number
  projectedAnnual: number
  method: 'seasonal' | 'linear'
  annualizedRunRate: number
  elapsedShare: number
  remainingShare: number
  recentWindowLabel: string
  recentWindowRevenue: number
  seasonalityYears: number[]
  bookedIsFloor: boolean
}

type CalendarPipeline = {
  year: number
  currentMonth: number
  totalCompleted: number
  totalBooked: number
  months: CalendarPipelineMonth[]
  projection: RevenueProjectionData | null
}

type Settings = {
  annual_revenue_goal: number
  available_hours_per_week: number
  work_weeks_per_year: number
  hiring_threshold: number
  hiring_consecutive_weeks: number
}

type Stats = {
  thisWeek: {
    jobs: number
    revenue: number
    hours: number
    revenuePerHour: number
    averageTicket: number
  }
  yearToDate: {
    jobs: number
    revenue: number
    hours: number
    revenuePerHour: number
    utilization: number
    availableHours: number
  }
  pace: {
    weeklyTarget: number
    weeklyAverage: number
    projectedAnnual: number
    onPace: boolean
    percentOfGoal: number
  }
  potential: {
    revenueAtFullUtilizationYTD: number
    revenueLeftOnTableYTD: number
    annualRevenueAtFullUtilization: number
    annualRevenueLeftOnTable: number
    totalAvailableHoursAnnual: number
    scheduleBased: boolean
    currentWeeklyCapacity: number | null
  }
}

type ScheduleCapacity = {
  ytdAvailableHours: number
  annualAvailableHours: number
  currentWeeklyCapacity: number
  lastToggleDate: string | null
}

type TechMonthRow = {
  month: string
  jobs: number
  revenue: number
  jobHours: number
  paidHours: number
  grossWages: number
  revenuePerPaidHour: number
  laborPercent: number
  billableEfficiency: number
  profitAfterWages: number
}

type TechDayRow = Omit<TechMonthRow, 'month'> & {
  date: string
  profitPerHour: number
  isLive: boolean
}

type TechPerformance = {
  staffUserId: string
  displayName: string
  days: TechDayRow[]
  months: TechMonthRow[]
  totals: Omit<TechMonthRow, 'month'>
}

type BusinessHealth = {
  retention: {
    sinceDate: string
    customers: number
    repeatCustomers: number
    repeatRatePct: number
    repeatRevenue: number
    totalRevenue: number
    avgCustomerValue: number
    avgTicket: number
    medianDaysBetweenVisits: number | null
    hcpCustomers: number
    crossSystemRepeats: number
    dueSoonCount: number
    overdueCount: number
    dueList: {
      customerId: string
      name: string
      lastService: string
      jobs: number
      lifetimeValue: number
      monthsSince: number
      reactivationStatus?: string | null
    }[]
  }
  recurring: {
    completedRevenue: number
    completedJobs: number
    bookedRevenue: number
    bookedJobs: number
    pctOfCompletedRevenue: number
  }
  bookedOut: {
    staffUserId: string
    staffName: string
    daysOut: number | null
    nextOpenDate: string | null
  }[]
  bookedOutScanDays: number
  reactivationEngineEnabled: boolean | null
}

type BookingFunnel = {
  windowDays: number | null
  steps: {
    step: string
    label: string
    sessions: number
    pctOfQuotes: number
    droppedFromPrevious: number
  }[]
  visitorSessions: number
  quoteSessions: number
  bookedSessions: number
  quoteToBookRate: number
  visitToQuoteRate: number
  visitToBookRate: number
  abandonedQuotes: number
  abandonedQuoteValue: number
  bookedQuoteValue: number
  avgAbandonedQuote: number
  biggestDropStep: string | null
  biggestDropCount: number
  topAbandonedReferrers: { referrer: string; sessions: number }[]
}

type YearSummary = {
  year: number
  fullYear: number
  throughToday: number
  invoices: number
  invoicesThroughToday: number
  avgTicket: number
  medianTicket: number
  ytdGrowthPct: number | null
  isCurrentYear: boolean
}

type YearOverYear = {
  years: YearSummary[]
  currentYear: number
  ytd: number
  priorYtd: number
  ytdGrowthPct: number | null
  priorFullYear: number
  pctOfPriorFullYear: number | null
  asOfLabel: string
}

type LeadSourceRevenue = {
  lead_source: string
  booking_count: number
  completed_count: number
  total_revenue: number
  avg_ticket: number
  percentage: number
}

type DueRow = BusinessHealth['retention']['dueList'][number]
type DueSortKey =
  | 'name'
  | 'lastService'
  | 'monthsSince'
  | 'jobs'
  | 'lifetimeValue'
  | 'reactivationStatus'

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)

function reactivationLabel(rs?: string | null) {
  if (!rs) return 'not enrolled'
  if (rs === 'active') return 'queued'
  if (rs.startsWith('suppressed')) return 'suppressed'
  return rs.replace(/_/g, ' ')
}

type CustomerEmailEntry = {
  source: 'reactivation' | 'drip' | 'transactional'
  subject: string | null
  to_email: string | null
  status: string | null
  sent_at: string | null
  template: string | null
}

type EmailHistoryState = {
  loading: boolean
  emails: CustomerEmailEntry[]
  counts: Record<string, number>
}

const EMAIL_SOURCE_LABEL: Record<CustomerEmailEntry['source'], string> = {
  reactivation: 'Reactivation',
  drip: 'Post-job drip',
  transactional: 'Job emails',
}

function DueRecleanTable({ rows }: { rows: DueRow[] }) {
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [sortKey, setSortKey] = useState<DueSortKey>('lifetimeValue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [query, setQuery] = useState('')
  const [bucket, setBucket] = useState<'all' | 'due' | 'overdue'>('all')
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null)
  const [emailHistory, setEmailHistory] = useState<
    Record<string, EmailHistoryState>
  >({})

  const toggleCustomer = (customerId: string) => {
    const next = openCustomerId === customerId ? null : customerId
    setOpenCustomerId(next)
    if (next && !emailHistory[next]) {
      setEmailHistory((h) => ({
        ...h,
        [next]: { loading: true, emails: [], counts: {} },
      }))
      fetch(
        `/api/admin/stats/customer-emails?customerId=${encodeURIComponent(next)}`,
        { cache: 'no-store' },
      )
        .then(async (res) => (res.ok ? res.json() : { emails: [], counts: {} }))
        .catch(() => ({ emails: [], counts: {} }))
        .then(
          (json: {
            emails?: CustomerEmailEntry[]
            counts?: Record<string, number>
          }) => {
            setEmailHistory((h) => ({
              ...h,
              [next]: {
                loading: false,
                emails: json.emails || [],
                counts: json.counts || {},
              },
            }))
          },
        )
    }
  }

  const toggleSort = (key: DueSortKey, defaultDir: 'asc' | 'desc') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(defaultDir)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (bucket === 'due' && r.monthsSince >= 6) return false
    if (bucket === 'overdue' && r.monthsSince < 6) return false
    if (q && !r.name.toLowerCase().includes(q)) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let av: string | number
    let bv: string | number
    switch (sortKey) {
      case 'name':
        av = a.name.toLowerCase()
        bv = b.name.toLowerCase()
        break
      case 'lastService':
        av = a.lastService
        bv = b.lastService
        break
      case 'reactivationStatus':
        av = reactivationLabel(a.reactivationStatus)
        bv = reactivationLabel(b.reactivationStatus)
        break
      default:
        av = a[sortKey]
        bv = b[sortKey]
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    // Tie-break by lifetime value so order is stable.
    return b.lifetimeValue - a.lifetimeValue
  })

  const arrow = (key: DueSortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  // Plain JSX helper (not a nested component) so header cells don't remount.
  const headerCell = (
    label: string,
    sortKeyName: DueSortKey,
    defaultDir: 'asc' | 'desc',
    opts?: { align?: 'left' | 'right'; last?: boolean },
  ) => {
    const align = opts?.align ?? 'right'
    return (
      <th
        className={`pb-2 font-medium ${opts?.last ? '' : 'pr-3'} ${
          align === 'left' ? 'text-left' : 'text-right'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleSort(sortKeyName, defaultDir)}
          className={`hover:text-foreground inline-flex items-center gap-0.5 ${
            sortKey === sortKeyName ? 'text-foreground font-semibold' : ''
          } ${align === 'right' ? 'flex-row-reverse' : ''}`}
        >
          <span>{label}</span>
          <span className="w-2 text-[10px]">{arrow(sortKeyName)}</span>
        </button>
      </th>
    )
  }

  const visible = showAll ? sorted : sorted.slice(0, 25)

  return (
    <Card className="border-border/60 bg-card/80 mt-4 p-4 backdrop-blur">
      {/* Always-visible header: summary + expand toggle + jump to the tool */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 text-left"
        >
          <ChevronDown
            className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform ${
              expanded ? '' : '-rotate-90'
            }`}
          />
          <h4 className="text-sm font-semibold">
            Due-for-Reclean Customers{' '}
            <span className="text-muted-foreground font-normal">
              ({rows.length} customers
              {expanded && filtered.length !== rows.length
                ? ` · showing ${filtered.length}`
                : ''}
              )
            </span>
          </h4>
        </button>
        <a
          href="/admin/email-outbox#reactivation"
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-500 hover:bg-emerald-500/10"
        >
          <Mail className="h-3.5 w-3.5" />
          Open Reactivation Center →
        </a>
      </div>

      {!expanded && (
        <p className="text-muted-foreground mt-2 ml-6 text-xs">
          Click to expand — sortable and searchable list of everyone due for a
          reclean.
        </p>
      )}

      {expanded && (
        <>
          <div className="mt-3 mb-3 flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border text-xs">
              {(
                [
                  ['all', 'All'],
                  ['due', 'Due soon'],
                  ['overdue', 'Overdue'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBucket(key)}
                  className={`px-2.5 py-1 ${
                    bucket === key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name…"
              className="h-8 w-40 text-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  {headerCell('Customer', 'name', 'asc', { align: 'left' })}
                  {headerCell('Last Clean', 'lastService', 'asc')}
                  {headerCell('Months Ago', 'monthsSince', 'desc')}
                  {headerCell('Visits', 'jobs', 'desc')}
                  {headerCell('Lifetime Value', 'lifetimeValue', 'desc')}
                  {headerCell('Reactivation', 'reactivationStatus', 'asc', {
                    last: true,
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const rs = c.reactivationStatus
                  const rsColor =
                    rs === 'active'
                      ? 'text-emerald-500'
                      : !rs || rs.startsWith('excluded')
                        ? 'text-muted-foreground'
                        : 'text-amber-600 dark:text-amber-400'
                  const isOpen = openCustomerId === c.customerId
                  const history = emailHistory[c.customerId]
                  return (
                    <Fragment key={c.customerId}>
                      <tr
                        onClick={() => toggleCustomer(c.customerId)}
                        className={`border-b/50 hover:bg-muted/40 cursor-pointer border-b ${isOpen ? 'bg-muted/30' : ''}`}
                      >
                        <td className="py-2 pr-3 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <ChevronDown
                              className={`text-muted-foreground h-3 w-3 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                            />
                            {c.name}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">
                          {new Date(
                            c.lastService + 'T12:00:00',
                          ).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-medium ${c.monthsSince >= 6 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
                        >
                          {c.monthsSince.toFixed(1)}
                        </td>
                        <td className="py-2 pr-3 text-right">{c.jobs}</td>
                        <td className="py-2 pr-3 text-right font-semibold">
                          {usd(c.lifetimeValue)}
                        </td>
                        <td
                          className={`py-2 text-right text-xs font-medium ${rsColor}`}
                        >
                          {reactivationLabel(rs)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b/50 border-b">
                          <td colSpan={6} className="bg-muted/20 px-4 py-3">
                            {!history || history.loading ? (
                              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading email history…
                              </div>
                            ) : history.emails.length === 0 ? (
                              <p className="text-muted-foreground text-xs">
                                No emails have ever been sent to this customer
                                through the system
                                {c.customerId.includes(':')
                                  ? ' (historical-import customer — not in the CRM yet)'
                                  : ''}
                                .
                              </p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs font-medium">
                                  {history.emails.length} email
                                  {history.emails.length !== 1 ? 's' : ''} sent
                                  {Object.entries(history.counts)
                                    .map(
                                      ([src, n]) =>
                                        ` · ${EMAIL_SOURCE_LABEL[src as CustomerEmailEntry['source']] ?? src}: ${n}`,
                                    )
                                    .join('')}
                                </p>
                                <div className="max-h-48 space-y-1 overflow-y-auto">
                                  {history.emails.map((e, i) => (
                                    <div
                                      key={i}
                                      className="flex items-baseline gap-2 text-xs"
                                    >
                                      <span className="text-muted-foreground w-20 shrink-0 whitespace-nowrap">
                                        {e.sent_at
                                          ? new Date(
                                              e.sent_at,
                                            ).toLocaleDateString('en-US', {
                                              month: 'short',
                                              day: 'numeric',
                                              year: 'numeric',
                                            })
                                          : '—'}
                                      </span>
                                      <span
                                        className={`w-24 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${
                                          e.source === 'reactivation'
                                            ? 'bg-emerald-500/15 text-emerald-500'
                                            : e.source === 'drip'
                                              ? 'bg-blue-500/15 text-blue-400'
                                              : 'bg-slate-500/15 text-slate-400'
                                        }`}
                                      >
                                        {EMAIL_SOURCE_LABEL[e.source]}
                                      </span>
                                      <span className="truncate">
                                        {e.subject ||
                                          e.template ||
                                          '(no subject)'}
                                      </span>
                                      {e.status && e.status !== 'sent' && (
                                        <span className="text-amber-500">
                                          {e.status}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="text-muted-foreground py-6 text-center text-xs"
                    >
                      No customers match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!showAll && sorted.length > 25 && (
            <div className="mt-3 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAll(true)}
              >
                Show all {sorted.length} customers
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

type ProfitabilityTooltipProps = {
  active?: boolean
  payload?: { payload: TechDayRow }[]
}

function ProfitabilityTooltip({ active, payload }: ProfitabilityTooltipProps) {
  if (!active || !payload?.length) return null

  const day = payload[0].payload
  const hourValue = day.paidHours > 0 ? day.paidHours : day.jobHours
  return (
    <div className="border-border/80 bg-popover min-w-44 rounded-lg border p-3 text-xs shadow-xl">
      <p className="mb-2 font-semibold">
        {new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}
        {day.isLive && (
          <span className="ml-2 text-[10px] font-medium text-emerald-400">
            IN PROGRESS
          </span>
        )}
      </p>
      <div className="text-muted-foreground space-y-1">
        <div className="flex justify-between gap-5">
          <span>Revenue</span>
          <span className="text-foreground font-medium">
            {usd(day.revenue)}
          </span>
        </div>
        <div className="flex justify-between gap-5">
          <span>Gross wages</span>
          <span className="text-foreground font-medium">
            {usd(day.grossWages)}
          </span>
        </div>
        <div className="flex justify-between gap-5">
          <span>{day.paidHours > 0 ? 'Paid hours' : 'Job hours'}</span>
          <span className="text-foreground font-medium">
            {hourValue.toFixed(1)}
          </span>
        </div>
        <div className="border-border mt-2 flex justify-between gap-5 border-t pt-2">
          <span>Profit / hour</span>
          <span
            className={`font-semibold ${day.profitPerHour >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {usd(day.profitPerHour)}
          </span>
        </div>
      </div>
    </div>
  )
}

function DailyProfitabilityChart({ days }: { days: TechDayRow[] }) {
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30)
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - rangeDays + 1)
  const cutoffKey = [
    cutoff.getFullYear(),
    String(cutoff.getMonth() + 1).padStart(2, '0'),
    String(cutoff.getDate()).padStart(2, '0'),
  ].join('-')
  const visibleDays = days.filter((day) => day.date >= cutoffKey)
  const chartData = visibleDays.map((day) => ({
    ...day,
    timestamp: new Date(`${day.date}T12:00:00`).getTime(),
  }))
  const latest = visibleDays[visibleDays.length - 1]

  return (
    <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">Daily Profit / Paid Hr</h4>
            <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              LIVE
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Revenue minus gross wages, divided by paid hours.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {latest && (
            <div className="text-right">
              <p
                className={`text-lg leading-none font-bold ${latest.profitPerHour >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {usd(latest.profitPerHour)}/hr
              </p>
              <p className="text-muted-foreground mt-1 text-[10px]">
                {latest.isLive ? 'today · in progress' : 'latest workday'}
              </p>
            </div>
          )}
          <div className="bg-muted/60 flex rounded-md p-0.5">
            {([7, 30, 90] as const).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setRangeDays(range)}
                className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  rangeDays === range
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-pressed={rangeDays === range}
              >
                {range}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {chartData.length > 0 ? (
        <div
          className="mt-4 h-52 w-full"
          aria-label="Daily profit per hour chart"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="rgba(148,163,184,0.14)"
              />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value: number) =>
                  new Date(value).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                }
                minTickGap={24}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 10 }}
                className="text-muted-foreground"
              />
              <YAxis
                tickFormatter={(value: number) => `$${Math.round(value)}`}
                width={48}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 10 }}
                className="text-muted-foreground"
              />
              <ReferenceLine
                y={0}
                stroke="rgba(248,113,113,0.55)"
                strokeDasharray="4 4"
              />
              <Tooltip
                content={<ProfitabilityTooltip />}
                cursor={{ stroke: 'rgba(52,211,153,0.35)' }}
              />
              <Line
                type="monotone"
                dataKey="profitPerHour"
                stroke="#34d399"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#34d399', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#34d399', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
          No work or timesheet activity in this range.
        </div>
      )}
      <p className="text-muted-foreground mt-2 text-[10px]">
        Refreshes every minute. Open shifts use live clock time; days without
        activity are left blank.
      </p>
    </Card>
  )
}

export default function StatsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [opsStats, setOpsStats] = useState<OpsStats | null>(null)
  const [opsLoading, setOpsLoading] = useState(true)
  const [pipeline, setPipeline] = useState<CalendarPipeline | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)
  const [techPerf, setTechPerf] = useState<TechPerformance[]>([])
  const [health, setHealth] = useState<BusinessHealth | null>(null)
  const [sourceRevenue, setSourceRevenue] = useState<LeadSourceRevenue[]>([])
  const [funnel, setFunnel] = useState<BookingFunnel | null>(null)
  const [history, setHistory] = useState<YearOverYear | null>(null)

  // Quick entry form state
  const [showQuickEntry, setShowQuickEntry] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().split('T')[0],
  )
  const [description, setDescription] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [hoursWorked, setHoursWorked] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Settings editor state
  const [showSettingsEditor, setShowSettingsEditor] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [editAnnualGoal, setEditAnnualGoal] = useState('')
  const [editHoursPerWeek, setEditHoursPerWeek] = useState('')
  const [editWeeksPerYear, setEditWeeksPerYear] = useState('')
  const [editHiringThreshold, setEditHiringThreshold] = useState('')
  const [editHiringConsecutiveWeeks, setEditHiringConsecutiveWeeks] =
    useState('')

  const handleQuickEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const response = await fetch('/api/revenue-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_date: entryDate,
          description,
          invoice_amount: parseFloat(invoiceAmount),
          hours_worked: parseFloat(hoursWorked),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create entry')
      }

      // Reset form
      setDescription('')
      setInvoiceAmount('')
      setHoursWorked('')
      setEntryDate(new Date().toISOString().split('T')[0])
      setShowQuickEntry(false)

      // Refresh data
      fetchData()
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to save entry',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingSettings(true)
    setSettingsError(null)

    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error('Not authenticated')

      const newSettings = {
        annual_revenue_goal: parseFloat(editAnnualGoal),
        available_hours_per_week: parseFloat(editHoursPerWeek),
        work_weeks_per_year: parseInt(editWeeksPerYear),
        hiring_threshold: parseFloat(editHiringThreshold),
        hiring_consecutive_weeks: parseInt(editHiringConsecutiveWeeks),
        updated_at: new Date().toISOString(),
      }

      // Check if settings exist for this user
      const { data: existingSettings } = await supabase
        .from('settings')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (existingSettings) {
        // Update existing settings
        const { error: updateError } = await supabase
          .from('settings')
          .update(newSettings)
          .eq('user_id', user.id)

        if (updateError) throw updateError
      } else {
        // Insert new settings
        const { error: insertError } = await supabase
          .from('settings')
          .insert({ ...newSettings, user_id: user.id })

        if (insertError) throw insertError
      }

      setShowSettingsEditor(false)
      fetchData() // Refresh all stats with new settings
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : 'Failed to save settings',
      )
    } finally {
      setIsSavingSettings(false)
    }
  }

  const openSettingsEditor = () => {
    if (settings) {
      setEditAnnualGoal(settings.annual_revenue_goal.toString())
      setEditHoursPerWeek(settings.available_hours_per_week.toString())
      setEditWeeksPerYear(settings.work_weeks_per_year.toString())
      setEditHiringThreshold((settings.hiring_threshold || 4000).toString())
      setEditHiringConsecutiveWeeks(
        (settings.hiring_consecutive_weeks || 4).toString(),
      )
    }
    setShowSettingsEditor(true)
  }

  async function fetchData() {
    try {
      const supabase = createClient()

      // Fetch user settings (or create default)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      let { data: userSettings } = await supabase
        .from('settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      // If no settings exist, use defaults
      if (!userSettings) {
        userSettings = {
          annual_revenue_goal: 150000,
          available_hours_per_week: 40,
          work_weeks_per_year: 48,
          hiring_threshold: 4000,
          hiring_consecutive_weeks: 4,
        }
      } else {
        // Ensure hiring settings have defaults
        userSettings.hiring_threshold = userSettings.hiring_threshold || 4000
        userSettings.hiring_consecutive_weeks =
          userSettings.hiring_consecutive_weeks || 4
      }

      setSettings(userSettings)

      // Fetch jobs data
      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select('invoice_amount, hours_worked, created_at')
        .not('invoice_amount', 'is', null)
        .not('hours_worked', 'is', null)
        .order('created_at', { ascending: false })

      if (jobsError) throw jobsError

      // Fetch revenue entries (drive_minutes adds to utilization hours from on-my-way)
      const { data: entries, error: entriesError } = await supabase
        .from('revenue_entries')
        .select('invoice_amount, hours_worked, entry_date, drive_minutes')
        .eq('user_id', user.id)
        .order('entry_date', { ascending: false })

      if (entriesError) throw entriesError

      let supplementRows: {
        invoice_amount: number
        hours_worked: number
        date: string
      }[] = []
      let scheduleCapacity: ScheduleCapacity | null = null
      const [supRes, capRes] = await Promise.allSettled([
        fetch('/api/admin/stats/utilization-supplement', {
          cache: 'no-store',
        }),
        fetch('/api/admin/stats/capacity', { cache: 'no-store' }),
      ])
      if (supRes.status === 'fulfilled' && supRes.value.ok) {
        try {
          const supJson = (await supRes.value.json()) as {
            rows?: typeof supplementRows
          }
          supplementRows = supJson.rows || []
        } catch {
          /* non-fatal */
        }
      }
      if (capRes.status === 'fulfilled' && capRes.value.ok) {
        try {
          const capJson = (await capRes.value.json()) as {
            capacity?: ScheduleCapacity | null
          }
          scheduleCapacity = capJson.capacity || null
        } catch {
          /* non-fatal */
        }
      }

      // Combine jobs, manual/quick entries, and completed ops not yet in jobs/revenue_entries
      const allRevenue = [
        ...(jobs || []).map((j) => ({ ...j, date: j.created_at })),
        ...(entries || []).map((e) => ({
          ...e,
          // Append T00:00:00 (no Z) so bare date strings are parsed as local
          // time rather than UTC midnight, which would shift them to the prior
          // day in US timezones and break week/YTD bucketing.
          date: e.entry_date + 'T00:00:00',
          hours_worked: (e.hours_worked || 0) + (e.drive_minutes || 0) / 60,
        })),
        ...supplementRows.map((r) => ({
          invoice_amount: r.invoice_amount,
          hours_worked: r.hours_worked,
          date: r.date,
        })),
      ]

      // Calculate stats
      const now = new Date()
      // Same week as "Live Jobs" (Mon–Sun) and /api/admin/ops/stats
      const getMonday = (d: Date) => {
        const date = new Date(d)
        const day = date.getDay()
        const diff = date.getDate() - day + (day === 0 ? -6 : 1)
        date.setDate(diff)
        date.setHours(0, 0, 0, 0)
        return date
      }
      const mondayWeekStart = getMonday(now)
      const nextMonday = new Date(mondayWeekStart)
      nextMonday.setDate(nextMonday.getDate() + 7)

      const startOfYear = new Date(now.getFullYear(), 0, 1)

      // Filter by date (calendar week Mon–Sun)
      const thisWeekData = allRevenue.filter((item) => {
        const itemDate = new Date(item.date)
        return itemDate >= mondayWeekStart && itemDate < nextMonday
      })
      const ytdData = allRevenue.filter(
        (item) => new Date(item.date) >= startOfYear,
      )

      // This Week
      const thisWeekRevenue = thisWeekData.reduce(
        (sum, item) => sum + (item.invoice_amount || 0),
        0,
      )
      const thisWeekHours = thisWeekData.reduce(
        (sum, item) => sum + (item.hours_worked || 0),
        0,
      )

      // Year to Date
      const ytdRevenue = ytdData.reduce(
        (sum, item) => sum + (item.invoice_amount || 0),
        0,
      )
      const ytdHours = ytdData.reduce(
        (sum, item) => sum + (item.hours_worked || 0),
        0,
      )

      // Calculations — capacity comes from the live tech schedule when
      // available (every tech's open days), else the flat settings fallback.
      const weeksElapsed = Math.max(
        (now.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000),
        1,
      )
      const availableHoursYTD =
        scheduleCapacity?.ytdAvailableHours ??
        Math.ceil(weeksElapsed) * userSettings.available_hours_per_week
      const utilization =
        availableHoursYTD > 0 ? (ytdHours / availableHoursYTD) * 100 : 0

      const weeklyTarget =
        userSettings.annual_revenue_goal / userSettings.work_weeks_per_year
      const weeklyAverage = ytdRevenue / weeksElapsed
      const projectedAnnual = weeklyAverage * userSettings.work_weeks_per_year
      const onPace = projectedAnnual >= userSettings.annual_revenue_goal
      const percentOfGoal =
        (ytdRevenue / userSettings.annual_revenue_goal) * 100

      // Potential revenue calculations
      const revenuePerHour = ytdHours > 0 ? ytdRevenue / ytdHours : 0
      const totalAvailableHoursAnnual =
        scheduleCapacity?.annualAvailableHours ??
        userSettings.available_hours_per_week * userSettings.work_weeks_per_year
      const revenueAtFullUtilizationYTD = revenuePerHour * availableHoursYTD
      const revenueLeftOnTableYTD = revenueAtFullUtilizationYTD - ytdRevenue
      const annualRevenueAtFullUtilization =
        revenuePerHour * totalAvailableHoursAnnual
      const annualRevenueLeftOnTable =
        annualRevenueAtFullUtilization - projectedAnnual

      setStats({
        thisWeek: {
          jobs: thisWeekData.length,
          revenue: thisWeekRevenue,
          hours: thisWeekHours,
          revenuePerHour:
            thisWeekHours > 0 ? thisWeekRevenue / thisWeekHours : 0,
          averageTicket:
            thisWeekData.length > 0 ? thisWeekRevenue / thisWeekData.length : 0,
        },
        yearToDate: {
          jobs: ytdData.length,
          revenue: ytdRevenue,
          hours: ytdHours,
          revenuePerHour: ytdHours > 0 ? ytdRevenue / ytdHours : 0,
          utilization,
          availableHours: availableHoursYTD,
        },
        pace: {
          weeklyTarget,
          weeklyAverage,
          projectedAnnual,
          onPace,
          percentOfGoal,
        },
        potential: {
          revenueAtFullUtilizationYTD,
          revenueLeftOnTableYTD,
          annualRevenueAtFullUtilization,
          annualRevenueLeftOnTable,
          totalAvailableHoursAnnual,
          scheduleBased: !!scheduleCapacity,
          currentWeeklyCapacity:
            scheduleCapacity?.currentWeeklyCapacity ?? null,
        },
      })
    } catch (err) {
      console.error('Error fetching stats:', err)
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    async function fetchOpsStats() {
      setOpsLoading(true)
      try {
        const response = await fetch('/api/admin/ops/stats', {
          cache: 'no-store',
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Failed to load')
        setOpsStats(result)
      } catch {
        // Non-fatal — existing stats still show
      } finally {
        setOpsLoading(false)
      }
    }
    void fetchOpsStats()
  }, [])

  useEffect(() => {
    let active = true

    async function fetchTechPerf() {
      try {
        const res = await fetch('/api/admin/stats/tech-performance', {
          cache: 'no-store',
        })
        if (res.ok && active) {
          const json = (await res.json()) as { techs?: TechPerformance[] }
          setTechPerf(json.techs || [])
        }
      } catch {
        // Non-fatal — section simply hides
      }
    }
    void fetchTechPerf()
    const interval = window.setInterval(() => void fetchTechPerf(), 60_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await fetch('/api/admin/stats/business-health', {
          cache: 'no-store',
        })
        if (res.ok) setHealth((await res.json()) as BusinessHealth)
      } catch {
        // Non-fatal — section simply hides
      }
    }
    async function fetchSourceRevenue() {
      try {
        const yearStart = `${new Date().getFullYear()}-01-01`
        const res = await fetch(
          `/api/admin/stats/lead-sources?start_date=${yearStart}`,
          { cache: 'no-store' },
        )
        if (res.ok) {
          const json = (await res.json()) as { sources?: LeadSourceRevenue[] }
          setSourceRevenue(
            (json.sources || []).sort(
              (a, b) => b.total_revenue - a.total_revenue,
            ),
          )
        }
      } catch {
        // Non-fatal
      }
    }
    void fetchHealth()
    async function fetchFunnel() {
      try {
        const res = await fetch('/api/admin/stats/booking-funnel?days=90', {
          cache: 'no-store',
        })
        if (res.ok) setFunnel((await res.json()) as BookingFunnel)
      } catch {
        // Non-fatal — section hides
      }
    }
    async function fetchHistory() {
      try {
        const res = await fetch('/api/admin/stats/year-over-year', {
          cache: 'no-store',
        })
        if (res.ok) {
          const json = (await res.json()) as { history?: YearOverYear | null }
          setHistory(json.history ?? null)
        }
      } catch {
        // Non-fatal — section hides
      }
    }
    void fetchSourceRevenue()
    void fetchFunnel()
    void fetchHistory()
  }, [])

  useEffect(() => {
    async function fetchPipeline() {
      setPipelineLoading(true)
      try {
        const res = await fetch('/api/admin/ops/calendar-pipeline', {
          cache: 'no-store',
        })
        if (res.ok) setPipeline(await res.json())
      } catch {
        // Non-fatal
      } finally {
        setPipelineLoading(false)
      }
    }
    void fetchPipeline()
  }, [])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-destructive/10 text-destructive rounded-md p-4">
          {error}
        </div>
      </div>
    )
  }

  if (!stats || !settings) return null

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        {/* Mobile: buttons first, title below. Desktop: side by side */}
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="order-2 md:order-1">
            <h1 className="text-gradient text-3xl font-bold tracking-tight md:text-4xl">
              Statistics
            </h1>
            <p className="text-muted-foreground mt-1 text-sm md:mt-2 md:text-base">
              Revenue, efficiency, pipeline, and progress toward your annual
              goal
            </p>
          </div>
          <div className="order-1 flex shrink-0 gap-2 md:order-2">
            <Button
              onClick={() => setShowQuickEntry(!showQuickEntry)}
              variant="default"
              size="sm"
            >
              <Plus className="mr-1 h-4 w-4" />
              Quick Entry
            </Button>
            <Button onClick={openSettingsEditor} variant="outline" size="sm">
              <SettingsIcon className="mr-1 h-4 w-4" />
              Goals
            </Button>
          </div>
        </div>

        {/* Settings Editor Form */}
        {showSettingsEditor && (
          <Card className="mb-6 p-6">
            <h3 className="mb-4 text-lg font-semibold">Edit Goals</h3>
            <p className="text-muted-foreground mb-4 text-sm">
              Update your annual revenue goal and availability settings
            </p>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="editAnnualGoal">
                    Annual Revenue Goal ($)
                  </Label>
                  <Input
                    id="editAnnualGoal"
                    type="number"
                    step="1000"
                    value={editAnnualGoal}
                    onChange={(e) => setEditAnnualGoal(e.target.value)}
                    placeholder="150000"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="editHoursPerWeek">Available Hours/Week</Label>
                  <Input
                    id="editHoursPerWeek"
                    type="number"
                    step="1"
                    value={editHoursPerWeek}
                    onChange={(e) => setEditHoursPerWeek(e.target.value)}
                    placeholder="40"
                    required
                  />
                  <p className="text-muted-foreground mt-1 text-xs">
                    Fallback only — capacity normally comes from the tech
                    schedule
                  </p>
                </div>
                <div>
                  <Label htmlFor="editWeeksPerYear">Work Weeks/Year</Label>
                  <Input
                    id="editWeeksPerYear"
                    type="number"
                    step="1"
                    value={editWeeksPerYear}
                    onChange={(e) => setEditWeeksPerYear(e.target.value)}
                    placeholder="48"
                    required
                  />
                </div>
              </div>

              {/* Hiring Readiness Settings */}
              <div className="border-t pt-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Rocket className="h-4 w-4" />
                  Hiring Readiness Settings
                </h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="editHiringThreshold">
                      Weekly Threshold ($)
                    </Label>
                    <Input
                      id="editHiringThreshold"
                      type="number"
                      step="100"
                      value={editHiringThreshold}
                      onChange={(e) => setEditHiringThreshold(e.target.value)}
                      placeholder="4000"
                      required
                    />
                    <p className="text-muted-foreground mt-1 text-xs">
                      Weekly revenue target to trigger hiring signal
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="editHiringConsecutiveWeeks">
                      Consecutive Weeks
                    </Label>
                    <Input
                      id="editHiringConsecutiveWeeks"
                      type="number"
                      step="1"
                      min="1"
                      max="12"
                      value={editHiringConsecutiveWeeks}
                      onChange={(e) =>
                        setEditHiringConsecutiveWeeks(e.target.value)
                      }
                      placeholder="4"
                      required
                    />
                    <p className="text-muted-foreground mt-1 text-xs">
                      Weeks at threshold before hiring signal
                    </p>
                  </div>
                </div>
              </div>
              {settingsError && (
                <div className="text-destructive text-sm">{settingsError}</div>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={isSavingSettings}>
                  {isSavingSettings ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Goals'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowSettingsEditor(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Quick Entry Form */}
        {showQuickEntry && (
          <Card className="mb-6 p-6">
            <h3 className="mb-4 text-lg font-semibold">Add Revenue Entry</h3>
            <p className="text-muted-foreground mb-4 text-sm">
              Track commercial work or recurring jobs without creating a public
              post
            </p>
            <form onSubmit={handleQuickEntry} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="entryDate">Date</Label>
                  <Input
                    id="entryDate"
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="invoiceAmount">Invoice Amount</Label>
                  <Input
                    id="invoiceAmount"
                    type="number"
                    step="0.01"
                    value={invoiceAmount}
                    onChange={(e) => setInvoiceAmount(e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="hoursWorked">Hours Worked</Label>
                  <Input
                    id="hoursWorked"
                    type="number"
                    step="0.25"
                    value={hoursWorked}
                    onChange={(e) => setHoursWorked(e.target.value)}
                    placeholder="0.0"
                    required
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Recovery Village - Hallways"
                  rows={2}
                  required
                />
              </div>
              {submitError && (
                <div className="text-destructive text-sm">{submitError}</div>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Entry'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowQuickEntry(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>

      {/* Year over Year — from imported QuickBooks history */}
      {history && history.years.length > 1 && (
        <div className="mb-8">
          <h2 className="text-gradient-purple mb-1 text-xl font-semibold tracking-tight">
            Year Over Year
          </h2>
          <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
            Every year compared at the{' '}
            <strong>same point on the calendar</strong> (through{' '}
            {history.asOfLabel}), so a partial year isn&apos;t judged against
            finished ones. From your QuickBooks invoice history.
          </p>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
                <DollarSign className="h-4 w-4" />
                <p className="text-sm font-medium">
                  {history.currentYear} So Far
                </p>
              </div>
              <p className="stat-value text-2xl font-bold text-emerald-300">
                {formatCurrency(history.ytd)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                through {history.asOfLabel}
              </p>
            </Card>

            <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-slate-400/80">
                <CalendarDays className="h-4 w-4" />
                <p className="text-sm font-medium">
                  {history.currentYear - 1} Same Point
                </p>
              </div>
              <p className="stat-value text-2xl font-bold text-slate-300">
                {formatCurrency(history.priorYtd)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                finished the year at {formatCurrency(history.priorFullYear)}
              </p>
            </Card>

            {history.ytdGrowthPct !== null && (
              <Card
                className={`card-interactive animate-slide-up-delay-2 p-4 ${
                  history.ytdGrowthPct >= 0
                    ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950'
                    : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
                }`}
              >
                <div
                  className={`mb-1 flex items-center gap-2 ${
                    history.ytdGrowthPct >= 0
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {history.ytdGrowthPct >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  <p className="text-sm font-medium">Growth</p>
                </div>
                <p
                  className={`stat-value text-2xl font-bold ${
                    history.ytdGrowthPct >= 0
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {history.ytdGrowthPct >= 0 ? '+' : ''}
                  {history.ytdGrowthPct}%
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  vs this time last year
                </p>
              </Card>
            )}

            {history.pctOfPriorFullYear !== null && (
              <Card className="card-interactive animate-slide-up-delay-3 border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-amber-400/80">
                  <Target className="h-4 w-4" />
                  <p className="text-sm font-medium">
                    vs All of {history.currentYear - 1}
                  </p>
                </div>
                <p className="stat-value text-2xl font-bold text-amber-300">
                  {history.pctOfPriorFullYear}%
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  of last year&apos;s entire total, already
                </p>
              </Card>
            )}
          </div>

          {/* Per-year bars */}
          <Card className="border-border/60 bg-card/80 mt-4 p-4 backdrop-blur">
            <h4 className="mb-1 text-sm font-semibold">Revenue by Year</h4>
            <p className="text-muted-foreground mb-4 text-xs">
              <span className="inline-block h-2 w-3 rounded-sm bg-slate-400/60 align-middle" />{' '}
              Full year&nbsp;&nbsp;
              <span className="inline-block h-2 w-3 rounded-sm bg-emerald-400/80 align-middle" />{' '}
              Through {history.asOfLabel}
            </p>
            <div className="space-y-3">
              {(() => {
                const maxVal = Math.max(
                  ...history.years.map((y) => y.fullYear),
                  1,
                )
                return history.years.map((y) => {
                  const fullPct = Math.round((y.fullYear / maxVal) * 100)
                  const ytdPct = Math.round((y.throughToday / maxVal) * 100)
                  return (
                    <div key={y.year} className="flex items-center gap-3">
                      <span
                        className={`w-12 shrink-0 text-right text-xs ${
                          y.isCurrentYear
                            ? 'font-bold text-emerald-400'
                            : 'text-muted-foreground font-medium'
                        }`}
                      >
                        {y.year}
                      </span>
                      <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        {!y.isCurrentYear && (
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-slate-400/50"
                            style={{ width: `${fullPct}%` }}
                          />
                        )}
                        <div
                          className="absolute inset-y-0 left-0 flex items-center rounded-full bg-emerald-500/70"
                          style={{ width: `${Math.max(ytdPct, 2)}%` }}
                        >
                          <span className="truncate pr-1 pl-2 text-[10px] font-semibold whitespace-nowrap text-white">
                            {formatCurrency(y.throughToday)}
                          </span>
                        </div>
                      </div>
                      <span className="w-20 shrink-0 text-right text-sm font-semibold">
                        {y.isCurrentYear ? '—' : formatCurrency(y.fullYear)}
                      </span>
                      <span className="text-muted-foreground w-32 shrink-0 text-right text-xs">
                        {y.invoices} jobs ·{' '}
                        <span className="font-medium">
                          {formatCurrency(y.medianTicket)}
                        </span>{' '}
                        typical
                      </span>
                    </div>
                  )
                })
              })()}
            </div>
            <p className="text-muted-foreground mt-3 border-t pt-3 text-xs leading-relaxed">
              &quot;Typical&quot; is the <strong>median</strong> invoice, not
              the average. A few large commercial invoices (Recovery Village and
              similar) pull the average around as their share of the customer
              base changes — the median shows what a normal job is actually
              worth, and it has risen every year.
            </p>
          </Card>
        </div>
      )}

      {/* ── Calendar Pipeline ─────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-blue-400" />
          <h2 className="text-gradient-blue text-xl font-semibold tracking-tight">
            {new Date().getFullYear()} Calendar Value
          </h2>
        </div>
        <p className="text-muted-foreground mb-4 text-xs">
          Completed work in orange, still booked on the calendar in blue — all
          from the live Operations schedule. Past months show completed; the
          current month shows completed + still booked; future months show
          what&apos;s already booked.
        </p>

        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading calendar data...
          </div>
        ) : (
          (() => {
            const now = new Date()
            const currentMonth = now.getMonth() + 1
            const totalActual = pipeline?.totalCompleted ?? 0
            const totalBooked = pipeline?.totalBooked ?? 0
            const totalOnCalendar = totalActual + totalBooked
            const LABELS = [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'May',
              'Jun',
              'Jul',
              'Aug',
              'Sep',
              'Oct',
              'Nov',
              'Dec',
            ]
            const allMonthValues = LABELS.map((_, i) => {
              const month = i + 1
              const completed = pipeline?.months[i]?.completedRevenue ?? 0
              const booked = pipeline?.months[i]?.bookedRevenue ?? 0
              if (month < currentMonth) return completed
              if (month === currentMonth) return completed + booked
              return booked
            })
            const maxVal = Math.max(...allMonthValues, 1)

            return (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Card className="card-interactive animate-slide-up border-blue-500/30 bg-blue-950/30 p-4 backdrop-blur">
                    <p className="mb-1 text-sm font-medium tracking-wide text-blue-300/80 uppercase">
                      Full Year Value
                    </p>
                    <p className="stat-value stat-glow-blue text-3xl font-bold text-blue-300">
                      {formatCurrency(totalOnCalendar)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      completed + scheduled
                    </p>
                  </Card>
                  <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
                    <p className="mb-1 text-sm font-medium tracking-wide text-orange-300/80 uppercase">
                      Completed
                    </p>
                    <p className="stat-value stat-glow-amber text-3xl font-bold text-orange-400">
                      {formatCurrency(totalActual)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      work done this year
                    </p>
                  </Card>
                  <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
                    <p className="mb-1 text-sm font-medium tracking-wide text-blue-300/80 uppercase">
                      Scheduled
                    </p>
                    <p className="stat-value stat-glow-blue text-3xl font-bold text-blue-400">
                      {formatCurrency(totalBooked)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      still booked on the calendar
                    </p>
                  </Card>
                </div>

                {/* Monthly chart */}
                <Card className="border-border/60 bg-card/80 p-5 backdrop-blur">
                  <h3 className="mb-1 text-sm font-semibold">Month by Month</h3>
                  <p className="text-muted-foreground mb-4 text-xs">
                    <span className="inline-block h-2 w-3 rounded-sm bg-slate-400/60 align-middle" />{' '}
                    Collected&nbsp;&nbsp;
                    <span className="inline-block h-2 w-3 rounded-sm bg-orange-400/80 align-middle" />{' '}
                    Done this month&nbsp;&nbsp;
                    <span className="inline-block h-2 w-3 rounded-sm bg-blue-400/60 align-middle" />{' '}
                    Booked ahead
                  </p>
                  <div className="space-y-2">
                    {LABELS.map((_, i) => {
                      const month = i + 1
                      const label = LABELS[i]
                      const completed =
                        pipeline?.months[i]?.completedRevenue ?? 0
                      const booked = pipeline?.months[i]?.bookedRevenue ?? 0
                      const total = completed + booked
                      const isCurrent = month === currentMonth
                      const completedPct = Math.round(
                        (completed / maxVal) * 100,
                      )
                      const bookedPct = Math.round((booked / maxVal) * 100)
                      // Past months = slate (collected); current = orange (done now)
                      const completedColor = isCurrent
                        ? 'bg-orange-400/80'
                        : 'bg-slate-400/60'
                      return (
                        <div key={month} className="flex items-center gap-3">
                          <span
                            className={`w-9 shrink-0 text-right text-xs ${
                              isCurrent
                                ? 'font-bold text-blue-600 dark:text-blue-400'
                                : 'text-muted-foreground font-medium'
                            }`}
                          >
                            {label}
                            {isCurrent && (
                              <span className="ml-0.5 text-[9px]">▶</span>
                            )}
                          </span>
                          <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            {completed > 0 && (
                              <div
                                className={`absolute inset-y-0 left-0 flex items-center ${completedColor}`}
                                style={{
                                  width: `${completedPct}%`,
                                  borderRadius:
                                    booked > 0 ? '9999px 0 0 9999px' : '9999px',
                                }}
                              >
                                <span className="truncate pr-1 pl-2 text-[10px] font-semibold whitespace-nowrap text-white">
                                  {formatCurrency(completed)}
                                </span>
                              </div>
                            )}
                            {booked > 0 && (
                              <div
                                className="absolute inset-y-0 flex items-center bg-blue-400/70"
                                style={{
                                  left: `${completedPct}%`,
                                  width: `${bookedPct}%`,
                                  borderRadius:
                                    completed > 0
                                      ? '0 9999px 9999px 0'
                                      : '9999px',
                                }}
                              >
                                <span className="truncate pr-1 pl-2 text-[10px] font-semibold whitespace-nowrap text-white">
                                  {formatCurrency(booked)}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="w-24 shrink-0 text-right">
                            {total > 0 ? (
                              <span className="text-sm font-semibold">
                                {formatCurrency(total)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              </div>
            )
          })()
        )}
      </div>

      {/* Live Ops Stats — from ops_appointments + ops_invoices */}
      <div className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-emerald-400" />
          <h2 className="text-gradient text-xl font-semibold tracking-tight">
            This Week — Live Jobs
          </h2>
          {opsStats ? (
            <span className="text-muted-foreground text-xs">
              ({opsStats.weekStart} – {opsStats.weekEnd})
            </span>
          ) : null}
        </div>

        {opsLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading live job data...
          </div>
        ) : opsStats ? (
          <div className="space-y-4">
            {/* Top stat cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
                  <Briefcase className="h-4 w-4" />
                  <p className="text-sm font-medium">Jobs Booked</p>
                </div>
                <p className="stat-value text-2xl font-bold text-emerald-400">
                  {opsStats.jobCount}
                </p>
              </Card>

              <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
                  <DollarSign className="h-4 w-4" />
                  <p className="text-sm font-medium">Total Invoiced</p>
                </div>
                <p className="stat-value stat-glow-emerald text-2xl font-bold text-cyan-300">
                  {formatCurrency(opsStats.totalRevenue)}
                </p>
              </Card>

              <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-purple-400/80">
                  <TrendingUp className="h-4 w-4" />
                  <p className="text-sm font-medium">Avg Ticket</p>
                </div>
                <p className="stat-value text-2xl font-bold text-purple-300">
                  {formatCurrency(opsStats.averageTicket)}
                </p>
              </Card>

              <Card className="card-interactive animate-slide-up-delay-3 border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-amber-400/80">
                  <Target className="h-4 w-4" />
                  <p className="text-sm font-medium">Unpaid</p>
                </div>
                <p className="stat-value text-2xl font-bold text-amber-300">
                  {opsStats.paymentStatusCounts['unpaid'] ?? 0}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  invoices outstanding
                </p>
              </Card>
            </div>

            {/* Job status + Lead source */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
                <h3 className="mb-3 text-sm font-semibold">Job Status</h3>
                <div className="space-y-2">
                  {Object.entries(opsStats.statusCounts).length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No jobs this week
                    </p>
                  ) : (
                    Object.entries(opsStats.statusCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => {
                        const pct =
                          opsStats.jobCount > 0
                            ? Math.round((count / opsStats.jobCount) * 100)
                            : 0
                        return (
                          <div key={status} className="flex items-center gap-3">
                            <div className="w-24 shrink-0 text-sm capitalize">
                              {status.replace(/_/g, ' ')}
                            </div>
                            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                              <div
                                className="h-2 rounded-full bg-green-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="w-12 shrink-0 text-right text-sm font-semibold">
                              {count}
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </Card>

              <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Lead Source</h3>
                  <a
                    href="/admin/stats/lead-sources"
                    className="text-xs text-green-600 hover:text-green-700 hover:underline"
                  >
                    View Detailed Analytics →
                  </a>
                </div>
                <div className="space-y-2">
                  {Object.entries(opsStats.leadSourceCounts).length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No lead source data yet
                    </p>
                  ) : (
                    Object.entries(opsStats.leadSourceCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([source, count]) => {
                        const pct =
                          opsStats.jobCount > 0
                            ? Math.round((count / opsStats.jobCount) * 100)
                            : 0
                        return (
                          <div key={source} className="flex items-center gap-3">
                            <div className="w-32 shrink-0 truncate text-sm">
                              {source}
                            </div>
                            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                              <div
                                className="h-2 rounded-full bg-green-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="w-12 shrink-0 text-right text-sm font-semibold">
                              {count}
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </Card>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Could not load live job data.
          </p>
        )}
      </div>

      {/* This Week */}
      <div className="mb-8">
        <h2 className="text-gradient-amber mb-1 text-xl font-semibold tracking-tight">
          This Week
        </h2>
        <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
          Revenue and hours here include published posts, manual entries,{' '}
          <strong>Finish &amp; close job</strong> on the invoice, and completed
          Operations jobs (same week as Live Jobs, Mon–Sun). You do{' '}
          <strong>not</strong> need photos or a social post for these numbers to
          update. <strong>Hours</strong> use the real duration from{' '}
          <strong>On My Way</strong> through{' '}
          <strong>Finish &amp; close job</strong> when both are recorded;
          otherwise the scheduled time window is used.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-amber-400/80">
              <Briefcase className="h-4 w-4" />
              <p className="text-sm font-medium">Jobs</p>
            </div>
            <p className="stat-value text-2xl font-bold text-amber-300">
              {stats.thisWeek.jobs}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Revenue</p>
            </div>
            <p className="stat-value stat-glow-emerald text-2xl font-bold text-emerald-300">
              {formatCurrency(stats.thisWeek.revenue)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
              <Clock className="h-4 w-4" />
              <p className="text-sm font-medium">Hours</p>
            </div>
            <p className="stat-value text-2xl font-bold text-cyan-300">
              {stats.thisWeek.hours.toFixed(1)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-3 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-purple-400/80">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">$/Hour</p>
            </div>
            <p className="stat-value text-2xl font-bold text-purple-300">
              {formatCurrency(stats.thisWeek.revenuePerHour)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-4 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-rose-400/80">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Avg Ticket</p>
            </div>
            <p className="stat-value text-2xl font-bold text-rose-300">
              {formatCurrency(stats.thisWeek.averageTicket)}
            </p>
          </Card>
        </div>
      </div>

      {/* Year to Date */}
      <div className="mb-8">
        <h2 className="text-gradient mb-4 text-xl font-semibold tracking-tight">
          Year to Date
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
              <Briefcase className="h-4 w-4" />
              <p className="text-sm font-medium">Total Jobs</p>
            </div>
            <p className="stat-value text-2xl font-bold text-emerald-300">
              {stats.yearToDate.jobs}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Total Revenue</p>
            </div>
            <p className="stat-value stat-glow-emerald text-3xl font-bold text-emerald-300">
              {formatCurrency(stats.yearToDate.revenue)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-blue-400/80">
              <Clock className="h-4 w-4" />
              <p className="text-sm font-medium">Total Hours</p>
            </div>
            <p className="stat-value text-2xl font-bold text-blue-300">
              {stats.yearToDate.hours.toFixed(1)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-3 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-purple-400/80">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">Avg $/Hour</p>
            </div>
            <p className="stat-value text-2xl font-bold text-purple-300">
              {formatCurrency(stats.yearToDate.revenuePerHour)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-4 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-amber-400/80">
              <Target className="h-4 w-4" />
              <p className="text-sm font-medium">Utilization</p>
            </div>
            <p className="stat-value text-2xl font-bold text-amber-300">
              {stats.yearToDate.utilization.toFixed(1)}%
            </p>
          </Card>
        </div>
      </div>

      {/* Potential Revenue - Money Left on Table */}
      <div className="mb-8">
        <h2 className="text-gradient-rose mb-1 text-xl font-semibold tracking-tight">
          Potential at 100% Utilization
        </h2>
        <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
          {stats.potential.scheduleBased ? (
            <>
              Available hours come from the <strong>live tech schedule</strong>{' '}
              — techs count on their open days, and your time counts every
              scheduled day even when your toggle is off (that&apos;s booking
              routing, not time off).
              {stats.potential.currentWeeklyCapacity != null && (
                <>
                  {' '}
                  Current capacity:{' '}
                  <strong>
                    {Math.round(stats.potential.currentWeeklyCapacity)} hrs/week
                  </strong>{' '}
                  across all techs (trailing 4 weeks).
                </>
              )}
            </>
          ) : (
            <>
              Schedule data unavailable — using the flat Available Hours/Week
              setting from Goals.
            </>
          )}
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <div className="mb-1 flex items-center gap-2 text-green-700 dark:text-green-400">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">YTD Potential Revenue</p>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">
              {formatCurrency(stats.potential.revenueAtFullUtilizationYTD)}
            </p>
            <p className="mt-1 text-xs text-green-600 dark:text-green-500">
              At {stats.yearToDate.availableHours.toFixed(0)} available hours
            </p>
          </Card>

          <Card className="border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <div className="mb-1 flex items-center gap-2 text-red-700 dark:text-red-400">
              <TrendingDown className="h-4 w-4" />
              <p className="text-sm font-medium">YTD Left on Table</p>
            </div>
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">
              {formatCurrency(stats.potential.revenueLeftOnTableYTD)}
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-500">
              {(100 - stats.yearToDate.utilization).toFixed(1)}% unused capacity
            </p>
          </Card>

          <Card className="border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <div className="mb-1 flex items-center gap-2 text-green-700 dark:text-green-400">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Annual Potential</p>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">
              {formatCurrency(stats.potential.annualRevenueAtFullUtilization)}
            </p>
            <p className="mt-1 text-xs text-green-600 dark:text-green-500">
              At ${stats.yearToDate.revenuePerHour.toFixed(0)}/hr ×{' '}
              {Math.round(stats.potential.totalAvailableHoursAnnual)} hrs
            </p>
          </Card>

          <Card className="border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <div className="mb-1 flex items-center gap-2 text-red-700 dark:text-red-400">
              <TrendingDown className="h-4 w-4" />
              <p className="text-sm font-medium">Annual Left on Table</p>
            </div>
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">
              {formatCurrency(stats.potential.annualRevenueLeftOnTable)}
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-500">
              Projected gap vs 100% utilization
            </p>
          </Card>
        </div>
      </div>

      {/* Tech Profitability */}
      {techPerf.length > 0 && (
        <div className="mb-8">
          <div className="mb-1 flex items-center gap-2">
            <HardHat className="h-5 w-5 text-orange-400" />
            <h2 className="text-gradient-amber text-xl font-semibold tracking-tight">
              Tech Profitability
            </h2>
          </div>
          <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
            What each tech generates (completed-job revenue) vs what they cost
            (timesheet paid hours × wage). Wages are <strong>gross pay</strong>{' '}
            from timesheets — employer payroll taxes and workers comp typically
            add roughly 10–15% on top. Field-service rule of thumb: keep tech
            labor under <strong>30–35%</strong> of the revenue they produce.
          </p>

          {techPerf.map((tech) => {
            const t = tech.totals
            const laborColor =
              t.laborPercent <= 30
                ? 'text-green-600 dark:text-green-400'
                : t.laborPercent <= 40
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400'
            return (
              <div key={tech.staffUserId} className="space-y-4">
                <h3 className="text-lg font-semibold">{tech.displayName}</h3>

                {/* Headline cards */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
                    <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
                      <DollarSign className="h-4 w-4" />
                      <p className="text-sm font-medium">Revenue / Paid Hr</p>
                    </div>
                    <p className="stat-value text-2xl font-bold text-emerald-300">
                      {formatCurrency(t.revenuePerPaidHour)}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      vs ~
                      {t.paidHours > 0
                        ? formatCurrency(t.grossWages / t.paidHours)
                        : '—'}
                      /hr wage
                    </p>
                  </Card>

                  <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
                    <div className="mb-1 flex items-center gap-2 text-amber-400/80">
                      <Target className="h-4 w-4" />
                      <p className="text-sm font-medium">Labor % of Revenue</p>
                    </div>
                    <p
                      className={`stat-value text-2xl font-bold ${laborColor}`}
                    >
                      {t.laborPercent.toFixed(1)}%
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      target: under 30–35%
                    </p>
                  </Card>

                  <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
                    <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
                      <Clock className="h-4 w-4" />
                      <p className="text-sm font-medium">Billable Efficiency</p>
                    </div>
                    <p className="stat-value text-2xl font-bold text-cyan-300">
                      {t.billableEfficiency > 0
                        ? `${t.billableEfficiency.toFixed(0)}%`
                        : '—'}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      job hours ÷ paid clock hours
                    </p>
                  </Card>

                  <Card className="card-interactive animate-slide-up-delay-3 border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
                    <div className="mb-1 flex items-center gap-2 text-green-700 dark:text-green-400">
                      <TrendingUp className="h-4 w-4" />
                      <p className="text-sm font-medium">Profit After Wages</p>
                    </div>
                    <p className="stat-value text-2xl font-bold text-green-700 dark:text-green-400">
                      {formatCurrency(t.profitAfterWages)}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {formatCurrency(t.revenue)} revenue −{' '}
                      {formatCurrency(t.grossWages)} wages
                    </p>
                  </Card>
                </div>

                <DailyProfitabilityChart days={tech.days || []} />

                {/* Monthly table */}
                <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
                  <h4 className="mb-3 text-sm font-semibold">Month by Month</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left text-xs">
                          <th className="pr-3 pb-2 font-medium">Month</th>
                          <th className="pr-3 pb-2 text-right font-medium">
                            Jobs
                          </th>
                          <th className="pr-3 pb-2 text-right font-medium">
                            Revenue
                          </th>
                          <th className="pr-3 pb-2 text-right font-medium">
                            Paid Hrs
                          </th>
                          <th className="pr-3 pb-2 text-right font-medium">
                            Wages
                          </th>
                          <th className="pr-3 pb-2 text-right font-medium">
                            $/Paid Hr
                          </th>
                          <th className="pr-3 pb-2 text-right font-medium">
                            Labor %
                          </th>
                          <th className="pb-2 text-right font-medium">
                            Profit
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {tech.months.map((m) => {
                          const [y, mo] = m.month.split('-').map(Number)
                          const label = new Date(y, mo - 1, 1).toLocaleString(
                            'en-US',
                            { month: 'short', year: 'numeric' },
                          )
                          const rowLabor =
                            m.laborPercent <= 30
                              ? 'text-green-600 dark:text-green-400'
                              : m.laborPercent <= 40
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-red-600 dark:text-red-400'
                          return (
                            <tr key={m.month} className="border-b/50 border-b">
                              <td className="py-2 pr-3 font-medium">{label}</td>
                              <td className="py-2 pr-3 text-right">{m.jobs}</td>
                              <td className="py-2 pr-3 text-right">
                                {formatCurrency(m.revenue)}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                {m.paidHours.toFixed(1)}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                {formatCurrency(m.grossWages)}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                {formatCurrency(m.revenuePerPaidHour)}
                              </td>
                              <td
                                className={`py-2 pr-3 text-right font-medium ${m.revenue > 0 ? rowLabor : ''}`}
                              >
                                {m.revenue > 0
                                  ? `${m.laborPercent.toFixed(1)}%`
                                  : '—'}
                              </td>
                              <td className="py-2 text-right font-semibold">
                                {formatCurrency(m.profitAfterWages)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )
          })}
        </div>
      )}

      {/* Customer Retention */}
      {health && health.retention.customers > 0 && (
        <div className="mb-8">
          <h2 className="text-gradient mb-1 text-xl font-semibold tracking-tight">
            Customer Retention
          </h2>
          <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
            Tracking since{' '}
            <strong>
              {new Date(
                health.retention.sinceDate + 'T12:00:00',
              ).toLocaleDateString('en-US', {
                month: 'short',
                year: 'numeric',
              })}
            </strong>{' '}
            — blends <strong>Housecall Pro history</strong> (
            {health.retention.hcpCustomers} customers with prior service dates)
            with the live system, so cross-system returns count as repeats.
            Excludes recurring contract work (that&apos;s the Recurring Base
            below); customers with a future booking or marked do-not-contact are
            left off the due list.
          </p>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
                <Briefcase className="h-4 w-4" />
                <p className="text-sm font-medium">Repeat Rate</p>
              </div>
              <p className="stat-value text-2xl font-bold text-emerald-300">
                {health.retention.repeatRatePct.toFixed(1)}%
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {health.retention.repeatCustomers} of{' '}
                {health.retention.customers} came back (
                {health.retention.crossSystemRepeats} from the HCP era)
              </p>
            </Card>

            <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
                <DollarSign className="h-4 w-4" />
                <p className="text-sm font-medium">Repeat Revenue Share</p>
              </div>
              <p className="stat-value text-2xl font-bold text-cyan-300">
                {health.retention.totalRevenue > 0
                  ? (
                      (health.retention.repeatRevenue /
                        health.retention.totalRevenue) *
                      100
                    ).toFixed(0)
                  : 0}
                %
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {formatCurrency(health.retention.repeatRevenue)} from repeat
                customers
              </p>
            </Card>

            <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-purple-400/80">
                <TrendingUp className="h-4 w-4" />
                <p className="text-sm font-medium">Avg Customer Value</p>
              </div>
              <p className="stat-value text-2xl font-bold text-purple-300">
                {formatCurrency(health.retention.avgCustomerValue)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                lifetime, per customer
              </p>
            </Card>

            <Card className="card-interactive animate-slide-up-delay-3 border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-amber-400/80">
                <Clock className="h-4 w-4" />
                <p className="text-sm font-medium">Days Between Cleans</p>
              </div>
              <p className="stat-value text-2xl font-bold text-amber-300">
                {health.retention.medianDaysBetweenVisits ?? '—'}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                median, repeat customers
              </p>
            </Card>
          </div>

          {/* Due for re-clean */}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <p className="mb-1 text-sm font-medium text-amber-700 dark:text-amber-400">
                Due Soon (3–6 months)
              </p>
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                {health.retention.dueSoonCount}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                customers approaching reclean time
              </p>
            </Card>
            <Card className="border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
              <p className="mb-1 text-sm font-medium text-red-700 dark:text-red-400">
                Overdue (6+ months)
              </p>
              <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                {health.retention.overdueCount}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                past a typical reclean cycle
              </p>
            </Card>
            <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
              <p className="text-muted-foreground mb-1 text-sm font-medium">
                Warm Pipeline Value
              </p>
              <p className="text-2xl font-bold">
                {formatCurrency(
                  (health.retention.dueSoonCount +
                    health.retention.overdueCount) *
                    health.retention.avgTicket,
                )}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                due customers × avg ticket — cheapest revenue there is
              </p>
            </Card>
          </div>

          {health.reactivationEngineEnabled === false && (
            <Card className="mt-4 border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                ⚠ The reactivation email engine is turned OFF
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Customers below are enrolled and prioritized by lifetime value,
                but no automated emails go out until the engine is enabled in
                the reactivation settings. The only send so far was the one-time
                bulk blast on June 8, 2026 (276 delivered, ~13 bookings back).
              </p>
            </Card>
          )}

          {health.retention.dueList.length > 0 && (
            <DueRecleanTable rows={health.retention.dueList} />
          )}
        </div>
      )}

      {/* Booking Widget Funnel */}
      {funnel && (
        <div className="mb-8">
          <h2 className="text-gradient-blue mb-1 text-xl font-semibold tracking-tight">
            Booking Tool Funnel
          </h2>
          <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
            Three numbers, last {funnel.windowDays ?? 90} days:{' '}
            <strong>visitors</strong> to the site, <strong>quotes built</strong>{' '}
            (they picked services and saw a price), and{' '}
            <strong>jobs booked</strong>. Counts are unique browser sessions,
            not page views.
          </p>

          {funnel.steps.every((st) => st.sessions === 0) && (
            <Card className="border-border/60 bg-card/80 mb-4 p-4 backdrop-blur">
              <p className="text-sm font-medium">
                Waiting for the first visitors
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Tracking went live on the website today. Nothing was recorded
                before that, so this fills in as people visit over the next few
                days. Give it a week before the conversion rates mean much.
              </p>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-blue-400/80">
                <TrendingUp className="h-4 w-4" />
                <p className="text-sm font-medium">Site Visitors</p>
              </div>
              <p className="stat-value text-2xl font-bold text-blue-300">
                {funnel.visitorSessions}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                unique visits to the website
              </p>
            </Card>

            <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
                <Briefcase className="h-4 w-4" />
                <p className="text-sm font-medium">Quotes Built</p>
              </div>
              <p className="stat-value text-2xl font-bold text-cyan-300">
                {funnel.quoteSessions}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {funnel.visitToQuoteRate}% of visitors
              </p>
            </Card>

            <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
              <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
                <CalendarCheck className="h-4 w-4" />
                <p className="text-sm font-medium">Booked</p>
              </div>
              <p className="stat-value text-2xl font-bold text-emerald-300">
                {funnel.bookedSessions}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {funnel.visitToBookRate}% of all visitors
              </p>
            </Card>

            <Card
              className={`card-interactive animate-slide-up-delay-3 p-4 ${
                funnel.quoteToBookRate >= 30
                  ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950'
                  : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Target className="h-4 w-4" />
                <p className="text-sm font-medium">Quote → Book Rate</p>
              </div>
              <p
                className={`stat-value text-2xl font-bold ${
                  funnel.quoteToBookRate >= 30
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {funnel.quoteToBookRate.toFixed(1)}%
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {funnel.abandonedQuotes} walked away
              </p>
            </Card>

            <Card className="card-interactive animate-slide-up-delay-3 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
              <div className="mb-1 flex items-center gap-2 text-red-700 dark:text-red-400">
                <TrendingDown className="h-4 w-4" />
                <p className="text-sm font-medium">Abandoned Quote Value</p>
              </div>
              <p className="stat-value text-2xl font-bold text-red-700 dark:text-red-400">
                {formatCurrency(funnel.abandonedQuoteValue)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                avg {formatCurrency(funnel.avgAbandonedQuote)} per lost quote
              </p>
            </Card>
          </div>

          {/* Step-by-step drop-off */}
          <Card className="border-border/60 bg-card/80 mt-4 p-4 backdrop-blur">
            <h4 className="mb-3 text-sm font-semibold">
              Where People Drop Off
            </h4>
            <div className="space-y-2">
              {(() => {
                const maxSessions = Math.max(
                  ...funnel.steps.map((st) => st.sessions),
                  1,
                )
                return funnel.steps.map((st) => {
                  const pct = Math.round((st.sessions / maxSessions) * 100)
                  const isDropStep = st.step === funnel.biggestDropStep
                  return (
                    <div key={st.step} className="flex items-center gap-3">
                      <div className="w-44 shrink-0 truncate text-xs">
                        {st.label}
                      </div>
                      <div className="bg-muted h-5 flex-1 overflow-hidden rounded-full">
                        <div
                          className={`flex h-5 items-center rounded-full ${
                            st.step === 'booked'
                              ? 'bg-emerald-500/70'
                              : 'bg-blue-500/60'
                          }`}
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        >
                          <span className="truncate pr-1 pl-2 text-[10px] font-semibold whitespace-nowrap text-white">
                            {st.sessions}
                          </span>
                        </div>
                      </div>
                      <div className="w-14 shrink-0 text-right text-xs font-medium">
                        {st.pctOfQuotes > 0 ? `${st.pctOfQuotes}%` : '—'}
                      </div>
                      <div className="w-24 shrink-0 text-right text-xs">
                        {st.droppedFromPrevious > 0 ? (
                          <span
                            className={
                              isDropStep
                                ? 'font-semibold text-red-600 dark:text-red-400'
                                : 'text-muted-foreground'
                            }
                          >
                            −{st.droppedFromPrevious} lost
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
            {funnel.biggestDropStep && (
              <p className="text-muted-foreground mt-3 text-xs">
                Biggest leak: <strong>{funnel.biggestDropCount}</strong>{' '}
                visitors quit at{' '}
                <strong>
                  {funnel.steps
                    .find((st) => st.step === funnel.biggestDropStep)
                    ?.label.toLowerCase()}
                </strong>
                .
              </p>
            )}
          </Card>

          {funnel.topAbandonedReferrers.length > 0 && (
            <Card className="border-border/60 bg-card/80 mt-4 p-4 backdrop-blur">
              <h4 className="mb-3 text-sm font-semibold">
                Where Abandoned Quotes Came From
              </h4>
              <div className="space-y-2">
                {funnel.topAbandonedReferrers.map((r) => (
                  <div
                    key={r.referrer}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="truncate">{r.referrer}</span>
                    <span className="font-semibold">{r.sessions}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Revenue by Lead Source (YTD) */}
      {sourceRevenue.length > 0 && (
        <div className="mb-8">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-gradient-blue text-xl font-semibold tracking-tight">
              Revenue by Lead Source — {new Date().getFullYear()}
            </h2>
            <a
              href="/admin/stats/lead-sources"
              className="text-xs text-green-600 hover:text-green-700 hover:underline"
            >
              View Detailed Analytics →
            </a>
          </div>
          <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
            Where the money comes from, not just the job count — use this to
            decide where marketing dollars go.
          </p>
          <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="space-y-2">
              {(() => {
                const maxRev = Math.max(
                  ...sourceRevenue.map((s) => s.total_revenue),
                  1,
                )
                return sourceRevenue.map((s) => (
                  <div key={s.lead_source} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 truncate text-sm">
                      {s.lead_source}
                    </div>
                    <div className="bg-muted h-4 flex-1 overflow-hidden rounded-full">
                      <div
                        className="flex h-4 items-center rounded-full bg-blue-500/70"
                        style={{
                          width: `${Math.max((s.total_revenue / maxRev) * 100, 2)}%`,
                        }}
                      />
                    </div>
                    <div className="w-20 shrink-0 text-right text-sm font-semibold">
                      {formatCurrency(s.total_revenue)}
                    </div>
                    <div className="text-muted-foreground w-24 shrink-0 text-right text-xs">
                      {s.booking_count} jobs · {formatCurrency(s.avg_ticket)}{' '}
                      avg
                    </div>
                  </div>
                ))
              })()}
            </div>
          </Card>
        </div>
      )}

      {/* Recurring Base + Booked Out */}
      {health && (
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-gradient mb-1 text-xl font-semibold tracking-tight">
              Recurring Base
            </h2>
            <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
              Revenue that shows up without marketing — your floor.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
                <p className="text-muted-foreground mb-1 text-sm font-medium">
                  Recurring Revenue YTD
                </p>
                <p className="stat-value text-2xl font-bold text-emerald-300">
                  {formatCurrency(health.recurring.completedRevenue)}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {health.recurring.pctOfCompletedRevenue.toFixed(0)}% of
                  completed ops revenue
                </p>
              </Card>
              <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
                <p className="text-muted-foreground mb-1 text-sm font-medium">
                  Recurring Booked Ahead
                </p>
                <p className="stat-value text-2xl font-bold text-blue-300">
                  {formatCurrency(health.recurring.bookedRevenue)}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {health.recurring.bookedJobs} jobs on the calendar
                </p>
              </Card>
            </div>
          </div>

          <div>
            <h2 className="text-gradient-amber mb-1 text-xl font-semibold tracking-tight">
              Booked Out
            </h2>
            <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
              Days until each tech&apos;s next 2-hour opening. Consistently 10+
              days out = time to hire.
            </p>
            <div className="grid grid-cols-2 gap-4">
              {health.bookedOut.map((b) => {
                const label =
                  b.daysOut === null
                    ? `${health.bookedOutScanDays}+ days`
                    : b.daysOut === 0
                      ? 'Today'
                      : b.daysOut === 1
                        ? 'Tomorrow'
                        : `${b.daysOut} days`
                const color =
                  b.daysOut === null || b.daysOut >= 10
                    ? 'text-red-600 dark:text-red-400'
                    : b.daysOut >= 5
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-400'
                return (
                  <Card
                    key={b.staffUserId}
                    className="border-border/60 bg-card/80 p-4 backdrop-blur"
                  >
                    <p className="text-muted-foreground mb-1 truncate text-sm font-medium">
                      {b.staffName}
                    </p>
                    <p className={`stat-value text-2xl font-bold ${color}`}>
                      {label}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      next open 2-hr slot
                    </p>
                  </Card>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Pace Tracking */}
      <div>
        <h2 className="text-gradient-purple mb-4 text-xl font-semibold tracking-tight">
          Pace to Goal
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-muted-foreground mb-1 text-sm font-medium">
              Annual Goal
            </p>
            <p className="text-2xl font-bold">
              {formatCurrency(settings.annual_revenue_goal)}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-muted-foreground mb-1 text-sm font-medium">
              Weekly Target
            </p>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.pace.weeklyTarget)}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-muted-foreground mb-1 text-sm font-medium">
              Current Weekly Avg
            </p>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.pace.weeklyAverage)}
            </p>
          </Card>

          <Card
            className={`p-4 ${stats.pace.onPace ? 'bg-green-50 dark:bg-green-950/30' : 'bg-yellow-50 dark:bg-yellow-950/30'}`}
          >
            <div className="mb-1 flex items-center gap-2">
              {stats.pace.onPace ? (
                <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <TrendingDown className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              )}
              <p className="text-sm font-medium">Status</p>
            </div>
            <p
              className={`text-2xl font-bold ${stats.pace.onPace ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}
            >
              {stats.pace.onPace ? 'On Pace' : 'Behind Pace'}
            </p>
          </Card>
        </div>

        <Card className="mt-4 p-6">
          <div className="space-y-4">
            {(() => {
              const proj = pipeline?.projection
              const projected = proj
                ? proj.projectedAnnual
                : stats.pace.projectedAnnual
              return (
                <>
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Projected Annual Revenue</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(projected)}
                    </p>
                  </div>

                  {proj && (
                    <div className="bg-muted/40 space-y-2 rounded-lg p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Banked so far this year
                        </span>
                        <span className="font-medium">
                          {formatCurrency(proj.ytdActual)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Forecast for the rest of the year
                        </span>
                        <span className="font-medium">
                          {formatCurrency(proj.projectedRemainder)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          — of which already booked
                        </span>
                        <span className="font-medium">
                          {formatCurrency(proj.bookedRemainder)}
                        </span>
                      </div>
                      <p className="text-muted-foreground border-t pt-2 leading-relaxed">
                        {proj.method === 'seasonal' ? (
                          <>
                            Based on your{' '}
                            <strong>{proj.recentWindowLabel}</strong> pace (
                            {formatCurrency(proj.annualizedRunRate)}/yr at
                            current staffing), spread across the rest of the
                            year using real seasonality from{' '}
                            {proj.seasonalityYears.join(', ')} QuickBooks
                            history. Historically{' '}
                            <strong>
                              {Math.round(proj.remainingShare * 100)}%
                            </strong>{' '}
                            of a year&apos;s revenue still lands after today.
                          </>
                        ) : (
                          <>
                            Based on your{' '}
                            <strong>{proj.recentWindowLabel}</strong> pace. No
                            prior-year history available yet, so months are
                            weighted equally.
                          </>
                        )}
                        {proj.bookedIsFloor && (
                          <>
                            {' '}
                            Booked work already exceeds the forecast, so the
                            booked total is used.
                          </>
                        )}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <p className="text-muted-foreground">Progress to Goal</p>
                      <p className="font-medium">
                        {stats.pace.percentOfGoal.toFixed(1)}%
                      </p>
                    </div>
                    <div className="bg-muted h-3 w-full rounded-full">
                      <div
                        className={`h-3 rounded-full transition-all ${stats.pace.onPace ? 'bg-green-500' : 'bg-yellow-500'}`}
                        style={{
                          width: `${Math.min(stats.pace.percentOfGoal, 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {!stats.pace.onPace && (
                    <p className="text-sm text-yellow-600 dark:text-yellow-400">
                      Need to average {formatCurrency(stats.pace.weeklyTarget)}{' '}
                      per week to reach goal
                    </p>
                  )}
                </>
              )
            })()}
          </div>
        </Card>
      </div>
    </div>
  )
}
