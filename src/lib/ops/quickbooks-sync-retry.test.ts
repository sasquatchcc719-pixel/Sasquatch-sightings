import { describe, expect, it } from 'vitest'
import {
  MAX_SYNC_ATTEMPTS,
  RETRY_BACKOFF_MINUTES,
  formatSyncFailureAlert,
  isPermanentFailure,
  nextRetryDelayMinutes,
  retryTimestamp,
} from './quickbooks-sync-retry'

describe('nextRetryDelayMinutes', () => {
  it('walks the backoff ladder in order', () => {
    expect(nextRetryDelayMinutes(1)).toBe(5)
    expect(nextRetryDelayMinutes(2)).toBe(30)
    expect(nextRetryDelayMinutes(3)).toBe(120)
    expect(nextRetryDelayMinutes(4)).toBe(720)
    expect(nextRetryDelayMinutes(5)).toBe(1440)
  })

  it('returns null once the ladder is exhausted, so the job goes terminal', () => {
    expect(nextRetryDelayMinutes(RETRY_BACKOFF_MINUTES.length + 1)).toBeNull()
    expect(nextRetryDelayMinutes(99)).toBeNull()
  })

  it('gives a job with no recorded attempts the first rung', () => {
    expect(nextRetryDelayMinutes(0)).toBe(5)
  })

  it('allows one attempt per rung plus the initial try', () => {
    expect(MAX_SYNC_ATTEMPTS).toBe(RETRY_BACKOFF_MINUTES.length + 1)
  })
})

describe('retryTimestamp', () => {
  it('schedules the retry the right distance out', () => {
    const now = new Date('2026-07-28T12:00:00.000Z')
    expect(retryTimestamp(1, now)).toBe('2026-07-28T12:05:00.000Z')
    expect(retryTimestamp(3, now)).toBe('2026-07-28T14:00:00.000Z')
  })

  it('returns null when there are no retries left', () => {
    expect(retryTimestamp(50, new Date())).toBeNull()
  })
})

describe('isPermanentFailure', () => {
  it('does not retry errors that will fail identically forever', () => {
    expect(
      isPermanentFailure(
        'QB invoice DocNumber collision: 18334 already belongs to Crystal Mendoza',
      ),
    ).toBe(true)
    expect(
      isPermanentFailure('Duplicate Document Number Error : DocNumber=18296'),
    ).toBe(true)
  })

  it('retries transient infrastructure errors', () => {
    expect(isPermanentFailure('QB create invoice failed: 503')).toBe(false)
    expect(isPermanentFailure('fetch failed')).toBe(false)
    expect(isPermanentFailure('QuickBooks not connected')).toBe(false)
  })
})

describe('formatSyncFailureAlert', () => {
  it('names the invoice and quotes QuickBooks so the alert is actionable', () => {
    const text = formatSyncFailureAlert([
      {
        entityType: 'invoice',
        reference: '#18360 ($388.00)',
        attempts: 6,
        error: 'Duplicate Document Number Error',
      },
    ])
    expect(text).toContain('#18360 ($388.00)')
    expect(text).toContain('Duplicate Document Number Error')
    expect(text).toContain('6 attempts')
  })

  it('pluralises correctly for a single item', () => {
    const one = formatSyncFailureAlert([
      {
        entityType: 'customer',
        reference: 'Matt Thompson',
        attempts: 6,
        error: 'x',
      },
    ])
    expect(one).toContain('(1 item)')
  })
})
