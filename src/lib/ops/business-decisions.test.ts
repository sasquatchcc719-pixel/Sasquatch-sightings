// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ queues: vi.fn() }))
vi.mock('@/lib/mcp/operations', () => ({ getOperationalSummary: mocks.queues }))
import {
  buildBusinessDecisionSnapshot,
  decisionPeriods,
  loadBusinessDecisionSnapshot,
  type DecisionJob,
} from './business-decisions'

const now = new Date('2026-11-09T20:00:00Z')
function job(overrides: Partial<DecisionJob> = {}): DecisionJob {
  return {
    id: 'job-1',
    appointment_date: '2026-11-04',
    status: 'completed',
    kind: 'service',
    quoted_total: 500,
    customer: { is_internal: false },
    invoices: [
      { id: 'invoice-1', total: 450, status: 'paid', payment_status: 'paid' },
    ],
    lead_source: 'Nextdoor',
    ...overrides,
  }
}
const build = (jobs: DecisionJob[] | null) =>
  buildBusinessDecisionSnapshot({ jobs, queues: [], now })
afterEach(() => vi.restoreAllMocks())

describe('business decision metric contract', () => {
  it('uses equal completed Denver weeks, including UTC Monday before local Monday', () => {
    expect(decisionPeriods(now)).toEqual({
      last_week: { start: '2026-11-02', end: '2026-11-08' },
      current: { start: '2026-10-12', end: '2026-11-08' },
      previous: { start: '2026-09-14', end: '2026-10-11' },
      upcoming: { start: '2026-11-09', end: '2026-11-15' },
    })
    expect(
      decisionPeriods(new Date('2026-11-09T06:30:00Z')).last_week.end,
    ).toBe('2026-11-01')
  })
  it('uses the actual invoice instead of a stale quote and retains record evidence', () => {
    const snapshot = build([job()])
    expect(snapshot.performance?.last_week).toMatchObject({
      completed_visits: 1,
      invoice_covered_visits: 1,
      invoiced_value: 450,
      marked_paid_value: 450,
      quoted_value: 500,
      quote_invoice_difference: 50,
    })
    expect(snapshot.reconciliation[0]).toMatchObject({
      appointment_id: 'job-1',
      issue: 'quote_difference',
      invoice: 450,
    })
    expect(snapshot.reconciliation[0].links[1]).toMatchObject({
      record_id: 'invoice-1',
      entity: 'invoice',
    })
    expect(snapshot.coverage.definitions.join(' ')).toContain(
      'not cash collected',
    )
  })
  it('preserves valid fully discounted zero invoices', () => {
    const result = build([
      job({
        invoices: [
          { id: 'i', total: 0, status: 'ready', payment_status: 'waived' },
        ],
      }),
    ])
    expect(result.performance?.current).toMatchObject({
      invoice_covered_visits: 1,
      invoiced_value: 0,
      quoted_value: 500,
    })
  })
  it('does not replace missing, draft, multiple or invalid invoices with quotes', () => {
    const jobs = [
      job({ invoices: [] }),
      job({
        id: 'draft',
        invoices: [
          { id: 'i', total: 500, status: 'draft', payment_status: 'unpaid' },
        ],
      }),
      job({
        id: 'many',
        invoices: [job().invoices[0], { ...job().invoices[0], id: 'second' }],
      }),
      job({
        id: 'void',
        invoices: [
          { id: 'v', total: 500, status: 'void', payment_status: 'unpaid' },
        ],
      }),
    ]
    const result = build(jobs)
    expect(result.performance?.current).toMatchObject({
      completed_visits: 4,
      invoice_covered_visits: 0,
      invoiced_value: 0,
      missing_invoice_visits: 1,
      draft_invoice_visits: 1,
      ambiguous_invoice_visits: 2,
    })
    expect(result.performance?.invoiced_value_change).toBeNull()
    expect(result.coverage.status).toBe('partial')
    expect(result.decisions[0].id).toBe('invoice_coverage')
  })
  it('separates consolidated billing, project work, warranty and internal visits without double-counting', () => {
    const rows = [
      job(),
      job({ id: 'cancel', status: 'cancelled' }),
      job({ id: 'estimate', kind: 'estimate' }),
      job({ id: 'internal', customer: { is_internal: true } }),
      job({ id: 'warranty', service_concern_id: 'concern' }),
      job({
        id: 'warranty-old',
        ops_appointment_line_items: [{ name_snapshot: 'Warranty re-clean' }],
      }),
      job({ id: 'restoration', kind: 'restoration' }),
      job({ id: 'batch', recurring: { invoice_mode: 'batch_monthly' } }),
      job({
        id: 'monthly',
        customer: { is_internal: false, billing_mode: 'monthly_consolidated' },
      }),
      job({ id: 'entry', batch_entries: [{ id: 'entry' }] }),
      job({ id: 'batch-marker', batch_billing_customer_id: 'monthly-account' }),
    ]
    expect(build(rows).performance?.current).toMatchObject({
      completed_visits: 1,
      invoiced_value: 450,
      internal_visits: 1,
      warranty_visits: 2,
      restoration_visits: 1,
      consolidated_billing_visits: 4,
    })
  })
  it('fails monetary and upcoming coverage closed when customer classification is missing', () => {
    const result = build([job({ customer: null })])
    expect(result.performance).toBeNull()
    expect(result.upcoming).toBeNull()
    expect(result.lead_sources).toEqual([])
    expect(result.coverage.status).toBe('partial')
    expect(result.coverage.missing[0]).toContain('no customer classification')
  })
  it('exposes incomplete prior-period invoice coverage instead of a false growth comparison', () => {
    const result = build([
      job(),
      job({ id: 'old-missing', appointment_date: '2026-09-30', invoices: [] }),
    ])
    expect(result.performance?.invoiced_value_change).toBeNull()
    expect(result.coverage.status).toBe('partial')
    expect(result.coverage.missing[0]).toContain(
      'previous four-week invoice coverage: 0 of 1',
    )
    expect(result.lead_sources[0]).toMatchObject({
      previous_completed_visits: 1,
      previous_invoice_covered_visits: 0,
    })
    expect(result.decisions[0].id).toBe('invoice_coverage')
    expect(result.decisions[0].links[0].record_id).toBe('old-missing')
  })
  it('keeps upcoming assignments ahead of historical invoice reconciliation', () => {
    const result = buildBusinessDecisionSnapshot({
      jobs: [job({ invoices: [] })],
      now,
      queues: [
        {
          name: 'unassigned_jobs',
          count: 1,
          status: 'available',
          window: 'Next seven days',
          note: null,
          items: [],
        },
        {
          name: 'unanswered_messages',
          count: 5,
          status: 'available',
          window: 'Newest threads',
          note: null,
          items: [],
        },
      ],
    })
    expect(result.decisions.map((d) => d.id)).toEqual([
      'unassigned_jobs',
      'invoice_coverage',
      'unanswered_messages',
    ])
  })
  it('normalizes recorded labels but keeps missing and repeat customers distinct', () => {
    const result = build([
      job({ lead_source: 'Google' }),
      job({ id: 'missing', lead_source: null }),
      job({ id: 'other', lead_source: 'other' }),
      job({ id: 'repeat', lead_source: 'repeat_customer' }),
    ])
    expect(result.lead_sources.map((s) => s.key).sort()).toEqual([
      'google_search',
      'other',
      'repeat_customer',
      'unknown',
    ])
    expect(result.lead_sources.find((s) => s.key === 'unknown')?.label).toBe(
      'Not recorded',
    )
  })
  it('compares equal invoice-covered cohorts and does not divide by zero', () => {
    const result = build([
      job(),
      job({
        id: 'old',
        appointment_date: '2026-09-30',
        invoices: [
          { id: 'old', total: 300, status: 'ready', payment_status: 'unpaid' },
        ],
      }),
      job({ id: 'this-week', appointment_date: '2026-11-09' }),
    ])
    expect(result.performance).toMatchObject({
      invoiced_value_change: 150,
      invoiced_value_change_pct: 50,
    })
    expect(build([job()]).performance?.invoiced_value_change_pct).toBeNull()
  })
  it('surfaces opposing visit-volume and invoice-value movements without claiming profit or causation', () => {
    const result = build([
      job(),
      job({
        id: 'old-1',
        appointment_date: '2026-09-30',
        invoices: [
          { id: 'i1', total: 100, status: 'paid', payment_status: 'paid' },
        ],
      }),
      job({
        id: 'old-2',
        appointment_date: '2026-10-01',
        invoices: [
          { id: 'i2', total: 100, status: 'paid', payment_status: 'paid' },
        ],
      }),
    ])
    expect(result.decisions[0]).toMatchObject({
      id: 'volume_value_mix',
      title: 'Fewer visits, higher average invoice',
    })
    expect(result.decisions[0].evidence).toContain(
      '1 completed visits versus 2',
    )
    expect(result.decisions[0].evidence).toContain('$450.00 versus $100.00')
    expect(result.decisions[0].links[0].record_id).toBe('job-1')
    expect(result.decisions[0].next_step).toContain('do not measure profit')
  })
  it('labels upcoming values as quotes and excludes parked/cancelled/completed work', () => {
    const result = build([
      job({ status: 'scheduled', appointment_date: '2026-11-09' }),
      job({
        id: 'parked',
        status: 'scheduled',
        appointment_date: '2026-11-10',
        parked_at: '2026-11-01',
      }),
      job({
        id: 'cancelled',
        status: 'cancelled',
        appointment_date: '2026-11-10',
      }),
    ])
    expect(result.upcoming).toMatchObject({
      scheduled_visits: 1,
      quoted_value: 500,
      unassigned_visits: 1,
    })
    expect(result.upcoming?.note).toContain(
      'do not measure remaining availability',
    )
  })
  it('preserves queue scope and never claims unread means unanswered or unpaid means overdue', () => {
    const result = buildBusinessDecisionSnapshot({
      jobs: [],
      now,
      queues: [
        {
          name: 'scheduling_conflicts',
          count: null,
          status: 'unavailable',
          window: 'future',
          note: 'unsupported',
          items: [],
        },
        {
          name: 'unanswered_messages',
          count: 2,
          status: 'partial',
          window: 'Newest 500 threads',
          note: 'lower bound',
          items: [
            {
              id: 'conversation-id',
              phone: '+17195551234',
              app_url:
                'https://sightings.sasquatchcarpet.com/admin/conversations',
            },
          ],
        },
        {
          name: 'unpaid_invoices',
          count: 1,
          status: 'available',
          window: 'all collectible',
          note: null,
          items: [],
        },
      ],
    })
    expect(result.queues).toHaveLength(2)
    expect(result.coverage.missing).toEqual(['unanswered_messages: partial'])
    expect(result.decisions[0].evidence).toContain('At least 2')
    expect(result.decisions[0].next_step).toContain(
      'Unread is not the same as unanswered',
    )
    expect(result.decisions[1].next_step).toContain(
      'does not mean these invoices are overdue',
    )
    expect(result.queues[0].links[0]).toMatchObject({
      record_id: 'conversation-id',
      entity: 'conversation',
      url: 'https://sightings.sasquatchcarpet.com/admin/conversations?phone=%2B17195551234',
    })
  })
  it('does not turn a failed data source into zero performance', () => {
    const result = buildBusinessDecisionSnapshot({
      jobs: null,
      now,
      queues: [],
      missing: ['Source unavailable'],
    })
    expect(result.performance).toBeNull()
    expect(result.upcoming).toBeNull()
    expect(result.coverage.status).toBe('partial')
  })
})

describe('read-only loader', () => {
  function fixture(
    pages: Array<{
      data: DecisionJob[] | null
      error: { message: string } | null
    }>,
  ) {
    const reads: Array<[string, unknown[]]> = []
    let page = 0
    const q: Record<string, unknown> = {}
    for (const method of ['select', 'gte', 'lte', 'order', 'range'])
      q[method] = (...args: unknown[]) => {
        reads.push([method, args])
        return q
      }
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(pages[page++]).then(resolve)
    return { db: { from: vi.fn(() => q) } as unknown as SupabaseClient, reads }
  }
  it('paginates and reads only, while tolerating unavailable queues', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.queues.mockRejectedValueOnce(new Error('offline'))
    const f = fixture([
      {
        data: Array.from({ length: 500 }, (_, n) => job({ id: `j${n}` })),
        error: null,
      },
      { data: [job({ id: 'last' })], error: null },
    ])
    const result = await loadBusinessDecisionSnapshot(f.db, now)
    expect(result.performance?.current.completed_visits).toBe(501)
    expect(f.reads.filter((r) => r[0] === 'range')).toEqual([
      ['range', [0, 499]],
      ['range', [500, 999]],
    ])
    expect(result.coverage.status).toBe('partial')
    expect(result.coverage.missing).toContain(
      'Operational attention queues unavailable.',
    )
  })
  it('fails closed on appointment query errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.queues.mockResolvedValueOnce({ queues: [] })
    const f = fixture([{ data: null, error: { message: 'offline' } }])
    const result = await loadBusinessDecisionSnapshot(f.db, now)
    expect(result.performance).toBeNull()
    expect(result.coverage.status).toBe('partial')
  })
})
