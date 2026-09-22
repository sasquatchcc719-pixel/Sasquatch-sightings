// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  slots: vi.fn(),
  prioritizedSlots: vi.fn(),
  resolveAddress: vi.fn(),
  sms: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/lib/ops/staff-availability', () => ({
  getSlotsForStaff: mocks.slots,
  getStaffPrioritizedSlots: mocks.prioritizedSlots,
}))
vi.mock('@/lib/ops/addresses', () => ({
  resolveServiceAddress: mocks.resolveAddress,
}))
vi.mock('@/lib/twilio', () => ({ sendAdminSMS: mocks.sms }))
vi.mock('@/lib/onesignal', () => ({
  sendOneSignalNotification: mocks.push,
}))

import { createAiStyleEstimate } from './create-ai-style-estimate'

type DbMode = 'existing' | 'new'

function fakeDb(mode: DbMode) {
  const tables: string[] = []
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  let customerLookup = 0

  function from(table: string) {
    tables.push(table)
    let operation: 'select' | 'insert' | 'update' = 'select'
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      update: vi.fn((payload: Record<string, unknown>) => {
        operation = 'update'
        updates.push({ table, payload })
        return builder
      }),
      insert: vi.fn((payload: Record<string, unknown>) => {
        operation = 'insert'
        inserts.push({ table, payload })
        return builder
      }),
      maybeSingle: vi.fn(async () => {
        if (table === 'ops_service_addresses') {
          return {
            data:
              mode === 'existing'
                ? {
                    id: 'address-existing',
                    street_1: '200 Commerce Dr',
                    city: 'Monument',
                    state: 'CO',
                    zip_code: '80132',
                  }
                : null,
          }
        }
        if (table === 'ops_customers') {
          customerLookup += 1
          return {
            data:
              mode === 'existing' && customerLookup === 1
                ? { id: 'customer-existing' }
                : null,
          }
        }
        return { data: null }
      }),
      single: vi.fn(async () => {
        if (table === 'ops_customers' && operation === 'insert') {
          return { data: { id: 'customer-new' }, error: null }
        }
        if (table === 'ops_appointments' && operation === 'insert') {
          return { data: { id: 'appointment-new' }, error: null }
        }
        return { data: null, error: null }
      }),
      then: (resolve: (value: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return builder
  }

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    inserts,
    updates,
  }
}

const baseInput = {
  customer: {
    business_name: 'High Plains Dental',
    first_name: 'Riley',
    last_name: 'Park',
    email: 'riley@example.com',
    phone: '(719) 555-0123',
  },
  address: {
    street_1: '',
    street_2: '',
    city: '',
    state: 'CO',
    zip_code: '',
  },
  appointment_date: '2026-09-23',
  start_time: '11:00',
  visit_duration_minutes: 60,
  assigned_staff_user_id: 'staff-one',
  job_description: 'Measure offices and hallways.',
  booking_channel: 'admin',
  source_label: 'Admin Commercial Estimate',
  lead_source: 'google_search',
  actor_label: 'dispatcher@example.com',
  admin_heading: 'commercial estimate scheduled',
  created_by: 'dispatcher-id',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.slots.mockResolvedValue([
    { start_time: '11:00:00', end_time: '13:00:00' },
  ])
  mocks.resolveAddress.mockResolvedValue({ id: 'address-new' })
  mocks.sms.mockResolvedValue(true)
  mocks.push.mockResolvedValue(true)
})

describe('createAiStyleEstimate', () => {
  it('reuses a selected business/address and creates only a structured draft walkthrough', async () => {
    const db = fakeDb('existing')

    const result = await createAiStyleEstimate({
      ...baseInput,
      supabase: db.client,
      customer_id: 'customer-existing',
      service_address_id: 'address-existing',
    })

    expect(result).toMatchObject({
      ok: true,
      appointment_id: 'appointment-new',
    })
    const appointment = db.inserts.find(
      (row) => row.table === 'ops_appointments',
    )?.payload
    expect(appointment).toMatchObject({
      customer_id: 'customer-existing',
      service_address_id: 'address-existing',
      kind: 'estimate',
      estimate_status: 'draft',
      quoted_total: 0,
      quickbooks_sync_status: 'held',
      assigned_staff_user_id: 'staff-one',
      start_time: '11:00:00',
      end_time: '13:00:00',
    })
    expect(db.tables).not.toContain('ops_invoices')
    expect(db.tables).not.toContain('ops_invoice_line_items')
    expect(mocks.sms).toHaveBeenCalledWith(
      expect.stringContaining('200 Commerce Dr, Monument, CO 80132'),
      'new_estimate',
    )
    expect(mocks.push).toHaveBeenCalledOnce()
  })

  it('deduplicates lookups, normalizes phone, and creates a commercial prospect when no match exists', async () => {
    const db = fakeDb('new')

    const result = await createAiStyleEstimate({
      ...baseInput,
      supabase: db.client,
      address: {
        street_1: '10 N Cascade Ave',
        street_2: 'Suite 200',
        city: 'Colorado Springs',
        state: 'CO',
        zip_code: '80903',
      },
      notify_admin: false,
    })

    expect(result.ok).toBe(true)
    expect(
      db.inserts.find((row) => row.table === 'ops_customers')?.payload,
    ).toMatchObject({
      business_name: 'High Plains Dental',
      is_commercial: true,
      phone: '+17195550123',
    })
    expect(mocks.resolveAddress).toHaveBeenCalledWith(
      db.client,
      'customer-new',
      expect.objectContaining({ street_1: '10 N Cascade Ave' }),
    )
    expect(mocks.sms).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
