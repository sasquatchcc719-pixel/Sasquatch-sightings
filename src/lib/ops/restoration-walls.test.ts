import { describe, expect, it } from 'vitest'
import {
  clampOpeningOffset,
  draftLengthFt,
  endPointForLength,
  findLoops,
  formatFeetInches,
  findNodeNear,
  loopAreaSqft,
  loopAt,
  loopContains,
  offsetNodes,
  openingPosition,
  projectOntoWall,
  rectangleWalls,
  resolveWalls,
  snapToGrid,
  totalWallLengthFt,
  wallNear,
  type PlanNode,
  type PlanWall,
} from './restoration-walls'

/** A 20x15 room, plus a pony wall dividing it — exactly Jill's situation. */
function scene() {
  const nodes: PlanNode[] = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 20, y: 0 },
    { id: 'c', x: 20, y: 15 },
    { id: 'd', x: 0, y: 15 },
    { id: 'p', x: 10, y: 7 }, // free end of the pony wall
  ]
  const walls: PlanWall[] = [
    { id: 'w1', startNodeId: 'a', endNodeId: 'b' },
    { id: 'w2', startNodeId: 'b', endNodeId: 'c' },
    { id: 'w3', startNodeId: 'c', endNodeId: 'd' },
    { id: 'w4', startNodeId: 'd', endNodeId: 'a' },
    { id: 'pony', startNodeId: 'd', endNodeId: 'p' },
  ]
  return { nodes, walls, resolved: resolveWalls(nodes, walls) }
}

describe('resolveWalls', () => {
  it('gives every wall its endpoints and true length', () => {
    const { resolved } = scene()
    expect(resolved).toHaveLength(5)
    expect(resolved.find((w) => w.id === 'w1')?.lengthFt).toBe(20)
    expect(resolved.find((w) => w.id === 'w2')?.lengthFt).toBe(15)
  })

  it('measures a diagonal wall by its real length', () => {
    const nodes: PlanNode[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 12, y: 5 },
    ]
    const [wall] = resolveWalls(nodes, [{ id: 'w', startNodeId: 'a', endNodeId: 'b' }])
    expect(wall.lengthFt).toBeCloseTo(13, 1)
  })

  it('skips a wall whose node is missing rather than crashing', () => {
    expect(resolveWalls([{ id: 'a', x: 0, y: 0 }], [
      { id: 'w', startNodeId: 'a', endNodeId: 'gone' },
    ])).toEqual([])
  })
})

describe('a pony wall', () => {
  it('exists as a wall that encloses nothing', () => {
    const { resolved } = scene()
    const pony = resolved.find((w) => w.id === 'pony')
    expect(pony).toBeDefined()
    expect(pony?.lengthFt).toBeCloseTo(Math.hypot(10, 8), 1)
  })

  it('still counts toward billable wall length, because drywall comes off it', () => {
    const { resolved } = scene()
    const total = totalWallLengthFt(resolved)
    expect(total).toBeCloseTo(20 + 15 + 20 + 15 + Math.hypot(10, 8), 1)
  })

  it('is left out of the room loop', () => {
    const { resolved } = scene()
    const loops = findLoops(resolved)
    expect(loops).toHaveLength(1)
    expect(loops[0]).toHaveLength(4)
    expect(loops[0]).not.toContain('p')
  })
})

describe('shared nodes', () => {
  it('moving one node moves every wall meeting there', () => {
    const { nodes, walls } = scene()
    const moved = nodes.map((n) => (n.id === 'd' ? { ...n, x: -4, y: 18 } : n))
    const resolved = resolveWalls(moved, walls)
    // w3, w4 and the pony wall all attach to node d.
    expect(resolved.find((w) => w.id === 'w3')?.end).toEqual({ x: -4, y: 18 })
    expect(resolved.find((w) => w.id === 'w4')?.start).toEqual({ x: -4, y: 18 })
    expect(resolved.find((w) => w.id === 'pony')?.start).toEqual({ x: -4, y: 18 })
  })
})

describe('findNodeNear', () => {
  it('reuses a nearby corner so walls join instead of nearly touching', () => {
    const { nodes } = scene()
    expect(findNodeNear(nodes, 20.3, 0.2)?.id).toBe('b')
  })

  it('returns null when nothing is close', () => {
    expect(findNodeNear(scene().nodes, 50, 50)).toBeNull()
  })
})

describe('doors host on walls', () => {
  it('finds the wall under a tap and how far along it', () => {
    const { resolved } = scene()
    const hit = wallNear(resolved, 6, 0.4)
    expect(hit?.wall.id).toBe('w1')
    expect(hit?.offsetFt).toBeCloseTo(6, 1)
  })

  it('refuses a tap in open floor, so a door cannot float mid-room', () => {
    const { resolved } = scene()
    expect(wallNear(resolved, 16, 12)).toBeNull()
  })

  it('places the door on the wall, at the right angle', () => {
    const { resolved } = scene()
    const wall = resolved.find((w) => w.id === 'w2')!
    const pos = openingPosition(wall, {
      id: 'o',
      wallId: 'w2',
      kind: 'doorway',
      offsetFt: 7.5,
      widthFt: 3,
    })
    expect(pos?.x).toBeCloseTo(20, 2)
    expect(pos?.y).toBeCloseTo(7.5, 2)
    expect(Math.abs(pos!.angleDeg)).toBeCloseTo(90, 1)
  })

  it('clamps an offset past the end of its wall', () => {
    const { resolved } = scene()
    const wall = resolved.find((w) => w.id === 'w1')!
    const pos = openingPosition(wall, {
      id: 'o',
      wallId: 'w1',
      kind: 'doorway',
      offsetFt: 999,
      widthFt: 3,
    })
    expect(pos?.x).toBeCloseTo(20, 2)
  })
})

describe('rooms derived from loops', () => {
  it('measures the enclosed area', () => {
    const { nodes, resolved } = scene()
    const [loop] = findLoops(resolved)
    expect(loopAreaSqft(nodes, loop)).toBe(300)
  })

  it('finds nothing enclosed when walls do not close', () => {
    const nodes: PlanNode[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 0 },
      { id: 'c', x: 10, y: 8 },
    ]
    const open = resolveWalls(nodes, [
      { id: 'w1', startNodeId: 'a', endNodeId: 'b' },
      { id: 'w2', startNodeId: 'b', endNodeId: 'c' },
    ])
    expect(findLoops(open)).toEqual([])
  })
})

describe('helpers', () => {
  it('snaps to a half foot', () => {
    expect(snapToGrid(7.83)).toBe(8)
    expect(snapToGrid(7.2)).toBe(7)
    expect(snapToGrid(7.3)).toBe(7.5)
  })

  it('builds a rectangle as four nodes and four walls', () => {
    const rect = rectangleWalls(0, 0, 20, 15, (i) => `n${i}`)
    expect(rect.nodes).toHaveLength(4)
    expect(rect.walls).toHaveLength(4)
    // Closed: the last wall returns to the first node.
    expect(rect.walls[3].endNodeId).toBe('n0')
  })

  it('does not divide by zero on a zero-length wall', () => {
    const [wall] = resolveWalls(
      [{ id: 'a', x: 3, y: 3 }, { id: 'b', x: 3, y: 3 }],
      [{ id: 'w', startNodeId: 'a', endNodeId: 'b' }],
    )
    expect(Number.isFinite(projectOntoWall(wall, 9, 9).distanceFt)).toBe(true)
  })
})

describe('editing a wall by its number', () => {
  const walls = resolveWalls(
    [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 0 },
      { id: 'c', x: 0, y: 0 },
      { id: 'd', x: 6, y: 8 },
    ],
    [
      { id: 'h', startNodeId: 'a', endNodeId: 'b' },
      { id: 'diag', startNodeId: 'c', endNodeId: 'd' },
    ],
  )

  it('extends a horizontal wall to an exact length', () => {
    const point = endPointForLength(walls[0], 14)
    expect(point).toEqual({ x: 14, y: 0 })
  })

  it('shortens it too', () => {
    expect(endPointForLength(walls[0], 6)).toEqual({ x: 6, y: 0 })
  })

  it('keeps a diagonal wall on its own angle', () => {
    // The 6-8-10 wall set to 20 ft should land at 12,16.
    const point = endPointForLength(walls[1], 20)
    expect(point?.x).toBeCloseTo(12, 2)
    expect(point?.y).toBeCloseTo(16, 2)
  })

  it('refuses a length that is not a positive number', () => {
    expect(endPointForLength(walls[0], 0)).toBeNull()
    expect(endPointForLength(walls[0], -5)).toBeNull()
    expect(endPointForLength(walls[0], Number.NaN)).toBeNull()
  })
})

describe('readouts', () => {
  it('measures a wall being dragged', () => {
    expect(draftLengthFt({ x1: 0, y1: 0, x2: 3, y2: 4 })).toBe(5)
    expect(draftLengthFt({ x1: 2, y1: 2, x2: 2, y2: 2 })).toBe(0)
  })

  it('reads lengths the way a builder says them', () => {
    expect(formatFeetInches(12)).toBe('12′')
    expect(formatFeetInches(12.5)).toBe('12′ 6″')
    expect(formatFeetInches(7.25)).toBe('7′ 3″')
    // Rounding up a hair should not produce 12 inches.
    expect(formatFeetInches(11.99)).toBe('12′')
  })
})

describe('dragging a whole room', () => {
  const { nodes, resolved } = scene()

  it('finds the enclosed room under a point', () => {
    const loop = loopAt(nodes, resolved, 10, 7)
    expect(loop).not.toBeNull()
    expect(loop).toHaveLength(4)
    // The pony wall's free end is not part of the room boundary.
    expect(loop).not.toContain('p')
  })

  it('finds nothing outside the walls', () => {
    expect(loopAt(nodes, resolved, 40, 40)).toBeNull()
  })

  it('moves every corner of the room together, so walls do not tear', () => {
    const loop = loopAt(nodes, resolved, 10, 7)!
    const moved = offsetNodes(nodes, loop, 5, -2)
    const movedWalls = resolveWalls(moved, [
      { id: 'w1', startNodeId: 'a', endNodeId: 'b' },
      { id: 'w2', startNodeId: 'b', endNodeId: 'c' },
    ])
    // Lengths are unchanged: the room moved rather than stretched.
    expect(movedWalls[0].lengthFt).toBe(20)
    expect(movedWalls[1].lengthFt).toBe(15)
    expect(moved.find((n) => n.id === 'a')).toMatchObject({ x: 5, y: -2 })
  })

  it('leaves nodes outside the loop where they are', () => {
    const loop = loopAt(nodes, resolved, 10, 7)!
    const moved = offsetNodes(nodes, loop, 5, 5)
    // The pony wall's free end stays put, so the wall stretches with the room.
    expect(moved.find((n) => n.id === 'p')).toMatchObject({ x: 10, y: 7 })
  })

  it('handles a point-in-loop test on a degenerate loop', () => {
    expect(loopContains(nodes, ['a', 'b'], 5, 5)).toBe(false)
  })
})

describe('openings stay on their wall', () => {
  it('keeps a door inside a wall it was dragged past the end of', () => {
    expect(clampOpeningOffset(12, 3, 20)).toBe(9)
    expect(clampOpeningOffset(12, 3, -4)).toBe(0)
    expect(clampOpeningOffset(12, 3, 5)).toBe(5)
  })

  it('pins a door to the start when the wall is shorter than the door', () => {
    expect(clampOpeningOffset(2, 6, 1)).toBe(0)
  })

  it('never returns a NaN offset, which would make the door vanish', () => {
    expect(clampOpeningOffset(12, 3, Number.NaN)).toBe(0)
  })
})
