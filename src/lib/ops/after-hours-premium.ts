import {
  mountainDateKey,
  mountainLocalDateTimeToIso,
} from '@/lib/ops/timesheet-pay'

/** Commercial after-hours premium: +$10/hr on worked minutes after 6pm. */
export const AFTER_HOURS_PREMIUM_RATE = 10
/** 6:00 PM Mountain — the cutoff after which the premium applies. */
export const AFTER_HOURS_CUTOFF_TIME = '18:00'

/** Match the commercial customers whose field work earns the premium. */
export function isAfterHoursPremiumCustomer(
  businessName: string | null | undefined,
): boolean {
  return ['recovery village', 'saltgrass colorado springs'].includes(
    (businessName || '').trim().toLowerCase(),
  )
}

export type AfterHoursPremiumStart = {
  timestamp: string
  source: 'job_started' | 'scheduled'
}

export function resolveAfterHoursPremiumStart(
  jobStartedAt: string | null | undefined,
  appointmentDate: string,
  scheduledStartTime: string | null | undefined,
): AfterHoursPremiumStart | null {
  if (jobStartedAt && Number.isFinite(new Date(jobStartedAt).getTime())) {
    return { timestamp: jobStartedAt, source: 'job_started' }
  }

  const scheduled = mountainLocalDateTimeToIso(
    appointmentDate,
    String(scheduledStartTime || '').slice(0, 5),
  )
  return scheduled ? { timestamp: scheduled, source: 'scheduled' } : null
}

function nextDateKey(dateKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return null
  const next = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1),
  )
  return next.toISOString().slice(0, 10)
}

/** Resolve a hand-entered end time, treating an earlier clock time as next day. */
export function resolveAfterHoursPremiumEnd(
  startedAt: string,
  workDate: string,
  endTime: string,
): string | null {
  const sameDay = mountainLocalDateTimeToIso(workDate, endTime)
  const startMs = new Date(startedAt).getTime()
  if (!sameDay || !Number.isFinite(startMs)) return null
  if (new Date(sameDay).getTime() > startMs) return sameDay

  const nextDay = nextDateKey(workDate)
  return nextDay ? mountainLocalDateTimeToIso(nextDay, endTime) : null
}

/**
 * Minutes of the resolved work window [start, completedAt] that fall after
 * 6:00 PM Mountain on the day the job started. Returns 0 when the job wrapped
 * before 6pm, the window is empty, or either timestamp is missing.
 */
export function computeAfterHoursMinutes(
  jobStartedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number {
  if (!jobStartedAt || !completedAt) return 0
  const start = new Date(jobStartedAt).getTime()
  const end = new Date(completedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0

  const dayKey = mountainDateKey(jobStartedAt)
  const cutoffIso = mountainLocalDateTimeToIso(dayKey, AFTER_HOURS_CUTOFF_TIME)
  if (!cutoffIso) return 0
  const cutoff = new Date(cutoffIso).getTime()

  const premiumStart = Math.max(start, cutoff)
  const premiumMs = end - premiumStart
  if (premiumMs <= 0) return 0
  return Math.round(premiumMs / 60000)
}

/** Dollar value of a premium given after-hours minutes. */
export function computePremiumPay(
  minutes: number,
  rate: number = AFTER_HOURS_PREMIUM_RATE,
): number {
  return Math.round((minutes / 60) * rate * 100) / 100
}
