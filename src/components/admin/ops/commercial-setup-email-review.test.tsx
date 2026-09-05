import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommercialSetupEmailReview } from './commercial-setup-email-review'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CommercialSetupEmailReview', () => {
  it('creates saved-customer access only on Send and reuses it after a delivery failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ contact: { id: 'contact-a' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Delivery temporarily unavailable' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <CommercialSetupEmailReview
        businessName="Example Business"
        customerId="customer-a"
        contact={{
          display_name: 'Example Business',
          email: 'manager@example.com',
        }}
        agreement={{
          id: 'agreement-a',
          version: 1,
          content: { title: 'Service terms' },
        }}
        onClose={vi.fn()}
      />,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send customer setup' }))
    expect(
      await screen.findByText('Delivery temporarily unavailable'),
    ).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/admin/ops/commercial/customer-a/users',
    )
    expect(screen.getByLabelText('Message')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Send customer setup' }))
    expect(
      await screen.findByText('Customer setup email sent'),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/admin/ops/commercial/customer-a/users/contact-a/send-setup',
    )
    expect(fetchMock.mock.calls[2]).toEqual(fetchMock.mock.calls[1])
  })
  it('shows the exact message and sends only after final approval', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <CommercialSetupEmailReview
        businessName="Saltgrass Colorado Springs"
        customerId="22222222-2222-4222-8222-222222222222"
        contact={{
          id: '33333333-3333-4333-8333-333333333333',
          display_name: 'Alex Manager',
          email: 'alex@example.com',
        }}
        agreement={{
          id: '11111111-1111-4111-8111-111111111111',
          version: 1,
          content: { title: 'Cleaning & Maintenance Agreement' },
        }}
        onClose={vi.fn()}
      />,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Nothing is sent until you approve the final email below.',
      ),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Please review your Saltgrass service setup' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send customer setup' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/ops/commercial/22222222-2222-4222-8222-222222222222/users/33333333-3333-4333-8333-333333333333/send-setup',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(
      await screen.findByText('Customer setup email sent'),
    ).toBeInTheDocument()
  })
})
