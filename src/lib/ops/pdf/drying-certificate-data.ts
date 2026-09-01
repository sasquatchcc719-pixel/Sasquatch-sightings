import { DRY_WITHIN } from '@/lib/ops/restoration-moisture'
import type { DryingReportData } from '@/lib/ops/pdf/drying-report'

/**
 * What the certificate page is allowed to say, derived from the drying log.
 *
 * Kept separate from the rendering so the one thing that matters — whether
 * every monitored point actually reached its goal — is a pure function that a
 * test can pin. A certificate that overstates is worse than no certificate.
 */

export type CertificatePoint = {
  label: string
  material: string | null
  dryStandard: number
  dryingGoal: number
  finalReading: number
  finalReadingAt: string
  met: boolean
}

export type DryingCertificate = {
  points: CertificatePoint[]
  /** Points with no dry standard recorded — excluded, but disclosed. */
  excludedPointCount: number
  metCount: number
  allMet: boolean
  firstVisitDate: string | null
  finalVisitDate: string | null
  /** True when the last visit was an actual `final` visit, not a monitor. */
  finalVisitIsFinal: boolean
  issuedOn: string | null
  category: number | null
}

/**
 * The completion benchmark for a point.
 *
 * **`DRY_WITHIN`, imported — not a number typed here.** The screen colours a
 * pin green at standard + 2 and the certificate must call that same point met,
 * or the office and the claim file disagree about the same reading. An earlier
 * draft of this document derived the goal as `standard × 1.10` and footnoted it
 * as an S500 "general-materials tolerance". No such tolerance exists in the
 * standard, and the multiplier is meaningless on the relative meter scales that
 * gypsum and concrete are read on — a fabricated citation on a document that
 * goes to a carrier.
 */
export function dryingGoalFor(dryStandard: number): number {
  return dryStandard + DRY_WITHIN
}

export function buildDryingCertificate(
  data: DryingReportData,
): DryingCertificate | null {
  const points: CertificatePoint[] = []
  let excludedPointCount = 0

  for (const point of data.readingPoints) {
    const last = point.readings[point.readings.length - 1]
    // A point with no standard, or no reading, cannot be attested to either
    // way. It is excluded from the table and disclosed in the note — dropping
    // it silently would misrepresent the scope of what was measured.
    if (point.dryStandard == null || last == null) {
      excludedPointCount += 1
      continue
    }
    const dryingGoal = dryingGoalFor(point.dryStandard)
    points.push({
      label: point.label,
      material: point.material,
      dryStandard: point.dryStandard,
      dryingGoal,
      finalReading: last.value,
      finalReadingAt: last.takenAt,
      // Compared on the same rounded values the document prints, so a row can
      // never read "9.9 <= 9.9" and be scored as a miss on hidden decimals.
      met: round1(last.value) <= round1(dryingGoal),
    })
  }

  // Nothing measurable was recorded, so there is nothing to put a name to.
  if (points.length === 0) return null

  const dated = [...data.visits]
    .filter((v) => v.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const lastVisit = dated[dated.length - 1] ?? null

  return {
    points,
    excludedPointCount,
    metCount: points.filter((p) => p.met).length,
    allMet: points.every((p) => p.met),
    firstVisitDate: dated[0]?.date ?? null,
    finalVisitDate: lastVisit?.date ?? null,
    finalVisitIsFinal: lastVisit?.type === 'final',
    issuedOn: data.closedAt ?? lastVisit?.date ?? null,
    category: data.loss.category,
  }
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}
