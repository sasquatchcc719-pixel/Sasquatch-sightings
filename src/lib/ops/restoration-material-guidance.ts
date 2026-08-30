/**
 * Per-material salvage guidance, from EPA Table 1: "Water Damage — Cleanup and
 * Mold Prevention", in *Mold Remediation in Schools and Commercial Buildings*
 * (EPA 402-K-01-001), p. 11.
 *
 * Why this and not S500: the S500 is a paid standard we do not hold a copy of.
 * EPA Table 1 is published free, is authoritative, and answers the question that
 * actually drives the invoice — dry it in place, or tear it out. Every entry
 * below is quoted from that table rather than paraphrased.
 *
 * Two conditions in the table's own footnotes matter enough to be enforced in
 * the app rather than left in a footnote:
 *  - it applies to CLEAN water only; contaminated water requires PPE and
 *    containment, which OSHA requires
 *  - "Do not use fans before determining that the water is clean or sanitary"
 *  - past 48 hours, mold growth may have occurred and Table 2 applies instead
 */

export type SalvageDisposition = 'discard' | 'dry_in_place' | 'depends'

export type MaterialGuidance = {
  key: string
  label: string
  disposition: SalvageDisposition
  /** Quoted from EPA Table 1. */
  actions: string[]
  /** Restoration catalog concepts this points at. */
  suggests?: string[]
  note?: string
}

export const EPA_TABLE_1: MaterialGuidance[] = [
  {
    key: 'books_papers',
    label: 'Books and papers',
    disposition: 'discard',
    actions: [
      'For non-valuable items, discard books and papers.',
      'Photocopy valuable/important items, discard originals.',
      'Freeze (in frost-free freezer or meat locker) or freeze-dry.',
    ],
  },
  {
    key: 'carpet',
    label: 'Carpet and backing',
    disposition: 'dry_in_place',
    actions: [
      'Remove water with water extraction vacuum.',
      'Reduce ambient humidity levels with dehumidifier.',
      'Accelerate drying process with fans.',
    ],
    suggests: ['EXT', 'LIFT'],
    note: 'Dry within 24-48 hours. The subfloor beneath must also be cleaned and dried.',
  },
  {
    key: 'ceiling_tiles',
    label: 'Ceiling tiles',
    disposition: 'discard',
    actions: ['Discard and replace.'],
    suggests: ['ACT'],
  },
  {
    key: 'cellulose_insulation',
    label: 'Cellulose insulation',
    disposition: 'discard',
    actions: ['Discard and replace.'],
    suggests: ['INS'],
  },
  {
    key: 'concrete',
    label: 'Concrete or cinder block',
    disposition: 'dry_in_place',
    actions: [
      'Remove water with water extraction vacuum.',
      'Accelerate drying process with dehumidifiers, fans, and/or heaters.',
    ],
    suggests: ['EXTH'],
  },
  {
    key: 'fiberglass_insulation',
    label: 'Fiberglass insulation',
    disposition: 'discard',
    actions: ['Discard and replace.'],
    suggests: ['INS'],
  },
  {
    key: 'hard_porous_floor',
    label: 'Hard surface, porous flooring (linoleum, ceramic tile, vinyl)',
    disposition: 'dry_in_place',
    actions: [
      'Vacuum or damp wipe with water and mild detergent and allow to dry; scrub if necessary.',
      'Check to make sure underflooring is dry; dry underflooring if necessary.',
    ],
    suggests: ['EXTH'],
  },
  {
    key: 'non_porous',
    label: 'Non-porous, hard surfaces (plastics, metals)',
    disposition: 'dry_in_place',
    actions: [
      'Vacuum or damp wipe with water and mild detergent and allow to dry; scrub if necessary.',
    ],
  },
  {
    key: 'upholstered',
    label: 'Upholstered furniture',
    disposition: 'depends',
    actions: [
      'Remove water with water extraction vacuum.',
      'Accelerate drying process with dehumidifiers, fans, and/or heaters.',
      'May be difficult to completely dry within 48 hours. If the piece is valuable, you may wish to consult a restoration/water damage professional who specializes in furniture.',
    ],
  },
  {
    key: 'wallboard',
    label: 'Wallboard (drywall and gypsum board)',
    disposition: 'depends',
    actions: [
      'May be dried in place if there is no obvious swelling and the seams are intact. If not, remove, discard, and replace.',
      'Ventilate the wall cavity, if possible.',
    ],
    suggests: ['DRYWLF', 'DRYW4'],
    note: 'Swelling or open seams is the test — this is the call that decides a flood cut.',
  },
  {
    key: 'drapes',
    label: 'Window drapes',
    disposition: 'dry_in_place',
    actions: ['Follow laundering or cleaning instructions recommended by the manufacturer.'],
  },
  {
    key: 'wood',
    label: 'Wood surfaces',
    disposition: 'dry_in_place',
    actions: [
      'Remove moisture immediately and use dehumidifiers, gentle heat, and fans for drying. (Use caution when applying heat to hardwood floors.)',
      'Treated or finished wood surfaces may be cleaned with mild detergent and clean water and allowed to dry.',
      'Wet paneling should be pried away from wall for drying.',
    ],
  },
]

export function guidanceFor(key: string): MaterialGuidance | null {
  return EPA_TABLE_1.find((entry) => entry.key === key) ?? null
}

export type LossWarning = {
  severity: 'critical' | 'warning'
  title: string
  detail: string
  source: string
}

/**
 * Conditions from EPA Table 1's footnotes that change how a job must be run.
 * Surfaced on the job rather than buried, because both are safety calls that are
 * easy to get wrong at speed.
 */
export function warningsForLoss(params: {
  waterCategory: number | null
  hoursSinceLoss: number | null
}): LossWarning[] {
  const warnings: LossWarning[] = []
  const category = params.waterCategory ?? 1

  if (category >= 2) {
    warnings.push({
      severity: 'critical',
      title: 'Do not run air movers yet',
      detail:
        'EPA: do not use fans before determining that the water is clean or sanitary. On contaminated water, airflow spreads the contamination.',
      source: 'EPA Table 1, footnote',
    })
    warnings.push({
      severity: 'critical',
      title: 'PPE and containment required',
      detail:
        'Where water is contaminated with sewage, or chemical or biological pollutants, personal protective equipment and containment are required by OSHA.',
      source: 'EPA Table 1, footnote / OSHA',
    })
  }

  if (params.hoursSinceLoss != null && params.hoursSinceLoss > 48) {
    warnings.push({
      severity: 'warning',
      title: 'Past 48 hours — assume mold growth',
      detail:
        'Materials wet for more than 48 hours fall under EPA Table 2 rather than Table 1. Mold growth may have occurred, and drying in place may no longer be appropriate.',
      source: 'EPA Table 1, footnote',
    })
  }

  return warnings
}

/** Hours between the loss and now, for the 48-hour rule. */
export function hoursSince(lossAt: string | null): number | null {
  if (!lossAt) return null
  const then = new Date(lossAt).getTime()
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.round((Date.now() - then) / 3_600_000))
}
