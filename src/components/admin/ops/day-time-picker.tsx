'use client'

import { useEffect, useMemo, useState } from 'react'

export type DayPickerAppointment = {
  id: string
  start_time: string
  end_time: string
  label: string
  detail?: string | null
}

export type DayPickerSlot = {
  start_time: string
  end_time: string
}

type DayTimePickerProps = {
  selectedDate: string
  onSelectDate: (dateKey: string) => void
  selectedTime: string
  onSelectTime: (time: string) => void
  appointments: DayPickerAppointment[]
  availableSlots: DayPickerSlot[]
  requiredMinutes: number
  serviceMinutes: number
  bufferMinutes: number
  loadingSlots: boolean
  useCustomTime: boolean
  onToggleCustomTime: () => void
  staffClosed?: boolean
  staffUserId?: string
}

const DEFAULT_AVAIL_MINUTES = 120

function toMinutes(time: string): number {
  const [h, m] = time.slice(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function minutesToClock(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatClock(time: string): string {
  const total = toMinutes(time)
  const h24 = Math.floor(total / 60)
  const m = total % 60
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}


export type DayTimelineItem =
  | {
      kind: 'booked'
      key: string
      start: number
      end: number
      label: string
      detail?: string | null
    }
  | {
      kind: 'open'
      key: string
      start: number
      end: number
      /** Time to book if this row is tapped, "HH:MM". */
      startTime: string
    }

/**
 * The day, top to bottom: the jobs already on it, and each available slot as
 * its own row with its own time range. Booked and open rows are interleaved in
 * clock order, so the day reads exactly as it runs.
 *
 * Deliberately NOT computed by subtracting jobs from the day. The slots come
 * from the availability API, which is tech-aware — on a two-tech day a slot can
 * legitimately overlap a job the other tech is on. Listing the slots as given
 * keeps those bookable instead of erasing them.
 */
export function buildDayTimeline(
  appointments: DayPickerAppointment[],
  availableSlots: DayPickerSlot[],
): DayTimelineItem[] {
  const booked: DayTimelineItem[] = appointments.map((appt) => ({
    kind: 'booked' as const,
    key: appt.id,
    start: toMinutes(appt.start_time),
    end: appt.end_time
      ? toMinutes(appt.end_time)
      : toMinutes(appt.start_time) + 120,
    label: appt.label,
    detail: appt.detail,
  }))

  const open: DayTimelineItem[] = availableSlots.map((slot) => ({
    kind: 'open' as const,
    key: `open-${slot.start_time}`,
    start: toMinutes(slot.start_time),
    end: toMinutes(slot.end_time),
    startTime: slot.start_time.slice(0, 5),
  }))

  // Clock order. When a job and an opening start together, the job comes
  // first — it is the fact, the opening is the offer.
  return [...booked, ...open].sort(
    (a, b) =>
      a.start - b.start ||
      (a.kind === 'booked' ? 0 : 1) - (b.kind === 'booked' ? 0 : 1),
  )
}

// ─── Month calendar with green (open) / red (full) day coding ──────────────────

function MonthCalendar({
  selected,
  onSelect,
  requiredMinutes,
  staffUserId,
}: {
  selected: string
  onSelect: (dateKey: string) => void
  requiredMinutes: number
  staffUserId?: string
}) {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const todayKey = useMemo(() => formatDateKey(today), [today])

  const [availabilityByDate, setAvailabilityByDate] = useState<
    Record<string, number>
  >({})
  const [loading, setLoading] = useState(false)

  const [viewMonth, setViewMonth] = useState<Date>(() => {
    if (selected) {
      const [y, m] = selected.split('-').map(Number)
      return new Date(y, m - 1, 1)
    }
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const startDate = formatDateKey(new Date(year, month, 1))
  const endDate = formatDateKey(new Date(year, month, daysInMonth))
  const monthLabel = viewMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const availMinutes =
    requiredMinutes > 0 ? requiredMinutes : DEFAULT_AVAIL_MINUTES

  useEffect(() => {
    let ignore = false
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          start_date: startDate,
          end_date: endDate,
          required_minutes: String(availMinutes),
        })
        if (staffUserId) params.set('staff_user_id', staffUserId)
        const res = await fetch(`/api/admin/ops/month-availability?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('availability failed')
        const data = (await res.json()) as {
          days?: { date: string; slots?: number }[]
        }
        if (ignore) return
        setAvailabilityByDate(
          (data.days || []).reduce<Record<string, number>>((acc, d) => {
            acc[d.date] = Number(d.slots || 0)
            return acc
          }, {}),
        )
      } catch {
        if (!ignore) setAvailabilityByDate({})
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    void load()
    return () => {
      ignore = true
      controller.abort()
    }
  }, [startDate, endDate, availMinutes, staffUserId])

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          className="hover:bg-muted rounded-lg p-2 text-base transition-colors"
        >
          ‹
        </button>
        <span className="text-base font-semibold">{monthLabel}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          className="hover:bg-muted rounded-lg p-2 text-base transition-colors"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div
            key={d}
            className="text-muted-foreground py-1 text-center text-xs font-semibold"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} />
          const cellDate = new Date(year, month, day)
          const iso = formatDateKey(cellDate)
          const isPast = cellDate < today
          const slotsForDay = availabilityByDate[iso]
          const hasSlots = typeof slotsForDay === 'number' && slotsForDay > 0
          const isFull = typeof slotsForDay === 'number' && slotsForDay === 0
          const isSelected = iso === selected
          const isToday = iso === todayKey

          return (
            <button
              key={iso}
              type="button"
              disabled={isPast}
              onClick={() => onSelect(iso)}
              className={`flex min-h-[56px] w-full flex-col items-center justify-center rounded-xl border px-0.5 text-center transition-all ${
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : isPast
                    ? 'text-muted-foreground/30 cursor-not-allowed border-transparent'
                    : isFull
                      ? 'border-rose-400/50 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-300'
                      : hasSlots
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
                        : 'border-border/60 hover:border-primary/50'
              } ${isToday && !isSelected ? 'ring-primary/40 ring-1' : ''}`}
            >
              <span className="text-base leading-none font-bold">{day}</span>
              {!isSelected && hasSlots ? (
                <span className="mt-1 text-[9px] leading-none font-bold">
                  Open
                </span>
              ) : null}
              {!isSelected && isFull ? (
                <span className="mt-1 text-[9px] leading-none font-bold">
                  Full
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <p className="text-muted-foreground mt-3 text-center text-xs">
        {loading
          ? 'Checking openings…'
          : 'Green = open · Red = fully booked (tap to stack work anyway)'}
      </p>
    </div>
  )
}

// ─── Full day + time picker ────────────────────────────────────────────────────

export function DayTimePicker({
  selectedDate,
  onSelectDate,
  selectedTime,
  onSelectTime,
  appointments,
  availableSlots,
  requiredMinutes,
  serviceMinutes,
  bufferMinutes,
  loadingSlots,
  useCustomTime,
  onToggleCustomTime,
  staffClosed = false,
  staffUserId,
}: DayTimePickerProps) {
  const sortedAppointments = useMemo(
    () =>
      [...appointments].sort(
        (a, b) => toMinutes(a.start_time) - toMinutes(b.start_time),
      ),
    [appointments],
  )

  const longDate = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
    'en-US',
    { weekday: 'long', month: 'long', day: 'numeric' },
  )

  /**
   * The day as one chronological list: what is booked, and the gaps between.
   * The gaps are the point — you are looking for where this job fits, so a gap
   * big enough to take is a button. Gaps too short to hold the job are still
   * shown, greyed, so the day reads honestly instead of looking emptier than
   * it is.
   */
  const dayTimeline = useMemo(
    () => buildDayTimeline(sortedAppointments, availableSlots),
    [sortedAppointments, availableSlots],
  )


  return (
    <div className="space-y-5">
      {/* Month calendar */}
      <div className="border-border/60 bg-background/40 rounded-2xl border p-4">
        <MonthCalendar
          selected={selectedDate}
          onSelect={onSelectDate}
          requiredMinutes={requiredMinutes}
          staffUserId={staffUserId}
        />
      </div>

      {/* What's already booked that day */}
      <div className="border-border/60 bg-background/40 rounded-2xl border p-4">
        <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
          Already on the schedule — {longDate}
        </p>
        {staffClosed ? (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            The assigned technician is closed this day. You can still book with
            a custom time.
          </div>
        ) : null}
        <div className="space-y-2">
          {dayTimeline.length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">
              Nothing booked yet — add services above to see open times.
            </p>
          ) : null}

          {dayTimeline.map((item) => {
            const range = `${formatClock(minutesToClock(item.start))} – ${formatClock(minutesToClock(item.end))}`

            if (item.kind === 'booked') {
              return (
                <div
                  key={item.key}
                  className="border-border/60 bg-card flex items-start gap-3 rounded-xl border px-3 py-2.5"
                >
                  <div className="text-sm font-semibold whitespace-nowrap">
                    {formatClock(minutesToClock(item.start))}{' '}
                    <span className="text-muted-foreground font-normal">
                      – {formatClock(minutesToClock(item.end))}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {item.label}
                    </div>
                    {item.detail ? (
                      <div className="text-muted-foreground truncate text-xs">
                        {item.detail}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            }

            const active = item.startTime === selectedTime
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelectTime(item.startTime)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                  active
                    ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
                }`}
              >
                <span className="text-sm font-semibold whitespace-nowrap">
                  {range}
                </span>
                <span className="text-xs font-semibold">
                  {active ? 'Selected' : 'Available'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Open time windows */}
      <div className="border-border/60 bg-background/40 rounded-2xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Pick a start time
          </p>
          <button
            type="button"
            className="text-xs text-blue-600 underline-offset-2 hover:underline"
            onClick={onToggleCustomTime}
          >
            {useCustomTime ? '← Back to open windows' : 'Custom time →'}
          </button>
        </div>

        {requiredMinutes <= 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            Add services above first — we&apos;ll show the openings that fit
            this job.
          </p>
        ) : useCustomTime ? (
          <div>
            <input
              type="time"
              className="border-input bg-background h-12 w-full rounded-lg border px-3 text-base"
              value={selectedTime}
              onChange={(event) => onSelectTime(event.target.value)}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              Admin override — any time accepted, no conflict check. Use this
              for after-hours and weekend work, or to stack a job on a full day.
            </p>
          </div>
        ) : loadingSlots ? (
          <div className="bg-muted h-12 animate-pulse rounded-lg" />
        ) : availableSlots.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            No opening long enough on this day — the gaps above are too short.
            Tap “Custom time” to book after hours or stack it, or pick another
            day.
          </p>
        ) : (
          <p className="text-muted-foreground py-1 text-sm">
            Tap a green opening in the day above.{' '}
            {selectedTime ? (
              <span className="text-foreground font-medium">
                Starting {formatClock(selectedTime)}.
              </span>
            ) : null}
          </p>
        )}

        {requiredMinutes > 0 ? (
          <p className="text-muted-foreground mt-3 text-xs">
            This job needs ~{serviceMinutes} min + {bufferMinutes} min travel ={' '}
            {requiredMinutes} min.
          </p>
        ) : null}
      </div>
    </div>
  )
}
