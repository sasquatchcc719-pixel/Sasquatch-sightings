/**
 * The towns we actually work in, for one-tap city entry on address forms.
 *
 * Zip is only pre-filled where our own address history is effectively
 * single-zip, so a tap never puts a wrong zip on a job:
 *   Monument      257/267 rows are 80132
 *   Palmer Lake    62/63  rows are 80133
 *   Larkspur       21/21  rows are 80118
 *
 * Multi-zip towns can't be auto-filled, so they offer their zips as a second
 * row of buttons instead — still one tap, but the choice stays with whoever is
 * standing at the door:
 *   Colorado Springs — 80921 and 80908 carry most of the work
 *   Castle Rock      — 80104/80109/80108
 *
 * Cities outside this list are still typed by hand in the City field.
 */
export type ServiceCity = {
  city: string
  state: string
  /** Pre-filled only when unambiguous; otherwise the zip is left to the user. */
  zip?: string
  /**
   * Zips offered as one-tap buttons for a multi-zip town, most-worked first.
   *
   * Taken from our own completed address history (zips used on 2+ jobs), not a
   * postal-service list — these are the zips we actually work, so the common
   * job is one tap. Anything rarer is still typed by hand.
   */
  zips?: readonly string[]
}

export const SERVICE_CITIES: readonly ServiceCity[] = [
  { city: 'Monument', state: 'CO', zip: '80132' },
  { city: 'Palmer Lake', state: 'CO', zip: '80133' },
  {
    city: 'Colorado Springs',
    state: 'CO',
    zips: [
      '80921',
      '80908',
      '80920',
      '80919',
      '80918',
      '80923',
      '80905',
      '80916',
      '80924',
      '80906',
      '80907',
      '80917',
      '80922',
      // East side / Cimarron Hills. Already inside the service area
      // (service-area.ts) but missing from these buttons, so a job there
      // could not be scheduled without hand-typing the zip.
      '80915',
    ],
  },
  { city: 'Larkspur', state: 'CO', zip: '80118' },
  { city: 'Castle Rock', state: 'CO', zips: ['80104', '80109', '80108'] },
] as const

/** The town a zip belongs to, if it's one of ours. Undefined means hand-typed. */
function cityOwningZip(zip: string): ServiceCity | undefined {
  return SERVICE_CITIES.find(
    (entry) => entry.zip === zip || entry.zips?.includes(zip),
  )
}

/** The zip buttons to offer once a town is picked; empty for single-zip towns. */
export function zipOptionsForCity(
  city: string | null | undefined,
): readonly string[] {
  const key = (city ?? '').trim().toLowerCase()
  if (!key) return []

  const match = SERVICE_CITIES.find((entry) => entry.city.toLowerCase() === key)
  return match?.zips ?? []
}

/**
 * What the zip field should become when a city button is tapped.
 *
 * A zip typed by hand is never thrown away, but a zip belonging to one of our
 * other towns gets corrected — otherwise tapping Monument and then Larkspur
 * would leave 80132 sitting on a Larkspur job.
 *
 * We decide by which town owns the zip rather than by "did a tap put it there",
 * because a zip button can now produce a Colorado Springs zip that someone
 * could equally have typed. Ownership is the safer read: a Colorado Springs zip
 * on a job you just marked Monument is wrong however it got in the field.
 */
export function nextZipForCityPick(
  currentZip: string | null | undefined,
  picked: ServiceCity,
): string {
  const zip = (currentZip ?? '').trim()

  // Empty field: fill it for a single-zip town, leave it for the zip buttons.
  if (!zip) return picked.zip ?? ''

  const owner = cityOwningZip(zip)

  // Already the right town's zip — including a zip picked from its own buttons.
  if (owner?.city === picked.city) return zip

  // Not a zip from any town we work: it was typed deliberately, so keep it.
  if (!owner) return zip

  // Belongs to a different town: correct it, or clear it for a multi-zip town.
  return picked.zip ?? ''
}
