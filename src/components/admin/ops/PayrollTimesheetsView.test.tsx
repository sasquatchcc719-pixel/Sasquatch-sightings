import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PayrollTimesheetsView } from './PayrollTimesheetsView'

const state = vi.hoisted(() => ({
  gratuityError: false,
  premiumPay: 0,
  mixedRates: false,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const data: Record<string, unknown> = {
      'payroll-staff': [],
      'payroll-timesheet-entries': {
        entries: state.mixedRates
          ? [
              {
                id: 'first',
                staffUserId: 'david',
                staffDisplayName: 'David Gonzalez',
                clockState: 'complete',
                status: 'draft',
                workType: 'job',
                source: 'manual',
                breakMinutes: 0,
                payableMinutes: 60,
                hourlyRate: 20,
                grossPay: 20,
                workDate: '2026-10-12',
                startedAt: '2026-10-12T14:00:00Z',
                endedAt: '2026-10-12T15:00:00Z',
              },
              {
                id: 'second',
                staffUserId: 'david',
                staffDisplayName: 'David Gonzalez',
                clockState: 'complete',
                status: 'draft',
                workType: 'job',
                source: 'manual',
                breakMinutes: 0,
                payableMinutes: 120,
                hourlyRate: 25,
                grossPay: 50,
                workDate: '2026-10-13',
                startedAt: '2026-10-13T14:00:00Z',
                endedAt: '2026-10-13T16:00:00Z',
              },
            ]
          : [
              {
                id: 'shift',
                staffUserId: 'david',
                staffDisplayName: 'David Gonzalez',
                clockState: 'complete',
                status: 'draft',
                workType: 'job',
                source: 'manual',
                breakMinutes: 0,
                payableMinutes: 3467,
                hourlyRate: 25,
                grossPay: 1444.58,
                workDate: '2026-10-14',
                startedAt: '2026-10-14T14:00:00Z',
                endedAt: '2026-10-14T15:00:00Z',
              },
            ],
        totalPayableMinutes: state.mixedRates ? 180 : 3467,
        totalGrossPay: state.mixedRates ? 70 : 1444.58,
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
  state.mixedRates = false
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
    rowAmount('Hourly pay', '$1,444.58')
    rowAmount('Gratuity', '$50.00')
    rowAmount('Add-on bonus', '$14.22')
    rowAmount('Total gross pay', '$1,508.80')
    expect(within(summary).getByText('57h 47m × $25.00/hr')).toBeInTheDocument()
    expect(
      [...summary.querySelectorAll('dt')].map((row) => row.textContent),
    ).toEqual([
      'Hourly pay57h 47m × $25.00/hr',
      'Gratuity',
      'Add-on bonus',
      'Total gross pay',
    ])
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
      ).getByText('$1,518.80'),
    ).toBeInTheDocument()
  })
  it('shows each saved hourly rate separately rather than inventing an average', () => {
    state.mixedRates = true
    render(<PayrollTimesheetsView />)
    const summary = screen.getByRole('region', { name: 'Payroll summary' })
    expect(
      within(summary).getByText('1h × $20.00/hr = $20.00'),
    ).toBeInTheDocument()
    expect(
      within(summary).getByText('2h × $25.00/hr = $50.00'),
    ).toBeInTheDocument()
    expect(
      within(within(summary).getByText('Hourly pay').parentElement!).getByText(
        '$70.00',
      ),
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
