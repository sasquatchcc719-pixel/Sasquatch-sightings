import { NextRequest, NextResponse } from 'next/server'
import { scanTomorrowFill } from '@/lib/ops/tomorrow-fill'

export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const mountainHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  )
  if (mountainHour !== 9) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'outside_9am_mountain',
    })
  }

  try {
    const result = await scanTomorrowFill({
      notifyTelegram: true,
      actor: 'cron:tomorrow-fill',
    })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('[cron/tomorrow-fill] Error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Tomorrow Fill scan failed',
      },
      { status: 500 },
    )
  }
}
