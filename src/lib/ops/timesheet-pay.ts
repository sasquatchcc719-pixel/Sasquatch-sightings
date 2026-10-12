export function parseHourlyRate(value: unknown): number | null {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) return null
  return Math.round((rate + Number.EPSILON) * 100) / 100
}

export function mountainDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

export function mountainLocalDateTimeToIso(
  dateValue: string,
  timeValue: string,
): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue)
  if (!dateMatch || !timeMatch) return null

  const [, yearText, monthText, dayText] = dateMatch
  const [, hourText, minuteText] = timeMatch
  const expected = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
  }

  if (
    expected.month < 1 ||
    expected.month > 12 ||
    expected.day < 1 ||
    expected.day > 31 ||
    expected.hour > 23 ||
    expected.minute > 59
  ) {
    return null
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const desiredUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
  )

  let candidateMs = desiredUtc
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidateMs))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    )
    const representedUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    )
    candidateMs += desiredUtc - representedUtc
  }

  const finalParts = Object.fromEntries(
    formatter
      .formatToParts(new Date(candidateMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  const matches = Object.entries(expected).every(
    ([key, value]) => finalParts[key] === value,
  )

  return matches ? new Date(candidateMs).toISOString() : null
}

export type SemiMonthlyPayPeriod = {
  startDate: string
  endDate: string
  label: string
}

function dateKey(year: number, month: number, day: number): string {
  const normalized = new Date(Date.UTC(year, month - 1, day))
  return [
    String(normalized.getUTCFullYear()).padStart(4, '0'),
    String(normalized.getUTCMonth() + 1).padStart(2, '0'),
    String(normalized.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

export function getSemiMonthlyPayPeriod(value: string): SemiMonthlyPayPeriod {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) throw new Error('Invalid pay period date')

  // The new schedule starts October 11, 2026. Keep earlier payroll intact
  // and isolate October 1–10 so the transition never overlaps a regular run.
  if (value >= '2026-10-11') {
    if (day >= 11 && day <= 24) {
      return {
        startDate: dateKey(year, month, 11),
        endDate: dateKey(year, month, 24),
        label: '11th through 24th',
      }
    }
    return {
      startDate: dateKey(year, day <= 10 ? month - 1 : month, 25),
      endDate: dateKey(year, day <= 10 ? month : month + 1, 10),
      label: '25th through 10th',
    }
  }
  if (value >= '2026-10-01') {
    return {
      startDate: '2026-10-01',
      endDate: '2026-10-10',
      label: 'Transition: 1st through 10th',
    }
  }

  if (day <= 15) {
    return {
      startDate: dateKey(year, month, 1),
      endDate: dateKey(year, month, 15),
      label: '1st through 15th',
    }
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    startDate: dateKey(year, month, 16),
    endDate: dateKey(year, month, lastDay),
    label: '16th through end of month',
  }
}

export function shiftSemiMonthlyPayPeriod(
  value: string,
  offset: -1 | 1,
): SemiMonthlyPayPeriod {
  const current = getSemiMonthlyPayPeriod(value)
  const boundary = offset === 1 ? current.endDate : current.startDate
  const [year, month, day] = boundary.split('-').map(Number)
  return getSemiMonthlyPayPeriod(dateKey(year, month, day + offset))
}
