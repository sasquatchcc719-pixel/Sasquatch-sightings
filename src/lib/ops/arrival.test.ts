import { describe, expect, it } from 'vitest'
import {
  ARRIVAL_THRESHOLD_METERS,
  distanceMeters,
  formatDistance,
  hasArrived,
  nextVisitAction,
} from './arrival'

describe('distanceMeters', () => {
  it('is zero at the same point', () => {
    expect(distanceMeters(39.0916, -104.8722, 39.0916, -104.8722)).toBe(0)
  })

  it('measures a known separation', () => {
    // Monument to Palmer Lake is a little over 4 km.
    const d = distanceMeters(39.0916, -104.8722, 39.1222, -104.9169)
    expect(d).toBeGreaterThan(4000)
    expect(d).toBeLessThan(6000)
  })

  it('is symmetric', () => {
    const a = distanceMeters(39.09, -104.87, 39.12, -104.91)
    const b = distanceMeters(39.12, -104.91, 39.09, -104.87)
    expect(a).toBeCloseTo(b, 6)
  })
})

describe('hasArrived', () => {
  it('counts arrival only inside the threshold', () => {
    expect(hasArrived(0)).toBe(true)
    expect(hasArrived(ARRIVAL_THRESHOLD_METERS)).toBe(true)
    expect(hasArrived(ARRIVAL_THRESHOLD_METERS + 1)).toBe(false)
  })

  it('is not arrived when there is no fix yet', () => {
    expect(hasArrived(null)).toBe(false)
  })
})

describe('formatDistance', () => {
  it('reads naturally at each range', () => {
    expect(formatDistance(null)).toBe('locating…')
    expect(formatDistance(10)).toBe('at the property')
    expect(formatDistance(150)).toContain('ft away')
    expect(formatDistance(4000)).toContain('mi away')
  })
})

describe('nextVisitAction', () => {
  it('walks a visit forward one step at a time', () => {
    expect(nextVisitAction('booked')?.status).toBe('on_my_way')
    expect(nextVisitAction('confirmed')?.label).toBe('On My Way')
    expect(nextVisitAction('on_my_way')?.status).toBe('in_progress')
    expect(nextVisitAction('in_progress')?.status).toBe('completed')
  })

  it('offers nothing once the visit is done or cancelled', () => {
    expect(nextVisitAction('completed')).toBeNull()
    expect(nextVisitAction('cancelled')).toBeNull()
  })
})
