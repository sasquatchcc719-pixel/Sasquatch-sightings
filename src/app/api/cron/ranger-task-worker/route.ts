import { NextRequest, NextResponse } from 'next/server'
import { processRangerTaskBatch } from '@/lib/ranger/tasks'
import { createAdminClient } from '@/supabase/server'

const DEFAULT_BATCH_SIZE = 5

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = Math.min(
      Number(process.env.RANGER_TASK_BATCH_SIZE || DEFAULT_BATCH_SIZE),
      10,
    )
    const result = await processRangerTaskBatch({
      supabase: createAdminClient(),
      limit,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[cron/ranger-task-worker] Error:', error)
    return NextResponse.json(
      { error: 'Failed to run Ranger task worker' },
      { status: 500 },
    )
  }
}
