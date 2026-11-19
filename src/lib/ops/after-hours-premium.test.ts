import { describe, it, expect } from 'vitest'
import {
  computeAfterHoursMinutes,
  computePremiumPay,
  isAfterHoursPremiumCustomer,
  resolveAfterHoursPremiumEnd,
  resolveAfterHoursPremiumStart,
} from './after-hours-premium'

describe('isAfterHoursPremiumCustomer', () => {
  it('matches Recovery Village and Saltgrass despite trailing space / case', () => {
    expect(isAfterHoursPremiumCustomer('Recovery Village ')).toBe(true)
    expect(isAfterHoursPremiumCustomer('recovery village')).toBe(true)
    expect(isAfterHoursPremiumCustomer('Recovery Village')).toBe(true)
    expect(isAfterHoursPremiumCustomer('Saltgrass Colorado Springs')).toBe(true)
    expect(isAfterHoursPremiumCustomer('SALTGRASS COLORADO SPRINGS ')).toBe(
      true,
    )
  })
  it('rejects other customers', () => {
    expect(isAfterHoursPremiumCustomer('Levis Custom Clean')).toBe(false)
    expect(isAfterHoursPremiumCustomer('Saltgrass Denver')).toBe(false)
    expect(isAfterHoursPremiumCustomer(null)).toBe(false)
    expect(isAfterHoursPremiumCustomer(undefined)).toBe(false)
  })
})

describe('resolveAfterHoursPremiumEnd', () => {
  it('keeps a later clock time on the same work date', () => {
    expect(
      resolveAfterHoursPremiumEnd(
        '2026-11-18T01:00:00.000Z',
        '2026-11-17',
        '19:15',
      ),
    ).toBe('2026-11-18T02:15:00.000Z')
  })

  it('moves an earlier clock time to the next date for overnight work', () => {
    expect(
      resolveAfterHoursPremiumEnd(
        '2026-11-17T04:45:00.000Z',
        '2026-11-16',
        '00:01',
      ),
    ).toBe('2026-11-17T07:01:00.000Z')
  })
})

describe('resolveAfterHoursPremiumStart', () => {
  it('prefers the recorded Start Job timestamp', () => {
    expect(
      resolveAfterHoursPremiumStart(
        '2026-11-17T04:12:00Z',
        '2026-11-16',
        '21:00:00',
      ),
    ).toEqual({
      timestamp: '2026-11-17T04:12:00Z',
      source: 'job_started',
    })
  })

  it('uses the scheduled start for a completed legacy job missing Start Job', () => {
    const start = resolveAfterHoursPremiumStart(null, '2026-11-16', '21:00:00')
    expect(start).toEqual({
      timestamp: '2026-11-17T04:00:00.000Z',
      source: 'scheduled',
    })
    const minutes = computeAfterHoursMinutes(
      start?.timestamp,
      '2026-11-17T07:01:59.757Z',
    )
    expect(minutes).toBe(182)
    expect(computePremiumPay(minutes)).toBe(30.33)
  })

  it('returns null when neither start is usable', () => {
    expect(resolveAfterHoursPremiumStart(null, '2026-11-16', null)).toBeNull()
  })
})

describe('computeAfterHoursMinutes (America/Denver, June = MDT/UTC-6)', () => {
  it('counts the whole window when it starts at 6pm (6:00–8:10pm = 130m)', () => {
    // 6:00pm MDT Jun 18 = 00:00Z Jun 19; 8:10pm = 02:10Z Jun 19
    expect(
      computeAfterHoursMinutes('2026-06-19T00:00:00Z', '2026-06-19T02:10:00Z'),
    ).toBe(130)
  })
  it('counts only the post-6pm portion when straddling (4:30–7:30pm = 90m)', () => {
    // 4:30pm MDT = 22:30Z Jun 18; 7:30pm = 01:30Z Jun 19; 6pm cutoff = 00:00Z
    expect(
      computeAfterHoursMinutes('2026-06-18T22:30:00Z', '2026-06-19T01:30:00Z'),
    ).toBe(90)
  })
  it('returns 0 for a job entirely before 6pm (1–3pm)', () => {
    expect(
      computeAfterHoursMinutes('2026-06-18T19:00:00Z', '2026-06-18T21:00:00Z'),
    ).toBe(0)
  })
  it('returns 0 for missing or inverted timestamps', () => {
    expect(computeAfterHoursMinutes(null, '2026-06-19T02:10:00Z')).toBe(0)
    expect(computeAfterHoursMinutes('2026-06-19T02:10:00Z', null)).toBe(0)
    expect(
      computeAfterHoursMinutes('2026-06-19T02:10:00Z', '2026-06-19T00:00:00Z'),
    ).toBe(0)
  })
})

describe('computePremiumPay', () => {
  it('computes $10/hr rounded to cents', () => {
    expect(computePremiumPay(130)).toBe(21.67)
    expect(computePremiumPay(150)).toBe(25)
    expect(computePremiumPay(0)).toBe(0)
  })
})
