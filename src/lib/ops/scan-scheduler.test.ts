import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ grid: vi.fn(), falcon: vi.fn() }))
vi.mock('@/lib/radar-grid', () => ({ runGridScan: mocks.grid }))
vi.mock('@/lib/local-falcon', () => ({
  runScan: mocks.falcon,
  scanCost: () => 49,
}))
import { isDue, runDueScans } from './scan-scheduler'

const now = new Date('2026-08-17T13:00:00Z')

describe('isDue', () => {
  it('never fires when disabled, even if overdue', () => {
    expect(
      isDue({ enabled: false, frequency_days: 7, last_run_at: null }, now),
    ).toBe(false)
  })

  it('fires immediately when never run', () => {
    expect(
      isDue({ enabled: true, frequency_days: 7, last_run_at: null }, now),
    ).toBe(true)
  })

  it('fires when exactly one interval has passed', () => {
    expect(
      isDue(
        {
          enabled: true,
          frequency_days: 7,
          last_run_at: '2026-08-10T13:00:00Z',
        },
        now,
      ),
    ).toBe(true)
  })

  it('waits when inside the interval', () => {
    expect(
      isDue(
        {
          enabled: true,
          frequency_days: 7,
          last_run_at: '2026-08-12T13:00:00Z',
        },
        now,
      ),
    ).toBe(false)
  })

  it('an overdue historical schedule remains due', () => {
    expect(
      isDue(
        {
          enabled: true,
          frequency_days: 7,
          last_run_at: '2026-08-01T13:00:00Z',
        },
        now,
      ),
    ).toBe(true)
  })
})

it('runs on day seven despite completion seconds after the cron tick', () => {
  expect(
    isDue(
      { enabled: true, frequency_days: 7, last_run_at: '2026-08-10T13:02:59Z' },
      now,
    ),
  ).toBe(true)
  expect(
    isDue(
      { enabled: true, frequency_days: 7, last_run_at: '2026-08-10T13:02:59Z' },
      new Date('2026-08-16T23:59:59Z'),
    ),
  ).toBe(false)
})
it('invalid persisted dates do not cause an unbounded paid retry', () => {
  expect(
    isDue({ enabled: true, frequency_days: 7, last_run_at: 'bad' }, now),
  ).toBe(false)
})
function db(claimed = true, failSave = false) {
  const updates: any[] = []
  const q: any = {}
  let mode = 'read'
  q.select = vi.fn(() => q)
  q.update = vi.fn((v: any) => {
    updates.push(v)
    mode = 'update'
    return q
  })
  q.eq = vi.fn(() => q)
  q.is = vi.fn(() => q)
  q.maybeSingle = vi
    .fn()
    .mockResolvedValue({
      data: claimed ? { id: 'schedule' } : null,
      error: null,
    })
  q.then = (resolve: any) =>
    Promise.resolve(
      mode === 'read'
        ? {
            data: [
              {
                id: 'schedule',
                tool: 'dataforseo_grid',
                enabled: true,
                frequency_days: 7,
                last_run_at: '2026-08-10T13:02:59Z',
                config: {},
              },
            ],
            error: null,
          }
        : { error: failSave ? new Error('save failed') : null },
    ).then(resolve)
  return { client: { from: () => q } as unknown as SupabaseClient, updates, q }
}
describe('paid scan attempt handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())
  it('claims before the provider and preserves the start date', async () => {
    const d = db()
    mocks.grid.mockImplementation(async () => {
      expect(d.updates[0].last_result).toMatch(/RUNNING/)
      return { scanId: 'scan', pointsScanned: 141 }
    })
    const result = await runDueScans(d.client)
    expect(result.fired).toEqual(['dataforseo_grid'])
    expect(d.updates[0].last_run_at).toBe(now.toISOString())
    expect(d.updates[1]).not.toHaveProperty('last_run_at')
    expect(d.q.eq).toHaveBeenCalledWith('last_run_at', now.toISOString())
    expect(d.q.eq).toHaveBeenCalledWith('last_run_at', '2026-08-10T13:02:59Z')
  })
  it('does not execute an already claimed attempt', async () => {
    const d = db(false)
    expect((await runDueScans(d.client)).skipped).toEqual(['dataforseo_grid'])
    expect(mocks.grid).not.toHaveBeenCalled()
  })
  it('surfaces partial result and keeps normal cadence instead of daily paid retries', async () => {
    const d = db()
    mocks.grid.mockResolvedValue({
      scanId: 'scan',
      pointsScanned: 80,
      error: 'provider failed',
    })
    const r = await runDueScans(d.client)
    expect(r.fired).toEqual([])
    expect(r.errors.dataforseo_grid).toMatch(/incomplete/)
    expect(d.updates[0].last_run_at).toBe(now.toISOString())
    expect(d.updates[1].last_result).toMatch(/^ERROR/)
    expect(d.updates[1]).not.toHaveProperty('last_run_at')
  })
  it('reports schedule persistence failure without rerunning provider', async () => {
    const d = db(true, true)
    mocks.grid.mockResolvedValue({ scanId: 'scan', pointsScanned: 141 })
    const r = await runDueScans(d.client)
    expect(r.errors.dataforseo_grid).toMatch(/persist failure/)
    expect(mocks.grid).toHaveBeenCalledTimes(1)
  })
})
