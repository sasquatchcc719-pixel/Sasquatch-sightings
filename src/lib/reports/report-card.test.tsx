import { describe, expect, it } from 'vitest'
import { renderReportCardPng } from './report-card'

describe('renderReportCardPng', () => {
  it('renders a Telegram progress card with a graph', async () => {
    const png = await renderReportCardPng({
      eyebrow: 'Radar Daily',
      title: 'Sep 23',
      subtitle: 'Full-depth organic · service-area grid',
      verdict: { text: 'Local visibility is steady.', tone: 'neutral' },
      metrics: [
        { label: 'Best town', value: '#1', note: 'Palmer Lake' },
        { label: 'Grid coverage', value: '91%', note: '74 of 81 points' },
      ],
      series: {
        label: 'Town centers visible in Maps top 20 (of 5)',
        maxValue: 5,
        points: Array.from({ length: 13 }, (_, index) => ({
          label: `W${index + 1}`,
          value: index % 4,
        })),
      },
    })

    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.length).toBeGreaterThan(10_000)
  })

  it('renders income and cost lines with profit and loss gaps', async () => {
    const png = await renderReportCardPng({
      eyebrow: 'Weekly Business Economics',
      title: 'Income vs. cost',
      subtitle: 'Sep 17–Sep 23 · Thursday–Wednesday',
      verdict: {
        text: 'Income stayed $40/hour above tracked cost.',
        tone: 'good',
      },
      metrics: [
        { label: 'Income / hour', value: '$95', tone: 'good' },
        { label: 'Cost / hour', value: '$55', tone: 'warn' },
        { label: 'Tracked margin', value: '42.0%', tone: 'good' },
        { label: '2026 YTD average', value: '$155 / $74' },
      ],
      incomeCostSeries: {
        label: 'Weekly dollars per productive hour',
        points: [
          { label: 'Jun 24', income: 155, cost: 95 },
          { label: 'Jul 1', income: 104, cost: 40 },
          { label: 'Jul 8', income: 120, cost: 133 },
          { label: 'Jul 15', income: 119, cost: 57 },
          { label: 'Sep 23', income: 95, cost: 55 },
        ],
      },
    })

    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.length).toBeGreaterThan(10_000)
  })
})
