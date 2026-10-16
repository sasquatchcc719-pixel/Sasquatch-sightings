// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllStaffSlots: vi.fn(),
  getUnionedSlots: vi.fn(),
  getAgentPromoSettings: vi.fn(),
  normalizeLeadSourceForWrite: vi.fn(),
  checkServiceArea: vi.fn(),
  blacklist: vi.fn(),
}))

vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklist }))

vi.mock('@/lib/ops/staff-availability', () => ({
  getAllStaffSlots: mocks.getAllStaffSlots,
  getUnionedSlots: mocks.getUnionedSlots,
}))
vi.mock('@/lib/agent-auth', () => ({
  getAgentPromoSettings: mocks.getAgentPromoSettings,
}))
vi.mock('@/lib/server/lead-sources', () => ({
  normalizeLeadSourceForWrite: mocks.normalizeLeadSourceForWrite,
  leadSourceUpdatePayload: vi.fn(() => ({})),
}))
vi.mock('@/lib/service-area', () => ({
  checkServiceArea: mocks.checkServiceArea,
}))

import { createAiStyleBooking } from './create-ai-style-booking'

class ReadQuery {
  constructor(private readonly table: string) {}
  select() {
    return this
  }
  in() {
    return this
  }
  eq() {
    if (this.table === 'service_catalog_items') {
      return Promise.resolve({
        data: [
          {
            id: '10000000-0000-4000-8000-000000000001',
            name: 'Carpet cleaning',
            slug: 'carpet-cleaning',
            base_price: 300,
            default_duration_minutes: 120,
            pricing_unit: 'fixed',
          },
        ],
        error: null,
      })
    }
    return this
  }
  maybeSingle() {
    if (this.table !== 'staff_users') throw new Error('Unexpected table read')
    return Promise.resolve({
      data: { display_name: 'Charles' },
      error: null,
    })
  }
}

describe('AI-style booking preview', () => {
  beforeEach(() => {
    mocks.blacklist.mockResolvedValue(false)
    mocks.getAllStaffSlots.mockResolvedValue([
      {
        staffUserId: '20000000-0000-4000-8000-000000000001',
        slots: [{ start_time: '09:00:00', end_time: '12:00:00' }],
      },
    ])
    mocks.getUnionedSlots.mockResolvedValue([])
    mocks.getAgentPromoSettings.mockResolvedValue({
      enabled: false,
      discount: 0,
      minimum: 0,
    })
    mocks.normalizeLeadSourceForWrite.mockResolvedValue({
      ok: true,
      source: {
        lead_source: 'Google',
        lead_source_key: 'google',
        lead_source_detail: null,
        original_lead_source: 'Google',
      },
    })
    mocks.checkServiceArea.mockReturnValue({
      allowed: true,
      travelCharge: 0,
      message: '',
    })
  })

  it('uses exact pricing and staff availability without writing records', async () => {
    const client = {
      from(table: string) {
        if (!['service_catalog_items', 'staff_users'].includes(table)) {
          throw new Error(`Preview attempted mutation table ${table}`)
        }
        return new ReadQuery(table)
      },
    }

    const result = await createAiStyleBooking({
      supabase: client as never,
      customer: {
        first_name: 'Test',
        last_name: 'Customer',
        email: 'test@example.com',
        phone: '+17195550123',
      },
      address: {
        street_1: '123 Main St',
        city: 'Colorado Springs',
        state: 'CO',
        zip_code: '80903',
      },
      appointment_date: '2026-10-20',
      start_time: '09:00',
      line_items: [
        {
          service_id: '10000000-0000-4000-8000-000000000001',
          quantity: 1,
        },
      ],
      booking_mode: 'direct',
      booking_channel: 'ai_agent',
      source_label: 'Dot MCP',
      lead_source: 'google',
      actor_label: 'MCP (Charles)',
      admin_heading: 'MCP booking',
      assigned_staff_user_id: '20000000-0000-4000-8000-000000000001',
      notify_customer: false,
      notify_internal: true,
      sync_quickbooks: true,
      preview_only: true,
    })

    expect(result).toMatchObject({
      ok: true,
      preview_only: true,
      appointment_status: 'booked',
      assigned_staff_user_id: '20000000-0000-4000-8000-000000000001',
      subtotal: 300,
      total: 300,
      side_effects: {
        customer_notification: false,
        internal_notifications: true,
        quickbooks_sync: true,
        creates_invoice: true,
      },
    })
  })

  it('rejects a specifically assigned technician who is not free', async () => {
    const client = {
      from(table: string) {
        return new ReadQuery(table)
      },
    }

    const result = await createAiStyleBooking({
      supabase: client as never,
      customer: {
        first_name: 'Test',
        last_name: 'Customer',
        email: 'test@example.com',
        phone: '+17195550123',
      },
      address: {
        street_1: '123 Main St',
        city: 'Colorado Springs',
        state: 'CO',
        zip_code: '80903',
      },
      appointment_date: '2026-10-20',
      start_time: '09:00',
      line_items: [
        {
          service_id: '10000000-0000-4000-8000-000000000001',
          quantity: 1,
        },
      ],
      booking_mode: 'direct',
      booking_channel: 'ai_agent',
      source_label: 'Dot MCP',
      lead_source: 'google',
      actor_label: 'MCP (Charles)',
      admin_heading: 'MCP booking',
      assigned_staff_user_id: '30000000-0000-4000-8000-000000000001',
      preview_only: true,
    })

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('not available')
  })
})
