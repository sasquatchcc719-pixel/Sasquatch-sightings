import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PayrollTimesheetsView } from './PayrollTimesheetsView'

const state = vi.hoisted(() => ({ gratuityError: false }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const data: Record<string, unknown> = {
      'payroll-staff': [],
      'payroll-timesheet-entries': {
        entries: [],
        totalPayableMinutes: 60,
        totalGrossPay: 25,
      },
      'payroll-clock-events': [],
      'payroll-after-hours-premiums': { premiums: [], totalAppliedPay: 0 },
      'payroll-add-on-bonuses': {
        rows: [],
        earnedBonus: 10,
        pendingBonus: 0,
        eligibleRevenue: 100,
      },
      'payroll-gratuities': {
        rows: [
          {
            invoiceId: 'invoice-tip',
            invoiceNumber: 18885,
            appointmentDate: '2026-10-14',
            staffUserId: 'david',
            staffName: 'David Gonzalez',
            customerName: 'Tip customer',
            paymentMethod: 'square',
            amount: 50,
            status: 'payable',
          },
        ],
        payableGratuity: 50,
        pendingGratuity: 0,
      },
    }
    const isError = queryKey[0] === 'payroll-gratuities' && state.gratuityError
    return {
      data: isError ? undefined : data[queryKey[0]],
      isError,
      isLoading: false,
      isPending: false,
      refetch: vi.fn(),
    }
  },
}))
afterEach(() => {
  cleanup()
  state.gratuityError = false
})

describe('payroll gratuity display', () => {
  it('adds full gratuity to gross pay and links its source invoice', () => {
    render(<PayrollTimesheetsView />)
    expect(
      within(screen.getByText('Gross pay').parentElement!).getByText('$85.00'),
    ).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'David’s gratuity' })
    expect(
      within(section).getByText('Included in gross pay'),
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('link', { name: '#18885 · Tip customer' }),
    ).toHaveAttribute('href', '/admin/operations/invoices/invoice-tip')
    expect(screen.getAllByText('incl. $50.00 gratuity').length).toBeGreaterThan(
      0,
    )
  })
  it('clearly marks the total incomplete if gratuity cannot be loaded', () => {
    state.gratuityError = true
    render(<PayrollTimesheetsView />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Payroll totals are incomplete',
    )
    expect(
      screen.getByText('Total incomplete — gratuity unavailable'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        'No gratuity recorded for David in this date range and staff selection.',
      ),
    ).not.toBeInTheDocument()
  })
})
