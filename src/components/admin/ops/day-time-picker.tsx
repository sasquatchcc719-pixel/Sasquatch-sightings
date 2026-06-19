'use client'

import { useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'

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
}

const PX_PER_MIN = 0.95 // vertical scale of the timeline
const DEFAULT_OPEN_MIN = 8 * 60 // 8:00 AM
const DEFAULT_CLOSE_MIN = 18 * 60 // 6:00 PM

function toMinutes(time: string): number {
  const [h, m] = time.slice(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function formatClock(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440
  const h24 = Math.floor(normalized / 60)
  const m = normalized % 60
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
}: DayTimePickerProps) {
  const dateInputRef = useRef<HTMLInputElement>(null)

  // Quick-pick strip: today + next 13 days.
  const upcomingDays = useMemo(() => {
    const base = new Date(`${formatDateKey(new Date())}T12:00:00`)
    return Array.from({ length: 14 }, (_, index) => {
      const day = new Date(base)
      day.setDate(day.getDate() + index)
      return day
    })
  }, [])

  const todayKey = useMemo(() => formatDateKey(new Date()), [])

  // Timeline vertical range — stretch to cover any early/late booking or slot.
  const { rangeStart, rangeEnd } = useMemo(() => {
    let start = DEFAULT_OPEN_MIN
    let end = DEFAULT_CLOSE_MIN
    for (const appt of appointments) {
      start = Math.min(start, toMinutes(appt.start_time))
      end = Math.max(end, toMinutes(appt.end_time))
    }
    for (const slot of availableSlots) {
      start = Math.min(start, toMinutes(slot.start_time))
      end = Math.max(end, toMinutes(slot.end_time))
    }
    if (selectedTime) {
      start = Math.min(start, toMinutes(selectedTime))
      end = Math.max(
        end,
        toMinutes(selectedTime) + Math.max(requiredMinutes, 30),
      )
    }
    // Snap to whole hours with a little padding.
    start = Math.floor(start / 60) * 60
    end = Math.ceil(end / 60) * 60
    return { rangeStart: start, rangeEnd: end }
  }, [appointments, availableSlots, selectedTime, requiredMinutes])

  const totalMinutes = Math.max(60, rangeEnd - rangeStart)
  const timelineHeight = totalMinutes * PX_PER_MIN

  const hourMarks = useMemo(() => {
    const marks: number[] = []
    for (let m = rangeStart; m <= rangeEnd; m += 60) marks.push(m)
    return marks
  }, [rangeStart, rangeEnd])

  const selectedStartMin = selectedTime ? toMinutes(selectedTime) : null
  const previewHeight = Math.max(requiredMinutes, 30) * PX_PER_MIN

  const topFor = (minutes: number) => (minutes - rangeStart) * PX_PER_MIN

  return (
    <div className="space-y-4">
      {/* ---- Day selection ---- */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Pick a day</span>
          <button
            type="button"
            className="text-primary text-xs font-medium underline-offset-2 hover:underline"
            onClick={() => {
              const el = dateInputRef.current
              if (!el) return
              // showPicker() is supported on iOS Safari + modern browsers.
              if (typeof el.showPicker === 'function') el.showPicker()
              else el.focus()
            }}
          >
            📅 Pick a specific date →
          </button>
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {upcomingDays.map((day) => {
            const key = formatDateKey(day)
            const active = key === selectedDate
            const isToday = key === todayKey
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDate(key)}
                className={`flex min-w-[60px] flex-col items-center rounded-2xl border px-3 py-2 transition ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border/60 bg-background/70 hover:border-primary/50'
                }`}
              >
                <span className="text-[10px] font-medium tracking-[0.15em] uppercase opacity-80">
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span className="mt-0.5 text-lg leading-none font-semibold">
                  {day.getDate()}
                </span>
                <span className="mt-0.5 text-[10px] opacity-80">
                  {isToday
                    ? 'Today'
                    : day.toLocaleDateString('en-US', { month: 'short' })}
                </span>
              </button>
            )
          })}
        </div>

        {/* Hidden native date input drives the "specific date" picker. */}
        <input
          ref={dateInputRef}
          type="date"
          className="sr-only"
          value={selectedDate}
          onChange={(event) => {
            if (event.target.value) onSelectDate(event.target.value)
          }}
        />

        <p className="text-muted-foreground mt-2 text-xs">
          {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* ---- Time selection ---- */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Pick a start time</span>
          <button
            type="button"
            className="text-xs text-blue-600 underline-offset-2 hover:underline"
            onClick={onToggleCustomTime}
          >
            {useCustomTime ? '← Back to open times' : 'Custom time →'}
          </button>
        </div>

        {requiredMinutes <= 0 ? (
          <div className="border-border/60 text-muted-foreground rounded-2xl border border-dashed p-4 text-sm">
            Add services above first — we&apos;ll calculate the openings that
            fit this job.
          </div>
        ) : useCustomTime ? (
          <div className="border-border/60 rounded-2xl border p-4">
            <input
              type="time"
              className="border-input bg-background h-11 w-full rounded-md border px-3 text-base"
              value={selectedTime}
              onChange={(event) => onSelectTime(event.target.value)}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              Admin override — any time accepted, no conflict check.
            </p>
          </div>
        ) : (
          <>
            {staffClosed ? (
              <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                The assigned technician is closed this day. Switch the day, pick
                a different tech, or use a custom time.
              </div>
            ) : null}

            {/* Open-slot quick taps */}
            <div className="mb-3 flex flex-wrap gap-2">
              {loadingSlots ? (
                <span className="text-muted-foreground text-sm">
                  Loading open times…
                </span>
              ) : availableSlots.length === 0 ? (
                <span className="text-muted-foreground text-sm">
                  No open times this day — try another day or a custom time.
                </span>
              ) : (
                availableSlots.map((slot) => {
                  const start = slot.start_time.slice(0, 5)
                  const active = start === selectedTime
                  return (
                    <button
                      key={slot.start_time}
                      type="button"
                      onClick={() => onSelectTime(start)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                        active
                          ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
                      }`}
                    >
                      {formatClock(toMinutes(slot.start_time))}
                    </button>
                  )
                })
              )}
            </div>

            {/* Live day timeline */}
            <div className="border-border/60 bg-background/40 relative overflow-hidden rounded-2xl border">
              <div
                className="relative"
                style={{ height: `${timelineHeight}px` }}
              >
                {/* Hour gridlines + labels */}
                {hourMarks.map((mark) => (
                  <div
                    key={mark}
                    className="border-border/40 absolute right-0 left-14 border-t"
                    style={{ top: `${topFor(mark)}px` }}
                  >
                    <span className="text-muted-foreground absolute -top-2 -left-14 w-12 text-right text-[10px]">
                      {formatClock(mark)}
                    </span>
                  </div>
                ))}

                {/* Existing booked jobs */}
                {appointments.map((appt) => {
                  const start = toMinutes(appt.start_time)
                  const end = toMinutes(appt.end_time)
                  const height = Math.max(18, (end - start) * PX_PER_MIN)
                  return (
                    <div
                      key={appt.id}
                      className="border-border bg-muted text-muted-foreground absolute right-2 left-16 overflow-hidden rounded-lg border px-2 py-1"
                      style={{
                        top: `${topFor(start)}px`,
                        height: `${height}px`,
                      }}
                    >
                      <div className="truncate text-[11px] font-semibold">
                        {formatClock(start)} · {appt.label}
                      </div>
                      {appt.detail ? (
                        <div className="truncate text-[10px] opacity-80">
                          {appt.detail}
                        </div>
                      ) : null}
                    </div>
                  )
                })}

                {/* Preview of the job being booked */}
                {selectedStartMin !== null ? (
                  <div
                    className="border-primary bg-primary/15 text-primary absolute right-2 left-16 z-10 overflow-hidden rounded-lg border-2 px-2 py-1 shadow-sm"
                    style={{
                      top: `${topFor(selectedStartMin)}px`,
                      height: `${previewHeight}px`,
                    }}
                  >
                    <div className="truncate text-[11px] font-bold">
                      {formatClock(selectedStartMin)} –{' '}
                      {formatClock(selectedStartMin + requiredMinutes)}
                    </div>
                    <div className="truncate text-[10px] font-medium opacity-90">
                      This job
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <p className="text-muted-foreground mt-2 text-xs">
              {requiredMinutes > 0
                ? `Job runs ~${serviceMinutes} min + ${bufferMinutes} min travel buffer = ${requiredMinutes} min. Green chips are real openings.`
                : 'Pick services first so we can calculate valid openings.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
