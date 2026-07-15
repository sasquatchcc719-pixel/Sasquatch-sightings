import { describe, expect, it } from 'vitest'
import { getCalendarPopupPosition } from '@/lib/ops/calendar-popup-position'

describe('getCalendarPopupPosition', () => {
  it('centers the popup below a drop point in the upper viewport', () => {
    expect(
      getCalendarPopupPosition({
        x: 600,
        y: 300,
        viewportWidth: 1200,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 430, top: 312, width: 340, placeAbove: false })
  })

  it('keeps the popup inside the right viewport edge', () => {
    expect(
      getCalendarPopupPosition({
        x: 1190,
        y: 300,
        viewportWidth: 1200,
        viewportHeight: 800,
      }).left,
    ).toBe(848)
  })

  it('fits narrow screens and places the popup above lower drop points', () => {
    expect(
      getCalendarPopupPosition({
        x: 10,
        y: 700,
        viewportWidth: 320,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 12, top: 688, width: 296, placeAbove: true })
  })
})
