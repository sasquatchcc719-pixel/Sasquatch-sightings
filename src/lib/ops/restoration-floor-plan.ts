/**
 * Geometry for the plan.
 *
 * A room is a polygon, not a rectangle. Rooms entered as length x width get a
 * rectangle's four corners, but a room can carry its own corner list so a
 * diagonal wall or an L-shape can be drawn — real houses are full of both.
 *
 * Rooms that have never been moved fall back to an auto-arranged strip so the
 * plan is useful the moment a measurement is entered. Once a room is dragged it
 * keeps its position, and its walls can be snapped to a neighbour's.
 */

export type Point = { x: number; y: number }

export type PlanRoom = {
  id: string
  name: string
  lengthFt: number
  widthFt: number
  /** Saved position in plan feet. Null until the room is moved. */
  planX?: number | null
  planY?: number | null
  /** Corner list relative to the room origin, for non-rectangular rooms. */
  points?: Point[] | null
}

export type Opening = {
  id: string
  areaId: string
  kind: 'doorway' | 'opening' | 'window' | 'stairs'
  wallIndex: number
  offsetFt: number
  widthFt: number
}

export type PlacedRoom = PlanRoom & {
  x: number
  y: number
  points: Point[]
}

export type FloorPlanLayout = {
  rooms: PlacedRoom[]
  widthFt: number
  heightFt: number
}

const GAP_FT = 2
export const SNAP_TOLERANCE_FT = 1.5

/** A rectangle's corners, clockwise from the origin. */
export function rectanglePoints(lengthFt: number, widthFt: number): Point[] {
  const l = lengthFt > 0 ? lengthFt : 10
  const w = widthFt > 0 ? widthFt : 10
  return [
    { x: 0, y: 0 },
    { x: l, y: 0 },
    { x: l, y: w },
    { x: 0, y: w },
  ]
}

export function boundsOf(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return points.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxX: Math.max(acc.maxX, p.x),
      maxY: Math.max(acc.maxY, p.y),
    }),
    { minX: points[0].x, minY: points[0].y, maxX: points[0].x, maxY: points[0].y },
  )
}

/** Shoelace area, so an L-shaped or angled room reports its true square footage. */
export function polygonAreaSqft(points: Point[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.round(Math.abs(sum / 2) * 100) / 100
}

/** Wall length total — what baseboard and flood cuts are billed against. */
export function polygonPerimeterFt(points: Point[]): number {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return Math.round(total * 100) / 100
}

export function layoutFloorPlan(rooms: PlanRoom[], maxStripFt = 40): FloorPlanLayout {
  const placed: PlacedRoom[] = []
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const room of rooms) {
    const points =
      room.points && room.points.length >= 3
        ? room.points
        : rectanglePoints(Number(room.lengthFt), Number(room.widthFt))
    const bounds = boundsOf(points)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY

    const hasSavedPosition = room.planX != null && room.planY != null
    if (hasSavedPosition) {
      placed.push({ ...room, points, x: Number(room.planX), y: Number(room.planY) })
      continue
    }

    if (cursorX > 0 && cursorX + width > maxStripFt) {
      cursorX = 0
      cursorY += rowHeight + GAP_FT
      rowHeight = 0
    }
    placed.push({ ...room, points, x: cursorX, y: cursorY })
    cursorX += width + GAP_FT
    rowHeight = Math.max(rowHeight, height)
  }

  const widthFt = placed.reduce(
    (max, r) => Math.max(max, r.x + (boundsOf(r.points).maxX - boundsOf(r.points).minX)),
    0,
  )
  const heightFt = placed.reduce(
    (max, r) => Math.max(max, r.y + (boundsOf(r.points).maxY - boundsOf(r.points).minY)),
    0,
  )

  return { rooms: placed, widthFt, heightFt }
}

/**
 * Snap a dragged room's edges to nearby rooms, so walls meet flush instead of
 * leaving a sliver of a gap. Returns the adjusted position.
 */
export function snapPosition(
  moving: { x: number; y: number; points: Point[] },
  others: PlacedRoom[],
  tolerance = SNAP_TOLERANCE_FT,
): { x: number; y: number; snappedX: boolean; snappedY: boolean } {
  const b = boundsOf(moving.points)
  const width = b.maxX - b.minX
  const height = b.maxY - b.minY

  let x = moving.x
  let y = moving.y
  let snappedX = false
  let snappedY = false

  for (const other of others) {
    const ob = boundsOf(other.points)
    const oLeft = other.x
    const oRight = other.x + (ob.maxX - ob.minX)
    const oTop = other.y
    const oBottom = other.y + (ob.maxY - ob.minY)

    for (const [candidate, target] of [
      [x, oRight],
      [x, oLeft],
      [x + width, oLeft],
      [x + width, oRight],
    ] as const) {
      if (!snappedX && Math.abs(candidate - target) <= tolerance) {
        x += target - candidate
        snappedX = true
      }
    }

    for (const [candidate, target] of [
      [y, oBottom],
      [y, oTop],
      [y + height, oTop],
      [y + height, oBottom],
    ] as const) {
      if (!snappedY && Math.abs(candidate - target) <= tolerance) {
        y += target - candidate
        snappedY = true
      }
    }
  }

  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    snappedX,
    snappedY,
  }
}

/** Even-odd point-in-polygon, so L-shaped and angled rooms hit-test correctly. */
export function roomAtPoint(
  layout: FloorPlanLayout,
  xFt: number,
  yFt: number,
): PlacedRoom | null {
  for (const room of layout.rooms) {
    const localX = xFt - room.x
    const localY = yFt - room.y
    let inside = false
    const pts = room.points
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]
      const b = pts[j]
      const straddles = a.y > localY !== b.y > localY
      if (
        straddles &&
        localX < ((b.x - a.x) * (localY - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
      ) {
        inside = !inside
      }
    }
    if (inside) return room
  }
  return null
}

export function pointToPlanFeet(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  scale: number,
): { xFt: number; yFt: number } {
  const safeScale = scale > 0 ? scale : 1
  return {
    xFt: Math.round(((clientX - rect.left) / safeScale) * 100) / 100,
    yFt: Math.round(((clientY - rect.top) / safeScale) * 100) / 100,
  }
}

/** Midpoint and angle of a wall segment, for drawing a doorway on it. */
export function wallSegment(
  room: PlacedRoom,
  wallIndex: number,
): { from: Point; to: Point; lengthFt: number } | null {
  const pts = room.points
  if (pts.length < 2) return null
  const a = pts[wallIndex % pts.length]
  const b = pts[(wallIndex + 1) % pts.length]
  return {
    from: { x: room.x + a.x, y: room.y + a.y },
    to: { x: room.x + b.x, y: room.y + b.y },
    lengthFt: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100) / 100,
  }
}


/** Nearest point on a segment to an arbitrary point, and how far along it sits. */
export function projectOntoWall(
  from: Point,
  to: Point,
  point: Point,
): { distanceFt: number; offsetFt: number; t: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    return { distanceFt: Math.hypot(point.x - from.x, point.y - from.y), offsetFt: 0, t: 0 }
  }
  const rawT = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq
  const t = Math.max(0, Math.min(1, rawT))
  const closest = { x: from.x + dx * t, y: from.y + dy * t }
  return {
    distanceFt: Math.hypot(point.x - closest.x, point.y - closest.y),
    offsetFt: Math.round(Math.hypot(closest.x - from.x, closest.y - from.y) * 100) / 100,
    t,
  }
}

/**
 * Which wall of a room a tap is nearest, for placing a doorway. Returns null if
 * the tap is further from every wall than `maxDistanceFt`.
 */
export function nearestWall(
  room: PlacedRoom,
  xFt: number,
  yFt: number,
  maxDistanceFt = 2.5,
): { wallIndex: number; offsetFt: number; distanceFt: number } | null {
  const local = { x: xFt - room.x, y: yFt - room.y }
  let best: { wallIndex: number; offsetFt: number; distanceFt: number } | null = null

  for (let i = 0; i < room.points.length; i++) {
    const from = room.points[i]
    const to = room.points[(i + 1) % room.points.length]
    const hit = projectOntoWall(from, to, local)
    if (hit.distanceFt <= maxDistanceFt && (!best || hit.distanceFt < best.distanceFt)) {
      best = { wallIndex: i, offsetFt: hit.offsetFt, distanceFt: hit.distanceFt }
    }
  }
  return best
}

/** Move one corner of a room, keeping the polygon closed. */
export function moveCorner(
  points: Point[],
  index: number,
  x: number,
  y: number,
): Point[] {
  if (index < 0 || index >= points.length) return points
  const next = points.map((p) => ({ ...p }))
  next[index] = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
  return next
}

/** Insert a corner at the midpoint of a wall, so an L or a diagonal can be cut in. */
export function splitWall(points: Point[], wallIndex: number): Point[] {
  if (points.length < 3) return points
  const from = points[wallIndex % points.length]
  const to = points[(wallIndex + 1) % points.length]
  const mid = {
    x: Math.round(((from.x + to.x) / 2) * 100) / 100,
    y: Math.round(((from.y + to.y) / 2) * 100) / 100,
  }
  const next = points.map((p) => ({ ...p }))
  next.splice((wallIndex % points.length) + 1, 0, mid)
  return next
}

/** Remove a corner. A polygon must keep at least three. */
export function removeCorner(points: Point[], index: number): Point[] {
  if (points.length <= 3) return points
  return points.filter((_, i) => i !== index)
}
