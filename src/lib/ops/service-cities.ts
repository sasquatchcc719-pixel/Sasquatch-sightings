/**
 * The towns we actually work in, for one-tap city entry on address forms.
 *
 * Zip is only pre-filled where our own address history is effectively
 * single-zip, so a tap never puts a wrong zip on a job:
 *   Monument      257/267 rows are 80132
 *   Palmer Lake    62/63  rows are 80133
 *   Larkspur       21/21  rows are 80118
 *   Colorado Springs — 20+ zips in use, so it stays blank
 *   Castle Rock   — 80104/80108/80109 all in use, so it stays blank
 *
 * Cities outside this list are still typed by hand in the City field.
 */
export type ServiceCity = {
  city: string
  state: string
  /** Pre-filled only when unambiguous; otherwise the zip is left to the user. */
  zip?: string
}

export const SERVICE_CITIES: readonly ServiceCity[] = [
  { city: 'Monument', state: 'CO', zip: '80132' },
  { city: 'Palmer Lake', state: 'CO', zip: '80133' },
  { city: 'Colorado Springs', state: 'CO' },
  { city: 'Larkspur', state: 'CO', zip: '80118' },
  { city: 'Castle Rock', state: 'CO' },
] as const

/** Zips this list can auto-fill — i.e. a zip that a previous tap may have put there. */
const AUTO_FILLABLE_ZIPS: ReadonlySet<string> = new Set(
  SERVICE_CITIES.map((entry) => entry.zip).filter(
    (zip): zip is string => Boolean(zip),
  ),
)

/**
 * What the zip field should become when a city button is tapped.
 *
 * A hand-typed zip is never thrown away, but a zip a previous tap filled in
 * gets corrected — otherwise tapping Monument and then Larkspur would leave
 * 80132 sitting on a Larkspur job.
 */
export function nextZipForCityPick(
  currentZip: string | null | undefined,
  picked: ServiceCity,
): string {
  const zip = (currentZip ?? '').trim()
  const wasAutoFilled = AUTO_FILLABLE_ZIPS.has(zip)

  if (picked.zip) {
    // Single-zip town: fill when empty, correct a previous tap, keep hand-typed.
    if (!zip || wasAutoFilled) return picked.zip
    return zip
  }

  // Multi-zip town: clear a previous tap's zip, but keep anything hand-typed.
  return wasAutoFilled ? '' : zip
}
