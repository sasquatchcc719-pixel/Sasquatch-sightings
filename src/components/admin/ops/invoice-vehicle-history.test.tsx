import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { InvoiceVehicleHistory } from './invoice-vehicle-history'
vi.mock('next/dynamic', () => ({ default: () => () => null }))
afterEach(() => vi.unstubAllGlobals())
it('loads the private ledger only when expanded and shows signal gaps', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        appointmentId: 'job',
        visits: [
          {
            id: 'visit',
            tracker_name: "David's Box Truck",
            location_label: 'Job',
            arrived_at: '2026-10-20T15:00:00Z',
            departed_at: '2026-10-20T16:00:00Z',
          },
        ],
        trips: [
          {
            id: 'trip',
            tracker_name: "David's Box Truck",
            destination_appointment_id: 'job',
            origin_label: 'Base',
            destination_label: 'Job',
            departed_at: '2026-10-20T14:30:00Z',
            arrived_at: '2026-10-20T15:00:00Z',
            observed_distance_m: 1609.344,
            signal_gaps: 1,
            route_truncated: false,
            status: 'arrived',
            route: [],
          },
        ],
      }),
    })
  vi.stubGlobal('fetch', fetcher)
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InvoiceVehicleHistory invoiceId="invoice" />
    </QueryClientProvider>,
  )
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Vehicle travel & visits'))
  await waitFor(() =>
    expect(screen.getByText('Time at location: 60 min')).toBeInTheDocument(),
  )
  expect(fetcher).toHaveBeenCalledWith(
    '/api/admin/ops/invoices/invoice/vehicle-history',
    { cache: 'no-store' },
  )
  expect(screen.getByText(/Travel time: 30 min/)).toBeInTheDocument()
  expect(screen.getByText(/Incomplete GPS coverage/)).toBeInTheDocument()
})
