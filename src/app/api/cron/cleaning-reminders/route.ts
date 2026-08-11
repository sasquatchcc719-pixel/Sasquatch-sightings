import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { processDueCleaningReminders } from '@/lib/ops/cleaning-reminders'

/**
 * Sends customer-requested cleaning reminders that have come due.
 *
 * Scheduled at 17:00 UTC — 11am Mountain in summer, 10am in winter, so it
 * lands inside the 9am–7pm send window year-round regardless of DST.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const result = await processDueCleaningReminders(supabase)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('[cron/cleaning-reminders] Error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to process cleaning reminders',
      },
      { status: 500 },
    )
  }
}
