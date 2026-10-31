// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('@/lib/ops/staff-availability', () => ({
  getStaffPrioritizedSlots: vi.fn(),
}))
vi.mock('@/lib/ops/slot-token', () => ({
  createSlotToken: vi.fn(() => 'signed-slot'),
  verifySlotToken: vi.fn(),
}))
vi.mock('@/lib/service-area', () => ({
  checkServiceArea: vi.fn(() => ({ allowed: true, travelCharge: 0 })),
}))
import { getStaffPrioritizedSlots } from './staff-availability'
import { executeScoutWebTool } from './scout-web-tools'

let call = 0
function database(price: number) {
  return {
    from: () => ({
      select: () => ({
        in: () => ({
          eq: () => ({ data: [{ id: 'rug', base_price: price }] }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}
async function slots(
  price: number,
  args: Record<string, unknown> = {},
  disclosed = false,
) {
  return JSON.parse(
    await executeScoutWebTool(
      'get_calendar_slots',
      JSON.stringify({
        date: '2099-01-01',
        line_items: [{ service_id: 'rug', quantity: 1 }],
        ...args,
      }),
      {
        supabase: database(price),
        rateLimitKey: `minimum-test-${++call}`,
        minimumChargeDisclosed: disclosed,
      },
    ),
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStaffPrioritizedSlots).mockResolvedValue({
    staffUserId: 'staff',
    slots: [{ start_time: '11:00:00', end_time: '13:00:00' }],
  } as never)
})
describe('Scout minimum before scheduling', () => {
  it('blocks Ruth’s $64 rug before looking up slots', async () => {
    const result = await slots(64)
    expect(result.error).toContain('$175')
    expect(result.slots).toEqual([])
    expect(getStaffPrioritizedSlots).not.toHaveBeenCalled()
  })
  it('rejects a model acceptance flag before the minimum was disclosed', async () => {
    const result = await slots(64, { accepted_minimum_charge: true })
    expect(result.error).toContain('$175')
    expect(getStaffPrioritizedSlots).not.toHaveBeenCalled()
  })
  it('does not treat disclosure alone as acceptance', async () => {
    const result = await slots(64, {}, true)
    expect(result.error).toContain('$175')
    expect(getStaffPrioritizedSlots).not.toHaveBeenCalled()
  })
  it('allows disclosed and accepted minimum-charge work', async () => {
    const result = await slots(64, { accepted_minimum_charge: true }, true)
    expect(result.slots[0].slot_token).toBe('signed-slot')
    expect(result.minimum_job_total).toBe(175)
  })
  it.each([175, 200])(
    'allows a $%s job without a minimum acceptance flag',
    async (price) => {
      expect((await slots(price)).slots).toHaveLength(1)
    },
  )
  it('cannot skip the residential check by omitting line items', async () => {
    expect((await slots(64, { line_items: undefined })).error).toContain(
      'line_items',
    )
    expect(getStaffPrioritizedSlots).not.toHaveBeenCalled()
  })
  it('preserves free commercial walkthrough availability', async () => {
    expect(
      (
        await slots(0, {
          line_items: undefined,
          commercial_walkthrough: true,
          duration_minutes: 120,
        })
      ).slots,
    ).toHaveLength(1)
  })
})

describe('Scout booking minimum backstop', () => {
  it.each([false, true])(
    'rejects a $64 booking without disclosure even when accepted_minimum_charge=%s',
    async (accepted) => {
      const db = database(64)
      const originalFrom = db.from.bind(db)
      db.from = ((table: string) =>
        table === 'ops_customers'
          ? { select: () => ({ eq: () => ({ data: [] }) }) }
          : originalFrom(table)) as typeof db.from
      const result = JSON.parse(
        await executeScoutWebTool(
          'book_new_job',
          JSON.stringify({
            first_name: 'Test',
            last_name: 'Customer',
            email: 'test@example.com',
            customer_phone: '7195550123',
            street_1: '123 Test St',
            city: 'Monument',
            zip_code: '80132',
            appointment_date: '2099-01-01',
            start_time: '11:00',
            slot_token: 'old-slot',
            lead_source: 'google_search',
            line_items: [{ service_id: 'rug', quantity: 1 }],
            accepted_minimum_charge: accepted,
          }),
          {
            supabase: db,
            rateLimitKey: `minimum-book-${++call}`,
            minimumChargeDisclosed: false,
          },
        ),
      )
      expect(result.error).toContain('$175')
      expect(getStaffPrioritizedSlots).not.toHaveBeenCalled()
    },
  )
})
