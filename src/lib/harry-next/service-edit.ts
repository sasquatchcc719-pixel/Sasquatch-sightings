/**
 * Harry (next) — deterministic service-edit logic.
 *
 * This is the heart of slice 1, and it is intentionally PURE: no database, no
 * model, no network. Given the job's current line items and a typed intent, it
 * computes the new line items as a *diff* (never a full-array rebuild), the real
 * new total, and a customer reply whose numbers come straight from that
 * computation.
 *
 * The model is not in this file. It cannot reach a price, a quantity, or a line
 * item here. That is what makes the failure modes in HARRY-REBUILD-PLAN.md
 * (clusters C and D — ref collapse and blind numbers) impossible rather than
 * merely guarded.
 */
import type { RemoveServiceIntent } from './intents'

/** The $150 minimum dispatch fee. Mirrors the ops invoice business rule. */
export const MIN_JOB_TOTAL = 150

/**
 * One line on a job. `serviceCatalogItemId` is what lets us identify a line
 * exactly (the old schema column the old code never populated). `unitPrice` and
 * `quantity` are the source of truth for money — nothing else computes a total.
 */
export type LineItem = {
  serviceCatalogItemId: string | null
  nameSnapshot: string
  quantity: number
  unitPrice: number
  durationMinutes: number
  bufferMinutes: number
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function lineTotal(line: LineItem): number {
  return round2(line.unitPrice * line.quantity)
}

export function jobTotal(lines: LineItem[]): number {
  return round2(lines.reduce((sum, line) => sum + lineTotal(line), 0))
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find every current line whose name contains the customer's phrase. Code does
 * this, not the model. Returns indexes so the caller can require a unique match
 * before changing anything.
 */
export function findMatchingLines<T extends LineItem>(
  lines: T[],
  match: string,
): number[] {
  const needle = normalize(match)
  if (!needle) return []
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => normalize(line.nameSnapshot).includes(needle))
    .map(({ index }) => index)
}

export type RemoveServicePlan<T extends LineItem = LineItem> =
  | {
      status: 'ok'
      removed: T
      newLines: T[]
      previousTotal: number
      newTotal: number
      belowMinimum: boolean
    }
  | {
      status: 'not_found'
      match: string
    }
  | {
      status: 'ambiguous'
      match: string
      candidates: string[]
    }

/**
 * Plan a service removal as a diff. Removes exactly the one matched line and
 * leaves every other line byte-for-byte unchanged. If the phrase matches zero or
 * multiple lines, it refuses to guess and reports back for clarification — the
 * data is never touched in that case.
 */
export function planRemoveService<T extends LineItem>(
  lines: T[],
  intent: RemoveServiceIntent,
): RemoveServicePlan<T> {
  const matches = findMatchingLines(lines, intent.match)

  if (matches.length === 0) {
    return { status: 'not_found', match: intent.match }
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      match: intent.match,
      candidates: matches.map((index) => lines[index].nameSnapshot),
    }
  }

  const removeIndex = matches[0]
  const removed = lines[removeIndex]
  const newLines = lines.filter((_, index) => index !== removeIndex)
  const previousTotal = jobTotal(lines)
  const newTotal = jobTotal(newLines)

  return {
    status: 'ok',
    removed,
    newLines,
    previousTotal,
    newTotal,
    belowMinimum: newTotal < MIN_JOB_TOTAL,
  }
}

function money(value: number): string {
  return value.toFixed(2)
}

function greeting(firstName?: string | null): string {
  const name = (firstName || '').trim()
  return name ? `, ${name}` : ''
}

/**
 * Render the customer-facing reply for an applied removal. Every number in this
 * string is `plan.newTotal` — computed above, never supplied by the model. The
 * below-minimum branch is honest: it states the real total, says it's under the
 * minimum, and asks. It never claims the job is "all set" and never silently
 * pads quantities to clear the floor (the $1,600 failure).
 */
export function composeRemovalReply(params: {
  removedName: string
  newTotal: number
  belowMinimum: boolean
  firstName?: string | null
}): string {
  const hi = greeting(params.firstName)
  if (params.belowMinimum) {
    return (
      `I've taken the ${params.removedName} off${hi}. ` +
      `That brings the cleaning total to $${money(params.newTotal)}, which is below our $${MIN_JOB_TOTAL} minimum. ` +
      `Would you like to add another area, or should we keep it at the $${MIN_JOB_TOTAL} minimum?`
    )
  }
  return (
    `Got it${hi}! I've removed the ${params.removedName}. ` +
    `Your updated total is $${money(params.newTotal)}.`
  )
}

export function renderRemovalReply<T extends LineItem>(
  plan: Extract<RemoveServicePlan<T>, { status: 'ok' }>,
  firstName?: string | null,
): string {
  return composeRemovalReply({
    removedName: plan.removed.nameSnapshot,
    newTotal: plan.newTotal,
    belowMinimum: plan.belowMinimum,
    firstName,
  })
}
