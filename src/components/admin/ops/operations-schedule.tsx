'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
  Ruler,
  ShieldBan,
  Trash2,
  Truck,
  Droplets,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  appointmentDisplayRevenue,
  appointmentScheduleRevenue,
} from '@/lib/ops/utilization-metrics'
import { isWarrantyAppointment } from '@/lib/ops/warranty-appointment'

import type {
  Appointment,
  AvailabilityTemplate,
  BlockFormState,
  BusinessHoursRow,
  CalendarEvent,
  DailyAvailability,
  DragPreview,
  EditEventFormState,
  QueuedVisit,
  RecurringFrequencyInfo,
  ScheduleResponse,
  ScheduleView,
  StaffMember,
} from './operations-schedule-types'
import {
  addDays,
  addMonths,
  buildMonthGrid,
  buildWeekDays,
  businessRowsToTemplates,
  DEFAULT_BUSINESS_HOURS_ROWS,
  EARLY_START_HOUR,
  END_HOUR,
  formatDateKey,
  formatPendingNotifyWhen,
  formatScheduleAmount,
  getAppointmentPlacement,
  getBlockPlacement,
  getBusinessDayRanges,
  getEstimateTone,
  getEventTone,
  getOffHourSegmentsForGrid,
  getRangeForView,
  getRecurringTone,
  getScheduleCardSources,
  getStatusTone,
  getViewLabel,
  HOUR_HEIGHT,
  intersectsDay,
  minutesToDbTime,
  parseMinutes,
  STAFF_LANE_COLORS,
  STANDARD_START_HOUR,
  startOfMonth,
  templatesToBusinessRows,
  unwrapRelation,
  WEEKDAY_LABELS,
} from './operations-schedule-utils'
import {
  AppointmentBlocks,
  recurringLineItemDescriptionBoxes,
  tomorrowFillBadge,
  WeekendSliver,
} from './operations-schedule-appointment-blocks'
import {
  BlockTimeForm,
  BusinessHoursForm,
  DatePickerDialog,
  EditEventDialog,
} from './operations-schedule-editors'
export function OperationsSchedule() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [view, setView] = useState<ScheduleView>(() => {
    const requested = searchParams.get('view')
    return requested === 'day' || requested === 'month' ? requested : 'week'
  })
  const [showEarlyHours, setShowEarlyHours] = useState(false)
  const gridStartHour = showEarlyHours ? EARLY_START_HOUR : STANDARD_START_HOUR
  const hours = useMemo(
    () =>
      Array.from(
        { length: END_HOUR - gridStartHour },
        (_, index) => gridStartHour + index,
      ),
    [gridStartHour],
  )
  const focusedAppointmentId = searchParams.get('appointment')
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
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [dailyAvailability, setDailyAvailability] = useState<
    DailyAvailability[]
  >([])
  const [staffFilter, setStaffFilter] = useState<string | null>(null)
  /**
   * Sunday is collapsed because we do not sell it, not because nothing happens
   * on it. Drying runs through the weekend, and when a monitor lands there it
   * needs the same column as any other day — both techs' lanes included, since
   * either of them might take it. So it opens, rather than being a sliver that
   * has to be worked around.
   */
  const [sundayOpen, setSundayOpen] = useState(false)
  const [saturdayOpen, setSaturdayOpen] = useState(false)
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
  const [editEventForm, setEditEventForm] = useState<EditEventFormState>({
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
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [pendingNotify, setPendingNotify] = useState<{
    appointmentId: string
    newDateKey: string
    newTime: string
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

  const [blockForm, setBlockForm] = useState<BlockFormState>({
    title: '',
    description: '',
    start_date: formatDateKey(new Date()),
    end_date: formatDateKey(new Date()),
    start_time: '',
    end_time: '',
    is_all_day: false,
    assigned_staff_user_id: null,
  })

  // ── Unscheduled restoration visits (the tray) ──────────────────────
  // Monitor visits are never auto-dropped onto the calendar: they have to be
  // fitted around cleaning work. On a phone, dragging can only ever reach the
  // day already on screen, so a card is ARMED by tapping it and then placed by
  // tapping a slot — which works across days, weeks, and month view.
  const [queuedVisits, setQueuedVisits] = useState<QueuedVisit[]>([])
  const [armedVisit, setArmedVisit] = useState<QueuedVisit | null>(null)
  const [deletingQueuedVisitId, setDeletingQueuedVisitId] = useState<
    string | null
  >(null)

  const loadQueuedVisits = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/ops/restoration/projects', {
        cache: 'no-store',
      })
      if (!response.ok) return
      const result = await response.json()
      const rows: QueuedVisit[] = []
      for (const project of result.projects ?? []) {
        if (project.status !== 'active') continue
        const customer = Array.isArray(project.ops_customers)
          ? project.ops_customers[0]
          : project.ops_customers
        for (const queued of project.restoration_visit_queue ?? []) {
          if (queued.status !== 'queued') continue
          const address = Array.isArray(project.ops_service_addresses)
            ? project.ops_service_addresses[0]
            : project.ops_service_addresses
          rows.push({
            id: queued.id,
            source: 'restoration',
            projectId: project.id,
            label:
              customer?.business_name || customer?.full_name || 'Water loss',
            place: address
              ? [address.street_1, address.city].filter(Boolean).join(', ')
              : '',
            visitType: queued.visit_type,
            sequence: queued.visit_sequence,
          })
        }
      }
      // Parked jobs — cancelled off the schedule but not given up on.
      try {
        const parkedResponse = await fetch('/api/admin/ops/schedule/parked', {
          cache: 'no-store',
        })
        if (parkedResponse.ok) {
          const parked = await parkedResponse.json()
          for (const job of parked.appointments ?? []) {
            const customer = Array.isArray(job.ops_customers)
              ? job.ops_customers[0]
              : job.ops_customers
            const address = Array.isArray(job.ops_service_addresses)
              ? job.ops_service_addresses[0]
              : job.ops_service_addresses
            rows.push({
              id: job.id,
              source: 'appointment',
              projectId: 'parked',
              label: customer?.business_name || customer?.full_name || 'Job',
              place: address
                ? [address.street_1, address.city].filter(Boolean).join(', ')
                : '',
              visitType: 'needs a date',
              sequence: null,
              durationMinutes: job.duration_minutes ?? 120,
            })
          }
        }
      } catch {
        // The tray is additive; a failure here must not break the calendar.
      }

      // Group by loss first, then visit order, so one job's visits sit together.
      rows.sort(
        (a, b) =>
          a.projectId.localeCompare(b.projectId) ||
          (a.sequence ?? 0) - (b.sequence ?? 0),
      )
      setQueuedVisits(rows)
    } catch {
      // The tray is additive — a failure here must not break the calendar.
    }
  }, [])

  useEffect(() => {
    void loadQueuedVisits()
  }, [loadQueuedVisits])

  const deleteQueuedVisit = async (visit: QueuedVisit) => {
    setDeletingQueuedVisitId(visit.id)
    setError(null)
    try {
      const url =
        visit.source === 'appointment'
          ? `/api/admin/ops/appointments/${visit.id}?notify_customer=false`
          : `/api/admin/ops/restoration/queue/${visit.id}`
      const response = await fetch(url, { method: 'DELETE' })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || 'Failed to delete unscheduled job')
      }
      setQueuedVisits((current) =>
        current.filter((queued) => queued.id !== visit.id),
      )
      setArmedVisit((current) => (current?.id === visit.id ? null : current))
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Failed to delete unscheduled job',
      )
    } finally {
      setDeletingQueuedVisitId(null)
    }
  }

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
        // Parked jobs live in the tray, not on the grid — showing them in both
        // places would make it look like the job is still scheduled.
        appointments: (scheduleResult.appointments || []).filter(
          (appointment: Appointment) => !appointment.parked_at,
        ),
        events: scheduleResult.events || [],
      })
      setStaffList(scheduleResult.staff || [])
      if (scheduleResult.currentUserId)
        setCurrentUserId(scheduleResult.currentUserId)
      if (scheduleResult.currentUserRole)
        setCurrentUserRole(scheduleResult.currentUserRole)
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

  const placeQueuedVisit = useCallback(
    async (
      queueId: string,
      dateKey: string,
      hour: number,
      staffId: string | null,
    ) => {
      try {
        const card = queuedVisits.find((v) => v.id === queueId)
        const startTime = `${String(hour).padStart(2, '0')}:00`

        // A parked job goes back through the appointment endpoint so it keeps
        // its invoice and line items; a queued monitor visit gets created fresh.
        const response =
          card?.source === 'appointment'
            ? await fetch(`/api/admin/ops/appointments/${queueId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  appointment_date: dateKey,
                  start_time: startTime,
                  end_time: minutesToDbTime(
                    hour * 60 + (card.durationMinutes ?? 120),
                  ),
                  status: 'booked',
                  assigned_staff_user_id: staffId,
                }),
              })
            : await fetch(
                `/api/admin/ops/restoration/queue/${queueId}/schedule`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    appointment_date: dateKey,
                    start_time: startTime,
                    assigned_staff_user_id: staffId,
                  }),
                },
              )
        if (!response.ok) {
          const result = await response.json().catch(() => ({}))
          setError(result.error || 'Could not place that visit')
          return false
        }
        await Promise.all([loadSchedule(), loadQueuedVisits()])
        return true
      } catch {
        setError('Could not place that visit')
        return false
      }
    },
    [loadQueuedVisits, loadSchedule, queuedVisits],
  )

  const placeArmedVisit = useCallback(
    async (dateKey: string, hour: number, staffId: string | null) => {
      if (!armedVisit) return
      const visit = armedVisit
      setArmedVisit(null)
      const placed = await placeQueuedVisit(visit.id, dateKey, hour, staffId)
      if (!placed) setArmedVisit(visit)
    },
    [armedVisit, placeQueuedVisit],
  )

  /** An armed tray card claims the tap; otherwise the normal create menu opens. */
  const handleCellTap = (
    dateKey: string,
    hour: number,
    e: React.MouseEvent,
    staffId: string | null,
  ) => {
    if (armedVisit) {
      void placeArmedVisit(dateKey, hour, staffId)
      return
    }
    setCellMenu({ dateKey, hour, x: e.clientX, y: e.clientY, staffId })
  }

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

  /**
   * What actually draws on the calendar grid. Subcontracted visits are billed
   * revenue but no truck of ours goes out, so they stay out of the lanes (and
   * surface as the week-header chip instead) while still counting in totals.
   */
  const gridAppointmentsByDate = useMemo(() => {
    const grouped = new Map<string, Appointment[]>()
    for (const [dateKey, appts] of appointmentsByDate) {
      grouped.set(
        dateKey,
        appts.filter((appointment) => !appointment.is_subcontracted),
      )
    }
    return grouped
  }, [appointmentsByDate])

  /**
   * Subcontracted visits worth surfacing above the grid: the ones inside the
   * range being viewed, plus any that are past-due and still open.
   *
   * The overdue carve-out matters because these run a few times a year. Without
   * it a missed week means the visit is never closed out, never reaches
   * Month-End Billing, and nothing anywhere surfaces it — batch billing only
   * gathers *completed* visits. Overdue ones follow you to whatever week you
   * are looking at so they cannot scroll out of sight.
   */
  const subcontractedInView = useMemo(() => {
    const todayKeyLocal = formatDateKey(new Date())
    const inRange =
      view === 'month'
        ? data.appointments.filter((a) => a.is_subcontracted)
        : displayedDays.flatMap((day) =>
            (appointmentsByDate.get(formatDateKey(day)) || []).filter(
              (a) => a.is_subcontracted,
            ),
          )

    const overdue = [
      ...(data.overdueSubcontracted || []),
      ...data.appointments.filter(
        (a) =>
          a.is_subcontracted &&
          a.appointment_date < todayKeyLocal &&
          a.status !== 'completed' &&
          a.status !== 'cancelled',
      ),
    ]

    const seen = new Set<string>()
    return [...overdue, ...inRange]
      .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
      .sort((a, b) => a.appointment_date.localeCompare(b.appointment_date))
  }, [
    view,
    data.appointments,
    data.overdueSubcontracted,
    displayedDays,
    appointmentsByDate,
  ])

  const monthGrid = useMemo(() => buildMonthGrid(anchorDate), [anchorDate])
  const viewLabel = getViewLabel(view, anchorDate)
  const businessDayRanges = useMemo(
    () => getBusinessDayRanges(availabilityTemplates),
    [availabilityTemplates],
  )

  const myStaff = useMemo(
    () =>
      staffList.find((staff) => staff.user_id === currentUserId) ??
      staffList[0] ??
      null,
    [currentUserId, staffList],
  )

  const selectedDateKey = formatDateKey(anchorDate)
  const selectedDayAppointments =
    gridAppointmentsByDate.get(selectedDateKey) || []
  const teamDayTotal = selectedDayAppointments.reduce(
    (sum, appointment) => sum + appointmentScheduleRevenue(appointment),
    0,
  )
  const myDayTotal = myStaff
    ? selectedDayAppointments
        .filter(
          (appointment) =>
            appointment.assigned_staff_user_id === myStaff.id ||
            (!appointment.assigned_staff_user_id &&
              myStaff.id === staffList[0]?.id),
        )
        .reduce(
          (sum, appointment) => sum + appointmentScheduleRevenue(appointment),
          0,
        )
    : 0

  const weeklyTotal = useMemo(() => {
    if (view === 'month') return 0
    const weekAppointments = buildWeekDays(anchorDate).flatMap((day) => {
      const dateKey = formatDateKey(day)
      return gridAppointmentsByDate.get(dateKey) || []
    })
    return weekAppointments.reduce(
      (sum, appt) => sum + appointmentScheduleRevenue(appt),
      0,
    )
  }, [anchorDate, view, gridAppointmentsByDate])

  const visibleAppointmentCount =
    view === 'month'
      ? data.appointments.filter((a) => !a.is_subcontracted).length
      : displayedDays.reduce(
          (count, day) =>
            count +
            (gridAppointmentsByDate.get(formatDateKey(day)) || []).length,
          0,
        )
  const visibleEventCount =
    view === 'month'
      ? data.events.length
      : data.events.filter((event) =>
          displayedDays.some((day) => intersectsDay(event, formatDateKey(day))),
        ).length
  const canScheduleCommercialEstimate =
    currentUserRole === 'admin' ||
    currentUserRole === 'owner' ||
    currentUserRole === 'dispatcher'

  useEffect(() => {
    if (!focusedAppointmentId || loading) return
    const frame = window.requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(
        `[data-appointment-id="${CSS.escape(focusedAppointmentId)}"]`,
      )
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusedAppointmentId, loading, data.appointments])

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

  const moveRange = useCallback(
    (direction: 'prev' | 'next') => {
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
    },
    [view],
  )

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

  const openCommercialEstimateAt = (
    dateKey: string,
    hour: number,
    staffId?: string | null,
  ) => {
    const params = new URLSearchParams({
      date: dateKey,
      time: `${String(hour).padStart(2, '0')}:00`,
    })
    if (staffId) params.set('staff', staffId)
    router.push(`/admin/operations/estimates/new?${params}`)
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
  const GRID_START_MINUTES = gridStartHour * 60

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
    minDurationMinutes: number
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
        minDurationMinutes: isWarrantyAppointment(appointment) ? 60 : 15,
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
        resizeSession.startMinutes + resizeSession.minDurationMinutes,
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
    if (calEvent.is_all_day || calEvent.start_date !== calEvent.end_date) return
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
      if (calEvent.is_all_day || calEvent.start_date !== calEvent.end_date)
        return
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
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(result.error || 'Failed to reschedule job')
        return
      }
      await loadSchedule()

      // Ask about notifying the customer no matter where the card came from.
      // Prefer the row the server just saved; fall back to what we had loaded.
      const moved =
        data.appointments.find((a) => a.id === appointmentId) ??
        (result.appointment as Appointment | undefined)
      const customer = moved ? unwrapRelation(moved.ops_customers) : null
      const customerName =
        customer?.business_name || customer?.full_name || 'Customer'
      setPendingNotify({
        appointmentId,
        customerName,
        newDateKey: dateKey,
        newTime,
        x: clientX,
        y: clientY,
      })
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

    // A queued monitor visit dragged out of the tray: place it rather than move
    // an existing appointment.
    const queuedVisitId = e.dataTransfer.getData('queuedVisitId')
    if (queuedVisitId) {
      const rect = e.currentTarget.getBoundingClientRect()
      const rawY = e.clientY - rect.top
      const snapped = snapToMinutes(GRID_START_MINUTES + rawY / PX_PER_MINUTE)
      await placeQueuedVisit(
        queuedVisitId,
        dateKey,
        Math.floor(snapped / 60),
        staffId ?? null,
      )
      return
    }

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

  const renderApptBlocks = (appointments: Appointment[]) => (
    <AppointmentBlocks
      appointments={appointments}
      resizeSession={resizeSession}
      resizeLiveEndMinutes={resizeLiveEndMinutes}
      draggingAppointment={draggingAppointment}
      recurringFrequencyMap={recurringFreqMap}
      pointerDragging={pointerDragging}
      isMobile={isMobile}
      view={view}
      staffList={staffList}
      reassigningAppointmentId={reassigningAppointmentId}
      statusActionAppointmentId={statusActionAppointmentId}
      focusedAppointmentId={focusedAppointmentId}
      gridStartHour={gridStartHour}
      draggingYOffsetRef={draggingYOffsetRef}
      didDragRef={didDragRef}
      setDraggingAppointment={setDraggingAppointment}
      setDragPreview={setDragPreview}
      onMovePointerDown={handleMovePointerDown}
      onMovePointerMove={handleMovePointerMove}
      onMovePointerUp={handleMovePointerUp}
      onMobileStaffReassignment={handleMobileStaffReassignment}
      onOpenStatusAction={openStatusActionPopover}
      onBeginResize={beginResize}
    />
  )

  return (
    <div className="space-y-6">
      {/* Notify customer prompt — pinned to the bottom of the viewport so it
          is always on screen no matter where the card was dropped or how the
          calendar is scrolled. Stays until answered. */}
      {pendingNotify && typeof document !== 'undefined'
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[240] flex justify-center px-3 sm:bottom-6">
              <Card className="border-primary/40 bg-card/95 pointer-events-auto flex w-full max-w-lg flex-col items-stretch gap-3 rounded-2xl border-2 p-4 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:gap-4">
                <p className="min-w-0 flex-1 text-sm font-medium">
                  Text and email{' '}
                  <span className="font-semibold">
                    {pendingNotify.customerName}
                  </span>{' '}
                  the new time,{' '}
                  <span className="font-semibold">
                    {formatPendingNotifyWhen(
                      pendingNotify.newDateKey,
                      pendingNotify.newTime,
                    )}
                  </span>
                  ?
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
                    Send
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
              top: Math.min(cellMenu.y, window.innerHeight - 210),
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
              {canScheduleCommercialEstimate ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="justify-start gap-2 text-amber-800 hover:bg-amber-50 hover:text-amber-900"
                  onClick={() => {
                    openCommercialEstimateAt(
                      cellMenu.dateKey,
                      cellMenu.hour,
                      cellMenu.staffId,
                    )
                    setCellMenu(null)
                  }}
                >
                  <Ruler className="h-3.5 w-3.5" />
                  Commercial estimate at this time
                </Button>
              ) : null}
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

          {view !== 'month' ? (
            <button
              type="button"
              role="switch"
              aria-checked={showEarlyHours}
              aria-label="Show schedule from 7 AM"
              onClick={() => setShowEarlyHours((current) => !current)}
              className="border-border ml-1 flex h-9 items-center gap-2 rounded-xl border bg-white/70 px-3 text-sm font-medium text-slate-700 transition hover:bg-white"
            >
              <span>7 AM start</span>
              <span
                aria-hidden
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${showEarlyHours ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${showEarlyHours ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                />
              </span>
            </button>
          ) : null}

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
          {canScheduleCommercialEstimate ? (
            <Button
              asChild
              variant="outline"
              className="h-11 gap-2 rounded-xl border-amber-300 bg-amber-50/70 px-4 font-semibold text-amber-900 hover:bg-amber-100 hover:text-amber-950"
            >
              <Link href="/admin/operations/estimates/new">
                <Ruler className="h-5 w-5 text-amber-600" />
                Commercial Estimate
              </Link>
            </Button>
          ) : null}
          <Button
            asChild
            variant="outline"
            className="h-11 gap-2 rounded-xl px-4 font-semibold"
          >
            <Link href="/admin/operations/restoration/new">
              <Droplets className="h-5 w-5 text-sky-600" />
              Water Loss
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

        {queuedVisits.length > 0 ? (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-sky-900 uppercase">
                Unscheduled
                {(() => {
                  const losses = new Set(queuedVisits.map((v) => v.projectId))
                    .size
                  return losses > 1 ? ` · ${losses} losses` : ''
                })()}
              </p>
              {armedVisit ? (
                <button
                  type="button"
                  className="text-xs font-medium text-sky-800 underline"
                  onClick={() => setArmedVisit(null)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
            {!armedVisit ? (
              <p className="mb-2 text-xs text-sky-900/70">
                Drag one onto the calendar, or tap it and then tap a slot.
              </p>
            ) : null}
            {armedVisit ? (
              <p className="mb-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white">
                Placing: {armedVisit.label}
                {armedVisit.place ? ` (${armedVisit.place})` : ''} ·{' '}
                {armedVisit.visitType}
                {armedVisit.sequence ? ` ${armedVisit.sequence}` : ''} — tap a
                slot
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {queuedVisits.map((visit) => (
                <div
                  key={visit.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('queuedVisitId', visit.id)
                    e.dataTransfer.effectAllowed = 'move'
                    // A tray card is grabbed at its own top-left, not partway
                    // down an existing block, so clear the carried offset or
                    // the drop preview sits an hour off.
                    draggingYOffsetRef.current = 0
                    // Clear any armed card so a drag and a tap cannot both fire.
                    setArmedVisit(null)
                  }}
                  className={`flex overflow-hidden rounded-lg border text-sm transition ${
                    armedVisit?.id === visit.id
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-sky-300 bg-white text-slate-800 hover:bg-sky-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setArmedVisit((current) =>
                        current?.id === visit.id ? null : visit,
                      )
                    }
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <span className="font-medium">{visit.label}</span>
                    {visit.place ? (
                      <span className="block text-xs opacity-70">
                        {visit.place}
                      </span>
                    ) : null}
                    <span className="block text-xs opacity-80">
                      {visit.visitType}
                      {visit.sequence ? ` ${visit.sequence}` : ''} · 1 hr
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${visit.label} from unscheduled jobs`}
                    disabled={deletingQueuedVisitId === visit.id}
                    onClick={() => void deleteQueuedVisit(visit)}
                    className={`flex min-h-11 w-11 shrink-0 items-center justify-center border-l transition disabled:cursor-wait disabled:opacity-60 ${
                      armedVisit?.id === visit.id
                        ? 'border-white/30 text-white hover:bg-white/15'
                        : 'border-sky-200 text-red-600 hover:bg-red-50 hover:text-red-700'
                    }`}
                  >
                    {deletingQueuedVisitId === visit.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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

          <DatePickerDialog
            open={datePickerOpen}
            pickerMonth={pickerMonth}
            anchorDate={anchorDate}
            todayKey={todayKey}
            setPickerMonth={setPickerMonth}
            onSelectDate={(date) => {
              setAnchorDate(date)
              setDatePickerOpen(false)
            }}
            onClose={closeDatePicker}
            onToday={(date) => {
              setAnchorDate(date)
              setPickerMonth(startOfMonth(date))
              setDatePickerOpen(false)
            }}
          />
        </div>

        <BlockTimeForm
          open={showBlockForm}
          form={blockForm}
          saving={saving}
          setForm={setBlockForm}
          onSubmit={handleBlockSubmit}
          onCancel={() => setShowBlockForm(false)}
        />

        <EditEventDialog
          event={editingEvent}
          form={editEventForm}
          saving={editEventSaving}
          setForm={setEditEventForm}
          onSubmit={handleUpdateEvent}
          onClose={() => setEditingEvent(null)}
          onDelete={(id) => void handleDeleteEvent(id)}
        />

        <BusinessHoursForm
          open={showBusinessHours}
          rows={businessHoursRows}
          saving={businessHoursSaving}
          setRows={setBusinessHoursRows}
          onSubmit={saveBusinessHours}
        />
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

      {view === 'day' && isMobile ? (
        <Card className="grid grid-cols-3 divide-x divide-slate-200 overflow-hidden border-emerald-500/25 bg-white shadow-sm">
          <div className="min-w-0 bg-emerald-50/70 px-2 py-3 text-center">
            <span className="block text-[9px] font-semibold tracking-wider text-emerald-700 uppercase">
              Team Day
            </span>
            <span className="mt-1 block text-sm font-bold whitespace-nowrap text-emerald-900 tabular-nums">
              {formatScheduleAmount(teamDayTotal)}
            </span>
          </div>
          <div className="min-w-0 bg-sky-50/70 px-2 py-3 text-center">
            <span className="block text-[9px] font-semibold tracking-wider text-sky-700 uppercase">
              My Day
            </span>
            <span className="mt-1 block text-sm font-bold whitespace-nowrap text-sky-900 tabular-nums">
              {formatScheduleAmount(myDayTotal)}
            </span>
          </div>
          <div className="min-w-0 bg-violet-50/70 px-2 py-3 text-center">
            <span className="block text-[9px] font-semibold tracking-wider text-violet-700 uppercase">
              Team Week
            </span>
            <span className="mt-1 block text-sm font-bold whitespace-nowrap text-violet-900 tabular-nums">
              {formatScheduleAmount(weeklyTotal)}
            </span>
          </div>
        </Card>
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

      {subcontractedInView.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">
            Subcontracted:
          </span>
          {subcontractedInView.map((appointment) => {
            const customer = unwrapRelation(appointment.ops_customers)
            const isOverdue =
              appointment.appointment_date < formatDateKey(new Date()) &&
              appointment.status !== 'completed' &&
              appointment.status !== 'cancelled'
            const isClosed = appointment.status === 'completed'
            const href = appointment.recurring_template_id
              ? `/admin/operations/recurring/visit/${appointment.id}`
              : `/admin/operations/appointments/${appointment.id}`
            const dateLabel = new Date(
              appointment.appointment_date + 'T12:00:00',
            ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

            return (
              <Link
                key={appointment.id}
                href={href}
                title={
                  isOverdue
                    ? 'Past due — close this out so it reaches Month-End Billing'
                    : 'Open this visit to close it out'
                }
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  isOverdue
                    ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                    : isClosed
                      ? 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                      : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                }`}
              >
                {isClosed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Truck className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>
                  {dateLabel} ·{' '}
                  {appointment.subcontractor_name || 'Subcontractor'}
                  {customer?.business_name || customer?.full_name
                    ? ` · ${customer.business_name || customer.full_name}`
                    : ''}
                </span>
                <span className="font-semibold">
                  {formatScheduleAmount(appointmentDisplayRevenue(appointment))}
                </span>
                {isOverdue ? (
                  <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    CLOSE OUT
                  </span>
                ) : isClosed ? null : (
                  <span className="text-[10px] opacity-70">not closed</span>
                )}
              </Link>
            )
          })}
        </div>
      ) : null}

      {view === 'week' && weeklyTotal > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-green-600/20 bg-green-50 px-4 py-3">
          <span className="text-sm font-medium text-green-900">Week Total</span>
          <span className="text-lg font-bold text-green-700">
            {formatScheduleAmount(weeklyTotal)}
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
              const dayAppointments = gridAppointmentsByDate.get(dateKey) || []
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
                            {isEstimate
                              ? 'Commercial walkthrough'
                              : appointment.ops_appointment_line_items[0]
                                  ?.name_snapshot || 'Service'}
                          </div>
                          {tomorrowFillBadge(appointment, true)}
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
                          : `72px ${sundayOpen ? 'minmax(270px, 1fr)' : '56px'} repeat(5, minmax(270px, 1fr)) ${saturdayOpen ? 'minmax(270px, 1fr)' : '56px'}`,
                      minWidth:
                        view === 'day'
                          ? activeDayStaff
                            ? undefined
                            : `${72 + Math.max(staffList.length, 1) * 400}px`
                          : `${72 + 5 * 270 + (sundayOpen ? 270 : 56) + (saturdayOpen ? 270 : 56)}px`,
                    }}
                  >
                    <div className="border-r border-b border-slate-200 bg-slate-100 p-3" />
                    {view === 'day' && staffList.length > 0
                      ? dayLanes.map((staff, idx) => {
                          const dateKey = formatDateKey(anchorDate)
                          const isOpen = isStaffOpenForDate(staff.id, dateKey)
                          const laneTotal = (
                            gridAppointmentsByDate.get(dateKey) || []
                          )
                            .filter(
                              (a) =>
                                a.assigned_staff_user_id === staff.id ||
                                (!a.assigned_staff_user_id &&
                                  staff.id === staffList[0]?.id),
                            )
                            .reduce(
                              (sum, appt) =>
                                sum + appointmentScheduleRevenue(appt),
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
                          const isSaturday = date.getDay() === 6
                          const weekendDay = isSunday ? 'Sunday' : 'Saturday'
                          const setWeekendOpen = isSunday
                            ? setSundayOpen
                            : setSaturdayOpen
                          const dayTotal = (
                            gridAppointmentsByDate.get(dk) || []
                          ).reduce(
                            (sum, appt) =>
                              sum + appointmentScheduleRevenue(appt),
                            0,
                          )
                          if (
                            view === 'week' &&
                            ((isSunday && !sundayOpen) ||
                              (isSaturday && !saturdayOpen))
                          ) {
                            return (
                              <button
                                key={dk}
                                type="button"
                                title={`Open ${weekendDay}`}
                                aria-label={`Open ${weekendDay}`}
                                aria-expanded={false}
                                onClick={() => setWeekendOpen(true)}
                                className="flex flex-col items-center justify-center gap-0.5 border-r border-b border-slate-200 bg-slate-100 p-1 hover:bg-sky-50"
                              >
                                <span className="text-[10px] font-medium tracking-widest text-slate-400 uppercase">
                                  {WEEKDAY_LABELS[date.getDay()]}
                                </span>
                                <span className="text-xs font-semibold text-slate-500">
                                  {date.toLocaleDateString('en-US', {
                                    day: 'numeric',
                                  })}
                                </span>
                                {dayTotal > 0 && (
                                  <span className="text-[10px] font-semibold text-green-700">
                                    ${dayTotal.toFixed(0)}
                                  </span>
                                )}
                              </button>
                            )
                          }
                          return (
                            <div
                              key={dk}
                              className="border-b border-slate-200 bg-slate-100 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium tracking-[0.2em] text-slate-500 uppercase">
                                  {WEEKDAY_LABELS[date.getDay()]}
                                </span>
                                {view === 'week' &&
                                  (isSunday || isSaturday) && (
                                    <button
                                      type="button"
                                      title={`Collapse ${weekendDay}`}
                                      aria-label={`Collapse ${weekendDay}`}
                                      aria-expanded={true}
                                      onClick={() => setWeekendOpen(false)}
                                      className="text-[10px] font-medium tracking-wide text-slate-400 uppercase hover:text-slate-600"
                                    >
                                      Hide
                                    </button>
                                  )}
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
                      {hours.map((hour) => (
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
                            gridAppointmentsByDate.get(dateKey) || []
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
                          const offHourSegments = getOffHourSegmentsForGrid(
                            dayRanges,
                            gridStartHour,
                          )
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
                                        null,
                                        gridStartHour,
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
                              {hours.map((hour) => (
                                <button
                                  key={`${dateKey}-${hour}`}
                                  type="button"
                                  className="focus-visible:ring-ring relative z-0 block w-full border-b border-slate-200 text-left transition hover:bg-emerald-50/60 focus-visible:ring-2 focus-visible:outline-none"
                                  style={{ height: HOUR_HEIGHT }}
                                  onClick={(e) => {
                                    handleCellTap(dateKey, hour, e, staff.id)
                                  }}
                                  title={`Create at ${String(hour).padStart(2, '0')}:00`}
                                  aria-label={`Create on ${dateKey} at ${String(hour).padStart(2, '0')}:00`}
                                />
                              ))}
                              {offHourSegments.map((segment, index) => {
                                const gridStartMinutes = gridStartHour * 60
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
                                    dateKey,
                                    endOverride,
                                    gridStartHour,
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
                                      {!event.is_all_day &&
                                        event.start_date === event.end_date && (
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
                                      {!event.is_all_day &&
                                        event.start_date === event.end_date && (
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
                              nowMinutes <= END_HOUR * 60 ? (
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
                            const isSaturday = date.getDay() === 6
                            if (
                              (isSunday && !sundayOpen) ||
                              (isSaturday && !saturdayOpen)
                            ) {
                              return (
                                <WeekendSliver
                                  key={dateKey}
                                  dateKey={dateKey}
                                  dayName={isSunday ? 'Sunday' : 'Saturday'}
                                  onOpen={() =>
                                    isSunday
                                      ? setSundayOpen(true)
                                      : setSaturdayOpen(true)
                                  }
                                  appointments={
                                    gridAppointmentsByDate.get(dateKey) || []
                                  }
                                  onDragOver={(e) =>
                                    handleDragOver(e, dateKey, null)
                                  }
                                  onDragLeave={() => setDragPreview(null)}
                                  onDrop={(e) =>
                                    void handleDrop(e, dateKey, null)
                                  }
                                  gridStartHour={gridStartHour}
                                />
                              )
                            }
                            const allDayAppointments =
                              gridAppointmentsByDate.get(dateKey) || []
                            const dayEvents = data.events.filter((event) =>
                              intersectsDay(event, dateKey),
                            )
                            const dayRanges =
                              businessDayRanges.get(date.getDay()) || []
                            const offHourSegments = getOffHourSegmentsForGrid(
                              dayRanges,
                              gridStartHour,
                            )
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
                                                null,
                                                gridStartHour,
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
                                      {hours.map((hour) => (
                                        <button
                                          key={`${dateKey}-${staff.id}-${hour}`}
                                          type="button"
                                          className="focus-visible:ring-ring relative z-0 block w-full border-b border-slate-200 text-left transition hover:bg-emerald-50/60 focus-visible:ring-2 focus-visible:outline-none"
                                          style={{ height: HOUR_HEIGHT }}
                                          onClick={(e) => {
                                            handleCellTap(
                                              dateKey,
                                              hour,
                                              e,
                                              staff.id,
                                            )
                                          }}
                                          title={`Create at ${String(hour).padStart(2, '0')}:00`}
                                          aria-label={`Create on ${dateKey} at ${String(hour).padStart(2, '0')}:00`}
                                        />
                                      ))}
                                      {offHourSegments.map((segment, index) => {
                                        const gridStartMinutes =
                                          gridStartHour * 60
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
                                            dateKey,
                                            endOverride,
                                            gridStartHour,
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
                                              {!event.is_all_day &&
                                                event.start_date ===
                                                  event.end_date && (
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
                                              {!event.is_all_day &&
                                                event.start_date ===
                                                  event.end_date && (
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
                                      nowMinutes <= END_HOUR * 60 ? (
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
                            const isSaturday = date.getDay() === 6
                            if (
                              view === 'week' &&
                              ((isSunday && !sundayOpen) ||
                                (isSaturday && !saturdayOpen))
                            ) {
                              return (
                                <WeekendSliver
                                  key={dateKey}
                                  dateKey={dateKey}
                                  dayName={isSunday ? 'Sunday' : 'Saturday'}
                                  onOpen={() =>
                                    isSunday
                                      ? setSundayOpen(true)
                                      : setSaturdayOpen(true)
                                  }
                                  appointments={
                                    appointmentsByDate.get(dateKey) || []
                                  }
                                  onDragOver={(e) =>
                                    handleDragOver(e, dateKey, null)
                                  }
                                  onDragLeave={() => setDragPreview(null)}
                                  onDrop={(e) =>
                                    void handleDrop(e, dateKey, null)
                                  }
                                  gridStartHour={gridStartHour}
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
                            const offHourSegments = getOffHourSegmentsForGrid(
                              dayRanges,
                              gridStartHour,
                            )
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
                                          null,
                                          gridStartHour,
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
                                {hours.map((hour) => (
                                  <button
                                    key={`${dateKey}-${hour}`}
                                    type="button"
                                    className="focus-visible:ring-ring relative z-0 block w-full border-b border-slate-200 text-left transition hover:bg-emerald-50/60 focus-visible:ring-2 focus-visible:outline-none"
                                    style={{ height: HOUR_HEIGHT }}
                                    onClick={(e) => {
                                      handleCellTap(dateKey, hour, e, null)
                                    }}
                                    title={`Create at ${String(hour).padStart(2, '0')}:00`}
                                    aria-label={`Create on ${dateKey} at ${String(hour).padStart(2, '0')}:00`}
                                  />
                                ))}
                                {offHourSegments.map((segment, index) => {
                                  const gridStartMinutes = gridStartHour * 60
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
                                    dateKey,
                                    endOverride,
                                    gridStartHour,
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
                                      {!event.is_all_day &&
                                        event.start_date === event.end_date && (
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
                                      {!event.is_all_day &&
                                        event.start_date === event.end_date && (
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
                                nowMinutes <= END_HOUR * 60 ? (
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
            {visibleAppointmentCount}
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
            {visibleEventCount}
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
