/**
 * Where a piece of equipment stood on a given visit.
 *
 * Air movers get moved. That is most of what a monitor visit is: the closet
 * stalled, so two fans come off the wall and point into it. A placement carried
 * a single position, so each move erased the last one and the drying log could
 * not show that the work had been done.
 *
 * **This is the opposite of how readings behave, deliberately.** A reading not
 * taken on a visit does not exist and must show blank. A fan not moved on a
 * visit is still exactly where it was, so a visit with no entry inherits the
 * most recent position before it.
 */

export type EquipmentPosition = {
  placement_id: string
  appointment_id: string
  map_x: number | null
  map_y: number | null
  /**
   * The DAY of the visit this move was made on — not when the row was written.
   *
   * Ordering by the write time had the same fault that broke readings and
   * equipment billing: a Saturday move entered on Monday sorts as Monday, so
   * the plan would show it on the wrong days.
   */
  visit_date: string | null
  moved_at: string
}

export type PositionedPlacement = {
  id: string
  map_x: number | null
  map_y: number | null
  placed_at: string
}

/**
 * The position to draw for this unit on this visit.
 *
 * Falls back through: a move recorded on this visit, then the latest move on or
 * before this visit's day, then where it was first set down.
 */
export function positionForVisit(
  placement: PositionedPlacement,
  positions: EquipmentPosition[],
  visit: { id: string | null; appointment_date: string | null },
): { x: number | null; y: number | null; movedOnThisVisit: boolean } {
  const mine = positions.filter((p) => p.placement_id === placement.id)

  const onThisVisit = mine.find((p) => p.appointment_id === visit.id)
  if (onThisVisit) {
    return { x: onThisVisit.map_x, y: onThisVisit.map_y, movedOnThisVisit: true }
  }

  if (visit.appointment_date) {
    const earlier = mine
      .filter((p) => (p.visit_date ?? '') !== '' && p.visit_date! <= visit.appointment_date!)
      .sort((a, b) => (b.visit_date ?? '').localeCompare(a.visit_date ?? ''))[0]
    if (earlier) {
      return { x: earlier.map_x, y: earlier.map_y, movedOnThisVisit: false }
    }
  }

  return { x: placement.map_x, y: placement.map_y, movedOnThisVisit: false }
}

/** How many units were moved on a visit — worth stating in the daily note. */
export function movesOnVisit(
  positions: EquipmentPosition[],
  visitId: string | null,
): number {
  if (!visitId) return 0
  return positions.filter((p) => p.appointment_id === visitId).length
}
