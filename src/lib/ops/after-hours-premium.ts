import {
  mountainDateKey,
  mountainLocalDateTimeToIso,
} from '@/lib/ops/timesheet-pay'

/** Recovery Village after-hours premium: +$10/hr on worked minutes after 5pm. */
export const AFTER_HOURS_PREMIUM_RATE = 10
/** 5:00 PM Mountain — the cutoff after which the premium applies. */
export const AFTER_HOURS_CUTOFF_TIME = '17:00'

/** Tolerant Recovery Village match (the stored business_name has a trailing space). */
export function isRecoveryVillage(
  businessName: string | null | undefined,
): boolean {
  return (businessName || '').trim().toLowerCase() === 'recovery village'
}

/**
 * Minutes of the real worked window [jobStartedAt, completedAt] that fall after
 * 5:00 PM Mountain on the day the job started. Returns 0 when the job wrapped
 * before 5pm, the window is empty, or either timestamp is missing.
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
