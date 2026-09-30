import type { CSSProperties } from 'react'
import { appointmentDisplayRevenue } from '@/lib/ops/utilization-metrics'
import type {
  Appointment,
  AvailabilityTemplate,
  BusinessHoursRow,
  CalendarEvent,
  RecurringFrequencyInfo,
  ScheduleView,
} from './operations-schedule-types'

export const STANDARD_START_HOUR = 9
export const EARLY_START_HOUR = 7
export const END_HOUR = 24
export const HOUR_HEIGHT = 84
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const STAFF_LANE_COLORS = [
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#dc2626',
]
export const DEFAULT_SLOT_INTERVAL_MINUTES = 30
export const DEFAULT_BUSINESS_HOURS_ROWS: BusinessHoursRow[] = [
  { day_of_week: 0, is_active: false, start_time: '09:00', end_time: '18:00' },
  { day_of_week: 1, is_active: true, start_time: '09:00', end_time: '18:00' },
  { day_of_week: 2, is_active: true, start_time: '09:00', end_time: '18:00' },
  { day_of_week: 3, is_active: true, start_time: '09:00', end_time: '18:00' },
  { day_of_week: 4, is_active: true, start_time: '09:00', end_time: '18:00' },
  { day_of_week: 5, is_active: true, start_time: '09:00', end_time: '18:00' },
  { day_of_week: 6, is_active: true, start_time: '09:00', end_time: '18:00' },
]

export function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

/** Align with stats/utilization: invoice + line math first, then quote. */
export function calendarDisplayAmount(appointment: Appointment): string {
  const amount = appointmentDisplayRevenue({
    quoted_total: appointment.quoted_total,
    ops_invoices: appointment.ops_invoices,
    ops_appointment_line_items: appointment.ops_appointment_line_items,
  })
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

export function formatScheduleAmount(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

export function humanizeSourceLabel(
  value: string | null | undefined,
): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const labels: Record<string, string> = {
    admin: 'Admin',
    ai_agent: 'AI Agent',
    internal: 'Admin',
    lsa_sms: 'Google LSA',
    manual: 'Manual',
    owner: 'Owner',
    recurring: 'Recurring',
    recurring_generation: 'Recurring',
    retell_rabecca: 'Rabecca',
    sms_harry: 'Harry',
    website: 'Website',
  }
  return (
    labels[lower] ||
    raw
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
  )
}

export function getScheduleCardSources(appointment: Appointment): {
  leadLabel: string | null
  bookingLabel: string | null
} {
  const leadLabel = humanizeSourceLabel(appointment.lead_source)
  const bookingLabel =
    humanizeSourceLabel(appointment.booking_channel) ||
    humanizeSourceLabel(appointment.source)
  return { leadLabel, bookingLabel }
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseMinutes(timeValue: string | null | undefined): number {
  if (!timeValue) return STANDARD_START_HOUR * 60
  const [hours, minutes] = timeValue.slice(0, 5).split(':').map(Number)
  return hours * 60 + minutes
}

export function minutesToTimeLabel(totalMinutes: number): string {
  const safe = Math.max(0, totalMinutes)
  const hours = Math.floor(safe / 60) % 24
  const minutes = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Total minutes since midnight -> `HH:MM:00` for ops PATCH bodies. */
export function minutesToDbTime(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(totalMinutes, 24 * 60 - 1))
  const hours = Math.floor(safe / 60) % 24
  const minutes = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
}

export function startOfWeek(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  next.setDate(next.getDate() - next.getDay())
  return next
}

export function endOfWeek(date: Date): Date {
  const next = startOfWeek(date)
  next.setDate(next.getDate() + 6)
  return next
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function buildWeekDays(anchorDate: Date): Date[] {
  const weekStart = startOfWeek(anchorDate)
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
}

export function buildMonthGrid(anchorDate: Date): Date[] {
  const monthStart = startOfMonth(anchorDate)
  const gridStart = startOfWeek(monthStart)
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

export function getViewLabel(view: ScheduleView, anchorDate: Date): string {
  if (view === 'day') {
    return anchorDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }
  if (view === 'month') {
    return anchorDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  }
  const weekStart = startOfWeek(anchorDate)
  const weekEnd = endOfWeek(anchorDate)
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth()
  return sameMonth
    ? `${weekStart.toLocaleDateString('en-US', { month: 'long' })} ${String(
        weekStart.getDate(),
      ).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(
        2,
        '0',
      )}, ${weekStart.getFullYear()}`
    : `${weekStart.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })} - ${weekEnd.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`
}

export function getRangeForView(view: ScheduleView, anchorDate: Date) {
  if (view === 'month') {
    const monthGrid = buildMonthGrid(anchorDate)
    return {
      startDate: formatDateKey(monthGrid[0]),
      endDate: formatDateKey(monthGrid[monthGrid.length - 1]),
    }
  }
  return {
    startDate: formatDateKey(startOfWeek(anchorDate)),
    endDate: formatDateKey(endOfWeek(anchorDate)),
  }
}

export function getStatusTone(status: string): string {
  switch (status) {
    case 'pending_approval':
      return 'border-amber-400 bg-amber-100'
    case 'confirmed':
      return 'border-emerald-400 bg-emerald-100'
    case 'on_my_way':
      return 'border-lime-500 bg-lime-100 text-lime-950'
    case 'completed':
      return 'border-slate-400 bg-slate-200/95 text-slate-700'
    case 'cancelled':
      return 'border-slate-300 bg-slate-100 text-slate-500'
    default:
      return 'border-emerald-400 bg-emerald-100'
  }
}

export function getRecurringTone(
  info: RecurringFrequencyInfo | undefined,
): string | null {
  if (!info) return null
  const days = info.interval_days
  if (info.frequency === 'weekly' || (days && days <= 14)) {
    return 'border-violet-400 bg-violet-100'
  }
  if (info.frequency === 'biweekly' || (days && days <= 30)) {
    return 'border-sky-400 bg-sky-100'
  }
  if (info.frequency === 'monthly' || (days && days <= 60)) {
    return 'border-teal-400 bg-teal-100'
  }
  if (days && days <= 90) return 'border-orange-400 bg-orange-100'
  if (days && days <= 180) return 'border-rose-400 bg-rose-100'
  return 'border-fuchsia-400 bg-fuchsia-100'
}

export function getEventTone(event: CalendarEvent): string {
  return event.is_all_day
    ? 'border-amber-600 bg-amber-100 text-amber-900'
    : 'border-slate-400 bg-slate-200 text-slate-800'
}

export function getEstimateTone(appointment: Appointment): string {
  if (appointment.estimate_status === 'converted') {
    return 'border-violet-400 bg-violet-100 text-slate-700'
  }
  if (appointment.estimate_status === 'declined') {
    return 'border-slate-300 bg-slate-100 text-slate-500'
  }
  return 'border-amber-400 bg-amber-100 text-slate-800'
}

export function getRestorationTone(appointment: Appointment): string {
  return appointment.visit_type === 'mitigation'
    ? 'border-sky-500 bg-sky-100 text-slate-800'
    : 'border-sky-300 bg-sky-50 text-slate-700'
}

export function intersectsDay(event: CalendarEvent, dateKey: string): boolean {
  return event.start_date <= dateKey && event.end_date >= dateKey
}

export function getBlockPlacement(
  event: CalendarEvent,
  endMinutesOverride?: number | null,
  gridStartHour = STANDARD_START_HOUR,
) {
  const workdayStart = gridStartHour * 60
  const workdayEnd = END_HOUR * 60
  const startMinutes = event.is_all_day
    ? workdayStart
    : Math.max(parseMinutes(event.start_time), workdayStart)
  const rawEnd = event.is_all_day ? workdayEnd : parseMinutes(event.end_time)
  const endMinutes = Math.min(
    endMinutesOverride != null ? endMinutesOverride : rawEnd,
    workdayEnd,
  )
  const top = ((startMinutes - workdayStart) / 60) * HOUR_HEIGHT
  const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 42)
  return { top, height }
}

export function getAppointmentPlacement(
  appointment: Appointment,
  endMinutesOverride?: number | null,
  gridStartHour = STANDARD_START_HOUR,
) {
  const workdayStart = gridStartHour * 60
  const startMinutes = Math.max(
    parseMinutes(appointment.start_time),
    workdayStart,
  )
  const rawEnd =
    endMinutesOverride != null
      ? endMinutesOverride
      : parseMinutes(appointment.end_time)
  const endMinutes = Math.max(rawEnd, startMinutes + 15)
  const top = ((startMinutes - workdayStart) / 60) * HOUR_HEIGHT
  const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 56)
  return {
    top,
    height,
    startLabel: minutesToTimeLabel(startMinutes),
    endLabel: minutesToTimeLabel(endMinutes),
  }
}

export function appointmentHref(appointment: Appointment): string {
  if (appointment.kind === 'restoration') {
    return `/admin/operations/restoration/${appointment.restoration_project_id}?visit=${appointment.id}`
  }
  if (appointment.kind === 'estimate') {
    return `/admin/operations/estimates/${appointment.id}`
  }
  if (appointment.recurring_template_id) {
    return `/admin/operations/recurring/visit/${appointment.id}`
  }
  return `/admin/operations/appointments/${appointment.id}`
}

export function customerNameOf(appointment: Appointment): string {
  const customer = unwrapRelation(appointment.ops_customers)
  return customer?.business_name || customer?.full_name || 'Visit'
}

export function computeOverlapColumns(
  appointments: Appointment[],
): Map<string, { col: number; totalCols: number }> {
  const sorted = [...appointments].sort(
    (a, b) => parseMinutes(a.start_time) - parseMinutes(b.start_time),
  )
  const columns = new Map<string, number>()
  const columnEnds: number[] = []
  for (const appointment of sorted) {
    const start = parseMinutes(appointment.start_time)
    const end = Math.max(parseMinutes(appointment.end_time), start + 15)
    let assigned = columnEnds.findIndex((endMinute) => endMinute <= start)
    if (assigned === -1) {
      assigned = columnEnds.length
      columnEnds.push(end)
    } else {
      columnEnds[assigned] = end
    }
    columns.set(appointment.id, assigned)
  }
  const result = new Map<string, { col: number; totalCols: number }>()
  for (const appointment of sorted) {
    const start = parseMinutes(appointment.start_time)
    const end = Math.max(parseMinutes(appointment.end_time), start + 15)
    let maxColumn = columns.get(appointment.id) ?? 0
    for (const other of sorted) {
      if (other.id === appointment.id) continue
      const otherStart = parseMinutes(other.start_time)
      const otherEnd = Math.max(parseMinutes(other.end_time), otherStart + 15)
      if (otherStart < end && otherEnd > start) {
        maxColumn = Math.max(maxColumn, columns.get(other.id) ?? 0)
      }
    }
    result.set(appointment.id, {
      col: columns.get(appointment.id) ?? 0,
      totalCols: maxColumn + 1,
    })
  }
  return result
}

export function overlapStyle(
  column: number,
  totalColumns: number,
): CSSProperties {
  const widthPercent = 100 / totalColumns
  return {
    left: `calc(${column * widthPercent}% + 4px)`,
    width: `calc(${widthPercent}% - 8px)`,
    right: 'auto',
  }
}

export function templatesToBusinessRows(
  templates: AvailabilityTemplate[],
): BusinessHoursRow[] {
  const rowsByDay = new Map<number, BusinessHoursRow>()
  for (const row of DEFAULT_BUSINESS_HOURS_ROWS) {
    rowsByDay.set(row.day_of_week, { ...row })
  }
  const sorted = [...templates].sort(
    (a, b) => parseMinutes(a.start_time) - parseMinutes(b.start_time),
  )
  for (const template of sorted) {
    if (template.is_active === false || !rowsByDay.has(template.day_of_week)) {
      continue
    }
    rowsByDay.set(template.day_of_week, {
      day_of_week: template.day_of_week,
      is_active: true,
      start_time: template.start_time.slice(0, 5),
      end_time: template.end_time.slice(0, 5),
    })
  }
  return DEFAULT_BUSINESS_HOURS_ROWS.map(
    (defaultRow) => rowsByDay.get(defaultRow.day_of_week) || defaultRow,
  )
}

export function businessRowsToTemplates(
  rows: BusinessHoursRow[],
): AvailabilityTemplate[] {
  return rows
    .filter((row) => row.is_active)
    .map((row) => ({
      day_of_week: row.day_of_week,
      start_time: row.start_time,
      end_time: row.end_time,
      slot_interval_minutes: DEFAULT_SLOT_INTERVAL_MINUTES,
      is_active: true,
    }))
}

export function getBusinessDayRanges(templates: AvailabilityTemplate[]) {
  const byDay = new Map<number, Array<{ start: number; end: number }>>()
  for (const template of templates) {
    if (template.is_active === false) continue
    const current = byDay.get(template.day_of_week) || []
    current.push({
      start: parseMinutes(template.start_time),
      end: parseMinutes(template.end_time),
    })
    byDay.set(template.day_of_week, current)
  }
  for (const [day, ranges] of byDay.entries()) {
    byDay.set(
      day,
      ranges.sort((a, b) => a.start - b.start),
    )
  }
  return byDay
}

export function getOffHourSegmentsForGrid(
  ranges: Array<{ start: number; end: number }>,
  gridStartHour: number,
): Array<{ start: number; end: number }> {
  const workdayStart = gridStartHour * 60
  const workdayEnd = END_HOUR * 60
  if (ranges.length === 0) return [{ start: workdayStart, end: workdayEnd }]
  const segments: Array<{ start: number; end: number }> = []
  let cursor = workdayStart
  for (const range of ranges) {
    const nextStart = Math.max(range.start, workdayStart)
    const nextEnd = Math.min(range.end, workdayEnd)
    if (nextStart > cursor) segments.push({ start: cursor, end: nextStart })
    cursor = Math.max(cursor, nextEnd)
  }
  if (cursor < workdayEnd) segments.push({ start: cursor, end: workdayEnd })
  return segments
}

export function formatPendingNotifyWhen(dateKey: string, time: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const date = new Date(year, month - 1, day, hours, minutes)
  if (!Number.isFinite(date.getTime())) return `${dateKey} ${time}`
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
