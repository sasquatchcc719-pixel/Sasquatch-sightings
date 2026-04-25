import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  getOpsCommunicationQueueStats,
  processOpsCommunicationQueue,
} from '@/lib/ops/communications'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
    const stats = await getOpsCommunicationQueueStats()
    return NextResponse.json({
      stats,
      cron_provider: 'vercel',
      recommended_schedule: '*/15 * * * *',
    })
  } catch (error) {
    console.error('[ops/communications/queue][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load queue stats' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const body = await request.json().catch(() => ({}))
    const limit = body?.limit ? Number(body.limit) : 50
    const result = await processOpsCommunicationQueue({ limit })
    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error) {
    console.error('[ops/communications/queue][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process queue' },
      { status: 500 },
    )
  }
}
