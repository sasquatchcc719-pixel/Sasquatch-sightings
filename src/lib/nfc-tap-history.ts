const DENVER_TIME_ZONE = 'America/Denver'

function denverDayKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DENVER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function denverDayLabel(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER_TIME_ZONE,
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function buildThirtyDayTapHistory(
  tappedAt: Array<string | null | undefined>,
  now = new Date(),
) {
  const days = Array.from({ length: 30 }, (_, offset) => {
    const date = new Date(now.getTime() - (29 - offset) * 86_400_000)
    return { key: denverDayKey(date), date: denverDayLabel(date), count: 0 }
  })
  const byKey = new Map(days.map((day) => [day.key, day]))

  for (const value of tappedAt) {
    if (!value) continue
    const day = byKey.get(denverDayKey(new Date(value)))
    if (day) day.count++
  }

  return days.map(({ date, count }) => ({ date, count }))
}
