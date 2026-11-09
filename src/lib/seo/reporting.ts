/** Pure reporting rules. Source adapters must supply verified provenance and dates. */
export type Period = { start: string; end: string }
const DAY = 86_400_000

export function dateKey(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expected YYYY-MM-DD')
  const parsed = new Date(value + 'T12:00:00Z')
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new Error('Invalid calendar date')
  return value
}
function shift(day: string, days: number): string {
  return new Date(new Date(dateKey(day) + 'T12:00:00Z').getTime() + days * DAY)
    .toISOString()
    .slice(0, 10)
}
/** Two non-overlapping complete calendar weeks, never a partial edge week.
 * finalizedThrough is the source's verified final-data date, NOT today's date.
 * Calendar dates stay in the source's declared timezone (GSC: America/Los_Angeles).
 */
export function completedWeeks(finalizedThrough: string): {
  current: Period
  previous: Period
} {
  const day = dateKey(finalizedThrough)
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay()
  const end = shift(day, -weekday)
  return {
    current: { start: shift(end, -6), end },
    previous: { start: shift(end, -13), end: shift(end, -7) },
  }
}
export type EvidenceState =
  | 'measured'
  | 'partial'
  | 'failed'
  | 'stale'
  | 'unavailable'
export type Measurement = {
  surface: 'maps' | 'organic' | 'business'
  metric: string
  /** Exact provider/property/query/device/geo/depth/method fingerprint. */
  method: string
  sourceRef: string
  sourceTimezone: string
  period: Period
  finalizedThrough: string | null
  collectedAt: string | null
  /** Absolute expiry set by the source's expected cadence, not a report-wide guess. */
  freshUntil: string | null
  expectedSamples: number
  observedSamples: number
  failed: boolean
  value: number | null
}
export function evidenceState(m: Measurement, now: Date): EvidenceState {
  if (m.failed) return 'failed'
  if (
    !m.sourceRef ||
    !m.method ||
    !m.sourceTimezone ||
    m.value == null ||
    !Number.isFinite(m.value) ||
    m.observedSamples === 0
  )
    return 'unavailable'
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid report time')
  dateKey(m.period.start)
  dateKey(m.period.end)
  if (m.period.start > m.period.end) throw new Error('Invalid period')
  if (
    !m.finalizedThrough ||
    dateKey(m.finalizedThrough) < m.period.end ||
    m.expectedSamples <= 0 ||
    m.observedSamples !== m.expectedSamples
  )
    return 'partial'
  const collected = Date.parse(m.collectedAt ?? '')
  const expires = Date.parse(m.freshUntil ?? '')
  if (
    !Number.isFinite(collected) ||
    !Number.isFinite(expires) ||
    collected > now.getTime()
  )
    return 'unavailable'
  return expires < now.getTime() ? 'stale' : 'measured'
}
export function compareMeasurements(
  current: Measurement,
  previous: Measurement,
  now: Date,
) {
  const currentState = evidenceState(current, now)
  const previousState = evidenceState(previous, now)
  const sameMethod =
    current.surface === previous.surface &&
    current.metric === previous.metric &&
    current.method === previous.method &&
    current.sourceTimezone === previous.sourceTimezone
  const duration = (p: Period) =>
    Date.parse(p.end + 'T12:00:00Z') - Date.parse(p.start + 'T12:00:00Z')
  const adjacentPeriods =
    shift(previous.period.end, 1) === current.period.start &&
    duration(current.period) === duration(previous.period)
  const comparable =
    sameMethod &&
    adjacentPeriods &&
    currentState === 'measured' &&
    previousState === 'measured'
  return {
    currentState,
    previousState,
    comparable,
    delta: comparable ? current.value! - previous.value! : null,
    percentChange:
      comparable && previous.value !== 0
        ? ((current.value! - previous.value!) / Math.abs(previous.value!)) * 100
        : null,
    note: !sameMethod
      ? 'Measurement methods differ; no trend conclusion.'
      : !adjacentPeriods
        ? 'Periods differ or overlap; no trend conclusion.'
        : !comparable
          ? 'Incomplete, failed, missing or stale evidence; no trend conclusion.'
          : 'Observed change, not proof that an intervention caused it.',
  }
}
export type WeeklyBrief = {
  period: Period
  results: Array<{
    surface: Measurement['surface']
    summary: string
    state: EvidenceState
    sourceRef: string
  }>
  workCompleted: string[]
  uncertainty: string[]
  nextActions: string[]
}
/** Deliberately short, mobile-readable text. No channel send or hidden collection. */
export function formatWeeklyBrief(brief: WeeklyBrief): string {
  const groups = (['maps', 'organic', 'business'] as const).map((surface) => {
    const rows = brief.results.filter((row) => row.surface === surface)
    return rows.length
      ? rows
          .map((row) => surface + ' [' + row.state + ']: ' + row.summary)
          .join('\n')
      : surface + ' [unavailable]: No verified evidence supplied.'
  })
  return [
    'SEO week: ' +
      dateKey(brief.period.start) +
      ' to ' +
      dateKey(brief.period.end),
    ...groups,
    'Completed: ' +
      (brief.workCompleted.slice(0, 3).join('; ') || 'No changes recorded.'),
    'Evidence: ' +
      (brief.uncertainty.slice(0, 2).join('; ') ||
        'Changes are observational, not proof of causation.'),
    'Next: ' +
      (brief.nextActions.slice(0, 2).join('; ') ||
        'Review the evidence before choosing changes.'),
  ].join('\n')
}
