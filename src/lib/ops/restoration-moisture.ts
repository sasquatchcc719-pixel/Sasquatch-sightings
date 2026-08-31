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
 * **Only the wood family has a number here, and it is Charles's**, given for
 * framing on this job: *"the baseline was 10% which I think is pretty common."*
 * Wood is also the one material a moisture meter reads in true percent moisture
 * content, so a 10 means the same thing on any meter he owns.
 *
 * Drywall, plaster, insulation, concrete and tile are deliberately absent. I had
 * put 10 against every one of them — Charles's wood number applied to materials
 * that do not read like wood — and he found it out the honest way:
 *
 *   > *"these goals seem to be far above what I've experienced in the past. I'm
 *   > having to dial in numbers that I don't think I've ever achieved in order
 *   > to meet your green level."*
 *
 * He is right. Gypsum and concrete are read on relative or reference scales that
 * differ by meter, so a number invented for them is not conservative or generous
 * — it is meaningless, and it was quietly setting a target he could not hit.
 *
 * A point with no standard reads grey and says so, which is true. The standard
 * belongs to the job anyway: the S500 sets it from unaffected material of the
 * same kind in the same building, which is a reading to take, not a constant to
 * look up.
 */
export const DEFAULT_DRY_STANDARD: Record<string, number> = {
  Framing: 10,
  Subfloor: 10,
  Hardwood: 10,
  Trim: 10,
  Cabinet: 10,
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
