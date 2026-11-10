import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SeoBriefingContent } from './SeoBriefingContent'
import type { SeoBriefing } from '@/lib/seo/briefing'

describe('SEO business evidence card', () => {
  it('keeps cohort, status, town, saved sources and unknown attribution visibly separate', () => {
    const report: SeoBriefing = {
      generatedAt: '2026-11-10T12:00:00Z',
      changes: [],
      changeHistoryError: false,
      nextActions: [],
      sections: [
        {
          title: 'Business outcomes',
          state: 'partial',
          summary:
            '13 recorded quote sessions · 3 distinct linked appointments.',
          detail: 'Sessions are not qualified SEO leads.',
          source: 'Exact stored links',
          measuredAt: '2026-11-10T12:00:00Z',
          period: { start: '2026-11-02', end: '2026-11-08' },
          businessOutcomes: {
            quoteSessions: 13,
            appointments: 3,
            open: 2,
            completed: 1,
            cancelled: 0,
            other: 0,
            unlinkedQuoteSessions: 10,
            unresolvedQuoteSessions: 0,
            excludedQuoteSessions: 0,
            byTown: [
              {
                town: 'Monument',
                appointments: 2,
                open: 1,
                completed: 1,
                cancelled: 0,
                other: 0,
              },
            ],
            recordedSources: [
              { label: 'Nextdoor', appointments: 1 },
              { label: 'Repeat customer', appointments: 1 },
              { label: 'Grok', appointments: 1 },
            ],
            googleReferrerAppointments: 1,
          },
        },
      ],
    }
    render(<SeoBriefingContent report={report} />)
    expect(
      screen.getByText(
        '13 recorded quote sessions · 3 distinct linked appointments.',
      ),
    ).toBeVisible()
    expect(screen.getByText('2026-11-02 to 2026-11-08')).toBeVisible()
    expect(screen.getByText(/Status as of/)).toBeVisible()
    expect(
      screen.getByText(/Monument: 2 linked \(1 open, 1 completed, 0 cancelled/),
    ).toBeVisible()
    expect(
      screen.getByText(
        /Saved booking sources: Nextdoor: 1 · Repeat customer: 1 · Grok: 1/,
      ),
    ).toBeVisible()
    expect(screen.getByText(/Organic versus paid is unknown/)).toBeVisible()
    expect(
      screen.getByText(/10 quote sessions have no recorded booking link/),
    ).toBeVisible()
  })
})
