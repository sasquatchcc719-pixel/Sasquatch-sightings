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
  placed_at: string
  removed_at: string | null
}

export type UnitLine = {
  id: string
  placedAt: string
  removedAt: string | null
  hours: number
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
 * Days a single unit has accrued.
 *
 * Billed in 24-hour periods from when it was set down, with a one-hour grace so
 * a job that runs three days and ten minutes is not charged four. Never less
 * than one: equipment set down and pulled the same afternoon still cost a day's
 * rental and a trip.
 */
export function unitDays(placedAt: string, removedAt: string | null, now: Date): number {
  const start = new Date(placedAt).getTime()
  const end = removedAt ? new Date(removedAt).getTime() : now.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1
  const hours = (end - start) / 3_600_000
  return Math.max(1, Math.ceil((hours - 1) / 24))
}

export function equipmentLedger(placements: Placement[], now: Date): LedgerLine[] {
  const byCode = new Map<string, LedgerLine>()

  for (const placement of placements) {
    const line =
      byCode.get(placement.catalog_code) ??
      { code: placement.catalog_code, running: 0, pulled: 0, unitDays: 0, units: [] }

    const days = unitDays(placement.placed_at, placement.removed_at, now)
    const end = placement.removed_at ? new Date(placement.removed_at) : now
    const hours =
      (end.getTime() - new Date(placement.placed_at).getTime()) / 3_600_000

    line.units.push({
      id: placement.id,
      placedAt: placement.placed_at,
      removedAt: placement.removed_at,
      hours: Math.round(hours * 10) / 10,
      days,
    })
    line.unitDays += days
    if (placement.removed_at) line.pulled += 1
    else line.running += 1

    byCode.set(placement.catalog_code, line)
  }

  return [...byCode.values()].map((line) => ({
    ...line,
    units: line.units.sort(
      (a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime(),
    ),
  }))
}

/**
 * The moment to compute a ledger against, for the visit being viewed.
 *
 * Equipment accrues continuously, so "what does this job owe" and "what did it
 * owe on Monday" are different questions and the screen was only ever answering
 * the first. Looking back at Monday showed Wednesday's total, which hides the
 * daily climb that is the whole shape of a drying job.
 *
 * End of the visit's day, never later than now — a visit in the future has
 * accrued nothing yet.
 */
export function ledgerAsOf(visitDate: string | null, now: Date): Date {
  if (!visitDate) return now
  const endOfDay = new Date(`${visitDate}T23:59:59`)
  if (Number.isNaN(endOfDay.getTime())) return now
  return endOfDay > now ? now : endOfDay
}

/** Units that had actually been placed by that moment. */
export function placementsAsOf(placements: Placement[], asOf: Date): Placement[] {
  return placements.filter((p) => new Date(p.placed_at).getTime() <= asOf.getTime())
}
