/**
 * Harry (next) — deterministic schedule recompute.
 *
 * When a job's total changes, its end time has to move with it. We reuse the
 * single source of truth for job duration (`calculateAppointmentDurationFromTotal`
 * — the "one duration law" from the June 12 fix) so the new agent can never
 * disagree with the rest of ops about how long a job takes. The model is not
 * involved.
 */
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
} from '@/lib/ops/availability'

/** Add minutes to an "HH:MM" (or "HH:MM:SS") clock string, returning "HH:MM". */
export function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.slice(0, 5).split(':').map(Number)
  const total = hours * 60 + mins + Math.round(minutes)
  const wrapped = ((total % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * The new end time for a job given its start and its new dollar total. Duration
 * comes from the dollar tier, then the standard appointment buffer is applied —
 * exactly how booking and the old line-item update sized jobs.
 */
export function recomputeEndTime(startTime: string, newTotal: number): string {
  const buffered = applyAppointmentBuffer(
    calculateAppointmentDurationFromTotal(newTotal),
  )
  return addMinutesToTime(startTime, buffered)
}
