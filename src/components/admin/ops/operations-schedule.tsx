'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
  Ruler,
  ShieldBan,
  UserRoundCog,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getCalendarPopupPosition } from '@/lib/ops/calendar-popup-position'
import { appointmentDisplayRevenue } from '@/lib/ops/utilization-metrics'

type ScheduleView = 'week' | 'day' | 'month'

type StaffMember = {
  id: string
  user_id: string
  display_name: string
  role: string
  is_active: boolean
  default_open: boolean
  scheduling_priority: number
}

type DailyAvailability = {
  staff_user_id: string
  date: string
  is_open: boolean
}

type Appointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  quoted_total: number
  lead_source: string | null
  booking_channel: string | null
  source: string | null
  is_repeat_customer?: boolean
  assigned_staff_user_id?: string | null
  ops_customers:
    | {
        full_name: string
        business_name: string | null
        phone: string | null
      }
    | {
        full_name: string
        business_name: string | null
        phone: string | null
      }[]
    | null
  ops_service_addresses:
    | {
        street_1: string
        city: string
        state: string
        zip_code: string
      }
    | {
        street_1: string
        city: string
        state: string
        zip_code: string
      }[]
    | null
  recurring_template_id?: string | null
  kind?: 'service' | 'estimate' | null
  estimate_status?: string | null
  ops_appointment_line_items: Array<{
    id: string
    name_snapshot: string
    notes?: string | null
    quantity?: number | null
    duration_minutes?: number | null
    line_total?: number | null
  }>
  ops_invoices:
    | {
        id: string
        status: string
        total?: number
        payment_status?: string
        payment_method?: string | null
      }
    | {
        id: string
        status: string
        total?: number
        payment_status?: string
        payment_method?: string | null
      }[]
    | null
}

type CalendarEvent = {
  id: string
  title: string
  description: string | null
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
  assigned_staff_user_id?: string | null
}

type RecurringFrequencyInfo = {
  frequency: string
  interval_days: number | null
}

type ScheduleResponse = {
  appointments: Appointment[]
  events: CalendarEvent[]
  recurringFrequencyMap?: Record<string, RecurringFrequencyInfo>
  staff?: StaffMember[]
  dailyAvailability?: DailyAvailability[]
  currentUserId?: string
}

type AvailabilityTemplate = {
  id?: string
  day_of_week: number
  start_time: string
  end_time: string
  slot_interval_minutes: number
  is_active?: boolean
}

type BusinessHoursRow = {
  day_of_week: number
  is_active: boolean
  start_time: string
  end_time: string
}

// Grid runs 9am–7pm — work starts at 9, so the earlier rows were dead space.
const HOURS = Array.from({ length: 11 }, (_, index) => 9 + index)
const HOUR_HEIGHT = 84
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const STAFF_LANE_COLORS = [
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#dc2626',
]
const DEFAULT_SLOT_INTERVAL_MINUTES = 30
const DEFAULT_BUSINESS_HOURS_ROWS: BusinessHoursRow[] = [
  { day_of_week: 0, is_active: false, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 1, is_active: true, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 2, is_active: true, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 3, is_active: true, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 4, is_active: true, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 5, is_active: true, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 6, is_active: true, start_time: '09:00', end_time: '17:00' },
]

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

/** Per-line work descriptions (amber box) — same idea as recurring visit / invoice line items. */
function recurringLineItemDescriptionBoxes(
  appointment: Appointment,
  compact: boolean,
) {
  if (!appointment.recurring_template_id) return null
  const items = appointment.ops_appointment_line_items || []
  const withNotes = items.filter((i) => (i.notes || '').trim())
  if (withNotes.length === 0) return null
  return (
    <div className={compact ? 'mt-0.5 space-y-0.5' : 'mt-1.5 space-y-1'}>
      {withNotes.map((item, idx) => (
        <div
          key={item.id || String(idx)}
          className={
            compact
              ? 'line-clamp-2 rounded border border-amber-400/80 bg-amber-50 px-1.5 py-0.5 text-[9px] leading-tight text-amber-950'
              : 'rounded-md border border-amber-400/80 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-950'
          }
        >
          {(item.notes || '').trim()}
        </div>
      ))}
    </div>
  )
}

/** Align with stats/utilization: invoice + line math first, then quote. */
function calendarDisplayAmount(appointment: Appointment): string {
  const n = appointmentDisplayRevenue({
    quoted_total: appointment.quoted_total,
    ops_invoices: appointment.ops_invoices,
    ops_appointment_line_items: appointment.ops_appointment_line_items,
  })
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

// Payment methods recorded when a job is marked paid (see the tech payment
// route). Color-coded so the calendar can be scanned at a glance.
const PAYMENT_METHOD_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  venmo: { label: 'Venmo', className: 'bg-blue-100 text-blue-700' },
  check: { label: 'Check', className: 'bg-amber-100 text-amber-800' },
  cash: { label: 'Cash', className: 'bg-emerald-100 text-emerald-700' },
  card: { label: 'Card', className: 'bg-sky-100 text-sky-700' },
  square: { label: 'Square', className: 'bg-violet-100 text-violet-700' },
}

/**
 * A status chip for a completed job's invoice: the payment method when it's
 * been paid (Venmo/Check/…), or a red "Unpaid" tag when it hasn't. Returns
 * null when the job isn't completed or has no invoice yet.
 */
function paymentMethodChip(appointment: Appointment) {
  if (appointment.status !== 'completed') return null
  const invoice = unwrapRelation(appointment.ops_invoices)
  if (!invoice) return null
  const raw = invoice.payment_method?.trim().toLowerCase()
  const isPaid = invoice.payment_status?.trim().toLowerCase() === 'paid'

  if (!raw) {
    // Completed but nothing recorded as paid yet → flag it.
    if (isPaid) return null
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-700">
        Unpaid
      </span>
    )
  }

  const style = PAYMENT_METHOD_STYLES[raw] ?? {
    label: raw.replace(/\b\w/g, (c) => c.toUpperCase()),
    className: 'bg-slate-100 text-slate-700',
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  )
}

function humanizeSourceLabel(value: string | null | undefined): string | null {
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
    raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
  )
}

function getScheduleCardSources(appointment: Appointment): {
  leadLabel: string | null
  bookingLabel: string | null
} {
  const leadLabel = humanizeSourceLabel(appointment.lead_source)
  const bookingLabel =
    humanizeSourceLabel(appointment.booking_channel) ||
    humanizeSourceLabel(appointment.source)
  return { leadLabel, bookingLabel }
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseMinutes(timeValue: string | null | undefined): number {
  if (!timeValue) return HOURS[0] * 60
  const [hours, minutes] = timeValue.slice(0, 5).split(':').map(Number)
  return hours * 60 + minutes
}

function minutesToTimeLabel(totalMinutes: number): string {
  const safe = Math.max(0, totalMinutes)
  const hours = Math.floor(safe / 60) % 24
  const minutes = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Total minutes since midnight → `HH:MM:00` for ops PATCH bodies. */
function minutesToDbTime(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(totalMinutes, 24 * 60 - 1))
  const hours = Math.floor(safe / 60) % 24
  const minutes = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
}

function startOfWeek(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  next.setDate(next.getDate() - next.getDay())
  return next
}

function endOfWeek(date: Date): Date {
  const next = startOfWeek(date)
  next.setDate(next.getDate() + 6)
  return next
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function buildWeekDays(anchorDate: Date): Date[] {
  const weekStart = startOfWeek(anchorDate)
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
}

function buildMonthGrid(anchorDate: Date): Date[] {
  const monthStart = startOfMonth(anchorDate)
  const gridStart = startOfWeek(monthStart)

  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

function getViewLabel(view: ScheduleView, anchorDate: Date): string {
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

function getRangeForView(view: ScheduleView, anchorDate: Date) {
  if (view === 'day') {
    const dateKey = formatDateKey(anchorDate)
    return { startDate: dateKey, endDate: dateKey }
  }

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

function getStatusTone(status: string): string {
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

function getRecurringTone(
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
  if (days && days <= 90) {
    return 'border-orange-400 bg-orange-100'
  }
  if (days && days <= 180) {
    return 'border-rose-400 bg-rose-100'
  }
  return 'border-fuchsia-400 bg-fuchsia-100'
}

function getEventTone(event: CalendarEvent): string {
  return event.is_all_day
    ? 'border-amber-600 bg-amber-100 text-amber-900'
    : 'border-slate-400 bg-slate-200 text-slate-800'
}

// Estimates are measuring visits — tentative work that hasn't been priced yet.
// Render them in amber so they read as "hold-this-slot" and don't get confused
// with real service appointments.
function getEstimateTone(appointment: Appointment): string {
  if (appointment.estimate_status === 'converted') {
    return 'border-violet-400 bg-violet-100 text-slate-700'
  }
  if (appointment.estimate_status === 'declined') {
    return 'border-slate-300 bg-slate-100 text-slate-500'
  }
  return 'border-amber-400 bg-amber-100 text-slate-800'
}

function intersectsDay(event: CalendarEvent, dateKey: string): boolean {
  return event.start_date <= dateKey && event.end_date >= dateKey
}

function getBlockPlacement(
  event: CalendarEvent,
  endMinutesOverride?: number | null,
) {
  const workdayStart = HOURS[0] * 60
  const workdayEnd = (HOURS[HOURS.length - 1] + 1) * 60
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

function getAppointmentPlacement(
  appointment: Appointment,
  endMinutesOverride?: number | null,
) {
  const workdayStart = HOURS[0] * 60
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

/**
 * Assigns a horizontal column to each appointment so that overlapping
 * appointments sit side-by-side instead of stacking on top of each other.
 * Returns a Map<appointmentId, {col, totalCols}>.
 */
function computeOverlapColumns(
  appointments: Appointment[],
): Map<string, { col: number; totalCols: number }> {
  const sorted = [...appointments].sort(
    (a, b) => parseMinutes(a.start_time) - parseMinutes(b.start_time),
  )

  const cols = new Map<string, number>()
  const colEnds: number[] = [] // end minute of the last appointment placed in each column

  for (const appt of sorted) {
    const start = parseMinutes(appt.start_time)
    const end = Math.max(parseMinutes(appt.end_time), start + 15)

    // Find first column whose last appointment has already ended
    let assigned = colEnds.findIndex((endMin) => endMin <= start)
    if (assigned === -1) {
      assigned = colEnds.length
      colEnds.push(end)
    } else {
      colEnds[assigned] = end
    }
    cols.set(appt.id, assigned)
  }

  // For each appointment, totalCols = max col+1 among all appointments that
  // directly overlap with it (including itself).
  const result = new Map<string, { col: number; totalCols: number }>()
  for (const appt of sorted) {
    const start = parseMinutes(appt.start_time)
    const end = Math.max(parseMinutes(appt.end_time), start + 15)
    let maxCol = cols.get(appt.id) ?? 0
    for (const other of sorted) {
      if (other.id === appt.id) continue
      const otherStart = parseMinutes(other.start_time)
      const otherEnd = Math.max(parseMinutes(other.end_time), otherStart + 15)
      if (otherStart < end && otherEnd > start) {
        maxCol = Math.max(maxCol, cols.get(other.id) ?? 0)
      }
    }
    result.set(appt.id, { col: cols.get(appt.id) ?? 0, totalCols: maxCol + 1 })
  }

  return result
}

/** Returns inline left/width styles for a column-slotted appointment card. */
function overlapStyle(col: number, totalCols: number): React.CSSProperties {
  const widthPct = 100 / totalCols
  return {
    left: `calc(${col * widthPct}% + 4px)`,
    width: `calc(${widthPct}% - 8px)`,
    right: 'auto',
  }
}

function templatesToBusinessRows(
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
    if (template.is_active === false) continue
    if (!rowsByDay.has(template.day_of_week)) continue
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

function businessRowsToTemplates(
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

function getBusinessDayRanges(templates: AvailabilityTemplate[]) {
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

function getOffHourSegmentsForGrid(
  ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const workdayStart = HOURS[0] * 60
  const workdayEnd = (HOURS[HOURS.length - 1] + 1) * 60
  if (ranges.length === 0) {
    return [{ start: workdayStart, end: workdayEnd }]
  }

  const segments: Array<{ start: number; end: number }> = []
  let cursor = workdayStart

  for (const range of ranges) {
    const nextStart = Math.max(range.start, workdayStart)
    const nextEnd = Math.min(range.end, workdayEnd)
    if (nextStart > cursor) {
      segments.push({ start: cursor, end: nextStart })
    }
    cursor = Math.max(cursor, nextEnd)
  }

  if (cursor < workdayEnd) {
    segments.push({ start: cursor, end: workdayEnd })
  }

  return segments
}

export function OperationsSchedule() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [view, setView] = useState<ScheduleView>('week')
  const [anchorDate, setAnchorDate] = useState(() => {
    const dateParam = searchParams.get('date')
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const parsed = new Date(`${dateParam}T12:00:00`)
      if (!isNaN(parsed.getTime())) return parsed
    }
    return new Date()
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [businessHoursSaving, setBusinessHoursSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ScheduleResponse>({
    appointments: [],
    events: [],
  })
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [dailyAvailability, setDailyAvailability] = useState<
    DailyAvailability[]
  >([])
  const [staffFilter, setStaffFilter] = useState<string | null>(null)
  const [recurringFreqMap, setRecurringFreqMap] = useState<
    Record<string, RecurringFrequencyInfo>
  >({})
  const [availabilityTemplates, setAvailabilityTemplates] = useState<
    AvailabilityTemplate[]
  >([])
  const [businessHoursRows, setBusinessHoursRows] = useState<
    BusinessHoursRow[]
  >(() => DEFAULT_BUSINESS_HOURS_ROWS.map((row) => ({ ...row })))
  const [showBusinessHours, setShowBusinessHours] = useState(false)
  const [showBlockForm, setShowBlockForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [editEventForm, setEditEventForm] = useState({
    title: '',
    description: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    is_all_day: false,
  })
  const [editEventSaving, setEditEventSaving] = useState(false)

  // Honor ?action=block|hours coming in from the Operations Menu. When the
  // user picks "Block Time" or "Business Hours" from the menu, we route
  // here with the query param and auto-open the matching form, then strip
  // the param so the URL stays clean.
  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'block') {
      setShowBlockForm(true)

      setShowBusinessHours(false)
      router.replace('/admin/operations')
    } else if (action === 'hours') {
      setShowBusinessHours(true)

      setShowBlockForm(false)
      router.replace('/admin/operations')
    }
  }, [searchParams, router])

  // Drag-and-drop reschedule state
  const [draggingAppointment, setDraggingAppointment] =
    useState<Appointment | null>(null)
  const [dragPreview, setDragPreview] = useState<{
    dateKey: string
    snappedMinutes: number
    staffId?: string | null
  } | null>(null)
  const [pendingNotify, setPendingNotify] = useState<{
    appointmentId: string
    customerName: string
    x: number
    y: number
  } | null>(null)
  const [statusActionAppointmentId, setStatusActionAppointmentId] = useState<
    string | null
  >(null)
  const [pendingStatusAction, setPendingStatusAction] = useState<{
    appointment: Appointment
    customerName: string
    action: 'cancel' | 'restore'
    x: number
    y: number
  } | null>(null)
  const [cellMenu, setCellMenu] = useState<{
    dateKey: string
    hour: number
    x: number
    y: number
    staffId?: string | null
  } | null>(null)
  const draggingYOffsetRef = useRef<number>(0)
  const didDragRef = useRef<boolean>(false)
  // Mini month-calendar popover for picking a specific date from the
  // schedule top bar.
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [pickerMonth, setPickerMonth] = useState<Date>(() =>
    startOfMonth(new Date()),
  )

  // On mobile, week and month views are cramped — default to day view so the
  // calendar is usable. Users can still switch views on wider screens via the
  // Week/Day/Month toggle that only renders at sm+ breakpoints.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(max-width: 639px)').matches) {
      setView('day')
    }
  }, [])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 639px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const openDatePicker = () => {
    setPickerMonth(startOfMonth(anchorDate))
    setDatePickerOpen(true)
  }

  const closeDatePicker = () => {
    setDatePickerOpen(false)
  }

  // Close the date picker on Escape.
  useEffect(() => {
    if (!datePickerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDatePickerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [datePickerOpen])

  // Touch-swipe navigation (mobile)
  const touchStartXRef = useRef<number>(0)
  const touchStartYRef = useRef<number>(0)
  const touchCurrentXRef = useRef<number>(0)
  const calendarRef = useRef<HTMLDivElement>(null)
  const dayStripRef = useRef<HTMLDivElement>(null)

  // Current-time indicator — updates every minute so the line moves live.
  // We start at null and only fill in after mount on the client so the SSR
  // response (which runs in Vercel's UTC timezone) doesn't bake a bogus
  // UTC hour count into the hydrated state. That's what caused the red
  // line to be ~6 hours off on mobile until the next minute tick.
  const [nowMinutes, setNowMinutes] = useState<number | null>(null)
  const [todayKey, setTodayKey] = useState<string>('')

  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setNowMinutes(n.getHours() * 60 + n.getMinutes())
      setTodayKey(formatDateKey(n))
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const [blockForm, setBlockForm] = useState<{
    title: string
    description: string
    start_date: string
    end_date: string
    start_time: string
    end_time: string
    is_all_day: boolean
    assigned_staff_user_id: string | null
  }>({
    title: '',
    description: '',
    start_date: formatDateKey(new Date()),
    end_date: formatDateKey(new Date()),
    start_time: '',
    end_time: '',
    is_all_day: false,
    assigned_staff_user_id: null,
  })

  const loadSchedule = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { startDate, endDate } = getRangeForView(view, anchorDate)
      const [scheduleResponse, availabilityResponse] = await Promise.all([
        fetch(
          `/api/admin/ops/schedule?start_date=${startDate}&end_date=${endDate}`,
          {
            cache: 'no-store',
          },
        ),
        fetch('/api/admin/ops/availability', { cache: 'no-store' }),
      ])
      const scheduleResult = await scheduleResponse.json()
      const availabilityResult = await availabilityResponse.json()
      if (!scheduleResponse.ok) {
        throw new Error(
          scheduleResult.detail ||
            scheduleResult.error ||
            'Failed to load schedule',
        )
      }
      if (!availabilityResponse.ok) {
        throw new Error(
          availabilityResult.error || 'Failed to load business hours',
        )
      }
      setData({
        appointments: scheduleResult.appointments || [],
        events: scheduleResult.events || [],
      })
      setStaffList(scheduleResult.staff || [])
      if (scheduleResult.currentUserId)
        setCurrentUserId(scheduleResult.currentUserId)
      setDailyAvailability(scheduleResult.dailyAvailability || [])
      setRecurringFreqMap(scheduleResult.recurringFrequencyMap || {})
      const templates = (availabilityResult.templates ||
        []) as AvailabilityTemplate[]
      const effectiveTemplates =
        templates.length > 0
          ? templates
          : businessRowsToTemplates(DEFAULT_BUSINESS_HOURS_ROWS)
      setAvailabilityTemplates(effectiveTemplates)
      setBusinessHoursRows(templatesToBusinessRows(effectiveTemplates))
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load schedule',
      )
    } finally {
      setLoading(false)
    }
  }, [anchorDate, view])

  useEffect(() => {
    void loadSchedule()
  }, [loadSchedule])

  // Default to day view on mobile
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setView('day')
    }
  }, [])

  // Keep the day strip scrolled so the selected day is always centred
  useEffect(() => {
    const strip = dayStripRef.current
    if (!strip) return
    const active = strip.querySelector(
      '[data-strip-active="true"]',
    ) as HTMLElement | null
    if (!active) return
    strip.scrollTo({
      left: active.offsetLeft - strip.offsetWidth / 2 + active.offsetWidth / 2,
      behavior: 'smooth',
    })
  }, [anchorDate])

  const displayedDays = useMemo(() => {
    if (view === 'day') return [anchorDate]
    if (view === 'week') return buildWeekDays(anchorDate)
    return []
  }, [anchorDate, view])

  const isStaffOpenForDate = useCallback(
    (staffId: string, dateKey: string): boolean => {
      const override = dailyAvailability.find(
        (da) => da.staff_user_id === staffId && da.date === dateKey,
      )
      if (override) return override.is_open
      const staff = staffList.find((s) => s.id === staffId)
      return staff?.default_open ?? true
    },
    [dailyAvailability, staffList],
  )

  const toggleStaffAvailability = useCallback(
    async (staffId: string, dateKey: string) => {
      const currentlyOpen = isStaffOpenForDate(staffId, dateKey)
      const newIsOpen = !currentlyOpen
      setDailyAvailability((prev) => {
        const filtered = prev.filter(
          (da) => !(da.staff_user_id === staffId && da.date === dateKey),
        )
        return [
          ...filtered,
          { staff_user_id: staffId, date: dateKey, is_open: newIsOpen },
        ]
      })
      try {
        await fetch('/api/admin/ops/staff-availability', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            staff_user_id: staffId,
            date: dateKey,
            is_open: newIsOpen,
          }),
        })
      } catch {
        setDailyAvailability((prev) => {
          const filtered = prev.filter(
            (da) => !(da.staff_user_id === staffId && da.date === dateKey),
          )
          return [
            ...filtered,
            { staff_user_id: staffId, date: dateKey, is_open: currentlyOpen },
          ]
        })
      }
    },
    [isStaffOpenForDate],
  )

  const appointmentsByDate = useMemo(() => {
    const grouped = new Map<string, Appointment[]>()
    for (const appointment of data.appointments) {
      const current = grouped.get(appointment.appointment_date) || []
      current.push(appointment)
      grouped.set(appointment.appointment_date, current)
    }
    return grouped
  }, [data.appointments])

  const monthGrid = useMemo(() => buildMonthGrid(anchorDate), [anchorDate])
  const viewLabel = getViewLabel(view, anchorDate)
  const businessDayRanges = useMemo(
    () => getBusinessDayRanges(availabilityTemplates),
    [availabilityTemplates],
  )

  const weeklyTotal = useMemo(() => {
    if (view !== 'week') return 0
    const weekAppointments = displayedDays.flatMap((day) => {
      const dateKey = formatDateKey(day)
      return appointmentsByDate.get(dateKey) || []
    })
    return weekAppointments.reduce(
      (sum, appt) => sum + appointmentDisplayRevenue(appt),
      0,
    )
  }, [view, displayedDays, appointmentsByDate])

  const saveBusinessHours = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusinessHoursSaving(true)
    setError(null)
    try {
      const templates = businessRowsToTemplates(businessHoursRows)
      const response = await fetch('/api/admin/ops/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save business hours')
      }
      const nextTemplates = (result.templates || []) as AvailabilityTemplate[]
      setAvailabilityTemplates(nextTemplates)
      setBusinessHoursRows(templatesToBusinessRows(nextTemplates))
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save business hours',
      )
    } finally {
      setBusinessHoursSaving(false)
    }
  }

  const moveRange = (direction: 'prev' | 'next') => {
    const multiplier = direction === 'prev' ? -1 : 1
    if (view === 'day') {
      setAnchorDate((current) => addDays(current, multiplier))
      return
    }
    if (view === 'week') {
      setAnchorDate((current) => addDays(current, multiplier * 7))
      return
    }
    setAnchorDate((current) => addMonths(current, multiplier))
  }

  const handleCalTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX
    touchStartYRef.current = e.touches[0].clientY
    touchCurrentXRef.current = e.touches[0].clientX
    const el = calendarRef.current
    if (el) el.style.transition = 'none'
  }, [])

  const handleCalTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartXRef.current
    const dy = e.touches[0].clientY - touchStartYRef.current
    if (Math.abs(dy) > Math.abs(dx) + 8) return
    touchCurrentXRef.current = e.touches[0].clientX
    const el = calendarRef.current
    if (el) el.style.transform = `translateX(${dx * 0.6}px)`
  }, [])

  const handleCalTouchEnd = useCallback(() => {
    const delta = touchCurrentXRef.current - touchStartXRef.current
    const el = calendarRef.current

    if (Math.abs(delta) < 50) {
      // Snap back
      if (el) {
        el.style.transition = 'transform 200ms ease-out'
        el.style.transform = 'translateX(0)'
      }
      return
    }

    const direction = delta < 0 ? 'next' : 'prev'
    const exitX =
      delta < 0 ? -window.innerWidth * 1.05 : window.innerWidth * 1.05

    if (el) {
      // Slide fully off screen
      el.style.transition = 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)'
      el.style.transform = `translateX(${exitX}px)`

      setTimeout(() => {
        // Instantly move to entrance side, update content, then slide in
        const entranceX =
          direction === 'next'
            ? window.innerWidth * 0.4
            : -window.innerWidth * 0.4
        el.style.transition = 'none'
        el.style.transform = `translateX(${entranceX}px)`
        moveRange(direction)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)'
            el.style.transform = 'translateX(0)'
          })
        })
      }, 220)
    } else {
      moveRange(direction)
    }
  }, [moveRange])

  const openNewJobAt = (dateKey: string, hour: number) => {
    const hh = String(hour).padStart(2, '0')
    router.push(`/admin/operations/new-job?date=${dateKey}&time=${hh}:00`)
  }

  const openNewEstimateAt = (dateKey: string, hour: number) => {
    const hh = String(hour).padStart(2, '0')
    router.push(`/admin/operations/estimates/new?date=${dateKey}&time=${hh}:00`)
  }

  const openBlockAt = (
    dateKey: string,
    hour: number,
    staffId?: string | null,
  ) => {
    const hh = String(hour).padStart(2, '0')
    const nextHh = String(Math.min(hour + 1, 23)).padStart(2, '0')
    setBlockForm({
      title: '',
      description: '',
      start_date: dateKey,
      end_date: dateKey,
      start_time: `${hh}:00`,
      end_time: `${nextHh}:00`,
      is_all_day: false,
      assigned_staff_user_id: staffId ?? null,
    })
    setShowBusinessHours(false)
    setShowBlockForm(true)
  }

  const PX_PER_MINUTE = HOUR_HEIGHT / 60
  const GRID_START_MINUTES = HOURS[0] * 60

  const snapToMinutes = (rawMinutes: number): number => {
    const snapped = Math.round(rawMinutes / 15) * 15
    return Math.max(GRID_START_MINUTES, snapped)
  }

  const minutesToTimeString = (minutes: number): string => {
    const h = Math.floor(minutes / 60) % 24
    const m = minutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
  }

  type ResizeSession = {
    appointmentId: string
    originEndMinutes: number
    startMinutes: number
    grabClientY: number
  }
  const [resizeSession, setResizeSession] = useState<ResizeSession | null>(null)
  const [resizeLiveEndMinutes, setResizeLiveEndMinutes] = useState<
    number | null
  >(null)
  const resizeLiveEndRef = useRef<number | null>(null)

  const resizePointerIdRef = useRef<number | null>(null)

  const beginResize = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, appointment: Appointment) => {
      // Ignore right-click / middle-click on mouse
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      setError(null)
      const startM = parseMinutes(appointment.start_time)
      const endM = parseMinutes(appointment.end_time)
      setResizeSession({
        appointmentId: appointment.id,
        originEndMinutes: endM,
        startMinutes: startM,
        grabClientY: e.clientY,
      })
      resizeLiveEndRef.current = endM
      setResizeLiveEndMinutes(endM)
      try {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        resizePointerIdRef.current = e.pointerId
      } catch {
        resizePointerIdRef.current = null
      }
    },
    [],
  )

  useEffect(() => {
    if (!resizeSession) return

    const onMove = (e: PointerEvent) => {
      if (
        resizePointerIdRef.current != null &&
        e.pointerId !== resizePointerIdRef.current
      )
        return
      // Block native touch scrolling while resizing.
      if (e.cancelable) e.preventDefault()
      const dy = e.clientY - resizeSession.grabClientY
      const delta = Math.round(dy / PX_PER_MINUTE / 15) * 15
      const next = Math.max(
        resizeSession.startMinutes + 15,
        resizeSession.originEndMinutes + delta,
      )
      resizeLiveEndRef.current = next
      setResizeLiveEndMinutes(next)
    }

    const onUp = (e: PointerEvent) => {
      if (
        resizePointerIdRef.current != null &&
        e.pointerId !== resizePointerIdRef.current
      )
        return
      const session = resizeSession
      const finalEnd = resizeLiveEndRef.current ?? session.originEndMinutes
      void (async () => {
        if (finalEnd !== session.originEndMinutes) {
          try {
            const response = await fetch(
              `/api/admin/ops/appointments/${session.appointmentId}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ end_time: minutesToDbTime(finalEnd) }),
              },
            )
            const result = await response.json()
            if (!response.ok) {
              setError(result.error || 'Failed to update end time')
            } else {
              await loadSchedule()
            }
          } catch {
            setError('Failed to update end time')
          }
        }
        setResizeSession(null)
        setResizeLiveEndMinutes(null)
        resizeLiveEndRef.current = null
        resizePointerIdRef.current = null
      })()
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [resizeSession, loadSchedule, PX_PER_MINUTE])

  // ---- Event block: move (pointer drag) ----
  const [draggingEvent, setDraggingEvent] = useState<CalendarEvent | null>(null)
  const [eventDragPreview, setEventDragPreview] = useState<{
    snappedMinutes: number
  } | null>(null)
  const eventMovePointerRef = useRef<{
    pointerId: number
    eventId: string
    originalDurationMinutes: number
    grabYOffsetWithinBlock: number
    startX: number
    startY: number
    active: boolean
  } | null>(null)
  const [eventPointerDragging, setEventPointerDragging] = useState(false)

  const handleEventMovePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    calEvent: CalendarEvent,
  ) => {
    if (calEvent.is_all_day) return
    const block = (e.currentTarget as HTMLElement).closest(
      '[data-event-block]',
    ) as HTMLElement | null
    const blockRect = block?.getBoundingClientRect()
    const grabOffset = blockRect ? e.clientY - blockRect.top : 0
    const startM = parseMinutes(calEvent.start_time ?? '00:00')
    const endM = parseMinutes(calEvent.end_time ?? '00:00')
    eventMovePointerRef.current = {
      pointerId: e.pointerId,
      eventId: calEvent.id,
      originalDurationMinutes: endM - startM,
      grabYOffsetWithinBlock: grabOffset,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    }
    didDragRef.current = false
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handleEventMovePointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    const session = eventMovePointerRef.current
    if (!session || session.pointerId !== e.pointerId) return
    if (!session.active) {
      const dx = e.clientX - session.startX
      const dy = e.clientY - session.startY
      if (Math.hypot(dx, dy) < 6) return
      session.active = true
      didDragRef.current = true
      setEventPointerDragging(true)
      const moved = data.events.find((ev) => ev.id === session.eventId)
      if (moved) setDraggingEvent(moved)
    }
    if (e.cancelable) e.preventDefault()
    const hit = hitTestDateColumn(e.clientX, e.clientY)
    if (!hit) {
      setEventDragPreview(null)
      return
    }
    const rawY = e.clientY - hit.rect.top - session.grabYOffsetWithinBlock
    const rawMinutes = GRID_START_MINUTES + rawY / PX_PER_MINUTE
    const snapped = snapToMinutes(rawMinutes)
    setEventDragPreview({ snappedMinutes: snapped })
  }

  const handleEventMovePointerUp = async (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    const session = eventMovePointerRef.current
    if (!session || session.pointerId !== e.pointerId) return
    try {
      ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    eventMovePointerRef.current = null
    setEventPointerDragging(false)
    if (!session.active) {
      setDraggingEvent(null)
      setEventDragPreview(null)
      didDragRef.current = false
      return
    }
    const hit = hitTestDateColumn(e.clientX, e.clientY)
    if (!hit) {
      setDraggingEvent(null)
      setEventDragPreview(null)
      return
    }
    const rawY = e.clientY - hit.rect.top - session.grabYOffsetWithinBlock
    const rawMinutes = GRID_START_MINUTES + rawY / PX_PER_MINUTE
    const snapped = snapToMinutes(rawMinutes)
    const newStartTime = minutesToDbTime(snapped)
    const newEndTime = minutesToDbTime(
      snapped + session.originalDurationMinutes,
    )
    setDraggingEvent(null)
    setEventDragPreview(null)
    try {
      const response = await fetch(`/api/admin/ops/events/${session.eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: hit.dateKey,
          end_date: hit.dateKey,
          start_time: newStartTime,
          end_time: newEndTime,
        }),
      })
      if (!response.ok) {
        const result = await response.json()
        setError(result.error || 'Failed to move block')
      } else {
        await loadSchedule()
      }
    } catch {
      setError('Failed to move block')
    }
  }

  // ---- Event block: resize ----
  type EventResizeSession = {
    eventId: string
    originEndMinutes: number
    startMinutes: number
    grabClientY: number
  }
  const [eventResizeSession, setEventResizeSession] =
    useState<EventResizeSession | null>(null)
  const [eventResizeLiveEndMinutes, setEventResizeLiveEndMinutes] = useState<
    number | null
  >(null)
  const eventResizeLiveEndRef = useRef<number | null>(null)
  const eventResizePointerIdRef = useRef<number | null>(null)

  const beginEventResize = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, calEvent: CalendarEvent) => {
      if (calEvent.is_all_day) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      setError(null)
      const startM = parseMinutes(calEvent.start_time ?? '00:00')
      const endM = parseMinutes(calEvent.end_time ?? '00:00')
      setEventResizeSession({
        eventId: calEvent.id,
        originEndMinutes: endM,
        startMinutes: startM,
        grabClientY: e.clientY,
      })
      eventResizeLiveEndRef.current = endM
      setEventResizeLiveEndMinutes(endM)
      try {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        eventResizePointerIdRef.current = e.pointerId
      } catch {
        eventResizePointerIdRef.current = null
      }
    },
    [],
  )

  useEffect(() => {
    if (!eventResizeSession) return
    const onMove = (e: PointerEvent) => {
      if (
        eventResizePointerIdRef.current != null &&
        e.pointerId !== eventResizePointerIdRef.current
      )
        return
      if (e.cancelable) e.preventDefault()
      const dy = e.clientY - eventResizeSession.grabClientY
      const delta = Math.round(dy / PX_PER_MINUTE / 15) * 15
      const next = Math.max(
        eventResizeSession.startMinutes + 15,
        eventResizeSession.originEndMinutes + delta,
      )
      eventResizeLiveEndRef.current = next
      setEventResizeLiveEndMinutes(next)
    }
    const onUp = (e: PointerEvent) => {
      if (
        eventResizePointerIdRef.current != null &&
        e.pointerId !== eventResizePointerIdRef.current
      )
        return
      const session = eventResizeSession
      const finalEnd = eventResizeLiveEndRef.current ?? session.originEndMinutes
      void (async () => {
        if (finalEnd !== session.originEndMinutes) {
          try {
            const response = await fetch(
              `/api/admin/ops/events/${session.eventId}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ end_time: minutesToDbTime(finalEnd) }),
              },
            )
            const result = await response.json()
            if (!response.ok) {
              setError(result.error || 'Failed to update block end time')
            } else {
              await loadSchedule()
            }
          } catch {
            setError('Failed to update block end time')
          }
        }
        setEventResizeSession(null)
        setEventResizeLiveEndMinutes(null)
        eventResizeLiveEndRef.current = null
        eventResizePointerIdRef.current = null
      })()
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [eventResizeSession, loadSchedule, PX_PER_MINUTE])

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    dateKey: string,
    staffId?: string | null,
  ) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const rawY = e.clientY - rect.top - draggingYOffsetRef.current
    const rawMinutes = GRID_START_MINUTES + rawY / PX_PER_MINUTE
    const snappedMinutes = snapToMinutes(rawMinutes)
    setDragPreview({ dateKey, snappedMinutes, staffId })
  }

  const commitAppointmentMove = async (
    appointmentId: string,
    dateKey: string,
    snappedMinutes: number,
    clientX: number,
    clientY: number,
    staffId?: string | null,
  ) => {
    const newTime = minutesToTimeString(snappedMinutes)

    setDragPreview(null)
    setDraggingAppointment(null)

    try {
      const response = await fetch(
        `/api/admin/ops/appointments/${appointmentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_date: dateKey,
            start_time: newTime,
            ...(staffId !== undefined
              ? { assigned_staff_user_id: staffId }
              : {}),
          }),
        },
      )
      if (!response.ok) {
        const result = await response.json()
        setError(result.error || 'Failed to reschedule job')
        return
      }
      await loadSchedule()

      // Find the appointment that was moved to show customer name in popup
      const moved = data.appointments.find((a) => a.id === appointmentId)
      if (moved) {
        const customer = unwrapRelation(moved.ops_customers)
        const customerName =
          customer?.business_name || customer?.full_name || 'Customer'
        setPendingNotify({
          appointmentId,
          customerName,
          x: clientX,
          y: clientY,
        })
      }
    } catch {
      setError('Failed to reschedule job')
    }
  }

  const handleDrop = async (
    e: React.DragEvent<HTMLDivElement>,
    dateKey: string,
    staffId?: string | null,
  ) => {
    e.preventDefault()
    const appointmentId = e.dataTransfer.getData('appointmentId')
    if (!appointmentId) return

    const rect = e.currentTarget.getBoundingClientRect()
    const rawY = e.clientY - rect.top - draggingYOffsetRef.current
    const rawMinutes = GRID_START_MINUTES + rawY / PX_PER_MINUTE
    const snappedMinutes = snapToMinutes(rawMinutes)
    await commitAppointmentMove(
      appointmentId,
      dateKey,
      snappedMinutes,
      e.clientX,
      e.clientY,
      staffId,
    )
  }

  // ---- Pointer-based move drag (works on mouse, touch, and pen) ----
  // HTML5 drag-and-drop does not fire from touch gestures on iOS/Android,
  // so we also run a parallel pointer-event pipeline that mirrors the
  // logic of onDragStart/onDragOver/onDrop, but with setPointerCapture so
  // the gesture is reliable on mobile.
  const movePointerRef = useRef<{
    pointerId: number
    appointmentId: string
    grabYOffsetWithinBlock: number
    startX: number
    startY: number
    active: boolean
  } | null>(null)
  const [pointerDragging, setPointerDragging] = useState(false)
  const [reassigningAppointmentId, setReassigningAppointmentId] = useState<
    string | null
  >(null)

  const hitTestDateColumn = (
    clientX: number,
    clientY: number,
  ): { dateKey: string; staffId: string | null; rect: DOMRect } | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    const col = el?.closest('[data-date-column]') as HTMLElement | null
    if (!col) return null
    const dateKey = col.getAttribute('data-date-column') || ''
    if (!dateKey) return null
    const staffId = col.getAttribute('data-staff-lane') || null
    return {
      dateKey,
      staffId: staffId || null,
      rect: col.getBoundingClientRect(),
    }
  }

  const handleMovePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    appointment: Appointment,
  ) => {
    // On desktop, HTML5 drag-and-drop is already wired up via `draggable`
    // and handles mouse drags natively. We only engage the pointer-based
    // pipeline for touch + pen so the two paths don't fight for the
    // same mouse gesture.
    if (e.pointerType === 'mouse') return
    const block = (e.currentTarget as HTMLElement).closest(
      '[data-appointment-block]',
    ) as HTMLElement | null
    const blockRect = block?.getBoundingClientRect()
    const grabOffset = blockRect ? e.clientY - blockRect.top : 0

    movePointerRef.current = {
      pointerId: e.pointerId,
      appointmentId: appointment.id,
      grabYOffsetWithinBlock: grabOffset,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    }
    draggingYOffsetRef.current = grabOffset
    didDragRef.current = false

    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handleMovePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = movePointerRef.current
    if (!session || session.pointerId !== e.pointerId) return

    // Start real drag only after a small movement threshold so a tap
    // doesn't count as a drag.
    if (!session.active) {
      const dx = e.clientX - session.startX
      const dy = e.clientY - session.startY
      if (Math.hypot(dx, dy) < 6) return
      session.active = true
      didDragRef.current = true
      setPointerDragging(true)
      // Find the appointment and show the ghost
      const moved = data.appointments.find(
        (a) => a.id === session.appointmentId,
      )
      if (moved) setDraggingAppointment(moved)
    }

    // Block native touch scrolling while we're dragging.
    if (e.cancelable) e.preventDefault()

    const hit = hitTestDateColumn(e.clientX, e.clientY)
    if (!hit) {
      setDragPreview(null)
      return
    }
    const rawY = e.clientY - hit.rect.top - session.grabYOffsetWithinBlock
    const rawMinutes = GRID_START_MINUTES + rawY / PX_PER_MINUTE
    const snapped = snapToMinutes(rawMinutes)
    setDragPreview({
      dateKey: hit.dateKey,
      snappedMinutes: snapped,
      staffId: hit.staffId,
    })
  }

  const handleMovePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const session = movePointerRef.current
    if (!session || session.pointerId !== e.pointerId) return

    try {
      ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    movePointerRef.current = null
    setPointerDragging(false)

    if (!session.active) {
      // Treat as a tap — reset drag state without committing.
      setDraggingAppointment(null)
      setDragPreview(null)
      // Keep didDragRef false so any downstream click still works
      // (the Move handle itself doesn't navigate anywhere).
      didDragRef.current = false
      return
    }

    const hit = hitTestDateColumn(e.clientX, e.clientY)
    if (!hit) {
      setDraggingAppointment(null)
      setDragPreview(null)
      return
    }
    const rawY = e.clientY - hit.rect.top - session.grabYOffsetWithinBlock
    const rawMinutes = GRID_START_MINUTES + rawY / PX_PER_MINUTE
    const snapped = snapToMinutes(rawMinutes)

    await commitAppointmentMove(
      session.appointmentId,
      hit.dateKey,
      snapped,
      e.clientX,
      e.clientY,
      hit.staffId,
    )
  }

  const handleMobileStaffReassignment = async (
    appointment: Appointment,
    staff: StaffMember,
  ) => {
    setError(null)
    setReassigningAppointmentId(appointment.id)
    try {
      const response = await fetch(
        `/api/admin/ops/appointments/${appointment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_staff_user_id: staff.id }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        setError(result.error || 'Failed to reassign job')
        return
      }

      setStaffFilter(staff.id)
      await loadSchedule()
    } catch {
      setError('Failed to reassign job')
    } finally {
      setReassigningAppointmentId(null)
    }
  }

  const sendRescheduleNotification = async (appointmentId: string) => {
    try {
      await fetch(`/api/admin/ops/appointments/${appointmentId}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'job_rescheduled' }),
      })
    } catch {
      // Best-effort — don't block UI if notification fails
    }
    setPendingNotify(null)
  }

  const handleAppointmentStatusAction = async (
    appointment: Appointment,
    nextStatus: 'booked' | 'cancelled',
    options: { notifyCustomer?: boolean } = {},
  ) => {
    const actionLabel = nextStatus === 'cancelled' ? 'cancel' : 'restore'
    setPendingStatusAction(null)
    setStatusActionAppointmentId(appointment.id)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/ops/appointments/${appointment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: nextStatus,
            ...(options.notifyCustomer ? { notify_customer: true } : {}),
          }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || `Failed to ${actionLabel} job`)
      }
      await loadSchedule()
      router.refresh()
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : `Failed to ${actionLabel} job`,
      )
    } finally {
      setStatusActionAppointmentId(null)
    }
  }

  const openStatusActionPopover = (
    event: React.MouseEvent<HTMLButtonElement>,
    appointment: Appointment,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const customer = unwrapRelation(appointment.ops_customers)
    const rect = event.currentTarget.getBoundingClientRect()
    setPendingNotify(null)
    setPendingStatusAction({
      appointment,
      customerName:
        customer?.business_name || customer?.full_name || 'this customer',
      action: appointment.status === 'cancelled' ? 'restore' : 'cancel',
      x: rect.left,
      y: rect.bottom + 8,
    })
  }

  const handleBlockSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blockForm),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to block time')
      }
      setBlockForm({
        title: '',
        description: '',
        start_date: formatDateKey(anchorDate),
        end_date: formatDateKey(anchorDate),
        start_time: '',
        end_time: '',
        is_all_day: false,
        assigned_staff_user_id: null,
      })
      setShowBlockForm(false)
      await loadSchedule()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Failed to block time',
      )
    } finally {
      setSaving(false)
    }
  }

  const openEditEvent = (calEvent: CalendarEvent) => {
    setEditingEvent(calEvent)
    setEditEventForm({
      title: calEvent.title,
      description: calEvent.description ?? '',
      start_date: calEvent.start_date,
      end_date: calEvent.end_date,
      start_time: calEvent.start_time ?? '',
      end_time: calEvent.end_time ?? '',
      is_all_day: calEvent.is_all_day,
    })
    setShowBlockForm(false)
  }

  const handleUpdateEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingEvent) return
    setEditEventSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/events/${editingEvent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editEventForm),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update block')
      }
      setEditingEvent(null)
      await loadSchedule()
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update block',
      )
    } finally {
      setEditEventSaving(false)
    }
  }

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('Delete this blocked time? This cannot be undone.')) return
    setEditEventSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/ops/events/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to delete block')
      }
      setEditingEvent(null)
      await loadSchedule()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Failed to delete block',
      )
    } finally {
      setEditEventSaving(false)
    }
  }

  const renderApptBlocks = (appts: Appointment[]) => {
    const overlapCols = computeOverlapColumns(appts)
    return appts.map((appointment) => {
      const customer = unwrapRelation(appointment.ops_customers)
      const invoice = unwrapRelation(appointment.ops_invoices)
      const endOverride =
        resizeSession?.appointmentId === appointment.id &&
        resizeLiveEndMinutes != null
          ? resizeLiveEndMinutes
          : null
      const placement = getAppointmentPlacement(appointment, endOverride)
      const isEstimate = appointment.kind === 'estimate'
      const href = isEstimate
        ? `/admin/operations/estimates/${appointment.id}`
        : invoice?.id
          ? `/admin/operations/invoices/${invoice.id}`
          : appointment.recurring_template_id
            ? `/admin/operations/recurring/visit/${appointment.id}`
            : `/admin/operations/appointments/${appointment.id}`
      const isDragging = draggingAppointment?.id === appointment.id
      const oc = overlapCols.get(appointment.id) ?? { col: 0, totalCols: 1 }
      const blockTone = isEstimate
        ? getEstimateTone(appointment)
        : appointment.status === 'completed' ||
            appointment.status === 'cancelled'
          ? getStatusTone(appointment.status)
          : appointment.recurring_template_id
            ? (getRecurringTone(
                recurringFreqMap[appointment.recurring_template_id],
              ) ?? getStatusTone(appointment.status))
            : getStatusTone(appointment.status)
      const isPointerDraggingThis =
        pointerDragging && draggingAppointment?.id === appointment.id
      const effectiveStaffId =
        appointment.assigned_staff_user_id ?? staffList[0]?.id
      const otherStaff = staffList.filter(
        (staff) => staff.id !== effectiveStaffId,
      )
      return (
        <div
          key={appointment.id}
          data-appointment-block
          className={`absolute flex flex-col overflow-hidden rounded-2xl border text-xs text-slate-900 shadow-sm transition ${blockTone} ${isDragging ? 'opacity-40' : 'hover:shadow-md'} ${isPointerDraggingThis ? 'pointer-events-none' : ''}`}
          style={{
            top: placement.top + 6,
            height: placement.height - 8,
            ...overlapStyle(oc.col, oc.totalCols),
          }}
        >
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('appointmentId', appointment.id)
              e.dataTransfer.effectAllowed = 'move'
              const block = (e.currentTarget as HTMLElement).closest(
                '[data-appointment-block]',
              ) as HTMLElement | null
              if (block) {
                draggingYOffsetRef.current =
                  e.clientY - block.getBoundingClientRect().top
              } else {
                draggingYOffsetRef.current = e.nativeEvent.offsetY
              }
              didDragRef.current = false
              setDraggingAppointment(appointment)
              setTimeout(() => {
                didDragRef.current = true
              }, 50)
            }}
            onDragEnd={() => {
              setDraggingAppointment(null)
              setDragPreview(null)
            }}
            onPointerDown={(e) => handleMovePointerDown(e, appointment)}
            onPointerMove={handleMovePointerMove}
            onPointerUp={(e) => void handleMovePointerUp(e)}
            onPointerCancel={(e) => void handleMovePointerUp(e)}
            style={{ touchAction: 'none' }}
            className="flex shrink-0 cursor-grab touch-none items-center gap-1 border-b border-black/5 bg-black/[0.03] px-2 py-1.5 active:cursor-grabbing sm:py-1"
            title="Drag to move start time"
          >
            <GripVertical className="h-4 w-4 shrink-0 text-slate-500 sm:h-3.5 sm:w-3.5" />
            <span className="text-[11px] font-medium tracking-tight text-slate-600 sm:text-[10px]">
              Move
            </span>
            {isMobile && view === 'day'
              ? otherStaff.map((staff) => (
                  <button
                    key={staff.id}
                    type="button"
                    draggable={false}
                    className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-300 bg-white/80 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={reassigningAppointmentId === appointment.id}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void handleMobileStaffReassignment(appointment, staff)
                    }}
                    aria-label={`Move job to ${staff.display_name}`}
                  >
                    {reassigningAppointmentId === appointment.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <UserRoundCog className="h-3 w-3" />
                    )}
                    To {staff.display_name.split(' ')[0]}
                  </button>
                ))
              : null}
            {view === 'week' &&
              staffList.length > 1 &&
              (() => {
                const staffIdx = staffList.findIndex(
                  (s) => s.id === appointment.assigned_staff_user_id,
                )
                if (staffIdx < 0) return null
                const initials = staffList[staffIdx].display_name.split(' ')[0]
                return (
                  <span
                    className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold text-white"
                    style={{
                      backgroundColor:
                        STAFF_LANE_COLORS[staffIdx % STAFF_LANE_COLORS.length],
                    }}
                  >
                    {initials}
                  </span>
                )
              })()}
          </div>
          <Link
            href={href}
            className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 pt-1"
            onClick={(e) => {
              if (didDragRef.current) e.preventDefault()
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="line-clamp-1 flex min-w-0 flex-1 items-center gap-1.5 leading-tight font-semibold">
                {isEstimate && (
                  <Ruler className="h-3 w-3 shrink-0 text-amber-600" />
                )}
                {!isEstimate && appointment.recurring_template_id && (
                  <Repeat className="h-3 w-3 shrink-0 text-blue-500" />
                )}
                {customer?.business_name || customer?.full_name || 'Customer'}
                {appointment.is_repeat_customer && (
                  <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                    Repeat
                  </span>
                )}
              </div>
            </div>
            {isEstimate && (
              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                <Ruler className="h-2.5 w-2.5" />
                Measure visit
              </span>
            )}
            {!isEstimate && appointment.recurring_template_id && (
              <a
                href={`/admin/operations/recurring/${appointment.recurring_template_id}`}
                onClick={(e) => e.stopPropagation()}
                className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100"
              >
                <Repeat className="h-2.5 w-2.5" />
                Recurring
              </a>
            )}
            <div className="mt-1 text-slate-700">
              {placement.startLabel} - {placement.endLabel}
            </div>
            {(() => {
              const address = unwrapRelation(appointment.ops_service_addresses)
              const city = address?.city
              const { leadLabel, bookingLabel } =
                getScheduleCardSources(appointment)
              if (city || leadLabel || bookingLabel) {
                return (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[10px] leading-tight text-slate-500">
                    {city && <span>{city}</span>}
                    {city && (leadLabel || bookingLabel) && <span>·</span>}
                    {leadLabel && <span>Lead: {leadLabel}</span>}
                    {leadLabel && bookingLabel && <span>·</span>}
                    {bookingLabel && <span>Booked: {bookingLabel}</span>}
                  </div>
                )
              }
              return null
            })()}
            <div className="mt-2 line-clamp-2 text-slate-800">
              {appointment.ops_appointment_line_items
                .map((item) => item.name_snapshot)
                .join(', ')}
            </div>
            {recurringLineItemDescriptionBoxes(appointment, false)}
            <div className="mt-auto flex items-center justify-between gap-1 pt-2">
              <span>{paymentMethodChip(appointment)}</span>
              <span
                className={`text-right font-semibold tabular-nums ${
                  appointment.status === 'completed'
                    ? 'text-slate-600'
                    : 'text-slate-800'
                }`}
              >
                ${calendarDisplayAmount(appointment)}
              </span>
            </div>
          </Link>
          {!isEstimate && appointment.status !== 'completed' && (
            <div className="pointer-events-none -mt-7 mb-1.5 flex justify-start px-2">
              <button
                type="button"
                className={`pointer-events-auto rounded-md border px-2 py-0.5 text-[9px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  appointment.status === 'cancelled'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
                disabled={statusActionAppointmentId === appointment.id}
                onClick={(e) => {
                  openStatusActionPopover(e, appointment)
                }}
              >
                {statusActionAppointmentId === appointment.id ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Saving
                  </span>
                ) : appointment.status === 'cancelled' ? (
                  'Restore'
                ) : (
                  'Cancel'
                )}
              </button>
            </div>
          )}
          <button
            type="button"
            aria-label="Drag to change end time"
            title="Drag to extend or shorten"
            style={{ touchAction: 'none' }}
            className="relative flex h-5 shrink-0 cursor-ns-resize touch-none items-center justify-center rounded-b-[13px] border-t border-black/10 bg-black/[0.08] hover:bg-black/[0.14] sm:h-2.5"
            onPointerDown={(e) => beginResize(e, appointment)}
          >
            <span
              aria-hidden
              className="block h-0.5 w-8 rounded-full bg-black/30 sm:hidden"
            />
          </button>
        </div>
      )
    })
  }

  const notifyPopupPosition =
    pendingNotify && typeof window !== 'undefined'
      ? getCalendarPopupPosition({
          x: pendingNotify.x,
          y: pendingNotify.y,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        })
      : null

  return (
    <div className="space-y-6">
      {/* Notify customer popup — anchored near the drop point */}
      {pendingNotify && notifyPopupPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={`pointer-events-none fixed z-[240] ${
                notifyPopupPosition.placeAbove ? '-translate-y-full' : ''
              }`}
              style={{
                left: notifyPopupPosition.left,
                top: notifyPopupPosition.top,
                width: notifyPopupPosition.width,
              }}
            >
              <Card className="border-border/60 bg-card/95 pointer-events-auto flex flex-col items-stretch gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:gap-4">
                <p className="min-w-0 flex-1 text-sm font-medium">
                  Notify{' '}
                  <span className="font-semibold">
                    {pendingNotify.customerName}
                  </span>{' '}
                  of the new time?
                </p>
                <div className="flex shrink-0 justify-end gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void sendRescheduleNotification(
                        pendingNotify.appointmentId,
                      )
                    }
                  >
                    Yes
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPendingNotify(null)}
                  >
                    No
                  </Button>
                </div>
              </Card>
            </div>,
            document.body,
          )
        : null}

      {pendingStatusAction ? (
        <>
          <button
            type="button"
            aria-label="Close status action"
            className="fixed inset-0 z-[219] cursor-default bg-transparent"
            onClick={() => setPendingStatusAction(null)}
          />
          <div
            className="fixed z-[220]"
            style={{
              left: Math.min(pendingStatusAction.x, window.innerWidth - 320),
              top: Math.min(pendingStatusAction.y, window.innerHeight - 190),
            }}
          >
            <Card className="border-border/60 bg-card/95 flex w-72 flex-col gap-3 rounded-xl border p-3 shadow-xl backdrop-blur">
              <div>
                <p className="text-sm font-semibold">
                  {pendingStatusAction.action === 'cancel'
                    ? `Cancel ${pendingStatusAction.customerName}'s job?`
                    : `Restore ${pendingStatusAction.customerName}'s job?`}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {pendingStatusAction.action === 'cancel'
                    ? 'This marks the job cancelled but does not delete it.'
                    : 'This puts the job back on the schedule as booked.'}
                </p>
              </div>
              {pendingStatusAction.action === 'cancel' ? (
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={
                      statusActionAppointmentId ===
                      pendingStatusAction.appointment.id
                    }
                    onClick={() =>
                      void handleAppointmentStatusAction(
                        pendingStatusAction.appointment,
                        'cancelled',
                        { notifyCustomer: true },
                      )
                    }
                  >
                    Cancel + notify customer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      statusActionAppointmentId ===
                      pendingStatusAction.appointment.id
                    }
                    onClick={() =>
                      void handleAppointmentStatusAction(
                        pendingStatusAction.appointment,
                        'cancelled',
                      )
                    }
                  >
                    Cancel quietly
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  disabled={
                    statusActionAppointmentId ===
                    pendingStatusAction.appointment.id
                  }
                  onClick={() =>
                    void handleAppointmentStatusAction(
                      pendingStatusAction.appointment,
                      'booked',
                    )
                  }
                >
                  Restore job
                </Button>
              )}
            </Card>
          </div>
        </>
      ) : null}

      {cellMenu ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-[219] cursor-default bg-transparent"
            onClick={() => setCellMenu(null)}
          />
          <div
            className="fixed z-[220]"
            style={{
              left: Math.min(cellMenu.x, window.innerWidth - 260),
              top: Math.min(cellMenu.y, window.innerHeight - 160),
            }}
          >
            <Card className="border-border/60 bg-card/95 flex w-56 flex-col gap-1 rounded-xl border p-2 shadow-xl backdrop-blur">
              <p className="text-muted-foreground px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide uppercase">
                {cellMenu.dateKey} · {String(cellMenu.hour).padStart(2, '0')}:00
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="justify-start gap-2"
                onClick={() => {
                  openNewJobAt(cellMenu.dateKey, cellMenu.hour)
                  setCellMenu(null)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                New job at this time
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="justify-start gap-2 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                onClick={() => {
                  openNewEstimateAt(cellMenu.dateKey, cellMenu.hour)
                  setCellMenu(null)
                }}
              >
                <Ruler className="h-3.5 w-3.5" />
                New estimate at this time
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="justify-start gap-2 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                onClick={() => {
                  openBlockAt(cellMenu.dateKey, cellMenu.hour, cellMenu.staffId)
                  setCellMenu(null)
                }}
              >
                <ShieldBan className="h-3.5 w-3.5" />
                Block time at this hour
              </Button>
            </Card>
          </div>
        </>
      ) : null}

      <Card className="glass-accent-ring via-card/80 relative overflow-visible border-transparent bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 p-4 shadow-lg shadow-emerald-950/25 backdrop-blur">
        {/* Row 1: navigation on the left, actions on the right */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchorDate(new Date())}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => moveRange('prev')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => moveRange('next')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Week/Day/Month toggle — desktop only. On mobile we force day view. */}
          <div className="border-border ml-2 hidden rounded-xl border p-1 sm:flex">
            {(['week', 'day', 'month'] as ScheduleView[]).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={view === option ? 'default' : 'ghost'}
                className="capitalize"
                onClick={() => setView(option)}
              >
                {option}
              </Button>
            ))}
          </div>

          <div className="flex-1" />

          <Button
            asChild
            className="book-job-cta group relative h-11 overflow-hidden rounded-xl border-0 px-6 text-base font-bold tracking-wide text-white transition-transform duration-300 hover:scale-[1.04] focus-visible:scale-[1.04]"
          >
            <Link href="/admin/operations/new-job">
              <span
                aria-hidden
                className="book-job-sheen pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full"
              />
              <Plus className="h-5 w-5" />
              Book Job
            </Link>
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => void loadSchedule()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Row 2: tappable date label that opens a mini month calendar */}
        <div className="relative mt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openDatePicker}
            aria-expanded={datePickerOpen}
            aria-haspopup="dialog"
            className="w-full justify-start gap-2 font-semibold sm:w-auto"
          >
            <CalendarRange className="h-4 w-4 opacity-70" />
            <span className="truncate">{viewLabel}</span>
          </Button>

          {datePickerOpen && typeof document !== 'undefined'
            ? createPortal(
                <div
                  role="dialog"
                  aria-label="Pick a date"
                  aria-modal="true"
                  className="fixed inset-0 z-[220] flex items-start justify-center px-4 pt-20 sm:items-center sm:pt-0"
                >
                  <button
                    type="button"
                    aria-label="Close calendar"
                    className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm"
                    onClick={closeDatePicker}
                  />
                  <div className="border-border/60 bg-background animate-slide-up relative w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border p-3 shadow-xl">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Previous month"
                        onClick={() => setPickerMonth((m) => addMonths(m, -1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <button
                        type="button"
                        onClick={() => setPickerMonth(startOfMonth(new Date()))}
                        className="hover:bg-muted rounded-md px-2 py-1 text-sm font-semibold"
                        title="Jump to current month"
                      >
                        {pickerMonth.toLocaleDateString('en-US', {
                          month: 'long',
                          year: 'numeric',
                        })}
                      </button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Next month"
                        onClick={() => setPickerMonth((m) => addMonths(m, 1))}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="text-muted-foreground mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium tracking-wide uppercase">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                        <div key={`${d}-${i}`}>{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {buildMonthGrid(pickerMonth).map((d) => {
                        const dKey = formatDateKey(d)
                        const inMonth = d.getMonth() === pickerMonth.getMonth()
                        const isToday = dKey === todayKey
                        const isSelected = dKey === formatDateKey(anchorDate)
                        return (
                          <button
                            key={dKey}
                            type="button"
                            onClick={() => {
                              setAnchorDate(d)
                              setDatePickerOpen(false)
                            }}
                            className={[
                              'flex h-9 items-center justify-center rounded-lg text-sm transition',
                              isSelected
                                ? 'bg-emerald-500 font-semibold text-white shadow'
                                : isToday
                                  ? 'border-emerald-500 text-emerald-600 ring-1 ring-emerald-500 hover:bg-emerald-50'
                                  : inMonth
                                    ? 'text-foreground hover:bg-muted'
                                    : 'text-muted-foreground/60 hover:bg-muted/60',
                            ].join(' ')}
                          >
                            {d.getDate()}
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const now = new Date()
                          setAnchorDate(now)
                          setPickerMonth(startOfMonth(now))
                          setDatePickerOpen(false)
                        }}
                      >
                        Today
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={closeDatePicker}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}
        </div>

        {showBlockForm ? (
          <form
            className="border-border/60 bg-background/70 mt-4 grid gap-3 rounded-2xl border p-4 md:grid-cols-3"
            onSubmit={handleBlockSubmit}
          >
            <div className="md:col-span-3">
              <Label htmlFor="block-title">Description</Label>
              <Input
                id="block-title"
                value={blockForm.title}
                onChange={(event) =>
                  setBlockForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Vacation, doctor, sick day, hold, or anything else"
              />
            </div>
            <div>
              <Label htmlFor="block-start-date">Start Date</Label>
              <Input
                id="block-start-date"
                type="date"
                value={blockForm.start_date}
                onChange={(event) =>
                  setBlockForm((current) => ({
                    ...current,
                    start_date: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="block-end-date">End Date</Label>
              <Input
                id="block-end-date"
                type="date"
                value={blockForm.end_date}
                onChange={(event) =>
                  setBlockForm((current) => ({
                    ...current,
                    end_date: event.target.value,
                  }))
                }
              />
            </div>
            <label className="text-muted-foreground flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={blockForm.is_all_day}
                onChange={(event) =>
                  setBlockForm((current) => ({
                    ...current,
                    is_all_day: event.target.checked,
                    start_time: event.target.checked ? '' : current.start_time,
                    end_time: event.target.checked ? '' : current.end_time,
                  }))
                }
              />
              All day / full range
            </label>
            {!blockForm.is_all_day ? (
              <>
                <div>
                  <Label htmlFor="block-start-time">Start Time</Label>
                  <Input
                    id="block-start-time"
                    type="time"
                    value={blockForm.start_time}
                    onChange={(event) =>
                      setBlockForm((current) => ({
                        ...current,
                        start_time: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="block-end-time">End Time</Label>
                  <Input
                    id="block-end-time"
                    type="time"
                    value={blockForm.end_time}
                    onChange={(event) =>
                      setBlockForm((current) => ({
                        ...current,
                        end_time: event.target.value,
                      }))
                    }
                  />
                </div>
              </>
            ) : null}
            <div className="md:col-span-3">
              <Label htmlFor="block-notes">Notes</Label>
              <Textarea
                id="block-notes"
                value={blockForm.description}
                onChange={(event) =>
                  setBlockForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Optional notes for the block"
              />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-3">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save Block
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowBlockForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {editingEvent && typeof document !== 'undefined'
          ? createPortal(
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Edit blocked time"
                className="fixed inset-x-0 top-14 bottom-0 z-[220] flex items-start justify-center overflow-hidden bg-black/50 px-3 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:inset-0 sm:items-center sm:p-4"
              >
                {/* Backdrop — tap to dismiss */}
                <button
                  type="button"
                  aria-label="Close edit blocked time"
                  className="absolute inset-0 cursor-default"
                  onClick={() => setEditingEvent(null)}
                />
                {/* Panel */}
                <div className="bg-background border-border/60 relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-3xl border shadow-2xl sm:max-h-[92dvh] sm:max-w-lg">
                  {/* Drag handle — mobile only */}
                  <div className="mx-auto mt-3 mb-1 h-1 w-10 rounded-full bg-slate-300 md:hidden" />
                  <form
                    className="grid gap-4 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:grid-cols-2"
                    onSubmit={handleUpdateEvent}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between md:col-span-2">
                      <span className="text-base font-semibold">
                        Edit Blocked Time
                      </span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground rounded-full p-1 text-xl leading-none transition-colors"
                        onClick={() => setEditingEvent(null)}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>

                    {/* Title */}
                    <div className="md:col-span-2">
                      <Label htmlFor="edit-block-title">Description</Label>
                      <Input
                        id="edit-block-title"
                        className="mt-1"
                        value={editEventForm.title}
                        onChange={(e) =>
                          setEditEventForm((cur) => ({
                            ...cur,
                            title: e.target.value,
                          }))
                        }
                        placeholder="Vacation, doctor, sick day, hold…"
                      />
                    </div>

                    {/* Dates */}
                    <div>
                      <Label htmlFor="edit-block-start-date">Start Date</Label>
                      <Input
                        id="edit-block-start-date"
                        type="date"
                        className="mt-1"
                        value={editEventForm.start_date}
                        onChange={(e) =>
                          setEditEventForm((cur) => ({
                            ...cur,
                            start_date: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-block-end-date">End Date</Label>
                      <Input
                        id="edit-block-end-date"
                        type="date"
                        className="mt-1"
                        value={editEventForm.end_date}
                        onChange={(e) =>
                          setEditEventForm((cur) => ({
                            ...cur,
                            end_date: e.target.value,
                          }))
                        }
                      />
                    </div>

                    {/* All-day toggle */}
                    <label className="text-muted-foreground flex cursor-pointer items-center gap-3 rounded-xl p-2 text-sm md:col-span-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={editEventForm.is_all_day}
                        onChange={(e) =>
                          setEditEventForm((cur) => ({
                            ...cur,
                            is_all_day: e.target.checked,
                            start_time: e.target.checked ? '' : cur.start_time,
                            end_time: e.target.checked ? '' : cur.end_time,
                          }))
                        }
                      />
                      All day / full range
                    </label>

                    {/* Times — only shown when not all-day */}
                    {!editEventForm.is_all_day ? (
                      <>
                        <div>
                          <Label htmlFor="edit-block-start-time">
                            Start Time
                          </Label>
                          <Input
                            id="edit-block-start-time"
                            type="time"
                            className="mt-1"
                            value={editEventForm.start_time}
                            onChange={(e) =>
                              setEditEventForm((cur) => ({
                                ...cur,
                                start_time: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="edit-block-end-time">End Time</Label>
                          <Input
                            id="edit-block-end-time"
                            type="time"
                            className="mt-1"
                            value={editEventForm.end_time}
                            onChange={(e) =>
                              setEditEventForm((cur) => ({
                                ...cur,
                                end_time: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </>
                    ) : null}

                    {/* Notes */}
                    <div className="md:col-span-2">
                      <Label htmlFor="edit-block-notes">Notes</Label>
                      <Textarea
                        id="edit-block-notes"
                        className="mt-1"
                        value={editEventForm.description}
                        onChange={(e) =>
                          setEditEventForm((cur) => ({
                            ...cur,
                            description: e.target.value,
                          }))
                        }
                        placeholder="Optional notes"
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 pt-1 md:col-span-2 md:flex-row">
                      <Button
                        type="submit"
                        className="w-full md:w-auto"
                        disabled={editEventSaving}
                      >
                        {editEventSaving ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Save Changes
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full md:w-auto"
                        onClick={() => setEditingEvent(null)}
                        disabled={editEventSaving}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="w-full md:ml-auto md:w-auto"
                        onClick={() => void handleDeleteEvent(editingEvent.id)}
                        disabled={editEventSaving}
                      >
                        Delete Block
                      </Button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body,
            )
          : null}

        {showBusinessHours ? (
          <form
            className="border-border/60 bg-background/70 mt-4 space-y-3 rounded-2xl border p-4"
            onSubmit={saveBusinessHours}
          >
            <div>
              <div className="text-sm font-semibold">Business Hours</div>
              <p className="text-muted-foreground mt-1 text-xs">
                Set the working window by day. Outside this window is treated as
                off-hours in the calendar and slot generation.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {businessHoursRows.map((row) => (
                <div
                  key={row.day_of_week}
                  className="border-border/60 rounded-xl border p-3"
                >
                  <label className="flex items-center justify-between gap-2 text-sm font-medium">
                    <span>{WEEKDAY_LABELS[row.day_of_week]}</span>
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(event) =>
                        setBusinessHoursRows((current) =>
                          current.map((entry) =>
                            entry.day_of_week === row.day_of_week
                              ? { ...entry, is_active: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor={`biz-start-${row.day_of_week}`}>
                        Start
                      </Label>
                      <Input
                        id={`biz-start-${row.day_of_week}`}
                        type="time"
                        value={row.start_time}
                        disabled={!row.is_active}
                        onChange={(event) =>
                          setBusinessHoursRows((current) =>
                            current.map((entry) =>
                              entry.day_of_week === row.day_of_week
                                ? { ...entry, start_time: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`biz-end-${row.day_of_week}`}>End</Label>
                      <Input
                        id={`biz-end-${row.day_of_week}`}
                        type="time"
                        value={row.end_time}
                        disabled={!row.is_active}
                        onChange={(event) =>
                          setBusinessHoursRows((current) =>
                            current.map((entry) =>
                              entry.day_of_week === row.day_of_week
                                ? { ...entry, end_time: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={businessHoursSaving}>
                {businessHoursSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save Business Hours
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setBusinessHoursRows(
                    DEFAULT_BUSINESS_HOURS_ROWS.map((row) => ({ ...row })),
                  )
                }
              >
                Reset to Mon-Sat 9:00-17:00
              </Button>
            </div>
          </form>
        ) : null}
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {/* Swipeable day strip — shown in day and week views */}
      {view !== 'month' ? (
        <div
          ref={dayStripRef}
          className="flex gap-1 overflow-x-auto pb-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {Array.from({ length: 21 }, (_, i) =>
            addDays(anchorDate, i - 10),
          ).map((day) => {
            const dk = formatDateKey(day)
            const anchorKey = formatDateKey(anchorDate)
            const isSelected = dk === anchorKey
            const isToday = dk === todayKey
            return (
              <button
                key={dk}
                type="button"
                data-strip-active={isSelected ? 'true' : 'false'}
                onClick={() => {
                  setAnchorDate(new Date(`${dk}T12:00:00`))
                  if (view !== 'day') setView('day')
                }}
                className={`flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition ${
                  isSelected
                    ? 'bg-green-600 text-white'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="text-[10px] font-semibold tracking-wide uppercase">
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span
                  className={`text-base font-bold ${isToday && !isSelected ? 'text-green-600' : ''}`}
                >
                  {day.getDate()}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      {view === 'day' && isMobile && staffList.length > 1 ? (
        <div className="flex items-center gap-1.5">
          {staffList.map((staff, idx) => {
            const isActive = (staffFilter ?? staffList[0]?.id) === staff.id
            const color = STAFF_LANE_COLORS[idx % STAFF_LANE_COLORS.length]
            const dateKey = formatDateKey(anchorDate)
            const isOpen = isStaffOpenForDate(staff.id, dateKey)
            return (
              <button
                key={staff.id}
                type="button"
                onClick={() => setStaffFilter(staff.id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600'
                }`}
                style={isActive ? { backgroundColor: color } : undefined}
              >
                <span
                  className={`h-2 w-2 rounded-full ${isOpen ? 'bg-emerald-400' : 'bg-slate-300'}`}
                />
                {staff.display_name.split(' ')[0]}
              </button>
            )
          })}
        </div>
      ) : null}

      {view === 'week' && staffList.length > 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Staff:</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setStaffFilter(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                staffFilter === null
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            {staffList.map((staff, idx) => (
              <button
                key={staff.id}
                type="button"
                onClick={() => setStaffFilter(staff.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  staffFilter === staff.id
                    ? 'text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                style={
                  staffFilter === staff.id
                    ? {
                        backgroundColor:
                          STAFF_LANE_COLORS[idx % STAFF_LANE_COLORS.length],
                      }
                    : undefined
                }
              >
                {staff.display_name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {view === 'week' && weeklyTotal > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-green-600/20 bg-green-50 px-4 py-3">
          <span className="text-sm font-medium text-green-900">Week Total</span>
          <span className="text-lg font-bold text-green-700">
            $
            {weeklyTotal.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      ) : null}

      {view === 'month' ? (
        <Card className="border-border/60 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium tracking-[0.2em] text-slate-500 uppercase">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-7 gap-2">
            {monthGrid.map((date) => {
              const dateKey = formatDateKey(date)
              const dayAppointments = appointmentsByDate.get(dateKey) || []
              const dayEvents = data.events.filter((event) =>
                intersectsDay(event, dateKey),
              )
              const isCurrentMonth = date.getMonth() === anchorDate.getMonth()

              return (
                <div
                  key={dateKey}
                  className={`min-h-36 rounded-2xl border p-3 ${
                    isCurrentMonth
                      ? 'border-slate-200 bg-white'
                      : 'border-slate-200 bg-slate-100 text-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      {date.getDate()}
                    </div>
                    {(dayAppointments.length > 0 || dayEvents.length > 0) && (
                      <Badge variant="outline">
                        {dayAppointments.length + dayEvents.length}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    {dayEvents.slice(0, 2).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className={`w-full cursor-pointer rounded-xl border px-2 py-1 text-left text-xs transition-opacity hover:opacity-80 ${getEventTone(event)}`}
                        onClick={() => openEditEvent(event)}
                      >
                        {event.title}
                      </button>
                    ))}
                    {dayAppointments.slice(0, 3).map((appointment) => {
                      const customer = unwrapRelation(appointment.ops_customers)
                      const invoice = unwrapRelation(appointment.ops_invoices)
                      const isEstimate = appointment.kind === 'estimate'
                      const href = isEstimate
                        ? `/admin/operations/estimates/${appointment.id}`
                        : invoice?.id
                          ? `/admin/operations/invoices/${invoice.id}`
                          : appointment.recurring_template_id
                            ? `/admin/operations/recurring/visit/${appointment.id}`
                            : `/admin/operations/appointments/${appointment.id}`
                      const tone = isEstimate
                        ? getEstimateTone(appointment)
                        : appointment.status === 'completed' ||
                            appointment.status === 'cancelled'
                          ? getStatusTone(appointment.status)
                          : appointment.recurring_template_id
                            ? (getRecurringTone(
                                recurringFreqMap[
                                  appointment.recurring_template_id
                                ],
                              ) ?? getStatusTone(appointment.status))
                            : getStatusTone(appointment.status)
                      return (
                        <Link
                          key={appointment.id}
                          href={href}
                          className={`text-foreground block rounded-xl border px-2 py-2 text-xs transition hover:shadow-sm ${tone}`}
                        >
                          <div className="flex items-center gap-1 font-medium">
                            {isEstimate && (
                              <Ruler className="h-3 w-3 shrink-0 text-amber-600" />
                            )}
                            {!isEstimate &&
                              appointment.recurring_template_id && (
                                <Repeat className="h-3 w-3 shrink-0 text-blue-500" />
                              )}
                            {appointment.start_time.slice(0, 5)}{' '}
                            {customer?.full_name}
                            {appointment.is_repeat_customer && (
                              <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                                Repeat
                              </span>
                            )}
                          </div>
                          <div className="text-muted-foreground mt-1">
                            {/* Keep service context visible in compact month tiles */}
                            {appointment.ops_appointment_line_items[0]
                              ?.name_snapshot || 'Service'}
                          </div>
                          {recurringLineItemDescriptionBoxes(appointment, true)}
                          {(() => {
                            const address = unwrapRelation(
                              appointment.ops_service_addresses,
                            )
                            const city = address?.city
                            const { leadLabel, bookingLabel } =
                              getScheduleCardSources(appointment)
                            if (city || leadLabel || bookingLabel) {
                              return (
                                <div className="text-muted-foreground mt-0.5 text-[10px] leading-tight">
                                  {city && <span>{city}</span>}
                                  {city && (leadLabel || bookingLabel) && (
                                    <span> · </span>
                                  )}
                                  {leadLabel && <span>Lead: {leadLabel}</span>}
                                  {leadLabel && bookingLabel && (
                                    <span> · </span>
                                  )}
                                  {bookingLabel && (
                                    <span>Booked: {bookingLabel}</span>
                                  )}
                                </div>
                              )
                            }
                            return null
                          })()}
                          {invoice?.id ? (
                            <div className="text-muted-foreground mt-1">
                              Invoice ready
                            </div>
                          ) : null}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      ) : (
        <Card
          className="border-border/60 overflow-hidden bg-white shadow-sm"
          onTouchStart={handleCalTouchStart}
          onTouchMove={handleCalTouchMove}
          onTouchEnd={handleCalTouchEnd}
        >
          <div ref={calendarRef}>
            <div
              className={
                view === 'day' && isMobile
                  ? 'overflow-x-hidden'
                  : 'overflow-x-auto'
              }
            >
              {(() => {
                // On mobile day view, collapse all staff lanes to a single lane.
                // The user picks which tech to view via the pill toggle above the calendar.
                const myStaff =
                  staffList.find((s) => s.user_id === currentUserId) ??
                  staffList[0]
                const activeDayStaff: StaffMember | null =
                  isMobile && view === 'day' && staffList.length > 0
                    ? staffFilter
                      ? (staffList.find((s) => s.id === staffFilter) ?? myStaff)
                      : myStaff
                    : null
                const dayLanes = activeDayStaff ? [activeDayStaff] : staffList
                return (
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns:
                        view === 'day'
                          ? activeDayStaff
                            ? '72px 1fr'
                            : `72px repeat(${Math.max(staffList.length, 1)}, minmax(400px, 1fr))`
                          : '72px 48px repeat(6, minmax(270px, 1fr))',
                      minWidth:
                        view === 'day'
                          ? activeDayStaff
                            ? undefined
                            : `${72 + Math.max(staffList.length, 1) * 400}px`
                          : `${72 + 48 + 6 * 270}px`,
                    }}
                  >
                    <div className="border-r border-b border-slate-200 bg-slate-100 p-3" />
                    {view === 'day' && staffList.length > 0
                      ? dayLanes.map((staff, idx) => {
                          const dateKey = formatDateKey(anchorDate)
                          const isOpen = isStaffOpenForDate(staff.id, dateKey)
                          const laneTotal = (
                            appointmentsByDate.get(dateKey) || []
                          )
                            .filter(
                              (a) =>
                                a.assigned_staff_user_id === staff.id ||
                                (!a.assigned_staff_user_id &&
                                  staff.id === staffList[0]?.id),
                            )
                            .reduce(
                              (sum, appt) =>
                                sum + appointmentDisplayRevenue(appt),
                              0,
                            )
                          const color =
                            STAFF_LANE_COLORS[
                              staffList.indexOf(staff) %
                                STAFF_LANE_COLORS.length
                            ]
                          return (
                            <div
                              key={staff.id}
                              className={`border-b border-slate-200 p-3 ${isOpen ? 'bg-emerald-50/60' : 'bg-slate-100'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-block h-3 w-3 rounded-full"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="text-sm font-semibold text-slate-700">
                                    {staff.display_name}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleStaffAvailability(staff.id, dateKey)
                                  }
                                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                                    isOpen ? 'bg-emerald-500' : 'bg-slate-300'
                                  }`}
                                  aria-label={`Toggle ${staff.display_name} availability`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                                      isOpen ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </div>
                              <div
                                className={`mt-1 text-xs font-medium ${isOpen ? 'text-emerald-600' : 'text-slate-400'}`}
                              >
                                {isOpen ? 'OPEN' : 'CLOSED'}
                              </div>
                              <div className="mt-1 text-xs font-medium tracking-[0.2em] text-slate-500 uppercase">
                                {WEEKDAY_LABELS[anchorDate.getDay()]}
                              </div>
                              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                                <span className="text-lg font-semibold text-slate-700">
                                  {anchorDate.toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </span>
                                {laneTotal > 0 && (
                                  <span className="text-sm font-semibold text-green-700">
                                    ${laneTotal.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })
                      : displayedDays.map((date) => {
                          const dk = formatDateKey(date)
                          const isSunday = date.getDay() === 0
                          const dayTotal = (
                            appointmentsByDate.get(dk) || []
                          ).reduce(
                            (sum, appt) =>
                              sum + appointmentDisplayRevenue(appt),
                            0,
                          )
                          if (isSunday) {
                            return (
                              <div
                                key={dk}
                                className="flex items-center justify-center border-r border-b border-slate-200 bg-slate-100"
                              >
                                <span className="text-[10px] font-medium tracking-widest text-slate-400 uppercase [writing-mode:vertical-rl]">
                                  Sun
                                </span>
                              </div>
                            )
                          }
                          return (
                            <div
                              key={dk}
                              className="border-b border-slate-200 bg-slate-100 p-3"
                            >
                              <div className="text-xs font-medium tracking-[0.2em] text-slate-500 uppercase">
                                {WEEKDAY_LABELS[date.getDay()]}
                              </div>
                              <div className="mt-1 flex items-baseline justify-between gap-2">
                                <span className="text-lg font-semibold text-slate-700">
                                  {date.toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </span>
                                {dayTotal > 0 && (
                                  <span className="text-sm font-semibold text-green-700">
                                    ${dayTotal.toFixed(2)}
                                  </span>
                                )}
                              </div>
                              {staffList.length > 1 && (
                                <div className="mt-2 flex gap-1">
                                  {staffList.map((staff, idx) => {
                                    const open = isStaffOpenForDate(
                                      staff.id,
                                      dk,
                                    )
                                    const color =
                                      STAFF_LANE_COLORS[
                                        idx % STAFF_LANE_COLORS.length
                                      ]
                                    return (
                                      <button
                                        key={staff.id}
                                        type="button"
                                        title={`${staff.display_name}: click to toggle ${open ? 'closed' : 'open'}`}
                                        onClick={() =>
                                          toggleStaffAvailability(staff.id, dk)
                                        }
                                        className="flex-1 truncate rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm transition hover:opacity-80 active:scale-95"
                                        style={{
                                          backgroundColor: open
                                            ? color
                                            : '#9ca3af',
                                        }}
                                      >
                                        {staff.display_name.split(' ')[0]}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}

                    <div className="relative border-r border-slate-200 bg-slate-50">
                      {HOURS.map((hour) => (
                        <div
                          key={hour}
                          className="border-b border-slate-200 px-3 pt-2 text-xs text-slate-500"
                          style={{ height: HOUR_HEIGHT }}
                        >
                          {hour === 12
                            ? '12pm'
                            : hour > 12
                              ? `${hour - 12}pm`
                              : `${hour}am`}
                        </div>
                      ))}
                    </div>

                    {view === 'day' && staffList.length > 0
                      ? dayLanes.map((staff) => {
                          const dateKey = formatDateKey(anchorDate)
                          const allDayAppointments =
                            appointmentsByDate.get(dateKey) || []
                          const dayAppointments = allDayAppointments.filter(
                            (a) =>
                              a.assigned_staff_user_id === staff.id ||
                              (!a.assigned_staff_user_id &&
                                staff.id === staffList[0]?.id),
                          )
                          const dayEvents = data.events.filter((event) =>
                            intersectsDay(event, dateKey),
                          )
                          const dayRanges =
                            businessDayRanges.get(anchorDate.getDay()) || []
                          const offHourSegments =
                            getOffHourSegmentsForGrid(dayRanges)
                          const laneIsOpen = isStaffOpenForDate(
                            staff.id,
                            dateKey,
                          )
                          return (
                            <div
                              key={staff.id}
                              data-date-column={dateKey}
                              data-staff-lane={staff.id}
                              className={`relative border-r border-slate-200 ${laneIsOpen ? 'bg-white' : 'bg-slate-100/60'}`}
                              onDragOver={(e) =>
                                handleDragOver(e, dateKey, staff.id)
                              }
                              onDragLeave={() => setDragPreview(null)}
                              onDrop={(e) =>
                                void handleDrop(e, dateKey, staff.id)
                              }
                            >
                              {!laneIsOpen && (
                                <div className="pointer-events-none absolute inset-0 z-10 bg-slate-200/40" />
                              )}
                              {dragPreview?.dateKey === dateKey &&
                              dragPreview?.staffId === staff.id &&
                              draggingAppointment
                                ? (() => {
                                    const ghostPlacement =
                                      getAppointmentPlacement(
                                        draggingAppointment,
                                      )
                                    const ghostTop =
                                      ((dragPreview.snappedMinutes -
                                        GRID_START_MINUTES) /
                                        60) *
                                      HOUR_HEIGHT
                                    return (
                                      <div
                                        className="pointer-events-none absolute right-2 left-2 rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-100/60"
                                        style={{
                                          top: ghostTop + 6,
                                          height: ghostPlacement.height - 8,
                                        }}
                                      />
                                    )
                                  })()
                                : null}
                              {HOURS.map((hour) => (
                                <button
                                  key={`${dateKey}-${hour}`}
                                  type="button"
                                  className="focus-visible:ring-ring relative z-0 block w-full border-b border-slate-200 text-left transition hover:bg-emerald-50/60 focus-visible:ring-2 focus-visible:outline-none"
                                  style={{ height: HOUR_HEIGHT }}
                                  onClick={(e) => {
                                    setCellMenu({
                                      dateKey,
                                      hour,
                                      x: e.clientX,
                                      y: e.clientY,
                                      staffId: staff.id,
                                    })
                                  }}
                                  title={`Create at ${String(hour).padStart(2, '0')}:00`}
                                  aria-label={`Create on ${dateKey} at ${String(hour).padStart(2, '0')}:00`}
                                />
                              ))}
                              {offHourSegments.map((segment, index) => {
                                const gridStartMinutes = HOURS[0] * 60
                                const top =
                                  ((segment.start - gridStartMinutes) / 60) *
                                  HOUR_HEIGHT
                                const height =
                                  ((segment.end - segment.start) / 60) *
                                  HOUR_HEIGHT
                                return (
                                  <div
                                    key={`${dateKey}-off-${index}`}
                                    className="pointer-events-none absolute right-0 left-0 bg-slate-100/80"
                                    style={{ top, height }}
                                  />
                                )
                              })}
                              {dayEvents
                                .filter(
                                  (event) =>
                                    event.assigned_staff_user_id === staff.id ||
                                    (!event.assigned_staff_user_id &&
                                      staff.id === staffList[0]?.id),
                                )
                                .map((event) => {
                                  const endOverride =
                                    eventResizeSession?.eventId === event.id &&
                                    eventResizeLiveEndMinutes != null
                                      ? eventResizeLiveEndMinutes
                                      : null
                                  const placement = getBlockPlacement(
                                    event,
                                    endOverride,
                                  )
                                  const isDraggingThis =
                                    draggingEvent?.id === event.id
                                  return (
                                    <div
                                      key={event.id}
                                      data-event-block
                                      className={`absolute right-2 left-2 flex flex-col overflow-hidden rounded-2xl border text-xs shadow-sm ${getEventTone(event)} ${isDraggingThis ? 'opacity-40' : ''}`}
                                      style={{
                                        top: placement.top + 6,
                                        height: placement.height - 8,
                                      }}
                                    >
                                      {!event.is_all_day && (
                                        <div
                                          onPointerDown={(e) =>
                                            handleEventMovePointerDown(e, event)
                                          }
                                          onPointerMove={
                                            handleEventMovePointerMove
                                          }
                                          onPointerUp={(e) =>
                                            void handleEventMovePointerUp(e)
                                          }
                                          onPointerCancel={(e) =>
                                            void handleEventMovePointerUp(e)
                                          }
                                          style={{ touchAction: 'none' }}
                                          className="flex shrink-0 cursor-grab touch-none items-center gap-1 border-b border-black/5 bg-black/[0.03] px-2 py-1.5 active:cursor-grabbing"
                                        >
                                          <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                          <span className="text-[10px] font-medium tracking-tight text-slate-600">
                                            Move
                                          </span>
                                        </div>
                                      )}
                                      <button
                                        type="button"
                                        className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 text-left"
                                        onClick={() => openEditEvent(event)}
                                      >
                                        <div className="font-semibold">
                                          {event.title}
                                        </div>
                                        {event.description ? (
                                          <div className="mt-1 line-clamp-2 opacity-75">
                                            {event.description}
                                          </div>
                                        ) : null}
                                      </button>
                                      {!event.is_all_day && (
                                        <button
                                          type="button"
                                          aria-label="Drag to change end time"
                                          title="Drag to extend or shorten"
                                          style={{ touchAction: 'none' }}
                                          className="relative flex h-5 shrink-0 cursor-ns-resize touch-none items-center justify-center rounded-b-[13px] border-t border-black/10 bg-black/[0.08] hover:bg-black/[0.14] sm:h-2.5"
                                          onPointerDown={(e) =>
                                            beginEventResize(e, event)
                                          }
                                        >
                                          <span
                                            aria-hidden
                                            className="block h-0.5 w-8 rounded-full bg-black/30 sm:hidden"
                                          />
                                        </button>
                                      )}
                                    </div>
                                  )
                                })}
                              {dateKey === todayKey &&
                              nowMinutes != null &&
                              nowMinutes >= GRID_START_MINUTES &&
                              nowMinutes <=
                                (HOURS[HOURS.length - 1] + 1) * 60 ? (
                                <div
                                  className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
                                  style={{
                                    top:
                                      ((nowMinutes - GRID_START_MINUTES) / 60) *
                                      HOUR_HEIGHT,
                                  }}
                                >
                                  <span className="ml-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-sm" />
                                  <span className="h-px flex-1 bg-red-500/80" />
                                </div>
                              ) : null}
                              {renderApptBlocks(dayAppointments)}
                            </div>
                          )
                        })
                      : view === 'week' && staffList.length > 1
                        ? displayedDays.map((date) => {
                            const dateKey = formatDateKey(date)
                            const isSunday = date.getDay() === 0
                            if (isSunday) {
                              return (
                                <div
                                  key={dateKey}
                                  className="border-r border-slate-200 bg-slate-100/70"
                                />
                              )
                            }
                            const allDayAppointments =
                              appointmentsByDate.get(dateKey) || []
                            const dayEvents = data.events.filter((event) =>
                              intersectsDay(event, dateKey),
                            )
                            const dayRanges =
                              businessDayRanges.get(date.getDay()) || []
                            const offHourSegments =
                              getOffHourSegmentsForGrid(dayRanges)
                            return (
                              <div
                                key={dateKey}
                                className="relative flex border-r border-slate-200"
                              >
                                {staffList.map((staff, staffIdx) => {
                                  const laneAppts = allDayAppointments.filter(
                                    (a) =>
                                      a.assigned_staff_user_id === staff.id ||
                                      (!a.assigned_staff_user_id &&
                                        staffIdx === 0),
                                  )
                                  const laneIsOpen = isStaffOpenForDate(
                                    staff.id,
                                    dateKey,
                                  )
                                  const isFirst = staffIdx === 0
                                  return (
                                    <div
                                      key={staff.id}
                                      data-date-column={dateKey}
                                      data-staff-lane={staff.id}
                                      className={`relative min-w-0 flex-1 ${staffIdx < staffList.length - 1 ? 'border-r border-slate-200' : ''} ${laneIsOpen ? 'bg-white' : 'bg-slate-100/60'}`}
                                      onDragOver={(e) =>
                                        handleDragOver(e, dateKey, staff.id)
                                      }
                                      onDragLeave={() => setDragPreview(null)}
                                      onDrop={(e) =>
                                        void handleDrop(e, dateKey, staff.id)
                                      }
                                    >
                                      {!laneIsOpen && (
                                        <div className="pointer-events-none absolute inset-0 z-10 bg-slate-200/40" />
                                      )}
                                      {dragPreview?.dateKey === dateKey &&
                                      dragPreview?.staffId === staff.id &&
                                      draggingAppointment
                                        ? (() => {
                                            const ghostPlacement =
                                              getAppointmentPlacement(
                                                draggingAppointment,
                                              )
                                            const ghostTop =
                                              ((dragPreview.snappedMinutes -
                                                GRID_START_MINUTES) /
                                                60) *
                                              HOUR_HEIGHT
                                            return (
                                              <div
                                                className="pointer-events-none absolute right-2 left-2 rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-100/60"
                                                style={{
                                                  top: ghostTop + 6,
                                                  height:
                                                    ghostPlacement.height - 8,
                                                }}
                                              />
                                            )
                                          })()
                                        : null}
                                      {HOURS.map((hour) => (
                                        <button
                                          key={`${dateKey}-${staff.id}-${hour}`}
                                          type="button"
                                          className="focus-visible:ring-ring relative z-0 block w-full border-b border-slate-200 text-left transition hover:bg-emerald-50/60 focus-visible:ring-2 focus-visible:outline-none"
                                          style={{ height: HOUR_HEIGHT }}
                                          onClick={(e) => {
                                            setCellMenu({
                                              dateKey,
                                              hour,
                                              x: e.clientX,
                                              y: e.clientY,
                                              staffId: staff.id,
                                            })
                                          }}
                                          title={`Create at ${String(hour).padStart(2, '0')}:00`}
                                          aria-label={`Create on ${dateKey} at ${String(hour).padStart(2, '0')}:00`}
                                        />
                                      ))}
                                      {offHourSegments.map((segment, index) => {
                                        const gridStartMinutes = HOURS[0] * 60
                                        const top =
                                          ((segment.start - gridStartMinutes) /
                                            60) *
                                          HOUR_HEIGHT
                                        const height =
                                          ((segment.end - segment.start) / 60) *
                                          HOUR_HEIGHT
                                        return (
                                          <div
                                            key={`${dateKey}-${staff.id}-off-${index}`}
                                            className="pointer-events-none absolute right-0 left-0 bg-slate-100/80"
                                            style={{ top, height }}
                                          />
                                        )
                                      })}
                                      {dayEvents
                                        .filter(
                                          (event) =>
                                            event.assigned_staff_user_id ===
                                              staff.id ||
                                            (!event.assigned_staff_user_id &&
                                              isFirst),
                                        )
                                        .map((event) => {
                                          const endOverride =
                                            eventResizeSession?.eventId ===
                                              event.id &&
                                            eventResizeLiveEndMinutes != null
                                              ? eventResizeLiveEndMinutes
                                              : null
                                          const placement = getBlockPlacement(
                                            event,
                                            endOverride,
                                          )
                                          const isDraggingThis =
                                            draggingEvent?.id === event.id
                                          return (
                                            <div
                                              key={event.id}
                                              data-event-block
                                              className={`absolute right-2 left-2 flex flex-col overflow-hidden rounded-2xl border text-xs shadow-sm ${getEventTone(event)} ${isDraggingThis ? 'opacity-40' : ''}`}
                                              style={{
                                                top: placement.top + 6,
                                                height: placement.height - 8,
                                              }}
                                            >
                                              {!event.is_all_day && (
                                                <div
                                                  onPointerDown={(e) =>
                                                    handleEventMovePointerDown(
                                                      e,
                                                      event,
                                                    )
                                                  }
                                                  onPointerMove={
                                                    handleEventMovePointerMove
                                                  }
                                                  onPointerUp={(e) =>
                                                    void handleEventMovePointerUp(
                                                      e,
                                                    )
                                                  }
                                                  onPointerCancel={(e) =>
                                                    void handleEventMovePointerUp(
                                                      e,
                                                    )
                                                  }
                                                  style={{
                                                    touchAction: 'none',
                                                  }}
                                                  className="flex shrink-0 cursor-grab touch-none items-center gap-1 border-b border-black/5 bg-black/[0.03] px-2 py-1.5 active:cursor-grabbing"
                                                >
                                                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                                  <span className="text-[10px] font-medium tracking-tight text-slate-600">
                                                    Move
                                                  </span>
                                                </div>
                                              )}
                                              <button
                                                type="button"
                                                className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 text-left"
                                                onClick={() =>
                                                  openEditEvent(event)
                                                }
                                              >
                                                <div className="font-semibold">
                                                  {event.title}
                                                </div>
                                                {event.description ? (
                                                  <div className="mt-1 line-clamp-2 opacity-75">
                                                    {event.description}
                                                  </div>
                                                ) : null}
                                              </button>
                                              {!event.is_all_day && (
                                                <button
                                                  type="button"
                                                  aria-label="Drag to change end time"
                                                  title="Drag to extend or shorten"
                                                  style={{
                                                    touchAction: 'none',
                                                  }}
                                                  className="relative flex h-5 shrink-0 cursor-ns-resize touch-none items-center justify-center rounded-b-[13px] border-t border-black/10 bg-black/[0.08] hover:bg-black/[0.14] sm:h-2.5"
                                                  onPointerDown={(e) =>
                                                    beginEventResize(e, event)
                                                  }
                                                >
                                                  <span
                                                    aria-hidden
                                                    className="block h-0.5 w-8 rounded-full bg-black/30 sm:hidden"
                                                  />
                                                </button>
                                              )}
                                            </div>
                                          )
                                        })}
                                      {isFirst &&
                                      dateKey === todayKey &&
                                      nowMinutes != null &&
                                      nowMinutes >= GRID_START_MINUTES &&
                                      nowMinutes <=
                                        (HOURS[HOURS.length - 1] + 1) * 60 ? (
                                        <div
                                          className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
                                          style={{
                                            top:
                                              ((nowMinutes -
                                                GRID_START_MINUTES) /
                                                60) *
                                              HOUR_HEIGHT,
                                          }}
                                        >
                                          <span className="ml-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-sm" />
                                          <span className="h-px flex-1 bg-red-500/80" />
                                        </div>
                                      ) : null}
                                      {renderApptBlocks(laneAppts)}
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })
                        : displayedDays.map((date) => {
                            const dateKey = formatDateKey(date)
                            const isSunday = date.getDay() === 0
                            if (isSunday) {
                              return (
                                <div
                                  key={dateKey}
                                  className="border-r border-slate-200 bg-slate-100/70"
                                />
                              )
                            }
                            const allDayAppointments =
                              appointmentsByDate.get(dateKey) || []
                            const dayAppointments = staffFilter
                              ? allDayAppointments.filter(
                                  (a) =>
                                    a.assigned_staff_user_id === staffFilter ||
                                    (!a.assigned_staff_user_id &&
                                      staffFilter === staffList[0]?.id),
                                )
                              : allDayAppointments
                            const dayEvents = data.events.filter((event) =>
                              intersectsDay(event, dateKey),
                            )
                            const dayRanges =
                              businessDayRanges.get(date.getDay()) || []
                            const offHourSegments =
                              getOffHourSegmentsForGrid(dayRanges)
                            return (
                              <div
                                key={dateKey}
                                data-date-column={dateKey}
                                data-staff-lane=""
                                className="relative border-r border-slate-200 bg-white"
                                onDragOver={(e) => handleDragOver(e, dateKey)}
                                onDragLeave={() => setDragPreview(null)}
                                onDrop={(e) =>
                                  void handleDrop(e, dateKey, null)
                                }
                              >
                                {dragPreview?.dateKey === dateKey &&
                                draggingAppointment
                                  ? (() => {
                                      const ghostPlacement =
                                        getAppointmentPlacement(
                                          draggingAppointment,
                                        )
                                      const ghostTop =
                                        ((dragPreview.snappedMinutes -
                                          GRID_START_MINUTES) /
                                          60) *
                                        HOUR_HEIGHT
                                      return (
                                        <div
                                          className="pointer-events-none absolute right-2 left-2 rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-100/60"
                                          style={{
                                            top: ghostTop + 6,
                                            height: ghostPlacement.height - 8,
                                          }}
                                        />
                                      )
                                    })()
                                  : null}
                                {HOURS.map((hour) => (
                                  <button
                                    key={`${dateKey}-${hour}`}
                                    type="button"
                                    className="focus-visible:ring-ring relative z-0 block w-full border-b border-slate-200 text-left transition hover:bg-emerald-50/60 focus-visible:ring-2 focus-visible:outline-none"
                                    style={{ height: HOUR_HEIGHT }}
                                    onClick={(e) => {
                                      setCellMenu({
                                        dateKey,
                                        hour,
                                        x: e.clientX,
                                        y: e.clientY,
                                      })
                                    }}
                                    title={`Create at ${String(hour).padStart(2, '0')}:00`}
                                    aria-label={`Create on ${dateKey} at ${String(hour).padStart(2, '0')}:00`}
                                  />
                                ))}
                                {offHourSegments.map((segment, index) => {
                                  const gridStartMinutes = HOURS[0] * 60
                                  const top =
                                    ((segment.start - gridStartMinutes) / 60) *
                                    HOUR_HEIGHT
                                  const height =
                                    ((segment.end - segment.start) / 60) *
                                    HOUR_HEIGHT
                                  return (
                                    <div
                                      key={`${dateKey}-off-${index}`}
                                      className="pointer-events-none absolute right-0 left-0 bg-slate-100/80"
                                      style={{ top, height }}
                                    />
                                  )
                                })}
                                {dayEvents.map((event) => {
                                  const endOverride =
                                    eventResizeSession?.eventId === event.id &&
                                    eventResizeLiveEndMinutes != null
                                      ? eventResizeLiveEndMinutes
                                      : null
                                  const placement = getBlockPlacement(
                                    event,
                                    endOverride,
                                  )
                                  const isDraggingThis =
                                    draggingEvent?.id === event.id
                                  return (
                                    <div
                                      key={event.id}
                                      data-event-block
                                      className={`absolute right-2 left-2 flex flex-col overflow-hidden rounded-2xl border text-xs shadow-sm ${getEventTone(event)} ${isDraggingThis ? 'opacity-40' : ''}`}
                                      style={{
                                        top: placement.top + 6,
                                        height: placement.height - 8,
                                      }}
                                    >
                                      {!event.is_all_day && (
                                        <div
                                          onPointerDown={(e) =>
                                            handleEventMovePointerDown(e, event)
                                          }
                                          onPointerMove={
                                            handleEventMovePointerMove
                                          }
                                          onPointerUp={(e) =>
                                            void handleEventMovePointerUp(e)
                                          }
                                          onPointerCancel={(e) =>
                                            void handleEventMovePointerUp(e)
                                          }
                                          style={{ touchAction: 'none' }}
                                          className="flex shrink-0 cursor-grab touch-none items-center gap-1 border-b border-black/5 bg-black/[0.03] px-2 py-1.5 active:cursor-grabbing"
                                        >
                                          <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                          <span className="text-[10px] font-medium tracking-tight text-slate-600">
                                            Move
                                          </span>
                                        </div>
                                      )}
                                      <button
                                        type="button"
                                        className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 text-left"
                                        onClick={() => openEditEvent(event)}
                                      >
                                        <div className="font-semibold">
                                          {event.title}
                                        </div>
                                        {event.description ? (
                                          <div className="mt-1 line-clamp-2 opacity-75">
                                            {event.description}
                                          </div>
                                        ) : null}
                                      </button>
                                      {!event.is_all_day && (
                                        <button
                                          type="button"
                                          aria-label="Drag to change end time"
                                          title="Drag to extend or shorten"
                                          style={{ touchAction: 'none' }}
                                          className="relative flex h-5 shrink-0 cursor-ns-resize touch-none items-center justify-center rounded-b-[13px] border-t border-black/10 bg-black/[0.08] hover:bg-black/[0.14] sm:h-2.5"
                                          onPointerDown={(e) =>
                                            beginEventResize(e, event)
                                          }
                                        >
                                          <span
                                            aria-hidden
                                            className="block h-0.5 w-8 rounded-full bg-black/30 sm:hidden"
                                          />
                                        </button>
                                      )}
                                    </div>
                                  )
                                })}
                                {dateKey === todayKey &&
                                nowMinutes != null &&
                                nowMinutes >= GRID_START_MINUTES &&
                                nowMinutes <=
                                  (HOURS[HOURS.length - 1] + 1) * 60 ? (
                                  <div
                                    className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
                                    style={{
                                      top:
                                        ((nowMinutes - GRID_START_MINUTES) /
                                          60) *
                                        HOUR_HEIGHT,
                                    }}
                                  >
                                    <span className="ml-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-sm" />
                                    <span className="h-px flex-1 bg-red-500/80" />
                                  </div>
                                ) : null}
                                {renderApptBlocks(dayAppointments)}
                              </div>
                            )
                          })}
                  </div>
                )
              })()}
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur">
          <div className="mb-1 text-sm font-medium tracking-wide text-emerald-400/80 uppercase">
            Appointments
          </div>
          <div className="stat-value stat-glow-emerald mt-2 text-3xl font-bold text-emerald-300">
            {data.appointments.length}
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            Interactive jobs that open into their own detail screen.
          </p>
        </Card>
        <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur">
          <div className="mb-1 text-sm font-medium tracking-wide text-amber-400/80 uppercase">
            Blocked Time
          </div>
          <div className="stat-value stat-glow-amber mt-2 text-3xl font-bold text-amber-300">
            {data.events.length}
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            Vacation, holds, personal events, and any custom schedule block.
          </p>
        </Card>
        <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-medium text-cyan-400/80">
            <CalendarDays className="h-4 w-4" />
            Schedule flow
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            Use the calendar as home, click a job to open it, or start a
            full-screen booking flow from `New Job`.
          </p>
        </Card>
      </div>
    </div>
  )
}
