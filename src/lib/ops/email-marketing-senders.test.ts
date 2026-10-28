// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  send: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => mocks.db }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: vi.fn(async () => false) }))
vi.mock('@/lib/ops/business-health', () => ({
  loadCustomerValueIndex: vi.fn(async () => new Map()),
}))

import { enrollCustomerInDrip, processDripEmails } from './drip-campaign'
import {
  enrollEligibleReactivationCustomers,
  processReactivationEmails,
} from './reactivation-campaign'

type Row = Record<string, unknown>
type PreferenceMode =
  | 'none'
  | 'suppressed'
  | 'error'
  | 'suppressed_after_audience'
  | 'error_after_audience'

function fakeDb(mode: PreferenceMode = 'none') {
  const customer = {
    id: 'customer-a',
    email: '  Office@Example.com  ',
    email_opt_out: false,
    phone: null,
    full_name: 'Example Office',
    first_name: 'Example',
    created_at: '2025-01-01T00:00:00Z',
    ops_service_addresses: [],
  }
  const tables: Record<string, Row[]> = {
    ops_customers: [customer],
    ops_appointments: [
      {
        id: 'appointment-a',
        customer_id: customer.id,
        appointment_date: '2025-01-01',
        completed_at: '2025-01-01T12:00:00Z',
        status: 'completed',
        recurring_template_id: null,
        kind: 'service',
        visit_type: null,
        restoration_project_id: null,
        service_concern_id: null,
        ops_customers: customer,
        ops_service_addresses: { city: 'Monument' },
        ops_appointment_line_items: [],
      },
    ],
    drip_email_templates: [
      {
        step_index: 0,
        label: 'Example marketing',
        delay_days: 180,
        subject_template: 'Hello {{first_name}}',
        body_template: 'Example promotion',
        is_enabled: true,
      },
    ],
    drip_campaign_enrollments: [],
    drip_email_log: [],
    reactivation_settings: [
      {
        id: true,
        engine_enabled: true,
        daily_send_cap: 5,
        cadence_days: 30,
        dormancy_months: 6,
        max_messages: 6,
      },
    ],
    reactivation_campaign_enrollments: [
      {
        id: 'reactivation-a',
        customer_id: customer.id,
        status: 'active',
        messages_sent: 0,
        next_send_at: '2026-10-28',
        manual_suppressed_at: null,
      },
    ],
    reactivation_email_templates: [
      {
        id: 'template-a',
        template_key: 'reconnect',
        rotation_order: 0,
        is_enabled: true,
        is_strong_offer: false,
        subject_template: 'Hello {{first_name}}',
        body_template: 'Example promotion',
      },
    ],
    reactivation_email_log: [],
    blacklist: [],
  }
  const writes: { table: string; kind: string; payload: Row }[] = []
  const preferenceQueries: unknown[][] = []

  class Query implements PromiseLike<{ data: unknown; error: unknown }> {
    filters: ((row: Row) => boolean)[] = []
    operation = 'select'
    payload: Row = {}
    one = false
    columns = ''
    constructor(readonly table: string) {}
    select(columns: string) {
      this.columns = columns
      return this
    }
    eq(key: string, value: unknown) {
      this.filters.push((row) => row[key] === value)
      return this
    }
    neq(key: string, value: unknown) {
      this.filters.push((row) => row[key] !== value)
      return this
    }
    is(key: string, value: unknown) {
      return this.eq(key, value)
    }
    in(key: string, values: unknown[]) {
      if (this.table === 'email_marketing_suppressions')
        preferenceQueries.push(values)
      this.filters.push((row) => values.includes(row[key]))
      return this
    }
    lt(key: string, value: number) {
      this.filters.push((row) => Number(row[key]) < value)
      return this
    }
    lte(key: string, value: string) {
      this.filters.push((row) => String(row[key]) <= value)
      return this
    }
    order() {
      return this
    }
    limit() {
      return this
    }
    single() {
      this.one = true
      return this
    }
    maybeSingle() {
      this.one = true
      return this
    }
    update(payload: Row) {
      this.operation = 'update'
      this.payload = payload
      return this
    }
    upsert(payload: Row) {
      this.operation = 'upsert'
      this.payload = payload
      return this
    }
    insert(payload: Row) {
      this.operation = 'insert'
      this.payload = payload
      return this
    }
    async execute() {
      if (this.table === 'email_marketing_suppressions') {
        const afterAudience = preferenceQueries.length > 1
        if (
          mode === 'error' ||
          (mode === 'error_after_audience' && afterAudience)
        ) {
          return { data: null, error: { message: 'Fixture lookup failure' } }
        }
        const blocked =
          mode === 'suppressed' ||
          (mode === 'suppressed_after_audience' && afterAudience)
        return {
          data: blocked ? [{ email: 'office@example.com' }] : [],
          error: null,
        }
      }
      const table = tables[this.table]
      if (!table) throw new Error(`Unexpected fixture table ${this.table}`)
      let rows = table.filter((row) =>
        this.filters.every((filter) => filter(row)),
      )
      if (this.operation !== 'select') {
        writes.push({
          table: this.table,
          kind: this.operation,
          payload: { ...this.payload },
        })
        if (this.operation === 'update')
          rows.forEach((row) => Object.assign(row, this.payload))
        else if (this.operation === 'upsert') {
          const existing = table.find(
            (row) => row.customer_id === this.payload.customer_id,
          )
          if (existing) Object.assign(existing, this.payload)
          else
            table.push({
              id: `fixture-${table.length}`,
              messages_sent: 0,
              ...this.payload,
            })
        } else table.push({ ...this.payload })
      }
      if (
        this.table === 'reactivation_campaign_enrollments' &&
        this.columns.includes('ops_customers')
      ) {
        rows = rows.map((row) => ({
          ...row,
          ops_customers: tables.ops_customers.find(
            (customer) => customer.id === row.customer_id,
          ),
        }))
      }
      return { data: this.one ? rows[0] || null : rows, error: null }
    }
    then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: unknown
            error: unknown
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): PromiseLike<TResult1 | TResult2> {
      return this.execute().then(onfulfilled, onrejected)
    }
  }
  return {
    from: (table: string) => new Query(table),
    tables,
    writes,
    preferenceQueries,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T18:00:00Z'))
  vi.stubEnv('RESEND_API_KEY', 'mock-provider-key')
  vi.stubEnv('DRIP_HMAC_SECRET', 'local-unit-test-signing-key')
  mocks.send
    .mockReset()
    .mockResolvedValue({ data: { id: 'mock-delivery' }, error: null })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('marketing sender preference enforcement', () => {
  function dripFixture(mode: PreferenceMode) {
    const db = fakeDb(mode)
    db.tables.drip_campaign_enrollments.push({
      id: 'drip-a',
      customer_id: 'customer-a',
      appointment_id: 'appointment-a',
      current_step: 0,
      status: 'active',
      next_send_at: '2026-10-28',
    })
    mocks.db = db
    return db
  }

  it('drip consults the normalized-email ledger and never calls the provider for an opt-out', async () => {
    const db = dripFixture('suppressed')
    expect(await processDripEmails()).toMatchObject({ sent: 0, skipped: 1 })
    expect(db.preferenceQueries).toEqual([['office@example.com']])
    expect(mocks.send).not.toHaveBeenCalled()
    expect(db.tables.ops_customers[0].email_opt_out).toBe(false)
  })

  it('drip fails closed when suppression cannot be checked', async () => {
    dripFixture('error')
    expect(await processDripEmails()).toMatchObject({ sent: 0, failed: 1 })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('an eligible drip still reaches the mocked provider', async () => {
    dripFixture('none')
    expect(await processDripEmails()).toMatchObject({ sent: 1, failed: 0 })
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Hello Example',
        headers: {
          'List-Unsubscribe': expect.stringMatching(
            /^<https:\/\/.+\/api\/public\/unsubscribe\?cid=customer-a&token=[a-f0-9]{64}>$/,
          ),
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    )
  })

  it('drip enrollment rejects a newly imported duplicate of a suppressed mailbox', async () => {
    const db = fakeDb('suppressed')
    db.tables.ops_customers[0].id = 'new-duplicate'
    db.tables.ops_appointments[0].customer_id = 'new-duplicate'
    mocks.db = db
    await enrollCustomerInDrip('appointment-a')
    expect(db.preferenceQueries).toEqual([['office@example.com']])
    expect(db.writes).toEqual([])
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('drip enrollment throws on unknown preferences before saving an enrollment', async () => {
    const db = fakeDb('error')
    mocks.db = db
    await expect(enrollCustomerInDrip('appointment-a')).rejects.toThrow(
      'Marketing preferences could not be verified',
    )
    expect(db.writes).toEqual([])
  })

  it('recalculation preserves suppression and blocks a duplicate customer sharing its email', async () => {
    const db = fakeDb('suppressed')
    db.tables.reactivation_campaign_enrollments[0].status =
      'suppressed_unsubscribed'
    db.tables.ops_customers.push({
      ...db.tables.ops_customers[0],
      id: 'new-duplicate',
      email: 'office@example.com',
    })
    mocks.db = db
    await enrollEligibleReactivationCustomers()
    const enrollmentWrites = db.writes.filter(
      (write) => write.table === 'reactivation_campaign_enrollments',
    )
    expect(enrollmentWrites).toHaveLength(2)
    for (const write of enrollmentWrites) {
      expect(write.payload).toMatchObject({
        status: 'suppressed_unsubscribed',
        next_send_at: null,
        stop_reason: 'marketing_email_opt_out',
      })
    }
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('reactivation recalculation fails closed without writing an audience', async () => {
    const db = fakeDb('error')
    mocks.db = db
    await expect(enrollEligibleReactivationCustomers()).rejects.toThrow(
      'Marketing preferences could not be verified',
    )
    expect(db.writes).toEqual([])
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('reactivation rechecks after its audience snapshot and blocks a fresh unsubscribe', async () => {
    const db = fakeDb('suppressed_after_audience')
    mocks.db = db
    const pending = processReactivationEmails()
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ sent: 0, skipped: 1 })
    expect(db.preferenceQueries).toEqual([
      ['office@example.com'],
      ['office@example.com'],
    ])
    expect(mocks.send).not.toHaveBeenCalled()
    expect(db.tables.reactivation_campaign_enrollments[0].status).toBe(
      'suppressed_unsubscribed',
    )
  })

  it('a reactivation send-time lookup failure prevents any provider call', async () => {
    const db = fakeDb('error_after_audience')
    mocks.db = db
    const pending = processReactivationEmails()
    const rejected = expect(pending).rejects.toThrow(
      'Marketing preferences could not be verified',
    )
    await vi.runAllTimersAsync()
    await rejected
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('an eligible reactivation still reaches the mocked provider', async () => {
    const db = fakeDb('none')
    mocks.db = db
    const pending = processReactivationEmails()
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ sent: 1, failed: 0 })
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'office@example.com',
        headers: {
          'List-Unsubscribe': expect.stringMatching(
            /^<https:\/\/.+\/api\/public\/unsubscribe\?cid=customer-a&token=[a-f0-9]{64}>$/,
          ),
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      { idempotencyKey: 'reactivation/reactivation-a/1' },
    )
  })
})
