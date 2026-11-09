import { describe, expect, it } from 'vitest'
import { seoChangeSchema } from './change-ledger'
const change = {
  version: 1,
  hypothesis: 'Clearer service context may help relevant queries',
  exactChange: 'Updated one heading',
  deploymentRef: 'commit:abc',
  deployedAt: '2026-11-09T14:00:00Z',
  affectedUrls: ['https://www.sasquatchcarpet.com/monument'],
  queries: ['carpet cleaning monument'],
  baseline: [],
  reviewDates: ['2026-11-23'],
  outcomes: [],
}
describe('SEO change evidence', () => {
  it('accepts a proposed or deployed change without inventing baseline numbers', () => {
    expect(seoChangeSchema.safeParse(change).success).toBe(true)
    expect(
      seoChangeSchema.safeParse({
        ...change,
        deployedAt: null,
        deploymentRef: null,
      }).success,
    ).toBe(true)
  })
  it('rejects impossible review dates and pre-deployment review plans', () => {
    expect(
      seoChangeSchema.safeParse({ ...change, reviewDates: ['2026-02-30'] })
        .success,
    ).toBe(false)
    expect(
      seoChangeSchema.safeParse({ ...change, reviewDates: ['2026-11-01'] })
        .success,
    ).toBe(false)
  })
  it('rejects unstructured additions and empty hypotheses', () => {
    expect(
      seoChangeSchema.safeParse({ ...change, hypothesis: '' }).success,
    ).toBe(false)
    expect(
      seoChangeSchema.safeParse({ ...change, causedRankGain: true }).success,
    ).toBe(false)
  })
  it('rejects a measured baseline with no value', () => {
    expect(
      seoChangeSchema.safeParse({
        ...change,
        baseline: [
          {
            surface: 'organic',
            metric: 'clicks',
            value: null,
            unit: 'clicks',
            period: { start: '2026-10-26', end: '2026-11-01' },
            sourceRef: 'gsc:record',
            method: 'web/all-devices',
            state: 'measured',
          },
        ],
      }).success,
    ).toBe(false)
  })
  it('requires evidence for an outcome and limits interpretations', () => {
    expect(
      seoChangeSchema.safeParse({
        ...change,
        outcomes: [
          {
            reviewedAt: '2026-11-23T14:00:00Z',
            observation: 'Clicks increased',
            evidenceRefs: [],
            confounders: ['Seasonality'],
            interpretation: 'inconclusive',
          },
        ],
      }).success,
    ).toBe(false)
  })
})
