// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  generate: vi.fn(),
  candidates: vi.fn(),
  plan: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/ops/recurring', () => ({
  generateRecurringAppointments: mocks.generate,
  generateBatchInvoice: vi.fn(),
  recurringScheduleCandidates: mocks.candidates,
}))
vi.mock('@/lib/ops/recurring-scheduling', () => ({
  planRecurringSchedule: mocks.plan,
}))
import { PATCH } from './route'
import { loadRecurringVisitSchedule } from '@/lib/ops/recurring-edits'

const item = {
  name_snapshot: 'Carpet cleaning',
  service_catalog_item_id: 'carpet',
  quantity: 1,
  unit_price: 500,
  duration_minutes: 180,
  notes: 'Old instructions',
}
const rule = {
  frequency: 'monthly',
  day_of_month: 15,
  effective_from: '2026-10-15',
}
const current = {
  id: 'saltgrass',
  line_items: [item],
  start_time: '21:00:00',
  scheduled_duration_minutes: 180,
  discount_amount: 0,
  internal_notes: 'Old notes',
  ops_recurrence_rules: [{ id: 'rule-1', ...rule }],
}
const operations: { table: string; action: string; values?: unknown }[] = []
let currentError: unknown = null
let storedTemplate: Record<string, unknown> = current
let visits: Record<string, unknown>[] = []
const queryFilters: { table: string; key: string; value: unknown }[] = []
const occurrence = {
  original_date: '2026-10-19',
  date: '2026-10-20',
  start_time: '10:00:00',
  end_time: '13:30:00',
  status: 'clear',
  shifted: true,
  reason: null,
  alternatives: [],
  conflict: null,
}
const existingVisit = {
  id: 'existing-appointment',
  original_recurring_date: '2026-10-19',
  appointment_date: '2026-10-19',
  start_time: '09:00:00',
  end_time: '12:30:00',
  status: 'booked',
  ops_appointment_line_items: [{ id: 'existing-line', ...item }],
}

beforeEach(() => {
  vi.clearAllMocks()
  operations.length = 0
  currentError = null
  storedTemplate = { ...current }
  visits = [{ ...existingVisit }]
  queryFilters.length = 0
  mocks.candidates.mockReturnValue([
    { original_date: '2026-10-19', date: '2026-10-19', start_time: '21:00' },
  ])
  mocks.plan.mockResolvedValue({
    staff: { id: 'staff-1', display_name: 'Charles' },
    occurrences: [occurrence],
  })
  mocks.access.mockResolvedValue({ role: 'owner' })
  mocks.generate.mockResolvedValue({ created: 1 })
  mocks.admin.mockReturnValue({
    from(table: string) {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq(key: string, value: unknown) {
          queryFilters.push({ table, key, value })
          return query
        },
        gte: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        update(values: unknown) {
          operations.push({ table, action: 'update', values })
          return query
        },
        delete() {
          operations.push({ table, action: 'delete' })
          return query
        },
        insert(values: unknown) {
          operations.push({ table, action: 'insert', values })
          return query
        },
        single: vi.fn(async () => ({
          data: currentError ? null : storedTemplate,
          error: currentError,
        })),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(
            resolve({
              error: null,
              data: table === 'ops_appointments' ? visits : null,
            }),
          )
        },
      }
      return query
    },
  })
})

function save(
  template: Record<string, unknown>,
  rules: unknown[] = [rule],
  updateFuture = true,
  reviewed?: unknown,
) {
  return PATCH(
    new NextRequest('https://example.test/api/admin/ops/recurring/saltgrass', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: {
          ...storedTemplate,
          start_time: '21:00',
          ...template,
        },
        rules,
        update_future: updateFuture,
        reviewed_occurrences: reviewed,
      }),
    }),
    { params: Promise.resolve({ id: 'saltgrass' }) },
  )
}

describe('recurring plan note saves', () => {
  it('updates internal notes without replacing visits, invoices or unchanged rules', async () => {
    expect((await save({ internal_notes: null })).status).toBe(200)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(
      operations.some((op) => op.action === 'delete' || op.action === 'insert'),
    ).toBe(false)
    expect(operations).toContainEqual(
      expect.objectContaining({
        table: 'ops_appointments',
        action: 'update',
        values: expect.objectContaining({ internal_notes: null }),
      }),
    )
    expect(operations.some((op) => op.table === 'ops_invoices')).toBe(false)
  })

  it('updates line-item notes using the existing line ID, without new jobs', async () => {
    expect(
      (await save({ line_items: [{ ...item, notes: null }] })).status,
    ).toBe(200)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(operations).toContainEqual({
      table: 'ops_appointment_line_items',
      action: 'update',
      values: { notes: null },
    })
    expect(
      operations.some((op) => op.action === 'delete' || op.action === 'insert'),
    ).toBe(false)
  })

  it('still applies actual pricing changes to future visits', async () => {
    expect(
      (await save({ line_items: [{ ...item, unit_price: 550 }] })).status,
    ).toBe(200)
    expect(mocks.generate).toHaveBeenCalledOnce()
  })

  it('recognizes actual recurrence changes', async () => {
    expect((await save({}, [{ ...rule, day_of_month: 16 }])).status).toBe(200)
    expect(mocks.generate).toHaveBeenCalledOnce()
  })

  it('still rebuilds billing when invoice mode actually changes', async () => {
    expect((await save({ invoice_mode: 'batch_monthly' })).status).toBe(200)
    expect(mocks.generate).toHaveBeenCalledOnce()
  })

  it('leaves future jobs alone when saving the template only', async () => {
    expect((await save({ internal_notes: null }, [rule], false)).status).toBe(
      200,
    )
    expect(operations.some((op) => op.table === 'ops_appointments')).toBe(false)
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('does not mutate jobs when the current template cannot be read', async () => {
    currentError = { message: 'Unavailable' }
    expect((await save({ internal_notes: null })).status).toBe(404)
    expect(operations).toEqual([])
  })
})

function flexible() {
  storedTemplate = {
    ...current,
    scheduling_mode: 'flexible',
    visit_overrides: {},
    assigned_staff_user_id: 'staff-1',
    is_subcontracted: false,
  }
}
const adjustments = {
  '2026-10-19': { date: '2026-10-20', start_time: '10:00' },
}

describe('flexible recurring plan edits', () => {
  it('moves a reviewed existing appointment by ID without replacing its lines or invoice', async () => {
    flexible()
    expect(
      (await save({ visit_overrides: adjustments }, [rule], true, [occurrence]))
        .status,
    ).toBe(200)
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        excludeTemplateId: 'saltgrass',
        visitOverrides: adjustments,
      }),
    )
    expect(operations).toContainEqual(
      expect.objectContaining({
        table: 'ops_appointments',
        action: 'update',
        values: expect.objectContaining({
          appointment_date: '2026-10-20',
          start_time: '10:00:00',
          end_time: '13:30:00',
        }),
      }),
    )
    expect(queryFilters).toContainEqual({
      table: 'ops_appointments',
      key: 'id',
      value: 'existing-appointment',
    })
    expect(
      operations.some(
        (op) =>
          op.action === 'delete' ||
          op.action === 'insert' ||
          op.table === 'ops_invoices' ||
          op.table === 'ops_appointment_line_items',
      ),
    ).toBe(false)
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('refuses a stale review before modifying the template or any visits', async () => {
    flexible()
    const response = await save(
      { visit_overrides: adjustments },
      [rule],
      true,
      [{ ...occurrence, start_time: '11:00:00' }],
    )
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe(
      'recurring_schedule_review_required',
    )
    expect(operations).toEqual([])
  })

  it('refuses a newly occupied time before modifying anything', async () => {
    flexible()
    mocks.plan.mockResolvedValue({
      staff: { id: 'staff-1' },
      occurrences: [{ ...occurrence, status: 'conflict' }],
    })
    expect(
      (await save({ visit_overrides: adjustments }, [rule], true, [occurrence]))
        .status,
    ).toBe(409)
    expect(operations).toEqual([])
  })

  it.each([
    { line_items: [{ ...item, unit_price: 550 }] },
    { discount_amount: 50 },
    { invoice_mode: 'batch_monthly' },
  ])(
    'preserves existing records when pricing or billing needs an individual edit: %s',
    async (updates) => {
      flexible()
      const response = await save(updates)
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe(
        'recurring_existing_visits_preserved',
      )
      expect(operations).toEqual([])
    },
  )

  it('rejects recurrence pattern replacement before any writes', async () => {
    flexible()
    expect((await save({}, [{ ...rule, day_of_month: 16 }])).status).toBe(409)
    expect(operations).toEqual([])
  })

  it('saves flexible notes without requiring a schedule review', async () => {
    flexible()
    expect((await save({ internal_notes: 'Use loading dock' })).status).toBe(
      200,
    )
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(
      operations.some((op) => op.action === 'delete' || op.action === 'insert'),
    ).toBe(false)
  })

  it('preserves IDs when switching an existing flexible plan to fixed', async () => {
    flexible()
    expect(
      (await save({ scheduling_mode: 'fixed' }, [rule], true, [occurrence]))
        .status,
    ).toBe(200)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(
      operations.some((op) => op.action === 'delete' || op.action === 'insert'),
    ).toBe(false)
  })

  it('does not modify future jobs when saving flexible settings to the plan only', async () => {
    flexible()
    expect(
      (
        await save(
          { visit_overrides: adjustments, assigned_staff_user_id: 'staff-2' },
          [rule],
          false,
        )
      ).status,
    ).toBe(200)
    expect(operations.some((op) => op.table === 'ops_appointments')).toBe(false)
    expect(mocks.plan).not.toHaveBeenCalled()
  })

  it('keeps completed and cancelled visits untouched', async () => {
    flexible()
    visits = [
      { ...existingVisit, status: 'completed' },
      { ...existingVisit, id: 'cancelled-job', status: 'cancelled' },
    ]
    expect(
      (await save({ visit_overrides: adjustments }, [rule], true, [occurrence]))
        .status,
    ).toBe(200)
    expect(operations.some((op) => op.table === 'ops_appointments')).toBe(false)
    expect(mocks.plan.mock.calls[0][1].candidates).toEqual([])
  })

  it('rejects malformed visit overrides before writes', async () => {
    flexible()
    expect(
      (
        await save({
          visit_overrides: {
            '2026-10-19': { date: 'not-a-date', start_time: '10:00' },
          },
        })
      ).status,
    ).toBe(400)
    expect(operations).toEqual([])
  })
})

describe('recurring scheduling edit comparisons', () => {
  it('keeps the existing fixed-plan assignment propagation without rebuilding jobs', async () => {
    expect((await save({ assigned_staff_user_id: 'staff-2' })).status).toBe(200)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(
      operations.some((op) => op.action === 'delete' || op.action === 'insert'),
    ).toBe(false)
    expect(operations).toContainEqual(
      expect.objectContaining({
        table: 'ops_appointments',
        action: 'update',
        values: expect.objectContaining({ assigned_staff_user_id: 'staff-2' }),
      }),
    )
  })

  it('treats reordered override keys and equivalent time formats as unchanged', async () => {
    flexible()
    storedTemplate.visit_overrides = {
      ...adjustments,
      '2026-11-19': { date: '2026-11-20', start_time: '10:00' },
    }
    expect(
      (
        await save({
          visit_overrides: {
            '2026-11-19': { date: '2026-11-20', start_time: '10:00:00' },
            ...adjustments,
          },
        })
      ).status,
    ).toBe(200)
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})

describe('existing recurring visit preview', () => {
  it('shows an actual calendar move rather than an unchanged frozen override', async () => {
    visits = [
      {
        ...existingVisit,
        appointment_date: '2026-10-22',
        start_time: '11:00:00',
      },
    ]
    const result = await loadRecurringVisitSchedule(
      mocks.admin(),
      'saltgrass',
      mocks.candidates(),
      adjustments,
      adjustments,
    )
    expect(result.visitOverrides['2026-10-19']).toEqual({
      date: '2026-10-22',
      start_time: '11:00',
    })
  })

  it('honors an explicitly changed per-visit choice', async () => {
    visits = [
      {
        ...existingVisit,
        appointment_date: '2026-10-22',
        start_time: '11:00:00',
      },
    ]
    const result = await loadRecurringVisitSchedule(
      mocks.admin(),
      'saltgrass',
      mocks.candidates(),
      adjustments,
      {},
    )
    expect(result.visitOverrides).toEqual(adjustments)
  })
})
