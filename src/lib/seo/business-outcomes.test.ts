// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  businessPeriod,
  loadBusinessOutcomes,
  summarizeBusinessOutcomes,
} from './business-outcomes'
const period = { start: '2026-11-02', end: '2026-11-08' }
const quote = (session_id = 's1', overrides = {}) => ({
  id: `q-${session_id}`,
  session_id,
  step: 'quote_started',
  created_at: '2026-11-04T18:00:00Z',
  appointment_id: null,
  referrer: null,
  is_test: false,
  ...overrides,
})
const booked = (session_id = 's1', appointment_id = 'a1', overrides = {}) =>
  quote(session_id, {
    id: `b-${session_id}`,
    step: 'booked',
    appointment_id,
    created_at: '2026-11-04T18:05:00Z',
    ...overrides,
  })
const appointment = (id = 'a1', overrides = {}) => ({
  id,
  status: 'booked',
  kind: 'service',
  lead_source_key: 'repeat_customer',
  ops_customers: { is_internal: false },
  ops_service_addresses: { city: 'Monument', town_slug: null },
  ...overrides,
})
function database(
  results: Record<string, Array<{ data: unknown; error?: unknown }>>,
) {
  const queries: Array<{ table: string; query: any }> = []
  const from = vi.fn((table: string) => {
    const q: any = {}
    for (const name of [
      'select',
      'eq',
      'in',
      'gte',
      'lt',
      'lte',
      'order',
      'range',
    ])
      q[name] = vi.fn(() => q)
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(results[table]?.shift() ?? { data: [] }).then(resolve)
    queries.push({ table, query: q })
    return q
  })
  return { db: { from } as unknown as SupabaseClient, queries }
}
describe('exact quote-to-booking evidence', () => {
  it('uses the last completed Mountain week on Mondays and Sundays, including DST', () => {
    expect(businessPeriod(new Date('2026-11-09T07:01:00Z'))).toEqual(period)
    expect(businessPeriod(new Date('2026-11-09T06:59:00Z'))).toEqual({
      start: '2026-10-26',
      end: '2026-11-01',
    })
    expect(businessPeriod(new Date('2026-11-02T07:01:00Z'))).toEqual({
      start: '2026-10-26',
      end: '2026-11-01',
    })
  })
  it('deduplicates repeat events, sessions and appointments without calling sessions people', () => {
    const r = summarizeBusinessOutcomes(
      [quote(), quote(), booked(), booked(), quote('s2'), booked('s2')],
      [appointment()],
      period,
    )
    expect(r).toMatchObject({
      quoteSessions: 2,
      appointments: 1,
      open: 1,
      completed: 0,
    })
    expect(r.byTown).toEqual([
      {
        town: 'Monument',
        appointments: 1,
        open: 1,
        completed: 0,
        cancelled: 0,
        other: 0,
      },
    ])
  })
  it('keeps repeat/Nextdoor sources and Google referrer evidence separate', () => {
    const r = summarizeBusinessOutcomes(
      [
        quote('s1', { referrer: 'https://www.google.com/' }),
        booked(),
        quote('s2'),
        booked('s2', 'a2'),
      ],
      [
        appointment(),
        appointment('a2', { lead_source_key: 'nextdoor', status: 'completed' }),
      ],
      period,
    )
    expect(r.googleReferrerAppointments).toBe(1)
    expect(r.recordedSources).toEqual([
      { label: 'Nextdoor', appointments: 1 },
      { label: 'Repeat customer', appointments: 1 },
    ])
    expect(r.completed).toBe(1)
    expect(JSON.stringify(r)).not.toContain('organic')
  })
  it('counts cancellations separately, never as open or completed', () => {
    const r = summarizeBusinessOutcomes(
      [quote(), booked()],
      [appointment('a1', { status: 'cancelled' })],
      period,
    )
    expect(r).toMatchObject({
      appointments: 1,
      cancelled: 1,
      open: 0,
      completed: 0,
    })
  })
  it('excludes whole test and internal sessions even when only one event is flagged', () => {
    const r = summarizeBusinessOutcomes(
      [
        quote(),
        booked('s1', 'a1', { is_test: true }),
        quote('s2'),
        booked('s2', 'a2'),
      ],
      [
        appointment(),
        appointment('a2', { ops_customers: { is_internal: true } }),
      ],
      period,
    )
    expect(r).toMatchObject({
      quoteSessions: 0,
      appointments: 0,
      excludedQuoteSessions: 2,
    })
  })
  it('keeps missing, ambiguous, non-service and unverified-customer links unresolved', () => {
    const r = summarizeBusinessOutcomes(
      [
        quote('s1'),
        booked('s1', 'missing'),
        quote('s2'),
        booked('s2', 'a2'),
        booked('s2', 'a3'),
        quote('s3'),
        booked('s3', 'a3'),
        quote('s4'),
        booked('s4', 'a4'),
        quote('s5'),
        booked('s5', 'a5', { appointment_id: null }),
      ],
      [
        appointment('a2'),
        appointment('a3', { kind: 'estimate' }),
        appointment('a4', { ops_customers: null }),
      ],
      period,
    )
    expect(r).toMatchObject({
      quoteSessions: 5,
      unresolvedQuoteSessions: 5,
      appointments: 0,
    })
  })
  it('does not infer bookings, lost leads, sources or towns for unlinked quotes', () => {
    const r = summarizeBusinessOutcomes(
      [quote('s1', { referrer: 'https://www.google.com/' })],
      [],
      period,
    )
    expect(r).toMatchObject({
      quoteSessions: 1,
      unlinkedQuoteSessions: 1,
      appointments: 0,
      byTown: [],
      recordedSources: [],
    })
  })
  it('retains explicit unknown town/source and does not guess a city typo', () => {
    const r = summarizeBusinessOutcomes(
      [quote(), booked()],
      [
        appointment('a1', {
          lead_source_key: null,
          ops_service_addresses: { town_slug: null, city: 'Woodmorr' },
          status: 'unknown',
        }),
      ],
      period,
    )
    expect(r.byTown[0]).toMatchObject({ town: 'Unknown', other: 1 })
    expect(r.recordedSources).toEqual([
      { label: 'Unknown / unrecognized', appointments: 1 },
    ])
  })
  it('uses saved town then existing exact aliases rather than landing pages or ZIPs', () => {
    const r = summarizeBusinessOutcomes(
      [quote(), booked()],
      [
        appointment('a1', {
          ops_service_addresses: { town_slug: 'palmer-lake', city: 'Monument' },
        }),
      ],
      period,
    )
    expect(r.byTown[0].town).toBe('Palmer Lake')
    const typo = summarizeBusinessOutcomes(
      [quote(), booked()],
      [
        appointment('a1', {
          ops_service_addresses: { town_slug: null, city: 'Monumnet' },
        }),
      ],
      period,
    )
    expect(typo.byTown[0].town).toBe('Monument')
  })
  it('uses first-quote Mountain dates and allows later linked bookings', () => {
    const r = summarizeBusinessOutcomes(
      [
        quote('s1', { created_at: '2026-11-02T06:59:59Z' }),
        booked(),
        quote('s2', { created_at: '2026-11-09T06:59:59Z' }),
        booked('s2', 'a2', { created_at: '2026-11-10T08:00:00Z' }),
        quote('s3', { created_at: '2026-11-09T07:00:00Z' }),
        booked('s3', 'a3'),
      ],
      [appointment(), appointment('a2'), appointment('a3')],
      period,
    )
    expect(r).toMatchObject({ quoteSessions: 1, appointments: 1 })
  })
  it('rejects a booking link recorded before its quote', () => {
    const r = summarizeBusinessOutcomes(
      [quote(), booked('s1', 'a1', { created_at: '2026-11-03T18:00:00Z' })],
      [appointment()],
      period,
    )
    expect(r).toMatchObject({ appointments: 0, unresolvedQuoteSessions: 1 })
  })
  it('loads exact links read-only with snapshot cutoff, deterministic pagination and no PII', async () => {
    const { db, queries } = database({
      booking_funnel_events: [
        { data: [quote()] },
        { data: [quote(), booked()] },
      ],
      ops_appointments: [{ data: [appointment()] }],
    })
    const now = new Date('2026-11-10T12:00:00Z')
    const result = await loadBusinessOutcomes(db, now)
    expect(result).toMatchObject({
      state: 'partial',
      period,
      measuredAt: now.toISOString(),
      summary: '1 recorded quote sessions · 1 distinct linked appointments.',
    })
    expect(queries[1].query.lte).toHaveBeenCalledWith(
      'created_at',
      now.toISOString(),
    )
    expect(queries[2].query.in).toHaveBeenCalledWith('id', ['a1'])
    for (const { query } of queries) {
      expect(query.order).toHaveBeenCalledWith('id')
      expect(query.range).toHaveBeenCalledWith(0, 499)
    }
    expect(JSON.stringify(queries[2].query.select.mock.calls)).not.toMatch(
      /phone|email|street|full_name/,
    )
  })
  it('paginates instead of silently truncating quote cohorts', async () => {
    const first = Array.from({ length: 500 }, (_, i) => quote(`s${i}`))
    const { db, queries } = database({
      booking_funnel_events: [
        { data: first },
        { data: [] },
        ...Array.from({ length: 5 }, (_, i) => ({
          data: first.slice(i * 100, (i + 1) * 100),
        })),
      ],
    })
    const result = await loadBusinessOutcomes(
      db,
      new Date('2026-11-10T12:00:00Z'),
    )
    expect(result.businessOutcomes?.quoteSessions).toBe(500)
    expect(queries[1].query.range).toHaveBeenCalledWith(500, 999)
  })
  it('throws on failed/missing/incomplete reads rather than publishing zero', async () => {
    for (const data of [null]) {
      const { db } = database({ booking_funnel_events: [{ data }] })
      await expect(
        loadBusinessOutcomes(db, new Date('2026-11-10T12:00:00Z')),
      ).rejects.toThrow('Missing')
    }
    const { db } = database({
      booking_funnel_events: [{ data: [quote()] }, { data: [] }],
    })
    await expect(
      loadBusinessOutcomes(db, new Date('2026-11-10T12:00:00Z')),
    ).rejects.toThrow('Incomplete')
    const failure = database({
      booking_funnel_events: [{ data: [], error: new Error('offline') }],
    })
    await expect(
      loadBusinessOutcomes(failure.db, new Date('2026-11-10T12:00:00Z')),
    ).rejects.toThrow('offline')
  })
})
