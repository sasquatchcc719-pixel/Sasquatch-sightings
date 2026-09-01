/**
 * What each piece of equipment has actually accrued.
 *
 * The screen said "8 × 1d" beside "6 running", which reads as a contradiction
 * and is not one: eight fans have accrued a day each, and six of them are still
 * on the job. Charles pulled two, watched the running count drop and the money
 * stay put, and reasonably concluded the arithmetic was broken.
 *
 * It was not. **A fan that ran today is billed for today even after it is
 * pulled** — that is the whole point of billing from timestamps. What was broken
 * is that nothing on the screen said so, and there was no way to check it.
 *
 * This produces the per-unit ledger behind the total, so the number can be
 * audited rather than trusted.
 */

export type Placement = {
  id: string
  catalog_code: string
  /** The DAY it was set down. Not when the row was typed. */
  placed_on: string
  removed_on: string | null
}

export type UnitLine = {
  id: string
  placedOn: string
  removedOn: string | null
  days: number
}

export type LedgerLine = {
  code: string
  running: number
  pulled: number
  unitDays: number
  units: UnitLine[]
}

/**
 * A running unit is assumed in for the planned three days — the same default
 * the estimate quotes and the monitor schedule starts from.
 *
 * Charles: *"default equipment to three days on day one... but if we pull
 * equipment, it needs to calculate the final total."* So day one already reads
 * eight fans x 3 = 24, agreeing with the estimate, instead of a total that
 * creeps up and matches nothing until the job is over.
 */
export const PLANNED_EQUIPMENT_DAYS = 3

/**
 * Days a single unit bills, counted on the calendar.
 *
 * - **Pulled**: the nights it actually sat there, and only those — set Saturday,
 *   pulled Tuesday, is three; same-day is one, because that still cost a day's
 *   rental and a trip.
 * - **Still running**: at least the planned three days, more once the job
 *   outruns the plan. At close every unit is pulled, so an invoice always bills
 *   actual days.
 *
 * Deliberately NOT elapsed hours. The data is routinely entered after the fact,
 * so a timestamp records when Charles reached a keyboard, and billing from it
 * charged one day for fans that had been running since Saturday.
 */
export function unitDays(
  placedOn: string,
  removedOn: string | null,
  today: string,
  plannedDays: number = PLANNED_EQUIPMENT_DAYS,
): number {
  const start = Date.parse(`${placedOn}T12:00:00Z`)
  const end = Date.parse(`${removedOn ?? today}T12:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1
  const days = Math.round((end - start) / 86_400_000)
  if (removedOn) return Math.max(1, days)
  return Math.max(1, days, plannedDays)
}

export function equipmentLedger(placements: Placement[], today: string): LedgerLine[] {
  const byCode = new Map<string, LedgerLine>()

  for (const placement of placements) {
    const line =
      byCode.get(placement.catalog_code) ??
      { code: placement.catalog_code, running: 0, pulled: 0, unitDays: 0, units: [] }

    const days = unitDays(placement.placed_on, placement.removed_on, today)

    line.units.push({
      id: placement.id,
      placedOn: placement.placed_on,
      removedOn: placement.removed_on,
      days,
    })
    line.unitDays += days
    if (placement.removed_on) line.pulled += 1
    else line.running += 1

    byCode.set(placement.catalog_code, line)
  }

  return [...byCode.values()].map((line) => ({
    ...line,
    units: line.units.sort((a, b) => a.placedOn.localeCompare(b.placedOn)),
  }))
}

/**
 * The day to compute a ledger against, for the visit being viewed.
 *
 * Looking back at Monday should show what the job owed on Monday, not today's
 * total — otherwise the daily climb, which is the shape of a drying job, is
 * invisible. Never later than today: a visit in the future has accrued nothing.
 */
export function ledgerAsOf(visitDate: string | null, today: string): string {
  if (!visitDate) return today
  return visitDate > today ? today : visitDate
}

/** Units that had actually been set down by that day. */
export function placementsAsOf(placements: Placement[], asOf: string): Placement[] {
  return placements.filter((p) => p.placed_on <= asOf)
}

export type LedgerBatch = {
  code: string
  placedOn: string
  removedOn: string | null
  units: number
  days: number
  unitDays: number
  ids: string[]
}

/**
 * Units that went in together and came out together.
 *
 * Equipment is placed in batches — eight fans at once — and the day they went in
 * is the thing most often wrong, because it was typed days later. Grouping lets
 * one correction fix the batch; correcting eight fans one at a time is not
 * something anybody does twice.
 */
export function ledgerBatches(placements: Placement[], today: string): LedgerBatch[] {
  const batches = new Map<string, LedgerBatch>()

  for (const placement of placements) {
    const key = `${placement.catalog_code}|${placement.placed_on}|${placement.removed_on ?? ''}`
    const days = unitDays(placement.placed_on, placement.removed_on, today)
    const batch =
      batches.get(key) ??
      {
        code: placement.catalog_code,
        placedOn: placement.placed_on,
        removedOn: placement.removed_on,
        units: 0,
        days,
        unitDays: 0,
        ids: [],
      }
    batch.units += 1
    batch.unitDays += days
    batch.ids.push(placement.id)
    batches.set(key, batch)
  }

  return [...batches.values()].sort(
    (a, b) => a.code.localeCompare(b.code) || a.placedOn.localeCompare(b.placedOn),
  )
}
