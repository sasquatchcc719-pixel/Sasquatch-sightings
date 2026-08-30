import { describe, expect, it } from 'vitest'
import {
  EPA_TABLE_1,
  guidanceFor,
  hoursSince,
  warningsForLoss,
} from './restoration-material-guidance'

/**
 * Assertions are against EPA Table 1 as published (EPA 402-K-01-001, p. 11).
 * These are quoted, not paraphrased — if an entry changes, that is a decision,
 * not a refactor.
 */

describe('EPA Table 1', () => {
  it('covers every material the table lists', () => {
    expect(EPA_TABLE_1).toHaveLength(12)
  })

  it('marks the materials the table says to discard outright', () => {
    for (const key of ['ceiling_tiles', 'cellulose_insulation', 'fiberglass_insulation']) {
      expect(guidanceFor(key)?.disposition).toBe('discard')
      expect(guidanceFor(key)?.actions).toEqual(['Discard and replace.'])
    }
  })

  it('keeps drywall a judgement call, because that is what decides a flood cut', () => {
    const wallboard = guidanceFor('wallboard')
    expect(wallboard?.disposition).toBe('depends')
    expect(wallboard?.actions[0]).toContain('no obvious swelling and the seams are intact')
  })

  it('says carpet is dried, not torn out, when caught in time', () => {
    const carpet = guidanceFor('carpet')
    expect(carpet?.disposition).toBe('dry_in_place')
    expect(carpet?.suggests).toContain('LIFT')
  })

  it('returns null for an unknown material rather than guessing', () => {
    expect(guidanceFor('marble_statue')).toBeNull()
  })
})

describe('warnings that change how the job is run', () => {
  it('stops air movers on contaminated water', () => {
    const warnings = warningsForLoss({ waterCategory: 3, hoursSinceLoss: 2 })
    const fans = warnings.find((w) => w.title.includes('air movers'))
    expect(fans?.severity).toBe('critical')
    expect(fans?.detail).toContain('clean or sanitary')
  })

  it('requires PPE and containment on Category 2 and above', () => {
    expect(warningsForLoss({ waterCategory: 2, hoursSinceLoss: 1 }).some((w) =>
      w.title.includes('PPE'),
    )).toBe(true)
    expect(warningsForLoss({ waterCategory: 1, hoursSinceLoss: 1 }).some((w) =>
      w.title.includes('PPE'),
    )).toBe(false)
  })

  it('flags the 48-hour boundary', () => {
    expect(
      warningsForLoss({ waterCategory: 1, hoursSinceLoss: 96 }).some((w) =>
        w.title.includes('48 hours'),
      ),
    ).toBe(true)
    expect(
      warningsForLoss({ waterCategory: 1, hoursSinceLoss: 12 }).some((w) =>
        w.title.includes('48 hours'),
      ),
    ).toBe(false)
  })

  it('says nothing for a clean loss caught early', () => {
    expect(warningsForLoss({ waterCategory: 1, hoursSinceLoss: 6 })).toEqual([])
  })

  it('stays dismissed once acknowledged — these are prompts, not rules', () => {
    const all = warningsForLoss({ waterCategory: 3, hoursSinceLoss: 96 })
    expect(all).toHaveLength(3)

    const afterOne = warningsForLoss({
      waterCategory: 3,
      hoursSinceLoss: 96,
      acknowledged: ['fans_before_clean'],
    })
    expect(afterOne.map((w) => w.key)).toEqual(['ppe_containment', 'past_48_hours'])

    expect(
      warningsForLoss({
        waterCategory: 3,
        hoursSinceLoss: 96,
        acknowledged: ['fans_before_clean', 'ppe_containment', 'past_48_hours'],
      }),
    ).toEqual([])
  })

  it('every warning has a stable key so a dismissal sticks', () => {
    const keys = warningsForLoss({ waterCategory: 3, hoursSinceLoss: 96 }).map((w) => w.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((k) => k.length > 0)).toBe(true)
  })

  it('handles a loss with no recorded time', () => {
    expect(warningsForLoss({ waterCategory: null, hoursSinceLoss: null })).toEqual([])
    expect(hoursSince(null)).toBeNull()
    expect(hoursSince('not a date')).toBeNull()
  })
})
