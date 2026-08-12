/**
 * Fiber check types.
 *
 * A fiber check is the record that a rug or upholstery item was identified
 * before it was cleaned. It exists because on 2026-08-12 a 100% viscose Surya
 * rug was wet cleaned and destroyed — the fiber was never identified, and the
 * Foreman assistant (which already carries a hardcoded viscose guardrail) was
 * never opened for that job.
 */

/** What the tech is allowed to do with the item. */
export type FiberVerdict =
  /** Clean normally. */
  | 'go'
  /** Conservative protocol only: low moisture, neutral pH, no heat, fast dry. */
  | 'low_moisture'
  /** Do not introduce water. Exclude the item or refer it out. */
  | 'do_not_wet_clean'

/**
 * How the verdict was reached. `stop_list` is a deterministic keyword match on
 * the care tag and is never overridden by the model.
 */
export type FiberDeterminedBy =
  | 'stop_list'
  | 'ai_vision'
  | 'burn_test'
  | 'tech_override'

export type FiberConfidence = 'high' | 'medium' | 'low'

/** Result of the three-bucket burn test, for items with no care tag. */
export type BurnResult =
  | 'melts'
  | 'burning_hair'
  | 'burns_like_paper'
  | 'not_tested'

export type FiberCheckResult = {
  verdict: FiberVerdict
  determinedBy: FiberDeterminedBy
  fiber: string | null
  confidence: FiberConfidence
  warnings: string[]
  recommendedMethod: string | null
  /** The single next test to run, when confidence is too low to proceed. */
  nextTest: string | null
  /** Plain-language summary shown to the tech on the phone. */
  summary: string
}

export type FiberCheckRecord = {
  id: string
  appointmentId: string
  appointmentLineItemId: string | null
  itemLabel: string
  verdict: FiberVerdict
  determinedBy: FiberDeterminedBy
  fiber: string | null
  confidence: FiberConfidence | null
  hasTag: boolean
  tagText: string | null
  burnResult: BurnResult | null
  photoUrls: string[]
  warnings: string[]
  recommendedMethod: string | null
  checkedByLabel: string | null
  createdAt: string
}

/** Verdicts that block wet cleaning and therefore require a decision. */
export const BLOCKING_VERDICTS: FiberVerdict[] = ['do_not_wet_clean']

export function verdictLabel(verdict: FiberVerdict): string {
  switch (verdict) {
    case 'go':
      return 'Safe to clean'
    case 'low_moisture':
      return 'Low moisture only'
    case 'do_not_wet_clean':
      return 'DO NOT WET CLEAN'
  }
}
