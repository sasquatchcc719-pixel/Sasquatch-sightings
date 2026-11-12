import { NextRequest, NextResponse } from 'next/server'
import {
  deliverPendingMcpEvents,
  enqueuePersistedInboundEvents,
} from '@/lib/mcp/inbound-events'
import { deliverPendingMissedCallEmails } from '@/lib/mcp/missed-call-email-bridge'
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
    const [nativeEvents, missedCallEmails] = await Promise.allSettled([
      (async () => {
        const enqueued = await enqueuePersistedInboundEvents(supabase)
        const delivered = await deliverPendingMcpEvents({ supabase })
        return { enqueued, delivered }
      })(),
      deliverPendingMissedCallEmails({ db: supabase }),
    ])
    if (nativeEvents.status === 'rejected')
      console.error(
        '[mcp-events] native delivery worker failed:',
        nativeEvents.reason,
      )
    if (missedCallEmails.status === 'rejected')
      console.error(
        '[missed-call-email] owner notification worker failed:',
        missedCallEmails.reason,
      )
    if (
      nativeEvents.status === 'rejected' ||
      missedCallEmails.status === 'rejected'
    )
      return NextResponse.json(
        {
          error: 'One or more delivery workers failed',
          native_events: nativeEvents.status,
          missed_call_emails: missedCallEmails.status,
        },
        { status: 500 },
      )
    return NextResponse.json({
      success: true,
      ...nativeEvents.value,
      missed_call_emails: missedCallEmails.value,
    })
  } catch (error) {
    console.error('[mcp-events] delivery worker failed:', error)
    return NextResponse.json(
      { error: 'Event delivery failed' },
      { status: 500 },
    )
  }
}
