// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readScheduleGaps,
  readGapRows,
  reloadGap,
  readGapCandidates,
} from './gap-read'
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

describe('drip email and history coverage', () => {
  it.each(['enrollment', 'email'])(
    'suppresses a recent sent drip email matched by %s',
    async (match) => {
      const f = fixture()
      const id = '40000000-0000-4000-8000-000000000001'
      f.tables.ops_customers = [
        {
          id,
          full_name: 'Synthetic Customer',
          phone: '+17195550100',
          email: 'fixture@example.test',
        },
      ]
      f.tables.ops_service_addresses = [
        {
          id: 'address',
          customer_id: id,
          street_1: '1 Fixture St',
          city: 'Monument',
          zip_code: '80132',
        },
      ]
      f.tables.ops_appointments.push({
        id: 'old-service',
        customer_id: id,
        service_address_id: 'address',
        kind: 'service',
        status: 'completed',
        appointment_date: '2024-01-01',
        start_time: '09:00',
        end_time: '11:00',
      })
      f.tables.sms_marketing_consents = [
        {
          customer_id: id,
          phone_normalized: '+17195550100',
          status: 'opted_in',
          source: 'synthetic_documented',
          consented_at: '2024-01-01T00:00:00Z',
          disclosure: 'Synthetic documented consent',
        },
      ]
      f.tables.tomorrow_fill_settings = [
        {
          id: true,
          dormancy_months: 8,
          customer_cooldown_days: 14,
          unanswered_limit: 4,
          rest_days: 60,
        },
      ]
      const gap = (
        await readScheduleGaps(
          f.client,
          {
            start_date: '2026-10-27',
            end_date: '2026-10-27',
            required_minutes: 120,
          },
          now,
        )
      ).data[0]
      const clear = await readGapCandidates(f.client, gap, 10, now)
      expect(clear.data).toHaveLength(1)
      expect(clear.data[0].history_coverage).toMatchObject({
        complete: false,
        conversation_service_dates_reconciled: false,
        owner_review_required: true,
      })
      f.tables.drip_campaign_enrollments = [
        {
          id: 'enrollment',
          customer_id: match === 'enrollment' ? id : 'different',
        },
      ]
      f.tables.drip_email_log = [
        {
          id: 'drip-message',
          enrollment_id: 'enrollment',
          to_email:
            match === 'email'
              ? ' FIXTURE@example.test '
              : 'different@example.test',
          status: 'sent',
          sent_at: '2026-10-24T12:00:00Z',
        },
      ]
      const blocked = await readGapCandidates(f.client, gap, 10, now)
      expect(blocked.data).toHaveLength(0)
      expect(blocked.excluded[0].contacts).toContainEqual(
        expect.objectContaining({
          channel: 'drip_email',
          source_id: 'drip_email:drip-message',
        }),
      )
      f.tables.drip_email_log = [
        {
          ...(f.tables.drip_email_log[0] as Record<string, unknown>),
          status: 'failed',
        },
      ]
      expect(
        (await readGapCandidates(f.client, gap, 10, now)).data,
      ).toHaveLength(1)
      f.tables.sms_marketing_consents = []
      const audit = {
        id: 'owner-event',
        customer_id: id,
        user_id: 'owner',
        phone: '+17195550100',
        action: 'owner_attested_existing_permission',
        source: 'owner_attestation',
        owner_attested_at: '2026-10-25T11:00:00Z',
        consent_text:
          'Synthetic owner reports prior permission; original date unknown',
        evidence_ref: `approved-owner-message#customer=${id}`,
      }
      f.tables.ops_sms_consent_events = [audit]
      ;(f.tables.staff_users[0] as Record<string, unknown>).role = 'owner'
      const attested = await readGapCandidates(f.client, gap, 10, now)
      expect(attested.data[0].consent).toMatchObject({
        status: 'owner_attested',
        consented_at: null,
        owner_attested_at: audit.owner_attested_at,
      })
      f.tables.ops_sms_consent_events = [{ ...audit, customer_id: 'different' }]
      expect(
        (await readGapCandidates(f.client, gap, 10, now)).data,
      ).toHaveLength(0)
      f.tables.ops_sms_consent_events = [
        audit,
        {
          id: 'later-stop',
          customer_id: id,
          phone: '+17195550100',
          action: 'opted_out',
          source: 'customer_reply',
          created_at: '2026-10-25T11:30:00Z',
        },
      ]
      expect(
        (await readGapCandidates(f.client, gap, 10, now)).excluded[0]
          .exclusions,
      ).toContain('opted_out')
    },
  )
})
