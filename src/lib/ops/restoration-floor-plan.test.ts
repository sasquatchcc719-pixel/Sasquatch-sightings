import { describe, expect, it } from 'vitest'
import { layoutFloorPlan, pointToPlanFeet, roomAtPoint } from './restoration-floor-plan'

const ROOM = (id: string, name: string, l: number, w: number) => ({
  id,
  name,
  lengthFt: l,
  widthFt: w,
})

describe('layoutFloorPlan', () => {
  it('places rooms left to right with a gap between them', () => {
    const layout = layoutFloorPlan([ROOM('a', 'Rec room', 20, 15), ROOM('b', 'Hall', 10, 4)])
    expect(layout.rooms[0]).toMatchObject({ x: 0, y: 0 })
    expect(layout.rooms[1].x).toBe(22)
    expect(layout.rooms[1].y).toBe(0)
  })

  it('wraps to a new row when the strip is full', () => {
    const layout = layoutFloorPlan(
      [ROOM('a', 'A', 30, 10), ROOM('b', 'B', 30, 12)],
      40,
    )
    expect(layout.rooms[1].x).toBe(0)
    expect(layout.rooms[1].y).toBe(12)
  })

  it('gives an oversized room its own row rather than dropping it', () => {
    const layout = layoutFloorPlan([ROOM('a', 'Huge', 80, 20)], 40)
    expect(layout.rooms).toHaveLength(1)
    expect(layout.widthFt).toBe(80)
  })

  it('is deterministic, so a pin stays in the room it was dropped in', () => {
    const rooms = [ROOM('a', 'A', 12, 10), ROOM('b', 'B', 14, 9), ROOM('c', 'C', 20, 11)]
    expect(layoutFloorPlan(rooms)).toEqual(layoutFloorPlan(rooms))
  })

  it('substitutes a default for a missing or zero dimension', () => {
    const layout = layoutFloorPlan([ROOM('a', 'Unmeasured', 0, 0)])
    expect(layout.rooms[0].lengthFt).toBe(10)
    expect(layout.rooms[0].widthFt).toBe(10)
  })
})

describe('roomAtPoint', () => {
  const layout = layoutFloorPlan([ROOM('a', 'Rec room', 20, 15), ROOM('b', 'Hall', 10, 4)])

  it('finds the room under a tap', () => {
    expect(roomAtPoint(layout, 5, 5)?.name).toBe('Rec room')
    expect(roomAtPoint(layout, 25, 2)?.name).toBe('Hall')
  })

  it('returns null when the tap lands in empty space', () => {
    expect(roomAtPoint(layout, 21, 14)).toBeNull()
    expect(roomAtPoint(layout, 500, 500)).toBeNull()
  })
})

describe('pointToPlanFeet', () => {
  it('converts a tap to plan feet at the current scale', () => {
    expect(pointToPlanFeet(120, 80, { left: 20, top: 20 }, 10)).toEqual({ xFt: 10, yFt: 6 })
  })

  it('does not divide by zero when the plan has not been sized yet', () => {
    const point = pointToPlanFeet(50, 50, { left: 0, top: 0 }, 0)
    expect(Number.isFinite(point.xFt)).toBe(true)
    expect(Number.isFinite(point.yFt)).toBe(true)
  })
})
