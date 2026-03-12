import { NextRequest, NextResponse } from 'next/server'
import { processOpsCommunicationQueue } from '@/lib/ops/communications'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processOpsCommunicationQueue({ limit: 100 })
    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error) {
    console.error('[cron/ops-communications] Error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to process queue',
      },
      { status: 500 },
    )
  }
}
