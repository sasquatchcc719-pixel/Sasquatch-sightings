import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  query: vi.fn(),
  appointments: [] as unknown[],
  staff: [] as unknown[],
  error: null as unknown,
  planned: vi.fn(),
}))
vi.mock('@/lib/ops/planned-driving', () => ({
  loadPlannedDriving: mocks.planned,
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.guard }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
import { GET } from './route'
const request = (date = '2026-10-19') =>
  new NextRequest('https://example.test/api?date=' + date)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.error = null
  mocks.planned.mockResolvedValue([])
  mocks.guard.mockResolvedValue({})
  mocks.staff = [
    { id: 'staff1', user_id: 'user1', display_name: 'Example tech' },
  ]
  mocks.appointments = [
    {
      id: 'job1',
      appointment_date: '2026-10-19',
      start_time: '10:00:00',
      end_time: '11:00:00',
      status: 'booked',
      kind: 'service',
      assigned_staff_user_id: 'user1',
      gps_lat: null,
      gps_lng: null,
      ops_customers: { full_name: 'Example customer', business_name: null },
      ops_service_addresses: {
        street_1: '12 Example St',
        city: 'Monument',
        state: 'CO',
        zip_code: '80132',
        latitude: 39.15,
        longitude: -104.87,
        geocoded_at: '2026-10-19',
        geocode_source: 'nominatim-street-verified',
      },
      ops_invoices: [{ id: 'invoice1' }],
    },
  ]
  mocks.from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'neq', 'is', 'order'])
      q[method] = (...args: unknown[]) => {
        mocks.query(table, method, ...args)
        return q
      }
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: table === 'ops_appointments' ? mocks.appointments : mocks.staff,
        error: mocks.error,
      }).then(resolve)
    return q
  })
})
it('authenticates before loading job addresses and rejects malformed dates', async () => {
  mocks.guard.mockRejectedValueOnce(Error('Unauthorized'))
  expect((await GET(request())).status).toBe(401)
  expect(mocks.from).not.toHaveBeenCalled()
  expect(mocks.planned).not.toHaveBeenCalled()
  expect((await GET(request('2026-02-30'))).status).toBe(400)
  expect(mocks.from).not.toHaveBeenCalled()
})
it('only calculates road routes when explicitly requested for an authorized daily schedule', async () => {
  await GET(request())
  expect(mocks.planned).not.toHaveBeenCalled()
  const res = await GET(
    new NextRequest('https://example.test/api?date=2026-10-19&routes=1'),
  )
  expect(res.status).toBe(200)
  expect(mocks.planned).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'job1', staffId: 'staff1' }),
  ])
  expect((await res.json()).plannedDrives).toEqual([])
})
it('loads only the selected calendar day and omits cancelled and parked visits', async () => {
  const response = await GET(request())
  expect(response.status).toBe(200)
  const data = await response.json()
  expect(data.date).toBe('2026-10-19')
  expect(data.jobs[0]).toMatchObject({
    staffId: 'staff1',
    staffName: 'Example tech',
    href: '/admin/operations/invoices/invoice1',
    location: { lat: 39.15, lng: -104.87 },
  })
  expect(mocks.query).toHaveBeenCalledWith(
    'ops_appointments',
    'eq',
    'appointment_date',
    '2026-10-19',
  )
  expect(mocks.query).toHaveBeenCalledWith(
    'ops_appointments',
    'neq',
    'status',
    'cancelled',
  )
  expect(mocks.query).toHaveBeenCalledWith(
    'ops_appointments',
    'is',
    'parked_at',
    null,
  )
  expect(mocks.guard).toHaveBeenCalledWith(['owner', 'admin', 'dispatcher'])
  expect(
    mocks.query.mock.calls.find(
      (c) => c[0] === 'ops_appointments' && c[1] === 'select',
    )?.[2],
  ).not.toMatch(/email|phone|gate_code|token_hash/)
})
it('does not hide database failure behind an empty daily schedule', async () => {
  mocks.error = { message: 'unavailable' }
  expect((await GET(request())).status).toBe(503)
})
