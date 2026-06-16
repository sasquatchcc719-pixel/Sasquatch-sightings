import { describe, expect, it } from 'vitest'
import { addMinutesToTime, recomputeEndTime } from './schedule'

describe('addMinutesToTime', () => {
  it('adds minutes and returns HH:MM, accepting HH:MM:SS input', () => {
    expect(addMinutesToTime('14:00:00', 180)).toBe('17:00')
    expect(addMinutesToTime('14:00', 30)).toBe('14:30')
  })
})

describe('recomputeEndTime — Jamie / the stretched-job bug', () => {
  it('treats $353 and $378 the same (same dollar tier) — removing the closet does not change the tier', () => {
    expect(recomputeEndTime('14:00', 353)).toBe(recomputeEndTime('14:00', 378))
  })

  it('the corrupted $1,600 job lands in a higher tier and ends LATER than the real $353 job', () => {
    const real = recomputeEndTime('14:00', 353)
    const corrupted = recomputeEndTime('14:00', 1600)
    expect(corrupted > real).toBe(true)
  })
})
