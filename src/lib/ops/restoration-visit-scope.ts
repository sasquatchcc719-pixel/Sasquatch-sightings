/**
 * What a reading screen should show when you are standing on one visit.
 *
 * The point of a monitor visit is that the numbers fall: 30% on the mitigation
 * day, 24% on Monday, 14% on Tuesday. So the screen has to answer two different
 * questions without confusing them:
 *
 *   - **What did we read on THIS visit?** — the box you type into, and the one
 *     you correct. Empty when this visit has no reading yet.
 *   - **What did the material read as of this visit?** — what the map should
 *     colour, so opening Saturday does not paint Tuesday's numbers onto it.
 *
 * Showing every reading regardless of the selected visit made a single reading
 * look like it belonged to every day at once: Charles changed the mitigation
 * day to 40%, clicked to the first monitor, and saw 40% there too.
 */

export type TimedReading = {
  id: string
  value: number
  taken_at: string
  appointment_id?: string | null
}

/** The reading logged against this visit, if one was. */
export function readingForVisit<T extends TimedReading>(
  readings: T[],
  visitId: string | null,
): T | null {
  if (!visitId) return null
  const mine = readings
    .filter((r) => r.appointment_id === visitId)
    .sort((a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime())
  return mine[0] ?? null
}

/**
 * What this material read as of the end of a given day — that visit's reading
 * if there is one, otherwise the most recent one before it.
 *
 * A point that was not re-read on Tuesday has not become unknown; it still
 * reads whatever it did on Monday, and the map should say so.
 */
export function readingAsOf<T extends TimedReading>(
  readings: T[],
  visitDate: string | null,
): T | null {
  if (!visitDate) {
    const all = [...readings].sort(
      (a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime(),
    )
    return all[0] ?? null
  }

  // End of the visit day, so a reading taken that afternoon still counts.
  const cutoff = new Date(`${visitDate}T23:59:59`).getTime()
  const upTo = readings
    .filter((r) => new Date(r.taken_at).getTime() <= cutoff)
    .sort((a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime())
  return upTo[0] ?? null
}
