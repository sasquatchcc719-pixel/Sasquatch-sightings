// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  booking: vi.fn(),
  geocode: vi.fn(),
  cancelReactivation: vi.fn(),
}))

vi.mock('@/lib/ops/create-ai-style-booking', () => ({
  createAiStyleBooking: mocks.booking,
}))
vi.mock('@/lib/ops/forward-geocode', () => ({
  invalidateGeocodeForAddressUpdate: vi.fn(),
  queueGeocodeForStoredAddress: mocks.geocode,
}))
vi.mock('@/lib/ops/reactivation-campaign', () => ({
  cancelReactivationForCustomer: mocks.cancelReactivation,
}))

import {
  executePreparedAction,
  previewAppointmentCreate,
} from './business-operations'

const actor = {
  subject: '40000000-0000-4000-8000-000000000001',
  label: 'Charles',
  scopes: ['business:write', 'finance:write'],
}

const lsaPlan = {
  ok: true as const,
  preview_only: true as const,
  appointment_status: 'booked' as const,
  appointment_date: '2026-11-05',
  start_time: '15:00',
  end_time: '17:00',
  assigned_staff_user_id: '20000000-0000-4000-8000-000000000001',
  technician_name: 'Charles',
  subtotal: 340,
  discount_applied: 0,
  total: 340,
  line_items: [
    {
      service_catalog_item_id: '10000000-0000-4000-8000-000000000001',
      name_snapshot: 'Carpet cleaning',
      quantity: 1,
      unit_price: 300,
      line_total: 300,
      duration_minutes: 120,
      pricing_unit: 'fixed',
    },
    {
      service_catalog_item_id: null,
      name_snapshot: 'Google LSA Lead Charge',
      quantity: 1,
      unit_price: 40,
      line_total: 40,
      duration_minutes: 0,
      pricing_unit: 'fixed',
    },
  ],
  lead_source: {
    lead_source: 'Google Local Services',
    lead_source_key: 'google_lsa',
    lead_source_detail: null,
    original_lead_source: null,
  },
  side_effects: {
    customer_notification: false,
    internal_notifications: false,
    quickbooks_sync: false,
    creates_invoice: true as const,
  },
}

type Action = Record<string, unknown>

class Query {
  private inserted: Action | null = null
  private updated: Action | null = null

  constructor(
    private readonly table: string,
    private readonly state: { action: Action | null },
  ) {}

  select() {
    return this
  }
  eq() {
    return this
  }
  lt() {
    return this
  }
  update(value: Action) {
    this.updated = value
    return this
  }
  insert(value: Action) {
    this.inserted = value
    return this
  }
  maybeSingle() {
    if (this.table !== 'mcp_action_previews') {
      return Promise.resolve({ data: null, error: null })
    }
    if (this.updated?.status === 'executing') {
      Object.assign(this.state.action || {}, this.updated)
      return Promise.resolve({
        data: { id: this.state.action?.id },
        error: null,
      })
    }
    return Promise.resolve({ data: this.state.action, error: null })
  }
  single() {
    if (this.table !== 'mcp_action_previews' || !this.inserted) {
      throw new Error('Unexpected single()')
    }
    this.state.action = {
      id: '30000000-0000-4000-8000-000000000001',
      status: 'pending',
      ...this.inserted,
    }
    return Promise.resolve({
      data: {
        id: this.state.action.id,
        preview: this.state.action.preview,
        status: this.state.action.status,
        expires_at: this.state.action.expires_at,
      },
      error: null,
    })
  }
}

function fixture() {
  const state = {
    action: null as Action | null,
    rpcPlan: null as Action | null,
  }
  return {
    state,
    client: {
      from(table: string) {
        return new Query(table, state)
      },
      async rpc(_name: string, args: { p_plan: Action }) {
        state.rpcPlan = args.p_plan
        return {
          data: {
            customer_id: '50000000-0000-4000-8000-000000000001',
            address_id: '60000000-0000-4000-8000-000000000001',
            appointment_id: '70000000-0000-4000-8000-000000000001',
            invoice_id: '80000000-0000-4000-8000-000000000001',
            appointment_status: 'booked',
            subtotal: 340,
            discount_applied: 0,
            total: 340,
          },
          error: null,
        }
      },
    },
  }
}

describe('MCP LSA appointment confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.booking.mockResolvedValue(lsaPlan)
    mocks.geocode.mockResolvedValue(undefined)
    mocks.cancelReactivation.mockResolvedValue(undefined)
  })

  it('revalidates and executes the same server-calculated fee shown in preview', async () => {
    const { client, state } = fixture()
    const preview = await previewAppointmentCreate(
      {
        customer: {
          first_name: 'Raymond',
          last_name: 'Customer',
          email: 'raymond@example.com',
          phone: '+17195550123',
        },
        address: {
          street_1: '123 Main St',
          city: 'Colorado Springs',
          state: 'CO',
          zip_code: '80903',
        },
        appointment_date: '2026-11-05',
        start_time: '15:00',
        line_items: [
          {
            service_id: '10000000-0000-4000-8000-000000000001',
            quantity: 1,
          },
        ],
        lead_source: 'google_lsa',
        accepted_minimum_charge: false,
        notify_customer: false,
        notify_internal: false,
        sync_quickbooks: false,
        idempotency_key: 'raymond-lsa-booking',
      },
      actor,
      client as never,
    )

    expect(preview.preview).toMatchObject({ subtotal: 340, total: 340 })
    expect(preview.preview.line_items).toContainEqual(
      expect.objectContaining({
        service_catalog_item_id: null,
        name_snapshot: 'Google LSA Lead Charge',
        unit_price: 40,
      }),
    )

    const result = await executePreparedAction(
      {
        confirmation_id: preview.confirmation_id,
        confirmed: true,
        expected_action_type: 'appointment.create',
      },
      actor,
      client as never,
    )

    expect(mocks.booking).toHaveBeenCalledTimes(2)
    expect(mocks.booking).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        booking_channel: 'ai_agent',
        lead_source: 'google_lsa',
        preview_only: true,
      }),
    )
    expect(state.rpcPlan).toMatchObject({
      subtotal: 340,
      total: 340,
      line_items: lsaPlan.line_items,
    })
    expect(result).toMatchObject({ subtotal: 340, total: 340 })
  })
})
