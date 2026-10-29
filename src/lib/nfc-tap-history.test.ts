import { describe, expect, it } from 'vitest'
import { buildThirtyDayTapHistory } from './nfc-tap-history'

describe('NFC tap history', () => {
  it('groups taps by the Colorado calendar date', () => {
    const history = buildThirtyDayTapHistory(
      ['2026-10-29T05:30:00.000Z', '2026-10-29T06:30:00.000Z'],
      new Date('2026-10-29T18:00:00.000Z'),
    )

    expect(history.slice(-2)).toEqual([
      { date: 'Oct 28', count: 1 },
      { date: 'Oct 29', count: 1 },
    ])
  })
})
