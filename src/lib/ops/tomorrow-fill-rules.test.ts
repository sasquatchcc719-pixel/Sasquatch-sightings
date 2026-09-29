import { describe, expect, it } from 'vitest'
import {
  contactEligibility,
  normalizeFillPhone,
  normalizeFillZip,
  selectNonOverlappingOpenings,
} from './tomorrow-fill-rules'

describe('tomorrow fill rules', () => {
  it('normalizes phones and ZIP+4 values', () => {
    expect(normalizeFillPhone('(719) 555-0123')).toBe('+17195550123')
    expect(normalizeFillPhone('123')).toBeNull()
    expect(normalizeFillZip('80921-4412')).toBe('80921')
  })

  it('enforces the 14-day cooldown', () => {
    expect(
      contactEligibility({
        history: [
          { sentAt: '2026-09-20T15:00:00Z', repliedAt: null, bookedAt: null },
        ],
        asOfDate: '2026-09-29',
        cooldownDays: 14,
        unansweredLimit: 4,
        restDays: 60,
      }),
    ).toMatchObject({ eligible: false, reason: 'cooldown' })
  })

  it('rests four consecutive non-responders after the cooldown', () => {
    const history = [
      '2026-09-10',
      '2026-08-20',
      '2026-08-01',
      '2026-07-10',
    ].map((sentAt) => ({ sentAt, repliedAt: null, bookedAt: null }))
    expect(
      contactEligibility({
        history,
        asOfDate: '2026-09-29',
        cooldownDays: 14,
        unansweredLimit: 4,
        restDays: 60,
      }),
    ).toMatchObject({ eligible: false, reason: 'resting', unanswered: 4 })
  })

  it('starts a fresh four-message cycle after the rest window', () => {
    const eligibility = contactEligibility({
      history: [
        { sentAt: '2026-09-20', repliedAt: null, bookedAt: null },
        { sentAt: '2026-06-01', repliedAt: null, bookedAt: null },
        { sentAt: '2026-05-18', repliedAt: null, bookedAt: null },
        { sentAt: '2026-05-04', repliedAt: null, bookedAt: null },
        { sentAt: '2026-04-20', repliedAt: null, bookedAt: null },
      ],
      asOfDate: '2026-10-05',
      cooldownDays: 14,
      unansweredLimit: 4,
      restDays: 60,
    })

    expect(eligibility).toMatchObject({ eligible: true, unanswered: 1 })
  })

  it('does not count overlapping availability alternatives twice', () => {
    const openings = selectNonOverlappingOpenings([
      {
        staffUserId: 'a',
        staffName: 'David',
        startTime: '09:00:00',
        endTime: '11:00:00',
      },
      {
        staffUserId: 'a',
        staffName: 'David',
        startTime: '10:00:00',
        endTime: '12:00:00',
      },
      {
        staffUserId: 'a',
        staffName: 'David',
        startTime: '11:00:00',
        endTime: '13:00:00',
      },
    ])
    expect(openings.map((row) => row.startTime)).toEqual([
      '09:00:00',
      '11:00:00',
    ])
  })
})
