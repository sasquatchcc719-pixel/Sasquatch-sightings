// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ access: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/components/admin/ops/commercial-estimate-workspace', () => ({
  CommercialEstimateWorkspace: () => null,
}))

import NewEstimatePage from './page'

beforeEach(() => vi.clearAllMocks())

it('requires a scheduling role and renders the dedicated commercial workspace', async () => {
  mocks.access.mockResolvedValue({ role: 'dispatcher' })

  const result = await NewEstimatePage()

  expect(mocks.access).toHaveBeenCalledWith(['admin', 'owner', 'dispatcher'])
  expect(result.type.name).toBe('CommercialEstimateWorkspace')
})
