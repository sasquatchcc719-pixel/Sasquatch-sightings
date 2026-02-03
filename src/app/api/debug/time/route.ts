import { NextResponse } from 'next/server'

export async function GET() {
  const now = new Date()

  // Use separate formatters for reliable parsing
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
  })
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    hour12: false,
  })
  const fullFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true,
  })

  const weekdayStr = weekdayFormatter.format(now)
  const hourRaw = hourFormatter.format(now)
  const hourStr = hourRaw.replace(/\D/g, '')
  const hour = parseInt(hourStr) || 0

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const isWeekday = weekdays.includes(weekdayStr)
  const isBusinessHours = isWeekday && hour >= 9 && hour < 17

  return NextResponse.json({
    utc: now.toISOString(),
    mountainTime: fullFormatter.format(now),
    weekday: weekdayStr,
    hourRaw: hourRaw,
    hourParsed: hour,
    isWeekday: isWeekday,
    isBusinessHours: isBusinessHours,
    expectedBehavior: isBusinessHours ? 'RING PHONES' : 'AFTER HOURS MESSAGE',
  })
}
