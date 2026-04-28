import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { sendDayBeforeReminderSms } from '@/lib/ops/communications'

export async function POST() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const result = await sendDayBeforeReminderSms({ bypassHourCheck: true })
    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error) {
    console.error(
      '[ops/communications/day-before-reminders][POST] Error:',
      error,
    )
    return NextResponse.json(
      { error: 'Failed to run day-before reminders' },
      { status: 500 },
    )
  }
}
