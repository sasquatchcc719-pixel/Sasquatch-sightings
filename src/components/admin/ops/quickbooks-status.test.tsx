import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickBooksStatus } from './quickbooks-status'

const ready = {
  connected: true,
  sync_enabled: true,
  pending: 0,
  failed: 1,
  stuck: 1,
  pending_jobs: [],
  retrying_jobs: [],
  failed_jobs: [],
  stuck_invoices: [
    {
      id: 'invoice',
      label: 'Invoice #18889',
      customer_name: 'Customer',
      total: 394,
      url: '/invoice',
    },
  ],
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('QuickBooks recovery status', () => {
  it('shows rejected authorization with a reconnect action and queued-job count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...ready,
          connected: false,
          reconnect_required: true,
          connection_error: 'Reconnect QuickBooks to restore authorization.',
          failed: 8,
        }),
      ),
    )
    render(<QuickBooksStatus />)
    expect(
      await screen.findByRole('link', { name: 'Reconnect QuickBooks' }),
    ).toHaveAttribute('href', '/api/admin/quickbooks/connect')
    expect(screen.getByText('Reconnect required')).toBeInTheDocument()
    expect(screen.getByText(/8 sync jobs are waiting/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Redeploy' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the actual error visible when a failed redeploy changes the connection state', async () => {
    let failed = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        if (options?.method === 'POST') {
          failed = true
          return Response.json(
            {
              error:
                'QuickBooks authorization is no longer valid. Reconnect QuickBooks.',
            },
            { status: 409 },
          )
        }
        return Response.json(
          failed
            ? { ...ready, connected: false, reconnect_required: true }
            : ready,
        )
      }),
    )
    render(<QuickBooksStatus />)
    fireEvent.click(await screen.findByRole('button', { name: 'Redeploy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reconnect QuickBooks',
    )
    expect(
      await screen.findByRole('link', { name: 'Reconnect QuickBooks' }),
    ).toBeInTheDocument()
  })

  it('does not call a queued temporary failure a successful sync', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) =>
        options?.method === 'POST'
          ? Response.json(
              {
                queued: true,
                status: 'pending',
                message:
                  'This invoice remains queued and will retry automatically.',
              },
              { status: 202 },
            )
          : Response.json(ready),
      ),
    )
    render(<QuickBooksStatus />)
    fireEvent.click(await screen.findByRole('button', { name: 'Redeploy' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'will retry automatically',
      ),
    )
    expect(screen.queryByText(/was synced/)).not.toBeInTheDocument()
  })
})
