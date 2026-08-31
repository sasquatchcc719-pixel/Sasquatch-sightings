/**
 * Readings, arranged for drawing.
 *
 * A drying chart is the one artefact that shows a carrier the job was worked
 * rather than merely billed: five points falling toward their standard over
 * four days is an argument no invoice line makes. The shaping lives here rather
 * than in a component so the screen and the PDF plot identical numbers — a
 * chart that disagrees with itself between the office and the claim file is
 * worse than no chart.
 */

export type SeriesPoint = { dayIndex: number; value: number; takenAt: string }

export type DryingSeries = {
  label: string
  material: string | null
  dryStandard: number | null
  points: SeriesPoint[]
}

export type DryingChartModel = {
  series: DryingSeries[]
  /** Distinct calendar days, in order — the x axis. */
  days: string[]
  minValue: number
  maxValue: number
  /** True once at least two days carry a reading; one column is not a trend. */
  plottable: boolean
}

/**
 * The shop's timezone, not the server's.
 *
 * This chart and the report it feeds are rendered on Vercel, where the clock is
 * UTC. A reading taken at 7pm in Monument is already tomorrow in UTC, so
 * grouping by the server's day silently moves an evening reading to the next
 * column — and this report has shipped an off-by-one date once already.
 */
export const SHOP_TIME_ZONE = 'America/Denver'

/** Calendar day in Monument, so readings taken at 8am and 4pm share a column. */
function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  // en-CA gives YYYY-MM-DD, which sorts.
  return d.toLocaleDateString('en-CA', { timeZone: SHOP_TIME_ZONE })
}

export function buildDryingChart(
  points: Array<{
    label: string
    material: string | null
    dry_standard: number | null
    restoration_readings: Array<{ value: number | string; taken_at: string }>
  }>,
): DryingChartModel {
  const days = new Set<string>()
  for (const point of points) {
    for (const reading of point.restoration_readings ?? []) {
      days.add(dayKey(reading.taken_at))
    }
  }
  const dayList = [...days].sort()
  const dayIndex = new Map(dayList.map((d, i) => [d, i]))

  const series: DryingSeries[] = []
  let minValue = Number.POSITIVE_INFINITY
  let maxValue = Number.NEGATIVE_INFINITY

  for (const point of points) {
    const readings = [...(point.restoration_readings ?? [])].sort(
      (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime(),
    )
    if (readings.length === 0) continue

    // One reading per day per point: the last one taken that day, because a
    // re-read means the first was wrong or the equipment had just moved.
    const byDay = new Map<number, SeriesPoint>()
    for (const reading of readings) {
      const index = dayIndex.get(dayKey(reading.taken_at))
      if (index == null) continue
      const value = Number(reading.value)
      if (!Number.isFinite(value)) continue
      byDay.set(index, { dayIndex: index, value, takenAt: reading.taken_at })
      minValue = Math.min(minValue, value)
      maxValue = Math.max(maxValue, value)
    }

    if (point.dry_standard != null && Number.isFinite(Number(point.dry_standard))) {
      minValue = Math.min(minValue, Number(point.dry_standard))
    }

    series.push({
      label: point.label,
      material: point.material,
      dryStandard: point.dry_standard == null ? null : Number(point.dry_standard),
      points: [...byDay.values()].sort((a, b) => a.dayIndex - b.dayIndex),
    })
  }

  if (!Number.isFinite(minValue)) minValue = 0
  if (!Number.isFinite(maxValue)) maxValue = 0

  // A little headroom, and never a flat line pinned to the axis.
  const pad = Math.max(1, (maxValue - minValue) * 0.1)
  return {
    series,
    days: dayList,
    minValue: Math.max(0, Math.floor(minValue - pad)),
    maxValue: Math.ceil(maxValue + pad),
    plottable: dayList.length >= 2 && series.length > 0,
  }
}

/** Short axis label: "Aug 29". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  // Built from parts rather than parsed, since `new Date('2026-08-29')` is UTC
  // and renders as the 28th west of Greenwich — a bug this report has had once.
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}
