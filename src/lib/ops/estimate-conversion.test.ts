// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  executeAtomicEstimateConversion,
  prepareEstimateConversion,
} from './estimate-conversion'

const STAFF_ID = '20000000-0000-4000-8000-000000000001'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const ESTIMATE_ID = '50000000-0000-4000-8000-000000000001'

function fixture() {
  const state = {
    firstLineTotal: 910,
    firstSortOrder: 0,
    rpcCalls: [] as Array<{ name: string; params: Record<string, unknown> }>,
  }
  const estimate = () => ({
    id: ESTIMATE_ID,
    kind: 'estimate',
    customer_id: '30000000-0000-4000-8000-000000000001',
    service_address_id: '40000000-0000-4000-8000-000000000001',
    estimate_status: 'accepted',
    converted_appointment_id: null,
    updated_at: '2026-10-13T03:00:00Z',
    ops_customers: {
      id: '30000000-0000-4000-8000-000000000001',
      full_name: 'Fixture Customer',
      business_name: null,
      email: 'fixture@example.test',
      phone: '+17195550123',
    },
    ops_service_addresses: {
      id: '40000000-0000-4000-8000-000000000001',
      street_1: '123 Fixture St',
      street_2: null,
      city: 'Colorado Springs',
      state: 'CO',
      zip_code: '80903',
    },
    ops_appointment_line_items: [
      {
        id: '60000000-0000-4000-8000-000000000001',
        name_snapshot: 'Commercial carpet',
        sort_order: state.firstSortOrder,
        quantity: 2600,
        unit_price: 0.35,
        line_total: state.firstLineTotal,
        length_value: 40,
        width_value: 60,
        pricing_unit_snapshot: 'per_sq_ft',
        area_segments: [{ length: 40, width: 60 }],
      },
      {
        id: '60000000-0000-4000-8000-000000000002',
        name_snapshot: 'Deodorizer',
        sort_order: 1,
        quantity: 2600,
        unit_price: 0.04,
        line_total: 104,
        length_value: 40,
        width_value: 60,
        pricing_unit_snapshot: 'per_sq_ft',
        area_segments: [{ length: 40, width: 60 }],
      },
    ],
  })
  const client = {
    from(table: string) {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle: async () => {
          if (table === 'staff_users') {
            return {
              data: {
                id: STAFF_ID,
                user_id: ACTOR_ID,
                display_name: 'Fixture Tech',
              },
              error: null,
            }
          }
          if (table === 'ops_appointments') {
            return { data: estimate(), error: null }
          }
          throw new Error(`Unexpected table ${table}`)
        },
      }
    },
    async rpc(name: string, params: Record<string, unknown>) {
      state.rpcCalls.push({ name, params })
      return {
        data: {
          estimate_id: ESTIMATE_ID,
          appointment_id: '70000000-0000-4000-8000-000000000001',
          invoice_id: '80000000-0000-4000-8000-000000000001',
          subtotal: 1014,
          discount_amount: 14,
          total: 1000,
        },
        error: null,
      }
    },
  }
  return { client, state }
}

describe('atomic estimate conversion service', () => {
  it('previews the exact tiered window, copied measurements, and invoice totals', async () => {
    const { client } = fixture()
    const prepared = await prepareEstimateConversion({
      supabase: client as never,
      estimateId: ESTIMATE_ID,
      appointmentDate: '2030-01-16',
      startTime: '09:00',
      assignedStaffUserId: STAFF_ID,
      discountAmount: 14,
      allowConflict: true,
      notifyCustomer: false,
      syncQuickBooks: false,
    })

    expect(prepared).toMatchObject({
      subtotal: 1014,
      discount_amount: 14,
      total: 1000,
      service_minutes: 240,
      start_time: '09:00:00',
      end_time: '13:00:00',
      notify_customer: false,
      sync_quickbooks: false,
    })
    expect(prepared.line_items[0]).toMatchObject({
      length_value: 40,
      width_value: 60,
      pricing_unit: 'per_sq_ft',
      area_segments: [{ length: 40, width: 60 }],
    })
  })

  it('preserves saved room order and changes the preview fingerprint for order-only edits', async () => {
    const { client, state } = fixture()
    const params = {
      supabase: client as never,
      estimateId: ESTIMATE_ID,
      appointmentDate: '2030-01-16',
      startTime: '09:00',
      assignedStaffUserId: STAFF_ID,
      allowConflict: true,
      notifyCustomer: false,
      syncQuickBooks: false,
    }
    const first = await prepareEstimateConversion(params)
    state.firstSortOrder = 2
    const reordered = await prepareEstimateConversion(params)
    expect(reordered.line_items.map((line) => line.name)).toEqual([
      'Deodorizer',
      'Commercial carpet',
    ])
    expect(reordered.total).toBe(first.total)
    expect(reordered.preview_fingerprint).not.toBe(first.preview_fingerprint)
  })

  it('revalidates the fingerprint and calls only the atomic RPC', async () => {
    const { client, state } = fixture()
    const prepared = await prepareEstimateConversion({
      supabase: client as never,
      estimateId: ESTIMATE_ID,
      appointmentDate: '2030-01-16',
      startTime: '09:00',
      assignedStaffUserId: STAFF_ID,
      discountAmount: 14,
      allowConflict: true,
      notifyCustomer: false,
      syncQuickBooks: false,
    })
    const result = await executeAtomicEstimateConversion({
      supabase: client as never,
      prepared,
      actorId: ACTOR_ID,
      allowConflict: true,
      notifyCustomer: false,
      syncQuickBooks: false,
    })

    expect(result).toMatchObject({ total: 1000, warnings: [] })
    expect(state.rpcCalls).toHaveLength(1)
    expect(state.rpcCalls[0]).toMatchObject({
      name: 'mcp_convert_estimate',
      params: {
        p_estimate_id: ESTIMATE_ID,
        p_expected_status: 'accepted',
        p_allow_conflict: true,
      },
    })
  })

  it('refuses execution when line pricing changes after preview', async () => {
    const { client, state } = fixture()
    const prepared = await prepareEstimateConversion({
      supabase: client as never,
      estimateId: ESTIMATE_ID,
      appointmentDate: '2030-01-16',
      startTime: '09:00',
      assignedStaffUserId: STAFF_ID,
      allowConflict: true,
      notifyCustomer: false,
      syncQuickBooks: false,
    })
    state.firstLineTotal = 950

    await expect(
      executeAtomicEstimateConversion({
        supabase: client as never,
        prepared,
        actorId: ACTOR_ID,
        allowConflict: true,
        notifyCustomer: false,
        syncQuickBooks: false,
      }),
    ).rejects.toThrow('changed after preview')
    expect(state.rpcCalls).toHaveLength(0)
  })
})
