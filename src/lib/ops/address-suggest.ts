/**
 * Address autocomplete helpers (Photon geocoder → our form fields).
 * Used from /api/admin/ops/address-suggest — not for Nominatim job geocodes.
 */

export type AddressSuggestion = {
  label: string
  street: string
  city: string
  state: string
  zip: string
}

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'puerto rico': 'PR',
}

export function normalizeUsStateAbbrev(
  raw: string | undefined,
  statecode: string | undefined,
  fallback: string,
): string {
  if (statecode) {
    const t = String(statecode).trim()
    if (t.length === 2) return t.toUpperCase()
  }
  if (!raw) return fallback
  const t = String(raw).trim()
  if (t.length === 2) return t.toUpperCase()
  return US_STATE_NAME_TO_CODE[t.toLowerCase()] ?? fallback
}

type PhotonProperties = {
  name?: string
  street?: string
  housenumber?: string
  city?: string
  county?: string
  state?: string
  statecode?: string
  postcode?: string
  country?: string
  countrycode?: string
  type?: string
}

type PhotonFeature = {
  properties?: PhotonProperties
  geometry?: { coordinates?: [number, number] | number[] }
}

/** Reject if we know it's not the US; allow empty country (Photon sometimes omits). */
function isLikelyUS(p: PhotonProperties): boolean {
  const code = (p.countrycode || '').toLowerCase()
  if (code && code !== 'us' && code !== 'usa') return false
  const c = (p.country || '').trim()
  if (!c) return true
  if (code === 'us' || code === 'usa') return true
  return (
    /united states( of america)?/i.test(c) ||
    c === 'USA' ||
    c === 'US' ||
    c === 'U.S.A.'
  )
}

function buildStreet1(p: PhotonProperties): string {
  const h = p.housenumber?.trim() ?? ''
  const s = p.street?.trim() ?? ''
  const n = p.name?.trim() ?? ''
  if (h && s) return `${h} ${s}`.replace(/\s+/g, ' ').trim()
  if (h && n && !s) return `${h} ${n}`.replace(/\s+/g, ' ').trim()
  if (s) return h ? `${h} ${s}`.replace(/\s+/g, ' ').trim() : s
  if (n) return h ? `${h} ${n}`.replace(/\s+/g, ' ').trim() : n
  return ''
}

function buildLabel(
  p: PhotonProperties,
  street1: string,
  city: string,
  stateAbbr: string,
  zip: string,
): string {
  if (p.name && [street1, city, zip].filter(Boolean).length < 2) {
    return [p.name, city, stateAbbr, zip].filter(Boolean).join(', ')
  }
  return [street1, city, stateAbbr, zip].filter(Boolean).join(', ')
}

export type PhotonSuggestionsOptions = {
  /** When state/region is missing, fill with this 2-letter code (only if you are not also using allowedStateAbbr). */
  fallbackState?: string
  /** If set (e.g. CO), only include rows whose state resolves to this code. Unknown state is dropped — no guessing. */
  allowedStateAbbr?: string
  /** Optional county filter (normalized lowercase names). */
  allowedCountyNames?: string[]
  /** Optional fallback bounds check for rows missing county metadata. */
  allowedBounds?: {
    minLon: number
    minLat: number
    maxLon: number
    maxLat: number
  }
}

function inBounds(
  coords: [number, number] | number[] | undefined,
  bounds:
    | {
        minLon: number
        minLat: number
        maxLon: number
        maxLat: number
      }
    | undefined,
): boolean {
  if (!coords || !bounds || coords.length < 2) return false
  const lon = Number(coords[0])
  const lat = Number(coords[1])
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
  return (
    lon >= bounds.minLon &&
    lon <= bounds.maxLon &&
    lat >= bounds.minLat &&
    lat <= bounds.maxLat
  )
}

/**
 * Map Photon /api JSON to form suggestions. Drops non-US results; keeps street-level
 * and other layers so partial queries still return useful rows.
 */
export function photonFeaturesToSuggestions(
  features: PhotonFeature[] | undefined,
  options: PhotonSuggestionsOptions = {},
): AddressSuggestion[] {
  const {
    fallbackState = 'CO',
    allowedStateAbbr,
    allowedCountyNames = [],
    allowedBounds,
  } = options
  if (!features?.length) return []
  const countySet = new Set(
    allowedCountyNames.map((c) => c.trim().toLowerCase()),
  )
  const out: AddressSuggestion[] = []
  for (const f of features) {
    const p = f.properties
    if (!p) continue
    if (!isLikelyUS(p)) continue

    const city = p.city?.trim() ?? ''
    const zip = p.postcode?.trim() ?? ''
    // Do not default to CO when we are filtering to Colorado — that would turn unknown-state hits into false CO.
    const stateAbbr = normalizeUsStateAbbrev(
      p.state,
      p.statecode,
      allowedStateAbbr ? '' : fallbackState,
    )
    if (allowedStateAbbr && stateAbbr !== allowedStateAbbr) continue
    if (!stateAbbr) continue
    if (countySet.size > 0) {
      const county = (p.county || '')
        .trim()
        .toLowerCase()
        .replace(/\s+county$/, '')
      const countyOk = countySet.has(county)
      if (!countyOk && !inBounds(f.geometry?.coordinates, allowedBounds))
        continue
    }

    const street1 = buildStreet1(p)
    if (!street1) continue

    out.push({
      label: buildLabel(p, street1, city, stateAbbr, zip),
      street: street1,
      city,
      state: stateAbbr,
      zip,
    })
  }
  return out
}
