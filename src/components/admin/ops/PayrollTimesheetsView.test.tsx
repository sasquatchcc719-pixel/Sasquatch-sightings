import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PayrollTimesheetsView } from './PayrollTimesheetsView'

const state = vi.hoisted(() => ({
  gratuityError: false,
  premiumPay: 0,
  premiumApplied: true,
  mixedRates: false,
  addOnRows: false,
  overtimeApplied: false,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const period = queryKey[1] === 'period'
    const minutes = period ? 4470 : 3467
    const grossPay = period ? 1862.52 : 1444.58
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
                payableMinutes: minutes,
                hourlyRate: 25,
                grossPay,
                workDate: '2026-10-14',
                startedAt: '2026-10-14T14:00:00Z',
                endedAt: '2026-10-14T15:00:00Z',
              },
            ],
        totalPayableMinutes: state.mixedRates ? 180 : minutes,
        totalGrossPay: state.mixedRates ? 70 : grossPay,
      },
      'payroll-clock-events': [],
      'payroll-overtime': {
        calculation: {
          minutes: 283,
          premiumPay: 58.96,
          breakdown: [
            {
              key: 'david:25',
              staffUserId: 'david',
              staffDisplayName: 'David Gonzalez',
              weekStart: '2026-11-08',
              method: 'weekly',
              baseCents: 11792,
              minutes: 283,
              hourlyRate: 25,
              premiumPay: 58.96,
            },
          ],
        },
        applied: {
          rows: state.overtimeApplied
            ? [
                {
                  id: 'overtime',
                  staffUserId: 'david',
                  staffDisplayName: 'David Gonzalez',
                  minutes: 283,
                  premiumPay: 58.96,
                  status: 'approved',
                },
              ]
            : [],
          totalPay: state.overtimeApplied ? 58.96 : 0,
          matchesCalculation: state.overtimeApplied,
        },
        hasActiveEntries: false,
      },
      'payroll-after-hours-premiums': {
        premiums: state.premiumPay
          ? [
              {
                appointmentId: 'premium-job',
                staffUserId: 'david',
                staffName: 'David Gonzalez',
                workDate: '2026-10-14',
                jobStartedAt: '2026-10-15T03:00:00Z',
                startSource: 'scheduled',
                completedAt: '2026-10-15T04:00:00Z',
                customerName: 'Saltgrass Colorado Springs',
                minutes: 60,
                premiumRate: 10,
                premiumPay: state.premiumPay,
                applied: state.premiumApplied,
                premiumId: null,
                status: 'approved',
                appliedPay: state.premiumPay,
                appliedMinutes: 60,
                manualStartTime: null,
                manualEndTime: null,
              },
            ]
          : [],
        totalAppliedPay: state.premiumApplied ? state.premiumPay : 0,
      },
      'payroll-add-on-bonuses': {
        rows: state.addOnRows
          ? [
              {
                key: 'appointment:tech:invoice_growth',
                appointmentId: 'appointment',
                invoiceId: 'invoice-bonus',
                appointmentDate: '2026-10-14',
                staffUserId: 'david',
                staffName: 'David Gonzalez',
                customerName: 'Bonus customer',
                categoryLabel: 'Above original invoice',
                eligibleRevenue: 100,
                bonusRate: 0.1,
                bonusAmount: 10,
                calculatedBonusAmount: 10,
                overrideAmount: null,
                status: 'earned',
              },
            ]
          : [],
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
            calculatedAmount: 50,
            overrideAmount: null,
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
  state.premiumApplied = true
  state.mixedRates = false
  state.addOnRows = false
  state.overtimeApplied = false
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
    expect(screen.getByText(/Scheduled start used/)).toBeInTheDocument()
  })
  it('recalculates an unapplied premium when its start or end time is edited', () => {
    state.premiumPay = 10
    state.premiumApplied = false
    render(<PayrollTimesheetsView />)
    const input = screen.getByLabelText(
      'Saltgrass Colorado Springs premium start',
    )
    const endInput = screen.getByLabelText(
      'Saltgrass Colorado Springs premium end',
    )
    expect(input).toHaveValue('21:00')
    expect(endInput).toHaveValue('22:00')
    fireEvent.change(input, { target: { value: '21:30' } })
    expect(
      screen.getByRole('button', { name: 'Apply +$5.00' }),
    ).toBeInTheDocument()
    fireEvent.change(endInput, { target: { value: '21:45' } })
    expect(
      screen.getByRole('button', { name: 'Apply +$2.50' }),
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
  it('splits David’s period into regular hours and full time-and-a-half overtime', () => {
    render(<PayrollTimesheetsView />)
    fireEvent.click(screen.getByRole('button', { name: 'Pay period' }))

    const summary = screen.getByRole('region', { name: 'Payroll summary' })
    expect(within(summary).getByText('69h 47m × $25.00/hr')).toBeInTheDocument()
    expect(
      within(within(summary).getByText('Regular pay').parentElement!).getByText(
        '$1,744.60',
      ),
    ).toBeInTheDocument()
    expect(
      within(summary).getByText('4h 43m × $37.50/hr · over 40h/week'),
    ).toBeInTheDocument()
    expect(
      within(
        within(summary).getByText('Overtime (Colorado rules)').parentElement!,
      ).getByText('$176.88'),
    ).toBeInTheDocument()
    expect(
      within(summary).getByRole('button', { name: 'Apply +$58.96 premium' }),
    ).toBeInTheDocument()
    expect(
      within(
        within(summary).getByText('Total gross pay').parentElement!,
      ).getByText('$1,926.74'),
    ).toBeInTheDocument()
  })
  it('adds overtime to gross pay only after the global calculation is applied', () => {
    state.overtimeApplied = true
    render(<PayrollTimesheetsView />)
    let summary = screen.getByRole('region', { name: 'Payroll summary' })
    expect(
      within(
        within(summary).getByText('Total gross pay').parentElement!,
      ).getByText('$1,508.80'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pay period' }))

    summary = screen.getByRole('region', { name: 'Payroll summary' })
    expect(
      within(summary).getByRole('button', { name: 'Applied' }),
    ).toBeDisabled()
    expect(
      within(summary).getByText('$58.96 premium applied'),
    ).toBeInTheDocument()
    expect(
      within(
        within(summary).getByText('Total gross pay').parentElement!,
      ).getByText('$1,985.70'),
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

describe('payroll add-on bonus display', () => {
  it('links each bonus row to its source invoice', () => {
    state.addOnRows = true
    render(<PayrollTimesheetsView />)
    expect(
      screen.getByRole('link', {
        name: 'David Gonzalez · Bonus customer',
      }),
    ).toHaveAttribute('href', '/admin/operations/invoices/invoice-bonus')
  })
  it('allows gratuity and add-on payroll amounts to be edited', () => {
    state.addOnRows = true
    render(<PayrollTimesheetsView />)
    const gratuity = screen.getByLabelText('Tip customer gratuity amount')
    const addOn = screen.getByLabelText('Bonus customer add-on bonus amount')
    expect(gratuity).toHaveValue(50)
    expect(addOn).toHaveValue(10)
    fireEvent.change(gratuity, { target: { value: '55.25' } })
    fireEvent.change(addOn, { target: { value: '12.50' } })
    expect(gratuity).toHaveValue(55.25)
    expect(addOn).toHaveValue(12.5)
  })
})
