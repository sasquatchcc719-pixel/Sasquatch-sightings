import type { SupabaseClient } from '@supabase/supabase-js'
import { loadProfitAndLossCost } from '@/lib/quickbooks-profit-loss'
import { loadUtilizationSupplementRows } from '@/lib/ops/utilization-supplement'
import {
  excludeJobsCoveredByRevenueEntries,
  utilizationHoursFromAppointment,
} from '@/lib/ops/utilization-metrics'

const MOUNTAIN_TIME = 'America/Denver'
export const OWNER_FIELD_REPLACEMENT_RATE = 31
export const BUSINESS_COST_HISTORY_START = '2026-05-01'

export type CostWindow = { start: string; end: string }
export type BusinessCostPeriod = 'rolling_28_day' | 'weekly' | 'year_to_date'

export type BusinessCostSnapshot = {
  periodKind: BusinessCostPeriod
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

type RevenueHourRow = {
  date: string
  revenue: number
  hours: number
}

type OwnerHourRow = { date: string; hours: number }

const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function mountainDateKey(value: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TIME,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function latestCompletedWednesday(now = new Date()): string {
  const yesterday = addDays(mountainDateKey(now), -1)
  const day = new Date(`${yesterday}T12:00:00Z`).getUTCDay()
  const daysSinceWednesday = (day - 3 + 7) % 7
  return addDays(yesterday, -daysSinceWednesday)
}

export function weeklyCostWindowsSince(
  earliestStart = BUSINESS_COST_HISTORY_START,
  now = new Date(),
): CostWindow[] {
  const windows: CostWindow[] = []
  for (let end = latestCompletedWednesday(now); ; end = addDays(end, -7)) {
    const start = addDays(end, -6)
    if (start < earliestStart) break
    windows.push({ start, end })
  }
  return windows.reverse()
}

export function yearToDateCostWindow(now = new Date()): CostWindow {
  const end = latestCompletedWednesday(now)
  return { start: `${end.slice(0, 4)}-01-01`, end }
}

export function calculateBusinessCostSnapshot(params: {
  periodKind: BusinessCostPeriod
  window: CostWindow
  revenue: number
  productiveHours: number
  quickbooksCost: number
  excludedBookkeepingAdjustments: number
  ownerFieldHours: number
  expenseBreakdown: Record<string, number>
  capturedAt?: string
}): BusinessCostSnapshot {
  const ownerReplacementCost =
    params.ownerFieldHours * OWNER_FIELD_REPLACEMENT_RATE
  const ownerAdjustedCost = params.quickbooksCost + ownerReplacementCost
  const revenuePerHour =
    params.productiveHours > 0 ? params.revenue / params.productiveHours : 0
  const bookCostPerHour =
    params.productiveHours > 0
      ? params.quickbooksCost / params.productiveHours
      : 0
  const ownerAdjustedCostPerHour =
    params.productiveHours > 0 ? ownerAdjustedCost / params.productiveHours : 0
  const bookCostPct =
    params.revenue > 0 ? (params.quickbooksCost / params.revenue) * 100 : 0
  const ownerAdjustedCostPct =
    params.revenue > 0 ? (ownerAdjustedCost / params.revenue) * 100 : 0

  return {
    periodKind: params.periodKind,
    windowStart: params.window.start,
    windowEnd: params.window.end,
    capturedAt: params.capturedAt || new Date().toISOString(),
    revenue: round2(params.revenue),
    productiveHours: round2(params.productiveHours),
    quickbooksCost: round2(params.quickbooksCost),
    excludedBookkeepingAdjustments: round2(
      params.excludedBookkeepingAdjustments,
    ),
    ownerFieldHours: round2(params.ownerFieldHours),
    ownerReplacementCost: round2(ownerReplacementCost),
    revenuePerHour: round2(revenuePerHour),
    bookCostPerHour: round2(bookCostPerHour),
    ownerAdjustedCostPerHour: round2(ownerAdjustedCostPerHour),
    bookCostPct: round2(bookCostPct),
    ownerAdjustedCostPct: round2(ownerAdjustedCostPct),
    ownerAdjustedMarginPct: round2(100 - ownerAdjustedCostPct),
    expenseBreakdown: params.expenseBreakdown,
  }
}

function inWindow(date: string, window: CostWindow): boolean {
  return date >= window.start && date <= window.end
}

async function loadRevenueHourRows(
  supabase: SupabaseClient,
  earliestStart: string,
): Promise<RevenueHourRow[]> {
  const [
    { data: jobs, error: jobsError },
    { data: entries, error: entriesError },
  ] = await Promise.all([
    supabase
      .from('jobs')
      .select('invoice_amount, hours_worked, created_at, ops_invoice_id')
      .gte('created_at', `${earliestStart}T00:00:00Z`),
    supabase
      .from('revenue_entries')
      .select(
        'invoice_amount, hours_worked, entry_date, drive_minutes, ops_invoice_id',
      )
      .gte('entry_date', earliestStart),
  ])
  if (jobsError) throw jobsError
  if (entriesError) throw entriesError

  const supplement = await loadUtilizationSupplementRows(supabase)
  return [
    ...excludeJobsCoveredByRevenueEntries(jobs || [], entries || []).map(
      (row) => ({
        date: mountainDateKey(row.created_at),
        revenue: Number(row.invoice_amount || 0),
        hours: Number(row.hours_worked || 0),
      }),
    ),
    ...(entries || []).map((row) => ({
      date: String(row.entry_date).slice(0, 10),
      revenue: Number(row.invoice_amount || 0),
      hours:
        Number(row.hours_worked || 0) + Number(row.drive_minutes || 0) / 60,
    })),
    ...supplement
      .filter((row) => row.date.slice(0, 10) >= earliestStart)
      .map((row) => ({
        date: row.date.slice(0, 10),
        revenue: Number(row.invoice_amount || 0),
        hours: Number(row.hours_worked || 0),
      })),
  ]
}

async function loadOwnerHourRows(
  supabase: SupabaseClient,
  earliestStart: string,
): Promise<OwnerHourRow[]> {
  const { data: owner, error: ownerError } = await supabase
    .from('staff_users')
    .select('id')
    .eq('is_active', true)
    .eq('role', 'owner')
    .order('scheduling_priority', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (ownerError) throw ownerError
  if (!owner) return []

  const { data: appointments, error } = await supabase
    .from('ops_appointments')
    .select(
      'appointment_date, start_time, end_time, on_my_way_at, completed_at',
    )
    .eq('assigned_staff_user_id', owner.id)
    .eq('status', 'completed')
    .gte('appointment_date', earliestStart)
  if (error) throw error

  return (appointments || []).map((appointment) => ({
    date: String(appointment.appointment_date).slice(0, 10),
    hours: utilizationHoursFromAppointment(appointment),
  }))
}

function toRow(snapshot: BusinessCostSnapshot) {
  return {
    period_kind: snapshot.periodKind,
    window_start: snapshot.windowStart,
    window_end: snapshot.windowEnd,
    captured_at: snapshot.capturedAt,
    revenue: snapshot.revenue,
    productive_hours: snapshot.productiveHours,
    quickbooks_cost: snapshot.quickbooksCost,
    excluded_bookkeeping_adjustments: snapshot.excludedBookkeepingAdjustments,
    owner_field_hours: snapshot.ownerFieldHours,
    owner_replacement_cost: snapshot.ownerReplacementCost,
    revenue_per_hour: snapshot.revenuePerHour,
    book_cost_per_hour: snapshot.bookCostPerHour,
    owner_adjusted_cost_per_hour: snapshot.ownerAdjustedCostPerHour,
    book_cost_pct: snapshot.bookCostPct,
    owner_adjusted_cost_pct: snapshot.ownerAdjustedCostPct,
    owner_adjusted_margin_pct: snapshot.ownerAdjustedMarginPct,
    expense_breakdown: snapshot.expenseBreakdown,
  }
}

export function coerceBusinessCostSnapshot(
  row: Record<string, unknown>,
): BusinessCostSnapshot {
  return {
    periodKind:
      (row.period_kind as BusinessCostPeriod | undefined) || 'rolling_28_day',
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    capturedAt: String(row.captured_at),
    revenue: Number(row.revenue || 0),
    productiveHours: Number(row.productive_hours || 0),
    quickbooksCost: Number(row.quickbooks_cost || 0),
    excludedBookkeepingAdjustments: Number(
      row.excluded_bookkeeping_adjustments || 0,
    ),
    ownerFieldHours: Number(row.owner_field_hours || 0),
    ownerReplacementCost: Number(row.owner_replacement_cost || 0),
    revenuePerHour: Number(row.revenue_per_hour || 0),
    bookCostPerHour: Number(row.book_cost_per_hour || 0),
    ownerAdjustedCostPerHour: Number(row.owner_adjusted_cost_per_hour || 0),
    bookCostPct: Number(row.book_cost_pct || 0),
    ownerAdjustedCostPct: Number(row.owner_adjusted_cost_pct || 0),
    ownerAdjustedMarginPct: Number(row.owner_adjusted_margin_pct || 0),
    expenseBreakdown:
      row.expense_breakdown && typeof row.expense_breakdown === 'object'
        ? Object.fromEntries(
            Object.entries(row.expense_breakdown).map(([key, value]) => [
              key,
              Number(value || 0),
            ]),
          )
        : {},
  }
}

export async function refreshBusinessCostSnapshots(
  supabase: SupabaseClient,
  windows: CostWindow[],
  periodKind: BusinessCostPeriod,
): Promise<BusinessCostSnapshot[]> {
  if (windows.length === 0) return []
  const earliestStart = windows.reduce(
    (min, window) => (window.start < min ? window.start : min),
    windows[0].start,
  )
  const [revenueRows, ownerRows] = await Promise.all([
    loadRevenueHourRows(supabase, earliestStart),
    loadOwnerHourRows(supabase, earliestStart),
  ])
  const snapshots: BusinessCostSnapshot[] = []

  for (const window of windows) {
    const operational = revenueRows
      .filter((row) => inWindow(row.date, window))
      .reduce(
        (sum, row) => ({
          revenue: sum.revenue + row.revenue,
          hours: sum.hours + row.hours,
        }),
        { revenue: 0, hours: 0 },
      )
    if (operational.hours <= 0) continue

    const ownerFieldHours = ownerRows
      .filter((row) => inWindow(row.date, window))
      .reduce((sum, row) => sum + row.hours, 0)
    const quickbooks = await loadProfitAndLossCost({
      startDate: window.start,
      endDate: window.end,
    })
    snapshots.push(
      calculateBusinessCostSnapshot({
        periodKind,
        window,
        revenue: operational.revenue,
        productiveHours: operational.hours,
        quickbooksCost: quickbooks.operatingCost,
        excludedBookkeepingAdjustments: quickbooks.reconciliationDiscrepancies,
        ownerFieldHours,
        expenseBreakdown: quickbooks.expenseBreakdown,
      }),
    )
  }

  if (snapshots.length > 0) {
    const { error } = await supabase
      .from('business_cost_snapshots')
      .upsert(snapshots.map(toRow), {
        onConflict: 'period_kind,window_start,window_end',
      })
    if (error) throw error
  }
  return snapshots
}

export async function loadBusinessCostSnapshots(
  supabase: SupabaseClient,
  periodKind: BusinessCostPeriod,
  limit = 52,
): Promise<BusinessCostSnapshot[]> {
  let query = supabase
    .from('business_cost_snapshots')
    .select('*')
    .eq('period_kind', periodKind)
  if (periodKind === 'weekly') {
    query = query.gte('window_start', BUSINESS_COST_HISTORY_START)
  }
  const { data, error } = await query
    .order('window_end', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).map((row) => coerceBusinessCostSnapshot(row)).reverse()
}

function signed(value: number, suffix = ''): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}${suffix}`
}

function signedMoney(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toFixed(2)}`
}

export function buildBusinessCostDigest(
  weeklySnapshots: BusinessCostSnapshot[],
  yearToDate: BusinessCostSnapshot | null,
): string {
  const latest = weeklySnapshots[weeklySnapshots.length - 1]
  if (!latest) return 'Business Cost Report — no productive hours available.'
  const previous = weeklySnapshots[weeklySnapshots.length - 2]
  const costDelta = previous
    ? latest.ownerAdjustedCostPerHour - previous.ownerAdjustedCostPerHour
    : null
  const marginDelta = previous
    ? latest.ownerAdjustedMarginPct - previous.ownerAdjustedMarginPct
    : null

  return [
    'Weekly Business Cost Report',
    `${latest.windowStart} through ${latest.windowEnd} (Thu–Wed)`,
    '',
    `Work completed: $${latest.revenue.toFixed(2)} revenue across ${latest.productiveHours.toFixed(1)} productive hours`,
    '',
    `Revenue/hour: $${latest.revenuePerHour.toFixed(2)}`,
    `QuickBooks cost/hour: $${latest.bookCostPerHour.toFixed(2)}`,
    `Owner-adjusted cost/hour: $${latest.ownerAdjustedCostPerHour.toFixed(2)}`,
    `Cost share: ${latest.ownerAdjustedCostPct.toFixed(1)}%`,
    `Margin after tracked costs: ${latest.ownerAdjustedMarginPct.toFixed(1)}%`,
    ...(costDelta === null
      ? []
      : [
          '',
          `Versus prior week: cost/hour ${signedMoney(costDelta)}, margin ${signed(marginDelta || 0, ' pts')}`,
        ]),
    ...(yearToDate
      ? [
          '',
          `${yearToDate.windowEnd.slice(0, 4)} YEAR-TO-DATE AVERAGE`,
          `Revenue/hour: $${yearToDate.revenuePerHour.toFixed(2)}`,
          `Owner-adjusted cost/hour: $${yearToDate.ownerAdjustedCostPerHour.toFixed(2)}`,
          `Cost share: ${yearToDate.ownerAdjustedCostPct.toFixed(1)}%`,
          `Tracked margin: ${yearToDate.ownerAdjustedMarginPct.toFixed(1)}%`,
        ]
      : []),
    '',
    `Owner field time valued at $${OWNER_FIELD_REPLACEMENT_RATE}/hour. No estimated depreciation, processor fees, loan principal, owner draws, income-tax payments, or untracked office time are included.`,
  ].join('\n')
}
