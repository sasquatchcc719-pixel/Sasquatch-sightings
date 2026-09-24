const DEFAULT_INVOICE_REQUEST_TIMEOUT_MS = 8_000

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export async function fetchInvoiceWithRetry<T>(
  invoiceId: string,
  options?: {
    fetcher?: Fetcher
    timeoutMs?: number
  },
): Promise<T> {
  const fetcher = options?.fetcher ?? fetch
  const timeoutMs = options?.timeoutMs ?? DEFAULT_INVOICE_REQUEST_TIMEOUT_MS
  let lastError = new Error('Failed to load invoice')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetcher(`/api/admin/ops/invoices/${invoiceId}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      const result = (await response.json()) as T & { error?: string }

      if (!response.ok) {
        lastError = new Error(result.error || 'Failed to load invoice')
        if (attempt === 0 && response.status >= 500) continue
        throw lastError
      }

      return result
    } catch (error) {
      lastError = timedOut
        ? new Error('This job took too long to load. Please try again.')
        : error instanceof Error
          ? error
          : new Error('Failed to load invoice')

      const retryable =
        timedOut ||
        error instanceof TypeError ||
        (error instanceof DOMException && error.name === 'AbortError')
      if (attempt === 0 && retryable) continue
      throw lastError
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError
}

export async function settleOptionalInvoiceLookup<T>(
  lookup: Promise<T>,
  fallback: T,
  timeoutMs: number,
): Promise<{ value: T; outcome: 'complete' | 'timeout' | 'error' }> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T, outcome: 'complete' | 'timeout' | 'error') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ value, outcome })
    }
    const timer = setTimeout(() => finish(fallback, 'timeout'), timeoutMs)

    lookup.then(
      (value) => finish(value, 'complete'),
      () => finish(fallback, 'error'),
    )
  })
}
