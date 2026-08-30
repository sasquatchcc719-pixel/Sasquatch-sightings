import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  layoutFloorPlan,
  pointToPlanFeet,
  polygonAreaSqft,
  polygonPerimeterFt,
  rectanglePoints,
  roomAtPoint,
  snapPosition,
  wallSegment,
} from './restoration-floor-plan'

const room = (id: string, name: string, l: number, w: number, extra = {}) => ({
  id,
  name,
  lengthFt: l,
  widthFt: w,
  ...extra,
})

describe('polygon maths', () => {
  it('measures a rectangle', () => {
    const pts = rectanglePoints(20, 15)
    expect(polygonAreaSqft(pts)).toBe(300)
    expect(polygonPerimeterFt(pts)).toBe(70)
  })

  it('measures an L-shaped room, which a rectangle cannot', () => {
    // 20x15 with a 8x5 bite taken out of one corner.
    const l = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 8, y: 10 },
      { x: 8, y: 15 },
      { x: 0, y: 15 },
    ]
    expect(polygonAreaSqft(l)).toBe(300 - 60)
  })

  it('measures a diagonal wall by its true length', () => {
    const angled = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 5 },
      { x: 0, y: 9 },
    ]
    // The sloped wall is 12 across and 4 down: 12.65 ft, not 12.
    expect(polygonPerimeterFt(angled)).toBeCloseTo(12 + 5 + Math.hypot(12, 4) + 9, 1)
  })
})

describe('layoutFloorPlan', () => {
  it('auto-arranges rooms that have never been moved', () => {
    const layout = layoutFloorPlan([room('a', 'Rec', 20, 15), room('b', 'Hall', 10, 4)])
    expect(layout.rooms[0]).toMatchObject({ x: 0, y: 0 })
    expect(layout.rooms[1].x).toBe(22)
  })

  it('respects a saved position once a room has been dragged', () => {
    const layout = layoutFloorPlan([
      room('a', 'Rec', 20, 15, { planX: 5, planY: 30 }),
      room('b', 'Hall', 10, 4),
    ])
    expect(layout.rooms[0]).toMatchObject({ x: 5, y: 30 })
  })

  it('uses a custom polygon when one is stored', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
    ]
    const layout = layoutFloorPlan([room('a', 'Angled', 10, 6, { points: pts })])
    expect(layout.rooms[0].points).toEqual(pts)
  })
})

describe('snapPosition', () => {
  const neighbour = {
    id: 'n',
    name: 'Rec',
    lengthFt: 20,
    widthFt: 15,
    x: 0,
    y: 0,
    points: rectanglePoints(20, 15),
  }

  it('pulls a nearly-touching wall flush', () => {
    const result = snapPosition({ x: 20.8, y: 0.4, points: rectanglePoints(10, 4) }, [neighbour])
    expect(result.x).toBe(20)
    expect(result.y).toBe(0)
    expect(result.snappedX).toBe(true)
  })

  it('leaves a room alone when nothing is close', () => {
    const result = snapPosition({ x: 60, y: 60, points: rectanglePoints(10, 4) }, [neighbour])
    expect(result).toMatchObject({ x: 60, y: 60, snappedX: false, snappedY: false })
  })
})

describe('roomAtPoint', () => {
  it('hit-tests an L-shaped room correctly', () => {
    const layout = layoutFloorPlan([
      room('a', 'L room', 20, 15, {
        planX: 0,
        planY: 0,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 },
          { x: 8, y: 10 },
          { x: 8, y: 15 },
          { x: 0, y: 15 },
        ],
      }),
    ])
    expect(roomAtPoint(layout, 4, 4)?.name).toBe('L room')
    expect(roomAtPoint(layout, 4, 13)?.name).toBe('L room')
    // Inside the bounding box but outside the actual room — the bite.
    expect(roomAtPoint(layout, 15, 13)).toBeNull()
  })
})

describe('wallSegment', () => {
  it('returns the wall a doorway would sit on', () => {
    const layout = layoutFloorPlan([room('a', 'Rec', 20, 15, { planX: 0, planY: 0 })])
    const wall = wallSegment(layout.rooms[0], 1)
    expect(wall).toMatchObject({ from: { x: 20, y: 0 }, to: { x: 20, y: 15 }, lengthFt: 15 })
  })
})

describe('helpers', () => {
  it('bounds an empty polygon without throwing', () => {
    expect(boundsOf([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })

  it('does not divide by zero converting a tap', () => {
    expect(Number.isFinite(pointToPlanFeet(50, 50, { left: 0, top: 0 }, 0).xFt)).toBe(true)
  })
})
