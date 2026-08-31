/**
 * Atmospheric readings, and what they say about the job.
 *
 * Moisture meters tell you the material is wet. Psychrometry tells you whether
 * the equipment is doing anything about it — and it is the half most likely to
 * be missing when a job stalls for four days and nobody knows why.
 *
 * Three questions this answers, which are the three a monitor visit exists to
 * ask:
 *
 *   1. Is the dehumidifier actually pulling water? (grain depression across it)
 *   2. Is the chamber drier than the air outside it? (otherwise open a window
 *      and save the rental)
 *   3. Is the chamber getting drier day over day, or has it stalled?
 */

import {
  DEHU_MODELS,
  DEFAULT_DEHU_MODEL,
  expectedDepression,
  type DehuModel,
} from '@/lib/ops/restoration-dehu-specs'

export type AirRole =
  | 'affected'
  | 'unaffected'
  | 'outside'
  /** Kept so readings logged before the intake was dropped still resolve. */
  | 'dehu_intake'
  | 'dehu_outlet'

/**
 * What you can log.
 *
 * There is no dehumidifier intake here on purpose. The air going into a dehu IS
 * the room air — Charles: *"we don't need the intake, it's just gonna be
 * whatever the room is"* — and the trade computes grain depression exactly that
 * way, as affected-area GPP minus the air coming out. Asking for it twice was
 * asking for the same reading under two names, and it left the depression
 * uncomputable whenever only one of them got logged.
 */
export const AIR_ROLES: Array<{ value: AirRole; label: string; hint: string }> = [
  { value: 'affected', label: 'Affected area', hint: 'inside the drying chamber' },
  { value: 'unaffected', label: 'Unaffected area', hint: 'a dry room in the same building' },
  { value: 'outside', label: 'Outside', hint: 'ambient, outdoors' },
  { value: 'dehu_outlet', label: 'Dehu outlet', hint: 'air coming out of the unit' },
]

/**
 * Grains of water per pound of dry air.
 *
 * Magnus-Tetens saturation vapour pressure, then the humidity ratio, then
 * grains. Standard sea-level pressure is used deliberately: field
 * thermo-hygrometers compute GPP the same way, and a number here that disagreed
 * with the one on the meter in Charles's hand would be worse than useless, even
 * if it were more truthful about Monument's elevation.
 */
export function grainsPerPound(tempF: number, rhPct: number): number | null {
  if (!Number.isFinite(tempF) || !Number.isFinite(rhPct)) return null
  if (rhPct < 0 || rhPct > 100) return null

  const tempC = ((tempF - 32) * 5) / 9
  const saturationHpa = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5))
  const vapourHpa = saturationHpa * (rhPct / 100)
  const pressureHpa = 1013.25
  if (vapourHpa >= pressureHpa) return null

  const humidityRatio = (0.62198 * vapourHpa) / (pressureHpa - vapourHpa)
  return Math.round(humidityRatio * 7000 * 10) / 10
}

/** Dew point in °F — below the surface temperature is where condensation starts. */
export function dewPointF(tempF: number, rhPct: number): number | null {
  if (!Number.isFinite(tempF) || !Number.isFinite(rhPct) || rhPct <= 0 || rhPct > 100) {
    return null
  }
  const tempC = ((tempF - 32) * 5) / 9
  const gamma =
    (17.67 * tempC) / (tempC + 243.5) + Math.log(rhPct / 100)
  const dewC = (243.5 * gamma) / (17.67 - gamma)
  return Math.round(((dewC * 9) / 5 + 32) * 10) / 10
}

export type Reading = {
  role: AirRole | null
  tempF: number | null
  rhPct: number | null
  takenAt: string
}

export type Verdict = {
  status: 'good' | 'watch' | 'problem' | 'unknown'
  headline: string
  detail: string
}

/**
 * Is the dehumidifier working?
 *
 * Judged against **the machine**, not against a number from a magazine. A
 * Phoenix 200 HT is rated 28.3 GPP of depression at AHAM, and less than that on
 * drier air, so demanding "30 or more" asked it for something it cannot do —
 * which is exactly what Charles was seeing.
 *
 * What remains worth interrupting him for is a unit doing almost nothing on air
 * that still has water in it: a clogged filter, an iced coil, or a machine that
 * is not running. Everything between that and its rating is a number to read,
 * not a verdict to argue with.
 */
export function dehumidifierVerdict(
  roomAir: Reading,
  outlet: Reading,
  model: DehuModel = DEHU_MODELS[DEFAULT_DEHU_MODEL],
): Verdict {
  const intakeGpp =
    roomAir.tempF != null && roomAir.rhPct != null
      ? grainsPerPound(roomAir.tempF, roomAir.rhPct)
      : null
  const outletGpp =
    outlet.tempF != null && outlet.rhPct != null
      ? grainsPerPound(outlet.tempF, outlet.rhPct)
      : null

  if (intakeGpp == null || outletGpp == null) {
    return {
      status: 'unknown',
      headline: 'No dehumidifier check',
      detail:
        'Log the affected area and one dehu outlet reading to see whether it is pulling water.',
    }
  }

  const depression = Math.round((intakeGpp - outletGpp) * 10) / 10
  const expected = expectedDepression(model, intakeGpp)
  const share = expected > 0 ? depression / expected : 1

  const arithmetic = `Room ${intakeGpp} GPP, out ${outletGpp} GPP. A ${model.name} on air this wet is good for about ${expected}.`

  if (share >= 0.85) {
    return {
      status: 'good',
      headline: `Pulling ${depression} GPP`,
      detail: arithmetic,
    }
  }

  if (share >= 0.5) {
    return {
      status: 'good',
      headline: `Pulling ${depression} GPP`,
      detail: `${arithmetic} Below its rating, which is normal as a room dries out.`,
    }
  }

  // Little coming out of air that still holds water: worth walking over to.
  if (intakeGpp >= 50) {
    return {
      status: 'problem',
      headline: `Only ${depression} GPP of depression`,
      detail: `${arithmetic} That is far short on air this wet — check the filter, the coils, and that it is actually running.`,
    }
  }

  return {
    status: 'good',
    headline: `Pulling ${depression} GPP`,
    detail: `${arithmetic} Low depression on air this dry means there is little left to take.`,
  }
}

/**
 * Are we at the dry goal?
 *
 * The goal is the **unaffected air in the same building** — that is what the
 * S500 means by a dry standard, and it is the only comparison that says the
 * chamber has caught up with the rest of the house.
 *
 * Outside is deliberately NOT the yardstick. Charles: *"outside literally means
 * the air outside, which honestly is a metric that almost nobody really uses,
 * but we always record it anyway."* It swings with the weather, it has no
 * bearing on what a basement should read, and using it as the goal produced
 * confident nonsense — a chamber can be "drier than outside" on a humid day and
 * still be soaking. It is recorded for the file, and used for exactly one real
 * decision: whether opening the building would beat renting equipment.
 */
export function dryGoalVerdict(affected: Reading, unaffected: Reading): Verdict {
  const inside =
    affected.tempF != null && affected.rhPct != null
      ? grainsPerPound(affected.tempF, affected.rhPct)
      : null
  const goal =
    unaffected.tempF != null && unaffected.rhPct != null
      ? grainsPerPound(unaffected.tempF, unaffected.rhPct)
      : null

  if (inside == null) {
    return {
      status: 'unknown',
      headline: 'No affected-area reading',
      detail: 'Log the air in the drying chamber.',
    }
  }
  if (goal == null) {
    return {
      status: 'unknown',
      headline: 'No dry goal to compare against',
      detail:
        'Log an unaffected area — a dry room in the same building. That is the number the chamber has to reach; outside air is not it.',
    }
  }

  const over = Math.round((inside - goal) * 10) / 10
  const stale = sameDay(affected.takenAt, unaffected.takenAt)
    ? ''
    : ' Unaffected reading is from a different day.'

  if (over <= 0) {
    return {
      status: 'good',
      headline: 'Chamber has reached the dry goal',
      detail: `Affected ${inside} GPP against ${goal} GPP unaffected. The air is where it needs to be — materials decide the rest.${stale}`,
    }
  }
  if (over <= 5) {
    return {
      status: 'watch',
      headline: `${over} GPP above the dry goal`,
      detail: `Affected ${inside} GPP against ${goal} GPP unaffected. Close.${stale}`,
    }
  }
  return {
    status: 'problem',
    headline: `${over} GPP above the dry goal`,
    detail: `Affected ${inside} GPP against ${goal} GPP unaffected. The chamber is still holding water the rest of the building is not.${stale}`,
  }
}

/**
 * The one decision outside air actually informs.
 *
 * If the air outside holds less water than the chamber, opening the building
 * moves more water than another day of rental does. Worth saying; not worth
 * treating as the goal.
 */
export function ventilationNote(affected: Reading, outside: Reading): Verdict | null {
  const inside =
    affected.tempF != null && affected.rhPct != null
      ? grainsPerPound(affected.tempF, affected.rhPct)
      : null
  const out =
    outside.tempF != null && outside.rhPct != null
      ? grainsPerPound(outside.tempF, outside.rhPct)
      : null
  if (inside == null || out == null) return null

  const difference = Math.round((inside - out) * 10) / 10
  if (difference < 10) return null

  return {
    status: 'watch',
    headline: `Outside air is ${difference} GPP drier`,
    detail: `Chamber ${inside} GPP against ${out} GPP outside. Opening up would move water faster than the equipment is — worth considering if the weather holds.`,
  }
}

/** Has the affected air actually dried out since the last visit? */
export function trendVerdict(readings: Reading[]): Verdict {
  const series = readings
    .filter((r) => r.role === 'affected' && r.tempF != null && r.rhPct != null)
    .map((r) => ({
      gpp: grainsPerPound(r.tempF as number, r.rhPct as number),
      takenAt: r.takenAt,
    }))
    .filter((r): r is { gpp: number; takenAt: string } => r.gpp != null)
    .sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime())

  if (series.length < 2) {
    return {
      status: 'unknown',
      headline: 'Not enough readings to show a trend',
      detail: 'Two visits of affected-area readings show whether the air is drying.',
    }
  }

  const first = series[0].gpp
  const last = series[series.length - 1].gpp
  const change = Math.round((first - last) * 10) / 10

  if (change >= 5) {
    return {
      status: 'good',
      headline: `Down ${change} GPP since the first reading`,
      detail: `${first} GPP to ${last} GPP. The chamber is drying.`,
    }
  }

  if (change > 0) {
    return {
      status: 'watch',
      headline: `Down only ${change} GPP`,
      detail: `${first} GPP to ${last} GPP. Slower than it should be — check equipment placement and whether the chamber is sealed.`,
    }
  }

  return {
    status: 'problem',
    headline: change === 0 ? 'No change in the air' : `Up ${Math.abs(change)} GPP`,
    detail: `${first} GPP to ${last} GPP. Drying has stalled: water is still coming from somewhere, or the equipment is not working.`,
  }
}

/** Same local calendar day, so a morning and an afternoon reading pair up. */
function sameDay(a: string, b: string): boolean {
  if (!a || !b) return false
  const da = new Date(a)
  const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}
