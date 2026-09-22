// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  createEstimate: vi.fn(),
  db: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/lib/ops/create-ai-style-estimate', () => ({
  createAiStyleEstimate: mocks.createEstimate,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))

import { GET, POST } from './route'

const staffId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const addressId = '33333333-3333-4333-8333-333333333333'

function postRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('https://example.com/api/admin/ops/estimates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_id: customerId,
      service_address_id: addressId,
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
      assigned_staff_user_id: staffId,
      job_description: 'Measure offices and hallways.',
      lead_source: 'google_search',
      lead_source_detail: null,
      ...overrides,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    role: 'dispatcher',
    email: 'dispatch@example.com',
  })
  mocks.db.mockReturnValue({ from: vi.fn() })
  mocks.createEstimate.mockResolvedValue({
    ok: true,
    appointment_id: 'estimate-appointment',
    confirmation_number: 'EST-ESTIMATE',
  })
})

describe('commercial estimate creation', () => {
  it('authorizes dispatch roles and delegates an existing business to the shared structured creator', async () => {
    const db = { from: vi.fn() }
    mocks.db.mockReturnValue(db)

    const response = await POST(postRequest())

    expect(response.status).toBe(201)
    expect(mocks.access).toHaveBeenCalledWith(['admin', 'owner', 'dispatcher'])
    expect(mocks.createEstimate).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: db,
        customer_id: customerId,
        service_address_id: addressId,
        appointment_date: '2026-09-23',
        start_time: '11:00',
        visit_duration_minutes: 60,
        assigned_staff_user_id: staffId,
        booking_channel: 'admin',
        source_label: 'Admin Commercial Estimate',
        actor_label: 'dispatch@example.com',
        created_by: '44444444-4444-4444-8444-444444444444',
      }),
    )
  })

  it('accepts a new business payload without customer or address ids', async () => {
    const response = await POST(
      postRequest({
        customer_id: null,
        service_address_id: null,
        address: {
          street_1: '10 N Cascade Ave',
          street_2: 'Suite 200',
          city: 'Colorado Springs',
          state: 'CO',
          zip_code: '80903',
        },
      }),
    )

    expect(response.status).toBe(201)
    expect(mocks.createEstimate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: null,
        service_address_id: null,
        address: expect.objectContaining({ street_1: '10 N Cascade Ave' }),
      }),
    )
  })

  it('returns a scheduling conflict without inventing a fallback booking', async () => {
    mocks.createEstimate.mockResolvedValueOnce({
      ok: false,
      error: 'That technician is not available.',
      suggested_slots: ['13:00'],
    })

    const response = await POST(postRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      ok: false,
      suggested_slots: ['13:00'],
    })
  })

  it('never opens the database when the user lacks a scheduling role', async () => {
    mocks.access.mockRejectedValueOnce(new Error('Not authorized'))

    const response = await POST(postRequest())

    expect(response.status).toBe(403)
    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.createEstimate).not.toHaveBeenCalled()
  })
})

it('keeps existing estimate history available through filtered GET queries', async () => {
  const estimates = [{ id: 'existing-estimate', estimate_status: 'accepted' }]
  const result = { data: estimates, error: null }
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
  }
  const from = vi.fn().mockReturnValue(query)
  mocks.db.mockReturnValue({ from })

  const response = await GET(
    new NextRequest(
      'https://example.com/api/admin/ops/estimates?status=accepted',
    ),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ estimates })
  expect(from).toHaveBeenCalledWith('ops_appointments')
  expect(query.eq).toHaveBeenCalledWith('kind', 'estimate')
  expect(query.eq).toHaveBeenCalledWith('estimate_status', 'accepted')
})
