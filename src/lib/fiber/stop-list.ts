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
      'Do not extract. Take it off the invoice and document it. If the customer insists after being told, encapsulation only with a signed waiver — never the truckmount.',
  },
  {
    // Construction, not fibre. A wool hand-tufted rug passes a fibre check and
    // still comes apart: the latex holding the tufts breaks down with water.
    terms: [
      'hand tufted',
      'handtufted',
      'latex backing',
      'latex back',
      'glued backing',
      'scrim backing',
    ],
    fiber: 'Hand-tufted construction (latex adhesive backing)',
    verdict: 'low_moisture',
    warnings: [
      'The latex holding the tufts breaks down with water — delamination and lifelong shedding.',
      'Wet latex smells strongly of wet cardboard or dirty socks, and the customer will blame the cleaning.',
      'Never saturate and never hot rinse, no matter how safe the face fibre is.',
    ],
    recommendedMethod:
      'Encapsulation is safest. If extracting, light prespray, CRB gently, and pull it as dry as the machine will go — the danger is the water reaching the latex, not the pile.',
  },
  {
    // Finishes that are destroyed by moisture regardless of the fibre under
    // them. These are the classic X-code textiles.
    terms: ['crushed velvet', 'chintz', 'glazed chintz', 'moire'],
    fiber: 'Moisture-sensitive finish (crushed velvet / glazed chintz / moiré)',
    verdict: 'do_not_wet_clean',
    warnings: [
      'The finish is the fragile part — water permanently marks and flattens it.',
      'Usually carries an X code. Damage shows immediately and cannot be corrected.',
    ],
    recommendedMethod:
      'Vacuum only with the upholstery tool. Neither extraction nor encapsulation is safe on this finish. Take it off the invoice.',
  },
  {
    terms: ['velvet', 'velour', 'chenille'],
    fiber: 'Pile fabric (velvet / velour / chenille)',
    verdict: 'low_moisture',
    warnings: [
      'Pile crushes and watermarks; marks show as light and dark patches after drying.',
      'A great deal of chenille is rayon — check the content before adding any water.',
      'Groom the pile in one direction while it dries.',
    ],
    recommendedMethod:
      'Encapsulation preferred. If extracting, light moisture only, dry strokes with the nap, and groom the pile one direction while it dries.',
  },
  {
    // Peels no matter what is done to it — say so BEFORE touching it.
    terms: [
      'bonded leather',
      'faux leather',
      'vegan leather',
      'pu leather',
      'leatherette',
      'pleather',
    ],
    fiber: 'Bonded / faux leather (polyurethane over backing)',
    verdict: 'do_not_wet_clean',
    warnings: [
      'Bonded and faux leather peel and flake with age regardless of cleaning — set that expectation before touching it.',
      'Moisture accelerates the delamination.',
    ],
    recommendedMethod:
      'Dry wipe only — no extraction, no encapsulation. Photograph any existing peeling BEFORE touching it and tell the customer it will keep peeling regardless.',
  },
  {
    // Real leather is a service Sasquatch sells — it just is not extraction.
    terms: ['leather', 'top grain', 'full grain', 'aniline', 'nubuck', 'suede'],
    fiber: 'Leather',
    verdict: 'low_moisture',
    warnings: [
      'Never extract or saturate. Water staining and stiffening are permanent.',
      'Nubuck and suede are napped — water spots them instantly; these are specialist items.',
    ],
    recommendedMethod:
      'Leather cleaner on the cloth, not the hide, then condition. Never run the wand over leather.',
  },
  {
    terms: ['sheepskin', 'cowhide', 'hide rug', 'animal hide'],
    fiber: 'Hide / sheepskin',
    verdict: 'do_not_wet_clean',
    warnings: [
      'The leather backing shrinks and stiffens permanently once wet.',
    ],
    recommendedMethod: 'Dry vacuum only. Take it off the invoice — neither of our methods is safe on a hide.',
  },
  {
    terms: ['haitian cotton'],
    fiber: 'Haitian cotton',
    verdict: 'do_not_wet_clean',
    warnings: [
      'Notorious for browning — assume it WILL brown, not that it might.',
    ],
    recommendedMethod:
      'Do not extract. Encapsulation still risks browning on Haitian cotton — take it off the invoice and document it.',
  },
  {
    // Brands, not fibres. Listed so a brand-only tag still gets a right answer.
    terms: ['crypton'],
    fiber: 'Crypton (performance fabric, moisture barrier)',
    verdict: 'go',
    warnings: [
      'NEVER use bleach or solvents on Crypton — it is built from many different base fibres.',
    ],
    recommendedMethod:
      'Water-based cleaning and hot water extraction are approved by the manufacturer.',
  },
  {
    terms: ['sunbrella'],
    fiber: 'Sunbrella (solution-dyed acrylic)',
    verdict: 'go',
    warnings: [
      'Air dry only — never apply heat.',
      'Unusually, dilute bleach IS approved by the manufacturer for stubborn stains.',
    ],
    recommendedMethod:
      'Water-based cleaning. Rinse thoroughly and air dry.',
  },
  {
    terms: ['revolution fabric', 'revolution performance'],
    fiber: 'Revolution (olefin/polypropylene performance fabric)',
    verdict: 'go',
    warnings: ['Heat sensitive — keep the solution temperature moderate.'],
    recommendedMethod: 'Water-based cleaning; bleach-cleanable if needed.',
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
      'Do not extract and do not spot it. Dry vacuum only, take it off the invoice and document it. If any spotter has already been applied, stop and photograph it now.',
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
      'Encapsulation with a cool solution. No CRB on the pile. Air dry and groom.',
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
      'Do not extract. Dry vacuum only, take it off the invoice and refer it out. Note that "art silk" / "faux silk" is viscose, not silk — same answer either way.',
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
      'Do not extract. Dry vacuum only and take it off the invoice. Encapsulation still carries browning risk here — do not offer it as a workaround.',
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
      'Encapsulation with the 19" bonnet is the safe call. If extracting, light Hydro-Force pass, no flooding, plenty of dry strokes, air movers on it immediately.',
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
      'Encapsulation, or a light extraction with fast forced-air drying. Keep it dry enough that nothing wicks. Anti-browning agent if one is in stock.',
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
      'Standard hot water extraction is fine — wool is our bread and butter. Neutral to mildly acidic, 120°F cap, CRB gently, thorough rinse, fast dry.',
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
      'Vacuum with the upholstery tool only. No prespray, no encapsulation, no extraction. This is the one code we do not clean.',
  },
  {
    // W/S and SW mean either method is acceptable — still test first.
    pattern: /\b(?:cleaning\s*)?code[\s:.\-]*(?:w\s*\/?\s*s|s\s*\/?\s*w)\b/i,
    code: 'W/S',
    verdict: 'go',
    warnings: [
      'W/S allows water or solvent, but the tag is not a substitute for testing an inconspicuous area first.',
    ],
    recommendedMethod:
      'Water-based cleaning is acceptable. Pre-test a hidden area for dye stability before full application.',
  },
  {
    pattern: /\b(?:cleaning\s*)?code[\s:.\-]*s\b/i,
    code: 'S',
    verdict: 'low_moisture',
    warnings: [
      'Code S is solvent only — water will ring, shrink, or stain this fabric.',
    ],
    recommendedMethod:
      'We do not run solvent. Encapsulation with the 19" bonnet is the call here. Hot water extraction has worked on S-code fabric in this shop, but pre-test a hidden area for dye bleed first and keep the moisture down.',
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
