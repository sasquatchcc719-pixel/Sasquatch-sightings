import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { CellularDataUsage } from './cellular-data-usage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('shows billed megabytes, cap, remaining data, and reset date', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        deviceId: '6874649',
        simCardId: '1234',
        usedBytes: 100_030_000,
        limitBytes: 1_000_000_000,
        remainingBytes: 899_970_000,
        percentUsed: 10.003,
        billingPeriodStart: null,
        billingPeriodEnd: '2026-12-07T12:00:00Z',
        status: 'active',
        updatedAt: '2026-11-13T20:00:00Z',
      }),
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <CellularDataUsage />
    </QueryClientProvider>,
  )

  expect(await screen.findByText('100.03 MB / 1,000 MB')).toBeInTheDocument()
  expect(screen.getByText('899.97 MB left · Resets Dec 7')).toBeInTheDocument()
  expect(screen.getByText('10.0%')).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10')
})
