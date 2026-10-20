import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  invoice: vi.fn(),
  visits: vi.fn(),
  trips: vi.fn(),
  or: vi.fn(),
  eq: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.guard }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
import { GET } from './route'
const invoiceId = '19423b52-dae5-43f0-937d-b9779b6b6730'
const appointmentId = 'afbb1664-d323-4d2d-a49b-e46b99b8f31e'
const request = new NextRequest(
  `https://example.com/api/admin/ops/invoices/${invoiceId}/vehicle-history`,
)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({ role: 'owner' })
  mocks.invoice.mockResolvedValue({
    data: { appointment_id: appointmentId },
    error: null,
  })
  mocks.visits.mockResolvedValue({ data: [], error: null })
  mocks.trips.mockResolvedValue({ data: [], error: null })
  mocks.eq.mockImplementation(() => ({
    order: () => ({ limit: mocks.visits }),
  }))
  mocks.or.mockReturnValue({ order: () => ({ limit: mocks.trips }) })
  mocks.from.mockImplementation((table: string) => ({
    select: () =>
      table === 'ops_invoices'
        ? { eq: () => ({ maybeSingle: mocks.invoice }) }
        : table === 'fleet_job_visits'
          ? { eq: mocks.eq }
          : { eq: () => ({ or: mocks.or }) },
  }))
})
it('rejects technicians and customers before reading any invoice or GPS data', async () => {
  mocks.guard.mockRejectedValue(new Error('Unauthorized'))
  expect(
    (await GET(request, { params: Promise.resolve({ id: invoiceId }) })).status,
  ).toBe(401)
  expect(mocks.guard).toHaveBeenCalledWith(['owner', 'admin', 'dispatcher'])
  expect(mocks.from).not.toHaveBeenCalled()
})
it('scopes both visit and trip reads to the invoice appointment', async () => {
  const response = await GET(request, {
    params: Promise.resolve({ id: invoiceId }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(mocks.eq).toHaveBeenCalledWith('appointment_id', appointmentId)
  expect(mocks.or).toHaveBeenCalledWith(
    `origin_appointment_id.eq.${appointmentId},destination_appointment_id.eq.${appointmentId}`,
  )
  expect(await response.json()).toEqual({
    appointmentId,
    visits: [],
    trips: [],
  })
})
it('reports unavailable history instead of silently showing an empty log', async () => {
  mocks.visits.mockResolvedValue({
    data: null,
    error: { message: 'unavailable' },
  })
  expect(
    (await GET(request, { params: Promise.resolve({ id: invoiceId }) })).status,
  ).toBe(503)
})
it('rejects malformed invoice ids without querying the database', async () => {
  expect(
    (await GET(request, { params: Promise.resolve({ id: 'invalid' }) })).status,
  ).toBe(400)
  expect(mocks.from).not.toHaveBeenCalled()
})
