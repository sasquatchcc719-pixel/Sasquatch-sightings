/**
 * Wall-based floor plan geometry.
 *
 * The model every real floor plan editor uses, and the one this should have
 * started with:
 *
 *  - a NODE is a shared corner point
 *  - a WALL is a segment between two nodes
 *  - moving a node moves every wall attached to it, so corners stay joined
 *  - a ROOM is an enclosed loop of walls, derived rather than stored as a shape
 *  - a DOOR is hosted ON a wall at an offset from its start node
 *
 * The previous model — rooms as independent polygons — could not represent a
 * pony wall (a wall that encloses nothing), could not keep shared corners
 * together, and left doors floating because they were anchored to a room edge
 * index that moved underneath them.
 */

export type PlanNode = { id: string; x: number; y: number }

export type PlanWall = {
  id: string
  startNodeId: string
  endNodeId: string
  thicknessIn?: number
  isPartialHeight?: boolean
  label?: string | null
}

export type WallOpening = {
  id: string
  wallId: string
  kind: 'doorway' | 'opening' | 'window' | 'stairs'
  offsetFt: number
  widthFt: number
}

export type ResolvedWall = PlanWall & {
  start: { x: number; y: number }
  end: { x: number; y: number }
  lengthFt: number
}

export const NODE_SNAP_FT = 0.5
/** Nodes closer than this are treated as the same corner and merged. */
export const NODE_MERGE_FT = 0.75

export function resolveWalls(nodes: PlanNode[], walls: PlanWall[]): ResolvedWall[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const resolved: ResolvedWall[] = []
  for (const wall of walls) {
    const start = byId.get(wall.startNodeId)
    const end = byId.get(wall.endNodeId)
    if (!start || !end) continue
    resolved.push({
      ...wall,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      lengthFt: Math.round(Math.hypot(end.x - start.x, end.y - start.y) * 100) / 100,
    })
  }
  return resolved
}

/** Total wall length — what baseboard, trim and flood cuts are billed against. */
export function totalWallLengthFt(walls: ResolvedWall[]): number {
  return Math.round(walls.reduce((sum, w) => sum + w.lengthFt, 0) * 100) / 100
}

/** Snap a dragged point to the working grid. */
export function snapToGrid(value: number, grid = NODE_SNAP_FT): number {
  return Math.round(value / grid) * grid
}

/**
 * An existing node close enough to reuse. Drawing a wall that ends on another
 * wall's corner should join them, not leave two nodes a few inches apart.
 */
export function findNodeNear(
  nodes: PlanNode[],
  x: number,
  y: number,
  tolerance = NODE_MERGE_FT,
): PlanNode | null {
  let best: { node: PlanNode; distance: number } | null = null
  for (const node of nodes) {
    const distance = Math.hypot(node.x - x, node.y - y)
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { node, distance }
    }
  }
  return best?.node ?? null
}

/** Closest point on a wall to an arbitrary point, and how far along it lies. */
export function projectOntoWall(
  wall: ResolvedWall,
  x: number,
  y: number,
): { distanceFt: number; offsetFt: number } {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    return { distanceFt: Math.hypot(x - wall.start.x, y - wall.start.y), offsetFt: 0 }
  }
  const t = Math.max(0, Math.min(1, ((x - wall.start.x) * dx + (y - wall.start.y) * dy) / lengthSq))
  const closest = { x: wall.start.x + dx * t, y: wall.start.y + dy * t }
  return {
    distanceFt: Math.round(Math.hypot(x - closest.x, y - closest.y) * 100) / 100,
    offsetFt: Math.round(t * wall.lengthFt * 100) / 100,
  }
}

/**
 * The wall nearest a tap. A door can only be placed on a wall, which is exactly
 * the guarantee the old room-edge version failed to give.
 */
export function wallNear(
  walls: ResolvedWall[],
  x: number,
  y: number,
  maxDistanceFt = 2,
): { wall: ResolvedWall; offsetFt: number; distanceFt: number } | null {
  let best: { wall: ResolvedWall; offsetFt: number; distanceFt: number } | null = null
  for (const wall of walls) {
    const hit = projectOntoWall(wall, x, y)
    if (hit.distanceFt <= maxDistanceFt && (!best || hit.distanceFt < best.distanceFt)) {
      best = { wall, offsetFt: hit.offsetFt, distanceFt: hit.distanceFt }
    }
  }
  return best
}

/** Where an opening sits in plan coordinates, for drawing it on its wall. */
export function openingPosition(
  wall: ResolvedWall,
  opening: WallOpening,
): { x: number; y: number; angleDeg: number } | null {
  if (wall.lengthFt <= 0) return null
  const t = Math.max(0, Math.min(1, opening.offsetFt / wall.lengthFt))
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
    angleDeg:
      (Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180) / Math.PI,
  }
}

/**
 * Walls that enclose an area, as ordered loops of node ids.
 *
 * Rooms are derived from this rather than stored, which is what makes a pony
 * wall possible: a wall belonging to no loop is simply left out.
 */
export function findLoops(walls: ResolvedWall[]): string[][] {
  const adjacency = new Map<string, Array<{ nodeId: string; wallId: string }>>()
  for (const wall of walls) {
    if (!adjacency.has(wall.startNodeId)) adjacency.set(wall.startNodeId, [])
    if (!adjacency.has(wall.endNodeId)) adjacency.set(wall.endNodeId, [])
    adjacency.get(wall.startNodeId)!.push({ nodeId: wall.endNodeId, wallId: wall.id })
    adjacency.get(wall.endNodeId)!.push({ nodeId: wall.startNodeId, wallId: wall.id })
  }

  const loops: string[][] = []
  const seen = new Set<string>()

  for (const startNode of adjacency.keys()) {
    if (seen.has(startNode)) continue

    // Depth-first walk looking for a path back to where it started.
    const stack: Array<{ node: string; path: string[]; usedWalls: Set<string> }> = [
      { node: startNode, path: [startNode], usedWalls: new Set() },
    ]

    while (stack.length > 0) {
      const current = stack.pop()!
      for (const edge of adjacency.get(current.node) ?? []) {
        if (current.usedWalls.has(edge.wallId)) continue
        if (edge.nodeId === startNode && current.path.length >= 3) {
          loops.push([...current.path])
          current.path.forEach((n) => seen.add(n))
          stack.length = 0
          break
        }
        if (current.path.includes(edge.nodeId)) continue
        if (current.path.length > 12) continue // a room is not a maze
        stack.push({
          node: edge.nodeId,
          path: [...current.path, edge.nodeId],
          usedWalls: new Set([...current.usedWalls, edge.wallId]),
        })
      }
    }
  }

  return loops
}

/** Shoelace area of a node loop. */
export function loopAreaSqft(nodes: PlanNode[], loop: string[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const points = loop.map((id) => byId.get(id)).filter(Boolean) as PlanNode[]
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.round(Math.abs(sum / 2) * 100) / 100
}

/** A rectangular room as four nodes and four walls, for the quick-add path. */
export function rectangleWalls(
  originX: number,
  originY: number,
  lengthFt: number,
  widthFt: number,
  makeId: (index: number) => string,
): { nodes: PlanNode[]; walls: Array<{ startNodeId: string; endNodeId: string }> } {
  const nodes: PlanNode[] = [
    { id: makeId(0), x: originX, y: originY },
    { id: makeId(1), x: originX + lengthFt, y: originY },
    { id: makeId(2), x: originX + lengthFt, y: originY + widthFt },
    { id: makeId(3), x: originX, y: originY + widthFt },
  ]
  const walls = nodes.map((node, index) => ({
    startNodeId: node.id,
    endNodeId: nodes[(index + 1) % nodes.length].id,
  }))
  return { nodes, walls }
}

/**
 * Where the end node has to move for a wall to be exactly `lengthFt` long,
 * keeping its direction and its start node fixed.
 *
 * Typing an exact length is how a plan gets accurate: dragging gets it close,
 * and the number gets it right. Nothing here should only be settable by dragging.
 */
export function endPointForLength(
  wall: ResolvedWall,
  lengthFt: number,
): { x: number; y: number } | null {
  const target = Number(lengthFt)
  if (!Number.isFinite(target) || target <= 0) return null

  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const current = Math.hypot(dx, dy)

  // A zero-length wall has no direction to preserve; extend east by convention.
  if (current === 0) {
    return { x: Math.round((wall.start.x + target) * 100) / 100, y: wall.start.y }
  }

  return {
    x: Math.round((wall.start.x + (dx / current) * target) * 100) / 100,
    y: Math.round((wall.start.y + (dy / current) * target) * 100) / 100,
  }
}

/** Length of a wall being dragged, for the live readout. */
export function draftLengthFt(segment: {
  x1: number
  y1: number
  x2: number
  y2: number
}): number {
  return Math.round(Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) * 10) / 10
}

/** Feet as builders say them: 12′ 6″ rather than 12.5. */
export function formatFeetInches(feet: number): string {
  if (!Number.isFinite(feet)) return '—'
  const whole = Math.floor(Math.abs(feet))
  const inches = Math.round((Math.abs(feet) - whole) * 12)
  if (inches === 12) return `${whole + 1}′`
  return inches === 0 ? `${whole}′` : `${whole}′ ${inches}″`
}

/** Is a point inside a closed loop of nodes? Even-odd rule. */
export function loopContains(
  nodes: PlanNode[],
  loop: string[],
  x: number,
  y: number,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const points = loop.map((id) => byId.get(id)).filter(Boolean) as PlanNode[]
  if (points.length < 3) return false

  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * The enclosed room under a point, as the set of node ids to move together.
 * Dragging a room has to move every corner of it at once, or the walls tear
 * apart.
 */
export function loopAt(
  nodes: PlanNode[],
  walls: ResolvedWall[],
  x: number,
  y: number,
): string[] | null {
  const loops = findLoops(walls)
  // Smallest enclosing loop first, so an inner room wins over an outer one.
  const containing = loops
    .filter((loop) => loopContains(nodes, loop, x, y))
    .sort((a, b) => loopAreaSqft(nodes, a) - loopAreaSqft(nodes, b))
  return containing[0] ?? null
}

/** Offset a set of nodes, for dragging a whole room. */
export function offsetNodes(
  nodes: PlanNode[],
  ids: string[],
  dx: number,
  dy: number,
): PlanNode[] {
  const moving = new Set(ids)
  return nodes.map((node) =>
    moving.has(node.id)
      ? {
          ...node,
          x: Math.round((node.x + dx) * 100) / 100,
          y: Math.round((node.y + dy) * 100) / 100,
        }
      : node,
  )
}
