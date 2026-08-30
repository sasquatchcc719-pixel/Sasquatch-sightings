/**
 * Initial drying plan, per ANSI/IICRC S500.
 *
 * Sources, both read directly rather than recalled:
 *  - Air movers: ANSI/IICRC S500-2021 §12.5.3 "Controlling Airflow", pp. 67-68.
 *  - Dehumidification: IICRC "Initial Dehumidification Recommendation Factors and
 *    Formulas", Imperial, revision 3.1.22.
 *
 * These are INITIAL recommendations. S500 is explicit that the actual number
 * varies with build-out density, obstructions and the materials involved, and
 * that drying is verified by readings rather than by the formula. What gets
 * billed is always the equipment actually placed on the job.
 */

export type LossClass = 1 | 2 | 3 | 4
export type DehumidifierType = 'lgr' | 'conventional' | 'desiccant'

/**
 * S500 gives a range for air-mover spacing because a cluttered room needs more
 * airflow than an open one. Density picks a point in that range.
 */
export type AirflowDensity = 'open' | 'normal' | 'dense'

/** IICRC Initial Dehumidification factor chart, Imperial rev 3.1.22. */
export const DEHU_FACTORS: Record<DehumidifierType, Record<LossClass, number | null>> = {
  conventional: { 1: 100, 2: 40, 3: 30, 4: null },
  lgr: { 1: 100, 2: 50, 3: 40, 4: 40 },
  // Desiccant is sized by air changes per hour, not pints.
  desiccant: { 1: 1, 2: 2, 3: 3, 4: 3 },
}

/** S500 §12.5.3: one air mover per 50-70 sf of affected wet floor, per room. */
const FLOOR_SQFT_PER_AIR_MOVER: Record<AirflowDensity, number> = {
  open: 70,
  normal: 60,
  dense: 50,
}

/** S500 §12.5.3: one per 100-150 sf of wet ceiling and wall above ~2 ft. */
const WALL_CEILING_SQFT_PER_AIR_MOVER: Record<AirflowDensity, number> = {
  open: 150,
  normal: 125,
  dense: 100,
}

/** S500 §12.5.3: a room under 25 sf may need only one air mover. */
const SMALL_ROOM_SQFT = 25

export type AreaInput = {
  name?: string
  affectedSqft: number | null
  ceilingHeightFt: number | null
  /** Wet ceiling and wall above ~2 ft. */
  affectedWallCeilingSqft?: number | null
  /** Wall insets and offsets greater than 18 inches. */
  insetsOffsets?: number | null
}

export type AreaAirMovers = {
  name: string
  perRoom: number
  forFloor: number
  forWallCeiling: number
  forInsets: number
  total: number
}

export type DryingSuggestion = {
  totalAffectedSqft: number
  totalCubicFt: number
  airMovers: number
  perArea: AreaAirMovers[]
  /** Null for Class 4 on a conventional unit, which the chart marks N/A. */
  dehumidifierPintsPerDay: number | null
  dehuFactor: number | null
  suggestedDehu: 'DHM>' | 'DHM>>' | null
  dehuCount: number
  /** Desiccant sizing is CFM, not pints. */
  desiccantCfm: number | null
}

/**
 * AHAM ratings for the two units Charles runs, taken as the LOW end of each
 * Xactimate band. Erring low means the plan never under-sizes.
 */
const SMALL_DEHU_AHAM = 70 // DHM>  (70-109 ppd band)
const LARGE_DEHU_AHAM = 110 // DHM>> (110-159 ppd band)

export function buildDryingPlan(
  areas: AreaInput[],
  options: {
    lossClass?: LossClass | null
    dehuType?: DehumidifierType
    density?: AirflowDensity
  } = {},
): DryingSuggestion {
  const lossClass = (options.lossClass ?? 2) as LossClass
  const dehuType = options.dehuType ?? 'lgr'
  const density = options.density ?? 'normal'

  const floorPer = FLOOR_SQFT_PER_AIR_MOVER[density]
  const wallPer = WALL_CEILING_SQFT_PER_AIR_MOVER[density]

  let totalAffectedSqft = 0
  let totalCubicFt = 0
  const perArea: AreaAirMovers[] = []

  for (const area of areas) {
    const sqft = Number(area.affectedSqft ?? 0)
    if (!Number.isFinite(sqft) || sqft <= 0) continue

    const height = Number(area.ceilingHeightFt ?? 8) || 8
    totalAffectedSqft += sqft
    totalCubicFt += sqft * height

    const wallCeiling = Math.max(0, Number(area.affectedWallCeilingSqft ?? 0) || 0)
    const insets = Math.max(0, Math.floor(Number(area.insetsOffsets ?? 0) || 0))

    // "install one airmover in each affected room. In addition, add one..."
    const perRoom = 1
    // A small room may be adequately served by the single room air mover alone.
    const isSmallRoom = sqft < SMALL_ROOM_SQFT && wallCeiling === 0 && insets === 0
    const forFloor = isSmallRoom ? 0 : Math.ceil(sqft / floorPer)
    const forWallCeiling = wallCeiling > 0 ? Math.ceil(wallCeiling / wallPer) : 0
    const forInsets = insets

    perArea.push({
      name: area.name ?? 'Area',
      perRoom,
      forFloor,
      forWallCeiling,
      forInsets,
      total: perRoom + forFloor + forWallCeiling + forInsets,
    })
  }

  totalAffectedSqft = Math.round(totalAffectedSqft * 100) / 100
  totalCubicFt = Math.round(totalCubicFt)
  const airMovers = perArea.reduce((sum, a) => sum + a.total, 0)

  const factor = DEHU_FACTORS[dehuType][lossClass]

  if (dehuType === 'desiccant') {
    // Cubic Footage x ACH / 60 = Total CFM
    const cfm = factor ? Math.ceil((totalCubicFt * factor) / 60) : null
    return {
      totalAffectedSqft,
      totalCubicFt,
      airMovers,
      perArea,
      dehumidifierPintsPerDay: null,
      dehuFactor: factor,
      suggestedDehu: null,
      dehuCount: 0,
      desiccantCfm: cfm,
    }
  }

  // Cubic Footage / Chart Factor = Total PPD / AHAM rating = number of units
  const ppd = factor && totalCubicFt > 0 ? Math.ceil(totalCubicFt / factor) : null

  let suggestedDehu: DryingSuggestion['suggestedDehu'] = null
  let dehuCount = 0
  if (ppd && ppd > 0) {
    if (ppd <= SMALL_DEHU_AHAM) {
      suggestedDehu = 'DHM>'
      dehuCount = 1
    } else {
      suggestedDehu = 'DHM>>'
      dehuCount = Math.ceil(ppd / LARGE_DEHU_AHAM)
    }
  }

  return {
    totalAffectedSqft,
    totalCubicFt,
    airMovers,
    perArea,
    dehumidifierPintsPerDay: ppd,
    dehuFactor: factor,
    suggestedDehu,
    dehuCount,
    desiccantCfm: null,
  }
}

/**
 * The alternative in S500 §12.5.3 for losses that mainly wet the lower wall with
 * little floor migration: one air mover per 14 affected linear feet of wall.
 * Explicitly NOT to be combined with the square-foot calculation.
 */
export function airMoversByWallLength(affectedWallLinearFt: number): number {
  const feet = Number(affectedWallLinearFt)
  if (!Number.isFinite(feet) || feet <= 0) return 0
  return Math.ceil(feet / 14)
}
