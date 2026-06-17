/**
 * Harry (next) — deterministic catalog matching for booking.
 *
 * This is the root-cause fix for the booking failure (the "issue matching the
 * services" loop): old Harry made the MODEL pick service IDs from a stateful ref
 * layer, and they collapsed (one empty, several onto the same id). Here the model
 * only supplies a plain-words descriptor ("a couple bedrooms", "the stairs"); this
 * code maps each descriptor to exactly one real catalog item, or asks. The model
 * never sees or chooses an ID, so the collapse is impossible.
 *
 * It also encodes the documented quoting rule: a generic bedroom/room defaults to
 * Regular Size Room, NOT Sasquatch — only an explicit large signal upgrades it.
 */

export type CatalogItem = {
  id: string
  name: string
  slug: string | null
  basePrice: number | null
  pricingUnit: string
}

export type ServiceMatch =
  | { status: 'matched'; item: CatalogItem; quantity: number }
  | { status: 'ambiguous'; descriptor: string; candidates: CatalogItem[] }
  | { status: 'none'; descriptor: string }

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findByName(catalog: CatalogItem[], needle: string): CatalogItem[] {
  const n = normalize(needle)
  return catalog.filter((item) => normalize(item.name).includes(n))
}

// Signals that a room is genuinely large enough to leave the Regular tier.
const LARGE_ROOM_SIGNALS = [
  'huge',
  'giant',
  'massive',
  'oversized',
  'extra large',
  'living room',
  'great room',
  'family room',
  'open concept',
  'open to',
  'basement',
  'sqft',
  'square feet',
  'square foot',
]

// Keyword → catalog-name fragment for the unambiguous add-ons and specials.
const KEYWORD_RULES: Array<{ match: RegExp; nameFragment: string }> = [
  { match: /\b(stair|step)/, nameFragment: 'step carpet' },
  { match: /\b(closet|hall|bathroom)/, nameFragment: 'hall/bathroom/closet' },
  { match: /\b(dryer|duct)/, nameFragment: 'dryer duct' },
  { match: /\b(urine|pet|odor|odour|stain)/, nameFragment: 'urine eliminator' },
  { match: /\bdeodor/, nameFragment: 'deodorizer' },
  { match: /\b(pre.?vacuum|vacuum)/, nameFragment: 'pre-vacuum' },
]

// Square-footage → room tier (the catalog is sqft-banded). "living room 350 ft²"
// maps deterministically to the Sasquatch tier, no keyword guessing.
const SQFT_TIERS: Array<{ maxSqft: number; nameFragment: string }> = [
  { maxSqft: 100, nameFragment: 'hall/bathroom/closet' },
  { maxSqft: 200, nameFragment: 'regular size room' },
  { maxSqft: 400, nameFragment: 'sasquatch size room' },
  { maxSqft: 600, nameFragment: 'monster size room' },
  { maxSqft: 800, nameFragment: 'jumbo' },
  { maxSqft: Infinity, nameFragment: 'oversized' },
]

// Explicit size-tier names, even when phrased as "area"/"space" instead of "room".
const TIER_NAME_SIGNALS: Array<{ re: RegExp; nameFragment: string }> = [
  { re: /\bregular\s*size\b/, nameFragment: 'regular size room' },
  { re: /\bsasquatch\b/, nameFragment: 'sasquatch size room' },
  { re: /\bmonster\b/, nameFragment: 'monster size room' },
  { re: /\b(jumbo|humongous)\b/, nameFragment: 'jumbo' },
  { re: /\boversized\b/, nameFragment: 'oversized' },
]

function parseSqft(raw: string): number | null {
  const match =
    /(\d{2,5})\s*(?:sq\.?\s*ft|sqft|ft\s*²|ft²|ft2|ft\^2|sf|square\s*f(?:ee|oo)t)/i.exec(
      raw,
    )
  return match ? Number(match[1]) : null
}

/**
 * Map one plain-words service descriptor to exactly one catalog item. Quantity
 * is taken from the descriptor's caller (the model's segmentation), defaulting
 * to 1. Returns `ambiguous`/`none` instead of guessing when it can't be sure.
 */
export function matchServiceDescription(
  catalog: CatalogItem[],
  descriptor: string,
  quantity = 1,
): ServiceMatch {
  const text = normalize(descriptor)
  const qty = Math.max(1, Math.floor(quantity) || 1)

  if (!text) return { status: 'none', descriptor }

  // 1) Specific keyword rules (stairs, closet, duct, urine, etc.).
  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(text)) {
      const hits = findByName(catalog, rule.nameFragment)
      if (hits.length === 1)
        return { status: 'matched', item: hits[0], quantity: qty }
      if (hits.length > 1)
        return { status: 'ambiguous', descriptor, candidates: hits }
    }
  }

  // 2) Square footage → tier (deterministic). "living room 350 ft²" → Sasquatch.
  const sqft = parseSqft(descriptor)
  if (sqft != null) {
    const tier = SQFT_TIERS.find((t) => sqft <= t.maxSqft)
    if (tier) {
      const hits = findByName(catalog, tier.nameFragment)
      if (hits.length === 1)
        return { status: 'matched', item: hits[0], quantity: qty }
      if (hits.length > 1)
        return { status: 'ambiguous', descriptor, candidates: hits }
    }
  }

  // 3) Explicit size-tier name ("Sasquatch size area", "monster room").
  for (const tier of TIER_NAME_SIGNALS) {
    if (tier.re.test(text)) {
      const hits = findByName(catalog, tier.nameFragment)
      if (hits.length === 1)
        return { status: 'matched', item: hits[0], quantity: qty }
      if (hits.length > 1)
        return { status: 'ambiguous', descriptor, candidates: hits }
    }
  }

  // 4) Room sizing rule: a generic room/bedroom defaults to Regular; only an
  //    explicit large signal upgrades it to Sasquatch.
  if (/\b(bedroom|room|den|office|nursery|basement)s?\b/.test(text)) {
    const isLarge = LARGE_ROOM_SIGNALS.some((signal) => text.includes(signal))
    const targetName = isLarge ? 'sasquatch size room' : 'regular size room'
    const hits = findByName(catalog, targetName)
    if (hits.length === 1)
      return { status: 'matched', item: hits[0], quantity: qty }
    if (hits.length > 1)
      return { status: 'ambiguous', descriptor, candidates: hits }
  }

  // 3) Fall back to a direct name match against the catalog.
  const direct = findByName(catalog, text)
  if (direct.length === 1)
    return { status: 'matched', item: direct[0], quantity: qty }
  if (direct.length > 1)
    return { status: 'ambiguous', descriptor, candidates: direct }

  return { status: 'none', descriptor }
}
