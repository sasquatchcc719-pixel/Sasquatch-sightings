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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const enqueued = await enqueueReviewRequests(supabase)
    const processed = await processDueReviewRequests(supabase)
    return NextResponse.json({ success: true, enqueued, processed })
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
