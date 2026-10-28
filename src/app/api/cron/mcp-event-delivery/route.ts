import { NextRequest, NextResponse } from 'next/server'
import {
  deliverPendingMcpEvents,
  enqueuePersistedInboundEvents,
} from '@/lib/mcp/inbound-events'
import { createAdminClient } from '@/supabase/server'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const enqueued = await enqueuePersistedInboundEvents(supabase)
    const delivered = await deliverPendingMcpEvents({ supabase })
    return NextResponse.json({ success: true, enqueued, delivered })
  } catch (error) {
    console.error('[mcp-events] delivery worker failed:', error)
    return NextResponse.json(
      { error: 'Event delivery failed' },
      { status: 500 },
    )
  }
}
