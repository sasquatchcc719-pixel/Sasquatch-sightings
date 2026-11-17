import { describe, expect, it } from 'vitest'
import { temperatureAlarmState } from './truck-temperature'

describe('temperatureAlarmState', () => {
  it('enters the freeze alarm at the low limit', () => {
    expect(temperatureAlarmState(31, 31, 250, null)).toBe('low')
  })

  it('holds the freeze alarm until the temperature recovers by 2°F', () => {
    expect(temperatureAlarmState(32.9, 31, 250, 'low')).toBe('low')
    expect(temperatureAlarmState(33, 31, 250, 'low')).toBe(null)
  })

  it('does not re-enter the alarm while the temperature stays above 31°F', () => {
    expect(temperatureAlarmState(32, 31, 250, null)).toBe(null)
  })
})
