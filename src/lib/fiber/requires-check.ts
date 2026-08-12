/**
 * Which line items need a fiber check before work starts.
 *
 * Carpet is not included on purpose. Wall-to-wall carpet is overwhelmingly
 * nylon, polyester, or olefin and is not where the risk lives — gating it would
 * make the check routine noise that techs learn to tap through. Rugs and
 * upholstery are the exposure.
 */

/** Catalog categories that require a check, lowercased for comparison. */
const GATED_CATEGORIES = new Set(['rug cleaning', 'upholstery cleaning'])

/**
 * Fallback for lines with no catalog link — manually typed lines, "Custom
 * amount", or rows whose catalog link was lost. Deliberately broad: a false
 * positive costs 30 seconds, a false negative costs a rug.
 */
const NAME_PATTERN =
  /\b(rug|runner|sofa|couch|sectional|love\s*seat|loveseat|recliner|armchair|arm\s*chair|chair|ottoman|mattress|upholster\w*|cushion|settee|chaise|headboard)\b/i

/** Leather is in the upholstery category but is not a wet-clean risk fiber. */
const LEATHER_PATTERN = /\bleather\b/i

export type CheckableLine = {
  name: string
  catalogCategory?: string | null
}

export function requiresFiberCheck(line: CheckableLine): boolean {
  const category = (line.catalogCategory ?? '').trim().toLowerCase()
  if (category) {
    if (!GATED_CATEGORIES.has(category)) return false
    // Leather still gets a check — it is quick and confirms it really is
    // leather and not a bonded/vinyl blend that delaminates.
    return true
  }
  return NAME_PATTERN.test(line.name)
}

export function isLeatherLine(line: CheckableLine): boolean {
  return LEATHER_PATTERN.test(line.name)
}

/** Rug vs upholstery, used to tune the prompt and the tests offered. */
export function fiberItemKind(line: CheckableLine): 'rug' | 'upholstery' {
  const category = (line.catalogCategory ?? '').trim().toLowerCase()
  if (category === 'rug cleaning') return 'rug'
  if (category === 'upholstery cleaning') return 'upholstery'
  return /\b(rug|runner)\b/i.test(line.name) ? 'rug' : 'upholstery'
}
