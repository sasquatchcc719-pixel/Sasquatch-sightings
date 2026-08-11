import { describe, it, expect } from 'vitest'
import { isDue } from './scan-scheduler'

const now = new Date('2026-08-17T13:00:00Z')

describe('isDue', () => {
  it('never fires when disabled, even if overdue', () => {
    expect(isDue({ enabled: false, frequency_days: 7, last_run_at: null }, now)).toBe(false)
  })

  it('fires immediately when never run', () => {
    expect(isDue({ enabled: true, frequency_days: 7, last_run_at: null }, now)).toBe(true)
  })

  it('fires when exactly one interval has passed', () => {
    expect(
      isDue({ enabled: true, frequency_days: 7, last_run_at: '2026-08-10T13:00:00Z' }, now),
    ).toBe(true)
  })

  it('waits when inside the interval', () => {
    expect(
      isDue({ enabled: true, frequency_days: 7, last_run_at: '2026-08-12T13:00:00Z' }, now),
    ).toBe(false)
  })

  it('a failed run does not advance the clock — retries next tick', () => {
    // The scheduler only writes last_run_at on success, so a failure yesterday
    // leaves last_run_at at the previous success and the tool stays due.
    expect(
      isDue({ enabled: true, frequency_days: 7, last_run_at: '2026-08-01T13:00:00Z' }, now),
    ).toBe(true)
  })
})
