/**
 * Which catalog lines are priced per day.
 *
 * Equipment on a water loss is rented, not sold: "eight air movers" is eight
 * units running some number of days, and the number Charles says out loud is
 * always the unit count, never the billable quantity. Every one of these needs
 * a second number before it prices correctly.
 *
 * The test is the DESCRIPTION and the unit, deliberately, not the code. The
 * codes lie: `DRY` is per-24-hour and `DRY+` is a different fan that is also
 * per-24-hour, while `DAILYMON` has "Daily" in its name and is billed by the
 * hour. The price sheet says what it charges for in words, so read the words.
 */

const PER_DAY = /per 24\b|24 ?hr|24[ -]hour|per day/i

export function isDailyBilled(description: string, unit?: string | null): boolean {
  if ((unit ?? '').toUpperCase() === 'DA') return true
  return PER_DAY.test(description ?? '')
}

/**
 * How many days a piece of equipment should be quoted for.
 *
 * It goes in on the mitigation day and comes out on the last monitor visit, so
 * the nights it runs is the monitor count — three monitors is three days, which
 * is what "eight fans for three days" means. A quote written before the visits
 * exist falls back to the same default the job itself uses.
 */
export const DEFAULT_DRYING_DAYS = 3

export function dryingDaysFromVisits(
  visits: Array<{ visit_type: string | null; status?: string | null }>,
): number {
  const monitors = visits.filter(
    (v) => v.visit_type === 'monitor' && v.status !== 'cancelled',
  ).length
  return monitors > 0 ? monitors : DEFAULT_DRYING_DAYS
}
