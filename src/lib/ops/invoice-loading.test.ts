import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchInvoiceWithRetry,
  settleOptionalInvoiceLookup,
} from './invoice-loading'

afterEach(() => {
  vi.useRealTimers()
})

describe('invoice loading', () => {
  it('retries one transient request failure', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network interrupted'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invoice: { id: 'inv-1' } }), {
          status: 200,
        }),
      )

    await expect(
      fetchInvoiceWithRetry<{ invoice: { id: string } }>('inv-1', {
        fetcher,
        timeoutMs: 100,
      }),
    ).resolves.toEqual({ invoice: { id: 'inv-1' } })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stops waiting and gives the user a useful error', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )

    const request = fetchInvoiceWithRetry('inv-1', {
      fetcher,
      timeoutMs: 50,
    })
    const expectation = expect(request).rejects.toThrow(
      'This job took too long to load. Please try again.',
    )
    await vi.advanceTimersByTimeAsync(100)
    await expectation
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('returns fallback data when an optional lookup stalls', async () => {
    vi.useFakeTimers()
    const lookup = new Promise<string[]>(() => undefined)
    const result = settleOptionalInvoiceLookup(lookup, [], 50)

    await vi.advanceTimersByTimeAsync(50)
    await expect(result).resolves.toEqual({ value: [], outcome: 'timeout' })
  })
})
