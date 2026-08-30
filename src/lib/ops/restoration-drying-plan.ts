/**
 * Turn measured rooms into a starting drying plan.
 *
 * IMPORTANT: the factors below are commonly used industry rules of thumb, not
 * quoted IICRC S500 values. They exist to replace a blank field with a sensible
 * starting number that Charles adjusts — the equipment actually billed is
 * whatever is placed on the job, never what this function suggests. If Charles
 * gives exact factors he works to, change them here.
 */

export type AreaInput = {
  affectedSqft: number | null
  ceilingHeightFt: number | null
}

export type DryingSuggestion = {
  totalAffectedSqft: number
  totalCubicFt: number
  airMovers: number
  dehumidifierPintsPerDay: number
  suggestedDehu: 'DHM>' | 'DHM>>' | null
  dehuCount: number
}

/** One air mover per this many square feet of affected floor. */
export const SQFT_PER_AIR_MOVER = 60

/** Pints-per-day of dehumidification per cubic foot, for a Class 2 loss. */
export const CUBIC_FT_PER_PPD = 45

/** Nameplate capacity of the two dehumidifiers Charles actually runs. */
const SMALL_DEHU_PPD = 90 // DHM>  (70-109 ppd band)
const LARGE_DEHU_PPD = 130 // DHM>> (110-159 ppd band)

export function buildDryingPlan(areas: AreaInput[]): DryingSuggestion {
  let totalAffectedSqft = 0
  let totalCubicFt = 0

  for (const area of areas) {
    const sqft = Number(area.affectedSqft ?? 0)
    if (!Number.isFinite(sqft) || sqft <= 0) continue
    const height = Number(area.ceilingHeightFt ?? 8) || 8
    totalAffectedSqft += sqft
    totalCubicFt += sqft * height
  }

  totalAffectedSqft = Math.round(totalAffectedSqft * 100) / 100
  totalCubicFt = Math.round(totalCubicFt)

  const airMovers =
    totalAffectedSqft > 0 ? Math.max(1, Math.ceil(totalAffectedSqft / SQFT_PER_AIR_MOVER)) : 0

  const dehumidifierPintsPerDay =
    totalCubicFt > 0 ? Math.ceil(totalCubicFt / CUBIC_FT_PER_PPD) : 0

  let suggestedDehu: DryingSuggestion['suggestedDehu'] = null
  let dehuCount = 0
  if (dehumidifierPintsPerDay > 0) {
    // Prefer the large unit once the small one would be at its limit, rather
    // than stacking small units.
    if (dehumidifierPintsPerDay <= SMALL_DEHU_PPD) {
      suggestedDehu = 'DHM>'
      dehuCount = 1
    } else {
      suggestedDehu = 'DHM>>'
      dehuCount = Math.ceil(dehumidifierPintsPerDay / LARGE_DEHU_PPD)
    }
  }

  return {
    totalAffectedSqft,
    totalCubicFt,
    airMovers,
    dehumidifierPintsPerDay,
    suggestedDehu,
    dehuCount,
  }
}
