import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  planRecurringSchedule,
  type RecurringCandidate,
} from './recurring-scheduling'
import {
  generateRecurringAppointments,
  recurringScheduleCandidates,
  type RecurrenceRule,
} from './recurring'

vi.mock('@/lib/ops/attribution', () => ({
  firstTouchForCustomer: vi.fn(async () => null),
}))
vi.mock('@/lib/quickbooks', () => ({
  getQuickBooksSyncStatus: () => 'held',
  buildQuickBooksCustomerPayload: vi.fn(),
}))
vi.mock('@/lib/quickbooks-api', () => ({
  syncBatchInvoiceToQuickBooks: vi.fn(),
}))
vi.mock('@/lib/ops/quickbooks-sync-jobs', () => ({
  ensureCustomerQuickBooksSyncJob: vi.fn(),
}))

type Row = Record<string, unknown>
const due = '2030-01-07' // Monday
function candidate(original = due, start = '09:00:00'): RecurringCandidate {
  return { original_date: original, date: original, start_time: start }
}
function fixture() {
  const tables: Record<string, Row[]> = {
    staff_users: [
      {
        id: 'staff-a',
        user_id: 'auth-a',
        display_name: 'Charles',
        is_active: true,
        default_open: true,
      },
    ],
    availability_templates: [1, 2, 3, 4, 5].map((day_of_week) => ({
      day_of_week,
      start_time: '09:00:00',
      end_time: '18:00:00',
      slot_interval_minutes: 120,
      is_active: true,
      staff_user_id: null,
    })),
    staff_daily_availability: [],
    availability_overrides: [],
    ops_appointments: [],
    ops_calendar_events: [],
    ops_recurring_templates: [],
    ops_recurrence_rules: [],
    ops_customers: [
      {
        id: 'customer-a',
        full_name: 'Recovery Village',
        billing_mode: 'monthly_consolidated',
      },
    ],
    ops_service_addresses: [
      {
        id: 'address-a',
        street_1: '123 Example St',
        city: 'Denver',
        state: 'CO',
        zip_code: '80014',
      },
    ],
  }
  const state = {
    failTable: '',
    readCounts: new Map<string, number>(),
    writes: [] as Array<{ table: string; row: Row }>,
  }
  const client = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      let inserts: Row[] | null = null
      let written: Row[] | null = null
      const execute = () => {
        state.readCounts.set(table, (state.readCounts.get(table) || 0) + 1)
        if (state.failTable === table)
          return { data: null, error: new Error(`${table} unavailable`) }
        if (inserts) {
          if (!written)
            written = inserts.map((row) => {
              const record = {
                ...row,
                id: row.id || `new-${state.writes.length}`,
              }
              state.writes.push({ table, row: record })
              ;(tables[table] ||= []).push(record)
              return record
            })
          return { data: written, error: null }
        }
        return {
          data: (tables[table] || []).filter((row) =>
            filters.every((filter) => filter(row)),
          ),
          error: null,
        }
      }
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          filters.push((row) => row[field] === value)
          return query
        },
        is: (field: string, value: unknown) => {
          filters.push((row) => (row[field] ?? null) === value)
          return query
        },
        not: (field: string, _operator: string, value: unknown) => {
          filters.push((row) => (row[field] ?? null) !== value)
          return query
        },
        gte: (field: string, value: string) => {
          filters.push(
            (row) =>
              typeof row[field] === 'string' && String(row[field]) >= value,
          )
          return query
        },
        lte: (field: string, value: string) => {
          filters.push(
            (row) =>
              typeof row[field] === 'string' && String(row[field]) <= value,
          )
          return query
        },
        in: (field: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[field]))
          return query
        },
        or: (clauses: string) => {
          filters.push((row) =>
            clauses.split(',').some((clause) => {
              const [field, operator, value] = clause.split('.')
              return operator === 'is'
                ? (row[field] ?? null) === null
                : row[field] === value
            }),
          )
          return query
        },
        order: () => query,
        insert: (rows: Row | Row[]) => {
          inserts = Array.isArray(rows) ? rows : [rows]
          return query
        },
        single: async () => {
          const result = execute()
          return { ...result, data: result.data?.[0] || null }
        },
        maybeSingle: async () => {
          const result = execute()
          return { ...result, data: result.data?.[0] || null }
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve(execute()).then(resolve, reject),
      }
      return query
    },
  }
  const busy = (
    date = due,
    start_time = '09:00:00',
    end_time = '11:00:00',
    recurring_template_id: string | null = null,
  ) =>
    tables.ops_appointments.push({
      appointment_date: date,
      start_time,
      end_time,
      recurring_template_id,
      assigned_staff_user_id: 'staff-a',
      is_subcontracted: false,
      status: 'booked',
      ops_customers: { full_name: 'Existing customer' },
    })
  const plan = (candidates = [candidate()], extra = {}) =>
    planRecurringSchedule(client as unknown as SupabaseClient, {
      candidates,
      staffUserId: 'staff-a',
      durationMinutes: 120,
      schedulingMode: 'flexible',
      ...extra,
    })
  return { tables, state, client, busy, plan }
}

afterEach(() => vi.useRealTimers())

describe('flexible recurring scheduling', () => {
  it('only proposes future Mountain-time starts today and rejects an exact past override', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-07T18:15:00Z')) // 11:15 Mountain
    const { plan } = fixture()
    const [automatic] = (await plan()).occurrences
    expect(automatic.start_time).toBe('13:00:00')
    expect(
      automatic.alternatives.every(
        (slot) => slot.date !== due || slot.start_time >= '11:15:00',
      ),
    ).toBe(true)
    const [pinned] = (
      await plan([candidate()], {
        visitOverrides: { [due]: { date: due, start_time: '11:00' } },
      })
    ).occurrences
    expect(pinned).toMatchObject({ status: 'conflict', start_time: '11:00:00' })
    expect(pinned.reason).toContain('future start time')
  })

  it('chooses a same-day opening and returns at most six alternatives', async () => {
    const { busy, plan } = fixture()
    busy()
    const {
      occurrences: [visit],
    } = await plan()
    expect(visit).toMatchObject({
      original_date: due,
      date: due,
      start_time: '11:00:00',
      end_time: '13:00:00',
      status: 'clear',
      shifted: true,
    })
    expect(visit.alternatives.length).toBeLessThanOrEqual(6)
  })

  it('treats pending-approval work as occupied in both preferred times and alternatives', async () => {
    const { tables, plan } = fixture()
    tables.ops_appointments.push({
      appointment_date: due,
      start_time: '09:00:00',
      end_time: '11:00:00',
      status: 'pending_approval',
      is_subcontracted: false,
      assigned_staff_user_id: 'staff-a',
      recurring_template_id: null,
    })
    const visit = (await plan([candidate()])).occurrences[0]
    expect(visit.start_time).toBe('11:00:00')
    expect(
      visit.alternatives.some(
        (option) => option.date === due && option.start_time === '09:00:00',
      ),
    ).toBe(false)
  })

  it('retains global closed hours when staff-specific overrides also exist', async () => {
    const { tables, plan } = fixture()
    tables.availability_overrides.push(
      {
        override_date: due,
        staff_user_id: null,
        is_available: false,
        start_time: '09:00:00',
        end_time: '11:00:00',
      },
      {
        override_date: due,
        staff_user_id: 'staff-a',
        is_available: true,
        start_time: '09:00:00',
        end_time: '18:00:00',
      },
    )
    expect((await plan()).occurrences[0].start_time).toBe('11:00:00')
  })

  it('honors staff days off, calendar blocks and unavailable overrides', async () => {
    const { tables, plan } = fixture()
    tables.staff_daily_availability.push({
      date: due,
      staff_user_id: 'staff-a',
      is_open: false,
    })
    tables.ops_calendar_events.push({
      title: 'Truck repair',
      event_kind: 'block',
      start_date: '2030-01-08',
      end_date: '2030-01-08',
      start_time: null,
      end_time: null,
      is_all_day: true,
      assigned_staff_user_id: 'auth-a',
    })
    tables.availability_overrides.push({
      override_date: '2030-01-09',
      start_time: null,
      end_time: null,
      is_available: false,
      staff_user_id: 'staff-a',
    })
    expect((await plan()).occurrences[0]).toMatchObject({
      date: '2030-01-10',
      start_time: '09:00:00',
      status: 'clear',
    })
  })

  it('finds the preferred off-grid evening start on the next open day', async () => {
    const { tables, busy, plan } = fixture()
    for (const template of tables.availability_templates) {
      template.start_time = '21:00:00'
      template.end_time = '23:00:00'
    }
    busy(due, '21:00:00', '23:00:00')
    const [visit] = (await plan([candidate(due, '21:00:00')])).occurrences
    expect(visit).toMatchObject({
      original_date: due,
      date: '2030-01-08',
      start_time: '21:00:00',
      end_time: '23:00:00',
      status: 'clear',
    })
    expect(visit.alternatives).toContainEqual({
      date: '2030-01-09',
      start_time: '21:00:00',
      end_time: '23:00:00',
    })
    const choices = [visit, ...visit.alternatives].map(
      (slot) => `${slot.date}/${slot.start_time}`,
    )
    expect(new Set(choices).size).toBe(choices.length)
  })

  it('respects default-closed staff and explicit open-day availability', async () => {
    const { tables, plan } = fixture()
    tables.staff_users[0].default_open = false
    tables.staff_daily_availability.push({
      date: '2030-01-08',
      staff_user_id: 'staff-a',
      is_open: true,
    })
    expect((await plan()).occurrences[0].date).toBe('2030-01-08')
  })

  it('never schedules across the next original due date or beyond 14 calendar days', async () => {
    const { busy, plan, tables } = fixture()
    busy(due, '00:00:00', '23:59:00')
    const [first] = (
      await plan([{ ...candidate(), next_original_date: '2030-01-08' }])
    ).occurrences
    expect(first.status).toBe('conflict')
    expect(first.alternatives).toEqual([])
    tables.availability_templates = []
    tables.staff_users[0].default_open = false
    tables.staff_daily_availability.push({
      date: '2030-01-22',
      staff_user_id: 'staff-a',
      is_open: true,
    })
    expect((await plan()).occurrences[0].status).toBe('conflict')
  })

  it('revalidates explicit choices without silently shifting a blocked override', async () => {
    const { busy, plan } = fixture()
    busy(due, '13:00:00', '15:00:00')
    const [visit] = (
      await plan([candidate()], {
        visitOverrides: { [due]: { date: due, start_time: '13:00' } },
      })
    ).occurrences
    expect(visit).toMatchObject({
      date: due,
      start_time: '13:00:00',
      status: 'conflict',
      conflict: { source: 'appointment' },
    })
    expect(visit.alternatives.length).toBeGreaterThan(0)
  })

  it('accepts a valid off-grid preferred time while checking the entire duration', async () => {
    const { plan } = fixture()
    expect(
      (await plan([candidate(due, '09:15:00')])).occurrences[0],
    ).toMatchObject({
      start_time: '09:15:00',
      end_time: '11:15:00',
      shifted: false,
    })
    expect(
      (
        await plan([candidate(due, '17:30:00')], {
          visitOverrides: { [due]: { date: due, start_time: '17:30' } },
        })
      ).occurrences[0].status,
    ).toBe('conflict')
  })

  it('fails closed on any availability lookup error and caches range reads across visits', async () => {
    const { plan, state } = fixture()
    await plan([candidate(), candidate('2030-01-14')])
    expect(state.readCounts.get('ops_appointments')).toBe(1)
    expect(state.readCounts.get('staff_daily_availability')).toBe(1)
    state.failTable = 'availability_overrides'
    await expect(plan()).rejects.toThrow('availability_overrides unavailable')
  })

  it('does not place two weekend-derived occurrences into the same proposed window', async () => {
    const { plan } = fixture()
    const { occurrences } = await plan([
      { original_date: '2030-01-05', date: due, start_time: '09:00:00' },
      { original_date: '2030-01-06', date: due, start_time: '09:00:00' },
    ])
    expect(
      occurrences.filter((visit) => visit.status === 'clear'),
    ).toHaveLength(1)
  })

  it('keeps other work blocking when excluding an edited plan', async () => {
    const { busy, plan } = fixture()
    busy(due, '09:00:00', '11:00:00', 'plan-a')
    expect(
      (await plan([candidate()], { excludeTemplateId: 'plan-a' }))
        .occurrences[0].start_time,
    ).toBe('09:00:00')
    busy(due, '09:00:00', '11:00:00', 'other-plan')
    expect(
      (await plan([candidate()], { excludeTemplateId: 'plan-a' }))
        .occurrences[0].start_time,
    ).toBe('11:00:00')
  })
})

const rule: RecurrenceRule = {
  id: 'rule-a',
  template_id: 'plan-a',
  frequency: 'weekly',
  day_of_week: 1,
  week_of_month: null,
  day_of_month: null,
  interval_days: null,
  effective_from: due,
  effective_until: due,
  override_start_time: '13:00:00',
}

function seedPlan(
  tables: Record<string, Row[]>,
  overrides: Row = {},
  rules = [rule],
) {
  tables.ops_recurrence_rules.push(...(rules as unknown as Row[]))
  tables.ops_recurring_templates.push({
    id: 'plan-a',
    label: 'Recovery Village',
    is_active: true,
    assigned_staff_user_id: 'staff-a',
    scheduling_mode: 'flexible',
    start_time: '09:00:00',
    scheduled_duration_minutes: 120,
    customer_id: 'customer-a',
    service_address_id: 'address-a',
    line_items: [
      {
        name_snapshot: 'Carpet cleaning',
        quantity: 1,
        unit_price: 200,
        duration_minutes: 120,
      },
    ],
    discount_amount: 0,
    invoice_mode: 'batch_monthly',
    is_subcontracted: false,
    ...overrides,
  })
}

describe('recurring candidate and generator correspondence', () => {
  it.each([
    { day_of_week: 7 },
    { day_of_week: -1 },
    { day_of_week: 1.5 },
    { effective_from: '2030-02-30' },
    { effective_until: 'invalid' },
    { frequency: 'custom', interval_days: 0 },
    { frequency: 'custom', interval_days: -2 },
    { frequency: 'custom', interval_days: Infinity },
    { frequency: 'custom', interval_days: 1.5 },
    { frequency: 'monthly', day_of_month: 0 },
    { frequency: 'monthly', day_of_month: null, week_of_month: 6 },
  ])('rejects malformed recurrence rules before expansion: %j', (invalid) => {
    expect(() =>
      recurringScheduleCandidates(
        [{ ...rule, ...invalid } as RecurrenceRule],
        '09:00',
        { fromDate: due },
      ),
    ).toThrow()
  })

  it('uses per-rule times and retains the next due boundary when previews are sliced', () => {
    const candidates = recurringScheduleCandidates(
      [{ ...rule, effective_until: null }],
      '09:00',
      { fromDate: due, count: 1 },
    )
    expect(candidates).toEqual([
      {
        original_date: due,
        date: due,
        start_time: '13:00:00',
        next_original_date: '2030-01-14',
      },
    ])
  })

  it('anchors the generation day in Mountain time', () => {
    expect(
      recurringScheduleCandidates([rule], '09:00', {
        fromDate: new Date('2030-01-08T02:00:00Z'),
        count: 1,
      })[0].original_date,
    ).toBe(due)
  })

  it('generates the exact previewed choice and preserves the original date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-07T15:00:00Z'))
    const { busy, plan, client, tables, state } = fixture()
    busy(due, '13:00:00', '15:00:00')
    const candidates = recurringScheduleCandidates([rule], '09:00', {
      fromDate: due,
    })
    const preview = (await plan(candidates)).occurrences[0]
    seedPlan(tables, {
      visit_overrides: {
        [due]: { date: preview.date, start_time: preview.start_time },
      },
    })
    const result = await generateRecurringAppointments(
      client as unknown as SupabaseClient,
      'plan-a',
    )
    expect(result.errors).toEqual([])
    expect(result.created).toBe(1)
    expect(
      state.writes.find((write) => write.table === 'ops_appointments')?.row,
    ).toMatchObject({
      appointment_date: preview.date,
      original_recurring_date: due,
      start_time: preview.start_time,
      end_time: preview.end_time,
    })
  })

  it('does not silently move a reviewed choice when the calendar changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-07T15:00:00Z'))
    const { plan, busy, tables, client, state } = fixture()
    const [preview] = (await plan([candidate(due, '13:00')])).occurrences
    seedPlan(tables, {
      visit_overrides: {
        [due]: { date: preview.date, start_time: preview.start_time },
      },
    })
    busy(preview.date, preview.start_time, preview.end_time)
    const result = await generateRecurringAppointments(
      client as unknown as SupabaseClient,
      'plan-a',
    )
    expect(result.created).toBe(0)
    expect(result.errors.join(' ')).toContain('selected visit is unavailable')
    expect(state.writes).toEqual([])
  })

  it('skips a cancelled original without reserving a phantom visit or generating a duplicate', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-07T15:00:00Z'))
    const { tables, client, state } = fixture()
    seedPlan(tables, {}, [{ ...rule, effective_until: '2030-01-14' }])
    tables.ops_appointments.push({
      recurring_template_id: 'plan-a',
      original_recurring_date: due,
      appointment_date: '2030-01-14',
      start_time: '13:00:00',
      end_time: '15:00:00',
      status: 'cancelled',
      assigned_staff_user_id: 'staff-a',
      is_subcontracted: false,
    })
    // Put the cancelled visit beyond this cadence week so only its original date is blocked.
    tables.ops_appointments[0].appointment_date = '2030-02-04'
    const result = await generateRecurringAppointments(
      client as unknown as SupabaseClient,
      'plan-a',
    )
    expect(result).toMatchObject({ created: 1, skipped: 1, errors: [] })
    expect(
      state.writes.find((write) => write.table === 'ops_appointments')?.row,
    ).toMatchObject({
      original_recurring_date: '2030-01-14',
      appointment_date: '2030-01-14',
      start_time: '13:00:00',
    })
  })
})
