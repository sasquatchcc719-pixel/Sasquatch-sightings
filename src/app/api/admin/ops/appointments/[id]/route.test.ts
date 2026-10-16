// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  blacklisted: vi.fn(),
  communicate: vi.fn().mockResolvedValue({ sent: [] }),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/ops/tech-job-access', () => ({
  assertTechAppointmentAccess: vi.fn(),
}))
vi.mock('@/lib/ops/communications', () => ({
  sendOpsLifecycleCommunications: mocks.communicate,
  getOnMyWaySmsRenderedBody: vi.fn(),
}))
vi.mock('@/lib/quickbooks-api', () => ({
  resyncInvoiceToQuickBooks: vi.fn(),
  syncAppointmentToQuickBooks: vi.fn(),
}))
vi.mock('@/lib/ops/add-on-bonuses', () => ({
  captureAddOnBonusBaseline: vi.fn(),
}))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklisted }))

import { GET, PATCH } from './route'

const current = {
  id: 'job-1',
  customer_id: 'customer-1',
  appointment_date: '2026-10-15',
  start_time: '12:00:00',
  end_time: '15:00:00',
  assigned_staff_user_id: 'david',
  booking_channel: 'website',
  status: 'booked',
  payment_status: 'unpaid',
  ops_appointment_line_items: [],
}
let technician = { id: 'charles', is_active: true, show_on_calendar: true }
let customer = { phone: '+17195550191' }
let writeError: { message: string } | null
const params = { params: Promise.resolve({ id: current.id }) }

beforeEach(() => {
  vi.clearAllMocks()
  technician = { id: 'charles', is_active: true, show_on_calendar: true }
  customer = { phone: '+17195550191' }
  writeError = null
  mocks.blacklisted.mockResolvedValue(false)
  mocks.access.mockResolvedValue({ id: 'admin-user', role: 'admin' })
  mocks.rpc.mockImplementation((_name, args) => ({
    single: async () => ({
      data: { ...current, ...args.p_updates },
      error: writeError,
    }),
  }))
  mocks.admin.mockReturnValue({
    rpc: mocks.rpc,
    from(table: string) {
      let updates: Record<string, unknown> = {}
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update(values: Record<string, unknown>) {
          updates = values
          mocks.update(values)
          return query
        },
        single: async () => ({
          data: { ...current, ...updates },
          error: writeError,
        }),
        maybeSingle: async () => ({
          data: table === 'ops_customers' ? customer : technician,
          error: null,
        }),
        order: async () => ({
          data:
            table === 'staff_users'
              ? [
                  {
                    id: 'david',
                    display_name: 'David',
                    is_active: false,
                    show_on_calendar: false,
                  },
                  { ...technician, display_name: 'Charles' },
                  {
                    id: 'canvasser',
                    display_name: 'Canvasser',
                    is_active: true,
                    show_on_calendar: false,
                  },
                ]
              : [],
          error: null,
        }),
      }
      return query
    },
  })
})

function save(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest('https://example.test/api/admin/ops/appointments/job-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    params,
  )
}

describe('appointment technician assignment and admin override', () => {
  it('includes calendar technicians and retains an inactive current assignee', async () => {
    const response = await GET(new NextRequest('https://example.test'), params)
    expect(await response.json()).toMatchObject({
      can_override_conflict: true,
      staff: [{ id: 'david' }, { id: 'charles' }],
    })
  })

  it('saves date and technician together through the normal update', async () => {
    const response = await save({
      appointment_date: '2026-10-16',
      assigned_staff_user_id: 'charles',
    })
    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        appointment_date: '2026-10-16',
        assigned_staff_user_id: 'charles',
      }),
    )
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['admin', 'owner'])(
    'lets %s reschedule an existing blacklisted appointment without bypassing conflicts',
    async (role) => {
      mocks.access.mockResolvedValue({ id: 'staff-user', role })
      mocks.blacklisted.mockResolvedValue(true)

      const response = await save({ appointment_date: '2026-10-16' })

      expect(response.status).toBe(200)
      expect(mocks.blacklisted).toHaveBeenCalledWith('+17195550191')
      expect(mocks.rpc).toHaveBeenCalledWith(
        'admin_reschedule_blacklisted_appointment',
        {
          p_appointment_id: 'job-1',
          p_updates: expect.objectContaining({
            appointment_date: '2026-10-16',
          }),
        },
      )
      expect(mocks.update).not.toHaveBeenCalled()
    },
  )

  it.each(['admin', 'owner'])(
    'allows %s to override a website booking without rewriting its source',
    async (role) => {
      mocks.access.mockResolvedValue({ id: 'staff-user', role })
      const response = await save({
        appointment_date: '2026-10-16',
        assigned_staff_user_id: 'charles',
        allow_conflict: true,
        notify_customer_on_reschedule: true,
      })
      expect(response.status).toBe(200)
      expect(mocks.rpc).toHaveBeenCalledWith(
        'admin_override_appointment_schedule',
        {
          p_appointment_id: 'job-1',
          p_updates: expect.objectContaining({
            appointment_date: '2026-10-16',
            assigned_staff_user_id: 'charles',
          }),
        },
      )
      expect(mocks.rpc.mock.calls[0][1].p_updates).not.toHaveProperty(
        'booking_channel',
      )
      expect(mocks.communicate).toHaveBeenCalledWith({
        event: 'job_rescheduled',
        appointmentId: 'job-1',
      })
    },
  )

  it.each(['tech', 'dispatcher'])(
    'rejects an override from %s before writing',
    async (role) => {
      mocks.access.mockResolvedValue({ id: 'staff-user', role })
      const response = await save({ allow_conflict: true })
      expect(response.status).toBe(403)
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
    },
  )

  it('rejects technicians hidden from the calendar', async () => {
    technician.show_on_calendar = false
    const response = await save({ assigned_staff_user_id: 'charles' })
    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('prevents a tech from reassigning their own job', async () => {
    mocks.access.mockResolvedValue({ id: 'staff-user', role: 'tech' })
    const response = await save({ assigned_staff_user_id: 'charles' })
    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('keeps a database overlap rejection visible to the admin', async () => {
    writeError = { message: 'Appointment overlaps an active appointment.' }
    const response = await save({ appointment_date: '2026-10-16' })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe(writeError.message)
  })
})
