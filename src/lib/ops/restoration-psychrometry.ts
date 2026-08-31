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

export type AirRole =
  | 'affected'
  | 'unaffected'
  | 'outside'
  | 'dehu_intake'
  | 'dehu_outlet'

export const AIR_ROLES: Array<{ value: AirRole; label: string; hint: string }> = [
  { value: 'affected', label: 'Affected area', hint: 'inside the drying chamber' },
  { value: 'unaffected', label: 'Unaffected area', hint: 'a dry room in the same building' },
  { value: 'outside', label: 'Outside', hint: 'ambient, outdoors' },
  { value: 'dehu_intake', label: 'Dehu intake', hint: 'air going in' },
  { value: 'dehu_outlet', label: 'Dehu outlet', hint: 'air coming out' },
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
 * Grain depression is intake GPP minus outlet GPP. Published guidance puts a
 * healthy LGR at 30–50 GPP of depression, with conventional units struggling to
 * hold 20.
 *
 * The important subtlety: **low depression on dry air is not a fault.** A dehu
 * fed 35 GPP air cannot pull 30 out of it, and flagging that would send Charles
 * to check a machine that is working perfectly on a job that is nearly finished.
 * So the complaint is only raised while the intake air is still wet.
 */
export function dehumidifierVerdict(intake: Reading, outlet: Reading): Verdict {
  const intakeGpp =
    intake.tempF != null && intake.rhPct != null
      ? grainsPerPound(intake.tempF, intake.rhPct)
      : null
  const outletGpp =
    outlet.tempF != null && outlet.rhPct != null
      ? grainsPerPound(outlet.tempF, outlet.rhPct)
      : null

  if (intakeGpp == null || outletGpp == null) {
    return {
      status: 'unknown',
      headline: 'No dehumidifier check',
      detail: 'Log an intake and an outlet reading to see whether it is pulling water.',
    }
  }

  const depression = Math.round((intakeGpp - outletGpp) * 10) / 10

  if (depression >= 30) {
    return {
      status: 'good',
      headline: `Pulling ${depression} GPP`,
      detail: `Intake ${intakeGpp} GPP, outlet ${outletGpp} GPP. Working as an LGR should.`,
    }
  }

  if (depression >= 15) {
    return {
      status: intakeGpp > 60 ? 'watch' : 'good',
      headline: `Pulling ${depression} GPP`,
      detail:
        intakeGpp > 60
          ? `Intake is still wet at ${intakeGpp} GPP; a healthy LGR should be pulling 30 or more from air this damp.`
          : `Intake ${intakeGpp} GPP, outlet ${outletGpp} GPP. Reasonable for air this dry.`,
    }
  }

  // Low depression on already-dry air is the machine having little left to do.
  if (intakeGpp <= 40) {
    return {
      status: 'good',
      headline: `Little left to pull (${depression} GPP)`,
      detail: `Intake is already down to ${intakeGpp} GPP. Low depression here means the air is dry, not that the unit is failing.`,
    }
  }

  return {
    status: 'problem',
    headline: `Only ${depression} GPP of depression`,
    detail: `Intake is ${intakeGpp} GPP and the outlet is ${outletGpp} GPP. On air this wet the unit should be pulling far more — check the filter, the coils, and that it is actually running.`,
  }
}

/**
 * Is the chamber drier than what is outside it?
 *
 * If the affected air holds more water than the outside air, the dehumidifiers
 * are losing to the building — or the cheaper answer applies and you can
 * ventilate instead of renting equipment for another day.
 */
export function chamberVerdict(affected: Reading, reference: Reading): Verdict {
  const inside =
    affected.tempF != null && affected.rhPct != null
      ? grainsPerPound(affected.tempF, affected.rhPct)
      : null
  const out =
    reference.tempF != null && reference.rhPct != null
      ? grainsPerPound(reference.tempF, reference.rhPct)
      : null

  if (inside == null || out == null) {
    return {
      status: 'unknown',
      headline: 'No chamber comparison',
      detail: 'Log the affected area and one outside or unaffected reading.',
    }
  }

  const difference = Math.round((inside - out) * 10) / 10

  // Outside air changes day to day. Comparing today's chamber against a
  // reference taken on Tuesday is still worth saying, but the reader has to
  // know that is what happened — this appears in a claim file.
  const stale =
    sameDay(affected.takenAt, reference.takenAt)
      ? ''
      : ' Reference reading is from a different day.'

  if (difference <= 0) {
    return {
      status: 'good',
      headline: 'Chamber is drier than the reference air',
      detail: `Affected ${inside} GPP against ${out} GPP. The equipment is winning.${stale}`,
    }
  }

  if (difference <= 10) {
    return {
      status: 'watch',
      headline: `Chamber is ${difference} GPP wetter`,
      detail: `Affected ${inside} GPP against ${out} GPP. Closing, but not there yet.${stale}`,
    }
  }

  return {
    status: 'problem',
    headline: `Chamber is ${difference} GPP wetter than the reference air`,
    detail: `Affected ${inside} GPP against ${out} GPP. Either the equipment is not keeping up, or the chamber is open to somewhere wet.${stale}`,
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
