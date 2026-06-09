export function parseHourlyRate(value: unknown): number | null {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) return null
  return Math.round((rate + Number.EPSILON) * 100) / 100
}

export function mountainDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
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
  const [year, month, day] = current.startDate.split('-').map(Number)

  if (offset === 1) {
    return day === 1
      ? getSemiMonthlyPayPeriod(dateKey(year, month, 16))
      : getSemiMonthlyPayPeriod(dateKey(year, month + 1, 1))
  }

  return day === 16
    ? getSemiMonthlyPayPeriod(dateKey(year, month, 1))
    : getSemiMonthlyPayPeriod(dateKey(year, month - 1, 16))
}
