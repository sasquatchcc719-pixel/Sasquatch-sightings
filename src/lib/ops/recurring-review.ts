import type {
  RecurringScheduleOccurrence,
  RecurringVisitOverrides,
} from './recurring-scheduling'

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/

export function validRecurringDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    datePattern.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  )
}

export function parseRecurringOverrides(
  value: unknown,
): RecurringVisitOverrides {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Visit adjustments must be a date-by-date list.')
  const entries = Object.entries(value)
  if (entries.length > 500)
    throw new Error('Preview no more than 500 visits at a time.')
  return Object.fromEntries(
    entries.map(([original, raw]) => {
      const visit = raw as { date?: unknown; start_time?: unknown } | null
      if (
        !validRecurringDate(original) ||
        !validRecurringDate(visit?.date) ||
        typeof visit?.start_time !== 'string' ||
        !timePattern.test(visit.start_time)
      ) {
        throw new Error(
          'Each adjusted visit needs a valid date and start time.',
        )
      }
      return [
        original,
        { date: visit.date, start_time: visit.start_time.slice(0, 5) },
      ]
    }),
  )
}

export function recurringReviewMatches(
  reviewed: unknown,
  current: RecurringScheduleOccurrence[],
): boolean {
  if (
    !Array.isArray(reviewed) ||
    reviewed.some((row) => !row || typeof row !== 'object') ||
    reviewed.length !== current.length ||
    !current.length ||
    current.some((visit) => visit.status !== 'clear')
  )
    return false
  const normalize = (rows: Array<Partial<RecurringScheduleOccurrence>>) =>
    rows
      .map((row) => [
        row.original_date,
        row.date,
        row.start_time?.slice(0, 5),
        row.end_time?.slice(0, 5),
        row.status,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return (
    new Set(reviewed.map((row) => row?.original_date)).size ===
      current.length &&
    JSON.stringify(normalize(reviewed)) === JSON.stringify(normalize(current))
  )
}

export function freezeRecurringVisits(
  visits: RecurringScheduleOccurrence[],
  overrides: RecurringVisitOverrides,
): RecurringVisitOverrides {
  return {
    ...overrides,
    ...Object.fromEntries(
      visits
        .filter((visit) => visit.status === 'clear')
        .map((visit) => [
          visit.original_date,
          { date: visit.date, start_time: visit.start_time.slice(0, 5) },
        ]),
    ),
  }
}
