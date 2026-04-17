'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
  ShieldBan,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type ScheduleView = 'week' | 'day' | 'month'

type Appointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  quoted_total: number
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
  ops_appointment_line_items: Array<{
    id: string
    name_snapshot: string
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
      }
    | {
        id: string
        status: string
        total?: number
        payment_status?: string
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
}

type RecurringFrequencyInfo = {
  frequency: string
  interval_days: number | null
}

type ScheduleResponse = {
  appointments: Appointment[]
  events: CalendarEvent[]
  recurringFrequencyMap?: Record<string, RecurringFrequencyInfo>
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

const HOURS = Array.from({ length: 13 }, (_, index) => 7 + index)
const HOUR_HEIGHT = 84
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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

/** Prefer max of quote, invoice total, or sum of line items (HCP/import may zero one field). */
function calendarDisplayAmount(appointment: Appointment): string {
  const inv = unwrapRelation(appointment.ops_invoices)
  const quoted = Number(appointment.quoted_total || 0)
  const invTotal =
    inv && typeof inv === 'object' && 'total' in inv
      ? Number((inv as { total?: number }).total || 0)
      : 0
  const lineSum = (appointment.ops_appointment_line_items || []).reduce(
    (sum, li) => sum + Number(li.line_total || 0),
    0,
  )
  const n = Math.max(quoted, invTotal, lineSum, 0)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
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
      return 'border-emerald-400 bg-emerald-100'
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
    ? 'border-amber-500/40 bg-amber-500/12'
    : 'border-slate-500/40 bg-slate-500/10'
}

function intersectsDay(event: CalendarEvent, dateKey: string): boolean {
  return event.start_date <= dateKey && event.end_date >= dateKey
}

function getBlockPlacement(event: CalendarEvent) {
  const workdayStart = HOURS[0] * 60
  const workdayEnd = (HOURS[HOURS.length - 1] + 1) * 60
  const startMinutes = event.is_all_day
    ? workdayStart
    : Math.max(parseMinutes(event.start_time), workdayStart)
  const endMinutes = event.is_all_day
    ? workdayEnd
    : Math.min(parseMinutes(event.end_time), workdayEnd)
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

  // Drag-and-drop reschedule state
  const [draggingAppointment, setDraggingAppointment] =
    useState<Appointment | null>(null)
  const [dragPreview, setDragPreview] = useState<{
    dateKey: string
    snappedMinutes: number
  } | null>(null)
  const [pendingNotify, setPendingNotify] = useState<{
    appointmentId: string
    customerName: string
    x: number
    y: number
  } | null>(null)
  const draggingYOffsetRef = useRef<number>(0)
  const didDragRef = useRef<boolean>(false)

  // Touch-swipe navigation (mobile)
  const touchStartXRef = useRef<number>(0)
  const touchStartYRef = useRef<number>(0)
  const touchCurrentXRef = useRef<number>(0)
  const calendarRef = useRef<HTMLDivElement>(null)
  const dayStripRef = useRef<HTMLDivElement>(null)

  // Current-time indicator — updates every minute so the line moves live
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date()
    return n.getHours() * 60 + n.getMinutes()
  })
  const todayKey = formatDateKey(new Date())

  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setNowMinutes(n.getHours() * 60 + n.getMinutes())
    }
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const [blockForm, setBlockForm] = useState({
    title: '',
    description: '',
    start_date: formatDateKey(new Date()),
    end_date: formatDateKey(new Date()),
    start_time: '',
    end_time: '',
    is_all_day: false,
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

  const beginResize = useCallback(
    (e: React.MouseEvent, appointment: Appointment) => {
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
    },
    [],
  )

  useEffect(() => {
    if (!resizeSession) return

    const onMove = (e: MouseEvent) => {
      const dy = e.clientY - resizeSession.grabClientY
      const delta = Math.round(dy / PX_PER_MINUTE / 15) * 15
      const next = Math.max(
        resizeSession.startMinutes + 15,
        resizeSession.originEndMinutes + delta,
      )
      resizeLiveEndRef.current = next
      setResizeLiveEndMinutes(next)
    }

    const onUp = () => {
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
      })()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizeSession, loadSchedule, PX_PER_MINUTE])

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    dateKey: string,
  ) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const rawY = e.clientY - rect.top - draggingYOffsetRef.current
    const rawMinutes = GRID_START_MINUTES + rawY / PX_PER_MINUTE
    const snappedMinutes = snapToMinutes(rawMinutes)
    setDragPreview({ dateKey, snappedMinutes })
  }

  const handleDrop = async (
    e: React.DragEvent<HTMLDivElement>,
    dateKey: string,
  ) => {
    e.preventDefault()
    const appointmentId = e.dataTransfer.getData('appointmentId')
    if (!appointmentId) return

    const rect = e.currentTarget.getBoundingClientRect()
    const rawY = e.clientY - rect.top - draggingYOffsetRef.current
    const rawMinutes = GRID_START_MINUTES + rawY / PX_PER_MINUTE
    const snappedMinutes = snapToMinutes(rawMinutes)
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
          x: e.clientX,
          y: e.clientY,
        })
      }
    } catch {
      setError('Failed to reschedule job')
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

  return (
    <div className="space-y-6">
      {/* Notify customer popup — anchored near the drop point */}
      {pendingNotify ? (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: Math.min(pendingNotify.x, window.innerWidth - 340),
            top: pendingNotify.y + 12,
          }}
        >
          <Card className="border-border/60 bg-card/95 pointer-events-auto flex items-center gap-4 rounded-2xl border p-4 shadow-xl backdrop-blur">
            <p className="text-sm font-medium">
              Notify{' '}
              <span className="font-semibold">
                {pendingNotify.customerName}
              </span>{' '}
              of the new time?
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  void sendRescheduleNotification(pendingNotify.appointmentId)
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
        </div>
      ) : null}

      <Card className="border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
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
            <div className="min-w-48 text-sm font-semibold">{viewLabel}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="border-border flex rounded-xl border p-1">
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
            <Button asChild size="sm" className="gap-2">
              <Link href="/admin/operations/new-job">
                <Plus className="h-4 w-4" />
                New Job
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => setShowBlockForm((current) => !current)}
            >
              <ShieldBan className="h-4 w-4" />
              Block Time
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => setShowBusinessHours((current) => !current)}
            >
              Business Hours
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
        </div>

        {Object.keys(recurringFreqMap).length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span className="font-medium">Recurring:</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-violet-400 bg-violet-100" />
              Weekly
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-sky-400 bg-sky-100" />
              Biweekly
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-teal-400 bg-teal-100" />
              Monthly
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-orange-400 bg-orange-100" />
              90-day
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-rose-400 bg-rose-100" />
              180-day
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-fuchsia-400 bg-fuchsia-100" />
              Other
            </span>
          </div>
        )}

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
                      <div
                        key={event.id}
                        className={`rounded-xl border px-2 py-1 text-xs ${getEventTone(event)}`}
                      >
                        {event.title}
                      </div>
                    ))}
                    {dayAppointments.slice(0, 3).map((appointment) => {
                      const customer = unwrapRelation(appointment.ops_customers)
                      const invoice = unwrapRelation(appointment.ops_invoices)
                      const href = invoice?.id
                        ? `/admin/operations/invoices/${invoice.id}`
                        : appointment.recurring_template_id
                          ? `/admin/operations/recurring/visit/${appointment.id}`
                          : `/admin/operations/appointments/${appointment.id}`
                      const tone = appointment.recurring_template_id
                        ? (getRecurringTone(
                            recurringFreqMap[appointment.recurring_template_id],
                          ) ?? getStatusTone(appointment.status))
                        : getStatusTone(appointment.status)
                      return (
                        <Link
                          key={appointment.id}
                          href={href}
                          className={`text-foreground block rounded-xl border px-2 py-2 text-xs transition hover:shadow-sm ${tone}`}
                        >
                          <div className="flex items-center gap-1 font-medium">
                            {appointment.recurring_template_id && (
                              <Repeat className="h-3 w-3 shrink-0 text-blue-500" />
                            )}
                            {appointment.start_time.slice(0, 5)}{' '}
                            {customer?.full_name}
                          </div>
                          <div className="text-muted-foreground mt-1">
                            {/* Keep service context visible in compact month tiles */}
                            {appointment.ops_appointment_line_items[0]
                              ?.name_snapshot || 'Service'}
                          </div>
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
            <div className={view === 'day' ? '' : 'overflow-x-auto'}>
              <div
                className={view === 'day' ? 'grid' : 'grid min-w-[900px]'}
                style={{
                  gridTemplateColumns:
                    view === 'day'
                      ? '72px minmax(0, 1fr)'
                      : '72px repeat(7, minmax(180px, 1fr))',
                }}
              >
                <div className="border-r border-b border-slate-200 bg-slate-100 p-3" />
                {displayedDays.map((date) => (
                  <div
                    key={formatDateKey(date)}
                    className="border-b border-slate-200 bg-slate-100 p-3"
                  >
                    <div className="text-xs font-medium tracking-[0.2em] text-slate-500 uppercase">
                      {WEEKDAY_LABELS[date.getDay()]}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-700">
                      {date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                ))}

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

                {displayedDays.map((date) => {
                  const dateKey = formatDateKey(date)
                  const dayAppointments = appointmentsByDate.get(dateKey) || []
                  const dayEvents = data.events.filter((event) =>
                    intersectsDay(event, dateKey),
                  )
                  const dayRanges = businessDayRanges.get(date.getDay()) || []
                  const offHourSegments = getOffHourSegmentsForGrid(dayRanges)

                  return (
                    <div
                      key={dateKey}
                      className="relative border-r border-slate-200 bg-white"
                      onDragOver={(e) => handleDragOver(e, dateKey)}
                      onDragLeave={() => setDragPreview(null)}
                      onDrop={(e) => void handleDrop(e, dateKey)}
                    >
                      {/* Drop ghost preview */}
                      {dragPreview?.dateKey === dateKey && draggingAppointment
                        ? (() => {
                            const ghostPlacement =
                              getAppointmentPlacement(draggingAppointment)
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
                          onClick={() => openNewJobAt(dateKey, hour)}
                          title={`Create job at ${String(hour).padStart(2, '0')}:00`}
                          aria-label={`Create job on ${dateKey} at ${String(hour).padStart(2, '0')}:00`}
                        />
                      ))}

                      {offHourSegments.map((segment, index) => {
                        const gridStartMinutes = HOURS[0] * 60
                        const top =
                          ((segment.start - gridStartMinutes) / 60) *
                          HOUR_HEIGHT
                        const height =
                          ((segment.end - segment.start) / 60) * HOUR_HEIGHT
                        return (
                          <div
                            key={`${dateKey}-off-${index}`}
                            className="pointer-events-none absolute right-0 left-0 bg-slate-100/80"
                            style={{ top, height }}
                          />
                        )
                      })}

                      {dayEvents.map((event) => {
                        const placement = getBlockPlacement(event)
                        return (
                          <div
                            key={event.id}
                            className={`absolute right-2 left-2 rounded-2xl border p-2 text-xs shadow-sm ${getEventTone(event)}`}
                            style={{
                              top: placement.top + 6,
                              height: placement.height - 8,
                            }}
                          >
                            <div className="font-semibold">{event.title}</div>
                            {event.description ? (
                              <div className="text-muted-foreground mt-1 line-clamp-2">
                                {event.description}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}

                      {/* Current-time indicator — only on today's column,
                          only while the clock is within the visible hour range */}
                      {dateKey === todayKey &&
                      nowMinutes >= GRID_START_MINUTES &&
                      nowMinutes <= (HOURS[HOURS.length - 1] + 1) * 60 ? (
                        <div
                          className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
                          style={{
                            top:
                              ((nowMinutes - GRID_START_MINUTES) / 60) *
                              HOUR_HEIGHT,
                          }}
                        >
                          {/* Dot on the left edge */}
                          <span className="ml-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-sm" />
                          {/* Line spanning the rest of the column */}
                          <span className="h-px flex-1 bg-red-500/80" />
                        </div>
                      ) : null}

                      {(() => {
                        const overlapCols =
                          computeOverlapColumns(dayAppointments)
                        return dayAppointments.map((appointment) => {
                          const customer = unwrapRelation(
                            appointment.ops_customers,
                          )
                          const invoice = unwrapRelation(
                            appointment.ops_invoices,
                          )
                          const endOverride =
                            resizeSession?.appointmentId === appointment.id &&
                            resizeLiveEndMinutes != null
                              ? resizeLiveEndMinutes
                              : null
                          const placement = getAppointmentPlacement(
                            appointment,
                            endOverride,
                          )
                          const href = invoice?.id
                            ? `/admin/operations/invoices/${invoice.id}`
                            : appointment.recurring_template_id
                              ? `/admin/operations/recurring/visit/${appointment.id}`
                              : `/admin/operations/appointments/${appointment.id}`
                          const isDragging =
                            draggingAppointment?.id === appointment.id
                          const oc = overlapCols.get(appointment.id) ?? {
                            col: 0,
                            totalCols: 1,
                          }
                          const blockTone = appointment.recurring_template_id
                            ? (getRecurringTone(
                                recurringFreqMap[
                                  appointment.recurring_template_id
                                ],
                              ) ?? getStatusTone(appointment.status))
                            : getStatusTone(appointment.status)
                          return (
                            <div
                              key={appointment.id}
                              data-appointment-block
                              className={`absolute flex flex-col overflow-hidden rounded-2xl border text-xs text-slate-900 shadow-sm transition ${blockTone} ${isDragging ? 'opacity-40' : 'hover:shadow-md'}`}
                              style={{
                                top: placement.top + 6,
                                height: placement.height - 8,
                                ...overlapStyle(oc.col, oc.totalCols),
                              }}
                            >
                              <div
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    'appointmentId',
                                    appointment.id,
                                  )
                                  e.dataTransfer.effectAllowed = 'move'
                                  const block = (
                                    e.currentTarget as HTMLElement
                                  ).closest(
                                    '[data-appointment-block]',
                                  ) as HTMLElement | null
                                  if (block) {
                                    draggingYOffsetRef.current =
                                      e.clientY -
                                      block.getBoundingClientRect().top
                                  } else {
                                    draggingYOffsetRef.current =
                                      e.nativeEvent.offsetY
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
                                className="flex shrink-0 cursor-grab items-center gap-1 border-b border-black/5 bg-black/[0.03] px-2 py-1 active:cursor-grabbing"
                                title="Drag to move start time"
                              >
                                <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                <span className="text-[10px] font-medium tracking-tight text-slate-600">
                                  Move
                                </span>
                              </div>
                              <Link
                                href={href}
                                className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 pt-1"
                                onClick={(e) => {
                                  if (didDragRef.current) e.preventDefault()
                                }}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="line-clamp-1 flex items-center gap-1.5 leading-tight font-semibold">
                                    {appointment.recurring_template_id && (
                                      <Repeat className="h-3 w-3 shrink-0 text-blue-500" />
                                    )}
                                    {customer?.business_name ||
                                      customer?.full_name ||
                                      'Customer'}
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className="border-slate-300 bg-white/70 text-slate-700 capitalize"
                                  >
                                    {appointment.status.replaceAll('_', ' ')}
                                  </Badge>
                                </div>
                                {appointment.recurring_template_id && (
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
                                <div className="mt-2 line-clamp-2 text-slate-800">
                                  {appointment.ops_appointment_line_items
                                    .map((item) => item.name_snapshot)
                                    .join(', ')}
                                </div>
                                <div
                                  className={`mt-auto pt-2 text-right font-semibold tabular-nums ${
                                    appointment.status === 'completed'
                                      ? 'text-slate-600'
                                      : 'text-slate-800'
                                  }`}
                                >
                                  ${calendarDisplayAmount(appointment)}
                                </div>
                              </Link>
                              <button
                                type="button"
                                aria-label="Drag to change end time"
                                title="Drag to extend or shorten"
                                className="h-2.5 shrink-0 cursor-ns-resize rounded-b-[13px] border-t border-black/10 bg-black/[0.06] hover:bg-black/12"
                                onMouseDown={(e) => beginResize(e, appointment)}
                              />
                            </div>
                          )
                        })
                      })()}
                    </div>
                  )
                })}
              </div>
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
