/**
 * Cron: post-job Google review requests.
 * Every run: (1) queue requests for newly completed appointments,
 * (2) send due requests inside the Mountain Time send window.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  enqueueReviewRequests,
  processDueReviewRequests,
} from '@/lib/ops/review-requests'
import {
  enqueueCleaningReminderPrompts,
  processDueCleaningReminderPrompts,
} from '@/lib/ops/cleaning-reminder-prompts'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const enqueued = await enqueueReviewRequests(supabase)
    const processed = await processDueReviewRequests(supabase)
    // Queue this after processing reviews so a sent review request establishes
    // the 30-minute separation. The prompt sender rechecks that boundary and
    // whether staff set a reminder before every send.
    const reminderPromptsEnqueued =
      await enqueueCleaningReminderPrompts(supabase)
    const reminderPromptsProcessed =
      await processDueCleaningReminderPrompts(supabase)
    return NextResponse.json({
      success: true,
      enqueued,
      processed,
      reminderPromptsEnqueued,
      reminderPromptsProcessed,
    })
  } catch (error) {
    console.error('[cron/review-requests] Error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to process review requests',
      },
      { status: 500 },
    )
  }
}
