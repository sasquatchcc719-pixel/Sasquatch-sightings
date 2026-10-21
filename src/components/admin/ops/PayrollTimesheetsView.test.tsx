import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PayrollTimesheetsView } from './PayrollTimesheetsView'

const state = vi.hoisted(() => ({ gratuityError: false, premiumPay: 0 }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const data: Record<string, unknown> = {
      'payroll-staff': [],
      'payroll-timesheet-entries': {
        entries: [],
        totalPayableMinutes: 4416,
        totalGrossPay: 1840,
      },
      'payroll-clock-events': [],
      'payroll-after-hours-premiums': {
        premiums: state.premiumPay
          ? [
              {
                appointmentId: 'premium-job',
                staffUserId: 'david',
                staffName: 'David Gonzalez',
                workDate: '2026-10-14',
                applied: true,
                appliedPay: state.premiumPay,
              },
            ]
          : [],
        totalAppliedPay: state.premiumPay,
      },
      'payroll-add-on-bonuses': {
        rows: [],
        earnedBonus: 14.22,
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
  state.premiumPay = 0
})

describe('payroll gratuity display', () => {
  it('adds full gratuity to gross pay and links its source invoice', () => {
    render(<PayrollTimesheetsView />)
    const summary = screen.getByRole('region', { name: 'Payroll summary' })
    const rowAmount = (label: string, amount: string) =>
      expect(
        within(within(summary).getByText(label).parentElement!).getByText(
          amount,
        ),
      ).toBeInTheDocument()
    rowAmount('Hourly pay', '$1,840.00')
    rowAmount('Gratuity', '$50.00')
    rowAmount('Add-on bonus', '$14.22')
    rowAmount('Total gross pay', '$1,904.22')
    expect(
      [...summary.querySelectorAll('dt')].map((row) => row.textContent),
    ).toEqual(['Hourly pay', 'Gratuity', 'Add-on bonus', 'Total gross pay'])
    expect(
      within(summary).getByText(
        'The total includes every amount listed above.',
      ),
    ).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'David’s gratuity' })
    expect(
      within(section).getByText('Included in gross pay'),
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('link', { name: '#18885 · Tip customer' }),
    ).toHaveAttribute('href', '/admin/operations/invoices/invoice-tip')
    expect(within(summary).queryByText(/incl\./)).not.toBeInTheDocument()
  })
  it('shows an applied premium as its own row and counts it once in the bottom total', () => {
    state.premiumPay = 10
    render(<PayrollTimesheetsView />)
    const summary = screen.getByRole('region', { name: 'Payroll summary' })
    expect(
      within(
        within(summary).getByText('After-hours premium').parentElement!,
      ).getByText('$10.00'),
    ).toBeInTheDocument()
    expect(
      within(
        within(summary).getByText('Total gross pay').parentElement!,
      ).getByText('$1,914.22'),
    ).toBeInTheDocument()
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
    const summary = screen.getByRole('region', { name: 'Payroll summary' })
    expect(
      within(
        within(summary).getByText('Total gross pay').parentElement!,
      ).getByText('Unavailable'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        'No gratuity recorded for David in this date range and staff selection.',
      ),
    ).not.toBeInTheDocument()
  })
})
