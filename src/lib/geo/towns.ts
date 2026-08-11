/**
 * Canonical towns for the Sasquatch service area.
 *
 * WHY THIS EXISTS: `ops_service_addresses.city` is free text typed by customers
 * and staff, and it has drifted badly — "Monument" (98 jobs), "Monumnet" (6),
 * "MONUMENT" (1); "Colorado Springs" (82), "Colorado springs" (3), "Colordo
 * springs" (1); "Palmer Lake" (111), "Palmer lake" (3). Roughly 18 jobs sit in
 * misspelt buckets. Any query joining rankings to revenue by town silently drops
 * them, which is exactly the kind of quiet wrongness that makes a dashboard lie.
 *
 * This module is the single vocabulary both sides use: rank data is keyed to a
 * town slug, and so is every booking. Pure functions only — no imports — so the
 * scanner, the API routes and the browser can all share it.
 */

export type TownSlug =
  | 'palmer-lake'
  | 'monument'
  | 'woodmoor'
  | 'gleneagle'
  | 'larkspur'
  | 'castle-rock'
  | 'castle-pines'
  | 'black-forest'
  | 'colorado-springs'
  | 'falcon'
  | 'peyton'
  | 'fountain'
  | 'manitou-springs'

export type Town = {
  slug: TownSlug
  name: string
  lat: number
  lng: number
  /**
   * Extra spellings seen in real data or worth pre-empting. Case and
   * punctuation are handled by the normalizer, so only add genuinely different
   * strings here — neighbourhoods that roll up to a city, or known typos.
   */
  aliases: string[]
}

export const TOWNS: Town[] = [
  {
    slug: 'palmer-lake',
    name: 'Palmer Lake',
    lat: 39.1152,
    lng: -104.9178,
    // "pommel lake" is real data — a phonetic mangling too far from the name
    // for edit-distance to catch safely, so it is listed explicitly.
    aliases: ['pommel lake'],
  },
  {
    slug: 'monument',
    name: 'Monument',
    lat: 39.0908,
    lng: -104.8698,
    aliases: ['monumnet'],
  },
  {
    slug: 'woodmoor',
    name: 'Woodmoor',
    lat: 39.0502,
    lng: -104.8606,
    aliases: [],
  },
  {
    slug: 'gleneagle',
    name: 'Gleneagle',
    lat: 39.0169,
    lng: -104.8473,
    aliases: ['glen eagle'],
  },
  {
    slug: 'larkspur',
    name: 'Larkspur',
    lat: 39.2356,
    lng: -104.8939,
    aliases: [],
  },
  {
    slug: 'castle-rock',
    name: 'Castle Rock',
    lat: 39.3722,
    lng: -104.8561,
    aliases: [],
  },
  {
    slug: 'castle-pines',
    name: 'Castle Pines',
    lat: 39.28,
    lng: -104.87,
    aliases: [],
  },
  {
    slug: 'black-forest',
    name: 'Black Forest',
    lat: 38.9786,
    lng: -104.685,
    aliases: [],
  },
  {
    slug: 'colorado-springs',
    name: 'Colorado Springs',
    lat: 38.8339,
    lng: -104.8214,
    // Neighbourhoods roll up to the city — they are not separate markets for
    // ranking purposes and splitting them would fragment the revenue join.
    aliases: [
      'colorado spgs',
      'co springs',
      'cos',
      'briargate',
      'rockrimmon',
      'mountain shadows',
      'kissing camels',
      'northgate',
      'cimarron hills',
      'security widefield',
      'widefield',
      'air force academy',
      'usafa',
    ],
  },
  { slug: 'falcon', name: 'Falcon', lat: 38.9378, lng: -104.6214, aliases: [] },
  { slug: 'peyton', name: 'Peyton', lat: 38.9861, lng: -104.4744, aliases: [] },
  {
    slug: 'fountain',
    name: 'Fountain',
    lat: 38.6822,
    lng: -104.7008,
    aliases: [],
  },
  {
    slug: 'manitou-springs',
    name: 'Manitou Springs',
    lat: 38.8597,
    lng: -104.9172,
    aliases: [],
  },
]

/**
 * Markets Sasquatch actively serves and wants in business-facing reports.
 * The scanner measures a wider geography for competitive context, but those
 * benchmark locations must not be presented as operating markets.
 */
export const ACTIVE_SERVICE_TOWN_SLUGS: readonly TownSlug[] = [
  'monument',
  'palmer-lake',
  'colorado-springs',
  'larkspur',
  'castle-rock',
]

/** lowercase, strip punctuation, collapse whitespace. */
function canon(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Levenshtein distance, capped — we only care about small typos. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 2) return 99
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

const LOOKUP = new Map<string, TownSlug>()
for (const t of TOWNS) {
  LOOKUP.set(canon(t.name), t.slug)
  LOOKUP.set(t.slug, t.slug)
  for (const a of t.aliases) LOOKUP.set(canon(a), t.slug)
}

/**
 * Resolve arbitrary free text to a canonical town slug.
 *
 * Returns null rather than guessing when nothing is close — an unknown town is
 * information ("we worked somewhere new"), whereas a wrong match is corruption.
 */
export function normalizeTown(
  input: string | null | undefined,
): TownSlug | null {
  const c = canon(String(input ?? ''))
  if (!c) return null

  const exact = LOOKUP.get(c)
  if (exact) return exact

  // Typo tolerance. Distance 1 for short names, 2 for longer ones, so "falcon"
  // can't collapse into "fountain" but "colordo springs" still resolves.
  let best: { slug: TownSlug; d: number } | null = null
  for (const [key, slug] of LOOKUP) {
    const limit = key.length <= 8 ? 1 : 2
    const d = editDistance(c, key)
    if (d <= limit && (!best || d < best.d)) best = { slug, d }
  }
  return best?.slug ?? null
}

export function townBySlug(slug: string): Town | undefined {
  return TOWNS.find((t) => t.slug === slug)
}

/** Display name for a slug, falling back to the raw value. */
export function townLabel(slug: string | null | undefined): string {
  if (!slug) return 'Unknown'
  return townBySlug(slug)?.name ?? slug
}
