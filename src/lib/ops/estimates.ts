/**
 * Estimate helpers — measurement math and line-item normalization.
 *
 * An estimate line item is the same shape as an appointment line item, with
 * two extra dimension fields: `length_value` and `width_value`. When both are
 * present, `quantity` is usually derived from them (L×W for sqft pricing,
 * raw length for linear-foot pricing). The user can still override quantity
 * manually — typing in the quantity field clears L/W in the UI to avoid
 * silent drift between the stored quantity and what the dimensions imply.
 */

export type PricingUnit =
  | 'fixed'
  | 'per_sqft'
  | 'per_sq_ft'
  | 'sqft'
  | 'per_linear_foot'
  | 'linear_ft'
  | 'per_unit'
  | 'per_room'
  | 'per_step'
  | 'per_hour'
  | string

/**
 * Compute a quantity from measured dimensions.
 *
 *   computeAreaQuantity(10, 12, 'per_sqft')       => 120
 *   computeAreaQuantity(15.5, null, 'linear_ft')  => 15.5
 *   computeAreaQuantity(10, 12, 'fixed')          => null  (fixed prices don't use area)
 *   computeAreaQuantity(null, 12, 'per_sqft')     => null  (need both sides)
 *
 * Returns null if the inputs aren't enough to compute a value.
 */
export function computeAreaQuantity(
  length: number | null | undefined,
  width: number | null | undefined,
  unit: PricingUnit | null | undefined,
): number | null {
  const l =
    length == null || !Number.isFinite(Number(length)) ? null : Number(length)
  const w =
    width == null || !Number.isFinite(Number(width)) ? null : Number(width)

  if (isLinearUnit(unit)) {
    // Linear services only use one dimension — prefer length.
    if (l != null) return round2(l)
    if (w != null) return round2(w)
    return null
  }

  if (isAreaUnit(unit)) {
    if (l == null || w == null) return null
    return round2(l * w)
  }

  // For 'fixed' and unknown units, dimensions aren't meaningful.
  return null
}

/**
 * Human label for the area calc helper line underneath a line item row.
 *
 *   describeAreaCalc(10, 12, 'per_sqft')   => '10 × 12 = 120 sqft'
 *   describeAreaCalc(15, null, 'linear_ft')=> '15 linear ft'
 *   describeAreaCalc(null, null, 'fixed')  => null
 */
export function describeAreaCalc(
  length: number | null | undefined,
  width: number | null | undefined,
  unit: PricingUnit | null | undefined,
): string | null {
  const qty = computeAreaQuantity(length, width, unit)
  if (qty == null) return null

  if (isLinearUnit(unit)) {
    return `${formatNumber(qty)} linear ft`
  }
  if (isAreaUnit(unit)) {
    return `${formatNumber(Number(length))} × ${formatNumber(Number(width))} = ${formatNumber(qty)} sqft`
  }
  return null
}

export function isAreaUnit(unit: PricingUnit | null | undefined): boolean {
  if (!unit) return false
  const u = unit.toLowerCase()
  return (
    u === 'per_sqft' ||
    u === 'per_sq_ft' ||
    u === 'sqft' ||
    u === 'sq_ft' ||
    u === 'sq ft' ||
    u === 'square_feet' ||
    u === 'square feet'
  )
}

export function isLinearUnit(unit: PricingUnit | null | undefined): boolean {
  if (!unit) return false
  const u = unit.toLowerCase()
  return (
    u === 'per_linear_foot' ||
    u === 'linear_ft' ||
    u === 'linear_foot' ||
    u === 'per_linear_ft' ||
    u === 'linear feet'
  )
}

export function supportsDimensions(
  unit: PricingUnit | null | undefined,
): boolean {
  return isAreaUnit(unit) || isLinearUnit(unit)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(round2(n))
}
