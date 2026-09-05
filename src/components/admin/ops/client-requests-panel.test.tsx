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

function stubStorage() {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
}

it('keeps an empty note inbox visible and refreshes into an actionable note', async () => {
  stubStorage()
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
            request_type: 'scope_change',
            status: 'pending',
            message: 'Please change carpet cleaning to quarterly',
            details: { agreement_id: 'agreement-a', agreement_version: '2' },
            created_at: '2026-09-05T04:00:00Z',
            ops_customers: { business_name: 'Example Business' },
          },
        ],
      }),
    })
  vi.stubGlobal('fetch', fetch)
  render(<ClientRequestsPanel />)
  expect(await screen.findByText('No agreement notes yet.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh notes' }))
  expect(
    await screen.findByText('Please change carpet cleaning to quarterly'),
  ).toBeTruthy()
  expect(
    screen
      .getByRole('link', { name: 'Open customer account →' })
      .getAttribute('href'),
  ).toBe('/admin/operations/commercial/customer-a')
  expect(document.getElementById('client-request-request-a')).toBeTruthy()
})

it('clears a fetch error after a successful refresh', async () => {
  stubStorage()
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ requests: [] }) })
  vi.stubGlobal('fetch', fetch)
  render(<ClientRequestsPanel />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh notes' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.getByText('No agreement notes yet.')).toBeTruthy()
})
