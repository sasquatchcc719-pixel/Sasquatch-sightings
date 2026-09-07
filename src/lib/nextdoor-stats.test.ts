import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NEXTDOOR_PUBLIC_METRICS,
  normalizeNextdoorPublicMetrics,
  parseNextdoorMetricsInput,
} from './nextdoor-stats'

describe('Nextdoor public metrics', () => {
  it('keeps faves, recommendations, mentions, and page views separate', () => {
    expect(parseNextdoorMetricsInput('187 50 202 314')).toEqual({
      ok: true,
      counts: {
        faves: 187,
        recommendations: 50,
        mentions: 202,
        pageViews: 314,
      },
    })
  })

  it('accepts comma-formatted counts', () => {
    expect(parseNextdoorMetricsInput('1,187 50 1,202 1,314')).toEqual({
      ok: true,
      counts: {
        faves: 1187,
        recommendations: 50,
        mentions: 1202,
        pageViews: 1314,
      },
    })
  })

  it('rejects partial or invalid updates', () => {
    expect(parseNextdoorMetricsInput('187 50 202')).toMatchObject({ ok: false })
    expect(parseNextdoorMetricsInput('187 faves 202 314')).toMatchObject({
      ok: false,
    })
    expect(parseNextdoorMetricsInput('-1 50 202 314')).toMatchObject({
      ok: false,
    })
  })

  it('uses owner-verified fallbacks for missing data', () => {
    expect(normalizeNextdoorPublicMetrics(null)).toEqual(
      DEFAULT_NEXTDOOR_PUBLIC_METRICS,
    )
  })
})
