/**
 * Retry policy for QuickBooks sync jobs.
 *
 * Before this existed, a job that threw was marked 'failed' and the cron —
 * which only selects status='pending' — never looked at it again. One network
 * blip meant an invoice silently never reached the books. Jobs now stay
 * 'pending' with a next_retry_at while attempts remain, and only go terminal
 * once the ladder is exhausted, which is when Charles gets told.
 */

/** Minutes to wait before each retry: ~5m, 30m, 2h, 12h, 24h. */
export const RETRY_BACKOFF_MINUTES = [5, 30, 120, 720, 1440] as const

/** Attempts allowed in total: the first try plus one per backoff rung. */
export const MAX_SYNC_ATTEMPTS = RETRY_BACKOFF_MINUTES.length + 1

/**
 * Given how many attempts have now been made, how long to wait before the
 * next one — or null when the job is out of retries and should go 'failed'.
 */
export function nextRetryDelayMinutes(attemptsMade: number): number | null {
  if (attemptsMade < 1) return RETRY_BACKOFF_MINUTES[0]
  if (attemptsMade > RETRY_BACKOFF_MINUTES.length) return null
  return RETRY_BACKOFF_MINUTES[attemptsMade - 1]
}

export function retryTimestamp(
  attemptsMade: number,
  now = new Date(),
): string | null {
  const minutes = nextRetryDelayMinutes(attemptsMade)
  if (minutes == null) return null
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

/**
 * A QuickBooks 400 means the request itself is wrong (bad number, duplicate,
 * invalid field) — hammering it five more times changes nothing and just
 * delays the alert. Those go terminal immediately. Anything else (5xx, network,
 * auth refresh, rate limit) is worth retrying.
 */
export function isPermanentFailure(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('docnumber collision') ||
    m.includes('duplicate document number') ||
    m.includes('duplicate name exists') ||
    m.includes('not found')
  )
}

export type SyncAlertContext = {
  entityType: string
  reference: string | null
  attempts: number
  error: string
}

/** Owner-facing Telegram text for a job that has run out of road. */
export function formatSyncFailureAlert(jobs: SyncAlertContext[]): string {
  const lines = [
    `⚠️ QuickBooks sync failed (${jobs.length} ${jobs.length === 1 ? 'item' : 'items'})`,
    '',
  ]
  for (const j of jobs) {
    const label = j.reference ? `${j.entityType} ${j.reference}` : j.entityType
    lines.push(`• ${label} — after ${j.attempts} attempts`)
    lines.push(`  ${j.error.slice(0, 300)}`)
  }
  lines.push('')
  lines.push('These will not retry again. Fix in Admin → Operations Settings.')
  return lines.join('\n')
}
