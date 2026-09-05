import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ClientRequestsPanel } from './client-requests-panel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps an empty request inbox visible and refreshes into an actionable request', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ requests: [] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        requests: [
          {
            id: 'request-a',
            customer_id: 'customer-a',
            request_type: 'add_visit',
            status: 'pending',
            message: 'Please clean our tile monthly',
            details: { service: 'Tile & grout', frequency: 'Monthly' },
            created_at: '2026-09-05T04:00:00Z',
            ops_customers: { business_name: 'Example Business' },
          },
        ],
      }),
    })
  vi.stubGlobal('fetch', fetch)
  render(<ClientRequestsPanel />)
  expect(await screen.findByText('No customer requests yet.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }))
  expect(await screen.findByText('Please clean our tile monthly')).toBeTruthy()
  expect(
    screen
      .getByRole('link', { name: 'Open customer account →' })
      .getAttribute('href'),
  ).toBe('/admin/operations/commercial/customer-a')
  expect(document.getElementById('client-request-request-a')).toBeTruthy()
})

it('clears a fetch error after a successful refresh', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ requests: [] }) })
  vi.stubGlobal('fetch', fetch)
  render(<ClientRequestsPanel />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.getByText('No customer requests yet.')).toBeTruthy()
})
