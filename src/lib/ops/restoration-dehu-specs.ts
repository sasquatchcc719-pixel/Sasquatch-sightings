/**
 * What a specific dehumidifier can actually do.
 *
 * The old verdict said "a healthy LGR should be pulling 30 or more", taken from
 * trade press describing what LGRs are capable of in general. Charles pushed
 * back — *"where are you getting these thresholds... I'm having to dial in
 * numbers that I don't think I've ever achieved"* — and asked the better
 * question: look up the machine he actually owns.
 *
 * A Phoenix 200 HT is rated 140 pints/day at AHAM (80°F, 60% RH) with 335 CFM
 * of process air. That fixes the grain depression it can produce, because the
 * water it removes has to come out of the air it moves:
 *
 *     140 pints/day x 1.0432 lb/pint / 24        = 6.09 lb water per hour
 *     6.09 lb x 7000 grains/lb                   = 42,600 grains per hour
 *     335 CFM x 60 min x 0.075 lb/ft3            = 1,508 lb of dry air per hour
 *     42,600 / 1,508                             = 28.3 GPP
 *
 * So his machine, at its rated best, produces about **28 GPP** — less than the
 * 30 the old banner demanded, and that rating is measured at 92 GPP intake,
 * much wetter than the room he was drying. Twenty-six GPP off 69 GPP air is a
 * machine doing its job well, and the software was calling it marginal.
 *
 * Sources: Phoenix 200 HT owner's manual (TS-302) and spec sheet, usephoenix.com.
 */

export type DehuModel = {
  name: string
  /** Pints per day at AHAM: 80°F, 60% RH — which is 92 GPP of intake air. */
  pintsPerDayAham: number
  /** Process airflow. */
  cfm: number
  note?: string
}

/** AHAM rating conditions, in grains per pound. */
export const AHAM_INTAKE_GPP = 92

export const DEHU_MODELS: Record<string, DehuModel> = {
  'phoenix-200-ht': {
    name: 'Phoenix 200 HT',
    pintsPerDayAham: 140,
    cfm: 335,
    note: 'Xactimate WTRDHM>>',
  },
}

/** The default until a job says otherwise — the unit Charles owns. */
export const DEFAULT_DEHU_MODEL = 'phoenix-200-ht'

const LB_PER_PINT = 1.0432
const GRAINS_PER_LB = 7000
/** Standard air density, the same basis the CFM rating uses. */
const LB_PER_CUBIC_FOOT = 0.075

/**
 * Grain depression the unit produces at its rating, from first principles.
 *
 * Rounded to one decimal because the inputs are two significant figures; a
 * number carried further would look more certain than it is.
 */
export function ratedDepression(model: DehuModel): number {
  const waterLbPerHour = (model.pintsPerDayAham * LB_PER_PINT) / 24
  const grainsPerHour = waterLbPerHour * GRAINS_PER_LB
  const airLbPerHour = model.cfm * 60 * LB_PER_CUBIC_FOOT
  return Math.round((grainsPerHour / airLbPerHour) * 10) / 10
}

/**
 * What to expect from this machine on air of a given wetness.
 *
 * A dehumidifier cannot take out water that is not there: fed air drier than
 * AHAM, it removes less per pound, and its depression falls with it. Scaling
 * the rating by how the intake compares to AHAM is a straight-line
 * approximation of a curve that is not straight — it is close enough to tell a
 * working machine from a broken one, which is the only question being asked,
 * and it is honest about being an estimate.
 */
export function expectedDepression(model: DehuModel, intakeGpp: number): number {
  const rated = ratedDepression(model)
  if (!Number.isFinite(intakeGpp) || intakeGpp <= 0) return rated
  const ratio = Math.min(1, intakeGpp / AHAM_INTAKE_GPP)
  return Math.round(rated * ratio * 10) / 10
}
