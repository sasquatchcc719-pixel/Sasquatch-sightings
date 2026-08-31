/**
 * When a reading was taken.
 *
 * Not when it was typed. Readings get entered in the truck afterwards, or the
 * next morning, or on Monday for Sunday's monitor — and `now()` puts Sunday's
 * numbers on Monday, which collapses two visits into one column of the drying
 * chart and prints the wrong date in a report an adjuster reads.
 *
 * The visit is the fact. The moment of typing is an accident of when Charles
 * got to a keyboard.
 */
export function readingTimestamp(
  visit: { appointment_date: string | null; start_time: string | null } | null,
  now: Date,
): string {
  if (!visit?.appointment_date) return now.toISOString()

  const time = String(visit.start_time ?? '09:00:00').slice(0, 8)
  const stamped = new Date(`${visit.appointment_date}T${time}`)
  if (Number.isNaN(stamped.getTime())) return now.toISOString()

  // A visit still in the future cannot have produced a reading, so never stamp
  // one ahead of today — a chart running into next week reads as a bug.
  return (stamped > now ? now : stamped).toISOString()
}
