import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BusinessDecisionView,
  DecisionSnapshotContent,
} from './business-decision-view'
import type {
  BusinessDecisionSnapshot,
  DecisionTotals,
} from '@/lib/ops/business-decision-schema'

const totals: DecisionTotals = {
  completed_visits: 11,
  invoice_covered_visits: 11,
  invoiced_value: 4500,
  marked_paid_value: 4500,
  quoted_value: 4800,
  quote_invoice_difference: 300,
  missing_invoice_visits: 0,
  draft_invoice_visits: 0,
  ambiguous_invoice_visits: 0,
  consolidated_billing_visits: 1,
  restoration_visits: 0,
  warranty_visits: 0,
  internal_visits: 0,
}
export const decisionFixture: BusinessDecisionSnapshot = {
  version: '1',
  generated_at: '2026-11-09T20:00:00Z',
  timezone: 'America/Denver',
  currency: 'USD',
  read_only: true,
  coverage: {
    status: 'complete',
    missing: [],
    definitions: [
      'Per-visit invoice headers, scoped by service date. Paid status is not payment-date cash flow.',
    ],
  },
  periods: {
    last_week: { start: '2026-11-02', end: '2026-11-08' },
    current: { start: '2026-10-12', end: '2026-11-08' },
    previous: { start: '2026-09-14', end: '2026-10-11' },
    upcoming: { start: '2026-11-09', end: '2026-11-15' },
  },
  performance: {
    last_week: totals,
    current: { ...totals, invoiced_value: 19000 },
    previous: { ...totals, invoiced_value: 20000 },
    invoiced_value_change: -1000,
    invoiced_value_change_pct: -5,
  },
  lead_sources: [
    {
      key: 'nextdoor',
      label: 'Nextdoor',
      completed_visits: 13,
      invoice_covered_visits: 12,
      invoiced_value: 5200,
      previous_completed_visits: 10,
      previous_invoice_covered_visits: 9,
      previous_invoiced_value: 3900,
      links: [
        {
          label: 'Open source job',
          url: 'https://sightings.sasquatchcarpet.com/admin/operations/appointments/example',
        },
      ],
    },
  ],
  upcoming: {
    scheduled_visits: 8,
    quoted_value: 3400,
    unassigned_visits: 1,
    note: 'Scheduled visits only, not available capacity or a revenue forecast.',
  },
  decisions: [
    {
      id: 'assign',
      title: 'Assign the unassigned visit',
      evidence: 'One booked visit has no technician.',
      next_step: 'Review the calendar and full job duration before assigning.',
      links: [
        {
          label: 'Review appointment',
          url: 'https://sightings.sasquatchcarpet.com/admin/operations/appointments/example',
        },
      ],
    },
  ],
  queues: [
    {
      name: 'unpaid_invoices',
      label: 'Unpaid invoices',
      count: null,
      status: 'unavailable',
      window: 'Collectible-status invoices.',
      note: 'Source unavailable; no zero inferred.',
      links: [],
    },
  ],
  reconciliation: [
    {
      appointment_id: 'example',
      date: '2026-11-04',
      issue: 'quote_difference',
      quote: 500,
      invoice: 450,
      links: [
        {
          label: 'Inspect invoice',
          url: 'https://sightings.sasquatchcarpet.com/admin/operations/invoices/example',
        },
      ],
    },
  ],
}
const response = (data = decisionFixture) =>
  ({ ok: true, json: async () => data }) as Response

afterEach(() => vi.unstubAllGlobals())

describe('business decision view', () => {
  it('reads a validated snapshot without cache and renders source evidence', async () => {
    const fetcher = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetcher)
    render(<BusinessDecisionView />)
    expect(
      await screen.findByText('Assign the unassigned visit'),
    ).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/stats/business-decisions',
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(screen.getByText('$4,500.00')).toBeInTheDocument()
    expect(
      screen.getByText(/12\/13 visits invoice-covered/),
    ).toBeInTheDocument()
    expect(screen.getByText(/9\/10 visits invoice-covered/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Review appointment' }),
    ).toHaveAttribute('href', expect.stringContaining('/appointments/example'))
    expect(screen.getByText(/Weekly Telegram briefing off/)).toBeInTheDocument()
  })

  it('shows unavailable data and partial coverage without fabricated zero totals', () => {
    render(
      <DecisionSnapshotContent
        data={{
          ...decisionFixture,
          performance: null,
          upcoming: null,
          lead_sources: [],
          coverage: {
            ...decisionFixture.coverage,
            status: 'partial',
            missing: ['Invoices unavailable'],
          },
        }}
      />,
    )
    expect(screen.getByText('Partial coverage.')).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    expect(
      screen.getByText('Lead-source comparison unavailable.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Unpaid invoices: unavailable')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('retains a dated snapshot and reports refresh failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response())
        .mockRejectedValueOnce(new Error('offline')),
    )
    render(<BusinessDecisionView />)
    await screen.findByText('Assign the unassigned visit')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Showing the previous snapshot',
    )
    expect(screen.getByText('$4,500.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled()
  })

  it('rejects malformed successful responses rather than displaying unreliable totals', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response({ invalid: true } as unknown as BusinessDecisionSnapshot),
        ),
    )
    render(<BusinessDecisionView />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No business totals are available',
    )
    expect(screen.queryByText('$4,500.00')).not.toBeInTheDocument()
  })

  it('does not let a superseded StrictMode request overwrite the current snapshot', async () => {
    let resolveOld!: (value: Response) => void
    const old = new Promise<Response>((resolve) => {
      resolveOld = resolve
    })
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetcher)
    render(
      <StrictMode>
        <BusinessDecisionView />
      </StrictMode>,
    )
    await screen.findByText('Assign the unassigned visit')
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () =>
      resolveOld(
        response({
          ...decisionFixture,
          decisions: [
            { ...decisionFixture.decisions[0], title: 'Obsolete decision' },
          ],
        }),
      ),
    )
    expect(screen.queryByText('Obsolete decision')).not.toBeInTheDocument()
  })

  it('limits the default decision list and keeps details collapsed', () => {
    const decisions = Array.from({ length: 4 }, (_, index) => ({
      ...decisionFixture.decisions[0],
      id: `${index}`,
      title: `Decision ${index}`,
    }))
    const { container } = render(
      <DecisionSnapshotContent data={{ ...decisionFixture, decisions }} />,
    )
    expect(screen.queryByText('Decision 3')).not.toBeInTheDocument()
    expect(container.querySelector('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/Quote minus invoice value/)).toHaveTextContent(
      'not an unpaid balance',
    )
  })

  it('disables repeat refresh while loading and aborts when unmounted', async () => {
    let resolve!: (value: Response) => void
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { unmount } = render(<BusinessDecisionView />)
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Refreshing…' }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    unmount()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => resolve(response()))
  })
})
