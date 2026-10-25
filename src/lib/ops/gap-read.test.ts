// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readScheduleGaps, readGapRows, reloadGap } from './gap-read'
import { gapOutput } from '@/lib/mcp/gap-schemas'
const staff = '20000000-0000-4000-8000-000000000001'
function fixture(fail?: string) {
  const calls: string[] = []
  const tables: Record<string, unknown[]> = {
    staff_users: [
      {
        id: staff,
        user_id: 'owner',
        display_name: 'David',
        is_active: true,
        default_open: true,
      },
    ],
    availability_templates: [
      {
        id: 'template',
        staff_user_id: staff,
        day_of_week: 2,
        start_time: '09:00',
        end_time: '18:00',
        is_active: true,
        slot_interval_minutes: 120,
      },
    ],
    ops_appointments: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        appointment_date: '2026-10-27',
        start_time: '09:00',
        end_time: '10:00',
        status: 'booked',
        assigned_staff_user_id: staff,
        is_subcontracted: false,
      },
    ],
  }
  const from = vi.fn((table: string) => {
    calls.push(table)
    const chain = {
      select: () => chain,
      order: () => chain,
      range: async (start: number, end: number) => ({
        data: (tables[table] || []).slice(start, end + 1),
        error: table === fail ? { message: 'fixture failure' } : null,
      }),
    }
    return chain
  })
  return { client: { from } as unknown as SupabaseClient, calls, tables }
}
const now = new Date('2026-10-25T12:00:00Z')
describe('genuinely read-only schedule interface', () => {
  it('paginates sources by their actual production primary keys', async () => {
    const expected: Record<string, string[]> = {
      hcp_customer_history: ['hcp_id'],
      qb_historical_transactions: ['txn_type', 'qb_txn_id'],
      sms_marketing_consents: ['customer_id'],
      gap_outreach_contacts: ['source', 'source_id', 'phone'],
    }
    for (const [table, keys] of Object.entries(expected)) {
      const orders: string[] = []
      const query = {
        select: () => query,
        order: (key: string) => {
          orders.push(key)
          if (!keys.includes(key)) throw new Error('Column does not exist')
          return query
        },
        range: async () => ({ data: [], error: null }),
      }
      await expect(
        readGapRows({ from: () => query } as unknown as SupabaseClient, table),
      ).resolves.toEqual([])
      expect(orders).toEqual(keys)
    }
  })
  it('returns schema-valid complete gaps using only selects', async () => {
    const f = fixture()
    const result = await readScheduleGaps(
      f.client,
      {
        start_date: '2026-10-27',
        end_date: '2026-10-27',
        required_minutes: 120,
      },
      now,
    )
    expect(() => gapOutput.parse(result)).not.toThrow()
    expect(result.data[0]).toMatchObject({
      start_time: '10:00:00',
      end_time: '18:00:00',
      minutes: 480,
    })
    expect(f.calls).not.toContain('sms_marketing_consents')
    expect(f.calls).not.toContain('tomorrow_fill_campaigns')
  })
  it('can revalidate a long span without pretending it is a >4h job', async () => {
    const f = fixture()
    const result = await readScheduleGaps(
      f.client,
      {
        start_date: '2026-10-27',
        end_date: '2026-10-27',
        required_minutes: 120,
      },
      now,
    )
    await expect(
      reloadGap(f.client, result.data[0], now),
    ).resolves.toMatchObject({ minutes: 480 })
  })
  it('rejects missing busy-calendar evidence rather than treating it as free time', async () => {
    const f = fixture('ops_calendar_events')
    await expect(
      readScheduleGaps(
        f.client,
        {
          start_date: '2026-10-27',
          end_date: '2026-10-27',
          required_minutes: 120,
        },
        now,
      ),
    ).rejects.toThrow('unavailable')
  })
  it('does not seed default availability when templates are missing', async () => {
    const f = fixture()
    f.tables.availability_templates = []
    expect(
      (
        await readScheduleGaps(
          f.client,
          {
            start_date: '2026-10-27',
            end_date: '2026-10-27',
            required_minutes: 120,
          },
          now,
        )
      ).data,
    ).toEqual([])
  })
  it('paginates rather than silently trusting a server row cap', async () => {
    const f = fixture()
    f.tables.customers = Array.from({ length: 501 }, (_, id) => ({ id }))
    expect(await readGapRows(f.client, 'customers')).toHaveLength(501)
  })
})
