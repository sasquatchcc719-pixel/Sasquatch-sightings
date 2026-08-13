/**
 * Shared fiber gate logic.
 *
 * Both the tech job screen and the admin invoice screen capture a customer
 * signature, and both must gate on this. Keeping the rule here means the two
 * screens cannot drift apart — the first version of this feature gated only
 * the tech screen, which is not the one the owner works from.
 */

import { requiresFiberCheck } from './requires-check'
import type { FiberVerdict } from './types'

export type GateLine = {
  id: string
  name: string
  /** A line can cover several physical pieces; each needs its own check. */
  quantity: number
  catalogCategory?: string | null
  /** Catalog pricing unit — decides whether quantity counts pieces at all. */
  catalogPricingUnit?: string | null
  excludedAt?: string | null
}

/**
 * Quantity only counts separately identifiable pieces on rug lines, and even
 * then not always. "Custom-Size Area Rug Cleaning" is priced per square foot,
 * so quantity 600 is 600 sqft of ONE rug, not 600 rugs. Getting this wrong
 * would demand hundreds of checks and make the gate unusable.
 */
const PIECE_COUNTED_UNITS = new Set(['per rug', 'fixed'])

/** Guard against a typo in quantity demanding an absurd number of checks. */
const MAX_UNITS = 12

/** Hand-typed upholstery lines, which carry no catalog category. */
const UPHOLSTERY_NAME =
  /\b(sofa|couch|sectional|love\s*seat|loveseat|recliner|armchair|arm\s*chair|chair|ottoman|mattress|cushion|settee|chaise|headboard|upholster\w*)\b/i

export function unitsForLine(line: {
  name?: string
  quantity: number
  catalogCategory?: string | null
  catalogPricingUnit?: string | null
}): number {
  // Upholstery is one identifiable piece per line. Quantity there counts seats
  // on one sectional, or chairs in one matching set — all the same fabric. Two
  // different couches get two line items, which is how Charles enters them.
  //
  // This has to be a POSITIVE test. fiberItemKind() defaults anything it cannot
  // classify to 'upholstery', and routing unknown items down this branch would
  // quietly drop a multi-rug line to a single check.
  const category = (line.catalogCategory ?? '').trim().toLowerCase()
  const isUpholstery =
    category === 'upholstery cleaning' ||
    (!category && UPHOLSTERY_NAME.test(line.name ?? ''))
  if (isUpholstery) return 1

  const unit = (line.catalogPricingUnit ?? '').trim().toLowerCase()
  // No catalog link (manually typed lines) falls back to counting pieces,
  // since those are entered by hand as "2 rugs" rather than as an area.
  if (unit && !PIECE_COUNTED_UNITS.has(unit)) return 1
  const quantity = Math.floor(Number(line.quantity) || 1)
  if (!Number.isFinite(quantity) || quantity < 1) return 1
  return Math.min(MAX_UNITS, quantity)
}

export type GateCheck = {
  appointmentLineItemId: string | null
  unitIndex: number
  verdict: FiberVerdict
}

export type LineGateStatus = {
  line: GateLine
  /** How many physical pieces this line covers. */
  unitsRequired: number
  /** Unit numbers (1-based) that still need a check. */
  missingUnits: number[]
  checkedUnits: number
  complete: boolean
}

/** Per-line gate status for every line that needs identification. */
export function fiberGateStatus(
  lines: GateLine[],
  checks: GateCheck[],
): LineGateStatus[] {
  return lines
    .filter(
      (line) =>
        requiresFiberCheck({
          name: line.name,
          catalogCategory: line.catalogCategory,
        }) && !line.excludedAt,
    )
    .map((line) => {
      const unitsRequired = unitsForLine(line)
      const done = new Set(
        checks
          .filter((check) => check.appointmentLineItemId === line.id)
          .map((check) => check.unitIndex),
      )
      const missingUnits: number[] = []
      for (let unit = 1; unit <= unitsRequired; unit += 1) {
        if (!done.has(unit)) missingUnits.push(unit)
      }
      return {
        line,
        unitsRequired,
        missingUnits,
        checkedUnits: unitsRequired - missingUnits.length,
        complete: missingUnits.length === 0,
      }
    })
}

/** True when a signature may be captured. */
export function signatureAllowed(
  lines: GateLine[],
  checks: GateCheck[],
): boolean {
  return fiberGateStatus(lines, checks).every((status) => status.complete)
}

/** Human-readable list of what is still outstanding, for the blocked message. */
export function blockedSummary(
  lines: GateLine[],
  checks: GateCheck[],
): string[] {
  return fiberGateStatus(lines, checks)
    .filter((status) => !status.complete)
    .map((status) =>
      status.unitsRequired > 1
        ? `${status.line.name} (${status.checkedUnits} of ${status.unitsRequired} identified)`
        : status.line.name,
    )
}

/** Label for one physical piece, e.g. "Area Rug 8x11 — #2 of 3". */
export function unitLabel(
  name: string,
  unitIndex: number,
  unitsRequired: number,
): string {
  return unitsRequired > 1 ? `${name} — #${unitIndex} of ${unitsRequired}` : name
}
