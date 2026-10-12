// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  generate: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/ops/recurring', () => ({
  generateRecurringAppointments: mocks.generate,
  generateBatchInvoice: vi.fn(),
}))
import { PATCH } from './route'

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

beforeEach(() => {
  vi.clearAllMocks()
  operations.length = 0
  currentError = null
  mocks.access.mockResolvedValue({ role: 'owner' })
  mocks.generate.mockResolvedValue({ created: 1 })
  mocks.admin.mockReturnValue({
    from(table: string) {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
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
          data: currentError ? null : current,
          error: currentError,
        })),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(
            resolve({
              error: null,
              data:
                table === 'ops_appointments'
                  ? [
                      {
                        id: 'existing-appointment',
                        ops_appointment_line_items: [
                          { id: 'existing-line', ...item },
                        ],
                      },
                    ]
                  : null,
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
) {
  return PATCH(
    new NextRequest('https://example.test/api/admin/ops/recurring/saltgrass', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: {
          ...current,
          start_time: '21:00',
          ...template,
        },
        rules,
        update_future: updateFuture,
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
