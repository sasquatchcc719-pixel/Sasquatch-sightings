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
})
