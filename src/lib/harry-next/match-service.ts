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

  // 2) Room sizing rule: a generic room/bedroom defaults to Regular; only an
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
