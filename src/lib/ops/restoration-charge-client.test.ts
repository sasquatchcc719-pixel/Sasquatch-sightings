import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteRestorationChargeAndRefresh } from './restoration-charge-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deleteRestorationChargeAndRefresh', () => {
  it('reloads authoritative project detail after a successful deletion', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const refresh = vi.fn().mockResolvedValue(undefined)

    await deleteRestorationChargeAndRefresh('/charge/123', refresh)

    expect(fetch).toHaveBeenCalledWith('/charge/123', { method: 'DELETE' })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(
      refresh.mock.invocationCallOrder[0],
    )
  })

  it('does not refresh when the server rejects a locked charge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'This charge is locked because the job is invoiced.',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    const refresh = vi.fn().mockResolvedValue(undefined)

    await expect(
      deleteRestorationChargeAndRefresh('/charge/123', refresh),
    ).rejects.toThrow('locked because the job is invoiced')
    expect(refresh).not.toHaveBeenCalled()
  })
})
