export function parseHourlyRate(value: unknown): number | null {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) return null
  return Math.round((rate + Number.EPSILON) * 100) / 100
}

export type OvertimeEntry = {
  staffUserId: string
  staffDisplayName: string
  workDate: string
  startedAt: string
  payableMinutes: number
  hourlyRate: number
}

export type OvertimeMethod = 'weekly' | 'daily' | 'consecutive'

export type OvertimeBreakdown = {
  key: string
  staffUserId: string
  staffDisplayName: string
  weekStart: string
  method: OvertimeMethod
  minutes: number
  hourlyRate: number
  baseCents: number
  premiumCents: number
}

export function getSundayWorkweek(value: string): {
  startDate: string
  endDate: string
} {
  const date = new Date(`${value}T00:00:00Z`)
  const start = new Date(date)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

export function calculatePayPeriodOvertime(
  entries: OvertimeEntry[],
  periodStartDate: string,
  periodEndDate: string,
): {
  minutes: number
  premiumCents: number
  breakdown: OvertimeBreakdown[]
} {
  const sorted = [...entries].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  )

  type Candidate = {
    staffUserId: string
    staffDisplayName: string
    weekStart: string
    minutes: number
    premiumCents: number
    periodRates: Map<
      number,
      { minutes: number; baseCents: number; premiumCents: number }
    >
  }

  function calculateRule(method: OvertimeMethod, thresholdMinutes: number) {
    const runningMinutes = new Map<string, number>()
    const candidates = new Map<string, Candidate>()

    sorted.forEach((entry, index) => {
      const weekStart = getSundayWorkweek(entry.workDate).startDate
      const weekKey = `${entry.staffUserId}:${weekStart}`
      const runningKey =
        method === 'weekly'
          ? weekKey
          : method === 'daily'
            ? `${weekKey}:${entry.workDate}`
            : `${weekKey}:${index}`
      const payableMinutes = Math.max(0, entry.payableMinutes)
      const previousMinutes = runningMinutes.get(runningKey) || 0
      const overtimeBefore = Math.max(0, previousMinutes - thresholdMinutes)
      const overtimeAfter = Math.max(
        0,
        previousMinutes + payableMinutes - thresholdMinutes,
      )
      const overtimeMinutes = overtimeAfter - overtimeBefore

      runningMinutes.set(runningKey, previousMinutes + payableMinutes)
      if (overtimeMinutes <= 0) return

      const candidate = candidates.get(weekKey) || {
        staffUserId: entry.staffUserId,
        staffDisplayName: entry.staffDisplayName,
        weekStart,
        minutes: 0,
        premiumCents: 0,
        periodRates: new Map(),
      }
      const premiumCents = Math.round(
        (overtimeMinutes / 60) * entry.hourlyRate * 0.5 * 100,
      )
      candidate.minutes += overtimeMinutes
      candidate.premiumCents += premiumCents
      if (
        entry.workDate >= periodStartDate &&
        entry.workDate <= periodEndDate
      ) {
        const rate = candidate.periodRates.get(entry.hourlyRate) || {
          minutes: 0,
          baseCents: 0,
          premiumCents: 0,
        }
        rate.baseCents += Math.round(
          (overtimeMinutes * Math.round(entry.hourlyRate * 100)) / 60,
        )
        rate.minutes += overtimeMinutes
        rate.premiumCents += premiumCents
        candidate.periodRates.set(entry.hourlyRate, rate)
      }
      candidates.set(weekKey, candidate)
    })

    return candidates
  }

  const weekly = calculateRule('weekly', 40 * 60)
  const daily = calculateRule('daily', 12 * 60)
  const consecutive = calculateRule('consecutive', 12 * 60)
  const weekKeys = new Set([
    ...weekly.keys(),
    ...daily.keys(),
    ...consecutive.keys(),
  ])
  const breakdown: OvertimeBreakdown[] = []

  for (const weekKey of weekKeys) {
    const choices = [
      { method: 'weekly' as const, candidate: weekly.get(weekKey) },
      { method: 'daily' as const, candidate: daily.get(weekKey) },
      {
        method: 'consecutive' as const,
        candidate: consecutive.get(weekKey),
      },
    ]
    const selected = choices.reduce((best, choice) =>
      (choice.candidate?.premiumCents || 0) >
      (best.candidate?.premiumCents || 0)
        ? choice
        : best,
    )
    if (!selected.candidate || selected.candidate.premiumCents <= 0) continue

    for (const [hourlyRate, rate] of selected.candidate.periodRates) {
      breakdown.push({
        key: `${weekKey}:${selected.method}:${hourlyRate}`,
        staffUserId: selected.candidate.staffUserId,
        staffDisplayName: selected.candidate.staffDisplayName,
        weekStart: selected.candidate.weekStart,
        method: selected.method,
        minutes: rate.minutes,
        hourlyRate,
        baseCents: rate.baseCents,
        premiumCents: rate.premiumCents,
      })
    }
  }

  breakdown.sort(
    (a, b) =>
      a.staffDisplayName.localeCompare(b.staffDisplayName) ||
      a.weekStart.localeCompare(b.weekStart) ||
      a.hourlyRate - b.hourlyRate,
  )

  return {
    minutes: breakdown.reduce((sum, group) => sum + group.minutes, 0),
    premiumCents: breakdown.reduce((sum, group) => sum + group.premiumCents, 0),
    breakdown,
  }
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
