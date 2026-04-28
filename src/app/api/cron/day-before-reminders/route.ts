import { NextRequest, NextResponse } from 'next/server'
import { sendDayBeforeReminderSms } from '@/lib/ops/communications'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const targetHour = Number(process.env.DAY_BEFORE_REMINDER_HOUR_MT || 9)
    const result = await sendDayBeforeReminderSms({
      targetHourMountain: Number.isFinite(targetHour) ? targetHour : 9,
    })
    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error) {
    console.error('[cron/day-before-reminders] Error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to send day-before reminders',
      },
      { status: 500 },
    )
  }
}
