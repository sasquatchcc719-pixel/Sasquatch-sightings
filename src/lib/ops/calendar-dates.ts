export function addOneCalendarYear(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const lastDayOfTargetMonth = new Date(
    Date.UTC(year + 1, month, 0),
  ).getUTCDate()
  return new Date(
    Date.UTC(year + 1, month - 1, Math.min(day, lastDayOfTargetMonth)),
  )
    .toISOString()
    .slice(0, 10)
}

export function mountainDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}
