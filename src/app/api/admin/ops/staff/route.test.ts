// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
import { PATCH } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ id: 'owner', role: 'owner' })
  const query = {
    update: mocks.update.mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: 'brianna', show_on_calendar: false },
      error: null,
    }),
  }
  mocks.from.mockReturnValue(query)
})

function request(body: object) {
  return new NextRequest('https://example.test/api/admin/ops/staff', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('staff calendar visibility', () => {
  it('hides the calendar lane without changing login activation or payroll rate', async () => {
    const response = await PATCH(
      request({ staffId: 'brianna', showOnCalendar: false }),
    )
    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      show_on_calendar: false,
      updated_at: expect.any(String),
    })
    expect((await response.json()).staff.show_on_calendar).toBe(false)
  })

  it('keeps visibility unchanged when editing a payroll rate', async () => {
    expect(
      (await PATCH(request({ staffId: 'david', hourlyRate: 23.5 }))).status,
    ).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({
      hourly_rate: 23.5,
      updated_at: expect.any(String),
    })
  })

  it('rejects a string visibility value instead of treating it as true', async () => {
    expect(
      (await PATCH(request({ staffId: 'brianna', showOnCalendar: 'false' })))
        .status,
    ).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects requests without an editable field', async () => {
    expect((await PATCH(request({ staffId: 'brianna' }))).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('requires owner/admin access before changing a staff setting', async () => {
    mocks.access.mockRejectedValueOnce(new Error('Not authorized'))
    expect(
      (await PATCH(request({ staffId: 'brianna', showOnCalendar: false })))
        .status,
    ).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
