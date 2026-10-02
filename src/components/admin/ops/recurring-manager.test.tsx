import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonthEndBillingSection } from './recurring-manager'

const visit = {
  appointmentId: 'appointment-1',
  date: '2026-10-01',
  status: 'completed',
  total: 500,
  templateLabel: 'Recurring job',
  description: 'Carpet cleaning',
  included: true,
  lineItems: [],
}

const customer = {
  customerId: 'customer-1',
  customerName: 'Lance Johnson',
  businessName: 'Recovery Village',
  addresses: [],
  visits: [visit],
  jobs: [visit],
  restorations: [],
  totalVisits: 1,
  completedVisits: 1,
  runningTotal: 500,
  existingInvoice: null,
}

const response = (data: unknown, ok = true) => ({
  ok,
  json: async () => data,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Recovery Village monthly invoice confirmation', () => {
  it('turns the send area green only after QuickBooks returns an invoice ID', async () => {
    let sent = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('/api/admin/ops/recurring/billing-summary')) {
          return response({
            customers: [
              sent
                ? {
                    ...customer,
                    existingInvoice: {
                      id: 'batch-1',
                      status: 'sent',
                      sync_status: 'synced',
                      quickbooks_invoice_id: '6902',
                      total: 500,
                    },
                  }
                : customer,
            ],
          })
        }
        if (url === '/api/admin/ops/services') {
          return response({ services: [] })
        }
        if (
          url === '/api/admin/ops/recurring/generate-monthly-invoice' &&
          init?.method === 'POST'
        ) {
          sent = true
          return response({
            batchInvoiceId: 'batch-1',
            quickbooksInvoiceId: '6902',
          })
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    render(<MonthEndBillingSection />)

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Create one invoice & send to QB',
      }),
    )

    expect(await screen.findByText('Sent to QuickBooks')).toBeInTheDocument()
    expect(
      screen.getByText('Confirmed as QuickBooks invoice ID 6902'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /send to qb/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps a visible error and retry button when QuickBooks rejects the send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('/api/admin/ops/recurring/billing-summary')) {
          return response({ customers: [customer] })
        }
        if (url === '/api/admin/ops/services') {
          return response({ services: [] })
        }
        if (
          url === '/api/admin/ops/recurring/generate-monthly-invoice' &&
          init?.method === 'POST'
        ) {
          return response(
            { error: 'QuickBooks customer could not be matched' },
            false,
          )
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    render(<MonthEndBillingSection />)

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Create one invoice & send to QB',
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'QuickBooks customer could not be matched',
    )
    expect(
      screen.getByRole('button', { name: 'Try sending again' }),
    ).toBeEnabled()
    await waitFor(() =>
      expect(screen.queryByText('Sent to QuickBooks')).not.toBeInTheDocument(),
    )
  })
})
