import { describe, expect, it } from 'vitest'
import { needsMinimumDisclaimer } from './minimum-disclaimer'

describe('needsMinimumDisclaimer', () => {
  it('does not mistake the largest unit price for a multi-item quote total', () => {
    const response =
      'For your quote: 3 large bedrooms ($90 each), 2 small bedrooms ($46 each), 1 living room (can you share its size?), and staircase ($4/step).'

    expect(needsMinimumDisclaimer(response)).toBe(false)
  })

  it('adds the minimum for a fully computable quote below $150', () => {
    expect(needsMinimumDisclaimer('2 bedrooms at $46 each.')).toBe(true)
  })

  it('does not add the minimum for a fully computable quote above $150', () => {
    expect(needsMinimumDisclaimer('4 bedrooms at $46 each.')).toBe(false)
  })

  it('uses an explicit total when line-item prices are also present', () => {
    expect(
      needsMinimumDisclaimer('Two rugs are $32 each. Estimated total: $64.'),
    ).toBe(true)
    expect(
      needsMinimumDisclaimer(
        'Five bedrooms are $46 each. Estimated total: $230.',
      ),
    ).toBe(false)
  })

  it('does not force a conclusion from multiple ambiguous prices', () => {
    expect(
      needsMinimumDisclaimer(
        'Rooms are $46 each and stairs are $4 per step. How many rooms and steps?',
      ),
    ).toBe(false)
  })

  it('leaves an existing minimum explanation unchanged', () => {
    expect(
      needsMinimumDisclaimer(
        'The rugs total $64, and our minimum dispatch fee is $150.',
      ),
    ).toBe(false)
  })
})
