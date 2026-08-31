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
 * Whether a visit has happened yet.
 *
 * A monitor scheduled for Tuesday has no readings on Monday, and the screen must
 * say that rather than showing blanks that look like an oversight — or, worse,
 * numbers carried forward from a day that WAS worked.
 */
export function visitIsFuture(
  visit: { appointment_date: string | null; status?: string | null } | null,
  today: string,
): boolean {
  if (!visit?.appointment_date) return false
  if (visit.status === 'completed') return false
  return visit.appointment_date > today
}
