/**
 * Laying measured rooms out on a plan.
 *
 * Rooms are entered as length x width because that is how they are measured on
 * site with a laser. This turns those dimensions into rectangles placed on a
 * shared grid so equipment and reading points can be dropped in the right room,
 * without asking anyone to draw anything.
 */

export type PlanRoom = {
  id: string
  name: string
  lengthFt: number
  widthFt: number
}

export type PlacedRoom = PlanRoom & {
  x: number
  y: number
}

export type FloorPlanLayout = {
  rooms: PlacedRoom[]
  widthFt: number
  heightFt: number
}

const GAP_FT = 2

/**
 * Shelf packing, left to right, wrapping to a new row when the strip is full.
 * Deterministic — the same rooms always land in the same place, so a pin dropped
 * yesterday is still in the right room today.
 */
export function layoutFloorPlan(rooms: PlanRoom[], maxStripFt = 40): FloorPlanLayout {
  const placed: PlacedRoom[] = []
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const room of rooms) {
    const width = Number(room.lengthFt) > 0 ? Number(room.lengthFt) : 10
    const height = Number(room.widthFt) > 0 ? Number(room.widthFt) : 10

    // Wrap when this room would push past the strip, unless the row is empty —
    // an oversized room gets its own row rather than being dropped.
    if (cursorX > 0 && cursorX + width > maxStripFt) {
      cursorX = 0
      cursorY += rowHeight + GAP_FT
      rowHeight = 0
    }

    placed.push({ ...room, lengthFt: width, widthFt: height, x: cursorX, y: cursorY })
    cursorX += width + GAP_FT
    rowHeight = Math.max(rowHeight, height)
  }

  const widthFt = placed.reduce((max, r) => Math.max(max, r.x + r.lengthFt), 0)
  const heightFt = placed.reduce((max, r) => Math.max(max, r.y + r.widthFt), 0)

  return { rooms: placed, widthFt, heightFt }
}

/** Which room contains a point, in plan feet. Null when the tap missed. */
export function roomAtPoint(
  layout: FloorPlanLayout,
  xFt: number,
  yFt: number,
): PlacedRoom | null {
  for (const room of layout.rooms) {
    if (
      xFt >= room.x &&
      xFt <= room.x + room.lengthFt &&
      yFt >= room.y &&
      yFt <= room.y + room.widthFt
    ) {
      return room
    }
  }
  return null
}

/**
 * Convert a tap in screen pixels to plan feet.
 * `scale` is pixels per foot.
 */
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
