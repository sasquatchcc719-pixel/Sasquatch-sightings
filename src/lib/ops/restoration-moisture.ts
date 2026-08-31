/**
 * How wet is wet, per material.
 *
 * The colour on a reading pin has to mean something, and the honest way to do
 * that is the way the S500 does it: judge a reading against the DRY STANDARD for
 * that material — what unaffected material of the same kind reads in the same
 * building — not against an absolute number. A 15% reading is fine on framing
 * that reads 14% upstairs and alarming on drywall that reads 8%.
 *
 * The bands come from Charles's own practice, given for wood framing:
 *
 *   > "the baseline was 10% which I think is pretty common. Once we get it down
 *   > to 10% it would be in the green but anything even close to it so maybe
 *   > anything below like 12 or something would be green, and then something
 *   > between 12 and I don't know 25 would be yellow, and then above 25 red."
 *
 * Expressed as offsets from the standard that is dry ≤ +2, drying ≤ +15, wet
 * beyond — which reproduces his numbers exactly for a standard of 10 and
 * generalises to a material whose standard is not 10.
 *
 * Reference for the defaults below: normal drywall reads roughly 5–12% with 17%+
 * counted as elevated, and 2x framing normally sits around 10–15%; the S500 puts
 * softwood framing near 9.2% WME at 70°F/50% RH and defines an acceptable dry
 * standard relative to unaffected material rather than absolutely.
 */

export type MoistureBand = 'dry' | 'drying' | 'wet' | 'unknown'

/** Offsets from the dry standard, in the meter's own units. */
export const DRY_WITHIN = 2
export const DRYING_WITHIN = 15

/**
 * Where a material normally reads when it is dry.
 *
 * Only a starting number — the point's own standard is editable, and on a real
 * job it should come from a meter reading on unaffected material of the same
 * kind. Concrete and tile are deliberately absent: they are measured on a
 * different scale entirely (in-slab RH rather than %MC), and a number invented
 * for them would colour a pin confidently and wrongly.
 */
export const DEFAULT_DRY_STANDARD: Record<string, number> = {
  Drywall: 10,
  Plaster: 10,
  Framing: 10,
  Subfloor: 10,
  Hardwood: 10,
  Trim: 10,
  Cabinet: 10,
  Insulation: 10,
}

export function defaultDryStandard(material: string | null | undefined): number | null {
  if (!material) return null
  return DEFAULT_DRY_STANDARD[material] ?? null
}

/**
 * Where a reading sits against its dry standard.
 *
 * Returns 'unknown' rather than guessing when there is no standard or no
 * reading — a grey pin says "nobody has told me what dry is here", which is
 * true and useful. A green one would be a lie.
 */
export function moistureBand(
  value: number | null | undefined,
  dryStandard: number | null | undefined,
): MoistureBand {
  if (value == null || !Number.isFinite(Number(value))) return 'unknown'
  if (dryStandard == null || !Number.isFinite(Number(dryStandard))) return 'unknown'
  const over = Number(value) - Number(dryStandard)
  if (over <= DRY_WITHIN) return 'dry'
  if (over <= DRYING_WITHIN) return 'drying'
  return 'wet'
}

/** Pin colours. Amber rather than yellow so white text on it stays readable. */
export const BAND_PIN_CLASS: Record<MoistureBand, string> = {
  dry: 'bg-emerald-600',
  drying: 'bg-amber-500',
  wet: 'bg-red-600',
  unknown: 'bg-slate-500',
}

export const BAND_LABEL: Record<MoistureBand, string> = {
  dry: 'at dry standard',
  drying: 'still drying',
  wet: 'wet',
  unknown: 'no dry standard set',
}
