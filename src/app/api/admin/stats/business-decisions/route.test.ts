// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: vi.fn(),
  load: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/ops/business-decisions', () => ({
  loadBusinessDecisionSnapshot: mocks.load,
}))
import { GET } from './route'

describe('business decision snapshot API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('requires admin or owner before constructing the privileged client', async () => {
    mocks.auth.mockRejectedValue(new Error('Not authorized'))
    const response = await GET()
    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.auth).toHaveBeenCalledWith(['admin', 'owner'])
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it.each(['admin', 'owner'])(
    'returns uncached snapshot for authorized %s',
    async (role) => {
      const db = { readOnlyTestClient: true }
      const snapshot = { read_only: true, coverage: { status: 'complete' } }
      mocks.auth.mockResolvedValue({ role })
      mocks.db.mockReturnValue(db)
      mocks.load.mockResolvedValue(snapshot)
      const response = await GET()
      expect(mocks.auth).toHaveBeenCalledOnce()
      expect(mocks.auth).toHaveBeenCalledWith(['admin', 'owner'])
      expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.db.mock.invocationCallOrder[0],
      )
      expect(mocks.db).toHaveBeenCalledOnce()
      expect(mocks.load).toHaveBeenCalledOnce()
      expect(mocks.load).toHaveBeenCalledWith(db)
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual(snapshot)
    },
  )

  it('preserves explicit partial coverage rather than converting it into success totals', async () => {
    const snapshot = {
      read_only: true,
      coverage: { status: 'partial', missing: ['Completed work unavailable'] },
      performance: null,
      upcoming: null,
    }
    mocks.auth.mockResolvedValue({ role: 'owner' })
    mocks.load.mockResolvedValue(snapshot)
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual(snapshot)
  })

  it('fails closed when authorization lookup unexpectedly fails', async () => {
    mocks.auth.mockRejectedValue(new Error('Private auth backend detail'))
    const response = await GET()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Could not load business decisions',
    })
    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it.each(['client', 'loader'])(
    'returns a generic error when the %s fails',
    async (failure) => {
      mocks.auth.mockResolvedValue({ role: 'owner' })
      const privateError = new Error('Private database detail')
      if (failure === 'client')
        mocks.db.mockImplementation(() => {
          throw privateError
        })
      else mocks.load.mockRejectedValue(privateError)
      const response = await GET()
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'Could not load business decisions',
      })
      if (failure === 'client') expect(mocks.load).not.toHaveBeenCalled()
    },
  )
})
