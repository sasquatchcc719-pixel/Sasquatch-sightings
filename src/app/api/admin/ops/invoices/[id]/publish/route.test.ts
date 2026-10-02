// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  assertAccess: vi.fn(),
  db: vi.fn(),
  enroll: vi.fn(),
  promote: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/ops/tech-job-access', () => ({
  assertTechInvoiceAccess: mocks.assertAccess,
}))
vi.mock('@/lib/ops/drip-campaign', () => ({
  enrollCustomerInDrip: mocks.enroll,
}))
vi.mock('@/lib/ops/invoice-on-completion', () => ({
  promoteInvoiceOnJobCompletion: mocks.promote,
}))
vi.mock('@/lib/echo/enqueue', () => ({ enqueue: vi.fn() }))

import { POST } from './route'

const context = { params: Promise.resolve({ id: 'invoice-a' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ id: 'owner-a', role: 'owner' })
  mocks.assertAccess.mockResolvedValue(undefined)
  mocks.enroll.mockResolvedValue(undefined)
  mocks.promote.mockResolvedValue({
    promoted: false,
    reason: 'not_draft',
  })

  const invoice = {
    id: 'invoice-a',
    total: 328,
    ops_invoice_line_items: [{ line_total: 328 }],
    ops_appointments: {
      id: 'appointment-a',
      appointment_date: '2026-09-30',
      start_time: '14:00',
      end_time: '17:00',
      kind: 'service',
      quoted_total: 328,
      on_my_way_at: '2026-09-30T19:17:22.000Z',
      completed_at: null,
      gps_lat: null,
      gps_lng: null,
      ops_service_addresses: {
        street_1: '123 Main St',
        city: 'Monument',
        state: 'CO',
        zip_code: '80132',
      },
      ops_appointment_line_items: [{ name_snapshot: 'Carpet cleaning' }],
    },
  }

  mocks.db.mockReturnValue({
    from: (table: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () =>
          table === 'ops_invoices'
            ? { data: invoice, error: null }
            : { data: null, error: null },
        ),
        then: (resolve: (value: { error: null }) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      }
      return builder
    },
  })
})

describe('publishing an invoice-backed job', () => {
  it('queues invoice promotion when publishing completes the appointment', async () => {
    const form = new FormData()
    form.set('image', new File(['photo'], 'job.jpg', { type: 'image/jpeg' }))
    form.set('description', 'Freshly cleaned carpet in Monument.')

    const response = await POST(
      new NextRequest(
        'https://example.com/api/admin/ops/invoices/invoice-a/publish',
        { method: 'POST', body: form },
      ),
      context,
    )

    expect(response.status).toBe(400)
    expect(mocks.promote).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appointment-a',
      userId: 'owner-a',
      note: 'Job completed while publishing map post',
    })
  })
})
