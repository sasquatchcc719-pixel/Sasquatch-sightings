/**
 * Deterministic fiber stop list.
 *
 * This is the seatbelt. It is plain string matching over care-tag text — no
 * model involved — so it cannot hallucinate, cannot be argued out of a verdict,
 * and cannot silently regress when a model is swapped. If a tag says VISCOSE,
 * this file stops the job.
 *
 * The AI vision pass runs AFTER this and may only make a verdict *more*
 * conservative, never less. See escalate() below.
 *
 * Keep this list short and high-confidence. It is not meant to be an
 * encyclopedia of fibers — it covers the handful that actually destroy work.
 */

import type { FiberVerdict } from './types'

export type StopListHit = {
  /** The matched term as written in this file. */
  term: string
  fiber: string
  verdict: FiberVerdict
  warnings: string[]
  recommendedMethod: string
}

type Rule = {
  /** Terms to match against normalized tag text. */
  terms: string[]
  fiber: string
  verdict: FiberVerdict
  warnings: string[]
  recommendedMethod: string
}

const RULES: Rule[] = [
  {
    // The rug killer. Regenerated cellulose — loses roughly half its strength
    // when wet, browns permanently, and the pile crushes and never recovers.
    terms: [
      'viscose',
      'rayon',
      'art silk',
      'artsilk',
      'artificial silk',
      'faux silk',
      'bamboo silk',
      'banana silk',
      'sari silk',
      'tencel',
      'lyocell',
      'modal',
      'cupro',
      'bamboo viscose',
      'wood pulp',
      'regenerated cellulose',
      // Silk-sounding marketing names for the same regenerated cellulose.
      // The trade invents new ones constantly; they are all this fiber.
      'manmade silk',
      'man made silk',
      'eucalyptus silk',
      'vegan silk',
      'soy silk',
      'soya silk',
      'cactus silk',
      'sabra',
      'sabra silk',
      'seacell',
      'bemberg',
      'viscose rayon',
    ],
    fiber: 'Viscose / rayon (regenerated cellulose)',
    verdict: 'do_not_wet_clean',
    warnings: [
      'Viscose loses about half its strength when wet — fibers break under normal agitation.',
      'Permanent cellulosic browning and yellowing, often appearing hours after it dries.',
      'Pile crushes and will not recover. Damage is not reversible.',
      'Even plain water can leave a permanent ring. Do not spot test on the face.',
    ],
    recommendedMethod:
      'Do not introduce water. Dry vacuum / dry compound only, or refer to a rug plant that accepts viscose. Exclude the item from the invoice and document it.',
  },
  {
    // Acetate is the one that punishes the wrong BOTTLE, not just water. It
    // dissolves outright in acetone and is damaged by alcohol — which rules
    // out most solvent spotters sitting on a truck.
    terms: ['acetate', 'cellulose acetate', 'triacetate', 'diacetate'],
    fiber: 'Acetate (cellulose acetate)',
    verdict: 'do_not_wet_clean',
    warnings: [
      'DISSOLVES in acetone and is damaged by alcohol — do not use any solvent spotter on this.',
      'Loses strength when wet and distorts easily; water spots permanently.',
      'Heat sensitive — it will glaze or melt under a hot rinse.',
    ],
    recommendedMethod:
      'No water, no solvent, no heat. Dry vacuum only and refer it out. If a spotter has already been applied, stop and document it.',
  },
  {
    // Faux fur and some throws. Cleanable, but melts at surprisingly low heat.
    terms: ['modacrylic', 'faux fur'],
    fiber: 'Modacrylic (faux fur)',
    verdict: 'low_moisture',
    warnings: [
      'Melts and mats at low heat — keep well under 120°F and never use a hot rinse.',
      'Pile mats permanently if agitated while wet.',
    ],
    recommendedMethod:
      'Low moisture, cool solution, no agitation on the pile, air dry and groom.',
  },
  {
    // Real silk. Cleanable by a specialist, not in a customer's living room.
    terms: ['silk', '100% silk', 'pure silk', 'mulberry silk'],
    fiber: 'Silk',
    verdict: 'do_not_wet_clean',
    warnings: [
      'Dye bleed and permanent water spotting risk.',
      'Loses luster and can pucker with any agitation while wet.',
    ],
    recommendedMethod:
      'Do not wet clean on site. Dry vacuum only; refer to a rug specialist. Note that "art silk" / "faux silk" is viscose, not silk — same answer either way.',
  },
  {
    // Bast and leaf fibers. Brown, shrink, and buckle. Charles has avoided
    // these for years on instinct — this makes it a rule.
    terms: [
      'jute',
      'sisal',
      'seagrass',
      'sea grass',
      'coir',
      'abaca',
      'hemp',
      'kenaf',
    ],
    fiber: 'Bast / plant fiber (jute, sisal, seagrass)',
    verdict: 'do_not_wet_clean',
    warnings: [
      'Cellulosic browning is close to guaranteed once wet.',
      'Shrinks and buckles as it dries; backing can delaminate.',
      'Jute backing bleeds brown into the face fiber above it.',
    ],
    recommendedMethod:
      'Dry compound or dry vacuum only. No water, no rinse. Exclude the item and document it.',
  },
  {
    terms: ['linen', 'flax', 'ramie'],
    fiber: 'Linen / flax',
    verdict: 'low_moisture',
    warnings: [
      'Cellulosic browning risk and easy wrinkling.',
      'Water spots readily and may shrink.',
    ],
    recommendedMethod:
      'Low moisture only, neutral pH, no heat, minimal agitation, fast forced-air dry.',
  },
  {
    terms: ['cotton', '100% cotton'],
    fiber: 'Cotton',
    verdict: 'low_moisture',
    warnings: [
      'Cellulosic browning risk, especially on rug foundations and flatweaves.',
      'Prone to wicking — spots reappear as it dries.',
    ],
    recommendedMethod:
      'Low moisture, neutral pH, fast dry. Anti-browning agent if one is in stock.',
  },
  {
    terms: ['wool', 'new zealand wool', 'virgin wool'],
    fiber: 'Wool',
    verdict: 'go',
    warnings: [
      'Hard cap 120°F — heat felts wool permanently.',
      'pH 4.5-8.5 only. No oxidizers, no chlorine, no high-alkaline prespray.',
      'No aggressive agitation while wet.',
    ],
    recommendedMethod:
      'Standard wool-safe protocol: neutral to mildly acidic, 120°F max, gentle agitation, thorough rinse, fast dry.',
  },
]

/** Care-tag cleaning codes. Matched only in explicit "code X" form. */
const CODE_RULES: Array<{
  pattern: RegExp
  code: string
  verdict: FiberVerdict
  warnings: string[]
  recommendedMethod: string
}> = [
  {
    pattern: /\b(?:cleaning\s*)?code[\s:.\-]*x\b/i,
    code: 'X',
    verdict: 'do_not_wet_clean',
    warnings: [
      'Code X means vacuum only. Any liquid — water or solvent — risks shrinking or staining.',
    ],
    recommendedMethod:
      'Dry vacuum with upholstery tool only. No cleaning agents of any kind.',
  },
  {
    pattern: /\b(?:cleaning\s*)?code[\s:.\-]*s\b/i,
    code: 'S',
    verdict: 'low_moisture',
    warnings: [
      'Code S is solvent only — water will ring, shrink, or stain this fabric.',
    ],
    recommendedMethod:
      'Dry solvent method only, if a suitable solvent is in stock. No water-based prespray or rinse.',
  },
]

/**
 * Normalize OCR'd tag text so spacing, punctuation, and percentage signs do not
 * defeat a match. "100% V I S C O S E" and "Contents: viscose." both reduce to
 * text containing "viscose".
 */
export function normalizeTagText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Collapse single-letter runs produced by wide-tracked tag printing, so
 * "v i s c o s e" also matches. Applied as a second pass only.
 */
function collapseSpacedLetters(text: string): string {
  return text.replace(/\b(?:[a-z]\s){2,}[a-z]\b/g, (run) =>
    run.replace(/\s/g, ''),
  )
}

function matchesTerm(haystack: string, term: string): boolean {
  // Word-boundary match so "modal" does not fire inside "modality" and
  // "silk" does not fire inside a longer unrelated token.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(haystack)
}

const VERDICT_SEVERITY: Record<FiberVerdict, number> = {
  go: 0,
  low_moisture: 1,
  do_not_wet_clean: 2,
}

/** Returns the more conservative of two verdicts. Never relaxes. */
export function escalate(a: FiberVerdict, b: FiberVerdict): FiberVerdict {
  return VERDICT_SEVERITY[a] >= VERDICT_SEVERITY[b] ? a : b
}

/**
 * Scan care-tag text for known-dangerous fibers and cleaning codes.
 * Returns every hit, most severe first. Empty array means the tag said nothing
 * this list recognizes — which is NOT the same as safe.
 */
export function scanTagText(raw: string): StopListHit[] {
  if (!raw || !raw.trim()) return []
  const base = normalizeTagText(raw)
  const collapsed = collapseSpacedLetters(base)
  const hits: StopListHit[] = []

  for (const rule of RULES) {
    for (const term of rule.terms) {
      if (matchesTerm(base, term) || matchesTerm(collapsed, term)) {
        hits.push({
          term,
          fiber: rule.fiber,
          verdict: rule.verdict,
          warnings: rule.warnings,
          recommendedMethod: rule.recommendedMethod,
        })
        break // one hit per rule
      }
    }
  }

  for (const code of CODE_RULES) {
    if (code.pattern.test(raw)) {
      hits.push({
        term: `code ${code.code}`,
        fiber: `Care code ${code.code}`,
        verdict: code.verdict,
        warnings: code.warnings,
        recommendedMethod: code.recommendedMethod,
      })
    }
  }

  return hits.sort(
    (a, b) => VERDICT_SEVERITY[b.verdict] - VERDICT_SEVERITY[a.verdict],
  )
}

/**
 * Three-bucket burn test — the answer for items with no tag, which is most of
 * them. You do not need to name the fiber; you need to know which of three
 * families it belongs to.
 */
export function burnTestVerdict(result: BurnBucket): {
  verdict: FiberVerdict
  fiber: string
  warnings: string[]
  recommendedMethod: string
} {
  switch (result) {
    case 'melts':
      return {
        verdict: 'go',
        fiber: 'Synthetic (nylon, polyester, or olefin)',
        warnings: [
          'If olefin/polypropylene: heat-sensitive and wicking-prone — keep temperature moderate and rinse thoroughly.',
        ],
        recommendedMethod:
          'Standard hot water extraction. Normal prespray and CRB agitation.',
      }
    case 'burning_hair':
      return {
        verdict: 'go',
        fiber: 'Protein fiber (wool, possibly silk)',
        warnings: [
          'Hard cap 120°F. pH 4.5-8.5. No oxidizers or chlorine. Gentle agitation only.',
          'STOP if the pile is very fine with a high silk-like sheen — that is silk, not wool, and silk does not get wet cleaned on site.',
        ],
        recommendedMethod:
          'Wool-safe protocol: neutral to mildly acidic, 120°F max, gentle agitation, thorough rinse, fast dry.',
      }
    case 'burns_like_paper':
      return {
        verdict: 'do_not_wet_clean',
        fiber: 'Cellulosic (viscose, cotton, or jute — cannot be separated by burn)',
        warnings: [
          'Burns like paper means cellulose. That family includes viscose, which is destroyed by water.',
          'Viscose and cotton burn identically — you cannot tell them apart this way, so assume the worst case.',
          'Browning, strength loss, and permanent pile crush are all on the table.',
        ],
        recommendedMethod:
          'Treat as viscose until proven otherwise. Do not wet clean. Dry vacuum or dry compound only, exclude the item, and document it.',
      }
  }
}

export type BurnBucket = 'melts' | 'burning_hair' | 'burns_like_paper'
