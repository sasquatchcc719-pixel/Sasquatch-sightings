// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), db: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))

import { GET, POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ id: 'staff-a' })
})

describe('retired estimate creation', () => {
  it('rejects legacy creation without opening a database client', async () => {
    const response = await POST()

    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({
      redirect_url: '/admin/operations/new-job?mode=estimate',
    })
    expect(mocks.db).not.toHaveBeenCalled()
  })

  it('still requires staff access and never writes on an unauthorized request', async () => {
    mocks.access.mockRejectedValueOnce(new Error('Forbidden'))
    const response = await POST()

    expect(response.status).toBe(403)
    expect(mocks.db).not.toHaveBeenCalled()
  })

  it('keeps existing estimate history available through read-only GET queries', async () => {
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
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('ops_appointments')
    expect(query.eq).toHaveBeenCalledWith('kind', 'estimate')
    expect(query.eq).toHaveBeenCalledWith('estimate_status', 'accepted')
  })
})
