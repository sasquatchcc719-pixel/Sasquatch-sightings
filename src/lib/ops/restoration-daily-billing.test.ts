import { describe, it, expect } from 'vitest'
import {
  isDailyBilled,
  dryingDaysFromVisits,
  DEFAULT_DRYING_DAYS,
} from './restoration-daily-billing'

describe('isDailyBilled', () => {
  it('catches every wording the price sheet uses for a 24-hour period', () => {
    expect(isDailyBilled('Air mover (per 24 hour period) - No monitoring', 'EA')).toBe(true)
    expect(isDailyBilled('Dehumidifier (per 24 hr period)- 110-159 ppd - No monitor.', 'EA')).toBe(true)
    expect(isDailyBilled('Negative air fan/Air scrubber (24 hr period) - No monit.', 'DA')).toBe(true)
    expect(isDailyBilled('Respirator - Half face - multi-purpose resp. (per day)', 'DA')).toBe(true)
  })

  it('does not treat hourly monitoring as daily just because it says Daily', () => {
    expect(isDailyBilled('Daily monitoring (hourly charge)', 'HR')).toBe(false)
    expect(isDailyBilled('Equipment setup, take down, and monitoring (hourly charge)', 'HR')).toBe(false)
  })

  it('leaves ordinary measured work alone', () => {
    expect(isDailyBilled('Water extraction from carpet', 'SF')).toBe(false)
    expect(isDailyBilled('Tear out wet drywall, cut 2 ft', 'LF')).toBe(false)
  })

  it('treats a DA unit as daily whatever the description says', () => {
    expect(isDailyBilled('Something rented', 'DA')).toBe(true)
  })
})

describe('dryingDaysFromVisits', () => {
  it('quotes the number of monitor visits, which is the nights it runs', () => {
    expect(
      dryingDaysFromVisits([
        { visit_type: 'mitigation' },
        { visit_type: 'monitor' },
        { visit_type: 'monitor' },
        { visit_type: 'monitor' },
      ]),
    ).toBe(3)
  })

  it('ignores a cancelled monitor', () => {
    expect(
      dryingDaysFromVisits([
        { visit_type: 'mitigation' },
        { visit_type: 'monitor' },
        { visit_type: 'monitor', status: 'cancelled' },
      ]),
    ).toBe(1)
  })

  it('falls back to the default when the visits are not built yet', () => {
    expect(dryingDaysFromVisits([{ visit_type: 'mitigation' }])).toBe(DEFAULT_DRYING_DAYS)
  })
})
