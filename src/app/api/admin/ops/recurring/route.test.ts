// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  plan: vi.fn(),
  generate: vi.fn(),
  candidates: vi.fn(),
  legacy: vi.fn(),
  loadVisits: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/ops/recurring', () => ({
  recurringScheduleCandidates: mocks.candidates,
  generateRecurringAppointments: mocks.generate,
  generateAllRecurring: vi.fn(),
}))
vi.mock('@/lib/ops/recurring-scheduling', () => ({
  planRecurringSchedule: mocks.plan,
}))
vi.mock('@/lib/ops/recurring-schedule-preview', () => ({
  previewRecurringSchedule: mocks.legacy,
}))
vi.mock('@/lib/ops/recurring-edits', () => ({
  loadRecurringVisitSchedule: mocks.loadVisits,
}))
import { POST } from './route'
const occurrence = {
  original_date: '2026-10-19',
  date: '2026-10-20',
  start_time: '13:00:00',
  end_time: '15:00:00',
  status: 'clear',
  shifted: true,
  reason: 'Preferred slot is occupied',
  alternatives: [],
  conflict: null,
}
const candidates = [
  { original_date: '2026-10-19', date: '2026-10-19', start_time: '09:00' },
]
const rules = [
  { frequency: 'monthly', day_of_month: 19, effective_from: '2026-10-19' },
]
const template = {
  customer_id: 'customer',
  service_address_id: 'address',
  label: 'Flexible account',
  start_time: '09:00',
  scheduled_duration_minutes: 120,
  assigned_staff_user_id: 'staff',
  scheduling_mode: 'flexible',
  line_items: [
    {
      name_snapshot: 'Cleaning',
      quantity: 1,
      unit_price: 500,
      duration_minutes: 120,
    },
  ],
  invoice_mode: 'batch_monthly',
}
const writes: Array<{ table: string; values: Record<string, unknown> }> = []
beforeEach(() => {
  vi.resetAllMocks()
  writes.length = 0
  mocks.access.mockResolvedValue({ role: 'owner' })
  mocks.candidates.mockReturnValue(candidates)
  mocks.plan.mockResolvedValue({
    staff: { id: 'staff', display_name: 'Technician' },
    occurrences: [occurrence],
  })
  mocks.generate.mockResolvedValue({ created: 1, skipped: 0, errors: [] })
  mocks.loadVisits.mockResolvedValue({
    candidates,
    visitOverrides: {},
    visits: [],
  })
  mocks.admin.mockReturnValue({
    from(table: string) {
      const query = {
        insert(values: Record<string, unknown>) {
          writes.push({ table, values })
          return query
        },
        select() {
          return query
        },
        single: async () => ({ data: { id: 'new-plan' }, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(resolve({ data: [], error: null }))
        },
      }
      return query
    },
  })
})
const post = (body: unknown) =>
  POST(
    new NextRequest('https://example.test/api/admin/ops/recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
describe('reviewed flexible recurring creation', () => {
  it('previews actual candidates without creating a plan or appointments', async () => {
    const response = await post({
      preview_only: true,
      rules,
      schedule: template,
    })
    expect(response.status).toBe(200)
    expect((await response.json()).preview_dates).toEqual(['2026-10-20'])
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidates,
        schedulingMode: 'flexible',
        durationMinutes: 120,
        staffUserId: 'staff',
      }),
    )
    expect(writes).toEqual([])
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects a changed calendar before any writes', async () => {
    const response = await post({
      template,
      rules,
      reviewed_occurrences: [{ ...occurrence, date: '2026-10-19' }],
    })
    expect(response.status).toBe(409)
    expect(writes).toEqual([])
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('requires a review even if every newly calculated visit is clear', async () => {
    expect((await post({ template, rules })).status).toBe(409)
    expect(writes).toEqual([])
  })
  it('freezes reviewed dates, preserves monthly billing and generates only after review', async () => {
    const response = await post({
      template,
      rules,
      reviewed_occurrences: [occurrence],
    })
    expect(response.status).toBe(201)
    expect(writes[0]).toMatchObject({
      table: 'ops_recurring_templates',
      values: {
        scheduling_mode: 'flexible',
        invoice_mode: 'batch_monthly',
        visit_overrides: {
          '2026-10-19': { date: '2026-10-20', start_time: '13:00' },
        },
      },
    })
    expect(mocks.generate).toHaveBeenCalledWith(expect.anything(), 'new-plan')
  })
  it('rejects a missing technician or malformed override without writes', async () => {
    expect(
      (
        await post({
          template: { ...template, assigned_staff_user_id: null },
          rules,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await post({
          template: {
            ...template,
            visit_overrides: {
              '2026-10-19': { date: '2026-02-30', start_time: '13:00' },
            },
          },
          rules,
        })
      ).status,
    ).toBe(400)
    expect(writes).toEqual([])
  })
  it('passes existing moved/cancelled visits through the same preview context', async () => {
    const response = await post({
      preview_only: true,
      template_id: 'existing-plan',
      rules,
      schedule: template,
    })
    expect(response.status).toBe(200)
    expect(mocks.loadVisits).toHaveBeenCalledWith(
      expect.anything(),
      'existing-plan',
      candidates,
      {},
    )
  })
  it('fails closed on availability read errors', async () => {
    mocks.plan.mockRejectedValue(new Error('Calendar unavailable'))
    expect(
      (await post({ template, rules, reviewed_occurrences: [occurrence] }))
        .status,
    ).toBe(500)
    expect(writes).toEqual([])
  })
})
