import { mountainDateKey } from '@/lib/ops/calendar-dates'
import {
  planRecurringSchedule,
  type RecurringCandidate,
  type RecurringScheduleOccurrence,
  type RecurringVisitOverrides,
} from '@/lib/ops/recurring-scheduling'
import { sortLineItems } from '@/lib/ops/line-item-order'
import type { SupabaseClient } from '@supabase/supabase-js'
import { firstTouchForCustomer } from '@/lib/ops/attribution'
import {
  addMinutesToTimeWithinDay,
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
} from '@/lib/ops/availability'
import { findAppointmentConflict } from '@/lib/ops/availability-bundle'
import {
  buildQuickBooksCustomerPayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import { syncBatchInvoiceToQuickBooks } from '@/lib/quickbooks-api'
import { ensureCustomerQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import { effectiveBillingMode } from '@/lib/ops/monthly-restoration-billing'

// ─── Types ──────────────────────────────────────────────────────────────

export type TemplateLineItem = {
  pricing_unit_snapshot?: string | null
  length_value?: number | null
  width_value?: number | null
  area_segments?: { length: number; width: number }[] | null
  service_catalog_item_id?: string | null
  name_snapshot: string
  quantity: number
  unit_price: number
  duration_minutes: number
  buffer_minutes?: number
  notes?: string | null
}

export type RecurringTemplate = {
  id: string
  customer_id: string
  service_address_id: string
  label: string
  line_items: TemplateLineItem[]
  start_time: string
  scheduled_duration_minutes: number
  discount_amount: number
  internal_notes: string | null
  invoice_mode: 'per_visit' | 'batch_monthly'
  booking_channel: string
  is_active: boolean
  is_subcontracted: boolean
  subcontractor_name: string | null
  assigned_staff_user_id: string | null
  scheduling_mode?: 'fixed' | 'flexible'
  visit_overrides?: RecurringVisitOverrides | null
}

export type RecurrenceRule = {
  id: string
  template_id: string
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'custom'
  day_of_week: number | null
  week_of_month: number | null
  day_of_month: number | null
  interval_days: number | null
  effective_from: string
  effective_until: string | null
  override_start_time: string | null
}

// ─── Date expansion ─────────────────────────────────────────────────────

function getWeekOfMonth(date: Date): number {
  const day = date.getDate()
  return Math.ceil(day / 7)
}

function validRuleDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`)
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  )
}

function validateRecurrenceRule(rule: RecurrenceRule) {
  const integerWithin = (value: number | null, min: number, max: number) =>
    Number.isInteger(value) && Number(value) >= min && Number(value) <= max
  if (
    !validRuleDate(rule.effective_from) ||
    (rule.effective_until != null && !validRuleDate(rule.effective_until))
  )
    throw new Error('Recurrence rules need valid effective dates.')
  if (rule.effective_until && rule.effective_until < rule.effective_from)
    throw new Error('A recurrence rule cannot end before it starts.')
  if (
    (rule.frequency === 'weekly' || rule.frequency === 'biweekly') &&
    !integerWithin(rule.day_of_week, 0, 6)
  )
    throw new Error('Weekly recurrence rules need a weekday from 0 to 6.')
  if (
    rule.frequency === 'monthly' &&
    !(rule.day_of_month != null
      ? integerWithin(rule.day_of_month, 1, 31)
      : integerWithin(rule.day_of_week, 0, 6) &&
        integerWithin(rule.week_of_month, 1, 5))
  )
    throw new Error(
      'Monthly recurrence rules need a valid day or weekday occurrence.',
    )
  if (
    rule.frequency === 'custom' &&
    (!Number.isInteger(rule.interval_days) || Number(rule.interval_days) <= 0)
  )
    throw new Error('Custom recurrence intervals must be positive whole days.')
  if (!['weekly', 'biweekly', 'monthly', 'custom'].includes(rule.frequency))
    throw new Error('Choose a supported recurrence frequency.')
}

/**
 * Expand a single recurrence rule into concrete dates within [rangeStart, rangeEnd].
 */
export function expandRule(
  rule: RecurrenceRule,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  validateRecurrenceRule(rule)
  const dates: Date[] = []
  const effectiveFrom = new Date(rule.effective_from + 'T00:00:00')
  const effectiveUntil = rule.effective_until
    ? new Date(rule.effective_until + 'T23:59:59')
    : rangeEnd

  const start = effectiveFrom > rangeStart ? effectiveFrom : rangeStart
  const end = effectiveUntil < rangeEnd ? effectiveUntil : rangeEnd

  if (start > end) return dates

  if (rule.frequency === 'weekly' || rule.frequency === 'biweekly') {
    if (rule.day_of_week == null) return dates
    const cursor = new Date(effectiveFrom)
    while (cursor.getDay() !== rule.day_of_week) {
      cursor.setDate(cursor.getDate() + 1)
    }
    const step = rule.frequency === 'biweekly' ? 14 : 7
    while (cursor <= end) {
      if (cursor >= start) {
        dates.push(new Date(cursor))
      }
      cursor.setDate(cursor.getDate() + step)
    }
  } else if (rule.frequency === 'monthly') {
    if (rule.day_of_month != null) {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
      while (cursor <= end) {
        const maxDay = new Date(
          cursor.getFullYear(),
          cursor.getMonth() + 1,
          0,
        ).getDate()
        const targetDay = Math.min(rule.day_of_month, maxDay)
        const candidate = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          targetDay,
        )
        if (candidate >= start && candidate <= end) {
          dates.push(candidate)
        }
        cursor.setMonth(cursor.getMonth() + 1)
      }
    } else if (rule.day_of_week != null && rule.week_of_month != null) {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
      while (cursor <= end) {
        const candidate = getNthWeekdayOfMonth(
          cursor.getFullYear(),
          cursor.getMonth(),
          rule.day_of_week,
          rule.week_of_month,
        )
        if (candidate && candidate >= start && candidate <= end) {
          dates.push(candidate)
        }
        cursor.setMonth(cursor.getMonth() + 1)
      }
    }
  } else if (rule.frequency === 'custom' && rule.interval_days) {
    const cursor = new Date(effectiveFrom)
    while (cursor <= end) {
      if (cursor >= start) {
        dates.push(new Date(cursor))
      }
      cursor.setDate(cursor.getDate() + rule.interval_days)
    }
  }

  return dates
}

function getNthWeekdayOfMonth(
  year: number,
  month: number,
  dayOfWeek: number,
  weekOfMonth: number,
): Date | null {
  const firstDay = new Date(year, month, 1)
  let firstOccurrence =
    firstDay.getDay() <= dayOfWeek
      ? dayOfWeek - firstDay.getDay() + 1
      : 7 - firstDay.getDay() + dayOfWeek + 1

  const targetDay = firstOccurrence + (weekOfMonth - 1) * 7
  const maxDay = new Date(year, month + 1, 0).getDate()
  if (targetDay > maxDay) return null
  return new Date(year, month, targetDay)
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Move weekends to Monday, or Friday when a monthly visit would cross month-end.
 * The nominal rule date is still stored as original_recurring_date, so
 * regeneration remains idempotent even when the visible appointment moves.
 */
export function moveRecurringDateToWeekday(
  ymd: string,
  stayInMonth = false,
): string {
  const d = new Date(ymd + 'T12:00:00')
  const dow = d.getDay()
  if (dow !== 0 && dow !== 6) return ymd
  d.setDate(d.getDate() + (dow === 6 ? 2 : 1))
  if (stayInMonth && formatDate(d).slice(0, 7) !== ymd.slice(0, 7)) {
    d.setTime(new Date(ymd + 'T12:00:00').getTime())
    d.setDate(d.getDate() - (dow === 6 ? 1 : 2))
  }
  return formatDate(d)
}

function addCalendarDays(ymd: string, amount: number): string {
  const date = new Date(ymd + 'T12:00:00')
  date.setDate(date.getDate() + amount)
  return formatDate(date)
}

function nextWeekdayOnOrAfter(ymd: string): string {
  let candidate = ymd
  while ([0, 6].includes(new Date(candidate + 'T12:00:00').getDay())) {
    candidate = addCalendarDays(candidate, 1)
  }
  return candidate
}

export type RecurringPreviewDate = {
  date: string
  original_date: string
  shifted: boolean
}

function monthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7)
}

/** Monday 00:00 in local time — two dates in the same calendar week share the same key. */
function mondayKeyFromYmd(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00')
  const dow = d.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  return formatDate(d)
}

/**
 * Whether moving / rescheduling a generated visit for this date should block the cron
 * from also scheduling the "nominal" rule date. Uses all existing rows for the template
 * in the planning window (moves stay on recurring_template_id, so the moved date appears here).
 */
function shouldSkipRecurringSlot(args: {
  candidateDate: string
  scheduledDate: string
  rule: RecurrenceRule
  templateDates: Set<string>
  /** true when this YYYY-MM has only one rule-generated date in the whole horizon. */
  monthIsSingleInstance: boolean
  extraBlockedDates: Set<string>
  /** original_recurring_date values for all template appointments in the window.
   *  Blocks slots that were already generated and then moved to a different week. */
  originalRecurringDates: Set<string>
}): boolean {
  const {
    candidateDate,
    scheduledDate,
    rule,
    templateDates,
    monthIsSingleInstance,
    extraBlockedDates,
    originalRecurringDates,
  } = args
  if (
    extraBlockedDates.has(candidateDate) ||
    extraBlockedDates.has(scheduledDate) ||
    templateDates.has(candidateDate) ||
    templateDates.has(scheduledDate) ||
    originalRecurringDates.has(candidateDate)
  ) {
    return true
  }
  if (templateDates.size === 0) return false

  const templateDateList = [...templateDates]

  if (rule.frequency === 'monthly') {
    if (monthIsSingleInstance) {
      const mk = monthKeyFromYmd(candidateDate)
      for (const t of templateDateList) {
        if (monthKeyFromYmd(t) === mk) return true
      }
    } else {
      const wk = mondayKeyFromYmd(candidateDate)
      for (const t of templateDateList) {
        if (mondayKeyFromYmd(t) === wk) return true
      }
    }
    return false
  }

  if (rule.frequency === 'weekly' || rule.frequency === 'biweekly') {
    const wk = mondayKeyFromYmd(candidateDate)
    for (const t of templateDateList) {
      if (mondayKeyFromYmd(t) === wk) return true
    }
  }

  return false
}

/** Expand one year of nominal visits, retaining per-rule times and the next due-date boundary. */
export function recurringScheduleCandidates(
  rules: RecurrenceRule[],
  startTime: string,
  options: {
    fromDate?: Date | string
    horizonMonths?: number
    count?: number
  } = {},
): RecurringCandidate[] {
  const startKey =
    typeof options.fromDate === 'string'
      ? options.fromDate
      : mountainDateKey(options.fromDate || new Date())
  if (!validRuleDate(startKey)) throw new Error('Choose a valid planning date.')
  if (
    options.horizonMonths !== undefined &&
    (!Number.isInteger(options.horizonMonths) || options.horizonMonths < 0)
  )
    throw new Error('The planning horizon must be whole months.')
  const start = new Date(`${startKey}T00:00:00`)
  const end = new Date(start)
  end.setMonth(end.getMonth() + (options.horizonMonths ?? 12))
  const lookAhead = new Date(end)
  lookAhead.setDate(lookAhead.getDate() + 14)
  const candidates = new Map<string, RecurringCandidate>()
  for (const rule of rules) {
    for (const date of expandRule(rule, start, lookAhead)) {
      const original = formatDate(date)
      candidates.set(original, {
        original_date: original,
        date: moveRecurringDateToWeekday(
          original,
          rule.frequency === 'monthly',
        ),
        ...(rule.frequency === 'monthly'
          ? {
              earliest_date: [
                original.slice(0, 7) + '-01',
                rule.effective_from,
                startKey,
              ]
                .sort()
                .at(-1)!,
              latest_date: [
                formatDate(
                  new Date(date.getFullYear(), date.getMonth() + 1, 0),
                ),
                rule.effective_until,
              ]
                .filter((value): value is string => Boolean(value))
                .sort()[0],
            }
          : {}),
        start_time: `${(rule.override_start_time || startTime).slice(0, 5)}:00`,
      })
    }
  }
  const all = [...candidates.values()].sort((a, b) =>
    a.original_date.localeCompare(b.original_date),
  )
  return all
    .map((candidate, index) => ({
      ...candidate,
      next_original_date: all[index + 1]?.original_date,
    }))
    .filter((candidate) => candidate.original_date <= formatDate(end))
    .slice(0, options.count ?? Infinity)
}

// ─── Preview ────────────────────────────────────────────────────────────

/**
 * Returns the next N dates that would be generated from a set of rules.
 * Used for the UI preview panel.
 */
export function previewDates(
  rules: RecurrenceRule[],
  count: number = 10,
  fromDate?: Date,
): string[] {
  return previewDateDetails(rules, count, fromDate).map((item) => item.date)
}

/**
 * Preview the dates customers and staff will actually see on the calendar,
 * while retaining the nominal rule date so weekend shifts are explicit.
 */
export function previewDateDetails(
  rules: RecurrenceRule[],
  count: number = 10,
  fromDate?: Date,
): RecurringPreviewDate[] {
  const start = fromDate || new Date(`${mountainDateKey(new Date())}T00:00:00`)
  return recurringScheduleCandidates(rules, '09:00', {
    fromDate: formatDate(start),
    count,
  }).map((candidate) => ({
    date: candidate.date,
    original_date: candidate.original_date,
    shifted: candidate.date !== candidate.original_date,
  }))
}

// ─── Generation ─────────────────────────────────────────────────────────

export type GenerationResult = {
  templateId: string
  label: string
  created: number
  skipped: number
  errors: string[]
}

/**
 * Generate appointments for a single recurring template within the given horizon.
 * Skips dates where an appointment already exists for this template.
 * For batch_monthly templates, no individual invoice is created.
 */
export async function generateRecurringAppointments(
  supabase: SupabaseClient,
  templateId: string,
  horizonMonths: number = 12,
): Promise<GenerationResult> {
  const result: GenerationResult = {
    templateId,
    label: '',
    created: 0,
    skipped: 0,
    errors: [],
  }

  const { data: template, error: tplErr } = await supabase
    .from('ops_recurring_templates')
    .select('*')
    .eq('id', templateId)
    .single()

  if (tplErr || !template) {
    result.errors.push('Template not found')
    return result
  }

  result.label = template.label

  if (!template.is_active) {
    result.errors.push('Template is paused')
    return result
  }

  let assignedStaffAuthUserId: string | null = null
  if (template.assigned_staff_user_id) {
    const { data: assignedStaff, error: assignedStaffError } = await supabase
      .from('staff_users')
      .select('user_id')
      .eq('id', template.assigned_staff_user_id)
      .eq('is_active', true)
      .maybeSingle()
    if (assignedStaffError || !assignedStaff) {
      result.errors.push(
        'The assigned technician is inactive or missing. Reassign the plan before generating visits.',
      )
      return result
    }
    assignedStaffAuthUserId = assignedStaff.user_id || null
  }

  const { data: rules, error: rulesErr } = await supabase
    .from('ops_recurrence_rules')
    .select('*')
    .eq('template_id', templateId)

  if (rulesErr || !rules || rules.length === 0) {
    result.errors.push('No recurrence rules found')
    return result
  }

  const rangeStart = new Date(`${mountainDateKey(new Date())}T00:00:00`)
  const rangeEnd = new Date(rangeStart)
  rangeEnd.setMonth(rangeEnd.getMonth() + horizonMonths)

  const candidates = recurringScheduleCandidates(
    rules as RecurrenceRule[],
    template.start_time,
    { fromDate: formatDate(rangeStart), horizonMonths },
  )
  const dateToRule = new Map<string, RecurrenceRule>()
  for (const rule of rules as RecurrenceRule[]) {
    for (const date of expandRule(rule, rangeStart, rangeEnd)) {
      const key = formatDate(date)
      if (!dateToRule.has(key)) dateToRule.set(key, rule)
    }
  }
  const uniqueDates = candidates.map((candidate) => ({
    date: candidate.original_date,
    startTime: candidate.start_time.slice(0, 5),
    scheduledDate: candidate.date,
  }))

  if (uniqueDates.length === 0) {
    return result
  }

  const countDatesPerMonth = new Map<string, number>()
  for (const { date } of uniqueDates) {
    const mk = monthKeyFromYmd(date)
    countDatesPerMonth.set(mk, (countDatesPerMonth.get(mk) || 0) + 1)
  }

  const rangeStartStr = formatDate(rangeStart)
  const rangeEndStr = formatDate(rangeEnd)
  const scheduledCandidateDates = [
    ...new Set(candidates.map((candidate) => candidate.date)),
  ]

  const [
    { data: templateInRange, error: rangeError },
    { data: templateByOriginal, error: originalsError },
    { data: customerExisting, error: customerExistingError },
  ] = await Promise.all([
    supabase
      .from('ops_appointments')
      .select('appointment_date, original_recurring_date')
      .eq('recurring_template_id', templateId)
      .gte('appointment_date', rangeStartStr)
      .lte('appointment_date', rangeEndStr),
    // Also fetch appointments that were moved OUTSIDE the window — their
    // original_recurring_date still falls in range, so they must block regen.
    supabase
      .from('ops_appointments')
      .select('appointment_date, original_recurring_date')
      .eq('recurring_template_id', templateId)
      .gte('original_recurring_date', rangeStartStr)
      .lte('original_recurring_date', rangeEndStr)
      .not('original_recurring_date', 'is', null),
    supabase
      .from('ops_appointments')
      .select('appointment_date, quoted_total')
      .eq('customer_id', template.customer_id)
      .is('recurring_template_id', null)
      .in('appointment_date', scheduledCandidateDates),
  ])

  if (rangeError || originalsError || customerExistingError) {
    result.errors.push(
      'Could not verify existing recurring visits. No new visits were generated.',
    )
    return result
  }
  const allTemplateRows = [
    ...(templateInRange || []),
    ...(templateByOriginal || []),
  ]

  const templateDateSet = new Set(
    allTemplateRows.map(
      (a: { appointment_date: string }) => a.appointment_date,
    ),
  )

  const originalRecurringDateSet = new Set(
    allTemplateRows
      .map(
        (a: { original_recurring_date: string | null }) =>
          a.original_recurring_date,
      )
      .filter((d): d is string => d !== null),
  )

  const quotedSubtotalPreCalc = (
    template.line_items as TemplateLineItem[]
  ).reduce(
    (sum: number, item: TemplateLineItem) =>
      sum + item.unit_price * item.quantity,
    0,
  )
  const discountPreCalc = Math.max(0, Number(template.discount_amount || 0))
  const expectedTotal = Math.max(0, quotedSubtotalPreCalc - discountPreCalc)

  const extraBlockedDates = new Set<string>()
  for (const appt of customerExisting || []) {
    if (Math.abs(Number(appt.quoted_total) - expectedTotal) < 1) {
      extraBlockedDates.add(appt.appointment_date)
    }
  }

  const { data: customer } = await supabase
    .from('ops_customers')
    .select('full_name, business_name, email, phone, billing_mode')
    .eq('id', template.customer_id)
    .single()

  const { data: address } = await supabase
    .from('ops_service_addresses')
    .select('street_1, street_2, city, state, zip_code')
    .eq('id', template.service_address_id)
    .single()

  if (!customer || !address) {
    result.errors.push('Customer or address not found')
    return result
  }

  const lineItems = template.line_items as TemplateLineItem[]
  const syncStatus = getQuickBooksSyncStatus()
  const usesMonthlyBilling =
    effectiveBillingMode(customer.billing_mode, template.invoice_mode) ===
    'monthly_consolidated'

  const quotedSubtotal = lineItems.reduce(
    (sum: number, item: TemplateLineItem) =>
      sum + item.unit_price * item.quantity,
    0,
  )

  // The template's explicit duration wins; without one, size the visit the
  // same way every other booking path does (dollar tiers on the subtotal).
  const scheduledMinutes =
    template.scheduled_duration_minutes > 0
      ? template.scheduled_duration_minutes
      : calculateAppointmentDurationFromTotal(quotedSubtotal)

  const bufferedMinutes = applyAppointmentBuffer(scheduledMinutes)
  const discountAmount = Math.max(0, Number(template.discount_amount || 0))
  const quotedTotal = Math.max(0, quotedSubtotal - discountAmount)

  // The customer's first-touch source, stamped on every generated visit so
  // recurring revenue stays visible in lead-source analytics (it used to be
  // generated with all attribution columns NULL).
  const inheritedLeadSource = template.customer_id
    ? await firstTouchForCustomer(supabase, template.customer_id)
    : null

  const flexible =
    template.scheduling_mode === 'flexible' && !template.is_subcontracted
  const resolvedVisits = new Map<string, RecurringScheduleOccurrence>()
  if (flexible) {
    if (!template.assigned_staff_user_id) {
      result.errors.push(
        'Choose a technician before generating flexible recurring visits.',
      )
      return result
    }
    const pending = candidates.filter(
      (candidate) =>
        !shouldSkipRecurringSlot({
          candidateDate: candidate.original_date,
          scheduledDate: candidate.date,
          rule: dateToRule.get(candidate.original_date)!,
          templateDates: templateDateSet,
          monthIsSingleInstance:
            (countDatesPerMonth.get(monthKeyFromYmd(candidate.original_date)) ||
              0) === 1,
          extraBlockedDates,
          originalRecurringDates: originalRecurringDateSet,
        }),
    )
    try {
      const plan = await planRecurringSchedule(supabase, {
        candidates: pending,
        staffUserId: template.assigned_staff_user_id,
        durationMinutes: bufferedMinutes,
        schedulingMode: 'flexible',
        visitOverrides: template.visit_overrides,
      })
      for (const occurrence of plan.occurrences)
        resolvedVisits.set(occurrence.original_date, occurrence)
    } catch (error) {
      result.errors.push(
        `Could not verify the live calendar: ${error instanceof Error ? error.message : String(error)}`,
      )
      return result
    }
  }

  for (const { date, startTime, scheduledDate: preferredDate } of uniqueDates) {
    const rule = dateToRule.get(date)
    if (!rule) {
      result.errors.push(`${date}: missing recurrence rule (internal)`)
      continue
    }
    let scheduledDate = preferredDate
    const candidate = candidates.find(
      (candidate) => candidate.original_date === date,
    )!
    const monthIsSingleInstance =
      (countDatesPerMonth.get(monthKeyFromYmd(date)) || 0) === 1
    if (
      shouldSkipRecurringSlot({
        candidateDate: date,
        scheduledDate,
        rule,
        templateDates: templateDateSet,
        monthIsSingleInstance,
        extraBlockedDates,
        originalRecurringDates: originalRecurringDateSet,
      })
    ) {
      result.skipped++
      continue
    }

    if (
      (candidate.earliest_date && scheduledDate < candidate.earliest_date) ||
      (candidate.latest_date && scheduledDate > candidate.latest_date)
    ) {
      result.errors.push(
        `${date}: no weekday is available within this calendar month and the plan dates.`,
      )
      continue
    }

    try {
      let normalizedStart = `${startTime}:00`.slice(0, 8)
      let endTime = addMinutesToTimeWithinDay(startTime, bufferedMinutes)

      // Recurring generation used to write straight onto the calendar with
      // no conflict check, which is how overlapping evening jobs got booked.
      // Subcontracted visits occupy no truck, so they neither take nor yield
      // a slot — checking them would block our own crew for someone else's job.
      if (flexible) {
        const resolved = resolvedVisits.get(date)
        if (!resolved || resolved.status !== 'clear') {
          result.errors.push(
            `${date}: ${resolved?.reason || 'No available window was found before the next visit.'}`,
          )
          continue
        }
        // The reviewed/resolved choice is pinned during this fresh check; never move it silently.
        const fresh = await planRecurringSchedule(supabase, {
          candidates: [
            candidates.find((candidate) => candidate.original_date === date)!,
          ],
          staffUserId: template.assigned_staff_user_id!,
          durationMinutes: bufferedMinutes,
          schedulingMode: 'flexible',
          visitOverrides: {
            [date]: { date: resolved.date, start_time: resolved.start_time },
          },
        })
        if (fresh.occurrences[0]?.status !== 'clear') {
          result.errors.push(
            `${date}: the selected visit is no longer available. Preview the plan again.`,
          )
          continue
        }
        scheduledDate = resolved.date
        normalizedStart = resolved.start_time
        endTime = resolved.end_time
      } else if (!template.is_subcontracted) {
        const movedOffWeekend = scheduledDate !== date
        let conflict: Awaited<ReturnType<typeof findAppointmentConflict>> = null
        let attempts = 0
        while (attempts < (movedOffWeekend ? 15 : 1)) {
          conflict = await findAppointmentConflict(supabase, {
            date: scheduledDate,
            startTime: normalizedStart,
            endTime,
            staffUserId: template.assigned_staff_user_id || undefined,
            staffAuthUserId: assignedStaffAuthUserId,
          })
          if (!conflict) break
          attempts += 1
          if (movedOffWeekend && attempts < 15) {
            const nextDate = nextWeekdayOnOrAfter(
              addCalendarDays(scheduledDate, 1),
            )
            if (candidate.latest_date && nextDate > candidate.latest_date) break
            scheduledDate = nextDate
          }
        }
        if (conflict) {
          result.errors.push(
            `${date}: skipped — no open weekday was found without overlapping an existing appointment (${String(conflict.start_time).slice(0, 5)}–${String(conflict.end_time).slice(0, 5)}). Resolve the conflict and regenerate.`,
          )
          continue
        }
      }

      const { data: appointment, error: apptErr } = await supabase
        .from('ops_appointments')
        .insert({
          customer_id: template.customer_id,
          service_address_id: template.service_address_id,
          recurring_template_id: templateId,
          booking_channel: template.booking_channel || 'recurring',
          source: 'recurring_generation',
          ...(inheritedLeadSource ?? {}),
          status: 'booked',
          payment_status: 'unpaid',
          quickbooks_sync_status: usesMonthlyBilling ? 'held' : syncStatus,
          appointment_date: scheduledDate,
          original_recurring_date: date,
          start_time: normalizedStart,
          end_time: endTime,
          assigned_staff_user_id: template.assigned_staff_user_id || null,
          quoted_total: Number(quotedTotal.toFixed(2)),
          internal_notes: template.internal_notes,
          is_subcontracted: template.is_subcontracted === true,
          subcontractor_name: template.is_subcontracted
            ? template.subcontractor_name || null
            : null,
        })
        .select('id')
        .single()

      if (apptErr || !appointment) {
        result.errors.push(`${date}: ${apptErr?.message || 'insert failed'}`)
        continue
      }

      const apptLinePayload = lineItems.map((item, sortOrder) => ({
        sort_order: sortOrder,
        pricing_unit_snapshot: item.pricing_unit_snapshot || null,
        length_value: item.length_value ?? null,
        width_value: item.width_value ?? null,
        area_segments: item.area_segments ?? null,
        appointment_id: appointment.id,
        service_catalog_item_id: item.service_catalog_item_id || null,
        name_snapshot: item.name_snapshot,
        quantity: item.quantity,
        unit_price: item.unit_price,
        duration_minutes: item.duration_minutes,
        buffer_minutes: item.buffer_minutes || 0,
        line_total: Number((item.unit_price * item.quantity).toFixed(2)),
        notes: item.notes || null,
      }))

      const { data: apptLines, error: lineErr } = await supabase
        .from('ops_appointment_line_items')
        .insert(apptLinePayload)
        .select()

      if (lineErr) {
        result.errors.push(`${date} lines: ${lineErr.message}`)
      }

      if (!usesMonthlyBilling) {
        const { data: invoice, error: invErr } = await supabase
          .from('ops_invoices')
          .insert({
            appointment_id: appointment.id,
            status: 'draft',
            payment_status: 'unpaid',
            subtotal: Number(quotedSubtotal.toFixed(2)),
            discount_amount: Number(discountAmount.toFixed(2)),
            total: Number(quotedTotal.toFixed(2)),
            sync_status: syncStatus,
          })
          .select('id')
          .single()

        if (invErr || !invoice) {
          result.errors.push(`${date} invoice: ${invErr?.message || 'failed'}`)
        } else {
          const invLinePayload = sortLineItems(apptLines || []).map(
            (item, sortOrder) => ({
              sort_order: sortOrder,
              invoice_id: invoice.id,
              appointment_line_item_id: item.id,
              description: item.name_snapshot,
              quantity: item.quantity,
              unit_price: item.unit_price,
              line_total: item.line_total,
            }),
          )

          if (invLinePayload.length > 0) {
            await supabase.from('ops_invoice_line_items').insert(invLinePayload)
          }

          // Only queue the customer for QB. The invoice stays local until the
          // job is actually completed — same deferred-sync rule used by every
          // other booking path; prevents QB from holding stale quote amounts.
          await ensureCustomerQuickBooksSyncJob(
            supabase,
            template.customer_id,
            buildQuickBooksCustomerPayload({
              customerId: template.customer_id,
              fullName: customer.full_name,
              businessName: customer.business_name,
              email: customer.email,
              phone: customer.phone,
              address: {
                street_1: address.street_1,
                city: address.city,
                state: address.state,
                zip_code: address.zip_code,
              },
            }),
          )
        }
      }

      await supabase.from('ops_appointment_status_events').insert({
        appointment_id: appointment.id,
        from_status: null,
        to_status: 'booked',
        changed_by: null,
        notes: `Auto-generated from recurring template: ${template.label}`,
      })

      result.created++
      templateDateSet.add(date)
      templateDateSet.add(scheduledDate)
      originalRecurringDateSet.add(date)
    } catch (err) {
      result.errors.push(
        `${date}: ${err instanceof Error ? err.message : 'unknown error'}`,
      )
    }
  }

  return result
}

/**
 * Generate appointments for ALL active templates.
 */
export async function generateAllRecurring(
  supabase: SupabaseClient,
  horizonMonths: number = 12,
): Promise<GenerationResult[]> {
  const { data: templates } = await supabase
    .from('ops_recurring_templates')
    .select('id')
    .eq('is_active', true)

  if (!templates || templates.length === 0) return []

  const results: GenerationResult[] = []
  for (const tpl of templates) {
    const r = await generateRecurringAppointments(
      supabase,
      tpl.id,
      horizonMonths,
    )
    results.push(r)
  }
  return results
}

// ─── Batch invoice ──────────────────────────────────────────────────────

export type BatchInvoiceResult = {
  batchInvoiceId: string
  appointmentCount: number
  subtotal: number
  total: number
  quickbooksInvoiceId: string
}

/**
 * Generate a consolidated monthly invoice for a batch_monthly template.
 * Rolls up all completed appointments for the given month.
 */
export async function generateBatchInvoice(
  supabase: SupabaseClient,
  templateId: string,
  month: string, // YYYY-MM-01 format
): Promise<BatchInvoiceResult | { error: string }> {
  const { data: template } = await supabase
    .from('ops_recurring_templates')
    .select('*, ops_customers(full_name, email, phone, billing_mode)')
    .eq('id', templateId)
    .single()

  if (!template) return { error: 'Template not found' }
  if (template.invoice_mode !== 'batch_monthly') {
    return { error: 'Template is not set to batch monthly invoicing' }
  }
  const templateCustomer = Array.isArray(template.ops_customers)
    ? template.ops_customers[0]
    : template.ops_customers
  if (templateCustomer?.billing_mode === 'monthly_consolidated') {
    return {
      error:
        'Use Month-End Billing so every completed job and restoration project is reviewed together.',
    }
  }

  const monthStart = month.slice(0, 7) + '-01'
  const monthEnd = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  )
  const monthEndStr = formatDate(monthEnd)

  const { data: existingBatch } = await supabase
    .from('ops_batch_invoices')
    .select('id')
    .eq('customer_id', template.customer_id)
    .eq('month', monthStart)
    .maybeSingle()

  if (existingBatch) {
    return { error: 'A batch invoice already exists for this month' }
  }

  const { data: appointments } = await supabase
    .from('ops_appointments')
    .select(
      `
      id, appointment_date, quoted_total,
      ops_appointment_line_items (
        id, sort_order, created_at, name_snapshot, quantity, unit_price, line_total, service_catalog_item_id
      )
    `,
    )
    .eq('recurring_template_id', templateId)
    .eq('status', 'completed')
    .gte('appointment_date', monthStart)
    .lte('appointment_date', monthEndStr)

  if (!appointments || appointments.length === 0) {
    return { error: 'No completed appointments found for this month' }
  }

  let subtotal = 0
  const entries: {
    appointmentId: string
    appointmentDate: string
    lineItemsSnapshot: unknown[]
    apptSubtotal: number
  }[] = []

  // Keep appointments in chronological order so the invoice lists dates top-to-bottom
  const sortedAppts = [...appointments].sort((a, b) =>
    String(a.appointment_date).localeCompare(String(b.appointment_date)),
  )

  for (const appt of sortedAppts) {
    const lines = sortLineItems(
      Array.isArray(appt.ops_appointment_line_items)
        ? appt.ops_appointment_line_items
        : [],
    )
    const apptSubtotal = lines.reduce(
      (s: number, l: { line_total: number }) => s + Number(l.line_total),
      0,
    )
    subtotal += apptSubtotal
    entries.push({
      appointmentId: appt.id,
      appointmentDate: appt.appointment_date,
      lineItemsSnapshot: lines,
      apptSubtotal,
    })
  }

  const total = Math.max(0, subtotal)
  const { data: batchInvoice, error: biErr } = await supabase
    .from('ops_batch_invoices')
    .insert({
      template_id: templateId,
      customer_id: template.customer_id,
      month: monthStart,
      status: 'ready',
      subtotal: Number(subtotal.toFixed(2)),
      total: Number(total.toFixed(2)),
      sync_status: 'pending',
    })
    .select('id')
    .single()

  if (biErr || !batchInvoice) {
    return { error: biErr?.message || 'Failed to create batch invoice' }
  }

  const entryPayload = entries.map((e) => ({
    batch_invoice_id: batchInvoice.id,
    entry_type: 'appointment',
    appointment_id: e.appointmentId,
    service_date: e.appointmentDate,
    line_items_snapshot: e.lineItemsSnapshot,
    subtotal: Number(e.apptSubtotal.toFixed(2)),
  }))

  const { error: entryErr } = await supabase
    .from('ops_batch_invoice_entries')
    .insert(entryPayload)

  if (entryErr) {
    await supabase.from('ops_batch_invoices').delete().eq('id', batchInvoice.id)
    return {
      error: entryErr.message || 'Failed to create batch invoice entries',
    }
  }

  let quickbooksInvoiceId: string
  try {
    quickbooksInvoiceId = await syncBatchInvoiceToQuickBooks(batchInvoice.id)
  } catch (syncErr) {
    await supabase
      .from('ops_batch_invoices')
      .update({
        sync_status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchInvoice.id)

    return {
      error:
        syncErr instanceof Error
          ? syncErr.message
          : 'Failed to send invoice to QuickBooks',
    }
  }

  return {
    batchInvoiceId: batchInvoice.id,
    appointmentCount: appointments.length,
    subtotal: Number(subtotal.toFixed(2)),
    total: Number(total.toFixed(2)),
    quickbooksInvoiceId,
  }
}
