import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  upsert: vi.fn(),
  single: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: (...args: unknown[]) => {
        mocks.upsert(...args)
        return { select: () => ({ single: mocks.single }) }
      },
    }),
  }),
}))

import { PATCH } from './route'

function patchRequest(body: object) {
  return new NextRequest('https://example.com/api', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ id: 'owner' })
  mocks.single.mockResolvedValue({ data: { id: 'override' }, error: null })
})

describe('payroll component overrides API', () => {
  it('saves a two-decimal override without changing the source record', async () => {
    const response = await PATCH(
      patchRequest({
        component: 'gratuity',
        sourceKey: 'invoice-1',
        overrideAmount: 0.29,
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'gratuity',
        source_key: 'invoice-1',
        override_amount: 0.29,
        created_by: 'owner',
      }),
      { onConflict: 'component,source_key' },
    )
  })

  it('rejects amounts with more than two decimals', async () => {
    const response = await PATCH(
      patchRequest({
        component: 'add_on_bonus',
        sourceKey: 'job:tech:category',
        overrideAmount: 12.345,
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
