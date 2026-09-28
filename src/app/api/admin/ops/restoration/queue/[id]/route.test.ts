// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  requireAnyRole: vi.fn().mockResolvedValue({ id: 'owner' }),
}))

vi.mock('@/lib/auth', () => ({
  requireAnyRole: mocks.requireAnyRole,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

import { DELETE } from './route'

describe('DELETE /api/admin/ops/restoration/queue/:id', () => {
  it('deletes only a visit that is still queued', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 'queue-1' }, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const statusEq = vi.fn().mockReturnValue({ select })
    const idEq = vi.fn().mockReturnValue({ eq: statusEq })
    const deleteRow = vi.fn().mockReturnValue({ eq: idEq })
    mocks.from.mockReturnValue({ delete: deleteRow })

    const response = await DELETE(new Request('https://example.test'), {
      params: Promise.resolve({ id: 'queue-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      queue_id: 'queue-1',
    })
    expect(mocks.from).toHaveBeenCalledWith('restoration_visit_queue')
    expect(idEq).toHaveBeenCalledWith('id', 'queue-1')
    expect(statusEq).toHaveBeenCalledWith('status', 'queued')
  })
})
